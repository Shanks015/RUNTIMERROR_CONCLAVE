import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..database import get_db
from ..models import (
    AuditLog,
    EmergencyTrip,
    EmergencyType,
    EmergencyVehicle,
    IncidentReport,
    LocationUpdate,
    Organization,
    RoutePlan,
    SignalPlan,
    TripStatus,
    User,
    utcnow,
)
from ..schemas import (
    CompleteTripRequest,
    IncidentOut,
    IncidentRequest,
    LocationUpdateResponse,
    RerouteRequest,
    StartTripRequest,
    StartTripResponse,
    TripSummary,
    VehicleOut,
)
from ..security import get_current_user, rate_limit, require_roles
from ..services import mock_route
from ..services.location import validate_and_score
from ..services.mock_control import approve_route_later
from ..services.ws import manager

router = APIRouter(prefix="/api", tags=["trips"])
settings = get_settings()

ACTIVE_STATUSES = {
    TripStatus.request_sent.value,
    TripStatus.request_received.value,
    TripStatus.route_calculating.value,
    TripStatus.route_approved.value,
    TripStatus.corridor_preparing.value,
    TripStatus.corridor_active.value,
    TripStatus.rerouting.value,
}


# ---------- vehicles ----------

@router.get("/vehicles", response_model=list[VehicleOut])
@router.get("/vehicles/assigned", response_model=list[VehicleOut])
async def list_vehicles(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("emergency_driver", "vehicle_admin")),
):
    result = await db.execute(
        select(EmergencyVehicle).where(
            EmergencyVehicle.organization_id == user.organization_id,
            EmergencyVehicle.verification_status == "verified",
        )
    )
    vehicles = result.scalars().all()

    orgs = {
        o.id: o.name
        for o in (
            await db.execute(
                select(Organization).where(
                    Organization.id.in_([v.organization_id for v in vehicles] or [""])
                )
            )
        ).scalars()
    }
    driver_ids = [v.driver_id for v in vehicles if v.driver_id]
    drivers = {
        d.id: d.name
        for d in (
            await db.execute(select(User).where(User.id.in_(driver_ids or [""])))
        ).scalars()
    }

    return [
        VehicleOut(
            id=v.id,
            vehicle_number=v.vehicle_number,
            vehicle_type=v.vehicle_type,
            organization_id=v.organization_id,
            organization_name=orgs.get(v.organization_id),
            driver_id=v.driver_id,
            driver_name=drivers.get(v.driver_id) if v.driver_id else None,
            status=v.status,
            verification_status=v.verification_status,
        )
        for v in vehicles
    ]


# ---------- helpers ----------

async def _get_owned_trip(
    db: AsyncSession, trip_id: str, user: User
) -> EmergencyTrip:
    trip = await db.get(EmergencyTrip, trip_id)
    if trip is None:
        raise HTTPException(status_code=404, detail="Trip not found")
    if user.role in ("emergency_driver",) and trip.driver_id != user.id:
        raise HTTPException(status_code=403, detail="Trip belongs to another driver")
    if user.role == "emergency_driver" and trip.organization_id != user.organization_id:
        raise HTTPException(status_code=403, detail="Cross-organization access denied")
    return trip


