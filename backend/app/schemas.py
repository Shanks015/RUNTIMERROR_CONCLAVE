from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


# ---------- auth ----------

class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=4, max_length=128)
    organization_id: str | None = Field(default=None, max_length=32)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user_id: str
    vehicle_id: str | None
    role: str
    name: str
    organization_id: str


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str | None = None


# ---------- vehicles ----------

class VehicleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    vehicle_number: str
    vehicle_type: str
    organization_id: str
    organization_name: str | None = None
    driver_id: str | None
    driver_name: str | None
    status: str
    verification_status: str


# ---------- trips ----------

class GpsFix(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_m: float = Field(ge=0, le=10_000)
    speed_kmph: float = Field(default=0.0, ge=0, le=400)
    heading: float | None = Field(default=None, ge=0, le=360)
    battery_percent: int | None = Field(default=None, ge=0, le=100)
    network_status: str = "online"
    timestamp: datetime
    sequence_key: str | None = None  # client dedupe key for offline queue replay
    source: str = "gps"
    # Sent by the app per the payload contract; validated against the trip.
    vehicle_id: str | None = None
    driver_id: str | None = None


class Destination(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class StartTripRequest(BaseModel):
    vehicle_id: str
    vehicle_type: str
    emergency_type: str
    priority: str
    destination: Destination
    location: GpsFix
    notes: str | None = Field(default=None, max_length=500)


class StartTripResponse(BaseModel):
    trip_id: str
    status: str
    message: str


class LocationUpdateResponse(BaseModel):
    accepted: bool
    reason: str | None = None
    location_confidence: float
    eta_seconds: int | None = None
    distance_remaining_m: float | None = None
    route_version: int | None = None


class PriorityJunction(BaseModel):
    junction_id: str
    arrival_in_seconds: int
    signal_status: str


class IncidentRequest(BaseModel):
    type: str = Field(max_length=32)
    description: str | None = Field(default=None, max_length=500)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    severity: str = "medium"
    timestamp: datetime | None = None
    media_url: str | None = None
    road_segment: str | None = Field(default=None, max_length=64)


class RerouteRequest(BaseModel):
    reason: str = Field(default="Congestion detected on original route", max_length=200)


class RerouteResponse(BaseModel):
    accepted: bool
    route_version: int
    eta_seconds: int
    old_eta_seconds: int
    reason: str
    message: str


class IncidentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    incident_type: str
    latitude: float
    longitude: float
    description: str | None
    severity: str
    created_at: datetime


class CompleteTripRequest(BaseModel):
    completion_status: str = Field(
        default="completed",
        pattern="^(completed|cancelled|diverted|patient_transferred|vehicle_issue|other)$",
    )
    final_latitude: float = Field(ge=-90, le=90)
    final_longitude: float = Field(ge=-180, le=180)
    timestamp: datetime | None = None


class TripSummary(BaseModel):
    trip_id: str
    status: str
    completion_status: str | None = None
    emergency_type: str
    priority: str
    destination_name: str
    route_version: int
    started_at: datetime
    completed_at: datetime | None
    duration_seconds: int | None = None
    distance_travelled_m: float
    distance_remaining_m: float | None = None
    eta_seconds: int | None = None
    original_eta_seconds: int | None = None
    route_changes: int = 0
    incidents: list[IncidentOut] = []
    priority_junctions: list[PriorityJunction] = []
    signal_plan_status: str = "none"
    final_latitude: float | None = None
    final_longitude: float | None = None
