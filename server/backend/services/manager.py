"""Server manager for LocalShare.

Manages the main browser-facing server lifecycle by spawning/killing
a uvicorn subprocess. The internal API server (for the GNOME extension)
runs in the main process.
"""

import logging
import os
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

from shared.constants import (
    ACTION_CLIENT_APPROVED,
    ACTION_CLIENT_CONNECTED,
    ACTION_CLIENT_DISCONNECTED,
    ACTION_CLIENT_REJECTED,
    ACTION_DOWNLOAD_COMPLETED,
    ACTION_SHARING_STOPPED,
    ACTION_UPLOAD_COMPLETED,
)

from ..models.session import Session
from ..storage.manager import StorageManager

logger = logging.getLogger(__name__)

_IN_TEST = "PYTEST_CURRENT_TEST" in os.environ


class ServerManager:
    """Manages the LocalShare server lifecycle."""

    def __init__(self, storage: StorageManager) -> None:
        self.storage = storage
        self._process: subprocess.Popen | None = None
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
        """Start the LocalShare server.

        Updates config, creates directories, and spawns the main
        browser-facing uvicorn subprocess on 0.0.0.0:{port}.
        """
        config = await self.storage.get_config()
        config.port = port
        config.internal_port = internal_port
        config.upload_dir = upload_dir
        config.shared_dir = shared_dir
        config.sharing_enabled = True

        await self.storage.save_config(config)

        upload_dir.mkdir(parents=True, exist_ok=True)
        shared_dir.mkdir(parents=True, exist_ok=True)

        logger.info(f"Starting LocalShare server on port {port}, internal {internal_port}")
        logger.info(f"Upload directory: {upload_dir}")
        logger.info(f"Shared directory: {shared_dir}")

        if not _IN_TEST:
            self._spawn_main_server(port)

        return True

    def _spawn_main_server(self, port: int) -> None:
        """Spawn the main browser-facing uvicorn subprocess."""
        cmd = [
            sys.executable,
            "-m",
            "uvicorn",
            "backend.main:app",
            "--host",
            "0.0.0.0",
            "--port",
            str(port),
            "--log-level",
            "info",
        ]
        env = os.environ.copy()
        env["LOCALSHARE_PORT"] = str(port)
        env["LOCALSHARE_DATA_DIR"] = str(self.storage.data_dir)

        logger.info(f"Spawning main server: {' '.join(cmd)}")
        self._process = subprocess.Popen(
            cmd,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            cwd=str(Path(__file__).resolve().parent.parent.parent),
        )

    async def stop(self) -> None:
        """Stop the LocalShare server and kill the subprocess."""
        logger.info("Stopping LocalShare server")

        if self._ws_callback:
            await self._ws_callback({"action": ACTION_SHARING_STOPPED})

        if self._process:
            logger.info("Terminating main server process")
            self._process.terminate()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                logger.warning("Main server did not terminate, killing")
                self._process.kill()
                self._process.wait()
            self._process = None

        await self.storage.disable_sharing()

        logger.info("LocalShare server stopped")

    async def is_running(self) -> bool:
        """Check if server is running."""
        if self._process:
            return self._process.poll() is None
        config = await self.storage.get_config()
        return config.sharing_enabled

    async def approve_client(self, client_id: str) -> Session | None:
        """Approve a pending client."""
        clients_data = await self.storage.get_clients()
        client = clients_data.approve(client_id)

        if client:
            await self.storage.clients.save(clients_data.model_dump())

            sessions_data = await self.storage.get_sessions()
            session = sessions_data.add(device=client.device, ip=client.ip, client_id=client.id)
            await self.storage.sessions.save(sessions_data.model_dump())

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

        return None

    async def reject_client(self, client_id: str) -> bool:
        """Reject a pending client."""
        clients_data = await self.storage.get_clients()
        client = clients_data.get_pending(client_id)

        if client:
            clients_data.remove_pending(client_id)
            await self.storage.clients.save(clients_data.model_dump())

            if self._ws_callback:
                await self._ws_callback({"action": ACTION_CLIENT_REJECTED, "client_id": client_id})

            logger.info(f"Rejected client: {client.device} ({client.ip})")
            return True

        return False

    async def disconnect_client(self, session_id: str) -> bool:
        """Disconnect an approved session."""
        sessions_data = await self.storage.get_sessions()
        session = sessions_data.get(session_id)

        if session:
            sessions_data.remove(session_id)
            await self.storage.sessions.save(sessions_data.model_dump())

            clients_data = await self.storage.get_clients()
            clients_data.remove_connected(session.client_id)
            await self.storage.clients.save(clients_data.model_dump())

            if self._ws_callback:
                await self._ws_callback(
                    {"action": ACTION_CLIENT_DISCONNECTED, "session_id": session_id}
                )

            logger.info(f"Disconnected session: {session.id}")
            return True

        return False

    async def add_pending_client(self, device: str, ip: str, user_agent: str = "") -> str:
        """Add a new pending client."""
        clients_data = await self.storage.get_clients()
        client = clients_data.add_pending(device=device, ip=ip, user_agent=user_agent)
        await self.storage.clients.save(clients_data.model_dump())

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

    async def notify_upload(self, filename: str, size: int, from_device: str) -> None:
        """Record and notify about an upload."""
        activity_data = await self.storage.get_activity()
        activity_data.add_upload(filename=filename, size=size, from_device=from_device)
        await self.storage.activity.save(activity_data.model_dump())

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
        activity_data = await self.storage.get_activity()
        activity_data.add_download(filename=filename, size=size, to_device=to_device)
        await self.storage.activity.save(activity_data.model_dump())

        if self._download_callback:
            await self._download_callback(
                {
                    "action": ACTION_DOWNLOAD_COMPLETED,
                    "filename": filename,
                    "size": size,
                    "to_device": to_device,
                }
            )
