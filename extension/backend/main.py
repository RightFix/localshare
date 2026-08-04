"""FastAPI application factory for LocalShare.

Creates a FastAPI application with:
- Lifespan-managed StorageManager and ServerManager (stored in app.state)
- All API routers (browser, internal, files, websocket)
- Static directory serving for the web UI
"""

import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

# Make shared/constants.py importable from server/backend/
# In production (via install.sh): shared/ is deployed to $EXT_TARGET/shared/
# In development: shared/ is at the repo root (parent of server/)
_SERVER_DIR = Path(__file__).resolve().parent.parent
_REPO_ROOT = _SERVER_DIR.parent
for path in (str(_SERVER_DIR), str(_REPO_ROOT)):
    if path not in sys.path:
        sys.path.insert(0, path)

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

logger = logging.getLogger(__name__)

DATA_DIR = Path(os.environ.get("LOCALSHARE_DATA_DIR", _SERVER_DIR / "data"))
STATIC_DIR = _SERVER_DIR / "static"

MAIN_PORT = int(os.environ.get("LOCALSHARE_PORT", "8080"))
INTERNAL_PORT = int(os.environ.get("LOCALSHARE_INTERNAL_PORT", "8765"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize and clean up backend services."""
    from backend.services.manager import ServerManager
    from backend.storage.manager import StorageManager
    from backend.websocket.events import event_bus
    from shared.constants import EVENT_CLIENT, EVENT_FILE

    logger.info("Starting LocalShare backend")

    app.state.storage_manager = StorageManager(DATA_DIR)
    app.state.server_manager = ServerManager(app.state.storage_manager)
    app.state.static_dir = STATIC_DIR

    bus = event_bus
    app.state.server_manager.set_ws_callback(lambda data: bus.publish(EVENT_CLIENT, data))
    app.state.server_manager.set_upload_callback(lambda data: bus.publish(EVENT_FILE, data))
    app.state.server_manager.set_download_callback(lambda data: bus.publish(EVENT_FILE, data))

    logger.info("LocalShare backend ready")
    yield
    logger.info("Shutting down LocalShare backend")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(title="LocalShare", lifespan=lifespan)

    from backend.api.browser import router as browser_router
    from backend.api.files import router as files_router
    from backend.api.internal import router as internal_router
    from backend.websocket.client import router as browser_ws_router
    from backend.websocket.extension import router as extension_ws_router

    app.include_router(browser_router)
    app.include_router(files_router)
    app.include_router(internal_router)
    app.include_router(browser_ws_router)
    app.include_router(extension_ws_router)

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
