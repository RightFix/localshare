"""Client models for LocalShare."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class Client(BaseModel):
    """A connected or pending client."""

    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="Unique client identifier",
    )
    device: str = Field(default="", description="Device/browser information")
    ip: str = Field(default="", description="Client IP address")
    user_agent: str = Field(default="", description="HTTP user agent")
    connected_at: datetime = Field(
        default_factory=datetime.now,
        description="When the client connected",
    )

    model_config = {"frozen": False}


class ClientsData(BaseModel):
    """Container for pending and connected clients."""

    pending: list[Client] = Field(
        default_factory=list,
        description="Clients waiting for approval",
    )
    connected: list[Client] = Field(
        default_factory=list,
        description="Approved and connected clients",
    )

    def add_pending(self, device: str, ip: str, user_agent: str = "") -> Client:
        """Add a new pending client."""
        client = Client(device=device, ip=ip, user_agent=user_agent)
        self.pending.append(client)
        return client

    def get_pending(self, client_id: str) -> Client | None:
        """Get a pending client by ID."""
        for client in self.pending:
            if client.id == client_id:
                return client
        return None

    def remove_pending(self, client_id: str) -> bool:
        """Remove a pending client. Returns True if found."""
        for i, client in enumerate(self.pending):
            if client.id == client_id:
                self.pending.pop(i)
                return True
        return False

    def approve(self, client_id: str) -> Client | None:
        """Approve a pending client, moving to connected."""
        client = self.get_pending(client_id)
        if client:
            self.remove_pending(client_id)
            self.connected.append(client)
            return client
        return None

    def get_connected(self, client_id: str) -> Client | None:
        """Get a connected client by ID."""
        for client in self.connected:
            if client.id == client_id:
                return client
        return None

    def remove_connected(self, client_id: str) -> bool:
        """Remove a connected client. Returns True if found."""
        for i, client in enumerate(self.connected):
            if client.id == client_id:
                self.connected.pop(i)
                return True
        return False

    def clear_connected(self) -> None:
        """Remove all connected clients."""
        self.connected.clear()

    def clear_pending(self) -> None:
        """Remove all pending clients."""
        self.pending.clear()
