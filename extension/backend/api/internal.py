import logging
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError

from models.config import Config
from services.network import get_all_local_ips

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal")


class SendFilesRequest(BaseModel):
    """Payload for registering Send-mode files (absolute paths)."""

    files: list[str] = []


@router.get("/send-files")
async def internal_get_send_files(request: Request) -> dict:
    """Get the currently registered Send-mode file map."""
    server_manager = request.app.state.server_manager
    send_files = server_manager.get_send_files()
    return {
        "files": [
            {"name": name, "path": str(path)} for name, path in send_files.items()
        ]
    }


@router.put("/send-files", response_model=None)
async def internal_set_send_files(payload: SendFilesRequest, request: Request) -> dict:
    """Register the exact absolute paths to share in Send mode.

    Loopback-only (the LAN app does not mount the internal router), so only
    the GNOME extension can set these. The browser list/download routes then
    serve exactly these paths by name; shared_dir containment is untouched.
    """
    server_manager = request.app.state.server_manager
    send_files = server_manager.set_send_files([Path(p) for p in payload.files])
    return {
        "status": "success",
        "files": [
            {"name": name, "path": str(path)} for name, path in send_files.items()
        ],
    }


@router.get("/status", response_model=None)
async def internal_status(request: Request) -> dict:
    """Get current server status (running, port, clients, etc.)."""
    storage = request.app.state.storage_manager
    status = await storage.get_status()
    return status.model_dump()


@router.get("/config")
async def internal_config(request: Request) -> dict:
    """Get current configuration."""
    storage = request.app.state.storage_manager
    config = await storage.get_config()
    return config.model_dump()


@router.put("/config", response_model=None)
async def internal_update_config(config: dict, request: Request) -> dict | JSONResponse:
    """Update configuration values, validated against the Config model."""
    storage = request.app.state.storage_manager
    current = await storage.get_config()
    merged = current.model_dump()
    merged.update(config)
    try:
        updated = Config(**merged)
    except ValidationError as e:
        logger.warning(f"Rejected invalid config update: {e.errors()}")
        return JSONResponse(
            {"status": "error", "message": "Invalid config", "detail": e.errors()},
            status_code=400,
        )
    await storage.save_config(updated)
    return {"status": "success"}


@router.post("/start", response_model=None)
async def internal_start(config: dict, request: Request) -> dict | JSONResponse:
    """Start sharing."""
    server_manager = request.app.state.server_manager
    try:
        cfg = Config(**config)
    except ValidationError as e:
        logger.warning(f"Rejected invalid start config: {e.errors()}")
        return JSONResponse(
            {"status": "error", "message": "Invalid config", "detail": e.errors()},
            status_code=400,
        )
    success = await server_manager.start(
        port=cfg.port,
        internal_port=cfg.internal_port,
        upload_dir=cfg.upload_dir,
        shared_dir=cfg.shared_dir,
    )
    return {"status": "success" if success else "error"}


@router.post("/stop")
async def internal_stop(request: Request) -> dict:
    """Stop sharing."""
    server_manager = request.app.state.server_manager
    await server_manager.stop()
    return {"status": "success"}


@router.post("/approve/{client_id}", response_model=None)
async def internal_approve(client_id: str, request: Request):
    """Approve a pending client (from extension)."""
    server_manager = request.app.state.server_manager
    session = await server_manager.approve_client(client_id)
    if session:
        return JSONResponse({"status": "success", "session_id": session.id})
    return JSONResponse(
        {"status": "error", "message": "Client not found"},
        status_code=404,
    )


@router.post("/reject/{client_id}")
async def internal_reject(client_id: str, request: Request) -> dict:
    """Reject a pending client (from extension)."""
    server_manager = request.app.state.server_manager
    success = await server_manager.reject_client(client_id)
    return {"status": "success" if success else "error"}


@router.get("/pending")
async def internal_pending(request: Request) -> dict:
    """Get list of pending clients."""
    storage = request.app.state.storage_manager
    clients = await storage.get_clients()
    return {"pending": [c.model_dump() for c in clients.pending]}


@router.get("/clients")
async def internal_clients(request: Request) -> dict:
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


@router.get("/ips")
async def internal_ips() -> dict:
    """Get all local IP addresses."""
    return {"ips": get_all_local_ips()}
