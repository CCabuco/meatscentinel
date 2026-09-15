import logging
from logging.handlers import RotatingFileHandler


def setup_logging(log_file: str, max_bytes: int, backup_count: int):
    root = logging.getLogger("meatsentinel")
    root.setLevel(logging.INFO)

    file_handler = RotatingFileHandler(log_file, maxBytes=max_bytes, backupCount=backup_count)
    file_handler.setFormatter(
        logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    )
    root.addHandler(file_handler)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(logging.Formatter("[%(levelname)s] %(name)s: %(message)s"))
    root.addHandler(console_handler)

    return root
