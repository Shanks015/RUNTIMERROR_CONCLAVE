import jwt as pyjwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from ..config import get_settings
from ..database import SessionLocal
from ..models import EmergencyTrip, SignalPlan, User
from ..services import mock_route
from ..services.ws import manager

router = APIRouter(tags=["ws"])
settings = get_settings()


async def _authenticate(token: str) -> User | None:
    try:
        payload = pyjwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
    except pyjwt.PyJWTError:
        return None
    if payload.get("type") != "access":
        return None
    async with SessionLocal() as db:
        user = (
            await db.execute(select(User).where(User.id == payload["sub"]))
        ).scalar_one_or_none()
        if user is None or not user.is_active:
            return None
        if user.token_version != payload.get("tv"):
            return None
        return user


@router.websocket("/ws/emergency-trips/{trip_id}")
async def trip_socket(websocket: WebSocket, trip_id: str, token: str = ""):
    user = await _authenticate(token)
    if user is None:
        await websocket.close(code=4401, reason="Invalid or expired token")
        return

    async with SessionLocal() as db:
        trip = await db.get(EmergencyTrip, trip_id)
        if trip is None:
            await websocket.close(code=4404, reason="Trip not found")
            return
        if user.role == "emergency_driver" and trip.driver_id != user.id:
            await websocket.close(code=4403, reason="Not your trip")
            return

        signals = (
            await db.execute(select(SignalPlan).where(SignalPlan.trip_id == trip_id))
        ).scalars().all()

        await manager.connect(trip_id, websocket)
        # Opening snapshot so a fresh client doesn't wait for the next event.
        await websocket.send_json(
            {
                "type": "snapshot",
                "trip_id": trip_id,
                "status": trip.status,
                "route_version": trip.route_version,
                "destination": trip.destination_name,
                "priority": trip.priority,
                "message": "Connected to control center feed.",
                "priority_junctions": mock_route.junctions_payload(signals),
            }
        )
        try:
            while True:
                # The driver app mainly listens; any inbound frame is treated as a ping.
                data = await websocket.receive_text()
                if data == "ping":
                    await websocket.send_json({"type": "pong"})
        except WebSocketDisconnect:
            pass
        finally:
            await manager.disconnect(trip_id, websocket)
