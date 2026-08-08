"""
MeatScentinel — DEVICE

Run:  python device.py

Runs against the real hardware: MQ-137 and MQ-136 through the MCP3008 ADC,
and the HX711 load cell. For the Raspberry Pi with the sensors wired.

Nothing to configure to start it — but the first run on new hardware will
stop on the FAULT screen with "Sensors not calibrated", which is correct:
Ro must be measured for these specific sensors (Settings, with the chamber
empty in clean air) before any ppm can be computed.

Classification thresholds are unset until calibration trials establish
them. Until then the device reports measurements and states that
classification is unavailable, rather than guessing.

If the required libraries are missing, this prints what to install and
exits rather than crashing mid-start.
"""

import sys

import config

config.SIMULATE_HARDWARE = False
config.FULLSCREEN = True          # the 3.5 inch touchscreen


# ─── Preflight: fail with instructions, not a traceback ─────────────────────

_MISSING = []

for module, package in [
    ("board", "adafruit-blinka"),
    ("adafruit_mcp3xxx.mcp3008", "adafruit-circuitpython-mcp3xxx"),
    ("hx711", "hx711"),
    ("RPi.GPIO", "RPi.GPIO"),
]:
    try:
        __import__(module)
    except ImportError:
        _MISSING.append(package)

if _MISSING:
    print("Missing hardware libraries. On the Raspberry Pi, run:")
    print()
    print(f"  pip install {' '.join(sorted(set(_MISSING)))}")
    print()
    print("Then run this again. (To try the interface without hardware,")
    print("run the simulator instead:  python simulator.py)")
    sys.exit(1)


# ─── Start ──────────────────────────────────────────────────────────────────

from app import main

if __name__ == "__main__":
    main()
