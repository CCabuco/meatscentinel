# MeatSentinel Kiosk — MVP

Standalone touchscreen kiosk app for the MeatSentinel gas-based freshness
inspection flow: select meat type → confirm sample placement → run the
gas detection cycle → view the local result → upload to Supabase →
ventilate the chamber.

Built against `MeatSentinel_Kiosk_MVP.md` (Modules 1–6 + system-level features).

## Project layout

```
main.py                 App entry point, wiring, global exception handler
config.json              Timings, ESP32 URL + ADC-to-ppm scaling, min readings
thresholds.json           NH3 / H2S thresholds per meat type
device.json                Fallback device id (real id read from /etc/machine-id)
.env.example                Upload settings template (URL + device secret) — copy to .env

hardware/                Sensor/fan adapter — HTTP client for the ESP32
  esp32.py                  HX711 presence, MQ-137 (NH3) / MQ-136 (H2S),
                            exhaust fan relay (Modules 2, 3, 6)

services/                 Non-UI logic
  db.py                     SQLite: last-selection state, offline queue, rejected records
  network.py                Connectivity check
  supabase_client.py         Upload via submit-inspection Edge Function, offline retry daemon

screens/                  One file per kiosk screen/module
kv/                        Kivy layout files, one per screen + shared styles

deploy/
  meatsentinel.service       systemd unit for boot automation (S.1)
  install_service.sh          Installs the above on the Pi
  schema.sql                  Reference doc for the shared schema (not a script to run — see below)
```

## Uploading to Supabase (shared with the web dashboard)

The kiosk does **not** connect to the database directly and does **not**
hold the Supabase service key. Each gas result is POSTed to the
`submit-inspection` Edge Function with a `DEVICE_SECRET` in the
`x-device-secret` header. The function validates the payload and writes
it through `submit_device_inspection()` (migration
`016_device_submission.sql`), which only `service_role` may execute. So
even if a kiosk is stolen, its secret can only add gas submissions; it
cannot read inspections, accounts or anything else. Rotate the secret on
the server to cut a lost kiosk off.

What the server does with one upload:

1. Inserts the `gas_submissions` row. Its `gas_ensure_parent` trigger
   creates the `inspection_records` row, which creates the first `Open`
   status entry. The kiosk never touches `status_entries`.
2. Records `submission_id` in a private `device_submissions` ledger.
3. Fusion runs automatically once the image half also exists.

Responses and what the kiosk does:

| Server answer | Meaning | Kiosk action |
|---|---|---|
| 201 created / 200 duplicate | Stored (duplicate = an earlier attempt already got through) | Success |
| 409 conflict | Inspection already has a gas result | Moved to the `rejected` table, not retried |
| 400 / 422 | Bad payload | Moved to the `rejected` table, not retried |
| 401 | `DEVICE_SECRET` wrong | Stays queued until fixed |
| network error / 5xx | Temporary | Stays queued, retried every 30 s |

`submission_id` is a uuid5 of `inspection_id`, so every retry of the same
inspection sends the same id. Rejected records stay in `offline_queue.db`
(table `rejected`) and in `inspection.log`; nothing is silently dropped.

Each upload also carries `device_id`, `reading_count`, and the NH3/H2S
standard deviations. The server flags `clock_reliable = false` if
`detected_at` is in the future or older than 30 days (a Pi with no
internet has no time sync).

## Running on a laptop

All chamber hardware lives on an ESP32 (`SYS07_ESP32_Dashboard.ino`)
that the kiosk drives over HTTP, so the kiosk runs on any machine that
can reach `esp32.base_url`. There is no simulated hardware: until the
ESP32 answers, the screens show "unavailable" states rather than faking
readings.

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # fill in SUPABASE_URL + DEVICE_SECRET
python main.py
```

On the placement screen, Start Detection unlocks only once the ESP32's
HX711 weight sensor reports an object present.

## Deploying to the Raspberry Pi kiosk

1. Flash the ESP32 with `SYS07_ESP32_Dashboard.ino` (sensors and fan
   relay are wired to the ESP32, not the Pi). Put the Pi on a network
   where it can reach the ESP32 **and** the internet, and set
   `esp32.base_url` in `config.json` to the ESP32's address on it.
2. `pip install -r requirements.txt` inside a venv on the Pi.
3. Calibrate the touchscreen (`xinput_calibrator`) — see System feature S.2.
4. Run `deploy/install_service.sh` to install and enable the systemd
   service so the kiosk launches on boot with no desktop shown.
5. Fill in `.env` with `SUPABASE_URL` and the `DEVICE_SECRET` (ask the
   web app team; it must match the Edge Function secret). Never put the
   service key on the kiosk.

## Notes / known simplifications for the MVP

- The ESP32 reports raw 12-bit ADC counts, not ppm. The conversion in
  `hardware/esp32.py` (`esp32.*_ppm_scale` / `*_ppm_offset` in
  `config.json`) is a placeholder linear mapping — swap in the real calibration curve
  from bench testing against known reference gas concentrations before
  relying on absolute ppm values.
- Realtime confirmation (Module 5.6) was removed. The Edge Function's
  HTTP response is the confirmation: 201/200 means the row is stored.
- Combined (gas + vision) classification is explicitly out of scope for
  the kiosk per the MVP spec — that lives in the web app.
