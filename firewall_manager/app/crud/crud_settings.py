from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.settings import Settings
from app.schemas.settings import SettingsCreate, SettingsUpdate


async def get_setting(db: AsyncSession, key: str):
    result = await db.execute(select(Settings).filter(Settings.key == key))
    return result.scalars().first()


async def get_all_settings(db: AsyncSession):
    result = await db.execute(select(Settings))
    return result.scalars().all()


async def create_setting(db: AsyncSession, setting: SettingsCreate):
    db_setting = Settings(**setting.model_dump())
    db.add(db_setting)
    await db.commit()
    await db.refresh(db_setting)
    return db_setting


async def update_setting(db: AsyncSession, db_obj: Settings, obj_in: SettingsUpdate):
    obj_data = obj_in.model_dump(exclude_unset=True)
    for field in obj_data:
        setattr(db_obj, field, obj_data[field])
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj

