# ResQConnect — Emergency Vehicle Driver App

Driver-side emergency vehicle client for a central traffic-management system.
The app sends authenticated location, destination, emergency type and priority
to the backend and renders the corridor plan the operator sends back — it
never controls traffic signals itself.

```
emergency-driver-app/
├── backend/     FastAPI + Supabase Postgres (JWT, WebSockets, mock route agent)
│   └── app/static/dashboard.html   operator console (served at /dashboard)
└── driver_app/  Flutter Android client (GPS foreground service, live route feed)
```

What's built against the spec — MVP, V2, V3, acceptance criteria, security,
privacy, notifications, accessibility: **[Spec coverage](#spec-coverage)**.

## Backend

```powershell
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8010
```

- Runs against a Supabase Postgres instance. The connection string is **not** in
  the repo — copy `backend/.env.example` to `backend/.env` and fill it in, or set
  the `DATABASE_URL` environment variable. The app fails loudly at boot if it's
  missing rather than falling back to a placeholder.
- Schema is created on startup; demo data: `python -m app.seed`.
- API docs: http://localhost:8010/api/docs

Demo accounts:

| Role | Login | Use |
|---|---|---|
| Emergency driver | **driver_104 / password** | vehicle **AMB-104** (City Hospital) |
| Central operator | **operator_1 / password** | the `/dashboard` console |

Key endpoints beyond the base trip lifecycle:

| Endpoint | Purpose |
|---|---|
| `GET /api/auth/me` | Who am I (user id, role, assigned vehicle) |
| `GET /api/vehicles/assigned` | Alias of the vehicle list for the assigned-vehicle flow |
| `POST /api/emergency-trips/{id}/reroute` | Driver reroute; bumps route version, returns `old_eta_seconds` + `reason` over WS |
| `POST /api/emergency-trips/{id}/complete` | Accepts `completed / cancelled / diverted / patient_transferred / vehicle_issue / other` in `completion_status`; summary includes original vs final ETA |
| `POST /api/emergency-trips/{id}/incidents` | Optional `road_segment` field; `need_assistance` opens a human-assistance ticket |

### Operator API (role `central_operator`)

| Endpoint | Purpose |
|---|---|
| `GET /api/operator/trips?scope=active\|all` | Live board: every trip with latest fix, route, junction plan, remaining distance |
| `GET /api/operator/trips/{id}` | One trip, same payload |
| `POST /api/operator/trips/{id}/route` | `{"action":"approve"}` or `{"action":"override","reason":…,"eta_scale":0.5–1.5}` — override bumps the route version, rebuilds the junction plan and pushes `route_update` |
| `POST /api/operator/trips/{id}/message` | `{"text":…,"urgency":"info\|urgent"}` → `operator_message` on the driver feed |
| `POST /api/operator/trips/{id}/cancel` | Releases junction priority, closes the trip, pushes `route_cancelled` |

Drivers are rejected with 403 on every one of these.

### Operator dashboard

Open **http://localhost:8010/dashboard** and sign in as `operator_1`.

Single static page — no build step, no node. Left rail lists open trips, the map
draws the vehicle and the approved route, the right rail carries the trip detail,
the junction table and the control actions. Refreshes every 3 s and holds a
WebSocket open on the selected trip, so operator decisions appear on the driver's
phone immediately.

Two checks run against a live backend:

```powershell
python check_operator_flow.py       # REST + WebSocket delivery, authorization boundary
python check_dashboard_render.py    # drives the page in headless Chromium, writes dashboard.png
```

## Mobile app

```powershell
cd driver_app
flutter run          # device connected
# or install the built APK:
adb install build\app\outputs\flutter-apk\app-release.apk
```

- Backend URL defaults to `http://10.63.71.37:8010` (this machine's LAN IP).
  Change it from the login screen → "Server address" if your network differs.
- Phone and PC must share a network. This machine currently reaches the phone
  over the phone's own hotspot, so no Wi-Fi AP is needed.
- No cable? Serve the APK over that hotspot and install from the phone's browser:
  ```powershell
  cd build\app\outputs\flutter-apk
  python -m http.server 8080     # then open http://10.63.71.37:8080/app-release.apk
  ```
  Allow "install unknown apps" for the browser when prompted.

### Screens

1. **Splash** — brand + backend health check, then login / home / resume trip.
2. **Login** — credentials, server address, *Forgot password* and *Contact
   administrator* dialogs, precise error copy (bad credentials / disabled
   account / server unreachable).
3. **Home** — driver name, vehicle number + Ready/On-trip chip, GPS / network /
   battery / control-center status, start trip, report incident, trip history,
   assistance, menu with switch vehicle / log out.
4. **Start trip** — emergency type, priority, destination **search** over saved
   presets and on-device recents, map pin, optional destination contact,
   route restriction and notes → *Review request*.
5. **Confirmation** — full request summary + privacy note before anything is
   sent; Confirm / Edit / Cancel.
6. **Processing** — staged checklist (request sent → vehicle verified → traffic
   → route → junctions → central approval); rejects land on an explanation
   panel with Retry / Edit; approval auto-advances to the active trip.
7. **Active trip** — ETA, remaining km, speed, GPS accuracy, direction, route
   segment, confidence, junction count; Re-route, Junctions, Incident,
   Assistance and End-trip actions.
8. **Junction panel** — bottom sheet table: junction, arrival time, signal
   status with colour coding.
9. **Route-update banner** — when the operator changes the route: reason, old →
   new ETA, *Accept new route / View reason / Contact center*.
10. **Cancellation banner** — if the control center kills the corridor: a red
    blocking banner naming the reason. Junction priority is already cleared, so
    the app drops the junction plan and stops GPS on acknowledgement rather
    than leaving a dead route on screen.
11. **Assistance** — call the control center, in-app assistance request,
    share current location.
12. **End trip** — reason list (Completed, Cancelled, Diverted, Patient
    transferred, Vehicle issue, Other) + the required confirmation dialog.
13. **Trip history** — past trips with status, end reason, tap for detail.
14. **Trip summary** — duration, distance, original vs final ETA, route
    changes, incidents, junctions, signal-plan state.

## Demo flow

1. Log in as `driver_104`.
2. Select **AMB-104** → Continue.
3. Home screen shows GPS / network / battery / control-center status.
4. **Start emergency trip** → search or tap *City Hospital* → *Review request*.
5. Confirmation → *Confirm and request route* → watch the approval checklist.
6. Active trip: live route, speed/direction/segment, junctions, status feed.
7. **Junctions** → signal panel. **Re-route** → pick a reason → the backend
   bumps the route version and the banner shows the old → new ETA.
8. **End trip** → pick a reason → summary with original vs final ETA.
9. **Home → Trip history** shows the closed trip with its end reason.

### With the operator console open

Keep `/dashboard` open on the PC while driving:

- The trip appears on the board within one refresh, with the vehicle moving.
- **Override route** (with a reason) → the phone shows the route-update banner.
- **Send message** → the message lands in the phone's feed, urgent ones buzz.
- **Cancel route** → the phone shows the blocking cancellation banner and stops
  tracking once acknowledged; junctions stop claiming priority.

## Spec coverage

Against the build spec. ✅ done and exercised · 🟡 partial · ❌ not built.

### §16 MVP

| # | Item | | Where |
|---|---|---|---|
| 1 | Login | ✅ | `login_screen.dart`, `POST /api/auth/login` |
| 2 | Vehicle verification | ✅ | `vehicle_select_screen.dart`; server rejects unregistered/mismatched |
| 3 | Destination selection | ✅ | `start_trip_screen.dart` — preset search, on-device recents, map pin |
| 4 | Start-trip request | ✅ | `POST /api/emergency-trips` |
| 5 | Live GPS transmission | ✅ | 4 s foreground service → `POST …/location` |
| 6 | Map-based route display | ✅ | `active_trip_screen.dart` via flutter_map |
| 7 | ETA | ✅ | Live ETA + remaining km, updated from each ack |
| 8 | Central-dashboard tracking | ✅ | `/dashboard`; `check_dashboard_render.py` proves the vehicle draws |
| 9 | Route-update notification | ✅ | Banner with old → new ETA + local notification |
| 10 | End-trip function | ✅ | `trip_complete_screen.dart` |

### §17 Version 2

| # | Item | | Where |
|---|---|---|---|
| 1 | Incident reporting | ✅ | `incident_screen.dart`, `POST …/incidents` |
| 2 | GPS confidence | ✅ | `location_confidence` on every ack, shown on the active-trip screen |
| 3 | Offline tracking | ✅ | Sequence-keyed queue, persisted, replayed on reconnect |
| 4 | Upcoming-junction list | ✅ | Junction panel bottom sheet |
| 5 | Green-corridor status | ✅ | Status feed + `corridor_active` chip |
| 6 | Operator messaging | ✅ | `POST /api/operator/trips/{id}/message` → driver feed |
| 7 | Trip history | ✅ | `trip_history_screen.dart` + trip summary |
| 8 | Multiple emergency-vehicle support | ✅ | Per-driver vehicle list, ambulance/fire/police/organ types |

### §18 Version 3

Not started, by design — the MVP and V2 scope is what the acceptance criteria test.

| # | Item | | |
|---|---|---|---|
| 1 | Voice input | ❌ | |
| 2 | Kannada / Hindi | ❌ | Strings are English-only |
| 3 | Route-risk explanation | ❌ | Reroutes carry a reason string, not a risk model |
| 4 | Driver feedback | ❌ | |
| 5 | Multiple route alternatives | ❌ | One approved route at a time |
| 6 | Signal-agent simulator integration | 🟡 | `mock_route.py` / `mock_control.py` stand in; the real agents are not wired |
| 7 | Performance analytics | ❌ | |

### §19 Acceptance criteria

All fourteen pass against the live backend. The ones with a check behind them are
named; the rest are covered by `check_operator_flow.py` and the widget tests.

| Criterion | | Verified by |
|---|---|---|
| Registered driver can log in | ✅ | `check_operator_flow.py` |
| Only authorized vehicles selectable | ✅ | Server-side vehicle/driver match |
| Destination selectable on a map | ✅ | Manual + render check |
| Emergency trip can be created | ✅ | `check_operator_flow.py` |
| GPS updates reach the backend | ✅ | Ack with confidence + ETA |
| Central dashboard shows vehicle position | ✅ | `check_dashboard_render.py` — asserts the route polyline renders |
| Driver receives route and ETA | ✅ | Approve → `corridor_preparing` |
| Simulated congestion triggers a route update | ✅ | Override raises ETA and bumps `route_version`; WS frame asserted |
| Driver can report a road blockage | ✅ | Incident flow, `road_segment` attached |
| App works during temporary network loss | ✅ | Queue + replay on reconnect |
| Driver can end the trip | ✅ | All six completion statuses |
| Central system receives final trip status | ✅ | Trip summary on the operator detail panel |
| No tracking after trip completion | ✅ | Tracker stops on complete/cancel and on 404/409 |
| Unauthorized trip requests rejected | ✅ | Driver token → 403 on every `/api/operator/*` route |

### §12 Security

✅ JWT · role-based access · registered-vehicle verification · token expiry
(15 min / 7 d) · Keystore token storage · sliding-window rate limiting ·
`audit_logs` table (login, refresh, logout, every operator action) · server-side
validation · logout with `token_version` revocation.

Server rejects all seven listed classes: unknown vehicles, unauthorized drivers,
expired trips, duplicate requests, impossible GPS jumps (>60 m), unauthorized
priority levels, invalid tokens.

🟡 **HTTPS** — the API speaks plain HTTP. Correct for a LAN demo, and the
transport requirement in §12 is otherwise unmet.
🟡 **OWASP MASVS** — storage, auth and network items are addressed; no formal
privacy or penetration pass has been run.

### §13 Privacy

✅ Collects only driver identity, vehicle identity, active-trip GPS, destination,
emergency category and trip status. ✅ No patient name, medical history, or
unnecessary contacts anywhere in the schema. ✅ No location outside an active
trip — the foreground service starts with the trip and stops with it.

❌ **Retention period** — the spec asks for one and there is no purge job. GPS
history accumulates in `location_updates` indefinitely.

### §14 Notifications

✅ Route approved · route changed · signal plan prepared · signal plan active ·
control center message · GPS lost · network lost · trip completed.
🟡 Signal plan failed and accident-ahead have no dedicated event; both surface
through the incident feed rather than their own notification.
✅ Urgent events use sound and vibration, and nothing fires a modal while driving.

### §15 Accessibility

✅ Large driver-friendly controls, high contrast, short instructions, no deep
menus during an active trip. ✅ Signal status never relies on color alone — every
chip carries its label (`Preparing`, `Active`, `Failed`).

🟡 Screen-reader coverage is thin — a handful of `Semantics` labels, not a pass.

## Known gaps

- **Vehicle-admin console** (§4) — no way to register vehicles, assign drivers,
  disable accounts, or change a vehicle's type from the UI. `seed.py` is the only
  path in.
- **Incident media** — `media_url` is accepted and stored, but nothing captures a
  photo or voice note; the app has no camera or recorder dependency.
- **Junction coordinates** — the route payload carries `junction_id`,
  `arrival_in_seconds` and `signal_status`, but no latitude/longitude, so
  junctions cannot be pinned on either map.
- **GPS retention** — no purge job (see §13 above).
- **Release signing** — `flutter build apk --release` currently falls back to the
  debug keystore. Fine for sideloading, not for distribution.

## Behaviour notes

- GPS updates every 4 s through a foreground service (persistent notification).
- Offline fixes queue locally with sequence keys and replay on reconnect;
  the queue badge shows on the active-trip screen. A trip the server has
  already closed (404/409) ends tracking instead of queueing into a dead trip.
- Local notifications (sound + vibration) fire for route changes, corridor
  status, incidents and GPS/network transitions.
- JWT access token (15 min) + refresh token (7 d) in Android Keystore;
  logout bumps `token_version` server-side, revoking every outstanding token.
- Backend rejects: unverified vehicles, driver/vehicle mismatch, duplicate
  trips, impossible GPS jumps, stale timestamps, and critical priority on
  non-life-critical emergency types.
- No patient name, diagnosis, or medical records are collected. Location
  tracking runs only during an authorized trip. Recents are stored on-device
  only.
