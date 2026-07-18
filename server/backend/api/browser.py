"""Browser-facing API routes for LocalShare.

These routes are accessible from any device on the local network
and serve the web UI as well as the session approval endpoints.
"""

import logging

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse

from backend.auth.session import set_session_cookie

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
        sessions_data = await storage.get_sessions()
        session = sessions_data.get(session_id)
        if session:
            session.update_activity()
            await storage.sessions.save(sessions_data.model_dump())
            return {"status": "approved", "session_id": session.id}

    return {"status": "pending"}


@router.post("/api/approve/{client_id}", response_model=None)
async def api_approve(client_id: str, request: Request) -> JSONResponse:
    """Approve a pending client and create a browser session."""
    server_manager = request.app.state.server_manager
    session = await server_manager.approve_client(client_id)
    if session:
        response = JSONResponse({"status": "approved", "session_id": session.id})
        set_session_cookie(response, session.id)
        return response
    return JSONResponse(
        {"status": "error", "message": "Client not found"},
        status_code=404,
    )


@router.post("/api/reject/{client_id}")
async def api_reject(client_id: str, request: Request) -> dict:
    """Reject a pending client."""
    server_manager = request.app.state.server_manager
    success = await server_manager.reject_client(client_id)
    return {"status": "success" if success else "error"}


@router.get("/api/pending")
async def api_pending(request: Request) -> dict:
    """Get list of pending clients."""
    storage = request.app.state.storage_manager
    clients = await storage.get_clients()
    return {"pending": [c.model_dump() for c in clients.pending]}


@router.get("/api/clients")
async def api_clients(request: Request) -> dict:
    """Get list of connected clients with session info."""
    storage = request.app.state.storage_manager
    clients = await storage.get_clients()
    sessions = await storage.get_sessions()
    return {
        "connected": [
            {**c.model_dump(), "session_id": s.id}
            for c in clients.connected
            for s in sessions.sessions
            if s.client_id == c.id
        ]
    }
