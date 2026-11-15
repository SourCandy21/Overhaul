from hashlib import sha256
from pathlib import Path

KERNEL_DIR = Path(__file__).resolve().parent / "kernels"

KERNELS = {
    "naif0012.tls": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls",
    "de440s.bsp": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp",
    "moon_de440_250416.tf": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/moon_de440_250416.tf",
    "moon_pa_de440_200625.bpc": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/moon_pa_de440_200625.bpc",
}

KERNEL_SHA256 = {
    "naif0012.tls": "678e32bdb5a744117a467cd9601cd6b373f0e9bc9bbde1371d5eee39600a039b",
    "de440s.bsp": "c1c7feeab882263fc493a9d5a5b2ddd71b54826cdf65d8d17a76126b260a49f2",
    "moon_de440_250416.tf": "a47c71e9c9f33796bdafb2c9d69a7ee447b6016ecad80f71cd6f3e479f9cf768",
    "moon_pa_de440_200625.bpc": "60cd55aa401ea2ea97360636f567554bfe4e37bb829f901b4460a455dfaf783f",
}


def missing_kernels() -> list[str]:
    return [name for name in KERNELS if not (KERNEL_DIR / name).is_file()]


def invalid_kernels() -> list[str]:
    invalid: list[str] = []
    for name, expected in KERNEL_SHA256.items():
        path = KERNEL_DIR / name
        if not path.is_file():
            continue
        digest = sha256(path.read_bytes()).hexdigest()
        if digest != expected:
            invalid.append(name)
    return invalid
