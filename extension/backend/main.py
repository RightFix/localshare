import logging
import os
import sys
from pathlib import Path

from fastapi import FastAPI

from constants import EVENT_CLIENT, EVENT_FILE
from services.manager import ServerManager
from storage.manager import StorageManager
from websocket.events import event_bus


_SERVER_DIR = Path(__file__).resolve().parent.parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

logger = logging.getLogger(__name__)

DATA_DIR = Path(os.environ.get("LOCALSHARE_DATA_DIR", _SERVER_DIR / "data"))
STATIC_DIR = Path(__file__).resolve().parent / "static"


# Shared singletons used by BOTH the loopback internal server and the
# LAN-facing browser server. Sharing a single StorageManager/ServerManager
# and a single EventBus across the two ASGI apps is what makes the
# browser<->extension approval handshake and event notifications work.
storage_manager = StorageManager(DATA_DIR)


def _configure_callbacks() -> None:
    """Route server-manager events onto the shared EventBus."""
    server_manager.set_ws_callback(lambda data: event_bus.publish(EVENT_CLIENT, data))
    server_manager.set_upload_callback(lambda data: event_bus.publish(EVENT_FILE, data))
    server_manager.set_download_callback(lambda data: event_bus.publish(EVENT_FILE, data))


def create_internal_app() -> FastAPI:
    """App served only on 127.0.0.1 for the GNOME extension."""
    app = FastAPI(title="LocalShare Internal")
    app.state.storage_manager = storage_manager
    app.state.server_manager = server_manager

    from api.internal import router as internal_router
    from websocket.extension import router as extension_ws_router

    app.include_router(internal_router)
    app.include_router(extension_ws_router)
    return app


def create_browser_app() -> FastAPI:
    """App served on 0.0.0.0 for browsers on the local network."""
    app = FastAPI(title="LocalShare")
    app.state.storage_manager = storage_manager
    app.state.server_manager = server_manager
    app.state.static_dir = STATIC_DIR

    from api.browser import router as browser_router
    from api.files import router as files_router
    from websocket.client import router as browser_ws_router

    app.include_router(browser_router)
    app.include_router(files_router)
    app.include_router(browser_ws_router)
    return app


server_manager = ServerManager(storage_manager, create_browser_app)
_configure_callbacks()
