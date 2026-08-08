# MeatScentinel device application

Touchscreen interface for the IoT gas sensing device.

## Running

Two entry points. Neither needs any configuration.

**Simulation — the full process, on any machine:**

```
python simulator.py
```

Opens two windows: the device screen exactly as the real hardware would
show it, and a control panel driving every scenario with a live event log
of what the device is doing.

From the panel you can: place a fresh, spoiled, undersized, or oversized
sample; remove it at any moment including mid-detection; fail and restore
each hardware component; choose whether uploads succeed, fail like a dead
network, or are rejected by the server; and retry queued uploads to watch
offline records drain once the network returns.

Starts on Ready with fast timings and demonstration thresholds: a fresh
sample ends FRESH, a spoiled one SPOILED. Simulator state lives in its own
files (sim_calibration.json, sim_queue.db) and never touches the real
device's.

The demonstration thresholds are tuned to the simulated gas curve so both
outcomes are reachable. They are not findings and must not be cited.

**Real hardware — on the Raspberry Pi:**

```
python device.py
```

Runs fullscreen against the MCP3008 and HX711 with production timings. If
the hardware libraries are missing it prints the pip install line and
exits. First run stops on "Sensors not calibrated", which is correct: Ro
must be measured for the actual sensors through Settings before ppm can be
computed. Thresholds remain unset until calibration trials establish them.

`app.py` is the shared interface; run it through one of the two launchers
rather than directly.

## Files

| File | Contains |
|---|---|
| `config.py` | Every value trials or testing will determine |
| `hardware.py` | Sensor access, simulated and real, and ppm conversion |
| `detection.py` | The detection cycle and calibration, on background threads |
| `submission.py` | Local queue and record submission |
| `app.py` | The interface |

## Ventilation

Ventilation runs until the sensors return to their calibrated clean-air
baseline, not for a fixed time. A heavily spoiled sample leaves more residue
than a fresh one, so a fixed duration is either wasteful or insufficient
depending on what preceded it.

The stop condition is Rs/Ro returning to the sensor's clean-air ratio, held
continuously for `CLEAR_HOLD_SECONDS`, after at least `VENT_MIN_SECONDS`.
Note the target is the datasheet clean-air ratio, **not 1.0**: Ro is defined
as the clean-air resistance divided by that ratio, so a sensor in clean air
reads Rs/Ro equal to the ratio itself.

Falling outside the band resets the hold, so a momentary dip into tolerance
cannot end a cycle. On timeout the chamber is not marked clear and detection
stays blocked — a timeout means the condition was not met, and treating it as
success would defeat the gate.

Clearance is verified **at the sensor**, not throughout the chamber. Residue
on the chamber walls may continue releasing gas while air at the sensor reads
clean.

## What is real and what is not

**Working and tested:** the interface and its state transitions, the detection
cycle with all its abort paths, ppm conversion, the local SQLite queue,
idempotent retry, and the simulator.

**Written but untested:** `Mcp3008Hardware` and `HttpTransport`. Neither can
be verified until the hardware is assembled and the endpoint exists.

**Placeholders:** every value in `config.py` marked TBD, and all classification
thresholds, which are `None`. An uncalibrated device reports that it is
uncalibrated rather than applying a threshold nobody measured.

## Before this runs on real hardware

- Fit the power-law curve constants from the datasheet sensitivity curves
- Measure the actual load resistance of both sensor modules
- Determine Ro for each sensor through the Settings screen
- Establish thresholds through calibration trials
- Acquire an exhaust fan; ventilation cannot be tested without one
- Decide the submission endpoint, payload schema, and authentication

## Testing without hardware

`SimulatedHardware` exposes controls the real hardware does not:

```python
hw.place_sample(grams=120, spoiled=True)
hw.remove_sample()
hw.fail('nh3')        # or 'h2s', 'loadcell', 'adc'
hw.clear_failures()
```

Gas values are chosen as ppm and converted backwards through the same curve
the application uses forwards, so the conversion chain is exercised rather
than bypassed.
