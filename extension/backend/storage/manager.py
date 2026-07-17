"""Storage manager coordinating all JSON stores."""

import logging
from pathlib import Path

from shared.constants import (
    STORAGE_ACTIVITY,
    STORAGE_CLIENTS,
    STORAGE_CONFIG,
    STORAGE_SESSIONS,
)

from ..models.activity import ActivityData
from ..models.client import ClientsData
from ..models.config import Config, ServerStatus
from ..models.session import SessionsData
from .json_store import JSONStore

logger = logging.getLogger(__name__)


class StorageManager:
    """Manages all JSON data stores."""

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)

        self.config = JSONStore(data_dir / STORAGE_CONFIG, lambda: Config())
        self.sessions = JSONStore(data_dir / STORAGE_SESSIONS, lambda: SessionsData())
        self.clients = JSONStore(data_dir / STORAGE_CLIENTS, lambda: ClientsData())
        self.activity = JSONStore(data_dir / STORAGE_ACTIVITY, lambda: ActivityData())

    async def get_config(self) -> Config:
        """Get current configuration."""
        data = await self.config.load()
        return Config(**data) if isinstance(data, dict) else Config()

    async def save_config(self, config: Config) -> None:
        """Save configuration."""
        await self.config.save(config.model_dump())

    async def get_sessions(self) -> SessionsData:
        """Get all sessions."""
        data = await self.sessions.load()
        return SessionsData(**data) if isinstance(data, dict) else SessionsData()

    async def get_clients(self) -> ClientsData:
        """Get all clients."""
        data = await self.clients.load()
        return ClientsData(**data) if isinstance(data, dict) else ClientsData()

    async def get_activity(self) -> ActivityData:
        """Get activity data."""
        data = await self.activity.load()
        return ActivityData(**data) if isinstance(data, dict) else ActivityData()

    async def get_status(self) -> ServerStatus:
        """Get current server status."""
        config = await self.get_config()
        clients = await self.get_clients()

        return ServerStatus(
            running=config.sharing_enabled,
            port=config.port if config.sharing_enabled else None,
            internal_port=config.internal_port if config.sharing_enabled else None,
            ws_port=config.ws_port if config.sharing_enabled else None,
            upload_dir=config.upload_dir if config.sharing_enabled else None,
            shared_dir=config.shared_dir if config.sharing_enabled else None,
            sharing_enabled=config.sharing_enabled,
            connected_clients=len(clients.connected),
            pending_clients=len(clients.pending),
        )

    async def clear_all_sessions(self) -> None:
        """Clear all approved sessions."""
        sessions_data = await self.get_sessions()
        sessions_data.clear()
        await self.sessions.save(sessions_data.model_dump())

    async def clear_all_clients(self) -> None:
        """Clear all pending and connected clients."""
        clients_data = await self.get_clients()
        clients_data.clear_pending()
        clients_data.clear_connected()
        await self.clients.save(clients_data.model_dump())

    async def disable_sharing(self) -> None:
        """Disable sharing and clear all sessions/clients."""
        config = await self.get_config()
        config.sharing_enabled = False
        await self.save_config(config)

        await self.clear_all_sessions()
        await self.clear_all_clients()

        logger.info("Sharing disabled, all sessions and clients cleared")
