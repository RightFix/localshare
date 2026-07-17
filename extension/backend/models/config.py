"""Configuration models for LocalShare."""

import uuid
from pathlib import Path

from pydantic import BaseModel, Field, field_validator


class Config(BaseModel):
    """Main configuration for LocalShare."""

    upload_dir: Path = Field(
        default=Path.home() / "Downloads",
        description="Directory where uploaded files are stored",
    )
    shared_dir: Path = Field(
        default=Path.home() / "Public" / "LocalShare",
        description="Directory that visitors can browse and download",
    )
    port: int = Field(
        default=8080,
        ge=1024,
        le=65535,
        description="Main HTTP server port for browser access",
    )
    internal_port: int = Field(
        default=8765,
        ge=1024,
        le=65535,
        description="Internal API port for extension communication",
    )
    ws_port: int = Field(
        default=8766,
        ge=1024,
        le=65535,
        description="WebSocket port for real-time events",
    )
    sharing_enabled: bool = Field(
        default=False,
        description="Whether sharing is currently active",
    )
    server_secret: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="Secret token for internal API authentication",
    )
    auto_start: bool = Field(
        default=False,
        description="Automatically start sharing when extension loads",
    )
    notify_on_upload: bool = Field(
        default=True,
        description="Show desktop notification when files are uploaded",
    )
    notify_on_download: bool = Field(
        default=True,
        description="Show desktop notification when files are downloaded",
    )

    @field_validator("upload_dir", "shared_dir", mode="before")
    @classmethod
    def expand_path(cls, v: str | Path) -> Path:
        """Expand user paths to absolute paths."""
        if isinstance(v, str):
            v = Path(v)
        return v.expanduser().resolve()

    @field_validator("server_secret", mode="before")
    @classmethod
    def generate_secret(cls, v: str | None) -> str:
        """Generate a new secret if not provided."""
        return v or str(uuid.uuid4())

    model_config = {"frozen": False}


class ServerStatus(BaseModel):
    """Current server status."""

    running: bool = Field(description="Whether the server is running")
    port: int | None = Field(default=None, description="Main server port")
    internal_port: int | None = Field(default=None, description="Internal API port")
    ws_port: int | None = Field(default=None, description="WebSocket port")
    upload_dir: Path | None = Field(default=None, description="Upload directory")
    shared_dir: Path | None = Field(default=None, description="Shared directory")
    sharing_enabled: bool = Field(default=False, description="Whether sharing is active")
    connected_clients: int = Field(default=0, description="Number of connected clients")
    pending_clients: int = Field(default=0, description="Number of pending clients")
