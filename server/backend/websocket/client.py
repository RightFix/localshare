"""WebSocket handler for browser clients.

Handles the connection approval handshake with real-time push:
1. Browser connects and sends device info
2. Server creates a pending client
3. Server sends back pending status
4. Server subscribes to EventBus for approval/rejection events
5. On approval: server pushes session token through WebSocket
6. On rejection: server pushes rejection notice through WebSocket
"""

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from shared.constants import (
    ACTION_CLIENT_APPROVED,
    ACTION_CLIENT_REJECTED,
    EVENT_CLIENT,
    WS_ACTION_APPROVED,
    WS_ACTION_PENDING,
    WS_ACTION_REJECTED,
    WS_BROWSER,
)

from backend.websocket.events import event_bus

logger = logging.getLogger(__name__)

router = APIRouter()


@router.websocket(WS_BROWSER)
async def websocket_client(websocket: WebSocket) -> None:
    """WebSocket endpoint for browser client approval handshake."""
    await websocket.accept()

    try:
        data = await websocket.receive_json()
        device = data.get("device", "Unknown Device")
        ip = data.get("ip", websocket.client.host if websocket.client else "Unknown")
        user_agent = data.get("user_agent", "")

        server_manager = websocket.app.state.server_manager
        client_id = await server_manager.add_pending_client(device, ip, user_agent)

        await websocket.send_json(
            {
                "action": WS_ACTION_PENDING,
                "message": "Waiting for approval...",
                "client_id": client_id,
            }
        )

        async def handle_event(event: str, event_data: dict) -> None:
            if event_data.get("client_id") != client_id:
                return
            try:
                if event == EVENT_CLIENT and event_data.get("action") == ACTION_CLIENT_APPROVED:
                    await websocket.send_json(
                        {
                            "action": WS_ACTION_APPROVED,
                            "token": event_data.get("session_id", ""),
                        }
                    )
                elif event == EVENT_CLIENT and event_data.get("action") == ACTION_CLIENT_REJECTED:
                    await websocket.send_json({"action": WS_ACTION_REJECTED})
            except Exception:
                pass

        unsub = await event_bus.subscribe(handle_event)

        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            await unsub()

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
