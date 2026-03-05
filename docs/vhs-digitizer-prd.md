# VHS Digitizer — Product Requirements Document

**Version:** 1.0 — Draft  
**Date:** March 2026  
**Stack:** FastAPI (Python) · React · SQLite · OBS WebSocket

---

## 1. Product Overview

VHS Digitizer is a locally-hosted web application that helps users manage, coordinate, and track the conversion of physical VHS tape collections into digital video files. The application acts as a control plane between the user and OBS Studio, bridging the inherently manual process of loading tapes with a structured, trackable workflow accessible from any device on the local network.

Because digitizing VHS is a real-time process (a 2-hour tape requires 2 hours of recording), the system must gracefully handle long-running sessions, provide remote monitoring, and maintain persistent progress records across days or weeks of work.

### 1.1 Goals

- Provide a structured catalog for managing a VHS tape collection throughout the digitization process
- Automate OBS recording start/stop and output file naming via the OBS WebSocket API
- Enable remote monitoring and control from any device on the local network
- Track overall progress with at-a-glance status across the entire collection

### 1.2 Non-Goals

- The application will not control VHS player hardware (play, rewind, stop)
- The application will not perform video transcoding or post-processing
- The application will not support cloud storage or off-network remote access
- The application will not auto-detect tape changes or tape end

---

## 2. System Architecture

VHS Digitizer runs entirely on a single local capture machine as a three-tier application:

```
Browser (any device on LAN)
        ↕  HTTP REST + WebSocket
FastAPI Backend  ←→  SQLite (vhs.db)
        ↕  OBS WebSocket v5 (localhost:4455)
OBS Studio (same machine)
```

The React frontend is either served by a separate Vite dev server (development) or built as a static bundle and served directly by FastAPI (production). In production mode, navigating to `http://<capture-pc-ip>:8000` from any device on the network is sufficient to access the application.

---

## 3. Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React (Vite) | Single-page application |
| Backend | FastAPI (Python 3.9+) | REST API + WebSocket server |
| Database | SQLite | Single-file, no separate DB process |
| OBS integration | `simpleobsws` Python library | OBS WebSocket v5 protocol |
| Dev proxy | Vite proxy config | Forwards `/api` and `/ws` to FastAPI in dev |

---

## 4. Data Model

### 4.1 `tapes` Table

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `label` | TEXT (required) | Human-readable tape name, e.g. "Christmas 1994" |
| `description` | TEXT | Brief content description |
| `duration_minutes` | INTEGER | Expected tape runtime |
| `content_date` | TEXT | Approximate date of recorded content |
| `status` | TEXT | `pending`, `recording`, `done`, or `skipped` |
| `output_file` | TEXT | Absolute path to the final digitized file |
| `notes` | TEXT | Free-form notes (condition, content details, etc.) |
| `created_at` | TEXT | ISO timestamp, set on creation |
| `recorded_at` | TEXT | ISO timestamp, set when recording stops |

### 4.2 `settings` Table

Key-value store for persisted application configuration. Default keys:

| Key | Default | Description |
|---|---|---|
| `obs_host` | `localhost` | OBS WebSocket host |
| `obs_port` | `4455` | OBS WebSocket port |
| `obs_password` | _(empty)_ | OBS WebSocket password |
| `output_dir` | `~/vhs-recordings` | Directory where recordings are saved |

---

## 5. Backend Requirements

### 5.1 REST API

#### Tapes

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/tapes` | List all tapes; optional `?status=` filter |
| POST | `/api/tapes` | Create a new tape record |
| PUT | `/api/tapes/{id}` | Update tape metadata or status |
| DELETE | `/api/tapes/{id}` | Delete a tape record (does not delete the output file) |

#### Stats

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/stats` | Return aggregate counts and runtime totals |

The stats response must include: `total`, `pending`, `recording`, `done`, `skipped`, `total_minutes`, `done_minutes`, and `pct_complete`.

#### Settings

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/settings` | Return all settings as a key-value object |
| PUT | `/api/settings` | Update one or more settings |

#### OBS Control

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/obs/status` | Return OBS connection state |
| POST | `/api/obs/connect` | Connect to OBS WebSocket (body: `host`, `port`, `password`) |
| POST | `/api/obs/disconnect` | Disconnect from OBS |

