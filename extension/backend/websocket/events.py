"""Event bus for push notifications from backend to WebSocket clients.

Provides a publish/subscribe mechanism so that server-side events
(client connected, file uploaded, etc.) can be pushed to the extension
and browser clients in real time.
"""

import asyncio
import logging
from collections.abc import Callable, Coroutine
from typing import Any

logger = logging.getLogger(__name__)

EventHandler = Callable[[str, dict[str, Any]], Coroutine[Any, Any, None]]


class EventBus:
    """Simple async publish/subscribe event bus.

    Any component can publish an event by name with a data payload.
    Subscribers receive all events and filter by name internally.
    """

    def __init__(self) -> None:
        self._subscribers: list[EventHandler] = []
        self._lock = asyncio.Lock()

    async def subscribe(self, handler: EventHandler) -> Callable[[], Coroutine[Any, Any, None]]:
        """Register a subscriber. Returns an unsubscribe callable."""
        async with self._lock:
            self._subscribers.append(handler)

        async def unsubscribe() -> None:
            async with self._lock:
                if handler in self._subscribers:
                    self._subscribers.remove(handler)

        return unsubscribe

    async def publish(self, event: str, data: dict[str, Any]) -> None:
        """Publish an event to all subscribers."""
        async with self._lock:
            subs = list(self._subscribers)

        for handler in subs:
            try:
                await handler(event, data)
            except Exception:
                logger.exception(f"EventBus handler failed for event: {event}")

    @property
    def subscriber_count(self) -> int:
        """Number of currently registered subscribers."""
        return len(self._subscribers)


event_bus = EventBus()
