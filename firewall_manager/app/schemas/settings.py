from pydantic import BaseModel


class SettingsBase(BaseModel):
    key: str
    value: str
    description: str | None = None


class SettingsCreate(SettingsBase):
    pass


class SettingsUpdate(BaseModel):
    value: str
    description: str | None = None


class Settings(SettingsBase):
    class Config:
        from_attributes = True

