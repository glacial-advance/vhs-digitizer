import sqlite3
from pathlib import Path

import pytest

import database as db


def get_tables(db_path: Path) -> set[str]:
    conn = sqlite3.connect(str(db_path))
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    conn.close()
    return tables


# --- init_db ---


def test_init_db_creates_all_tables(tmp_db: Path) -> None:
    tables = get_tables(tmp_db)
    assert {"tapes", "settings", "chapters"} <= tables


def test_init_db_seeds_default_settings(tmp_db: Path) -> None:
    settings = db.get_settings()
    assert settings["obs_host"] == "localhost"
    assert settings["obs_port"] == "4455"
    assert "output_dir" in settings


def test_init_db_is_idempotent(tmp_db: Path) -> None:
    db.init_db()  # second call should not raise or duplicate settings
    settings = db.get_settings()
    assert settings["obs_host"] == "localhost"


# --- Tape CRUD ---


def test_create_tape_returns_dict(tmp_db: Path) -> None:
    tape = db.create_tape("Christmas 1994")
    assert tape["id"] == 1
    assert tape["label"] == "Christmas 1994"
    assert tape["status"] == "pending"
    assert tape["created_at"] is not None


def test_create_tape_with_optional_fields(tmp_db: Path) -> None:
    tape = db.create_tape(
        "Summer 1988",
        description="Beach trip",
        duration_minutes=60,
        content_date="1988-07",
        notes="Some notes",
    )
    assert tape["description"] == "Beach trip"
    assert tape["duration_minutes"] == 60
    assert tape["content_date"] == "1988-07"
    assert tape["notes"] == "Some notes"


def test_list_tapes_empty(tmp_db: Path) -> None:
    assert db.list_tapes() == []


def test_list_tapes_returns_all(tmp_db: Path) -> None:
    db.create_tape("Tape A")
    db.create_tape("Tape B")
    tapes = db.list_tapes()
    assert len(tapes) == 2


def test_list_tapes_filters_by_status(tmp_db: Path) -> None:
    db.create_tape("Pending Tape")
    t = db.create_tape("Done Tape")
    db.update_tape(t["id"], status="done")
    pending = db.list_tapes(status="pending")
    done = db.list_tapes(status="done")
    assert len(pending) == 1
    assert len(done) == 1
    assert pending[0]["label"] == "Pending Tape"


def test_get_tape_returns_none_for_missing(tmp_db: Path) -> None:
    assert db.get_tape(999) is None


def test_update_tape_changes_fields(tmp_db: Path) -> None:
    tape = db.create_tape("Original")
    updated = db.update_tape(tape["id"], label="Renamed", status="done")
    assert updated["label"] == "Renamed"
    assert updated["status"] == "done"


def test_delete_tape_removes_record(tmp_db: Path) -> None:
    tape = db.create_tape("To Delete")
    assert db.delete_tape(tape["id"]) is True
    assert db.get_tape(tape["id"]) is None


def test_delete_tape_returns_false_for_missing(tmp_db: Path) -> None:
    assert db.delete_tape(999) is False


# --- Stats ---


def test_get_stats_empty(tmp_db: Path) -> None:
    stats = db.get_stats()
    assert stats["total"] == 0
    assert stats["pct_complete"] == 0.0


def test_get_stats_counts(tmp_db: Path) -> None:
    db.create_tape("A", duration_minutes=60)
    db.create_tape("B", duration_minutes=90)
    t = db.create_tape("C", duration_minutes=30)
    db.update_tape(t["id"], status="done")
    stats = db.get_stats()
    assert stats["total"] == 3
    assert stats["pending"] == 2
    assert stats["done"] == 1
    assert stats["total_minutes"] == 180
    assert stats["done_minutes"] == 30
    assert stats["pct_complete"] == pytest.approx(33.3, abs=0.2)


# --- Settings ---


def test_update_settings_persists(tmp_db: Path) -> None:
    db.update_settings({"obs_host": "192.168.1.10", "obs_port": "4455"})
    settings = db.get_settings()
    assert settings["obs_host"] == "192.168.1.10"


def test_update_settings_partial(tmp_db: Path) -> None:
    original = db.get_settings()
    db.update_settings({"obs_password": "secret"})
    settings = db.get_settings()
    assert settings["obs_password"] == "secret"
    assert settings["obs_host"] == original["obs_host"]


# --- Chapter CRUD ---


def test_create_chapter(tmp_db: Path) -> None:
    tape = db.create_tape("Test Tape")
    db.update_tape(tape["id"], status="done", output_file="/tmp/test.mkv")
    ch = db.create_chapter(tape["id"], "Intro", 0)
    assert ch["id"] == 1
    assert ch["title"] == "Intro"
    assert ch["start_time_ms"] == 0
    assert ch["tape_id"] == tape["id"]


def test_list_chapters_ordered_by_start_time(tmp_db: Path) -> None:
    tape = db.create_tape("Test Tape")
    db.create_chapter(tape["id"], "Part 2", 60000)
    db.create_chapter(tape["id"], "Intro", 0)
    chapters = db.list_chapters(tape["id"])
    assert chapters[0]["title"] == "Intro"
    assert chapters[1]["title"] == "Part 2"


def test_update_chapter(tmp_db: Path) -> None:
    tape = db.create_tape("Test Tape")
    ch = db.create_chapter(tape["id"], "Old Title", 0)
    updated = db.update_chapter(ch["id"], title="New Title", end_time_ms=30000)
    assert updated["title"] == "New Title"
    assert updated["end_time_ms"] == 30000


def test_delete_chapter(tmp_db: Path) -> None:
    tape = db.create_tape("Test Tape")
    ch = db.create_chapter(tape["id"], "To Delete", 0)
    assert db.delete_chapter(ch["id"]) is True
    assert db.get_chapter(ch["id"]) is None


def test_delete_tape_cascades_to_chapters(tmp_db: Path) -> None:
    tape = db.create_tape("Test Tape")
    db.create_chapter(tape["id"], "Ch1", 0)
    db.create_chapter(tape["id"], "Ch2", 10000)
    db.delete_tape(tape["id"])
    assert db.list_chapters(tape["id"]) == []


# --- Chapter overlap ---


def test_check_chapter_overlap_no_overlap(tmp_db: Path) -> None:
    tape = db.create_tape("Test Tape")
    db.create_chapter(tape["id"], "Ch1", 0, end_time_ms=30000)
    result = db.check_chapter_overlap(tape["id"], 30000, 60000)
    assert result is None


def test_check_chapter_overlap_detects_overlap(tmp_db: Path) -> None:
    tape = db.create_tape("Test Tape")
    db.create_chapter(tape["id"], "Ch1", 0, end_time_ms=30000)
    result = db.check_chapter_overlap(tape["id"], 15000, 45000)
    assert result is not None
    assert result["title"] == "Ch1"


def test_check_chapter_overlap_excludes_self(tmp_db: Path) -> None:
    tape = db.create_tape("Test Tape")
    ch = db.create_chapter(tape["id"], "Ch1", 0, end_time_ms=30000)
    result = db.check_chapter_overlap(tape["id"], 0, 30000, exclude_id=ch["id"])
    assert result is None


def test_check_chapter_overlap_open_ended(tmp_db: Path) -> None:
    tape = db.create_tape("Test Tape")
    db.create_chapter(tape["id"], "Ch1", 60000)  # no end_time_ms
    result = db.check_chapter_overlap(tape["id"], 90000, None)
    assert result is not None
