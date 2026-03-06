import sqlite3
from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

DB_PATH = Path(__file__).parent / "vhs.db"

DEFAULT_SETTINGS = {
    "obs_host": "localhost",
    "obs_port": "4455",
    "obs_password": "",
    "output_dir": str(Path.home() / "vhs-recordings"),
}


def _now() -> str:
    return datetime.now(UTC).isoformat()


@contextmanager
def get_db(db_path: Path | None = None) -> Generator[sqlite3.Connection, None, None]:
    conn = sqlite3.connect(str(db_path or DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db(db_path: Path | None = None) -> None:
    with get_db(db_path) as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS tapes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                label TEXT NOT NULL,
                description TEXT,
                duration_minutes INTEGER,
                duration_ms INTEGER,
                content_date TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                output_file TEXT,
                notes TEXT,
                created_at TEXT NOT NULL,
                recorded_at TEXT
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS chapters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tape_id INTEGER NOT NULL REFERENCES tapes(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                start_time_ms INTEGER NOT NULL,
                end_time_ms INTEGER,
                notes TEXT,
                output_file TEXT,
                exported_at TEXT,
                created_at TEXT NOT NULL,
                "order" INTEGER NOT NULL
            );
        """)
        for key, value in DEFAULT_SETTINGS.items():
            conn.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                (key, value),
            )


# --- Tape CRUD ---


def create_tape(label: str, **kwargs: object) -> dict:
    fields: dict[str, object] = {
        "label": label,
        "status": "pending",
        "created_at": _now(),
    }
    allowed = {"description", "duration_minutes", "content_date", "notes"}
    fields.update({k: v for k, v in kwargs.items() if k in allowed and v is not None})

    cols = ", ".join(fields.keys())
    placeholders = ", ".join("?" * len(fields))
    sql = f"INSERT INTO tapes ({cols}) VALUES ({placeholders})"

    with get_db() as conn:
        cur = conn.execute(sql, list(fields.values()))
        tape_id = cur.lastrowid
    return get_tape(tape_id)  # type: ignore[return-value]


def get_tape(tape_id: int, db_path: Path | None = None) -> dict | None:
    with get_db(db_path) as conn:
        row = conn.execute("SELECT * FROM tapes WHERE id = ?", (tape_id,)).fetchone()
    return dict(row) if row else None


def list_tapes(status: str | None = None, db_path: Path | None = None) -> list[dict]:
    sql = "SELECT * FROM tapes"
    params: list[object] = []
    if status:
        sql += " WHERE status = ?"
        params.append(status)
    sql += " ORDER BY id"
    with get_db(db_path) as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def update_tape(tape_id: int, db_path: Path | None = None, **kwargs: object) -> dict | None:
    allowed = {
        "label",
        "description",
        "duration_minutes",
        "duration_ms",
        "content_date",
        "status",
        "output_file",
        "notes",
        "recorded_at",
    }
    updates = {k: v for k, v in kwargs.items() if k in allowed}
    if not updates:
        return get_tape(tape_id, db_path)

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    sql = f"UPDATE tapes SET {set_clause} WHERE id = ?"
    with get_db(db_path) as conn:
        conn.execute(sql, [*updates.values(), tape_id])
    return get_tape(tape_id, db_path)


def delete_tape(tape_id: int, db_path: Path | None = None) -> bool:
    with get_db(db_path) as conn:
        cur = conn.execute("DELETE FROM tapes WHERE id = ?", (tape_id,))
    return cur.rowcount > 0


def get_stats(db_path: Path | None = None) -> dict:
    with get_db(db_path) as conn:
        row = conn.execute("""
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'recording' THEN 1 ELSE 0 END) as recording,
                SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
                SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped,
                SUM(COALESCE(duration_minutes, 0)) as total_minutes,
                SUM(CASE WHEN status = 'done' THEN COALESCE(duration_minutes, 0) ELSE 0 END) as done_minutes
            FROM tapes
        """).fetchone()
    total = row["total"] or 0
    done = row["done"] or 0
    pct = round((done / total * 100) if total > 0 else 0.0, 1)
    return {
        "total": total,
        "pending": row["pending"] or 0,
        "recording": row["recording"] or 0,
        "done": done,
        "skipped": row["skipped"] or 0,
        "total_minutes": row["total_minutes"] or 0,
        "done_minutes": row["done_minutes"] or 0,
        "pct_complete": pct,
    }


# --- Settings ---


def get_settings(db_path: Path | None = None) -> dict:
    with get_db(db_path) as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    return {r["key"]: r["value"] for r in rows}


def update_settings(updates: dict, db_path: Path | None = None) -> dict:
    with get_db(db_path) as conn:
        for key, value in updates.items():
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                (key, str(value)),
            )
    return get_settings(db_path)


# --- Chapter CRUD ---


def create_chapter(
    tape_id: int,
    title: str,
    start_time_ms: int,
    db_path: Path | None = None,
    **kwargs: object,
) -> dict:
    allowed = {"end_time_ms", "notes", "order"}
    fields: dict[str, object] = {
        "tape_id": tape_id,
        "title": title,
        "start_time_ms": start_time_ms,
        "created_at": _now(),
    }
    fields.update({k: v for k, v in kwargs.items() if k in allowed and v is not None})
    if "order" not in fields:
        fields["order"] = start_time_ms

    col_names = ['"order"' if k == "order" else k for k in fields]
    cols = ", ".join(col_names)
    placeholders = ", ".join("?" * len(fields))
    sql = f"INSERT INTO chapters ({cols}) VALUES ({placeholders})"

    with get_db(db_path) as conn:
        cur = conn.execute(sql, list(fields.values()))
        chapter_id = cur.lastrowid
    return get_chapter(chapter_id, db_path)  # type: ignore[return-value]


def get_chapter(chapter_id: int, db_path: Path | None = None) -> dict | None:
    with get_db(db_path) as conn:
        row = conn.execute("SELECT * FROM chapters WHERE id = ?", (chapter_id,)).fetchone()
    return dict(row) if row else None


def list_chapters(tape_id: int, db_path: Path | None = None) -> list[dict]:
    with get_db(db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM chapters WHERE tape_id = ? ORDER BY start_time_ms",
            (tape_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def update_chapter(chapter_id: int, db_path: Path | None = None, **kwargs: object) -> dict | None:
    allowed = {
        "title",
        "start_time_ms",
        "end_time_ms",
        "notes",
        "order",
        "output_file",
        "exported_at",
    }
    updates = {k: v for k, v in kwargs.items() if k in allowed}
    if not updates:
        return get_chapter(chapter_id, db_path)

    set_parts = ['"order" = ?' if k == "order" else f"{k} = ?" for k in updates]
    set_clause = ", ".join(set_parts)
    sql = f"UPDATE chapters SET {set_clause} WHERE id = ?"
    with get_db(db_path) as conn:
        conn.execute(sql, [*updates.values(), chapter_id])
    return get_chapter(chapter_id, db_path)


def delete_chapter(chapter_id: int, db_path: Path | None = None) -> bool:
    with get_db(db_path) as conn:
        cur = conn.execute("DELETE FROM chapters WHERE id = ?", (chapter_id,))
    return cur.rowcount > 0


def check_chapter_overlap(
    tape_id: int,
    start_ms: int,
    end_ms: int | None,
    exclude_id: int | None = None,
    db_path: Path | None = None,
) -> dict | None:
    """Return the first existing chapter that overlaps with [start_ms, end_ms)."""
    chapters = list_chapters(tape_id, db_path)
    new_end: float = end_ms if end_ms is not None else float("inf")
    for ch in chapters:
        if exclude_id is not None and ch["id"] == exclude_id:
            continue
        ch_start: int = ch["start_time_ms"]
        ch_end: float = ch["end_time_ms"] if ch["end_time_ms"] is not None else float("inf")
        if start_ms < ch_end and new_end > ch_start:
            return ch
    return None
