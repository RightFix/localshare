"""Integration tests for API endpoints."""

from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from backend.main import STATIC_DIR, app
from backend.services.manager import ServerManager
from backend.storage.manager import StorageManager


@pytest.fixture(autouse=True)
async def init_app_state(temp_data_dir):
    """Initialize app state for each test (replaces lifespan)."""
    app.state.storage_manager = StorageManager(temp_data_dir)
    app.state.server_manager = ServerManager(app.state.storage_manager)
    app.state.static_dir = STATIC_DIR

    cfg = await app.state.storage_manager.get_config()
    cfg.upload_dir = temp_data_dir / "uploads"
    cfg.shared_dir = temp_data_dir / "shared"
    cfg.upload_dir.mkdir(exist_ok=True)
    cfg.shared_dir.mkdir(exist_ok=True)
    await app.state.storage_manager.save_config(cfg)

    return app.state.storage_manager, app.state.server_manager


@pytest.fixture
def client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.fixture
def upload_dir(temp_data_dir):
    return temp_data_dir / "uploads"


@pytest.fixture
def shared_dir(temp_data_dir):
    return temp_data_dir / "shared"


async def _create_session(storage, server):
    """Create a pending client and approve it, returning the session ID."""
    client_id = await server.add_pending_client("TestBrowser", "10.0.0.1", "pytest")
    session = await server.approve_client(client_id)
    return session.id


class TestInternalAPI:
    @pytest.mark.asyncio
    async def test_status_endpoint(self, client):
        async with client as c:
            resp = await c.get("/internal/status")
            assert resp.status_code == 200
            data = resp.json()
            assert "running" in data

    @pytest.mark.asyncio
    async def test_config_endpoint(self, client):
        async with client as c:
            resp = await c.get("/internal/config")
            assert resp.status_code == 200
            data = resp.json()
            assert "port" in data

    @pytest.mark.asyncio
    async def test_update_config(self, client):
        async with client as c:
            resp = await c.put("/internal/config", json={"port": 9090})
            assert resp.status_code == 200
            resp = await c.get("/internal/config")
            assert resp.json()["port"] == 9090

    @pytest.mark.asyncio
    async def test_ips_endpoint(self, client):
        async with client as c:
            resp = await c.get("/internal/ips")
            assert resp.status_code == 200
            data = resp.json()
            assert "ips" in data

    @pytest.mark.asyncio
    async def test_start_stop(self, client):
        async with client as c:
            resp = await c.post(
                "/internal/start",
                json={"port": 8080, "internal_port": 8765, "ws_port": 8766},
            )
            assert resp.status_code == 200
            assert resp.json()["status"] == "success"

            resp = await c.get("/internal/status")
            assert resp.json()["sharing_enabled"] is True

            resp = await c.post("/internal/stop")
            assert resp.status_code == 200

            resp = await c.get("/internal/status")
            assert resp.json()["sharing_enabled"] is False


class TestBrowserAPI:
    @pytest.mark.asyncio
    async def test_root_serves_html(self, client):
        async with client as c:
            resp = await c.get("/")
            assert resp.status_code == 200
            assert "text/html" in resp.headers["content-type"]

    @pytest.mark.asyncio
    async def test_status_pending_when_no_session(self, client):
        async with client as c:
            resp = await c.get("/api/status")
            assert resp.status_code == 200
            assert resp.json()["status"] == "pending"

    @pytest.mark.asyncio
    async def test_upload_requires_auth(self, client):
        async with client as c:
            resp = await c.post("/api/upload")
            assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_files_requires_auth(self, client):
        async with client as c:
            resp = await c.get("/api/files")
            assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_download_requires_auth(self, client):
        async with client as c:
            resp = await c.get("/api/files/test.txt")
            assert resp.status_code == 401


class TestStaticFiles:
    @pytest.mark.asyncio
    async def test_style_css(self, client):
        async with client as c:
            resp = await c.get("/style.css")
            assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_app_js(self, client):
        async with client as c:
            resp = await c.get("/app.js")
            assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_index_html_not_found(self, client):
        async with client as c:
            resp = await c.get("/index.html")
            assert resp.status_code == 404


