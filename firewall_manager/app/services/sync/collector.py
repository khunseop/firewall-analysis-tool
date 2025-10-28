from app.core.security import decrypt
from app.services.firewall.factory import FirewallCollectorFactory
from app.services.firewall.interface import FirewallInterface
from app import models


def create_collector_from_device(device: models.Device) -> FirewallInterface:
    """Create a vendor collector from a Device row with safe decryption.

    - Allows password passthrough when vendor is 'mock' and decryption fails.
    """
    vendor_lower = (device.vendor or "").lower()
    try:
        decrypted_password = decrypt(device.password)
    except Exception:
        if vendor_lower == "mock":
            decrypted_password = device.password
        else:
            raise
    return FirewallCollectorFactory.get_collector(
        source_type=vendor_lower,
        hostname=device.ip_address,
        username=device.username,
        password=decrypted_password,
    )


def build_collector(vendor: str, hostname: str, username: str, encrypted_password: str) -> FirewallInterface:
    """Create a vendor collector from primitive fields (pre-fetched from ORM).

    - Allows password passthrough when vendor is 'mock' and decryption fails.
    """
    vendor_lower = (vendor or "").lower()
    try:
        decrypted_password = decrypt(encrypted_password)
    except Exception:
        if vendor_lower == "mock":
            decrypted_password = encrypted_password
        else:
            raise
    return FirewallCollectorFactory.get_collector(
        source_type=vendor_lower,
        hostname=hostname,
        username=username,
        password=decrypted_password,
    )
