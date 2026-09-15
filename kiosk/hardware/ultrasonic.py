"""
HC-SR04 (or equivalent) ultrasonic distance sensor adapter.

Tries real gpiozero hardware; falls back to the mock implementation when
gpiozero / RPi GPIO isn't available (e.g. running on a dev laptop) or when
hardware_mode is forced to "mock" in config.json.
"""
import logging

from hardware.mock import MockUltrasonicSensor

log = logging.getLogger("meatsentinel.hardware.ultrasonic")


def build_ultrasonic_sensor(pins: dict, hardware_mode: str = "auto"):
    if hardware_mode == "mock":
        log.info("Ultrasonic sensor: mock mode forced by config.")
        return MockUltrasonicSensor()

    try:
        from gpiozero import DistanceSensor

        sensor = DistanceSensor(
            echo=pins["ultrasonic_echo"],
            trigger=pins["ultrasonic_trigger"],
            max_distance=2.0,
        )

        class RealUltrasonicSensor:
            def distance_cm(self) -> float:
                return sensor.distance * 100.0

            def close(self):
                sensor.close()

        log.info("Ultrasonic sensor: real GPIO hardware initialised.")
        return RealUltrasonicSensor()

    except Exception as exc:  # gpiozero missing, no GPIO backend, wrong platform, etc.
        if hardware_mode == "real":
            raise RuntimeError(f"Ultrasonic sensor init failed and hardware_mode=real: {exc}")
        log.warning("Ultrasonic sensor: real hardware unavailable (%s). Falling back to mock.", exc)
        return MockUltrasonicSensor()
