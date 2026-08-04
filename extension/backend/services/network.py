"""Network utilities for LocalShare."""

import logging
import socket

logger = logging.getLogger(__name__)


def get_local_ip() -> str | None:
    """Get the local IP address by connecting to an external address."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return None


def get_all_local_ips() -> list[str]:
    """Get all local IP addresses from all network interfaces."""
    ips: list[str] = []
    try:
        hostname = socket.gethostname()
        addresses = socket.getaddrinfo(hostname, None)
        for addr_info in addresses:
            ip = addr_info[4][0]
            if ip not in ips and not ip.startswith("127."):
                ips.append(ip)
    except Exception:
        pass

    fallback_ip = get_local_ip()
    if fallback_ip and fallback_ip not in ips:
        ips.append(fallback_ip)

    return ips


def validate_port(port: int) -> bool:
    """Validate port is in valid range."""
    return 1024 <= port <= 65535


def validate_ip(ip: str) -> bool:
    """Validate IP address format."""
    try:
        socket.inet_aton(ip)
        return True
    except OSError:
        return False
