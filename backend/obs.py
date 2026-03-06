from dataclasses import dataclass

import simpleobsws


@dataclass
class RecordStatus:
    is_active: bool = False
    is_paused: bool = False
    duration_ms: int = 0
    bytes_: int = 0


class OBSController:
    def __init__(self) -> None:
        self._ws: simpleobsws.WebSocketClient | None = None
        self._connected: bool = False

    @property
    def is_connected(self) -> bool:
        return self._connected

    async def connect(self, host: str, port: int, password: str) -> None:
        if self._connected:
            await self.disconnect()
        params = simpleobsws.IdentificationParameters(ignoreNonFatalRequestChecks=False)
        self._ws = simpleobsws.WebSocketClient(
            url=f"ws://{host}:{port}",
            password=password,
            identification_parameters=params,
        )
        await self._ws.connect()
        await self._ws.wait_until_identified()
        self._connected = True

    async def disconnect(self) -> None:
        if self._ws:
            try:
                await self._ws.disconnect()
            except Exception:
                pass
        self._ws = None
        self._connected = False

    async def _request(self, request_type: str, data: dict | None = None) -> dict:
        if not self._connected or not self._ws:
            raise RuntimeError("Not connected to OBS")
        req = simpleobsws.Request(request_type, data or {})
        resp = await self._ws.call(req)
        if not resp.ok():
            raise RuntimeError(f"OBS request failed: {resp.requestStatus}")
        return resp.responseData or {}

    async def start_recording(self) -> None:
        await self._request("StartRecord")

    async def stop_recording(self) -> dict:
        return await self._request("StopRecord")

    async def pause_recording(self) -> None:
        await self._request("PauseRecord")

    async def resume_recording(self) -> None:
        await self._request("ResumeRecord")

    async def get_recording_status(self) -> RecordStatus:
        data = await self._request("GetRecordStatus")
        return RecordStatus(
            is_active=data.get("outputActive", False),
            is_paused=data.get("outputPaused", False),
            duration_ms=data.get("outputDuration", 0),
            bytes_=data.get("outputBytes", 0),
        )

    async def set_record_directory(self, path: str) -> None:
        await self._request("SetRecordDirectory", {"recordDirectory": path})
