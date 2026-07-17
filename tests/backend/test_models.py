"""Tests for Pydantic models."""

from pathlib import Path

import pytest

from backend.models.activity import ActivityData
from backend.models.client import Client, ClientsData
from backend.models.config import Config, ServerStatus
from backend.models.session import Session, SessionsData


class TestConfig:
    def test_default_config_creates(self):
        config = Config()
        assert config.port == 8080
        assert config.internal_port == 8765
        assert config.ws_port == 8766
        assert config.sharing_enabled is False
        assert config.notify_on_upload is True
        assert config.notify_on_download is True
        assert config.server_secret is not None
        assert config.upload_dir == Path.home() / "Downloads"
        assert config.shared_dir == Path.home() / "Public" / "LocalShare"

    def test_server_secret_generated(self):
        config = Config()
        assert len(config.server_secret) > 10

    def test_port_validation(self):
        with pytest.raises(ValueError):
            Config(port=80)  # below 1024

        with pytest.raises(ValueError):
            Config(port=70000)  # above 65535

    def test_path_expansion(self):
        config = Config(upload_dir=Path("~/Downloads"))
        assert str(config.upload_dir).startswith("/home/")


class TestServerStatus:
    def test_default_status(self):
        status = ServerStatus(running=False, sharing_enabled=False)
        assert status.running is False
        assert status.port is None
        assert status.connected_clients == 0

    def test_active_status(self):
        status = ServerStatus(
            running=True,
            port=8080,
            internal_port=8765,
            ws_port=8766,
            upload_dir=Path("/tmp/upload"),
            shared_dir=Path("/tmp/share"),
            sharing_enabled=True,
            connected_clients=3,
            pending_clients=1,
        )
        assert status.running is True
        assert status.connected_clients == 3


class TestSession:
    def test_session_creation(self):
        session = Session(device="Chrome on Android", ip="192.168.1.35")
        assert session.id is not None
        assert session.device == "Chrome on Android"
        assert session.ip == "192.168.1.35"
        assert session.approved_at is not None

    def test_update_activity(self):
        session = Session()
        old = session.last_active
        session.update_activity()
        assert session.last_active >= old

    def test_session_id_is_unique(self):
        s1 = Session()
        s2 = Session()
        assert s1.id != s2.id


class TestSessionsData:
    def test_add_session(self):
        data = SessionsData()
        data.add("Firefox", "10.0.0.1")
        assert len(data.sessions) == 1
        assert data.sessions[0].device == "Firefox"

    def test_get_session(self):
        data = SessionsData()
        session = data.add("Edge", "10.0.0.2")
        assert data.get(session.id) is session
        assert data.get("nonexistent") is None

    def test_remove_session(self):
        data = SessionsData()
        s1 = data.add("A", "1")
        data.add("B", "2")
        assert data.remove(s1.id) is True
        assert len(data.sessions) == 1
        assert data.remove("nonexistent") is False

    def test_clear(self):
        data = SessionsData()
        data.add("A", "1")
        data.add("B", "2")
        data.clear()
        assert len(data.sessions) == 0


class TestClient:
    def test_client_creation(self):
        client = Client(device="Safari", ip="10.0.0.5")
        assert client.device == "Safari"
        assert client.user_agent == ""


class TestClientsData:
    def test_add_pending(self):
        data = ClientsData()
        data.add_pending("Chrome", "10.0.0.1", "Mozilla/5.0")
        assert len(data.pending) == 1
        assert data.pending[0].user_agent == "Mozilla/5.0"

    def test_approve_client(self):
        data = ClientsData()
        client = data.add_pending("Chrome", "10.0.0.1")
        approved = data.approve(client.id)
        assert approved is not None
        assert len(data.pending) == 0
        assert len(data.connected) == 1

    def test_reject_client(self):
        data = ClientsData()
        client = data.add_pending("Chrome", "10.0.0.1")
        assert data.remove_pending(client.id) is True
        assert len(data.pending) == 0

    def test_clear_all(self):
        data = ClientsData()
        data.add_pending("A", "1")
        data.add_pending("B", "2")
        data.clear_pending()
        assert len(data.pending) == 0


class TestActivity:
    def test_add_upload(self):
        data = ActivityData()
        data.add_upload("test.txt", 1024, "Chrome")
        assert len(data.uploads) == 1
        assert data.uploads[0].filename == "test.txt"

    def test_add_download(self):
        data = ActivityData()
        data.add_download("photo.jpg", 2048, "Firefox")
        assert len(data.downloads) == 1
        assert data.downloads[0].filename == "photo.jpg"

    def test_recent_uploads(self):
        data = ActivityData()
        data.add_upload("file1.txt", 100)
        data.add_upload("file2.txt", 200)
        recent = data.get_recent_uploads(limit=1)
        assert len(recent) == 1
        assert recent[0].filename == "file2.txt"

    def test_clear(self):
        data = ActivityData()
        data.add_upload("test.txt", 100)
        data.add_download("test.txt", 100)
        data.clear()
        assert len(data.uploads) == 0
        assert len(data.downloads) == 0