async def _active_trip_for_vehicle(
    db: AsyncSession, vehicle_id: str
) -> EmergencyTrip | None:
    result = await db.execute(
        select(EmergencyTrip)
        .where(
            EmergencyTrip.vehicle_id == vehicle_id,
            EmergencyTrip.status.in_(ACTIVE_STATUSES),
        )
        .order_by(EmergencyTrip.started_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _latest_fix(db: AsyncSession, trip_id: str) -> LocationUpdate | None:
    result = await db.execute(
        select(LocationUpdate)
        .where(LocationUpdate.trip_id == trip_id)
        .order_by(LocationUpdate.timestamp.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _current_route(db: AsyncSession, trip_id: str) -> RoutePlan | None:
    result = await db.execute(
        select(RoutePlan)
        .where(RoutePlan.trip_id == trip_id)
        .order_by(RoutePlan.version.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _next_trip_id(db: AsyncSession) -> str:
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    prefix = f"TRIP-{day}-"
    result = await db.execute(
        select(func.count()).where(EmergencyTrip.id.like(f"{prefix}%"))
    )
    seq = int(result.scalar_one()) + 1
    return f"{prefix}{seq:04d}"


# ---------- start trip ----------

@router.post("/emergency-trips", response_model=StartTripResponse, status_code=201)
async def start_trip(
    body: StartTripRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("emergency_driver")),
):
    rate_limit(request, user)

    # Fake-emergency protections (spec section 10)
    vehicle = await db.get(EmergencyVehicle, body.vehicle_id)
    if vehicle is None or vehicle.verification_status != "verified":
        raise HTTPException(status_code=403, detail="Vehicle not registered or not verified")
    if vehicle.driver_id != user.id:
        raise HTTPException(status_code=403, detail="Driver not assigned to this vehicle")
    if vehicle.status == "maintenance":
        raise HTTPException(status_code=403, detail="Vehicle is under maintenance")

    open_trip = await _active_trip_for_vehicle(db, body.vehicle_id)
    if open_trip:
        raise HTTPException(
            status_code=409,
            detail=f"Vehicle already has an active trip: {open_trip.id}",
        )

    if body.emergency_type not in {e.value for e in EmergencyType}:
        raise HTTPException(status_code=422, detail="Unknown emergency type")
    if body.priority not in {"critical", "high", "normal"}:
        raise HTTPException(status_code=422, detail="Unknown priority level")
    # Demo policy: drivers may only request critical priority for life-critical types.
    life_critical = {"critical_medical", "fire", "organ_transport"}
    if body.priority == "critical" and body.emergency_type not in life_critical:
        raise HTTPException(
            status_code=403, detail="Critical priority not authorized for this emergency type"
        )

    if body.location.accuracy_m > settings.max_accuracy_m:
        raise HTTPException(
            status_code=422,
            detail="GPS accuracy too poor to start an emergency trip",
        )

    route = mock_route.compute_route(
        body.location.latitude,
        body.location.longitude,
        body.destination.latitude,
        body.destination.longitude,
    )
    trip_id = await _next_trip_id(db)

    trip = EmergencyTrip(
        id=trip_id,
        vehicle_id=vehicle.id,
        vehicle_type=body.vehicle_type,
        driver_id=user.id,
        organization_id=user.organization_id,
        emergency_type=body.emergency_type,
        priority=body.priority,
        destination_name=body.destination.name,
        origin_latitude=body.location.latitude,
        origin_longitude=body.location.longitude,
        destination_latitude=body.destination.latitude,
        destination_longitude=body.destination.longitude,
        status=TripStatus.route_calculating.value,
        route_version=1,
        notes=body.notes,
        last_latitude=body.location.latitude,
        last_longitude=body.location.longitude,
    )
    db.add(trip)
    db.add(
        RoutePlan(
            trip_id=trip_id,
            version=1,
            route_geometry=mock_route.geometry_to_json(route["geometry"]),
            estimated_time_seconds=route["estimated_time_seconds"],
            distance_meters=route["distance_meters"],
            confidence=route["confidence"],
            status="approved",
            message="Emergency request received. Route options calculated.",
        )
    )
    for plan in mock_route.build_signal_plan(
        trip_id, route["geometry"], route["distance_meters"], route["estimated_time_seconds"]
    ):
        db.add(plan)

    # Record the starting fix so jump detection has a baseline.
    db.add(
        LocationUpdate(
            trip_id=trip_id,
            latitude=body.location.latitude,
            longitude=body.location.longitude,
            accuracy_m=body.location.accuracy_m,
            speed_kmph=body.location.speed_kmph,
            heading=body.location.heading,
            battery_percent=body.location.battery_percent,
            network_status=body.location.network_status,
            timestamp=body.location.timestamp,
            source=body.location.source,
            confidence=0.9,
            sequence_key=body.location.sequence_key or f"{trip_id}-start",
        )
    )
    vehicle.status = "on_trip"
    db.add(
        AuditLog(
            actor_id=user.id,
            action="trip_started",
            entity_type="trip",
            entity_id=trip_id,
            detail=f"vehicle={vehicle.id} priority={body.priority} type={body.emergency_type}",
        )
    )
    await db.commit()

    await manager.broadcast(
        trip_id,
        {
            "type": "trip_status",
            "trip_id": trip_id,
            "status": TripStatus.route_calculating.value,
            "message": "Emergency request received. Route being calculated.",
        },
    )
    # Mock control centre: approve the route, then take the corridor live.
    import asyncio

    asyncio.create_task(approve_route_later(trip_id))

    return StartTripResponse(
        trip_id=trip_id,
        status=TripStatus.route_calculating.value,
        message="Emergency request received",
    )


# ---------- trip state ----------

@router.get("/emergency-trips/{trip_id}")
async def get_trip(
    trip_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    trip = await _get_owned_trip(db, trip_id, user)
    route = await _current_route(db, trip_id)
    signals = (
        await db.execute(select(SignalPlan).where(SignalPlan.trip_id == trip_id))
    ).scalars().all()
    incidents = (
        await db.execute(
            select(IncidentReport)
            .where(IncidentReport.trip_id == trip_id)
            .order_by(IncidentReport.created_at)
        )
    ).scalars().all()

    eta = route.estimated_time_seconds if route else None
    remaining = None
    if route and trip.last_latitude is not None:
        geometry = json.loads(route.route_geometry)
        fraction = mock_route.route_progress(
            geometry, trip.last_latitude, trip.last_longitude
        )
        remaining = mock_route.distance_along_route(
            geometry, fraction, route.distance_meters
        )
        eta = mock_route.remaining_eta_seconds(
            geometry, trip.last_latitude, trip.last_longitude, route.distance_meters
        )

    return {
        "trip_id": trip.id,
        "status": trip.status,
        "vehicle_id": trip.vehicle_id,
        "emergency_type": trip.emergency_type,
        "priority": trip.priority,
        "destination": {
            "name": trip.destination_name,
            "latitude": trip.destination_latitude,
            "longitude": trip.destination_longitude,
        },
        "origin": {"latitude": trip.origin_latitude, "longitude": trip.origin_longitude},
        "route_version": trip.route_version,
        "route_geometry": json.loads(route.route_geometry) if route else [],
        "distance_meters": route.distance_meters if route else None,
        "distance_remaining_m": remaining,
        "eta_seconds": eta,
        "signal_plan": mock_route.junctions_payload(signals),
        "incidents": [IncidentOut.model_validate(i).model_dump() for i in incidents],
        "started_at": trip.started_at,
        "completed_at": trip.completed_at,
        "last_location": (
            {
                "latitude": trip.last_latitude,
                "longitude": trip.last_longitude,
            }
            if trip.last_latitude is not None
            else None
        ),
    }


# ---------- location update ----------

@router.post("/emergency-trips/{trip_id}/location", response_model=LocationUpdateResponse)
async def post_location(
    trip_id: str,
    body: dict,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("emergency_driver")),
):
    rate_limit(request, user)
    trip = await _get_owned_trip(db, trip_id, user)
    if trip.status in (TripStatus.completed.value, TripStatus.cancelled.value):
        raise HTTPException(status_code=409, detail="Trip already completed")

    from ..schemas import GpsFix

    fix = GpsFix.model_validate(body)
    # Payload contract: if the client tags vehicle/driver, they must match the trip.
    if fix.vehicle_id is not None and fix.vehicle_id != trip.vehicle_id:
        raise HTTPException(status_code=403, detail="vehicle_id does not belong to this trip")
    if fix.driver_id is not None and fix.driver_id != trip.driver_id:
        raise HTTPException(status_code=403, detail="driver_id does not belong to this trip")
    previous = await _latest_fix(db, trip_id)
    route = await _current_route(db, trip_id)

    accepted, confidence, reason = validate_and_score(
        fix.model_dump(), previous, route
    )
    if not accepted:
        return LocationUpdateResponse(
            accepted=False,
            reason=reason,
            location_confidence=0.0,
            route_version=trip.route_version,
        )

    sequence_key = fix.sequence_key or f"{trip_id}-{fix.timestamp.isoformat()}"
    duplicate = await db.execute(
        select(LocationUpdate.id)
        .where(
            LocationUpdate.trip_id == trip_id,
            LocationUpdate.sequence_key == sequence_key,
        )
        .limit(1)
    )
    if duplicate.scalar_one_or_none() is not None:
        # Offline-queue replay: ack without storing twice.
        return LocationUpdateResponse(
            accepted=True,
            reason="duplicate_ignored",
            location_confidence=confidence,
            route_version=trip.route_version,
        )

    db.add(
        LocationUpdate(
            trip_id=trip_id,
            latitude=fix.latitude,
            longitude=fix.longitude,
            accuracy_m=fix.accuracy_m,
            speed_kmph=fix.speed_kmph,
            heading=fix.heading,
            battery_percent=fix.battery_percent,
            network_status=fix.network_status,
            timestamp=fix.timestamp,
            source=fix.source,
            confidence=confidence,
            sequence_key=sequence_key,
        )
    )

    travelled_delta = 0.0
    if trip.last_latitude is not None:
        from ..services.location import haversine_m

        travelled_delta = haversine_m(
            fix.latitude, fix.longitude, trip.last_latitude, trip.last_longitude
        )
        # Ignore implausible backward jitter for the distance counter.
        if travelled_delta < 500:
            trip.distance_travelled_m += travelled_delta
    trip.last_latitude = fix.latitude
    trip.last_longitude = fix.longitude

    eta = None
    remaining = None
    if route:
        geometry = json.loads(route.route_geometry)
        eta = mock_route.remaining_eta_seconds(
            geometry, fix.latitude, fix.longitude, route.distance_meters
        )
        fraction = mock_route.route_progress(geometry, fix.latitude, fix.longitude)
        remaining = mock_route.distance_along_route(
            geometry, fraction, route.distance_meters
        )
        # Corridor becomes "active" once the driver is rolling on an approved route.
        if trip.status == TripStatus.corridor_preparing.value and confidence >= 0.6:
            trip.status = TripStatus.corridor_active.value
        elif trip.status == TripStatus.route_approved.value:
            trip.status = TripStatus.corridor_active.value
        route.estimated_time_seconds = eta if eta is not None else route.estimated_time_seconds

    await db.commit()

    await manager.broadcast(
        trip_id,
        {
            "type": "location_update",
            "trip_id": trip_id,
            "latitude": fix.latitude,
            "longitude": fix.longitude,
            "accuracy_m": fix.accuracy_m,
            "speed_kmph": fix.speed_kmph,
            "confidence": confidence,
            "eta_seconds": eta,
        },
    )

    return LocationUpdateResponse(
        accepted=True,
        location_confidence=confidence,
        eta_seconds=eta,
        distance_remaining_m=remaining,
        route_version=trip.route_version,
    )


# ---------- incidents ----------

@router.post("/emergency-trips/{trip_id}/incidents", response_model=IncidentOut, status_code=201)
async def report_incident(
    trip_id: str,
    body: IncidentRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("emergency_driver")),
):
    rate_limit(request, user)
    trip = await _get_owned_trip(db, trip_id, user)
    if trip.status in (TripStatus.completed.value, TripStatus.cancelled.value):
        raise HTTPException(status_code=409, detail="Trip already completed")

    allowed = {
        "accident", "road_blocked", "heavy_congestion", "wrong_route",
        "vehicle_issue", "destination_changed", "need_assistance",
    }
    if body.type not in allowed:
        raise HTTPException(status_code=422, detail="Unknown incident type")
    if body.severity not in {"low", "medium", "high", "critical"}:
        raise HTTPException(status_code=422, detail="Unknown severity")

    incident = IncidentReport(
        trip_id=trip_id,
        incident_type=body.type,
        latitude=body.latitude,
        longitude=body.longitude,
        description=body.description,
        severity=body.severity,
        road_segment=body.road_segment,
        media_url=body.media_url,
    )
    db.add(incident)
    db.add(
        AuditLog(
            actor_id=user.id,
            action="incident_reported",
            entity_type="trip",
            entity_id=trip_id,
            detail=f"type={body.type} severity={body.severity}",
        )
    )

    reroute = body.type in {"road_blocked", "accident", "heavy_congestion", "wrong_route"}
    route_message = None
    if reroute and trip.status not in (TripStatus.completed.value, TripStatus.cancelled.value):
        # Mock route agent v2: recalculate with a small penalty on ETA.
        route = await _current_route(db, trip_id)
        if route:
            new_version = trip.route_version + 1
            new_eta = int(route.estimated_time_seconds * 1.15)
            db.add(
                RoutePlan(
                    trip_id=trip_id,
                    version=new_version,
                    route_geometry=route.route_geometry,
                    estimated_time_seconds=new_eta,
                    distance_meters=route.distance_meters * 1.08,
                    confidence=route.confidence,
                    status="approved",
                    message=(
                        "Incident reported ahead. Alternate route selected."
                        if body.type != "wrong_route"
                        else "Wrong-route report received. Route corrected."
                    ),
                )
            )
            trip.route_version = new_version
            trip.status = TripStatus.rerouting.value
            route_message = "Route updated due to reported incident."
            await manager.broadcast(
                trip_id,
                {
                    "type": "route_update",
                    "trip_id": trip_id,
                    "route_version": new_version,
                    "eta_seconds": new_eta,
                    "message": route_message,
                    "priority_junctions": [],
                },
            )

    await db.commit()

    await manager.broadcast(
        trip_id,
        {
            "type": "incident",
            "trip_id": trip_id,
            "incident_type": body.type,
            "severity": body.severity,
            "message": f"Incident reported: {body.type.replace('_', ' ')}.",
        },
    )

    return IncidentOut.model_validate(incident)


# ---------- reroute ----------

@router.post("/emergency-trips/{trip_id}/reroute")
async def request_reroute(
    trip_id: str,
    body: RerouteRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("emergency_driver")),
):
    """Driver- or operator-triggered reroute. Mock route agent v2: bumps the
    route version, re-estimates ETA and pushes a route_update over the feed."""
    rate_limit(request, user)
    trip = await _get_owned_trip(db, trip_id, user)
    if trip.status in (TripStatus.completed.value, TripStatus.cancelled.value):
        raise HTTPException(status_code=409, detail="Trip already completed")

    route = await _current_route(db, trip_id)
    if route is None:
        raise HTTPException(status_code=409, detail="No approved route to recalculate")

    old_eta = route.estimated_time_seconds
    # Congestion-style reroutes find a better path; generic reroutes cost a little.
    if "congestion" in body.reason.lower() or "accident" in body.reason.lower():
        new_eta = max(30, int(old_eta * 0.82))
        new_distance = route.distance_meters * 0.94
    else:
        new_eta = int(old_eta * 1.05)
        new_distance = route.distance_meters * 1.03

    new_version = trip.route_version + 1
    db.add(
        RoutePlan(
            trip_id=trip_id,
            version=new_version,
            route_geometry=route.route_geometry,
            estimated_time_seconds=new_eta,
            distance_meters=new_distance,
            confidence=route.confidence,
            status="approved",
            message=f"Route updated. {body.reason}",
        )
    )
    trip.route_version = new_version
    trip.status = TripStatus.rerouting.value

    # Rebuild the junction plan for the new ETA so arrival times stay honest.
    old_signals = (
        await db.execute(select(SignalPlan).where(SignalPlan.trip_id == trip_id))
    ).scalars().all()
    for plan in old_signals:
        await db.delete(plan)
    geometry = json.loads(route.route_geometry)
    for plan in mock_route.build_signal_plan(trip_id, geometry, new_distance, new_eta):
        db.add(plan)

    db.add(
        AuditLog(
            actor_id=user.id,
            action="reroute_requested",
            entity_type="trip",
            entity_id=trip_id,
            detail=f"reason={body.reason} version={new_version}",
        )
    )
    await db.commit()

    refreshed = (
        await db.execute(select(SignalPlan).where(SignalPlan.trip_id == trip_id))
    ).scalars().all()
    message = f"Route updated. {body.reason}"
    await manager.broadcast(
        trip_id,
        {
            "type": "route_update",
            "trip_id": trip_id,
            "route_version": new_version,
            "eta_seconds": new_eta,
            "old_eta_seconds": old_eta,
            "reason": body.reason,
            "message": message,
            "priority_junctions": mock_route.junctions_payload(refreshed),
        },
    )

    return {
        "accepted": True,
        "route_version": new_version,
        "eta_seconds": new_eta,
        "old_eta_seconds": old_eta,
        "reason": body.reason,
        "message": message,
    }


# ---------- complete ----------

@router.post("/emergency-trips/{trip_id}/complete")
async def complete_trip(
    trip_id: str,
    body: CompleteTripRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("emergency_driver")),
):
    rate_limit(request, user)
    trip = await _get_owned_trip(db, trip_id, user)
    if trip.status in (TripStatus.completed.value, TripStatus.cancelled.value):
        raise HTTPException(status_code=409, detail="Trip already completed")

    if body.completion_status not in {"completed", "cancelled", "diverted", "patient_transferred", "vehicle_issue", "other"}:
        raise HTTPException(status_code=422, detail="Unknown completion status")

    from ..services.location import haversine_m

    # Distance from the current point to destination decides if this looks real.
    gap = haversine_m(
        body.final_latitude, body.final_longitude, trip.destination_latitude, trip.destination_longitude
    )
    if body.completion_status == "completed" and gap > 5_000 and user.role == "emergency_driver":
        raise HTTPException(
            status_code=422,
            detail="Final location is too far from the destination to mark trip completed",
        )

    trip.completion_status = body.completion_status
    trip.status = (
        TripStatus.cancelled.value
        if body.completion_status == "cancelled"
        else TripStatus.completed.value
    )
    # A clock-skewed phone can send "now" earlier than server-side started_at;
    # never let that produce a completion time before the trip began.
    client_time = body.timestamp
    if client_time is not None and client_time.tzinfo is None:
        client_time = client_time.replace(tzinfo=timezone.utc)
    started_aware = trip.started_at if trip.started_at.tzinfo else trip.started_at.replace(tzinfo=timezone.utc)
    if client_time is None or client_time < started_aware:
        trip.completed_at = utcnow()
    else:
        trip.completed_at = client_time
    trip.last_latitude = body.final_latitude
    trip.last_longitude = body.final_longitude

    vehicle = await db.get(EmergencyVehicle, trip.vehicle_id)
    if vehicle:
        vehicle.status = "idle"

    # Clear signal plans — the app must show priority being cleared, never ambiguous.
    signals = (
        await db.execute(select(SignalPlan).where(SignalPlan.trip_id == trip_id))
    ).scalars().all()
    for plan in signals:
        plan.status = "cleared"

    db.add(
        AuditLog(
            actor_id=user.id,
            action="trip_completed",
            entity_type="trip",
            entity_id=trip_id,
            detail=(
                f"status={trip.status} completion={trip.completion_status} "
                f"distance={trip.distance_travelled_m:.0f}m"
            ),
        )
    )
    await db.commit()

    status_words = {
        "completed": "completed",
        "cancelled": "cancelled",
        "diverted": "diverted",
        "patient_transferred": "completed — patient transferred",
        "vehicle_issue": "ended — vehicle issue",
        "other": "ended",
    }
    message = (
        f"Trip {status_words.get(trip.completion_status or 'completed', 'ended')}. "
        "Signal priority is being cleared."
    )
    await manager.broadcast(
        trip_id,
        {
            "type": "trip_status",
            "trip_id": trip_id,
            "status": trip.status,
            "message": message,
        },
    )

    duration = None
    if trip.completed_at:
        started = trip.started_at if trip.started_at.tzinfo else trip.started_at.replace(tzinfo=timezone.utc)
        done = trip.completed_at if trip.completed_at.tzinfo else trip.completed_at.replace(tzinfo=timezone.utc)
        duration = max(0, int((done - started).total_seconds()))

    incidents = (
        await db.execute(
            select(IncidentReport)
            .where(IncidentReport.trip_id == trip_id)
            .order_by(IncidentReport.created_at)
        )
    ).scalars().all()
    route_changes = await db.execute(
        select(func.count()).select_from(RoutePlan).where(RoutePlan.trip_id == trip_id)
    )
    original = (
        await db.execute(
            select(RoutePlan)
            .where(RoutePlan.trip_id == trip_id, RoutePlan.version == 1)
            .limit(1)
        )
    ).scalar_one_or_none()

    return TripSummary(
        trip_id=trip.id,
        status=trip.status,
        completion_status=trip.completion_status,
        emergency_type=trip.emergency_type,
        priority=trip.priority,
        destination_name=trip.destination_name,
        route_version=trip.route_version,
        started_at=trip.started_at,
        completed_at=trip.completed_at,
        duration_seconds=duration,
        distance_travelled_m=trip.distance_travelled_m,
        original_eta_seconds=original.estimated_time_seconds if original else None,
        route_changes=max(0, int(route_changes.scalar_one()) - 1),
        incidents=[IncidentOut.model_validate(i) for i in incidents],
        priority_junctions=mock_route.junctions_payload(signals),
        signal_plan_status="cleared" if signals else "none",
        final_latitude=body.final_latitude,
        final_longitude=body.final_longitude,
    )


# ---------- trip history ----------

@router.get("/emergency-trips")
async def list_trips(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = select(EmergencyTrip).order_by(EmergencyTrip.started_at.desc()).limit(50)
    if user.role == "emergency_driver":
        query = query.where(EmergencyTrip.driver_id == user.id)
    elif user.role == "vehicle_admin":
        query = query.where(EmergencyTrip.organization_id == user.organization_id)
    trips = (await db.execute(query)).scalars().all()
    return [
        {
            "trip_id": t.id,
            "vehicle_id": t.vehicle_id,
            "status": t.status,
            "completion_status": t.completion_status,
            "emergency_type": t.emergency_type,
            "priority": t.priority,
            "destination_name": t.destination_name,
            "started_at": t.started_at,
            "completed_at": t.completed_at,
        }
        for t in trips
    ]
