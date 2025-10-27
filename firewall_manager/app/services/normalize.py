from ipaddress import ip_network, ip_address, IPv4Address
from typing import Optional, Tuple


def parse_ipv4_numeric(value: str) -> Tuple[Optional[int], Optional[int], Optional[int]]:
    """Return (version, start, end) for IPv4; FQDN/IPv6/invalid -> (None, None, None)."""
    if not value:
        return (None, None, None)
    v = value.strip()
    if v.lower() == 'any':
        return (4, 0, (2**32) - 1)
    if any(c.isalpha() for c in v):  # fqdn
        return (None, None, None)
    try:
        if '-' in v:
            a, b = v.split('-', 1)
            ia, ib = ip_address(a.strip()), ip_address(b.strip())
            if isinstance(ia, IPv4Address) and isinstance(ib, IPv4Address):
                return (4, int(ia), int(ib))
            return (None, None, None)
        if '/' in v:
            net = ip_network(v, strict=False)
            if isinstance(net.network_address, IPv4Address):
                return (4, int(net.network_address), int(net.broadcast_address))
            return (None, None, None)
        ip = ip_address(v)
        if isinstance(ip, IPv4Address):
            n = int(ip)
            return (4, n, n)
    except Exception:
        return (None, None, None)
    return (None, None, None)


def parse_port_numeric(value: str) -> Tuple[Optional[int], Optional[int]]:
    if not value:
        return (None, None)
    v = value.strip()
    if v in {'*', 'any', 'ANY'}:
        return (0, 65535)
    if ',' in v:
        return (None, None)
    try:
        if '-' in v:
            a, b = v.split('-', 1)
            return (int(a), int(b))
        p = int(v)
        return (p, p)
    except Exception:
        return (None, None)
