from app.services.normalize import parse_ipv4_numeric, parse_port_numeric


def test_parse_ipv4_numeric_any_returns_full_range():
    assert parse_ipv4_numeric("any") == (4, 0, (2 ** 32) - 1)
    assert parse_ipv4_numeric("ANY") == (4, 0, (2 ** 32) - 1)


def test_parse_ipv4_numeric_single_ip():
    version, start, end = parse_ipv4_numeric("10.0.0.1")
    assert version == 4
    assert start == end


def test_parse_ipv4_numeric_cidr():
    version, start, end = parse_ipv4_numeric("10.0.0.0/24")
    assert version == 4
    assert end - start == 255


def test_parse_ipv4_numeric_dash_range():
    version, start, end = parse_ipv4_numeric("10.0.0.1-10.0.0.5")
    assert version == 4
    assert end - start == 4


def test_parse_ipv4_numeric_fqdn_returns_none():
    assert parse_ipv4_numeric("firewall.example.com") == (None, None, None)


def test_parse_ipv4_numeric_ipv6_returns_none():
    assert parse_ipv4_numeric("::1") == (None, None, None)


def test_parse_ipv4_numeric_empty_returns_none():
    assert parse_ipv4_numeric("") == (None, None, None)


def test_parse_ipv4_numeric_garbage_returns_none():
    assert parse_ipv4_numeric("not-an-ip!!") == (None, None, None)


def test_parse_port_numeric_any_variants():
    assert parse_port_numeric("any") == (0, 65535)
    assert parse_port_numeric("*") == (0, 65535)
    assert parse_port_numeric("ANY") == (0, 65535)


def test_parse_port_numeric_single_port():
    assert parse_port_numeric("443") == (443, 443)


def test_parse_port_numeric_range():
    assert parse_port_numeric("8000-9000") == (8000, 9000)


def test_parse_port_numeric_comma_separated_returns_none():
    assert parse_port_numeric("80,443") == (None, None)


def test_parse_port_numeric_empty_returns_none():
    assert parse_port_numeric("") == (None, None)


def test_parse_port_numeric_garbage_returns_none():
    assert parse_port_numeric("abc") == (None, None)
