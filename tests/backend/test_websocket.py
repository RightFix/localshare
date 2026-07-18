"""Tests for WebSocket endpoints."""

import pytest
from backend.main import app
from backend.services.manager import ServerManager
from backend.storage.manager import StorageManager
from backend.websocket.events import event_bus
from starlette.testclient import TestClient


@pytest.fixture
def ws_client(temp_data_dir):
    """Initialize app state with event_bus wiring and return a TestClient."""
    app.state.storage_manager = StorageManager(temp_data_dir)
    app.state.server_manager = ServerManager(app.state.storage_manager)
    app.state.server_manager.set_ws_callback(lambda data: event_bus.publish("client", data))
    app.state.server_manager.set_upload_callback(lambda data: event_bus.publish("file", data))
    app.state.static_dir = temp_data_dir.parent
    return TestClient(app)


class TestBrowserWebSocket:
    def test_connect_sends_pending(self, ws_client):
        with ws_client.websocket_connect("/ws/client") as ws:
            ws.send_json({"device": "TestPhone", "ip": "10.0.0.1"})
            data = ws.receive_json()
            assert data["action"] == "pending"
            assert "client_id" in data

    def test_disconnect_cleanup(self, ws_client, temp_data_dir):
        with ws_client.websocket_connect("/ws/client") as ws:
            ws.send_json({"device": "TestPhone", "ip": "10.0.0.1"})
            data = ws.receive_json()
            client_id = data["client_id"]
            import json

            clients_path = temp_data_dir / "clients.json"
            clients_data = json.loads(clients_path.read_text())
            assert clients_data["pending"][0]["id"] == client_id

    def test_multiple_connections(self, ws_client):
        with ws_client.websocket_connect("/ws/client") as ws1:
            ws1.send_json({"device": "Phone1", "ip": "10.0.0.1"})
            data1 = ws1.receive_json()

            with ws_client.websocket_connect("/ws/client") as ws2:
                ws2.send_json({"device": "Phone2", "ip": "10.0.0.2"})
                data2 = ws2.receive_json()

                assert data1["client_id"] != data2["client_id"]


class TestExtensionWebSocket:
    def test_extension_receives_client_connected(self, ws_client):
        """Extension WS receives events when a browser client connects."""
        with ws_client.websocket_connect("/internal/ws/events") as ext_ws:
            with ws_client.websocket_connect("/ws/client") as browser_ws:
                browser_ws.send_json({"device": "Phone", "ip": "10.0.0.1"})
                browser_ws.receive_json()  # consume "pending" response

                event = ext_ws.receive_json()
                assert event["event"] == "client"
                assert event["data"]["action"] == "client_connected"
                assert event["data"]["device"] == "Phone"
