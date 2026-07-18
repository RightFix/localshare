"""JSON storage layer with atomic writes and file locking."""

import asyncio
import json
import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any

import aiofiles

logger = logging.getLogger(__name__)


class JSONStore:
    """Thread-safe JSON file storage with atomic writes."""

    def __init__(self, file_path: Path, default_factory: Callable[[], Any]) -> None:
        self.file_path = file_path
        self.default_factory = default_factory
        self._lock = asyncio.Lock()

    async def load(self) -> Any:
        """Load data from JSON file. Creates default if file doesn't exist."""
        if not self.file_path.exists():
            return self.default_factory()

        async with self._lock:
            try:
                async with aiofiles.open(self.file_path, encoding="utf-8") as f:
                    content = await f.read()
                    if not content.strip():
                        return self.default_factory()
                    return json.loads(content)
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse {self.file_path}: {e}")
                return self.default_factory()
            except Exception as e:
                logger.error(f"Failed to load {self.file_path}: {e}")
                return self.default_factory()

    async def save(self, data: Any) -> None:
        """Save data to JSON file atomically."""
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = self.file_path.with_suffix(".tmp")

        async with self._lock:
            async with aiofiles.open(temp_path, "w", encoding="utf-8") as f:
                json_str = json.dumps(data, indent=2, default=str)
                await f.write(json_str)

            temp_path.replace(self.file_path)

    async def update(self, updater: Callable[[Any], Any]) -> Any:
        """Load, update, and save data atomically."""
        data = await self.load()
        updated = updater(data)
        await self.save(updated)
        return updated
