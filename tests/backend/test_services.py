"""Tests for ServerManager business logic."""

from pathlib import Path

import pytest


class TestServerManager:
    @pytest.mark.asyncio
    async def test_add_pending_client(self, server_manager):
        client_id = await server_manager.add_pending_client("Chrome", "10.0.0.1")
        clients = await server_manager.storage.get_clients()
        assert len(clients.pending) == 1
        assert clients.pending[0].id == client_id
        assert clients.pending[0].device == "Chrome"
        assert clients.pending[0].ip == "10.0.0.1"

    @pytest.mark.asyncio
    async def test_approve_client(self, server_manager):
        client_id = await server_manager.add_pending_client("Firefox", "10.0.0.2")
        session = await server_manager.approve_client(client_id)

        assert session is not None
        assert session.device == "Firefox"
        assert session.ip == "10.0.0.2"

        clients = await server_manager.storage.get_clients()
        assert len(clients.pending) == 0
        assert len(clients.connected) == 1

        sessions = await server_manager.storage.get_sessions()
        assert len(sessions.sessions) == 1
        assert sessions.sessions[0].id == session.id

    @pytest.mark.asyncio
    async def test_reject_client(self, server_manager):
        client_id = await server_manager.add_pending_client("Safari", "10.0.0.3")
        success = await server_manager.reject_client(client_id)

        assert success is True
        clients = await server_manager.storage.get_clients()
        assert len(clients.pending) == 0
        assert len(clients.connected) == 0

    @pytest.mark.asyncio
    async def test_reject_nonexistent(self, server_manager):
        success = await server_manager.reject_client("no-such-id")
        assert success is False

    @pytest.mark.asyncio
    async def test_approve_nonexistent(self, server_manager):
        session = await server_manager.approve_client("no-such-id")
        assert session is None

    @pytest.mark.asyncio
    async def test_disconnect_client(self, server_manager):
        client_id = await server_manager.add_pending_client("Edge", "10.0.0.4")
        session = await server_manager.approve_client(client_id)

        success = await server_manager.disconnect_client(session.id)
        assert success is True

        clients = await server_manager.storage.get_clients()
        assert len(clients.connected) == 0

        sessions = await server_manager.storage.get_sessions()
        assert len(sessions.sessions) == 0

    @pytest.mark.asyncio
    async def test_disconnect_nonexistent(self, server_manager):
        success = await server_manager.disconnect_client("no-such-id")
        assert success is False

    @pytest.mark.asyncio
    async def test_notify_upload(self, server_manager):
        await server_manager.notify_upload("photo.jpg", 1024, "Chrome")
        activity = await server_manager.storage.get_activity()
        assert len(activity.uploads) == 1
        assert activity.uploads[0].filename == "photo.jpg"
        assert activity.uploads[0].size == 1024
        assert activity.uploads[0].from_device == "Chrome"

    @pytest.mark.asyncio
    async def test_notify_download(self, server_manager):
        await server_manager.notify_download("doc.pdf", 2048, "Firefox")
        activity = await server_manager.storage.get_activity()
        assert len(activity.downloads) == 1
        assert activity.downloads[0].filename == "doc.pdf"
        assert activity.downloads[0].size == 2048
        assert activity.downloads[0].to_device == "Firefox"

    @pytest.mark.asyncio
    async def test_start_enables_sharing(self, server_manager):
        config = await server_manager.storage.get_config()
        assert config.sharing_enabled is False

        await server_manager.start(8080, 8765, Path("/tmp/up"), Path("/tmp/sh"))

        config = await server_manager.storage.get_config()
        assert config.sharing_enabled is True
        assert config.port == 8080

    @pytest.mark.asyncio
    async def test_stop_disables_sharing(self, server_manager):
        await server_manager.start(8080, 8765, Path("/tmp/up"), Path("/tmp/sh"))
        await server_manager.stop()

        config = await server_manager.storage.get_config()
        assert config.sharing_enabled is False

    @pytest.mark.asyncio
    async def test_stop_fires_callback(self, server_manager):
        events = []

        async def capture(data):
            events.append(data)

        server_manager.set_ws_callback(capture)
        await server_manager.start(8080, 8765, Path("/tmp/up"), Path("/tmp/sh"))
        await server_manager.stop()

        assert len(events) == 1
        assert events[0]["action"] == "sharing_stopped"
