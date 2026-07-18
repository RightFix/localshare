"""FastAPI dependency injection for session authentication and CSRF.

Provides reusable Depends() callables that route handlers can use
to require an authenticated session with CSRF protection.
"""

from fastapi import Depends, HTTPException, Request

from backend.auth.session import get_session_id
from backend.storage.manager import StorageManager


def get_storage(request: Request) -> StorageManager:
    """Retrieve the StorageManager from app state."""
    return request.app.state.storage_manager


async def require_session(
    request: Request,
    storage: StorageManager = Depends(get_storage),
) -> str:
    """Require a valid session. Returns session_id or raises 401."""
    session_id = get_session_id(request)
    if not session_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    sessions_data = await storage.get_sessions()
    session = sessions_data.get(session_id)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    session.update_activity()
    await storage.sessions.save(sessions_data.model_dump())
    return session_id


def verify_csrf(request: Request) -> None:
    """Verify CSRF protection on mutating requests.

    The X-Session-Token header must match the session_id cookie.
    Browsers auto-send cookies on cross-origin requests but not
    custom headers, so this prevents CSRF attacks.
    Raises 403 if the check fails.
    """
    cookie_sid = request.cookies.get("session_id")
    header_sid = request.headers.get("X-Session-Token")

    if not cookie_sid or not header_sid or cookie_sid != header_sid:
        raise HTTPException(status_code=403, detail="CSRF check failed")
