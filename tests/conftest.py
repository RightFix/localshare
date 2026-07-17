"""Shared test fixtures for LocalShare."""

import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "extension"))
sys.path.insert(0, str(Path(__file__).parent.parent))  # for shared/constants.py


@pytest.fixture(scope="function")
def temp_data_dir(tmpdir: Path) -> Path:
    """Create a temporary data directory for testing."""
    d = Path(str(tmpdir)) / "data"
    d.mkdir(parents=True, exist_ok=True)
    return d


@pytest.fixture(scope="function")
def storage_manager(temp_data_dir: Path):
    """Create a StorageManager with temp data directory."""
    from backend.storage.manager import StorageManager

    return StorageManager(temp_data_dir)


@pytest.fixture(scope="function")
def server_manager(storage_manager):
    """Create a ServerManager with temp storage."""
    from backend.services.manager import ServerManager

    return ServerManager(storage_manager)


@pytest.fixture(scope="module")
def event_loop():
    """Create event loop for async tests."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()
