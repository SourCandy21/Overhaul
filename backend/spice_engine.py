"""Local Sun/Earth topocentric ephemerides using NAIF SPICE kernels."""

from __future__ import annotations

import math
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

try:
    import spiceypy as spice
except ImportError as error:  # pragma: no cover - reported by the HTTP health endpoint
    spice = None  # type: ignore[assignment]
    SPICE_IMPORT_ERROR = error
else:
    SPICE_IMPORT_ERROR = None

from kernels import KERNELS, KERNEL_DIR, invalid_kernels, missing_kernels

LUNAR_RADIUS_KM = 1737.4
MOON_FRAME = "MOON_ME"
STEP_SECONDS = {"30m": 1800, "1h": 3600, "2h": 7200, "4h": 14400}
_SPICE_LOCK = threading.RLock()
_KERNELS_LOADED = False


class SpiceUnavailable(RuntimeError):
    pass


def ensure_kernels_loaded() -> None:
    global _KERNELS_LOADED
    if SPICE_IMPORT_ERROR:
        raise SpiceUnavailable("Instale as dependências do backend com: pip install -r backend/requirements.txt")
    with _SPICE_LOCK:
        if _KERNELS_LOADED:
            return
        missing = missing_kernels()
        if missing:
            raise SpiceUnavailable(
                "Kernels SPICE ausentes: " + ", ".join(missing) + ". Execute: python backend/download_kernels.py"
            )
        invalid = invalid_kernels()
        if invalid:
            raise SpiceUnavailable(
                "Falha na verificação SHA-256 dos kernels: " + ", ".join(invalid) + ". Execute: python backend/download_kernels.py"
            )
        assert spice is not None
        spice.kclear()
        try:
            for name in KERNELS:
                spice.furnsh(str(KERNEL_DIR / name))
            if spice.namfrm(MOON_FRAME) == 0:
                raise RuntimeError(f"Frame SPICE não definido: {MOON_FRAME}")
            if spice.wncard(spice.spkcov(str(KERNEL_DIR / "de440s.bsp"), 301)) == 0:
                raise RuntimeError("O kernel planetary DE440s não contém cobertura para a Lua.")
        except Exception as error:
            spice.kclear()
            raise SpiceUnavailable(f"Não foi possível carregar os kernels SPICE: {error}") from error
        _KERNELS_LOADED = True


def _parse_datetime(value: str, name: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"'{name}' deve ser uma data/hora ISO 8601 válida.") from error
    if parsed.tzinfo is None:
        raise ValueError(f"'{name}' precisa incluir fuso horário (por exemplo, Z ou -03:00).")
    return parsed.astimezone(timezone.utc)


def _finite_float(value: str, name: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"'{name}' deve ser numérico.") from error
    if not math.isfinite(result):
        raise ValueError(f"'{name}' deve ser um número finito.")
    return result


def parse_request(params: dict[str, str]) -> dict[str, Any]:
    required = ("latitude", "longitude", "altitude_m", "start", "end", "step")
    missing = [key for key in required if not params.get(key)]
    if missing:
        raise ValueError("Parâmetros obrigatórios ausentes: " + ", ".join(missing))

    latitude = _finite_float(params["latitude"], "latitude")
    longitude = _finite_float(params["longitude"], "longitude")
    altitude_m = _finite_float(params["altitude_m"], "altitude_m")
    if not -90 <= latitude <= 90:
        raise ValueError("'latitude' deve estar entre -90 e 90 graus.")
    if not -180 <= longitude <= 180:
        raise ValueError("'longitude' deve estar entre -180 e 180 graus.")
    if not -10_000 <= altitude_m <= 10_000:
        raise ValueError("'altitude_m' deve estar entre -10000 e 10000 metros em relação à esfera de referência.")

    start = _parse_datetime(params["start"], "start")
    end = _parse_datetime(params["end"], "end")
    if end <= start:
        raise ValueError("'end' precisa ser posterior a 'start'.")
    if end - start > timedelta(hours=72):
        raise ValueError("O período máximo por consulta é de 72 horas.")

    step = params["step"].strip().lower()
    if step not in STEP_SECONDS:
        raise ValueError("'step' deve ser 30m, 1h, 2h ou 4h.")

    return {"latitude": latitude, "longitude": longitude, "altitude_m": altitude_m, "start": start, "end": end, "step": step}


