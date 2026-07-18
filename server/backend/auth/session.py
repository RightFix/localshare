"""Session token management for LocalShare.

Provides helpers for creating, validating, and managing browser session tokens.
Sessions are stored in the JSON storage layer and accessed via cookies or headers.
"""

import logging
from uuid import uuid4

from fastapi import Request, Response

from backend.storage.manager import StorageManager

logger = logging.getLogger(__name__)


def create_session_token() -> str:
    """Generate a new unique session token."""
    return str(uuid4())


def set_session_cookie(response: Response, token: str) -> None:
    """Set an HttpOnly session cookie on the response.

    Uses HttpOnly to prevent JavaScript access (XSS protection).
    Secure is False because this is a LAN-only service.
    SameSite=Lax provides CSRF protection for top-level navigations.
    """
    response.set_cookie(
        key="session_id",
        value=token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=604800,
    )


def get_session_id(request: Request) -> str | None:
    """Extract session ID from cookie or X-Session-Token header."""
    session_id = request.cookies.get("session_id")
    if not session_id:
        session_id = request.headers.get("X-Session-Token")
    return session_id


async def validate_session(request: Request, storage: StorageManager) -> str | None:
    """Validate a session token and return the session ID if valid."""
    session_id = get_session_id(request)
    if not session_id:
        return None

    sessions_data = await storage.get_sessions()
    session = sessions_data.get(session_id)
    if not session:
        return None

    session.update_activity()
    await storage.sessions.save(sessions_data.model_dump())
    return session_id
