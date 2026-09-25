"""Central traffic operator console: trips, route decisions, messages, override.

Same trip data the driver app sees, same WebSocket feed carrying decisions back.
Role-gated to `central_operator` — the operator never drives the vehicle, and the
mobile app never controls signals.
"""

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import (
    AuditLog,
    EmergencyTrip,
    EmergencyVehicle,
    IncidentReport,
    RoutePlan,
    SignalPlan,
    TripStatus,
    User,
)
from ..routers.trips import ACTIVE_STATUSES, _current_route, _latest_fix
from ..security import rate_limit, require_roles
from ..services import mock_route
from ..services.ws import manager

router = APIRouter(prefix="/api/operator", tags=["operator"])

CLOSED_STATUSES = {TripStatus.completed.value, TripStatus.cancelled.value}


class RouteDecision(BaseModel):
    action: str = Field(pattern="^(approve|override)$")
    reason: str = ""
    # Operator nudges the corridor estimate; 1.0 leaves the route agent's number alone.
    eta_scale: float = Field(default=1.0, ge=0.5, le=1.5)


class OperatorMessage(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    urgency: str = Field(default="info", pattern="^(info|urgent)$")


class CancelRequest(BaseModel):
    reason: str = "Cancelled by control center"


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def _trip_payload(db: AsyncSession, trip: EmergencyTrip) -> dict:
    fix = await _latest_fix(db, trip.id)
    route = await _current_route(db, trip.id)
    signals = (
        await db.execute(
            select(SignalPlan)
            .where(SignalPlan.trip_id == trip.id)
            .order_by(SignalPlan.arrival_time)
        )
    ).scalars().all()
    vehicle = await db.get(EmergencyVehicle, trip.vehicle_id)
    driver = await db.get(User, trip.driver_id)
    incidents = (
        await db.execute(
            select(func.count())
            .select_from(IncidentReport)
            .where(IncidentReport.trip_id == trip.id)
        )
    ).scalar_one()

    started = _aware(trip.started_at)
    elapsed = int((datetime.now(timezone.utc) - started).total_seconds()) if started else 0
    remaining_m = None
    if route and fix:
        fraction = mock_route.route_progress(
            json.loads(route.route_geometry), fix.latitude, fix.longitude
        )
        remaining_m = round(
            mock_route.distance_along_route(
                json.loads(route.route_geometry), fraction, route.distance_meters
            ),
            1,
        )

    return {
        "trip_id": trip.id,
        "status": trip.status,
        "completion_status": trip.completion_status,
        "vehicle_id": trip.vehicle_id,
        "vehicle_number": vehicle.vehicle_number if vehicle else None,
        "vehicle_type": trip.vehicle_type,
        "driver_id": trip.driver_id,
        "driver_name": driver.name if driver else None,
        "organization_id": trip.organization_id,
        "emergency_type": trip.emergency_type,
        "priority": trip.priority,
        "destination_name": trip.destination_name,
        "destination": {
            "latitude": trip.destination_latitude,
            "longitude": trip.destination_longitude,
        },
        "origin": {"latitude": trip.origin_latitude, "longitude": trip.origin_longitude},
        "route_version": trip.route_version,
        "started_at": started,
        "elapsed_seconds": elapsed,
        "distance_travelled_m": trip.distance_travelled_m,
        "remaining_m": remaining_m,
        "fix": None
        if fix is None
        else {
            "latitude": fix.latitude,
            "longitude": fix.longitude,
            "accuracy_m": fix.accuracy_m,
            "speed_kmph": fix.speed_kmph,
            "heading": fix.heading,
            "battery_percent": fix.battery_percent,
            "network_status": fix.network_status,
            "confidence": fix.confidence,
            "source": fix.source,
            "timestamp": _aware(fix.timestamp),
        },
        "route": None
        if route is None
        else {
            "version": route.version,
            "geometry": json.loads(route.route_geometry),
            "eta_seconds": route.estimated_time_seconds,
            "distance_meters": route.distance_meters,
            "confidence": route.confidence,
            "status": route.status,
            "message": route.message,
        },
        "priority_junctions": mock_route.junctions_payload(signals),
        "incident_count": int(incidents),
    }


# ---------- tracking ----------

@router.get("/trips")
async def operator_trips(
    scope: str = Query(default="active", pattern="^(active|all)$"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("central_operator", "vehicle_admin")),
):
    """Live board: every open trip with its latest fix, route and junction plan."""
    query = select(EmergencyTrip).order_by(EmergencyTrip.started_at.desc()).limit(50)
    if scope == "active":
        query = (
            select(EmergencyTrip)
            .where(EmergencyTrip.status.in_(ACTIVE_STATUSES))
            .order_by(EmergencyTrip.started_at.desc())
        )
    trips = (await db.execute(query)).scalars().all()
    # ponytail: one fix/route query per trip. Fine for a board of open trips;
    # switch to a windowed DISTINCT ON if the board ever pages past a few dozen.
    return {"trips": [await _trip_payload(db, t) for t in trips]}


@router.get("/trips/{trip_id}")
async def operator_trip(
    trip_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("central_operator", "vehicle_admin")),
):
    trip = await db.get(EmergencyTrip, trip_id)
    if trip is None:
        raise HTTPException(status_code=404, detail="Trip not found")
    return await _trip_payload(db, trip)


# ---------- decisions ----------

async def _open_trip(db: AsyncSession, trip_id: str) -> EmergencyTrip:
    trip = await db.get(EmergencyTrip, trip_id)
    if trip is None:
        raise HTTPException(status_code=404, detail="Trip not found")
    if trip.status in CLOSED_STATUSES:
        raise HTTPException(status_code=409, detail="Trip already closed")
    return trip


