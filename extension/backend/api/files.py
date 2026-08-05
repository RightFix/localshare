"""File upload, download, and listing routes.

All routes require a valid browser session (via cookie or header).
"""

import logging
from pathlib import Path

import aiofiles
from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse

from auth.dependencies import verify_csrf
from auth.session import validate_session

logger = logging.getLogger(__name__)

router = APIRouter()

_CHUNK_SIZE = 1024 * 1024


async def _stream_to_disk(file, path: Path) -> int:
    """Stream a file upload to disk in bounded chunks. Returns bytes written."""
    total = 0
    async with aiofiles.open(path, "wb") as f:
        while chunk := await file.read(_CHUNK_SIZE):
            total += len(chunk)
            await f.write(chunk)
    return total


@router.post("/api/upload")
async def api_upload(
    request: Request,
) -> JSONResponse:
    """Handle file uploads from an authenticated browser session."""
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
            base, ext = (
                safe_name.rsplit(".", 1) if "." in safe_name else (safe_name, "")
            )
            counter = 1
            while upload_path.exists():
                if ext:
                    safe_name = f"{base}_{counter}.{ext}"
                else:
                    safe_name = f"{base}_{counter}"
                upload_path = config.upload_dir / safe_name
                counter += 1

        size = await _stream_to_disk(file, upload_path)

        await server_manager.notify_upload(
            safe_name, size, session.device if session else "Unknown"
        )
        uploaded.append(safe_name)

    return JSONResponse({"message": f"Uploaded: {', '.join(uploaded)}"})


@router.get("/api/files", response_model=None)
async def api_list_files(
    request: Request,
    path: str = "",
):
    """List files in the shared directory (or the Send-mode whitelist)."""
    storage = request.app.state.storage_manager

    session_id = await validate_session(request, storage)
    if not session_id:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    server_manager = request.app.state.server_manager
    send_files = server_manager.get_send_files()

    if send_files:
        if path:
            return JSONResponse({"error": "Invalid path"}, status_code=400)
        files = []
        for name, real in send_files.items():
            try:
                st = real.stat()
            except OSError:
                continue
            files.append(
                {
                    "name": name,
                    "path": name,
                    "size": st.st_size,
                    "modified": st.st_mtime,
                    "isDirectory": False,
                }
            )
        return files

    config = await storage.get_config()
    shared_dir = config.shared_dir
    shared_dir_resolved = shared_dir.resolve()

    target_dir = (shared_dir / path) if path else shared_dir
    resolved = target_dir.resolve()

    if not resolved.is_relative_to(shared_dir_resolved):
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
    """Download a file from the shared directory (or the Send-mode whitelist)."""
    storage = request.app.state.storage_manager
    server_manager = request.app.state.server_manager

    session_id = await validate_session(request, storage)
    if not session_id:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    # Send-mode whitelist: a single-segment name matching a registered file.
    if "/" not in filepath:
        send_files = server_manager.get_send_files()
        real = send_files.get(filepath)
        if real is not None:
            resolved = real.resolve()
            if resolved.is_file():
                sessions = await storage.get_sessions()
                session = sessions.get(session_id)
                await server_manager.notify_download(
                    resolved.name,
                    resolved.stat().st_size,
                    session.device if session else "Unknown",
                )
                return FileResponse(resolved, filename=resolved.name)

    config = await storage.get_config()
    shared_dir = config.shared_dir

    safe_path = Path(filepath)
    if safe_path.is_absolute() or ".." in safe_path.parts:
        return JSONResponse({"error": "Invalid path"}, status_code=400)

    file_path = shared_dir / safe_path
    resolved = file_path.resolve()

    if not resolved.is_relative_to(shared_dir.resolve()):
        return JSONResponse({"error": "File not found"}, status_code=404)

    if not file_path.exists():
        return JSONResponse({"error": "File not found"}, status_code=404)

    if not file_path.is_file():
        return JSONResponse({"error": "File not found"}, status_code=404)

    sessions = await storage.get_sessions()
    session = sessions.get(session_id)
    await server_manager.notify_download(
        file_path.name,
        file_path.stat().st_size,
        session.device if session else "Unknown",
    )

    return FileResponse(file_path, filename=file_path.name)
