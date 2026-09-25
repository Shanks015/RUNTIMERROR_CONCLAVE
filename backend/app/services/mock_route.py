"""Mock route + signal-plan agent.

Straight-line corridor with gentle lateral offsets so the polyline looks like
a road path on the map. Replace with OSRM/GraphHopper later — the interface
(compute_route / build_signal_plan / remaining_distance) stays the same.
"""

import json
import math
from datetime import datetime, timedelta, timezone

from ..config import get_settings
from ..models import SignalPlan

settings = get_settings()


def compute_route(origin_lat: float, origin_lon: float, dest_lat: float, dest_lon: float) -> dict:
    """Returns route geometry + distance/ETA estimates."""
    from .location import haversine_m

    straight = haversine_m(origin_lat, origin_lon, dest_lat, dest_lon)
    # Surface routes run longer than the crow flies; mock factor for prototype.
    distance_m = straight * 1.25 if straight > 0 else 0.0

    steps = max(8, min(40, int(straight / 150) or 8))
    points: list[list[float]] = []
    # Perpendicular unit vector for the lateral wiggle.
    d_lat = dest_lat - origin_lat
    d_lon = dest_lon - origin_lon
    norm = math.hypot(d_lat, d_lon) or 1.0
    p_lat, p_lon = -d_lon / norm, d_lat / norm

    for i in range(steps + 1):
        t = i / steps
        # smooth sine offset peaks mid-route, zero at both ends
        offset = math.sin(t * math.pi) * 0.0006
        lat = origin_lat + d_lat * t + p_lat * offset
        lon = origin_lon + d_lon * t + p_lon * offset
        points.append([round(lat, 6), round(lon, 6)])

    avg_speed = settings.mock_route_avg_speed_kmph
    eta_seconds = int((distance_m / 1000) / avg_speed * 3600) if distance_m else 0
    return {
        "geometry": points,
        "distance_meters": round(distance_m, 1),
        "estimated_time_seconds": eta_seconds,
        "confidence": 0.85,
    }


def point_at_fraction(geometry: list[list[float]], fraction: float) -> list[float]:
    fraction = max(0.0, min(1.0, fraction))
    if not geometry:
        return [0.0, 0.0]
    idx = fraction * (len(geometry) - 1)
    lo = int(math.floor(idx))
    hi = min(lo + 1, len(geometry) - 1)
    frac = idx - lo
    return [
        geometry[lo][0] + (geometry[hi][0] - geometry[lo][0]) * frac,
        geometry[lo][1] + (geometry[hi][1] - geometry[lo][1]) * frac,
    ]


def route_progress(geometry: list[list[float]], lat: float, lon: float) -> float:
    """Nearest-point fraction along the polyline (0 = origin, 1 = destination)."""
    from .location import haversine_m

    if not geometry:
        return 0.0
    best_i, best_d = 0, float("inf")
    for i, (p_lat, p_lon) in enumerate(geometry):
        d = haversine_m(lat, lon, p_lat, p_lon)
        if d < best_d:
            best_d, best_i = d, i
    return best_i / max(len(geometry) - 1, 1)


def distance_along_route(geometry: list[list[float]], fraction: float, total_m: float) -> float:
    return max(0.0, total_m * (1.0 - max(0.0, min(1.0, fraction))))


def remaining_eta_seconds(geometry: list[list[float]], lat: float, lon: float, total_m: float) -> int:
    fraction = route_progress(geometry, lat, lon)
    remaining_m = distance_along_route(geometry, fraction, total_m)
    avg_speed = settings.mock_route_avg_speed_kmph
    if avg_speed <= 0:
        return 0
    return int((remaining_m / 1000) / avg_speed * 3600)


def build_signal_plan(
    trip_id: str, geometry: list[list[float]], total_m: float, eta_seconds: int
) -> list[SignalPlan]:
    """Stops the mock signal agent hands back to the app (view-only in-app)."""
    if total_m <= 0:
        return []
    spacing = settings.junction_spacing_m
    count = max(1, min(6, int(total_m // spacing)))
    plans: list[SignalPlan] = []
    for i in range(1, count + 1):
        fraction = (i * spacing) / total_m
        if fraction >= 1.0:
            break
        arrival_in = int(eta_seconds * fraction)
        plans.append(
            SignalPlan(
                trip_id=trip_id,
                junction_id=f"J-{10 + i * 2}",
                arrival_time=datetime.now(timezone.utc) + timedelta(seconds=arrival_in),
                recommended_action="extend_green" if i % 2 else "preempt_green",
                status="scheduled",
            )
        )
    return plans


def junctions_payload(plans: list[SignalPlan], now: datetime | None = None) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    out = []
    for p in plans:
        arrival_in = 0
        if p.arrival_time:
            at = p.arrival_time if p.arrival_time.tzinfo else p.arrival_time.replace(tzinfo=timezone.utc)
            arrival_in = max(0, int((at - now).total_seconds()))
        out.append(
            {
                "junction_id": p.junction_id,
                "arrival_in_seconds": arrival_in,
                "signal_status": p.status,
            }
        )
    return out


def geometry_to_json(geometry: list[list[float]]) -> str:
    return json.dumps(geometry)
