"""
MQ-135 (NH3) / MQ-136 (H2S) gas sensor adapter, read via an MCP3008 ADC
over SPI. Falls back to the mock implementation off-Pi or when forced.
"""
import logging

from hardware.mock import MockGasSensorArray

log = logging.getLogger("meatsentinel.hardware.gas_sensors")


def _adc_voltage_to_ppm(voltage: float, vref: float, scale: float, offset: float) -> float:
    """Simple linear approximation. Replace with the sensor's real
    calibration curve (datasheet Rs/Ro logarithmic curve) once bench-
    calibrated against known reference gas concentrations."""
    ratio = voltage / vref
    return max(0.0, ratio * scale + offset)


def build_gas_sensor_array(adc_config: dict, hardware_mode: str = "auto"):
    if hardware_mode == "mock":
        log.info("Gas sensors: mock mode forced by config.")
        return MockGasSensorArray()

    try:
        from gpiozero import MCP3008
        import time

        vref = adc_config.get("vref", 3.3)
        nh3_adc = MCP3008(channel=adc_config["nh3_channel"])
        h2s_adc = MCP3008(channel=adc_config["h2s_channel"])

        class RealGasSensorArray:
            def warmup(self, seconds: float):
                time.sleep(seconds)

            def read_nh3_ppm(self) -> float:
                voltage = nh3_adc.value * vref
                return _adc_voltage_to_ppm(voltage, vref, scale=60.0, offset=0.0)

            def read_h2s_ppm(self) -> float:
                voltage = h2s_adc.value * vref
                return _adc_voltage_to_ppm(voltage, vref, scale=15.0, offset=0.0)

            def close(self):
                nh3_adc.close()
                h2s_adc.close()

        log.info("Gas sensors: real MCP3008/SPI hardware initialised.")
        return RealGasSensorArray()

    except Exception as exc:
        if hardware_mode == "real":
            raise RuntimeError(f"Gas sensor init failed and hardware_mode=real: {exc}")
        log.warning("Gas sensors: real hardware unavailable (%s). Falling back to mock.", exc)
        return MockGasSensorArray()
