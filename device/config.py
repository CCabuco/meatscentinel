"""
Every value that calibration trials or hardware testing will determine lives
here, so that when real numbers exist only this file changes.

Values marked TBD are placeholders. They are plausible starting points, not
findings. Do not cite them.
"""

# ─── Device identity ────────────────────────────────────────────────────────

DEVICE_ID = "MS-DEV-01"


# ─── Display ────────────────────────────────────────────────────────────────

SCREEN_WIDTH = 480
SCREEN_HEIGHT = 320
FULLSCREEN = False          # True on the Pi's touchscreen

LONG_PRESS_SECONDS = 3.0    # TBD — hold on IDLE to reach Settings


# ─── Detection ──────────────────────────────────────────────────────────────

# TBD — how long gas needs to accumulate to a stable reading. Determined by
# calibration trials; depends on chamber volume and sample mass.
DETECTION_SECONDS = 180

# TBD — interval between individual readings within the detection period.
SAMPLE_INTERVAL_SECONDS = 2.0

# TBD — sensor warm-up before readings are usable. MQ-136 module documentation
# cites 3-5 minutes; the figure for this build is untested.
WARMUP_SECONDS = 300


# ─── Sample presence ────────────────────────────────────────────────────────

# TBD — all three depend on load cell behaviour, which is untested.
PRESENCE_THRESHOLD_GRAMS = 20     # above this, a sample is present
MIN_SAMPLE_GRAMS = 50             # below this, too little to read reliably
MAX_SAMPLE_GRAMS = 500            # above this, likely more than one sample

# TBD — permitted drift during detection before the reading is abandoned.
WEIGHT_TOLERANCE_GRAMS = 15


# ─── Ventilation ────────────────────────────────────────────────────────────
#
# Ventilation stops when the sensors indicate the chamber has cleared, not
# after a fixed time. A heavily spoiled sample leaves far more residue than a
# fresh one, so any fixed duration is either wasteful or insufficient
# depending on what preceded it.
#
# The condition is Rs/Ro returning to the sensor's clean-air ratio. Note this
# target is NOT 1.0: Ro is defined as the clean-air resistance divided by the
# datasheet clean-air ratio, so a sensor sitting in clean air reads Rs/Ro
# equal to that ratio (NH3_CLEAN_AIR_RATIO, H2S_CLEAN_AIR_RATIO below).

# TBD — set from the observed spread of Rs/Ro in clean air on the assembled
# hardware. The tolerance must exceed the sensor's own noise, or the
# condition can never be met.
CLEAR_TOLERANCE = 0.15

# TBD — how long the readings must stay inside the band before stopping. One
# reading inside the band is not sufficient: noise alone can place a single
# sample there while the chamber is still clearing.
CLEAR_HOLD_SECONDS = 10.0

# TBD — minimum run regardless of readings. The sensors may already sit near
# baseline when the sample is removed, which would otherwise end the cycle
# immediately.
VENT_MIN_SECONDS = 30.0

# TBD — beyond this the cycle stops and reports that the chamber did not
# clear. Detection stays blocked: a timeout means the condition was not met,
# and treating it as success would defeat the gate.
VENT_TIMEOUT_SECONDS = 300.0

# Interval between checks while clearing.
VENT_POLL_SECONDS = 1.0


# ─── Classification thresholds ──────────────────────────────────────────────

# Deliberately None. These are the output of calibration trials against a
# freshness reference, and the device must refuse to classify rather than
# apply a value nobody measured. An uncalibrated device reports that it is
# uncalibrated; it does not guess.
#
# Populate as:  'chicken': {'nh3': 42.0, 'h2s': 8.0}
THRESHOLDS = {
    "chicken": {"nh3": None, "h2s": None},
    "beef":    {"nh3": None, "h2s": None},
    "pork":    {"nh3": None, "h2s": None},
}

SAMPLE_TYPES = ["chicken", "beef", "pork"]

SAMPLE_TYPE_LABELS = {
    "chicken": "Raw Chicken",
    "beef": "Raw Beef",
    "pork": "Raw Pork",
}


# ─── Reading validity ───────────────────────────────────────────────────────

# TBD — what variance indicates an unstable reading. Requires trial data:
# the spread of a genuinely stable reading on this hardware is unknown.
MAX_STDDEV_NH3 = None
MAX_STDDEV_H2S = None

# TBD — sensor range ceilings. A reading at the ceiling means the true value
# is unknown, not that it equals the ceiling.
NH3_RANGE_CEILING = 500.0     # MQ-137 datasheet range 5-500 ppm
H2S_RANGE_CEILING = 100.0     # MQ-136 datasheet range 1-100 ppm

# Minimum readings required before an average is considered complete.
MIN_READINGS_FOR_VALID = 10


# ─── Calibration ────────────────────────────────────────────────────────────

# TBD — both determined during calibration procedure development.
CALIBRATION_WARMUP_SECONDS = 1200    # 20 min in clean air before sampling
CALIBRATION_SAMPLE_COUNT = 200       # readings averaged to establish Ro

# Clean-air Rs/Ro ratio from the datasheets. Ro = Rs_clean / this value.
# TBD — read from the datasheet sensitivity curves; values below are
# placeholders and must be replaced with figures taken from the curves.
NH3_CLEAN_AIR_RATIO = 3.6
H2S_CLEAN_AIR_RATIO = 3.6

# Load resistance in the sensor module divider circuit, ohms.
# TBD — measure the actual modules; module documentation varies.
RL_NH3 = 47000
RL_H2S = 20000


# ─── Power-law conversion ───────────────────────────────────────────────────

# ppm = a * (Rs/Ro) ** b, fitted from the datasheet log-log sensitivity curve.
# TBD — these must be fitted from the curves for the specific sensors used.
# The values below are placeholders taken from published fits and are not
# valid for this hardware until re-derived.
NH3_CURVE_A = 102.2
NH3_CURVE_B = -2.473
H2S_CURVE_A = 36.737
H2S_CURVE_B = -3.536


# ─── Upload ─────────────────────────────────────────────────────────────────

# TBD — the endpoint and authentication are not yet decided.
SUBMIT_ENDPOINT = None
DEVICE_SECRET = None

UPLOAD_TIMEOUT_SECONDS = 15
RETRY_BASE_SECONDS = 30           # TBD — backoff base
MAX_RETRY_ATTEMPTS = 10           # TBD
QUEUE_WARNING_DEPTH = 20          # warn on IDLE beyond this many pending


# ─── Storage ────────────────────────────────────────────────────────────────

QUEUE_DB_PATH = "meatscentinel_queue.db"
CALIBRATION_PATH = "calibration.json"


# ─── Development ────────────────────────────────────────────────────────────

# False uses the real MCP3008 and HX711. True uses simulated hardware, so the
# interface can be developed and demonstrated without the sensors assembled.
SIMULATE_HARDWARE = False

SHOW_LIVE_VALUES = True    # live ppm during detection; off for demonstration
