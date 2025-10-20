from app.models.device import Device
from app.core.security import decrypt

async def test_device_connection(device: Device) -> dict:
    """
    Tests the connection to a device by decrypting its password.
    In a real application, this would involve making an API call to the device.
    """
    try:
        decrypted_password = decrypt(device.password)
        # Simulate an API call with the decrypted password
        print(f"Simulating connection to {device.ip_address} with password: {decrypted_password}")

        # A simple check to simulate success/failure
        if decrypted_password and len(decrypted_password) > 0:
            return {"status": "success", "message": "Connection successful."}
        else:
            return {"status": "failure", "message": "Invalid password after decryption."}

    except Exception as e:
        return {"status": "failure", "message": f"An error occurred: {str(e)}"}
