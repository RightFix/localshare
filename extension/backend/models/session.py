"""Session models for LocalShare."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class Session(BaseModel):
    """An approved browser session."""

    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="Unique session identifier",
    )
    client_id: str = Field(default="", description="Associated client ID")
    device: str = Field(default="", description="Device/browser information")
    ip: str = Field(default="", description="Client IP address")
    approved_at: datetime = Field(
        default_factory=datetime.now,
        description="When the session was approved",
    )
    last_active: datetime = Field(
        default_factory=datetime.now,
        description="Last activity timestamp",
    )

    def update_activity(self) -> None:
        """Update the last active timestamp."""
        self.last_active = datetime.now()

    model_config = {"frozen": False}


class SessionsData(BaseModel):
    """Container for all sessions."""

    sessions: list[Session] = Field(
        default_factory=list,
        description="List of approved sessions",
    )

    def add(self, device: str, ip: str, client_id: str = "") -> Session:
        """Create and add a new session."""
        session = Session(device=device, ip=ip, client_id=client_id)
        self.sessions.append(session)
        return session

    def get(self, session_id: str) -> Session | None:
        """Get a session by ID."""
        for session in self.sessions:
            if session.id == session_id:
                return session
        return None

    def remove(self, session_id: str) -> bool:
        """Remove a session by ID. Returns True if found."""
        for i, session in enumerate(self.sessions):
            if session.id == session_id:
                self.sessions.pop(i)
                return True
        return False

    def clear(self) -> None:
        """Remove all sessions."""
        self.sessions.clear()
