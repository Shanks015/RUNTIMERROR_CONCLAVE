"""Location validation and confidence scoring (spec section 8).

Rejects or flags: poor accuracy, stale/future timestamps, impossible jumps,
duplicates, and coordinates far from the approved route corridor.
"""

import math
from datetime import datetime, timezone

from ..config import get_settings
from ..models import LocationUpdate, RoutePlan

settings = get_settings()

EARTH_RADIUS_M = 6_371_000.0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def _accuracy_score(accuracy_m: float) -> float:
    if accuracy_m <= 10:
        return 1.0
    if accuracy_m >= settings.max_accuracy_m:
        return 0.1
    # linear decay from 1.0 at 10 m to 0.2 at the rejection threshold
    return max(0.2, 1.0 - (accuracy_m - 10) / (settings.max_accuracy_m - 10) * 0.8)


def _freshness_score(timestamp: datetime, now: datetime) -> float:
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    age = abs((now - timestamp).total_seconds())
    if age <= 5:
        return 1.0
    if age >= settings.max_timestamp_skew_seconds:
        return 0.2
    return max(0.2, 1.0 - (age - 5) / (settings.max_timestamp_skew_seconds - 5) * 0.8)


def _speed_score(
    prev: LocationUpdate | None, dt_seconds: float, reported_speed_kmph: float,
    distance_m: float,
) -> float:
    if prev is None or dt_seconds <= 0:
        return 1.0
    implied_kmph = (distance_m / dt_seconds) * 3.6
    # Consistency between implied speed from positions and the reported speed.
    delta = abs(implied_kmph - reported_speed_kmph)
    if delta <= 15:
        return 1.0
    if delta >= 80:
        return 0.2
    return max(0.2, 1.0 - (delta - 15) / 65 * 0.8)


def _road_match_score(lat: float, lon: float, route: RoutePlan | None) -> float:
    if route is None:
        return 1.0  # no approved route yet -> no corridor to compare against
    import json

    try:
        geometry = json.loads(route.route_geometry)
    except (ValueError, TypeError):
        return 1.0
    best = min(
        (haversine_m(lat, lon, p[0], p[1]) for p in geometry if len(p) >= 2),
        default=0.0,
    )
    if best <= 50:
        return 1.0
    if best >= 300:
        return 0.4
    return 1.0 - (best - 50) / 250 * 0.6


def _network_score(network_status: str) -> float:
    return {"online": 1.0, "weak": 0.8, "offline": 0.6}.get(network_status, 0.7)


def validate_and_score(
    fix: dict,
    previous: LocationUpdate | None,
    route: RoutePlan | None,
    now: datetime | None = None,
) -> tuple[bool, float, str | None]:
    """Returns (accepted, confidence, rejection_reason)."""
    now = now or datetime.now(timezone.utc)
    timestamp = fix["timestamp"]
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)

    # Hard rejections
    skew = (now - timestamp).total_seconds()
    if skew > settings.max_timestamp_skew_seconds:
        return False, 0.0, "stale_timestamp"
    if skew < -10:
        return False, 0.0, "future_timestamp"
    if fix["accuracy_m"] > settings.max_accuracy_m:
        return False, 0.0, "accuracy_exceeds_threshold"
    if fix["speed_kmph"] > settings.max_speed_kmph:
        return False, 0.0, "impossible_speed"

    # Impossible-jump check against previous accepted fix.
    if previous is not None:
        distance = haversine_m(
            fix["latitude"], fix["longitude"], previous.latitude, previous.longitude
        )
        dt = (timestamp - previous.timestamp).total_seconds()
        if dt > 0:
            plausible = (max(fix["speed_kmph"], previous.speed_kmph, 10.0) / 3.6) * dt
            allowed = plausible * 3 + settings.jump_tolerance_m
            if distance > allowed:
                return False, 0.0, "impossible_jump"

    # Duplicate: same position as previous fix within 1 s.
    if previous is not None:
        d = haversine_m(
            fix["latitude"], fix["longitude"], previous.latitude, previous.longitude
        )
        dt = abs((timestamp - previous.timestamp).total_seconds())
        if d < 1.0 and dt < 1.0:
            return False, 0.0, "duplicate_update"

    distance = 0.0
    dt = 0.0
    if previous is not None:
        distance = haversine_m(
            fix["latitude"], fix["longitude"], previous.latitude, previous.longitude
        )
        dt = max((timestamp - previous.timestamp).total_seconds(), 0.1)

    confidence = (
        0.35 * _accuracy_score(fix["accuracy_m"])
        + 0.20 * _freshness_score(timestamp, now)
        + 0.20 * _speed_score(previous, dt, fix["speed_kmph"], distance)
        + 0.15 * _road_match_score(fix["latitude"], fix["longitude"], route)
        + 0.10 * _network_score(fix.get("network_status", "online"))
    )
    return True, round(confidence, 3), None
