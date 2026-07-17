"""Run script for LocalShare internal API server.

Starts the internal API on 127.0.0.1 (default port 8765) for the GNOME
Shell extension to communicate with. The main browser-facing server is
spawned on demand by ServerManager when sharing is enabled.
"""

import argparse
import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import uvicorn
from uvicorn.config import Config


def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )


def main():
    setup_logging()
    logger = logging.getLogger(__name__)

    parser = argparse.ArgumentParser(description="LocalShare Backend")
    parser.add_argument(
        "--port", type=int, default=8080, help="Main browser server port (default: 8080)"
    )
    parser.add_argument(
        "--internal-port",
        type=int,
        default=8765,
        help="Internal API port for extension communication (default: 8765)",
    )
    parser.add_argument(
        "--data-dir",
        type=str,
        default=None,
        help="Data directory for JSON storage",
    )
    args = parser.parse_args()

    data_dir = args.data_dir or str(Path(__file__).parent / "data")

    os.environ["LOCALSHARE_PORT"] = str(args.port)
    os.environ["LOCALSHARE_INTERNAL_PORT"] = str(args.internal_port)
    os.environ["LOCALSHARE_DATA_DIR"] = data_dir

    logger.info("Starting LocalShare internal API server")
    logger.info(f"Internal API: 127.0.0.1:{args.internal_port}")
    logger.info(f"Main server will be on 0.0.0.0:{args.port} when started")
    logger.info(f"Data directory: {data_dir}")

    config = Config(
        "backend.main:app",
        host="127.0.0.1",
        port=args.internal_port,
        log_level="info",
    )
    server = uvicorn.Server(config)
    server.run()


if __name__ == "__main__":
    main()
