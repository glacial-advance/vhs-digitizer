import asyncio
import json
import logging
import re
import shutil
import subprocess
import time
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator

import database as db
from obs import OBSController

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Global state
# ---------------------------------------------------------------------------

obs = OBSController()
active_recording: dict | None = None  # {"tape_id": int, "started_at": float}
ws_clients: list[WebSocket] = []
export_jobs: dict[str, dict] = {}

FFMPEG_AVAILABLE = shutil.which("ffmpeg") is not None
FFPROBE_AVAILABLE = shutil.which("ffprobe") is not None

VIDEO_EXTENSIONS = {".mkv", ".mp4", ".mov"}


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    task = asyncio.create_task(_broadcast_status_loop())
    yield
    task.cancel()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# WebSocket helpers
# ---------------------------------------------------------------------------


async def _broadcast(event: str, data: dict) -> None:
    msg = json.dumps({"event": event, **data})
    dead: list[WebSocket] = []
    for ws in ws_clients:
        try:
            await ws.send_text(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        if ws in ws_clients:
            ws_clients.remove(ws)


async def _broadcast_status_loop() -> None:
    while True:
        await asyncio.sleep(2)
        status: dict = {
            "obs_connected": obs.is_connected,
            "is_recording": False,
            "is_paused": False,
            "duration_ms": 0,
            "tape_id": None,
        }
        if active_recording and obs.is_connected:
            try:
                rec = await obs.get_recording_status()
                status.update(
                    {
                        "is_recording": rec.is_active,
                        "is_paused": rec.is_paused,
                        "duration_ms": rec.duration_ms,
                        "tape_id": active_recording.get("tape_id"),
                    }
                )
            except Exception:
                pass
        await _broadcast("status_update", status)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    ws_clients.append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in ws_clients:
            ws_clients.remove(websocket)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class TapeCreate(BaseModel):
    label: str
    description: str | None = None
    duration_minutes: int | None = None
    content_date: str | None = None
    notes: str | None = None


class TapeUpdate(BaseModel):
    label: str | None = None
    description: str | None = None
    duration_minutes: int | None = None
    content_date: str | None = None
    notes: str | None = None
    status: str | None = None


class OBSConnectRequest(BaseModel):
    host: str = "localhost"
    port: int = 4455
    password: str = ""


class RecordingStartRequest(BaseModel):
    tape_id: int


class ChapterCreate(BaseModel):
    title: str
    start_time_ms: int
    end_time_ms: int | None = None
    notes: str | None = None
    order: int | None = None

    @field_validator("start_time_ms")
    @classmethod
    def start_non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("start_time_ms must be >= 0")
        return v

    @field_validator("end_time_ms")
    @classmethod
    def end_after_start(cls, v: int | None) -> int | None:
        return v


class ChapterUpdate(BaseModel):
    title: str | None = None
    start_time_ms: int | None = None
    end_time_ms: int | None = None
    notes: str | None = None
    order: int | None = None

    @field_validator("start_time_ms")
    @classmethod
    def start_non_negative(cls, v: int | None) -> int | None:
        if v is not None and v < 0:
            raise ValueError("start_time_ms must be >= 0")
        return v


# ---------------------------------------------------------------------------
# Tape endpoints
# ---------------------------------------------------------------------------


@app.get("/api/tapes")
def list_tapes(status: str | None = None) -> list[dict]:
    return db.list_tapes(status=status)


@app.post("/api/tapes", status_code=201)
def create_tape(body: TapeCreate) -> dict:
    return db.create_tape(
        body.label,
        description=body.description,
        duration_minutes=body.duration_minutes,
        content_date=body.content_date,
        notes=body.notes,
    )


@app.put("/api/tapes/{tape_id}")
def update_tape(tape_id: int, body: TapeUpdate) -> dict:
    if db.get_tape(tape_id) is None:
        raise HTTPException(404, "Tape not found")
    updates = body.model_dump(exclude_none=True)
    result = db.update_tape(tape_id, **updates)
    return result  # type: ignore[return-value]


@app.delete("/api/tapes/{tape_id}", status_code=204)
def delete_tape(tape_id: int) -> None:
    if not db.delete_tape(tape_id):
        raise HTTPException(404, "Tape not found")


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------


@app.get("/api/stats")
def get_stats() -> dict:
    return db.get_stats()


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


@app.get("/api/settings")
def get_settings() -> dict:
    return db.get_settings()


@app.put("/api/settings")
def update_settings(body: dict) -> dict:
    return db.update_settings(body)


# ---------------------------------------------------------------------------
# OBS
# ---------------------------------------------------------------------------


@app.get("/api/obs/status")
def obs_status() -> dict:
    return {"connected": obs.is_connected}


@app.post("/api/obs/connect")
async def obs_connect(body: OBSConnectRequest) -> dict:
    try:
        await obs.connect(body.host, body.port, body.password)
        db.update_settings({"obs_host": body.host, "obs_port": str(body.port)})
        return {"connected": obs.is_connected}
    except Exception as exc:
        raise HTTPException(502, f"Could not connect to OBS: {exc}") from exc


@app.post("/api/obs/disconnect")
async def obs_disconnect() -> dict:
    await obs.disconnect()
    return {"connected": False}


# ---------------------------------------------------------------------------
# Recording
# ---------------------------------------------------------------------------


@app.get("/api/recording/status")
def recording_status() -> dict:
    return {
        "is_recording": active_recording is not None,
        "is_paused": False,
        "duration_ms": 0,
        "tape_id": active_recording["tape_id"] if active_recording else None,
    }


@app.post("/api/recording/start")
async def recording_start(body: RecordingStartRequest) -> dict:
    global active_recording
    if not obs.is_connected:
        raise HTTPException(409, "OBS is not connected")
    tape = db.get_tape(body.tape_id)
    if tape is None:
        raise HTTPException(404, "Tape not found")
    if active_recording is not None:
        raise HTTPException(409, "A recording is already in progress")

    settings = db.get_settings()
    output_dir = settings.get("output_dir", str(Path.home() / "vhs-recordings"))
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    await obs.set_record_directory(output_dir)
    await obs.start_recording()

    active_recording = {"tape_id": body.tape_id, "started_at": time.time()}
    db.update_tape(body.tape_id, status="recording")
    await _broadcast("recording_started", {"tape_id": body.tape_id, "tape_label": tape["label"]})
    return {"ok": True, "tape_id": body.tape_id}


@app.post("/api/recording/stop")
async def recording_stop() -> dict:
    global active_recording
    if active_recording is None:
        raise HTTPException(409, "No recording is in progress")

    tape_id = active_recording["tape_id"]
    tape = db.get_tape(tape_id)
    tape_label = tape["label"] if tape else f"tape_{tape_id}"

    await obs.stop_recording()
    await asyncio.sleep(1.5)

    settings = db.get_settings()
    output_dir = settings.get("output_dir", str(Path.home() / "vhs-recordings"))

    output_file = _find_and_rename_recording(output_dir, tape_label)
    duration_ms = _probe_duration(output_file) if output_file else None

    if tape:
        db.update_tape(
            tape_id,
            status="done",
            recorded_at=datetime.now(UTC).isoformat(),
            output_file=output_file,
            duration_ms=duration_ms,
        )
    active_recording = None
    await _broadcast("recording_stopped", {"tape_id": tape_id, "output_file": output_file})
    return {"ok": True, "output_file": output_file}


@app.post("/api/recording/pause")
async def recording_pause() -> dict:
    if active_recording is None:
        raise HTTPException(409, "No recording is in progress")
    await obs.pause_recording()
    return {"ok": True}


@app.post("/api/recording/resume")
async def recording_resume() -> dict:
    if active_recording is None:
        raise HTTPException(409, "No recording is in progress")
    await obs.resume_recording()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Chapters
# ---------------------------------------------------------------------------


@app.get("/api/tapes/{tape_id}/chapters")
def list_chapters(tape_id: int) -> list[dict]:
    if db.get_tape(tape_id) is None:
        raise HTTPException(404, "Tape not found")
    return db.list_chapters(tape_id)


@app.post("/api/tapes/{tape_id}/chapters", status_code=201)
def create_chapter(tape_id: int, body: ChapterCreate) -> dict:
    if db.get_tape(tape_id) is None:
        raise HTTPException(404, "Tape not found")

    if body.end_time_ms is not None and body.end_time_ms <= body.start_time_ms:
        raise HTTPException(422, "end_time_ms must be greater than start_time_ms")

    tape = db.get_tape(tape_id)
    if tape and tape["duration_ms"] is not None:
        limit = tape["duration_ms"]
        if body.start_time_ms > limit:
            raise HTTPException(422, "start_time_ms exceeds tape duration")
        if body.end_time_ms is not None and body.end_time_ms > limit:
            raise HTTPException(422, "end_time_ms exceeds tape duration")

    overlap = db.check_chapter_overlap(tape_id, body.start_time_ms, body.end_time_ms)
    if overlap:
        raise HTTPException(409, f"Overlaps with chapter '{overlap['title']}'")

    return db.create_chapter(
        tape_id,
        body.title,
        body.start_time_ms,
        end_time_ms=body.end_time_ms,
        notes=body.notes,
        order=body.order,
    )


@app.put("/api/chapters/{chapter_id}")
def update_chapter(chapter_id: int, body: ChapterUpdate) -> dict:
    ch = db.get_chapter(chapter_id)
    if ch is None:
        raise HTTPException(404, "Chapter not found")

    updates = body.model_dump(exclude_none=True)

    new_start = updates.get("start_time_ms", ch["start_time_ms"])
    new_end = updates.get("end_time_ms", ch["end_time_ms"])

    if new_end is not None and new_end <= new_start:
        raise HTTPException(422, "end_time_ms must be greater than start_time_ms")

    overlap = db.check_chapter_overlap(ch["tape_id"], new_start, new_end, exclude_id=chapter_id)
    if overlap:
        raise HTTPException(409, f"Overlaps with chapter '{overlap['title']}'")

    result = db.update_chapter(chapter_id, **updates)
    return result  # type: ignore[return-value]


@app.delete("/api/chapters/{chapter_id}", status_code=204)
def delete_chapter(chapter_id: int) -> None:
    if not db.delete_chapter(chapter_id):
        raise HTTPException(404, "Chapter not found")


# ---------------------------------------------------------------------------
# Chapter export
# ---------------------------------------------------------------------------


@app.post("/api/chapters/{chapter_id}/export")
async def export_chapter(chapter_id: int) -> dict:
    ch = db.get_chapter(chapter_id)
    if ch is None:
        raise HTTPException(404, "Chapter not found")

    tape = db.get_tape(ch["tape_id"])
    if tape is None or not tape.get("output_file"):
        raise HTTPException(409, "Tape has no output file to export from")

    if not Path(tape["output_file"]).exists():
        raise HTTPException(409, "Source recording file does not exist on disk")

    if not FFMPEG_AVAILABLE:
        raise HTTPException(503, "FFmpeg is not available on this system")

    job_id = str(uuid.uuid4())
    export_jobs[job_id] = {
        "job_id": job_id,
        "chapter_id": chapter_id,
        "status": "pending",
        "error": None,
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": None,
    }
    asyncio.create_task(_run_export_job(job_id, ch, tape))
    return {"job_id": job_id}


@app.post("/api/tapes/{tape_id}/chapters/export-all")
async def export_all_chapters(tape_id: int) -> dict:
    if db.get_tape(tape_id) is None:
        raise HTTPException(404, "Tape not found")
    chapters = db.list_chapters(tape_id)
    jobs = []
    for ch in chapters:
        tape = db.get_tape(tape_id)
        if tape and tape.get("output_file") and Path(tape["output_file"]).exists():
            job_id = str(uuid.uuid4())
            export_jobs[job_id] = {
                "job_id": job_id,
                "chapter_id": ch["id"],
                "status": "pending",
                "error": None,
                "started_at": datetime.now(UTC).isoformat(),
                "finished_at": None,
            }
            asyncio.create_task(_run_export_job(job_id, ch, tape))
            jobs.append(job_id)
    return {"job_ids": jobs}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = export_jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    return job


# ---------------------------------------------------------------------------
# Recording lifecycle helpers
# ---------------------------------------------------------------------------


def _safe_label(label: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", label)


def _find_and_rename_recording(output_dir: str, tape_label: str) -> str | None:
    dir_path = Path(output_dir)
    candidates = sorted(
        [f for f in dir_path.iterdir() if f.suffix.lower() in VIDEO_EXTENSIONS],
        key=lambda f: f.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        return None

    source = candidates[0]
    timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    new_name = f"{_safe_label(tape_label)}_{timestamp}{source.suffix}"
    dest = source.parent / new_name
    source.rename(dest)
    return str(dest)


def _probe_duration(file_path: str | None) -> int | None:
    if not file_path or not FFPROBE_AVAILABLE:
        return None
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "quiet",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                file_path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        return int(float(result.stdout.strip()) * 1000)
    except Exception:
        return None


async def _run_export_job(job_id: str, chapter: dict, tape: dict) -> None:
    export_jobs[job_id]["status"] = "running"
    try:
        chapters = db.list_chapters(chapter["tape_id"])
        start_s = chapter["start_time_ms"] / 1000.0

        end_ms = chapter["end_time_ms"]
        if end_ms is None:
            next_chapters = [c for c in chapters if c["start_time_ms"] > chapter["start_time_ms"]]
            if next_chapters:
                end_ms = next_chapters[0]["start_time_ms"]

        source = Path(tape["output_file"])
        order_str = str(chapter["order"]).zfill(2)
        out_name = (
            f"{_safe_label(tape['label'])}_ch{order_str}"
            f"_{_safe_label(chapter['title'])}{source.suffix}"
        )
        output_path = source.parent / out_name

        cmd = ["ffmpeg", "-y", "-ss", str(start_s)]
        if end_ms is not None:
            cmd += ["-to", str(end_ms / 1000.0)]
        cmd += ["-i", str(source), "-c", "copy", str(output_path)]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate()

        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg exited with code {proc.returncode}")

        now = datetime.now(UTC).isoformat()
        db.update_chapter(chapter["id"], output_file=str(output_path), exported_at=now)
        export_jobs[job_id].update({"status": "done", "finished_at": now})
    except Exception as exc:
        export_jobs[job_id].update(
            {
                "status": "error",
                "error": str(exc),
                "finished_at": datetime.now(UTC).isoformat(),
            }
        )


# ---------------------------------------------------------------------------
# Static file serving (production)
# ---------------------------------------------------------------------------

_frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if _frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=str(_frontend_dist / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str) -> FileResponse:
        index = _frontend_dist / "index.html"
        return FileResponse(str(index))


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
