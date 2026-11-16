"""Download the fixed NAIF kernels required by the local SPICE service."""

from __future__ import annotations

import sys
from hashlib import sha256
import urllib.request
from pathlib import Path

from kernels import KERNELS, KERNEL_DIR, KERNEL_SHA256

USER_AGENT = "Overhaul-Lunar-Navigator/1.0 (local SPICE kernel setup)"


def download(url: str, destination: Path) -> None:
    temporary = destination.with_suffix(destination.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=60) as response, temporary.open("wb") as output:
            if response.status != 200:
                raise RuntimeError(f"HTTP {response.status} ao baixar {url}")
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        if temporary.stat().st_size < 1024:
            raise RuntimeError(f"Arquivo baixado muito pequeno: {destination.name}")
        digest = sha256(temporary.read_bytes()).hexdigest()
        if digest != KERNEL_SHA256[destination.name]:
            raise RuntimeError(f"Invalid SHA-256 for {destination.name}; file will not be installed.")
        temporary.replace(destination)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def main() -> int:
    KERNEL_DIR.mkdir(parents=True, exist_ok=True)
    for name, url in KERNELS.items():
        destination = KERNEL_DIR / name
        if destination.is_file() and destination.stat().st_size >= 1024:
            if sha256(destination.read_bytes()).hexdigest() == KERNEL_SHA256[name]:
                print(f"Integridade confirmada: {name}")
                continue
            print(f"Existing file is invalid; downloading again: {name}")
        print(f"Baixando {name}…")
        try:
            download(url, destination)
        except Exception as error:
            print(f"Download failed for {name}: {error}", file=sys.stderr)
            return 1
    print(f"Kernels preparados em: {KERNEL_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
