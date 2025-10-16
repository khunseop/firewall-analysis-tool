from pydantic import BaseModel

# 기본 스키마 (공통 필드)
class FirewallDeviceBase(BaseModel):
    name: str
    hostname: str
    vendor: str
    username: str

# 장비 생성을 위한 스키마 (비밀번호 포함)
class FirewallDeviceCreate(FirewallDeviceBase):
    password: str

# 장비 정보 수정을 위한 스키마 (모든 필드는 선택 사항)
class FirewallDeviceUpdate(BaseModel):
    name: str | None = None
    hostname: str | None = None
    vendor: str | None = None
    username: str | None = None
    password: str | None = None

# API 응답에 사용될 스키마 (비밀번호 제외)
class FirewallDevice(FirewallDeviceBase):
    id: int

    class Config:
        from_attributes = True