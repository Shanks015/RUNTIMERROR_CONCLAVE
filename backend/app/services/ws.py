"""WebSocket connection manager: one group per trip, plus control-center listeners."""

import asyncio
import json
from datetime import datetime, timezone

from fastapi import WebSocket


class TripConnectionManager:
    def __init__(self) -> None:
        # trip_id -> set of websockets (driver app + dashboard listeners)
        self._connections: dict[str, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, trip_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.setdefault(trip_id, set()).add(websocket)

    async def disconnect(self, trip_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            conns = self._connections.get(trip_id)
            if conns:
                conns.discard(websocket)
                if not conns:
                    self._connections.pop(trip_id, None)

    async def broadcast(self, trip_id: str, message: dict) -> None:
        """Best-effort broadcast; dead sockets are pruned, never raised."""
        message.setdefault("sent_at", datetime.now(timezone.utc).isoformat())
        payload = json.dumps(message, default=str)
        async with self._lock:
            conns = list(self._connections.get(trip_id, set()))
        dead: list[WebSocket] = []
        for ws in conns:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.disconnect(trip_id, ws)

    def active_trips(self) -> list[str]:
        return list(self._connections.keys())


manager = TripConnectionManager()
