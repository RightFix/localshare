"""Network utilities for LocalShare."""

import logging
import socket
import struct

logger = logging.getLogger(__name__)


def get_local_ip() -> str | None:
    """Get the local IP address by connecting to an external address."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return None


def _is_lan_usable(ip: str) -> bool:
    """Return True for a LAN-reachable IPv4 address.

    Excludes IPv6 (not usable as a plain http://<ip>:<port> target),
    IPv4 loopback (127.*), and link-local (169.254.*) addresses.
    """
    return ":" not in ip and not ip.startswith("127.") and not ip.startswith("169.254.")


def _interface_ipv4_addresses() -> list[str]:
    """Enumerate IPv4 addresses of all interfaces via ioctl (Linux).

    Enumerates interfaces directly instead of resolving the hostname, which on
    Debian/Ubuntu often maps to 127.0.1.1 and can miss the real LAN IP.
    Interfaces without an address (e.g. no carrier) are skipped. Returns []
    on platforms without the fcntl/ioctl approach.
    """
    ips: list[str] = []
    try:
        import fcntl
    except ImportError:
        return ips

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    except OSError:
        return ips

    try:
        for _, if_name in socket.if_nameindex():
            try:
                result = fcntl.ioctl(
                    sock.fileno(),
                    0x8915,  # SIOCGIFADDR
                    struct.pack("256s", if_name.encode()[:15]),
                )
                ip = socket.inet_ntoa(result[20:24])
            except OSError:
                continue
            if ip not in ips:
                ips.append(ip)
    except (OSError, ValueError):
        pass
    finally:
        sock.close()

    return ips


def _hostname_ipv4_addresses() -> list[str]:
    """Fallback: collect the addresses the hostname resolves to."""
    ips: list[str] = []
    try:
        for addr_info in socket.getaddrinfo(socket.gethostname(), None):
            ip = str(addr_info[4][0])
            if ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    return ips


def get_all_local_ips() -> list[str]:
    """Get all reachable local IPv4 addresses.

    Enumerates network interfaces directly so the real LAN IP is not missed
    when the hostname resolves to 127.0.1.1. The default-route address
    (via get_local_ip) is listed first because callers (e.g. the extension)
    use ips[0] as the primary address. Loopback, link-local, and IPv6
    addresses are excluded since they are not reachable from other devices.
    """
    ips = _interface_ipv4_addresses() or _hostname_ipv4_addresses()
    usable = [ip for ip in ips if _is_lan_usable(ip)]

    default_ip = get_local_ip()
    if default_ip and _is_lan_usable(default_ip):
        if default_ip in usable:
            usable.remove(default_ip)
        usable.insert(0, default_ip)

    return usable


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
