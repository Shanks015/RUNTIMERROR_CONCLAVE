"""Seed demo data: one org, one verified driver, one verified ambulance.

Run: python -m app.seed
"""

import asyncio

from sqlalchemy import select

from .database import SessionLocal, init_db
from .models import EmergencyVehicle, Organization, User
from .security import hash_password

DEMO_DRIVER = {
    "id": "DRV-104",
    "username": "driver_104",
    "password": "password",
    "name": "Ravi Kumar",
    "phone": "+919876543210",
    "role": "emergency_driver",
    "organization_id": "ORG-CITY-HOSPITAL",
}

DEMO_VEHICLE = {
    "id": "AMB-104",
    "vehicle_number": "KA-01-AB-104",
    "vehicle_type": "ambulance",
    "organization_id": "ORG-CITY-HOSPITAL",
    "driver_id": "DRV-104",
    "status": "idle",
    "verification_status": "verified",
}

DEMO_ORG = {"id": "ORG-CITY-HOSPITAL", "name": "City Hospital"}

# Control-center console login (role gates /api/operator/*).
DEMO_OPERATOR = {
    "id": "OPR-001",
    "username": "operator_1",
    "password": "password",
    "name": "Anita Menon",
    "phone": "+919876500001",
    "role": "central_operator",
    "organization_id": "ORG-CITY-HOSPITAL",
}

# A second vehicle with no driver, for the vehicle-selection screen.
SPARE_VEHICLE = {
    "id": "FIRE-22",
    "vehicle_number": "KA-01-FR-022",
    "vehicle_type": "fire_truck",
    "organization_id": "ORG-CITY-HOSPITAL",
    "driver_id": None,
    "status": "idle",
    "verification_status": "verified",
}


async def seed() -> None:
    await init_db()
    async with SessionLocal() as db:
        org = (await db.execute(
            select(Organization).where(Organization.id == DEMO_ORG["id"])
        )).scalar_one_or_none()
        if org is None:
            db.add(Organization(**DEMO_ORG))

        driver = (await db.execute(
            select(User).where(User.username == DEMO_DRIVER["username"])
        )).scalar_one_or_none()
        if driver is None:
            fields = {k: v for k, v in DEMO_DRIVER.items() if k != "password"}
            db.add(User(**fields, password_hash=hash_password(DEMO_DRIVER["password"])))

        operator = (await db.execute(
            select(User).where(User.username == DEMO_OPERATOR["username"])
        )).scalar_one_or_none()
        if operator is None:
            fields = {k: v for k, v in DEMO_OPERATOR.items() if k != "password"}
            db.add(User(**fields, password_hash=hash_password(DEMO_OPERATOR["password"])))

        for vehicle in (DEMO_VEHICLE, SPARE_VEHICLE):
            existing = await db.get(EmergencyVehicle, vehicle["id"])
            if existing is None:
                db.add(EmergencyVehicle(**vehicle))

        await db.commit()
        print(
            "Seeded: org ORG-CITY-HOSPITAL, driver_104/password (DRV-104), "
            "operator_1/password (OPR-001), vehicles AMB-104, FIRE-22"
        )


if __name__ == "__main__":
    asyncio.run(seed())
