# VHS Digitizer

A locally-hosted web application for managing the digitization of a VHS tape collection. Provides a structured catalog, automates OBS Studio recording via WebSocket, and tracks progress across the full collection. Accessible from any device on the local network.

## Prerequisites

| Tool | Purpose |
|---|---|
| Python 3.11+ | Backend runtime |
| [uv](https://docs.astral.sh/uv/) | Python dependency management |
| Node.js 20+ | Frontend build |
| OBS Studio v28+ | Video capture (WebSocket server must be enabled) |
| FFmpeg + FFprobe | Duration detection and chapter export |

Install FFmpeg on Ubuntu:
```bash
sudo apt install ffmpeg
```

## Development Setup

### 1. Clone and install hooks

```bash
git clone <repo-url>
cd vhs-digitizer
uv tool install pre-commit
pre-commit install
```

### 2. Backend

```bash
cd backend
uv sync --dev
uv run python main.py
# Listening on http://0.0.0.0:8000
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
# Listening on http://localhost:5173
# /api and /ws are proxied to :8000
```

Open `http://localhost:5173` in a browser.

## Running Tests

```bash
# Backend
cd backend && uv run pytest

# Frontend
cd frontend && npm test -- --run
```

## OBS Setup

1. Open OBS → Tools → WebSocket Server Settings
2. Enable the server, port `4455`
3. Add a Video Capture Device source for the USB capture card
4. Configure audio input for RCA channels
5. Set output format to MKV (Settings → Output → Recording)

Then connect from the OBS Settings tab in the app.

## Production Build

```bash
cd frontend && npm run build
cd backend && uv run python main.py
# Serves API + frontend at http://0.0.0.0:8000
```

## Packaging

To build a Debian package for Ubuntu:

```bash
./packaging/build-deb.sh 1.0.0
sudo apt install ./packaging/vhs-digitizer_1.0.0_amd64.deb
```

See [docs/packaging.md](docs/packaging.md) for full details on install layout, the systemd service, and upgrade/removal.

## Releases

Releases are automated via semantic-release on every push to `main` that contains releasable commits. Version bumps follow conventional commits:

| Commit prefix | Bump |
|---|---|
| `fix:` | patch |
| `feat:` | minor |
| `feat!:` / `BREAKING CHANGE:` | major |

The release workflow builds the `.deb` and attaches it to the GitHub Release automatically.

## Project Structure

```
vhs-digitizer/
├── backend/          # FastAPI app, OBS controller, SQLite, recording lifecycle
├── frontend/         # React (Vite) single-page app
├── packaging/        # Debian package build scripts and metadata
└── docs/             # PRDs and packaging design
```
