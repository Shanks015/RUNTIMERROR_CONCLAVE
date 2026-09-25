"""Render the operator dashboard in a real browser and assert it comes alive.

    python check_dashboard_render.py    # backend must be running on :8010

Starts a live trip as the driver, drives it a few fixes along the corridor, then
logs into /dashboard as the operator and checks the board, map and junction
table. Saves dashboard.png next to this file for eyeballing.
"""

import datetime
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8010"
HERE = pathlib.Path(__file__).parent


def call(method, path, body=None, token=None):
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


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def wait_feed(page, marker: str, timeout_ms: int = 12_000) -> str:
    """Poll the live feed until `marker` shows up, then return its text."""
    deadline = time.monotonic() + timeout_ms / 1000
    feed = ""
    while time.monotonic() < deadline:
        feed = page.inner_text("#feed")
        if marker in feed or "action failed" in feed:
            return feed
        page.wait_for_timeout(200)
    return feed


def main() -> int:
    _, op = call("POST", "/api/auth/login", {"username": "operator_1", "password": "password"})
    _, drv = call("POST", "/api/auth/login", {"username": "driver_104", "password": "password"})
    operator_token, driver_token = op["access_token"], drv["access_token"]

    status, board = call("GET", "/api/operator/trips?scope=active", None, operator_token)
    for stale in [t for t in board["trips"] if t["vehicle_id"] == "AMB-104"]:
        call("POST", f"/api/operator/trips/{stale['trip_id']}/cancel", {"reason": "render check"}, operator_token)

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

    # Walk a few plausible fixes down the corridor (each inside the anti-jump limit).
    la, lo = 12.9824, 77.6012
    for i in range(6):
        la -= 0.0006
        lo += 0.0004
        status, ack = call("POST", f"/api/emergency-trips/{trip_id}/location", {
            "latitude": round(la, 6), "longitude": round(lo, 6), "accuracy_m": 6.5,
            "speed_kmph": 42.0 + i, "heading": 165, "battery_percent": 78 - i,
            "network_status": "online", "timestamp": now(),
            "sequence_key": f"render-{i}",
        }, driver_token)
        assert status == 200 and ack["accepted"], (status, ack)
    print("6 fixes accepted")

    from playwright.sync_api import sync_playwright

    shot = HERE / "dashboard.png"
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1600, "height": 950})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        page.goto(BASE + "/dashboard", wait_until="networkidle")
        assert page.is_visible("#login"), "login panel missing"

        page.fill('input[name="username"]', "operator_1")
        page.fill('input[name="password"]', "password")
        page.click('#loginForm button[type="submit"]')
        page.wait_for_selector("#console:not(.hide)", timeout=10_000)
        print("login ok; console visible")

        page.wait_for_selector(".trip", timeout=10_000)
        rows = page.eval_on_selector_all(".trip", "els => els.map(e => e.dataset.id)")
        assert trip_id in rows, (trip_id, rows)
        print("board shows the live trip:", rows)

        page.click(f'.trip[data-id="{trip_id}"]')
        page.wait_for_timeout(1500)

        detail = page.inner_text("#detail")
        assert "City Hospital" in detail, detail
        assert "KA-01-AB-104" in detail, detail
        assert "Ravi Kumar" in detail, detail
        junctions = page.eval_on_selector_all("#junctions tbody tr", "els => els.length")
        assert junctions >= 1, f"junction table empty ({junctions} rows)"
        print(f"detail panel ok; junction rows: {junctions}")

        leaflet_ok = page.evaluate(
            "() => !!document.querySelector('#map .leaflet-tile-pane') && "
            "document.querySelectorAll('#map path').length > 0"
        )
        assert leaflet_ok, "map tiles or route polyline not rendered"
        print("map rendered with a route polyline")

        note = page.inner_text("#mapNote")
        assert "GPS" in note, note
        print("map note:", note)

        page.screenshot(path=str(shot), full_page=False)
        print("screenshot:", shot)

        # Operator actions from the UI itself.
        page.fill("#msgText", "Ambulance bay 3 is clear.")
        page.click("#btnMsg")
        feed = wait_feed(page, "message sent")
        assert "action failed" not in feed, feed
        assert "message sent" in feed, feed
        print("message action round-tripped through the UI")

        page.fill("#overrideReason", "Road blocked at J-15")
        page.click("#btnOverride")
        feed = wait_feed(page, "route override")
        assert "action failed" not in feed, feed
        assert "route override" in feed, feed
        print("override action round-tripped through the UI")

        # The override must also land on the operator's own live feed from the backend.
        assert "route_update" in feed, feed
        print("route_update arrived on the live feed")

        browser.close()

    if errors:
        print("\nbrowser errors:")
        for e in errors:
            print("  -", e)
        return 1

    call("POST", f"/api/operator/trips/{trip_id}/cancel", {"reason": "render check done"}, operator_token)
    print("\nDashboard renders and drives correctly.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
