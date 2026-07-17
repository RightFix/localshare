"""Tests for JSON storage layer."""

import json
from pathlib import Path

import pytest

from backend.storage.json_store import JSONStore


class TestJSONStore:
    @pytest.mark.asyncio
    async def test_load_returns_default_when_file_missing(self, temp_data_dir):
        store = JSONStore(temp_data_dir / "missing.json", lambda: {"key": "default"})
        data = await store.load()
        assert data == {"key": "default"}

    @pytest.mark.asyncio
    async def test_save_and_load(self, temp_data_dir):
        store = JSONStore(temp_data_dir / "test.json", lambda: {})
        await store.save({"name": "test", "value": 42})
        data = await store.load()
        assert data == {"name": "test", "value": 42}

    @pytest.mark.asyncio
    async def test_load_corrupted_file_returns_default(self, temp_data_dir):
        path = temp_data_dir / "corrupt.json"
        path.write_text("{invalid json")
        store = JSONStore(path, lambda: {"fallback": True})
        data = await store.load()
        assert data == {"fallback": True}

    @pytest.mark.asyncio
    async def test_atomic_write_creates_valid_json(self, temp_data_dir):
        store = JSONStore(temp_data_dir / "atomic.json", lambda: {})
        await store.save({"nested": {"list": [1, 2, 3]}})
        content = pathlib_read_text(temp_data_dir / "atomic.json")
        parsed = json.loads(content)
        assert parsed["nested"]["list"] == [1, 2, 3]

    @pytest.mark.asyncio
    async def test_multiple_saves_overwrite(self, temp_data_dir):
        store = JSONStore(temp_data_dir / "overwrite.json", lambda: {})
        await store.save({"version": 1})
        await store.save({"version": 2})
        data = await store.load()
        assert data["version"] == 2

    @pytest.mark.asyncio
    async def test_update_modifies_data(self, temp_data_dir):
        store = JSONStore(temp_data_dir / "update.json", lambda: {"count": 0})

        def increment(data):
            data["count"] += 1
            return data

        await store.update(increment)
        data = await store.load()
        assert data["count"] == 1

    @pytest.mark.asyncio
    async def test_empty_string_returns_default(self, temp_data_dir):
        path = temp_data_dir / "empty.json"
        path.write_text("   ")
        store = JSONStore(path, lambda: {"empty": True})
        data = await store.load()
        assert data == {"empty": True}


def pathlib_read_text(p: Path) -> str:
    """Helper to read text from a Path."""
    with open(str(p)) as f:
        return f.read()
