import enum
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UserRole(str, enum.Enum):
    emergency_driver = "emergency_driver"
    vehicle_admin = "vehicle_admin"
    central_operator = "central_operator"


class VehicleType(str, enum.Enum):
    ambulance = "ambulance"
    fire_truck = "fire_truck"
    police = "police"


class EmergencyType(str, enum.Enum):
    critical_medical = "critical_medical"
    non_critical_medical = "non_critical_medical"
    fire = "fire"
    police = "police"
    organ_transport = "organ_transport"
    other = "other"


class Priority(str, enum.Enum):
    critical = "critical"
    high = "high"
    normal = "normal"


class TripStatus(str, enum.Enum):
    request_sent = "request_sent"
    request_received = "request_received"
    route_calculating = "route_calculating"
    route_approved = "route_approved"
    corridor_preparing = "corridor_preparing"
    corridor_active = "corridor_active"
    rerouting = "rerouting"
    completed = "completed"
    cancelled = "cancelled"


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)  # DRV-104
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(128))
    phone: Mapped[str | None] = mapped_column(String(24), nullable=True)
    role: Mapped[str] = mapped_column(String(32), default=UserRole.emergency_driver.value)
    organization_id: Mapped[str] = mapped_column(String(32), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Bumping token_version revokes every outstanding JWT (logout / revoke access).
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    vehicles: Mapped[list["EmergencyVehicle"]] = relationship(
        back_populates="assigned_driver", foreign_keys="EmergencyVehicle.driver_id"
    )


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class EmergencyVehicle(Base):
    __tablename__ = "emergency_vehicles"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)  # AMB-104
    vehicle_number: Mapped[str] = mapped_column(String(32), unique=True)
    vehicle_type: Mapped[str] = mapped_column(String(24))
    organization_id: Mapped[str] = mapped_column(String(32), index=True)
    driver_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("users.id"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(24), default="idle")  # idle|on_trip|maintenance
    verification_status: Mapped[str] = mapped_column(String(24), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    assigned_driver: Mapped[User | None] = relationship(back_populates="vehicles")


class EmergencyTrip(Base):
    __tablename__ = "emergency_trips"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)  # TRIP-20260924-0001
    vehicle_id: Mapped[str] = mapped_column(String(32), index=True)
    vehicle_type: Mapped[str] = mapped_column(String(24))
    driver_id: Mapped[str] = mapped_column(String(32), index=True)
    organization_id: Mapped[str] = mapped_column(String(32), index=True)
    emergency_type: Mapped[str] = mapped_column(String(32))
    priority: Mapped[str] = mapped_column(String(16))
    destination_name: Mapped[str] = mapped_column(String(128))
    origin_latitude: Mapped[float] = mapped_column(Float)
    origin_longitude: Mapped[float] = mapped_column(Float)
    destination_latitude: Mapped[float] = mapped_column(Float)
    destination_longitude: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(32), default=TripStatus.request_sent.value, index=True)
    completion_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    route_version: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_travelled_m: Mapped[float] = mapped_column(Float, default=0.0)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    route_plans: Mapped[list["RoutePlan"]] = relationship(back_populates="trip")
    incidents: Mapped[list["IncidentReport"]] = relationship(back_populates="trip")
    signal_plans: Mapped[list["SignalPlan"]] = relationship(back_populates="trip")


class LocationUpdate(Base):
    __tablename__ = "location_updates"
    __table_args__ = (
        UniqueConstraint("trip_id", "sequence_key", name="uq_location_sequence"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    trip_id: Mapped[str] = mapped_column(String(32), ForeignKey("emergency_trips.id"), index=True)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    accuracy_m: Mapped[float] = mapped_column(Float)
    speed_kmph: Mapped[float] = mapped_column(Float, default=0.0)
    heading: Mapped[float | None] = mapped_column(Float, nullable=True)
    battery_percent: Mapped[int | None] = mapped_column(Integer, nullable=True)
    network_status: Mapped[str] = mapped_column(String(16), default="online")
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    source: Mapped[str] = mapped_column(String(16), default="gps")
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    # Client-generated key that dedupes retried/queued offline updates.
    sequence_key: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RoutePlan(Base):
    __tablename__ = "route_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    trip_id: Mapped[str] = mapped_column(String(32), ForeignKey("emergency_trips.id"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    route_geometry: Mapped[str] = mapped_column(Text)  # JSON [[lat,lng], ...]
    estimated_time_seconds: Mapped[int] = mapped_column(Integer)
    distance_meters: Mapped[float] = mapped_column(Float)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    status: Mapped[str] = mapped_column(String(24), default="approved")
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    trip: Mapped[EmergencyTrip] = relationship(back_populates="route_plans")


class SignalPlan(Base):
    __tablename__ = "signal_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    trip_id: Mapped[str] = mapped_column(String(32), ForeignKey("emergency_trips.id"), index=True)
    junction_id: Mapped[str] = mapped_column(String(24))
    arrival_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    recommended_action: Mapped[str] = mapped_column(String(32), default="extend_green")
    planned_green_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    planned_green_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="scheduled")  # scheduled|preparing|active|cleared

    trip: Mapped[EmergencyTrip] = relationship(back_populates="signal_plans")


class IncidentReport(Base):
    __tablename__ = "incident_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    trip_id: Mapped[str] = mapped_column(String(32), ForeignKey("emergency_trips.id"), index=True)
    incident_type: Mapped[str] = mapped_column(String(32))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    severity: Mapped[str] = mapped_column(String(16), default="medium")
    road_segment: Mapped[str | None] = mapped_column(String(64), nullable=True)
    media_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    trip: Mapped[EmergencyTrip] = relationship(back_populates="incidents")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor_id: Mapped[str] = mapped_column(String(32), index=True)
    action: Mapped[str] = mapped_column(String(64))
    entity_type: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
