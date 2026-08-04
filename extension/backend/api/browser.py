"""Browser-facing API routes for LocalShare.

These routes are accessible from any device on the local network and serve
the web UI plus the browser-session status check. Client approval, rejection,
and management happen exclusively through the loopback-only internal API
(see api/internal.py) and are never exposed on the LAN.
"""

import logging

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/")
async def root(request: Request) -> FileResponse:
    """Serve the web UI."""
    return FileResponse(request.app.state.static_dir / "index.html")


@router.get("/style.css")
async def style_css(request: Request) -> FileResponse:
    """Serve the stylesheet."""
    return FileResponse(
        request.app.state.static_dir / "style.css",
        media_type="text/css",
    )


@router.get("/app.js")
async def app_js(request: Request) -> FileResponse:
    """Serve the frontend JavaScript."""
    return FileResponse(
        request.app.state.static_dir / "app.js",
        media_type="application/javascript",
    )


@router.get("/api/status")
async def api_status(request: Request) -> dict:
    """Get connection status for the current browser session."""
    session_id = request.cookies.get("session_id")
    if not session_id:
        session_id = request.headers.get("X-Session-Token")

    if session_id:
        storage = request.app.state.storage_manager
        found: dict = {}

        def _touch(sessions) -> None:
            session = sessions.get(session_id)
            if session:
                session.update_activity()
                found["id"] = session.id

        await storage.update_sessions(_touch)

        if found.get("id"):
            return {"status": "approved", "session_id": found["id"]}

    return {"status": "pending"}
