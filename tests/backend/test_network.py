"""Tests for network utilities."""


from backend.services.network import get_all_local_ips, get_local_ip, validate_ip, validate_port


class TestGetLocalIP:
    def test_returns_string(self):
        ip = get_local_ip()
        assert ip is None or isinstance(ip, str)


class TestGetAllLocalIPs:
    def test_returns_list(self):
        ips = get_all_local_ips()
        assert isinstance(ips, list)

    def test_no_loopback(self):
        ips = get_all_local_ips()
        for ip in ips:
            assert not ip.startswith("127.")


class TestValidatePort:
    def test_valid_port(self):
        assert validate_port(8080) is True
        assert validate_port(1024) is True
        assert validate_port(65535) is True

    def test_invalid_port(self):
        assert validate_port(80) is False
        assert validate_port(70000) is False
        assert validate_port(0) is False
        assert validate_port(-1) is False


class TestValidateIP:
    def test_valid_ips(self):
        assert validate_ip("192.168.1.1") is True
        assert validate_ip("10.0.0.1") is True
        assert validate_ip("127.0.0.1") is True

    def test_invalid_ips(self):
        assert validate_ip("not.an.ip") is False
        assert validate_ip("256.256.256.256") is False
        assert validate_ip("") is False