async def _rebuild_junctions(
    db: AsyncSession, trip_id: str, geometry: list, distance_m: float, eta_s: int
) -> list[SignalPlan]:
    for plan in (
        await db.execute(select(SignalPlan).where(SignalPlan.trip_id == trip_id))
    ).scalars().all():
        await db.delete(plan)
    fresh = mock_route.build_signal_plan(trip_id, geometry, distance_m, eta_s)
    for plan in fresh:
        db.add(plan)
    return fresh


@router.post("/trips/{trip_id}/route")
async def operator_route_decision(
    trip_id: str,
    body: RouteDecision,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("central_operator")),
):
    """Approve the current route, or override it with a new ETA and a stated reason."""
    rate_limit(request, user)
    trip = await _open_trip(db, trip_id)
    route = await _current_route(db, trip_id)
    if route is None:
        raise HTTPException(status_code=409, detail="No route to act on yet")

    geometry = json.loads(route.route_geometry)

    if body.action == "approve":
        trip.status = TripStatus.corridor_preparing.value
        await db.commit()
        db.add(
            AuditLog(
                actor_id=user.id,
                action="route_approved",
                entity_type="trip",
                entity_id=trip_id,
                detail=f"version={route.version}",
            )
        )
        await db.commit()
        await manager.broadcast(
            trip_id,
            {
                "type": "status",
                "trip_id": trip_id,
                "status": trip.status,
                "route_version": route.version,
                "eta_seconds": route.estimated_time_seconds,
                "message": "Control center approved the route. Corridor preparation started.",
                "priority_junctions": mock_route.junctions_payload(
                    (
                        await db.execute(
                            select(SignalPlan).where(SignalPlan.trip_id == trip_id)
                        )
                    ).scalars().all()
                ),
            },
        )
        return {
            "accepted": True,
            "action": "approve",
            "route_version": route.version,
            "eta_seconds": route.estimated_time_seconds,
            "status": trip.status,
        }

    old_eta = route.estimated_time_seconds
    new_eta = max(30, int(old_eta * body.eta_scale))
    new_distance = route.distance_meters * body.eta_scale
    new_version = trip.route_version + 1
    reason = body.reason or "Rerouted by control center"

    db.add(
        RoutePlan(
            trip_id=trip_id,
            version=new_version,
            route_geometry=route.route_geometry,
            estimated_time_seconds=new_eta,
            distance_meters=new_distance,
            confidence=route.confidence,
            status="approved",
            message=f"Control center override. {reason}",
        )
    )
    trip.route_version = new_version
    trip.status = TripStatus.rerouting.value
    db.add(
        AuditLog(
            actor_id=user.id,
            action="route_overridden",
            entity_type="trip",
            entity_id=trip_id,
            detail=f"reason={reason} v{route.version}->v{new_version} eta={old_eta}->{new_eta}",
        )
    )
    await db.commit()

    signals = await _rebuild_junctions(db, trip_id, geometry, new_distance, new_eta)
    await db.commit()

    await manager.broadcast(
        trip_id,
        {
            "type": "route_update",
            "trip_id": trip_id,
            "route_version": new_version,
            "eta_seconds": new_eta,
            "old_eta_seconds": old_eta,
            "reason": reason,
            "message": f"Route updated by control center. {reason}",
            "priority_junctions": mock_route.junctions_payload(signals),
        },
    )
    return {
        "accepted": True,
        "action": "override",
        "route_version": new_version,
        "eta_seconds": new_eta,
        "old_eta_seconds": old_eta,
        "reason": reason,
    }


@router.post("/trips/{trip_id}/message")
async def operator_message(
    trip_id: str,
    body: OperatorMessage,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("central_operator")),
):
    rate_limit(request, user)
    trip = await db.get(EmergencyTrip, trip_id)
    if trip is None:
        raise HTTPException(status_code=404, detail="Trip not found")

    db.add(
        AuditLog(
            actor_id=user.id,
            action="operator_message",
            entity_type="trip",
            entity_id=trip_id,
            detail=body.text[:200],
        )
    )
    await db.commit()
    await manager.broadcast(
        trip_id,
        {
            "type": "operator_message",
            "trip_id": trip_id,
            "urgency": body.urgency,
            "message": body.text,
        },
    )
    return {"delivered": True, "urgency": body.urgency}


@router.post("/trips/{trip_id}/cancel")
async def operator_cancel(
    trip_id: str,
    body: CancelRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("central_operator")),
):
    """Kill the corridor and close the trip from the control center."""
    rate_limit(request, user)
    trip = await _open_trip(db, trip_id)

    trip.status = TripStatus.cancelled.value
    trip.completion_status = "cancelled"
    trip.completed_at = datetime.now(timezone.utc)

    vehicle = await db.get(EmergencyVehicle, trip.vehicle_id)
    if vehicle:
        vehicle.status = "idle"

    signals = (
        await db.execute(select(SignalPlan).where(SignalPlan.trip_id == trip_id))
    ).scalars().all()
    for plan in signals:
        plan.status = "cleared"

    db.add(
        AuditLog(
            actor_id=user.id,
            action="trip_cancelled_by_operator",
            entity_type="trip",
            entity_id=trip_id,
            detail=body.reason,
        )
    )
    await db.commit()

    message = f"Route cancelled by control center. {body.reason}"
    await manager.broadcast(
        trip_id,
        {
            "type": "route_cancelled",
            "trip_id": trip_id,
            "status": trip.status,
            "reason": body.reason,
            "message": message,
        },
    )
    return {"cancelled": True, "trip_id": trip_id, "status": trip.status, "message": message}