#### Recording Control

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/recording/start` | Start recording for a given `tape_id` |
| POST | `/api/recording/stop` | Stop the active recording and finalize the file |
| POST | `/api/recording/pause` | Pause the active recording |
| POST | `/api/recording/resume` | Resume a paused recording |
| GET | `/api/recording/status` | Return current recording state and elapsed time |

### 5.2 WebSocket Endpoint

**Endpoint:** `/ws`

The backend broadcasts a `status_update` event to all connected clients every 2 seconds containing:

- `obs_connected` — boolean
- `is_recording` — boolean
- `is_paused` — boolean
- `duration_ms` — elapsed recording time in milliseconds
- `tape_id` — ID of the tape currently recording, or `null`

The backend also broadcasts event notifications to all clients on:

- `recording_started` — when a recording begins (includes `tape_id`, `tape_label`)
- `recording_stopped` — when a recording is finalized (includes `tape_id`, `output_file`)

Clients should reconnect automatically if the WebSocket connection drops.

### 5.3 OBS Integration

The backend wraps the OBS WebSocket v5 protocol with an async controller class exposing the following operations:

- `connect(host, port, password)` — establish and identify the WebSocket connection
- `disconnect()` — cleanly close the connection
- `start_recording()` — send `StartRecord` request
- `stop_recording()` — send `StopRecord` request
- `pause_recording()` — send `PauseRecord` request
- `resume_recording()` — send `ResumeRecord` request
- `get_recording_status()` — send `GetRecordStatus` and return active/paused/duration/bytes
- `set_record_directory(path)` — send `SetRecordDirectory` before each recording

### 5.4 Recording Lifecycle

When a recording is stopped, the backend must:

1. Wait briefly (≥1 second) for OBS to finalize the output file
2. Locate the most recently modified video file in the configured output directory (`.mkv`, `.mp4`, or `.mov`)
3. Rename the file to `{SafeLabel}_{YYYYMMDD_HHMMSS}{ext}`, where `SafeLabel` is the tape label with non-alphanumeric characters removed
4. Update the tape record: set `status` to `done`, `recorded_at` to the current timestamp, and `output_file` to the new absolute path
5. Broadcast a `recording_stopped` event over WebSocket

### 5.5 Production Static File Serving

When a built frontend bundle exists at `../frontend/dist`, FastAPI must mount it as a static site at `/` and serve `index.html` for all unmatched routes (SPA fallback).

---

## 6. Frontend Requirements

### 6.1 Layout & Navigation

The application is a single-page app with a persistent top navigation bar and a tab-based main content area. The nav bar must always display:

- Application name and logo
- Live OBS connection status indicator
- Active recording indicator (animated when recording is in progress)
- WebSocket connectivity state (live / offline)

Navigation tabs:

- **Dashboard**
- **Tape Library**
- **Record**
- **OBS Settings**

The Record tab must display a visual indicator when a recording is actively in progress.

### 6.2 Dashboard

The Dashboard is the default landing view and must display:

- Stat cards for: Total Tapes, Pending, Done, Skipped, Total Runtime, and Digitized Runtime
- An overall progress bar showing percentage of tapes completed by count
- Secondary progress label showing runtime digitized vs. total runtime
- A "Next Pending" panel showing the next unrecorded tape with a quick-launch button to begin recording (disabled if OBS is not connected)
- A "Recently Digitized" panel listing the 5 most recently completed tapes

If a recording is currently active, a persistent alert banner must be shown at the top of the Dashboard indicating the tape name and live elapsed time.

### 6.3 Tape Library

The Tape Library is a full CRUD interface for managing tape records. Requirements:

- Display all tapes in a table with columns: ID, Label, Description, Duration, Content Date, Status, Actions
- Filter tapes by status via a tab/pill bar: All, Pending, Recording, Done, Skipped
- Each tape row must offer: Start Recording (pending only), Edit, Skip/Unskip, Delete
- Tapes with status `recording` must not be editable or deletable while recording is active
- An Add Tape button opens a modal form with fields: Label (required), Description, Duration (minutes), Content Date, Notes
- Deleting a tape requires a confirmation dialog; it removes only the database record, not the output file
- The table must refresh automatically when `vhs:refresh` events are received (i.e., when a recording starts or stops)

### 6.4 Recording Session

The Recording Session tab is the primary operational interface. Requirements:

- A dropdown selector populated with all `pending` tapes
- A detail panel showing metadata for the selected tape (label, description, duration, content date, notes)
- Controls: Start Recording, Pause/Resume, Stop & Save
  - Start is disabled if no tape is selected or OBS is not connected
  - Pause/Resume is visible only when a recording is in progress for the selected tape
  - Stop is disabled when no recording is active
- A live elapsed time display formatted as `HH:MM:SS`, updated in real time from WebSocket status updates
- If the tape has an expected duration, a progress bar showing elapsed time vs. expected duration
- When elapsed time exceeds expected duration, the timer and progress bar must change color to indicate overtime
- If a recording is active for a different tape, a warning must be shown preventing the user from starting a new one

### 6.5 OBS Settings

The OBS Settings tab allows the user to configure and test the OBS connection. Requirements:

- Form fields for OBS Host, Port, and Password
- Connect and Disconnect buttons reflecting the current connection state
- A visible connection status indicator (connected / disconnected)
- An output directory field for configuring where recordings are saved
- A Save Settings button that persists all settings to the backend
- An inline OBS setup guide explaining how to enable the WebSocket server in OBS Studio

---

## 7. Non-Functional Requirements

### 7.1 Accessibility & Remote Use

- The application must be accessible from any browser on the local network by navigating to `http://<host-ip>:8000` in production mode
- The UI must be usable on mobile screen sizes (minimum 375px width)

