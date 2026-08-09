"""Exhaust fan relay adapter (Module 6 — Chamber Ventilation)."""
import logging

from hardware.mock import MockFan

log = logging.getLogger("meatsentinel.hardware.fan")


def build_fan(pins: dict, hardware_mode: str = "auto"):
    if hardware_mode == "mock":
        log.info("Fan: mock mode forced by config.")
        return MockFan()

    try:
        from gpiozero import OutputDevice

        relay = OutputDevice(pins["fan_relay"], active_high=True, initial_value=False)

        class RealFan:
            @property
            def is_active(self):
                return relay.is_active

            def on(self):
                relay.on()

            def off(self):
                relay.off()

            def close(self):
                relay.close()

        log.info("Fan: real GPIO relay initialised.")
        return RealFan()

    except Exception as exc:
        if hardware_mode == "real":
            raise RuntimeError(f"Fan init failed and hardware_mode=real: {exc}")
        log.warning("Fan: real hardware unavailable (%s). Falling back to mock.", exc)
        return MockFan()
