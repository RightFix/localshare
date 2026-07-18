"""WebSocket endpoint for GNOME Shell extension push events.

The extension connects here to receive real-time updates instead of
polling HTTP endpoints every 3 seconds.

Events pushed:
- client_connected: new pending client
- client_approved: client was approved, session created
- client_rejected: client was rejected
- client_disconnected: session ended
- upload_completed: file upload finished
- download_completed: file download finished
"""

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from shared.constants import WS_EXTENSION

from backend.websocket.events import event_bus

logger = logging.getLogger(__name__)

router = APIRouter()


@router.websocket(WS_EXTENSION)
async def extension_events(websocket: WebSocket) -> None:
    """WebSocket endpoint that pushes all server events to the extension."""
    await websocket.accept()

    async def handle_event(event: str, event_data: dict) -> None:
        try:
            payload = {"event": event, "data": event_data}
            await websocket.send_json(payload)
        except Exception:
            pass

    unsub = await event_bus.subscribe(handle_event)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"Extension WS error: {e}")
    finally:
        await unsub()
        try:
            await websocket.close()
        except Exception:
            pass