### 7.2 Reliability

- The frontend WebSocket client must automatically attempt reconnection when the connection is lost, with a retry interval of no more than 5 seconds
- All API errors must be surfaced to the user with a visible, dismissible error message
- The backend must handle OBS disconnection gracefully; API calls to OBS while disconnected must return a structured error rather than crash

### 7.3 Persistence

- All tape records and settings must persist across application restarts via SQLite
- The database file must be created automatically on first run if it does not exist
- Default settings must be seeded on first run

### 7.4 Security

- The application is designed for trusted local network use only and requires no authentication
- OBS WebSocket password is stored in the settings table and transmitted only over the local loopback interface

---

## 8. Setup & Deployment

### 8.1 Development Mode

```bash
# Terminal 1 — Backend
cd backend
pip install -r requirements.txt
python main.py              # Runs on http://0.0.0.0:8000

# Terminal 2 — Frontend
cd frontend
npm install
npm run dev                 # Runs on http://localhost:5173, proxies /api and /ws to :8000
```

### 8.2 Production Mode

```bash
cd frontend && npm run build    # Outputs to frontend/dist/
cd backend && python main.py    # Serves API + built frontend at http://0.0.0.0:8000
```

Access from any device on the local network at `http://<capture-pc-ip>:8000`.

### 8.3 OBS Prerequisites

1. OBS Studio v28 or later (WebSocket server is built-in from v28)
2. Tools → WebSocket Server Settings → Enable, port 4455
3. USB capture card added as a Video Capture Device source in OBS
4. Audio input configured for RCA channels
5. Output format set to MKV (Settings → Output → Recording)

---

## 9. File & Directory Structure

```
vhs-digitizer/
├── backend/
│   ├── main.py               # FastAPI app, all routes, WebSocket, recording lifecycle
│   ├── obs.py                # Async OBS WebSocket controller
│   ├── requirements.txt      # Python dependencies
│   └── vhs.db                # SQLite database (auto-created)
└── frontend/
    ├── package.json
    ├── vite.config.js        # Dev proxy config
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx           # Layout, nav, WebSocket connection
        ├── index.css         # Global styles
        ├── api.js            # API client + WebSocket factory
        └── components/
            ├── Dashboard.jsx
            ├── TapeLibrary.jsx
            ├── RecordingSession.jsx
            └── OBSSettings.jsx
```
