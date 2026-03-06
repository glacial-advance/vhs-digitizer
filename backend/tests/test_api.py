from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

import database as db


@pytest.fixture
async def client(tmp_db, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_db)
    import main

    monkeypatch.setattr(main, "obs", MagicMock(is_connected=False))
    async with AsyncClient(transport=ASGITransport(app=main.app), base_url="http://test") as ac:
        yield ac


# --- Tapes ---


async def test_list_tapes_empty(client: AsyncClient) -> None:
    resp = await client.get("/api/tapes")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_create_tape(client: AsyncClient) -> None:
    resp = await client.post("/api/tapes", json={"label": "Christmas 1994"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["label"] == "Christmas 1994"
    assert data["status"] == "pending"
    assert data["id"] == 1


async def test_create_tape_requires_label(client: AsyncClient) -> None:
    resp = await client.post("/api/tapes", json={"description": "No label"})
    assert resp.status_code == 422


async def test_create_tape_with_all_fields(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/tapes",
        json={
            "label": "Summer 88",
            "description": "Beach trip",
            "duration_minutes": 60,
            "content_date": "1988-07",
            "notes": "Faded",
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["duration_minutes"] == 60


async def test_list_tapes_with_filter(client: AsyncClient) -> None:
    await client.post("/api/tapes", json={"label": "A"})
    t = (await client.post("/api/tapes", json={"label": "B"})).json()
    await client.put(f"/api/tapes/{t['id']}", json={"status": "done"})
    resp = await client.get("/api/tapes?status=pending")
    assert len(resp.json()) == 1


async def test_update_tape(client: AsyncClient) -> None:
    t = (await client.post("/api/tapes", json={"label": "Old"})).json()
    resp = await client.put(f"/api/tapes/{t['id']}", json={"label": "New"})
    assert resp.status_code == 200
    assert resp.json()["label"] == "New"


async def test_update_tape_not_found(client: AsyncClient) -> None:
    resp = await client.put("/api/tapes/999", json={"label": "X"})
    assert resp.status_code == 404


async def test_delete_tape(client: AsyncClient) -> None:
    t = (await client.post("/api/tapes", json={"label": "To Delete"})).json()
    resp = await client.delete(f"/api/tapes/{t['id']}")
    assert resp.status_code == 204
    assert (await client.get("/api/tapes")).json() == []


async def test_delete_tape_not_found(client: AsyncClient) -> None:
    resp = await client.delete("/api/tapes/999")
    assert resp.status_code == 404


# --- Stats ---


async def test_get_stats_empty(client: AsyncClient) -> None:
    resp = await client.get("/api/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 0
    assert data["pct_complete"] == 0.0
    assert "done_minutes" in data


async def test_get_stats_with_tapes(client: AsyncClient) -> None:
    await client.post("/api/tapes", json={"label": "A", "duration_minutes": 60})
    t = (await client.post("/api/tapes", json={"label": "B", "duration_minutes": 90})).json()
    await client.put(f"/api/tapes/{t['id']}", json={"status": "done"})
    resp = await client.get("/api/stats")
    data = resp.json()
    assert data["total"] == 2
    assert data["done"] == 1
    assert data["total_minutes"] == 150


# --- Settings ---


async def test_get_settings(client: AsyncClient) -> None:
    resp = await client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert data["obs_host"] == "localhost"
    assert "output_dir" in data


async def test_update_settings(client: AsyncClient) -> None:
    resp = await client.put("/api/settings", json={"obs_host": "192.168.1.1"})
    assert resp.status_code == 200
    assert resp.json()["obs_host"] == "192.168.1.1"


# --- OBS ---


async def test_obs_status_disconnected(client: AsyncClient) -> None:
    resp = await client.get("/api/obs/status")
    assert resp.status_code == 200
    assert resp.json()["connected"] is False


async def test_obs_connect_failure(client: AsyncClient, monkeypatch) -> None:
    import main

    mock_obs = AsyncMock()
    mock_obs.is_connected = False
    mock_obs.connect = AsyncMock(side_effect=RuntimeError("Connection refused"))
    monkeypatch.setattr(main, "obs", mock_obs)
    resp = await client.post(
        "/api/obs/connect", json={"host": "localhost", "port": 4455, "password": ""}
    )
    assert resp.status_code == 502


async def test_obs_connect_success(client: AsyncClient, monkeypatch) -> None:
    import main

    mock_obs = AsyncMock()
    mock_obs.is_connected = True
    mock_obs.connect = AsyncMock()
    monkeypatch.setattr(main, "obs", mock_obs)
    resp = await client.post(
        "/api/obs/connect", json={"host": "localhost", "port": 4455, "password": ""}
    )
    assert resp.status_code == 200
    assert resp.json()["connected"] is True


async def test_obs_disconnect(client: AsyncClient, monkeypatch) -> None:
    import main

    mock_obs = AsyncMock()
    mock_obs.disconnect = AsyncMock()
    monkeypatch.setattr(main, "obs", mock_obs)
    resp = await client.post("/api/obs/disconnect")
    assert resp.status_code == 200
    mock_obs.disconnect.assert_called_once()


# --- Recording ---


async def test_recording_status_idle(client: AsyncClient) -> None:
    resp = await client.get("/api/recording/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_recording"] is False
    assert data["tape_id"] is None


async def test_start_recording_requires_obs_connected(client: AsyncClient) -> None:
    t = (await client.post("/api/tapes", json={"label": "A"})).json()
    resp = await client.post("/api/recording/start", json={"tape_id": t["id"]})
    assert resp.status_code == 409


async def test_start_recording_tape_not_found(client: AsyncClient, monkeypatch) -> None:
    import main

    mock_obs = MagicMock(is_connected=True)
    monkeypatch.setattr(main, "obs", mock_obs)
    resp = await client.post("/api/recording/start", json={"tape_id": 999})
    assert resp.status_code == 404


async def test_stop_recording_when_not_recording(client: AsyncClient) -> None:
    resp = await client.post("/api/recording/stop")
    assert resp.status_code == 409


# --- Chapters ---


async def test_list_chapters_empty(client: AsyncClient) -> None:
    t = (await client.post("/api/tapes", json={"label": "Tape"})).json()
    resp = await client.get(f"/api/tapes/{t['id']}/chapters")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_create_chapter(client: AsyncClient) -> None:
    t = (await client.post("/api/tapes", json={"label": "Tape"})).json()
    resp = await client.post(
        f"/api/tapes/{t['id']}/chapters",
        json={"title": "Intro", "start_time_ms": 0},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "Intro"
    assert data["tape_id"] == t["id"]


async def test_create_chapter_tape_not_found(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/tapes/999/chapters",
        json={"title": "Intro", "start_time_ms": 0},
    )
    assert resp.status_code == 404


async def test_create_chapter_validates_start_time(client: AsyncClient) -> None:
    t = (await client.post("/api/tapes", json={"label": "Tape"})).json()
    resp = await client.post(
        f"/api/tapes/{t['id']}/chapters",
        json={"title": "Bad", "start_time_ms": -1},
    )
    assert resp.status_code == 422


async def test_create_chapter_detects_overlap(client: AsyncClient) -> None:
    t = (await client.post("/api/tapes", json={"label": "Tape"})).json()
    await client.post(
        f"/api/tapes/{t['id']}/chapters",
        json={"title": "Ch1", "start_time_ms": 0, "end_time_ms": 30000},
    )
    resp = await client.post(
        f"/api/tapes/{t['id']}/chapters",
        json={"title": "Ch2", "start_time_ms": 15000, "end_time_ms": 45000},
    )
    assert resp.status_code == 409


async def test_update_chapter(client: AsyncClient) -> None:
    t = (await client.post("/api/tapes", json={"label": "Tape"})).json()
    ch = (
        await client.post(
            f"/api/tapes/{t['id']}/chapters",
            json={"title": "Old", "start_time_ms": 0},
        )
    ).json()
    resp = await client.put(f"/api/chapters/{ch['id']}", json={"title": "New"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "New"


async def test_delete_chapter(client: AsyncClient) -> None:
    t = (await client.post("/api/tapes", json={"label": "Tape"})).json()
    ch = (
        await client.post(
            f"/api/tapes/{t['id']}/chapters",
            json={"title": "Ch", "start_time_ms": 0},
        )
    ).json()
    resp = await client.delete(f"/api/chapters/{ch['id']}")
    assert resp.status_code == 204


# --- Jobs ---


async def test_get_job_not_found(client: AsyncClient) -> None:
    resp = await client.get("/api/jobs/nonexistent-id")
    assert resp.status_code == 404


async def test_export_chapter_no_output_file(client: AsyncClient) -> None:
    t = (await client.post("/api/tapes", json={"label": "Tape"})).json()
    ch = (
        await client.post(
            f"/api/tapes/{t['id']}/chapters",
            json={"title": "Ch", "start_time_ms": 0},
        )
    ).json()
    resp = await client.post(f"/api/chapters/{ch['id']}/export")
    assert resp.status_code == 409
