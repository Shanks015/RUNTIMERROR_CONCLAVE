"""End-to-end check of the operator console API against a running backend.

    python -m uvicorn app.main:app --port 8010      # in another shell
    python check_operator_flow.py

Drives a real trip from the driver side, then walks every operator action and
asserts the results — including the authorization boundary (a driver token must
not reach /api/operator/*).
"""

import asyncio
import datetime
import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8010"


def call(method: str, path: str, body=None, token: str | None = None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=20) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def main() -> int:
    status, op = call("POST", "/api/auth/login", {"username": "operator_1", "password": "password"})
    assert status == 200, (status, op)
    assert op["role"] == "central_operator", op
    operator_token = op["access_token"]
    print("operator:", op["user_id"], op["role"], op["organization_id"])

    status, drv = call("POST", "/api/auth/login", {"username": "driver_104", "password": "password"})
    assert status == 200, (status, drv)
    driver_token = drv["access_token"]

    # Re-runnable: a vehicle can only hold one open trip, so clear any leftover
    # before starting (this also exercises operator cancel on a real trip).
    status, board = call("GET", "/api/operator/trips?scope=active", None, operator_token)
    assert status == 200, (status, board)
    for stale in [t for t in board["trips"] if t["vehicle_id"] == "AMB-104"]:
        call("POST", f"/api/operator/trips/{stale['trip_id']}/cancel",
             {"reason": "cleared by check_operator_flow"}, operator_token)
        print("cleared stale trip:", stale["trip_id"])

    status, trip = call("POST", "/api/emergency-trips", {
        "vehicle_id": "AMB-104", "vehicle_type": "ambulance",
        "emergency_type": "critical_medical", "priority": "critical",
        "destination": {"name": "City Hospital", "latitude": 12.9350, "longitude": 77.6245},
        "location": {"latitude": 12.9824, "longitude": 77.6012, "accuracy_m": 7.0,
                     "speed_kmph": 0.0, "network_status": "online", "timestamp": now()},
    }, driver_token)
    assert status == 201, (status, trip)
    trip_id = trip["trip_id"]
    print("trip:", trip_id)

    # ~45 m from the origin fix at 44 km/h — inside the 60 m anti-jump tolerance,
    # so this reads as a real GPS update rather than a spoofed teleport.
    status, ack = call("POST", f"/api/emergency-trips/{trip_id}/location", {
        "latitude": 12.9820, "longitude": 77.6015, "accuracy_m": 6.0, "speed_kmph": 44.0,
        "heading": 190, "battery_percent": 81, "network_status": "online",
        "timestamp": now(), "sequence_key": "check-1",
    }, driver_token)
    assert status == 200 and ack["accepted"], (status, ack)
    print("location accepted, confidence", ack["location_confidence"])

    status, body = call("GET", "/api/operator/trips", None, driver_token)
    assert status == 403, ("driver reached the operator API", status, body)
    print("driver token rejected on /api/operator/trips: 403")

    status, board = call("GET", "/api/operator/trips", None, operator_token)
    assert status == 200, (status, board)
    entry = next((t for t in board["trips"] if t["trip_id"] == trip_id), None)
    assert entry, "driver's trip missing from the operator board"
    assert entry["fix"] and abs(entry["fix"]["latitude"] - 12.9820) < 1e-6, entry["fix"]
    assert entry["route"], "board payload carries no route"
    print(f"board: fix ok, route v{entry['route']['version']}, "
          f"{len(entry['priority_junctions'])} junctions, remaining {entry['remaining_m']} m")

    status, out = call("POST", f"/api/operator/trips/{trip_id}/route", {"action": "approve"}, operator_token)
    assert status == 200 and out["accepted"], (status, out)
    print("approve ->", out["status"])

    status, out = call("POST", f"/api/operator/trips/{trip_id}/route",
                       {"action": "override", "reason": "Accident at J-12", "eta_scale": 1.2}, operator_token)
    assert status == 200, (status, out)
    assert out["eta_seconds"] > out["old_eta_seconds"], out
    assert out["route_version"] > entry["route_version"], out
    print(f"override -> v{out['route_version']} eta {out['old_eta_seconds']} -> {out['eta_seconds']} s")

    # The dashboard is only useful if its decisions actually reach the vehicle,
    # so listen on the driver's own feed while the operator works.
    asyncio.run(drive_feed(trip_id, driver_token, operator_token))

    status, out = call("POST", f"/api/operator/trips/{trip_id}/cancel", {"reason": "again"}, operator_token)
    assert status == 409, ("double cancel allowed", status, out)

    status, out = call("GET", f"/api/emergency-trips/{trip_id}", None, driver_token)
    assert out["status"] == "cancelled", out
    print("double cancel rejected 409; driver side sees:", out["status"])

    print("\nAll operator checks passed.")
    return 0


async def drive_feed(trip_id: str, driver_token: str, operator_token: str) -> None:
    """Operator actions must land on the driver's WebSocket as typed frames."""
    import websockets

    url = f"ws://127.0.0.1:8010/ws/emergency-trips/{trip_id}?token={driver_token}"
    async with websockets.connect(url) as ws:
        snapshot = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
        assert snapshot["type"] == "snapshot", snapshot
        assert snapshot["trip_id"] == trip_id, snapshot
        print(f"driver feed open (snapshot: {snapshot['status']}, "
              f"{len(snapshot['priority_junctions'])} junctions)")

        status, _ = call("POST", f"/api/operator/trips/{trip_id}/message",
                         {"text": "Ambulance bay 3 is clear.", "urgency": "urgent"}, operator_token)
        assert status == 200, status
        frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
        assert frame["type"] == "operator_message", frame
        assert frame["message"] == "Ambulance bay 3 is clear.", frame
        print("driver received operator_message:", frame["message"])

        status, sent = call("POST", f"/api/operator/trips/{trip_id}/route",
                            {"action": "override", "reason": "Road blocked at J-15",
                             "eta_scale": 0.8}, operator_token)
        assert status == 200, status
        frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
        assert frame["type"] == "route_update", frame
        assert frame["reason"] == "Road blocked at J-15", frame
        assert frame["eta_seconds"] == sent["eta_seconds"], (frame, sent)
        assert frame["old_eta_seconds"] == sent["old_eta_seconds"], (frame, sent)
        print(f"driver received route_update: {frame['old_eta_seconds']} -> "
              f"{frame['eta_seconds']} s, {len(frame['priority_junctions'])} junctions")

        status, _ = call("POST", f"/api/operator/trips/{trip_id}/cancel",
                         {"reason": "Patient moved to another unit"}, operator_token)
        assert status == 200, status
        frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
        assert frame["type"] == "route_cancelled", frame
        assert frame["status"] == "cancelled", frame
        print("driver received route_cancelled:", frame["reason"])


if __name__ == "__main__":
    sys.exit(main())
