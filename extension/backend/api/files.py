"""File upload, download, and listing routes.

All routes require a valid browser session (via cookie or header).
"""

import logging
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/api/upload")
async def api_upload(
    request: Request,
) -> JSONResponse:
    """Handle file uploads from an authenticated browser session."""
    from backend.auth.dependencies import verify_csrf
    from backend.auth.session import validate_session

    storage = request.app.state.storage_manager
    server_manager = request.app.state.server_manager

    sid = await validate_session(request, storage)
    if not sid:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    try:
        verify_csrf(request)
    except Exception:
        return JSONResponse({"error": "CSRF check failed"}, status_code=403)

    try:
        form = await request.form()
    except Exception:
        return JSONResponse({"error": "Invalid form data"}, status_code=400)

    files = []
    for key, value in form.items():
        if key == "file" and hasattr(value, "read"):
            files.append(value)

    if not files:
        return JSONResponse({"error": "No files provided"}, status_code=400)

    sessions = await storage.get_sessions()
    session = sessions.get(sid)
    config = await storage.get_config()

    uploaded = []
    for file in files:
        filename = getattr(file, "filename", None) or "unknown"
        safe_name = "".join(c for c in filename if c.isalnum() or c in "._- ")
        safe_name = safe_name[:200]

        upload_path = config.upload_dir / safe_name
        if upload_path.exists():
            base, ext = safe_name.rsplit(".", 1) if "." in safe_name else (safe_name, "")
            counter = 1
            while upload_path.exists():
                if ext:
                    safe_name = f"{base}_{counter}.{ext}"
                else:
                    safe_name = f"{base}_{counter}"
                upload_path = config.upload_dir / safe_name
                counter += 1

        content = await file.read()
        upload_path.write_bytes(content)

        await server_manager.notify_upload(
            safe_name, len(content), session.device if session else "Unknown"
        )
        uploaded.append(safe_name)

    return JSONResponse({"message": f"Uploaded: {', '.join(uploaded)}"})


@router.get("/api/files", response_model=None)
async def api_list_files(
    request: Request,
    path: str = "",
):
    """List files in the shared directory."""
    storage = request.app.state.storage_manager

    from backend.auth.session import validate_session

    session_id = await validate_session(request, storage)
    if not session_id:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    config = await storage.get_config()
    shared_dir = config.shared_dir

    target_dir = (shared_dir / path) if path else shared_dir
    resolved = target_dir.resolve()

    if not target_dir.is_symlink() and not resolved.is_relative_to(shared_dir.resolve()):
        return JSONResponse({"error": "Invalid path"}, status_code=400)

    if not resolved.exists() or not resolved.is_dir():
        return []

    files = []
    for entry in sorted(resolved.iterdir()):
        if entry.is_file():
            files.append(
                {
                    "name": entry.name,
                    "path": (path + "/" + entry.name if path else entry.name),
                    "size": entry.stat().st_size,
                    "modified": entry.stat().st_mtime,
                    "isDirectory": False,
                }
            )
        elif entry.is_dir():
            files.append(
                {
                    "name": entry.name,
                    "path": (path + "/" + entry.name if path else entry.name),
                    "size": 0,
                    "modified": entry.stat().st_mtime,
                    "isDirectory": True,
                }
            )

    return files


@router.get("/api/files/{filepath:path}", response_model=None)
async def api_download_file(
    filepath: str,
    request: Request,
):
    """Download a file from the shared directory."""
    storage = request.app.state.storage_manager

    from backend.auth.session import validate_session

    session_id = await validate_session(request, storage)
    if not session_id:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    config = await storage.get_config()
    shared_dir = config.shared_dir

    safe_path = Path(filepath)
    if safe_path.is_absolute() or ".." in safe_path.parts:
        return JSONResponse({"error": "Invalid path"}, status_code=400)

    file_path = shared_dir / safe_path
    if not file_path.exists():
        return JSONResponse({"error": "File not found"}, status_code=404)

    if not file_path.is_symlink() and not file_path.resolve().is_relative_to(shared_dir.resolve()):
        return JSONResponse({"error": "File not found"}, status_code=404)

    if not file_path.is_file():
        return JSONResponse({"error": "File not found"}, status_code=404)

    server_manager = request.app.state.server_manager
    sessions = await storage.get_sessions()
    session = sessions.get(session_id)
    await server_manager.notify_download(
        file_path.name,
        file_path.stat().st_size,
        session.device if session else "Unknown",
    )

    return FileResponse(file_path, filename=file_path.name)