def _iso_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _observer_position(latitude: float, longitude: float, altitude_m: float) -> tuple[list[float], tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]], float]:
    lat = math.radians(latitude)
    lon = math.radians(longitude)
    up = (math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat))
    east = (-math.sin(lon), math.cos(lon), 0.0)
    north = (-math.sin(lat) * math.cos(lon), -math.sin(lat) * math.sin(lon), math.cos(lat))
    radius = LUNAR_RADIUS_KM + altitude_m / 1000
    position = [radius * component for component in up]
    geometric_horizon = -math.degrees(math.acos(min(1.0, LUNAR_RADIUS_KM / radius)))
    return position, (up, east, north), geometric_horizon


def _position(target: str, et: float, observer_position: list[float], axes: tuple[tuple[float, float, float], ...], geometric_horizon: float) -> dict[str, float | bool]:
    assert spice is not None
    state, _light_time = spice.spkcpo(
        target,
        et,
        MOON_FRAME,
        "OBSERVER",
        "CN+S",
        observer_position,
        "MOON",
        MOON_FRAME,
    )
    vector = state[:3]
    up, east, north = axes
    vertical = sum(vector[index] * up[index] for index in range(3))
    east_component = sum(vector[index] * east[index] for index in range(3))
    north_component = sum(vector[index] * north[index] for index in range(3))
    horizontal = math.hypot(east_component, north_component)
    elevation = math.degrees(math.atan2(vertical, horizontal))
    azimuth = math.degrees(math.atan2(east_component, north_component)) % 360
    return {"azimuth_deg": azimuth, "elevation_deg": elevation, "above_local_horizon": elevation > geometric_horizon}


def _visible_hours(observations: list[dict[str, Any]], body: str) -> float:
    hours = 0.0
    for first, second in zip(observations, observations[1:]):
        elapsed = (datetime.fromisoformat(second["time"].replace("Z", "+00:00")) - datetime.fromisoformat(first["time"].replace("Z", "+00:00"))).total_seconds() / 3600
        a = float(first[body]["elevation_deg"]) - float(first.get("geometric_horizon_elevation_deg", 0.0))
        b = float(second[body]["elevation_deg"]) - float(second.get("geometric_horizon_elevation_deg", 0.0))
        if a >= 0 and b >= 0:
            hours += elapsed
        elif (a >= 0) != (b >= 0):
            fraction = a / (a - b) if a != b else 0.5
            hours += elapsed * (fraction if a >= 0 else 1 - fraction)
    return hours


def analyze(raw_params: dict[str, str]) -> dict[str, Any]:
    request = parse_request(raw_params)
    ensure_kernels_loaded()
    assert spice is not None

    with _SPICE_LOCK:
        observer_position, axes, geometric_horizon = _observer_position(request["latitude"], request["longitude"], request["altitude_m"])
        start_et = spice.utc2et(_iso_utc(request["start"]))
        end_et = spice.utc2et(_iso_utc(request["end"]))
        coverage = spice.spkcov(str(KERNEL_DIR / "de440s.bsp"), 301)
        count = spice.wncard(coverage)
        coverage_intervals = [spice.wnfetd(coverage, index) for index in range(count)]
        if not any(begin + 86400 <= start_et and end_et <= finish - 86400 for begin, finish in coverage_intervals):
            raise ValueError("A data ou o período está fora da cobertura segura dos kernels DE440s instalados (aprox. 1850–2149 UTC).")

        interval_seconds = STEP_SECONDS[request["step"]]
        total_seconds = (request["end"] - request["start"]).total_seconds()
        elapsed_seconds = [index * interval_seconds for index in range(int(total_seconds // interval_seconds) + 1)]
        if elapsed_seconds[-1] < total_seconds:
            elapsed_seconds.append(total_seconds)

        observations: list[dict[str, Any]] = []
        for elapsed in elapsed_seconds:
            instant = request["start"] + timedelta(seconds=elapsed)
            et = spice.utc2et(_iso_utc(instant))
            sun = _position("SUN", et, observer_position, axes, geometric_horizon)
            earth = _position("EARTH", et, observer_position, axes, geometric_horizon)
            observations.append({"time": _iso_utc(instant), "sun": sun, "earth": earth, "geometric_horizon_elevation_deg": geometric_horizon})

    return {
        "site": {
            "id": "custom",
            "name": "Local personalizado",
            "latitude": request["latitude"],
            "longitude": request["longitude"],
            "altitude_m": request["altitude_m"],
        },
        "interval": {
            "start": _iso_utc(request["start"]),
            "end": _iso_utc(request["end"]),
            "step": request["step"],
        },
        "observations": observations,
        "summary": {
            "sunlight_hours": _visible_hours(observations, "sun"),
            "earth_visibility_hours": _visible_hours(observations, "earth"),
            "terrain_adjusted": False,
        },
    }
