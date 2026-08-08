# MeatSentinel Kiosk — MVP

Standalone touchscreen kiosk app for the MeatSentinel gas-based freshness
inspection flow: select meat type → confirm sample placement → run the
gas detection cycle → view the local result → upload to Supabase →
ventilate the chamber.

Built against `MeatSentinel_Kiosk_MVP.md` (Modules 1–6 + system-level features).

## Project layout

```
main.py                 App entry point, wiring, global exception handler
config.json              Timings, GPIO pins, ADC channels, min readings
thresholds.json           NH3 / H2S thresholds per meat type
device.json                Fallback device id (real id read from /etc/machine-id)
.env.example                Supabase credentials template — copy to .env

hardware/                Sensor adapters — real GPIO/SPI with automatic
                          fallback to a mock layer when hardware isn't present
  mock.py
  ultrasonic.py            HC-SR04 presence sensor (Module 2)
  gas_sensors.py           MQ-135 / MQ-136 via MCP3008 ADC (Module 3)
  fan.py                    Exhaust fan relay (Module 6)

services/                 Non-UI logic
  db.py                     SQLite: last-selection state + offline queue
  network.py                Connectivity check
  supabase_client.py         Insert, Realtime confirmation, offline retry daemon

screens/                  One file per kiosk screen/module
kv/                        Kivy layout files, one per screen + shared styles

deploy/
  meatsentinel.service       systemd unit for boot automation (S.1)
  install_service.sh          Installs the above on the Pi
  schema.sql                  Supabase table + Realtime setup
```

## Running on a dev laptop (no Raspberry Pi needed)

The hardware layer auto-detects whether GPIO/SPI libraries and real
peripherals are available. If not, it transparently uses the mock
sensors in `hardware/mock.py`, so the full UI and flow can be built and
tested on a normal computer.

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # fill in your Supabase project URL + service key
python main.py
```

On the placement screen, use the **"Simulate Sample Placement (dev/mock
mode)"** button to trigger presence detection without real hardware.

## Deploying to the Raspberry Pi kiosk

1. Wire up the HC-SR04, MQ-135/MQ-136 (via MCP3008), and fan relay per
   the pin assignments in `config.json`.
2. `pip install -r requirements.txt` inside a venv on the Pi (this pulls
   in `gpiozero`, `RPi.GPIO`, `spidev` for the `armv7l`/`aarch64` targets).
3. Calibrate the touchscreen (`xinput_calibrator`) — see System feature S.2.
4. Set `hardware_mode` in `config.json` to `"real"` once you want the app
   to fail loudly instead of silently falling back to mock sensors.
5. Run `deploy/install_service.sh` to install and enable the systemd
   service so the kiosk launches on boot with no desktop shown.
6. In Supabase, run `deploy/schema.sql` to create the `inspections` table
   and enable Realtime replication on it.

## Notes / known simplifications for the MVP

- The NH3/H2S ADC-voltage-to-ppm conversion in `hardware/gas_sensors.py`
  is a placeholder linear mapping — swap in the real calibration curve
  from bench testing against known reference gas concentrations before
  relying on absolute ppm values.
- Realtime confirmation (Module 5.6) is best-effort: if the Realtime
  subscription can't be established (network hiccup, API version
  mismatch), the kiosk still trusts the synchronous REST insert result
  and logs a warning rather than blocking the UI.
- Combined (gas + vision) classification is explicitly out of scope for
  the kiosk per the MVP spec — that lives in the web app.
