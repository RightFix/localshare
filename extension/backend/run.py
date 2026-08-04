import argparse
import asyncio
import logging
import os
import signal
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent))

from uvicorn.config import Config

from services.manager import Server as LocalServer, bind_socket


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )
    logger = logging.getLogger(__name__)

    parser = argparse.ArgumentParser(description="LocalShare Backend")
    parser.add_argument(
        "--internal-port",
        type=int,
        default=8765,
        help="Internal API port for extension communication (default: 8765)",
    )
    parser.add_argument(
        "--data-dir",
        type=str,
        default=None,
        help="Data directory for JSON storage",
    )
    args = parser.parse_args()

    data_dir = args.data_dir or str(Path(__file__).parent / "data")

    # backend.main reads LOCALSHARE_DATA_DIR at import time, so it must be set
    # before the module is imported below.
    os.environ["LOCALSHARE_DATA_DIR"] = data_dir

    logger.info("Starting LocalShare backend")
    logger.info(f"Internal API: 127.0.0.1:{args.internal_port}")
    logger.info(f"Data directory: {data_dir}")
    logger.info("Browser server (LAN) is managed by the internal API via /internal/start")

    import backend.main as app_module  # noqa: PLC0415

    asyncio.run(_serve_async(app_module, args.internal_port))


async def _serve_async(app_module: Any, internal_port: int) -> None:
    """Run the loopback internal server and keep the process alive.

    The LAN-facing browser server is started/stopped on demand by
    ServerManager when the extension calls /internal/start|stop, so it
    shares this process, its StorageManager, and its EventBus.
    """
    logger = logging.getLogger(__name__)

    internal_config = Config(
        app_module.create_internal_app(),
        host="127.0.0.1",
        port=internal_port,
        log_level="info",
        timeout_graceful_shutdown=1,
    )

    # Bind before starting uvicorn so a busy port is reported cleanly instead
    # of letting uvicorn's sys.exit() escape into the event loop.
    try:
        internal_sockets = [bind_socket("127.0.0.1", internal_port)]
    except OSError as exc:
        logger.error(f"Internal server failed to bind on 127.0.0.1:{internal_port}: {exc}")
        raise SystemExit(1)

    internal_server = LocalServer(internal_config)
    internal_task = asyncio.create_task(internal_server.serve(sockets=internal_sockets))

    shutdown_task: asyncio.Task | None = None

    def _shutdown() -> None:
        nonlocal shutdown_task
        logger.info("Shutdown signal received")
        internal_server.should_exit = True
        if shutdown_task is None:
            shutdown_task = asyncio.create_task(app_module.server_manager.shutdown())

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _shutdown)
        except NotImplementedError:
            signal.signal(sig, lambda *_: _shutdown())

    try:
        await internal_task
    except SystemExit:
        logger.error("Internal server failed to start (port already in use?)")
        raise SystemExit(1)
    finally:
        if shutdown_task is not None:
            await shutdown_task


if __name__ == "__main__":
    main()
