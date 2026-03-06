from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from obs import OBSController, RecordStatus


@pytest.fixture
def ctrl() -> OBSController:
    return OBSController()


def test_initial_state_is_disconnected(ctrl: OBSController) -> None:
    assert not ctrl.is_connected


@pytest.mark.asyncio
async def test_connect_sets_connected(ctrl: OBSController) -> None:
    mock_ws = AsyncMock()
    mock_params = MagicMock()
    with (
        patch("obs.simpleobsws.WebSocketClient", return_value=mock_ws),
        patch("obs.simpleobsws.IdentificationParameters", return_value=mock_params),
    ):
        await ctrl.connect("localhost", 4455, "")
    assert ctrl.is_connected


@pytest.mark.asyncio
async def test_connect_disconnects_existing_first(ctrl: OBSController) -> None:
    old_ws = AsyncMock()
    ctrl._ws = old_ws
    ctrl._connected = True
    mock_ws = AsyncMock()
    with (
        patch("obs.simpleobsws.WebSocketClient", return_value=mock_ws),
        patch("obs.simpleobsws.IdentificationParameters"),
    ):
        await ctrl.connect("localhost", 4455, "")
    old_ws.disconnect.assert_called_once()


@pytest.mark.asyncio
async def test_disconnect_clears_state(ctrl: OBSController) -> None:
    ctrl._ws = AsyncMock()
    ctrl._connected = True
    await ctrl.disconnect()
    assert not ctrl.is_connected
    assert ctrl._ws is None


@pytest.mark.asyncio
async def test_disconnect_when_not_connected_is_safe(ctrl: OBSController) -> None:
    await ctrl.disconnect()  # should not raise
    assert not ctrl.is_connected


@pytest.mark.asyncio
async def test_request_raises_when_not_connected(ctrl: OBSController) -> None:
    with pytest.raises(RuntimeError, match="Not connected"):
        await ctrl._request("GetRecordStatus")


@pytest.mark.asyncio
async def test_start_recording_calls_obs(ctrl: OBSController) -> None:
    mock_resp = MagicMock()
    mock_resp.ok.return_value = True
    mock_resp.responseData = {}
    ctrl._connected = True
    ctrl._ws = AsyncMock()
    ctrl._ws.call = AsyncMock(return_value=mock_resp)
    with patch("obs.simpleobsws.Request") as mock_req:
        await ctrl.start_recording()
    mock_req.assert_called_with("StartRecord", {})


@pytest.mark.asyncio
async def test_get_recording_status_parses_response(ctrl: OBSController) -> None:
    mock_resp = MagicMock()
    mock_resp.ok.return_value = True
    mock_resp.responseData = {
        "outputActive": True,
        "outputPaused": False,
        "outputDuration": 5000,
        "outputBytes": 1024,
    }
    ctrl._connected = True
    ctrl._ws = AsyncMock()
    ctrl._ws.call = AsyncMock(return_value=mock_resp)
    with patch("obs.simpleobsws.Request"):
        status = await ctrl.get_recording_status()
    assert isinstance(status, RecordStatus)
    assert status.is_active is True
    assert status.duration_ms == 5000


@pytest.mark.asyncio
async def test_request_raises_on_obs_error(ctrl: OBSController) -> None:
    mock_resp = MagicMock()
    mock_resp.ok.return_value = False
    mock_resp.requestStatus = "SomeError"
    ctrl._connected = True
    ctrl._ws = AsyncMock()
    ctrl._ws.call = AsyncMock(return_value=mock_resp)
    with patch("obs.simpleobsws.Request"):
        with pytest.raises(RuntimeError, match="OBS request failed"):
            await ctrl._request("StartRecord")
