# VHS Digitizer — Debian Packaging

## Overview

The application is distributed as a single `.deb` package for Ubuntu (amd64). The package bundles the pre-built React frontend and the backend Python source, declares system dependencies, creates a dedicated service user, and registers a systemd service.

---

## Prerequisites

### Build machine

| Tool | Purpose |
|---|---|
| `node` + `npm` | Build the React frontend |
| `uv` | Export pinned Python requirements |
| `dpkg-deb` | Assemble the `.deb` (install via `apt install dpkg`) |

### Target Ubuntu machine (handled by `apt` automatically)

| Package | Purpose |
|---|---|
| `python3 (>= 3.11)` | Runtime interpreter |
| `python3-venv` | Create the virtualenv on install |
| `python3-pip` | Install Python deps on install |
| `ffmpeg` | Duration detection (FFprobe) and chapter export |

OBS Studio must be installed separately. The package declares it as a `Recommends` but not a hard dependency, since OBS is not in the default Ubuntu repos.

---

## Building the Package

Run from the repository root on the build machine:

```bash
./packaging/build-deb.sh [version]
```

Default version is `1.0.0`. The script:

1. Runs `npm ci && npm run build` in `frontend/` to produce the static bundle
2. Runs `uv export --no-hashes --no-dev` to pin all Python deps into a `requirements.txt`
3. Assembles the `.deb` directory tree under `packaging/build/`
4. Calls `dpkg-deb --build` to produce `packaging/vhs-digitizer_<version>_amd64.deb`

The build must be run on an amd64 machine. The virtualenv is **not** bundled — it is created on the target machine during install so Python paths are correct for that system.

---

## Installing

```bash
sudo apt install ./vhs-digitizer_1.0.0_amd64.deb
```

The `postinst` script runs automatically and:

1. Creates a `vhs-digitizer` system user (no login shell, home at `/var/lib/vhs-digitizer`)
2. Creates `/var/lib/vhs-digitizer/recordings/`
3. Creates a Python virtualenv at `/usr/lib/vhs-digitizer/venv/`
4. Runs `pip install -r requirements.txt` into that virtualenv (requires internet)
5. Installs, enables, and starts the `vhs-digitizer` systemd service

After installation the application is available at `http://<host-ip>:8000` from any device on the local network.

---

## Runtime Layout

```
/usr/lib/vhs-digitizer/
├── backend/            # Python source files
│   ├── main.py
│   ├── obs.py
│   ├── db.py
│   ├── models.py
│   ├── recording.py
│   ├── chapters.py
│   └── jobs.py
├── frontend/           # Pre-built React bundle (served by FastAPI)
├── venv/               # Python virtualenv (created during postinst)
├── requirements.txt    # Pinned deps used to populate the venv
└── vhs-digitizer.service

/var/lib/vhs-digitizer/
├── vhs.db              # SQLite database
└── recordings/         # Default recording output directory

/lib/systemd/system/
└── vhs-digitizer.service
```

---

## Service Configuration

The systemd unit runs as the `vhs-digitizer` system user and passes two environment variables to the backend:

| Variable | Value | Purpose |
|---|---|---|
| `VHS_DB_PATH` | `/var/lib/vhs-digitizer/vhs.db` | SQLite database location |
| `VHS_OUTPUT_DIR` | `/var/lib/vhs-digitizer/recordings` | Default recording output directory |

The backend must read these environment variables and prefer them over any hardcoded defaults.

The service is hardened with `NoNewPrivileges`, `PrivateTmp`, and `ProtectSystem=strict`. The only writable path outside the private temp directory is `/var/lib/vhs-digitizer`.

To inspect service status:

```bash
systemctl status vhs-digitizer
journalctl -u vhs-digitizer -f
```

---

## Removing

```bash
# Remove the application, preserve the database and recordings
sudo apt remove vhs-digitizer

# Remove everything including the database, recordings, and service user
sudo apt purge vhs-digitizer
```

`apt remove` stops the service and removes all files under `/usr/lib/vhs-digitizer/` but leaves `/var/lib/vhs-digitizer/` intact so recordings and the database survive an uninstall/reinstall cycle.

`apt purge` additionally removes `/var/lib/vhs-digitizer/` and the `vhs-digitizer` system user.

---

## Upgrading

There is no in-place upgrade path defined yet. The recommended upgrade procedure is:

```bash
sudo apt remove vhs-digitizer
sudo apt install ./vhs-digitizer_<new-version>_amd64.deb
```

Because `apt remove` preserves `/var/lib/vhs-digitizer/`, the database and recordings are retained across the upgrade.

---

## File Reference

| File | Purpose |
|---|---|
| `packaging/build-deb.sh` | Build script — produces the `.deb` |
| `packaging/debian/control` | Package metadata and dependency declarations |
| `packaging/debian/postinst` | Post-install: create user, venv, pip install, start service |
| `packaging/debian/prerm` | Pre-remove: stop and disable the service |
| `packaging/debian/postrm` | Post-remove/purge: clean up files, user |
| `packaging/debian/vhs-digitizer.service` | systemd unit file (source; copied into package by build script) |
