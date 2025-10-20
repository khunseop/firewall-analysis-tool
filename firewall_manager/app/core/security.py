from cryptography.fernet import Fernet
from app.core.config import settings

# Initialize Fernet with the key from settings
fernet = Fernet(settings.ENCRYPTION_KEY.encode())

def encrypt(data: str) -> str:
    """Encrypts a string."""
    if not data:
        return data
    encrypted_data = fernet.encrypt(data.encode())
    return encrypted_data.decode()

def decrypt(encrypted_data: str) -> str:
    """Decrypts a string."""
    if not encrypted_data:
        return encrypted_data
    decrypted_data = fernet.decrypt(encrypted_data.encode())
    return decrypted_data.decode()