class TestFileOperations:
    @pytest.fixture
    async def session_client(self, client):
        storage = app.state.storage_manager
        server = app.state.server_manager
        session_id = await _create_session(storage, server)
        client.cookies["session_id"] = session_id
        client.headers["X-Session-Token"] = session_id
        return client

    @pytest.mark.asyncio
    async def test_upload_file(self, session_client, upload_dir):
        async with session_client as c:
            resp = await c.post(
                "/api/upload",
                files={"file": ("hello.txt", b"Hello World")},
            )
            assert resp.status_code == 200
            assert (upload_dir / "hello.txt").exists()
            assert (upload_dir / "hello.txt").read_bytes() == b"Hello World"

    @pytest.mark.asyncio
    async def test_upload_duplicate_filename(self, session_client, upload_dir):
        (upload_dir / "test.txt").write_bytes(b"original")

        async with session_client as c:
            resp = await c.post(
                "/api/upload",
                files={"file": ("test.txt", b"duplicate")},
            )
            assert resp.status_code == 200
            assert (upload_dir / "test_1.txt").exists()
            assert (upload_dir / "test_1.txt").read_bytes() == b"duplicate"

    @pytest.mark.asyncio
    async def test_list_files(self, session_client, shared_dir):
        (shared_dir / "readme.txt").write_text("Hello")
        (shared_dir / "sub").mkdir()
        (shared_dir / "sub" / "nested.txt").write_text("Nested")

        async with session_client as c:
            resp = await c.get("/api/files")
            assert resp.status_code == 200
            data = resp.json()
            names = [f["name"] for f in data]
            assert "readme.txt" in names
            assert "sub" in names

    @pytest.mark.asyncio
    async def test_download_file(self, session_client, shared_dir):
        (shared_dir / "download.txt").write_text("Download content")

        async with session_client as c:
            resp = await c.get("/api/files/download.txt")
            assert resp.status_code == 200
            assert resp.text == "Download content"

    @pytest.mark.asyncio
    async def test_upload_rejects_csrf_mismatch(self, client, upload_dir):
        """Upload with valid session cookie but missing X-Session-Token header fails."""
        storage = app.state.storage_manager
        server = app.state.server_manager
        session_id = await _create_session(storage, server)

        async with client as c:
            c.cookies["session_id"] = session_id
            resp = await c.post(
                "/api/upload",
                files={"file": ("test.txt", b"data")},
            )
            assert resp.status_code == 403
            assert "CSRF" in resp.json()["error"]

    @pytest.mark.asyncio
    async def test_download_invalid_path_rejected(self, session_client, shared_dir):
        (shared_dir / "subdir").mkdir()
        (shared_dir / "subdir" / "file.txt").write_text("safe")

        async with session_client as c:
            resp = await c.get(
                "/api/files/subdir%2F..%2F..%2Fetc%2Fpasswd",
            )
            assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_list_files_shows_symlinked_dir(self, session_client, shared_dir, temp_data_dir):
        outside_dir = temp_data_dir / "outside"
        outside_dir.mkdir()
        (outside_dir / "external.txt").write_text("outside file")

        symlink = shared_dir / "mylink"
        symlink.symlink_to(outside_dir, target_is_directory=True)

        async with session_client as c:
            resp = await c.get("/api/files", params={"path": "mylink"})
            assert resp.status_code == 200
            names = [f["name"] for f in resp.json()]
            assert "external.txt" in names

    @pytest.mark.asyncio
    async def test_download_symlinked_file_outside_shared_dir(
        self, session_client, shared_dir, temp_data_dir
    ):
        outside_file = temp_data_dir / "secret.txt"
        outside_file.write_text("outside content")

        symlink = shared_dir / "link_to_secret.txt"
        symlink.symlink_to(outside_file)

        async with session_client as c:
            resp = await c.get(f"/api/files/link_to_secret.txt")
            assert resp.status_code == 200
            assert resp.text == "outside content"
