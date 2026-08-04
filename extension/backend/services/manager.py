"""Server manager for LocalShare.

Manages the LAN-facing browser server lifecycle. The internal API server
(for the GNOME extension) runs in the same process as this manager and is
started by run.py. Both servers share a single StorageManager and EventBus,
so approval events and upload/download notifications flow between the
extension and browser WebSockets without a subprocess boundary.

The LAN server is started/stopped in-process via /internal/start|stop; it
never spawns or kills a child process.
"""

import asyncio
import logging
import socket
from collections.abc import Callable
from pathlib import Path
from typing import Any

import uvicorn
from uvicorn.config import Config

from constants import (
    ACTION_CLIENT_APPROVED,
    ACTION_CLIENT_CONNECTED,
    ACTION_CLIENT_DISCONNECTED,
    ACTION_CLIENT_REJECTED,
    ACTION_DOWNLOAD_COMPLETED,
    ACTION_SHARING_STOPPED,
    ACTION_UPLOAD_COMPLETED,
)

from models.activity import ActivityData
from models.client import ClientsData
from models.session import Session, SessionsData
from storage.manager import StorageManager

logger = logging.getLogger(__name__)


def bind_socket(host: str, port: int) -> socket.socket:
    """Create and bind a TCP socket without listening.

    Unlike uvicorn's Config.bind_socket(), which calls sys.exit() on a busy
    port, this raises OSError so callers can handle port conflicts cleanly.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((host, port))
        sock.set_inheritable(True)
        return sock
    except OSError:
        sock.close()
        raise


class Server(uvicorn.Server):
    """uvicorn server that does not install its own signal handlers.

    The backend runs two servers in one process (loopback internal + LAN
    browser). uvicorn captures SIGINT/SIGTERM per-server via signal.signal,
    and with two servers the last one to start would hijack the handlers and
    leave the other running. Skipping capture lets run.py own shutdown.
    """

    async def serve(self, sockets: list[Any] | None = None) -> None:
        await self._serve(sockets)


class ServerManager:
    """Manages the LocalShare LAN server lifecycle in-process."""

    def __init__(
        self,
        storage: StorageManager,
        browser_app_factory: Callable[[], Any],
    ) -> None:
        self.storage = storage
        self._browser_app_factory = browser_app_factory
        self._lan_server: uvicorn.Server | None = None
        self._lan_task: asyncio.Task | None = None
        self._ws_callback: Callable | None = None
        self._upload_callback: Callable | None = None
        self._download_callback: Callable | None = None

    def set_ws_callback(self, callback: Callable) -> None:
        """Set callback for WebSocket events to extension."""
        self._ws_callback = callback

    def set_upload_callback(self, callback: Callable) -> None:
        """Set callback for upload events to extension."""
        self._upload_callback = callback

    def set_download_callback(self, callback: Callable) -> None:
        """Set callback for download events to extension."""
        self._download_callback = callback

    async def start(
        self,
        port: int,
        internal_port: int,
        upload_dir: Path,
        shared_dir: Path,
    ) -> bool:
        """Start the LAN browser server in-process on 0.0.0.0:{port}."""
        config = await self.storage.get_config()
        config.port = port
        config.internal_port = internal_port
        config.upload_dir = upload_dir
        config.shared_dir = shared_dir
        config.sharing_enabled = True

        await self.storage.save_config(config)

        upload_dir.mkdir(parents=True, exist_ok=True)
        shared_dir.mkdir(parents=True, exist_ok=True)

        logger.info(f"Starting LocalShare LAN server on port {port}")
        logger.info(f"Upload directory: {upload_dir}")
        logger.info(f"Shared directory: {shared_dir}")

        if self._lan_server is not None and self._lan_server.config.port != port:
            await self._stop_lan_server()

        if self._lan_server is None:
            if not await self._start_lan_server(port):
                await self.storage.disable_sharing()
                return False

        return True

    async def _start_lan_server(self, port: int) -> bool:
        """Create the LAN uvicorn server in-process and wait for it to bind."""
        app = self._browser_app_factory()
        config = Config(
            app,
            host="0.0.0.0",
            port=port,
            log_level="info",
            timeout_graceful_shutdown=1,
        )

        # Bind the socket ourselves so a port conflict is caught here instead
        # of inside the uvicorn task (uvicorn would call sys.exit() on OSError,
        # which corrupts the shared event loop).
        try:
            sockets = [bind_socket("0.0.0.0", port)]
        except OSError as exc:
            logger.error(f"LAN server failed to bind on 0.0.0.0:{port}: {exc}")
            return False

        server = Server(config)
        task = asyncio.create_task(server.serve(sockets=sockets))
        self._lan_server = server
        self._lan_task = task

        for _ in range(100):
            if server.started:
                logger.info(f"LAN server running on 0.0.0.0:{port}")
                return True
            if task.done():
                break
            await asyncio.sleep(0.05)

        error = task.exception() if task.done() and not task.cancelled() else None
        logger.error(f"LAN server failed to start on port {port}: {error}")
        self._lan_server = None
        self._lan_task = None
        return False

    async def _stop_lan_server(self) -> None:
        """Gracefully stop the LAN uvicorn server if it is running."""
        if self._lan_server is None:
            return

        logger.info("Stopping LAN server")
        self._lan_server.should_exit = True
        task = self._lan_task
        self._lan_server = None
        self._lan_task = None

        if task is not None:
            try:
                await asyncio.wait_for(task, timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                task.cancel()
                logger.warning("LAN server did not stop cleanly")

    async def stop(self) -> None:
        """Stop the LAN server and clear all sessions/clients."""
        logger.info("Stopping LocalShare server")

        if self._ws_callback:
            await self._ws_callback({"action": ACTION_SHARING_STOPPED})

        await self._stop_lan_server()
        await self.storage.disable_sharing()

        logger.info("LocalShare server stopped")

    async def is_running(self) -> bool:
        """Check if the LAN server is currently running."""
        return self._lan_task is not None and not self._lan_task.done()

    async def shutdown(self) -> None:
        """Stop the LAN server during backend process shutdown.

        Also persists sharing_enabled=False so a stale "running" state is not
        reported after the process restarts (the LAN server does not survive
        a restart).
        """
        await self._stop_lan_server()
        await self.storage.disable_sharing()

    async def approve_client(self, client_id: str) -> Session | None:
        """Approve a pending client."""
        def _approve(clients: ClientsData) -> None:
            clients.approve(client_id)

        clients = await self.storage.update_clients(_approve)
        client = clients.get_connected(client_id)

        if not client:
            return None

        def _add_session(sessions: SessionsData) -> None:
            sessions.add(device=client.device, ip=client.ip, client_id=client.id)

        sessions = await self.storage.update_sessions(_add_session)
        session = next((s for s in sessions.sessions if s.client_id == client.id), None)

        if session is None:
            return None

        if self._ws_callback:
            await self._ws_callback(
                {
                    "action": ACTION_CLIENT_APPROVED,
                    "client_id": client.id,
                    "session_id": session.id,
                    "device": client.device,
                }
            )

        logger.info(f"Approved client: {client.device} ({client.ip})")
        return session

    async def reject_client(self, client_id: str) -> bool:
        """Reject a pending client."""
        removed: dict = {}

        def _reject(clients: ClientsData) -> None:
            client = clients.get_pending(client_id)
            if client:
                removed["client"] = client
                clients.remove_pending(client_id)

        await self.storage.update_clients(_reject)
        client = removed.get("client")

        if not client:
            return False

        if self._ws_callback:
            await self._ws_callback({"action": ACTION_CLIENT_REJECTED, "client_id": client_id})

        logger.info(f"Rejected client: {client.device} ({client.ip})")
        return True

    async def disconnect_client(self, session_id: str) -> bool:
        """Disconnect an approved session."""
        removed: dict = {}

        def _remove_session(sessions: SessionsData) -> None:
            session = sessions.get(session_id)
            if session:
                removed["session"] = session
                sessions.remove(session_id)

        await self.storage.update_sessions(_remove_session)
        session = removed.get("session")

        if not session:
            return False

        def _remove_connected(clients: ClientsData) -> None:
            clients.remove_connected(session.client_id)

        await self.storage.update_clients(_remove_connected)

        if self._ws_callback:
            await self._ws_callback(
                {"action": ACTION_CLIENT_DISCONNECTED, "session_id": session_id}
            )

        logger.info(f"Disconnected session: {session.id}")
        return True

    async def add_pending_client(self, device: str, ip: str, user_agent: str = "") -> str:
        """Add a new pending client."""
        created: dict = {}

        def _add_pending(clients: ClientsData) -> None:
            created["client"] = clients.add_pending(
                device=device, ip=ip, user_agent=user_agent
            )

        await self.storage.update_clients(_add_pending)
        client = created["client"]

        if self._ws_callback:
            await self._ws_callback(
                {
                    "action": ACTION_CLIENT_CONNECTED,
                    "client_id": client.id,
                    "device": client.device,
                    "ip": client.ip,
                }
            )

        logger.info(f"New pending client: {device} ({ip})")
        return client.id

    async def remove_pending_client(self, client_id: str) -> bool:
        """Remove a pending client without publishing a rejection event."""
        removed: dict = {}

        def _remove_pending(clients: ClientsData) -> None:
            removed["ok"] = clients.remove_pending(client_id)

        await self.storage.update_clients(_remove_pending)

        if removed.get("ok"):
            logger.info(f"Removed pending client: {client_id}")
            return True

        return False

    async def notify_upload(self, filename: str, size: int, from_device: str) -> None:
        """Record and notify about an upload."""
        def _record(activity: ActivityData) -> None:
            activity.add_upload(filename=filename, size=size, from_device=from_device)

        await self.storage.update_activity(_record)

        if self._upload_callback:
            await self._upload_callback(
                {
                    "action": ACTION_UPLOAD_COMPLETED,
                    "filename": filename,
                    "size": size,
                    "from_device": from_device,
                }
            )

    async def notify_download(self, filename: str, size: int, to_device: str) -> None:
        """Record and notify about a download."""
        def _record(activity: ActivityData) -> None:
            activity.add_download(filename=filename, size=size, to_device=to_device)

        await self.storage.update_activity(_record)

        if self._download_callback:
            await self._download_callback(
                {
                    "action": ACTION_DOWNLOAD_COMPLETED,
                    "filename": filename,
                    "size": size,
                    "to_device": to_device,
                }
            )
