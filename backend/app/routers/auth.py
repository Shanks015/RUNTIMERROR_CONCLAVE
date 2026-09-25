from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..database import get_db
from ..models import AuditLog, EmergencyVehicle, User
from ..schemas import LoginRequest, LogoutRequest, RefreshRequest, TokenPair
from ..security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_current_user,
    rate_limit,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
settings = get_settings()


async def _primary_vehicle_id(db: AsyncSession, user: User) -> str | None:
    result = await db.execute(
        select(EmergencyVehicle.id)
        .where(EmergencyVehicle.driver_id == user.id)
        .limit(1)
    )
    return result.scalar_one_or_none()


@router.post("/login", response_model=TokenPair)
async def login(body: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    rate_limit(request)
    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one_or_none()

    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")
    if body.organization_id and body.organization_id != user.organization_id:
        raise HTTPException(status_code=403, detail="Organization mismatch")

    vehicle_id = await _primary_vehicle_id(db, user)
    db.add(
        AuditLog(
            actor_id=user.id,
            action="login",
            entity_type="user",
            entity_id=user.id,
            detail=f"role={user.role}",
        )
    )
    await db.commit()

    return TokenPair(
        access_token=create_access_token(user, vehicle_id),
        refresh_token=create_refresh_token(user, vehicle_id),
        expires_in=settings.access_token_ttl_seconds,
        user_id=user.id,
        vehicle_id=vehicle_id,
        role=user.role,
        name=user.name,
        organization_id=user.organization_id,
    )


@router.get("/me")
async def me(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    vehicle_id = await _primary_vehicle_id(db, user)
    return {
        "user_id": user.id,
        "username": user.username,
        "name": user.name,
        "role": user.role,
        "organization_id": user.organization_id,
        "vehicle_id": vehicle_id,
        "is_active": user.is_active,
    }


@router.post("/refresh", response_model=TokenPair)
async def refresh(body: RefreshRequest, request: Request, db: AsyncSession = Depends(get_db)):
    rate_limit(request)
    payload = decode_token(body.refresh_token, "refresh")
    result = await db.execute(select(User).where(User.id == payload["sub"]))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active or user.token_version != payload.get("tv"):
        raise HTTPException(status_code=401, detail="Refresh token revoked")
    vehicle_id = await _primary_vehicle_id(db, user)
    return TokenPair(
        access_token=create_access_token(user, vehicle_id),
        refresh_token=create_refresh_token(user, vehicle_id),
        expires_in=settings.access_token_ttl_seconds,
        user_id=user.id,
        vehicle_id=vehicle_id,
        role=user.role,
        name=user.name,
        organization_id=user.organization_id,
    )


@router.post("/logout")
async def logout(body: LogoutRequest, db: AsyncSession = Depends(get_db)):
    """Increments token_version -> every issued access/refresh token dies."""
    if not body.refresh_token:
        return {"revoked": False}
    try:
        payload = decode_token(body.refresh_token, "refresh")
    except HTTPException:
        return {"revoked": False}
    result = await db.execute(select(User).where(User.id == payload["sub"]))
    user = result.scalar_one_or_none()
    if user is None:
        return {"revoked": False}
    user.token_version += 1
    db.add(
        AuditLog(
            actor_id=user.id,
            action="logout",
            entity_type="user",
            entity_id=user.id,
            detail="token_version incremented",
        )
    )
    await db.commit()
    return {"revoked": True}
