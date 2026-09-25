"""Mock control-center handshake that plays out after a trip request:

route_calculating -> route approved + corridor preparing -> corridor active.

Replace with real operator/route-agent events when the central system is wired in.
"""

import asyncio

from sqlalchemy import select

from ..database import SessionLocal
from ..models import EmergencyTrip
from .ws import manager


async def _set_status(trip_id: str, status: str) -> None:
    try:
        async with SessionLocal() as db:
            trip = (
                await db.execute(select(EmergencyTrip).where(EmergencyTrip.id == trip_id))
            ).scalar_one_or_none()
            if trip and trip.status not in ("completed", "cancelled"):
                trip.status = status
                await db.commit()
    except Exception:
        # The live feed must not die because a status write failed.
        pass


async def approve_route_later(trip_id: str) -> None:
    try:
        await asyncio.sleep(2)
        await _set_status(trip_id, "route_approved")
        await manager.broadcast(
            trip_id,
            {
                "type": "route_update",
                "trip_id": trip_id,
                "route_version": 1,
                "message": "Route approved. Green corridor preparation started.",
                "eta_seconds": None,
            },
        )
        await asyncio.sleep(3)
        await _set_status(trip_id, "corridor_preparing")
        await manager.broadcast(
            trip_id,
            {
                "type": "status",
                "trip_id": trip_id,
                "status": "corridor_preparing",
                "message": "Green corridor preparing. Signal agents scheduling priority junctions.",
            },
        )
        await asyncio.sleep(4)
        await _set_status(trip_id, "corridor_active")
        await manager.broadcast(
            trip_id,
            {
                "type": "status",
                "trip_id": trip_id,
                "status": "corridor_active",
                "message": "Green corridor active on the approved route.",
            },
        )
    except asyncio.CancelledError:
        pass
