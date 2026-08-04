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

    async def _read(self) -> Any:
        """Read data from the JSON file (caller must hold the lock)."""
        if not self.file_path.exists():
            return self.default_factory()

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

    async def _write(self, data: Any) -> None:
        """Write data to the JSON file atomically (caller must hold the lock)."""
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = self.file_path.with_suffix(".tmp")

        async with aiofiles.open(temp_path, "w", encoding="utf-8") as f:
            json_str = json.dumps(data, indent=2, default=str)
            await f.write(json_str)

        temp_path.replace(self.file_path)

    async def load(self) -> Any:
        """Load data from JSON file. Creates default if file doesn't exist."""
        async with self._lock:
            return await self._read()

    async def save(self, data: Any) -> None:
        """Save data to JSON file atomically."""
        async with self._lock:
            await self._write(data)

    async def update(self, updater: Callable[[Any], Any]) -> Any:
        """Atomically load, transform via updater, and save.

        The updater receives the loaded value and returns the value to persist.
        The lock is held across the whole read-modify-write so concurrent
        writers cannot lose each other's updates.
        """
        async with self._lock:
            data = await self._read()
            new_data = updater(data)
            await self._write(new_data)
            return new_data
