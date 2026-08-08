"""
MeatScentinel — SIMULATOR

Run:  python simulator.py

Runs the full inspection process with simulated hardware and nothing to
configure. Everything the process needs is set up here:

  - Simulated sensors and load cell (on-screen buttons place samples)
  - Fast timings, so a full cycle takes under a minute
  - Pre-seeded calibration, so the device starts on Ready
  - Demonstration thresholds tuned to the simulated gas curve, so a fresh
    sample ends FRESH and a spoiled sample ends SPOILED

The values set here are for demonstrating the process. They are not
findings and must not be cited: the real detection period, calibration
procedure, and thresholds come from calibration trials and belong in
config.py on the real device.

Simulator state is kept in its own files (sim_calibration.json,
sim_queue.db) so running this never touches the real device's calibration
or queue.
"""

import json
import os

import config

# ─── Simulation overrides — applied before the app starts ───────────────────

config.SIMULATE_HARDWARE = True

# Fast demonstration timings.
config.DETECTION_SECONDS = 15
config.SAMPLE_INTERVAL_SECONDS = 0.5
config.VENT_MIN_SECONDS = 3.0
config.CLEAR_HOLD_SECONDS = 2.0
config.VENT_POLL_SECONDS = 0.3
config.VENT_TIMEOUT_SECONDS = 45.0
config.CALIBRATION_WARMUP_SECONDS = 5
config.CALIBRATION_SAMPLE_COUNT = 20
config.LONG_PRESS_SECONDS = 1.0

# Demonstration thresholds, tuned to the simulator's gas curve at a
# 15-second detection so both outcomes are reachable. NOT trial results.
config.THRESHOLDS = {
    "chicken": {"nh3": 12.0, "h2s": 5.0},
    "beef":    {"nh3": 12.0, "h2s": 5.0},
    "pork":    {"nh3": 12.0, "h2s": 5.0},
}

# Simulator state lives in its own files.
config.CALIBRATION_PATH = "sim_calibration.json"
config.QUEUE_DB_PATH = "sim_queue.db"

# Pre-seed calibration so the simulator starts on Ready rather than FAULT.
#
# Ro is derived the same way the calibration procedure derives it — the
# clean-air resistance divided by the datasheet clean-air ratio — so the
# seeded value is consistent with the concentrations the simulator produces.
# Arbitrary numbers here would make ventilation aim at a ratio the simulated
# sensor never reaches.
if not os.path.exists(config.CALIBRATION_PATH):
    with open(config.CALIBRATION_PATH, "w") as f:
        json.dump({
            "ro_nh3": config.RL_NH3 * 2.0 / config.NH3_CLEAN_AIR_RATIO,
            "ro_h2s": config.RL_H2S * 2.0 / config.H2S_CLEAN_AIR_RATIO,
        }, f)


# ─── Start ──────────────────────────────────────────────────────────────────

from app import DeviceApp
import sim_controls


def main():
    app = DeviceApp()
    sim_controls.attach(app)
    try:
        app.mainloop()
    finally:
        app.hardware.close()


if __name__ == "__main__":
    print("MeatScentinel simulator — controls are in the second window.")
    main()
