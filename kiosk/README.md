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
  schema.sql                  Reference doc for the shared schema (not a script to run — see below)
```

## Shared Supabase schema

The kiosk shares one Supabase project with the MeatSentinel web dashboard.
The schema (tables, enums, RLS, triggers) is owned and migrated from the
**web app's** repo, not this one — `deploy/schema.sql` here is read-only
reference documentation, not something you run.

The kiosk only ever writes to two tables, both via `services/supabase_client.py`:

1. `inspection_records` — upserted first (`inspection_id` only). A
   database trigger on this table automatically creates the case's first
   `status_entries` row (`status='Open'`). **Never** insert into
   `status_entries` from kiosk code — it's append-only (deletes/updates
   are blocked by a trigger), so a duplicate row can't be undone.
2. `gas_submissions` — inserted second (it foreign-keys to
   `inspection_records.inspection_id`, so the parent must exist first),
   carrying `sample_type`, `nh3_ppm`, `h2s_ppm`, `gas_result`
   (`'Fresh'`/`'Spoiled'`, only when `is_valid`), `is_valid`, and
   `detected_at`. This table rejects writes to a row that already exists
   ("immutable once received"), so it's a plain insert guarded by an
   existence check — not an upsert like `inspection_records`.

Each inspection cycle gets a fresh `inspection_id` (`uuid4`, generated in
`MeatSentinelApp.reset_inspection_state()`), matching the
`inspection_id_format` check constraint. Because `inspection_records` is
upserted and `gas_submissions` checks-before-inserting, a failed upload
can always be retried from the offline queue without risking a
duplicate-key error or an immutability rejection.

`final_classification` on `inspection_records` (the combined gas+vision
verdict) and everything in `image_submissions`/`accounts`/`remarks` is
the web app's responsibility — the kiosk never touches them.

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
6. Fill in `.env` with the shared Supabase project's URL and service-role
   key (ask the web app team) — see "Shared Supabase schema" above for
   what the kiosk expects to already exist. Optionally enable Realtime on
   `gas_submissions` (Database > Replication in the dashboard) so the
   kiosk's best-effort upload confirmation works.

## Notes / known simplifications for the MVP

- The NH3/H2S ADC-voltage-to-ppm conversion in `hardware/gas_sensors.py`
  is a placeholder linear mapping — swap in the real calibration curve
  from bench testing against known reference gas concentrations before
  relying on absolute ppm values.
- Realtime confirmation (Module 5.6) is a permanent no-op by design:
  supabase-py's *synchronous* client (what this kiosk uses everywhere,
  since the whole app is thread/callback-based, not asyncio) explicitly
  does not support Realtime — only `create_async_client` does. Making it
  work would mean running a dedicated asyncio event loop in a background
  thread just for this. Decided against it: the REST insert result
  already gives the kiosk a reliable, synchronous success/failure signal
  (that's what actually drives "Upload Successful"/"Upload Failed" in the
  UI), so Realtime would only ever be a cosmetic extra confirmation.
  `RealtimeConfirmer.start()` still tries `.channel()` and logs a clear
  one-line warning when it's refused, rather than blocking the UI.
- Combined (gas + vision) classification is explicitly out of scope for
  the kiosk per the MVP spec — that lives in the web app.
- `requirements.txt` pins `httpx==0.27.2` and `websockets>=13,<16`
  alongside `supabase==2.31.0`. Both matter: `supabase` itself declares a
  correct `httpx` range now (unlike the `2.4.0` this project started on,
  which had stale metadata that crashed every client build — see git
  history if curious), but `realtime`'s declared `websockets` range
  (`>=11,<16`) is looser than what it actually needs at runtime
  (`websockets.asyncio`, added in 13) — an unpinned install can still
  resolve `websockets` 12.x and crash with `No module named
  'websockets.asyncio'`.
