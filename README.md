# CONCLAVE

Emergency-response platform. Several projects share this repository, and the
backend is common to all of them.

## Layout

```
.
├── backend/                        FastAPI + Postgres — shared API
│   └── app/static/dashboard.html   operator console (served at /dashboard)
├── apps/
│   └── emergency-driver/           ResQConnect driver client — Flutter, Android
├── website/                        planned
└── other-app/                      planned
```

## Projects

| Project | Stack | Status |
|---|---|---|
| [Emergency driver app](apps/emergency-driver/) | Flutter (Android) | Built — [spec coverage](apps/emergency-driver/README.md#spec-coverage) |
| Website | — | Not started |
| Second mobile app | — | Not started |

## Backend

Shared by every project; currently it serves the driver app only.

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
cd backend
python check_operator_flow.py       # REST + WebSocket delivery, authorization boundary
python check_dashboard_render.py    # drives the page in headless Chromium, writes dashboard.png
```
