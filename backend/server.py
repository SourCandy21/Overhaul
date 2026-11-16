"""Small local HTTP API for the Overhaul lunar navigator."""

from __future__ import annotations

import json
import ipaddress
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from spice_engine import SpiceUnavailable, analyze, ensure_kernels_loaded

PUBLIC_DEPLOYMENT = os.getenv("OVERHAUL_PUBLIC_DEPLOYMENT", "false").lower() == "true"
HOST = os.getenv("OVERHAUL_API_HOST", "0.0.0.0" if PUBLIC_DEPLOYMENT else "127.0.0.1")
PORT = int(os.getenv("PORT", os.getenv("OVERHAUL_API_PORT", "8000")))
try:
    if not ipaddress.ip_address(HOST).is_loopback and not PUBLIC_DEPLOYMENT:
        raise ValueError
except ValueError as error:
    raise RuntimeError("To listen outside loopback, explicitly enable OVERHAUL_PUBLIC_DEPLOYMENT=true.") from error
if not 1 <= PORT <= 65535:
    raise RuntimeError("OVERHAUL_API_PORT must be between 1 and 65535.")
ALLOWED_ORIGINS = {
    origin.strip()
    for origin in os.getenv(
        "OVERHAUL_CORS_ORIGINS",
        "" if PUBLIC_DEPLOYMENT else "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174",
    ).split(",")
    if origin.strip()
}
if PUBLIC_DEPLOYMENT and (
    not ALLOWED_ORIGINS
    or "*" in ALLOWED_ORIGINS
    or any(not origin.startswith("https://") for origin in ALLOWED_ORIGINS)
):
    raise RuntimeError("For public deployments, OVERHAUL_CORS_ORIGINS must list the exact HTTPS origin of the frontend.")
ANALYSIS_SLOTS = threading.BoundedSemaphore(value=2)


class APIHandler(BaseHTTPRequestHandler):
    server_version = "OverhaulSPICE/1.0"
    sys_version = ""

    def _send_json(self, status: int, payload: dict, origin: str | None = None, extra_headers: dict[str, str] | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def _origin(self) -> tuple[str | None, bool]:
        origin = self.headers.get("Origin")
        if not origin:
            return None, True
        return (origin, True) if origin in ALLOWED_ORIGINS else (None, False)

    def do_OPTIONS(self) -> None:  # noqa: N802
        origin, allowed = self._origin()
        if not allowed:
            self._send_json(403, {"error": "Origin not authorized for this backend."})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Accept, Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        origin, allowed = self._origin()
        if not allowed:
            self._send_json(403, {"error": "Origin not authorized for this backend."})
            return

        path = urlsplit(self.path)
        if path.path == "/health":
            try:
                ensure_kernels_loaded()
            except SpiceUnavailable as error:
                self._send_json(503, {"status": "needs_setup", "provider": "NAIF SPICE local", "kernels_ready": False, "error": str(error)}, origin)
            else:
                self._send_json(200, {"status": "ok", "provider": "NAIF SPICE local", "kernels_ready": True}, origin)
            return

        if path.path != "/api/analysis":
            self._send_json(404, {"error": "Route not found."}, origin)
            return

        if origin is None:
            self._send_json(403, {"error": "Analysis requires an authorized web origin."})
            return
        if len(self.path) > 4096:
            self._send_json(414, {"error": "The query exceeds the maximum allowed size."}, origin)
            return

        try:
            parsed = parse_qs(path.query, keep_blank_values=True, max_num_fields=8, strict_parsing=True)
            if any(len(values) != 1 for values in parsed.values()):
                raise ValueError("Repeated parameters are not accepted.")
            allowed_params = {"latitude", "longitude", "altitude_m", "start", "end", "step"}
            unexpected = set(parsed) - allowed_params
            if unexpected:
                raise ValueError("Unknown parameters: " + ", ".join(sorted(unexpected)))
            params = {key: values[0] for key, values in parsed.items()}
        except ValueError as error:
            self._send_json(400, {"error": str(error)}, origin)
            return

        if not ANALYSIS_SLOTS.acquire(blocking=False):
            self._send_json(503, {"error": "The service is busy. Try again in a few seconds."}, origin, {"Retry-After": "2"})
            return
        try:
            try:
                result = analyze(params)
            finally:
                ANALYSIS_SLOTS.release()
        except ValueError as error:
            self._send_json(400, {"error": str(error)}, origin)
        except SpiceUnavailable as error:
            self._send_json(503, {"error": str(error)}, origin)
        except Exception as error:
            print(f"SPICE calculation error: {error}", file=sys.stderr)
            self._send_json(502, {"error": "SPICE calculation failed for the requested time period and coordinates."}, origin)
        else:
            self._send_json(200, result, origin)

    def log_message(self, format_string: str, *args: object) -> None:
        route = urlsplit(self.path).path
        status = args[1] if len(args) > 1 else "?"
        print(f"{self.log_date_time_string()} {self.client_address[0]} {self.command} {route} {status}")


def main() -> None:
    try:
        ensure_kernels_loaded()
        print("SPICE kernels loaded (DE440s + MOON_ME lunar frame).")
    except SpiceUnavailable as error:
        print(f"Warning: {error}", file=sys.stderr)
    server = ThreadingHTTPServer((HOST, PORT), APIHandler)
    print(f"Overhaul API listening on http://{HOST}:{PORT}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nEncerrando backend…")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
