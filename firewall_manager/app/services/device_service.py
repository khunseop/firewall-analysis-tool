from app.models.device import Device
from app.core.security import decrypt
from app.services.firewall.factory import FirewallCollectorFactory
import asyncio

async def test_device_connection(device: Device) -> dict:
    """
    Tests the connection to a device by creating a collector and attempting to connect.
    """
    try:
        decrypted_password = decrypt(device.password)
    except Exception:
        return {"status": "failure", "message": "Password decryption failed."}

    try:
        collector = FirewallCollectorFactory.get_collector(
            source_type=device.vendor.lower(),
            hostname=device.ip_address,
            username=device.username,
            password=decrypted_password,
        )

        loop = asyncio.get_running_loop()
        if await loop.run_in_executor(None, collector.connect):
            await loop.run_in_executor(None, collector.disconnect)
            return {"status": "success", "message": "Connection successful."}
        else:
            return {"status": "failure", "message": "Failed to connect to the device."}
    except Exception as e:
        return {"status": "failure", "message": f"An error occurred: {str(e)}"}
