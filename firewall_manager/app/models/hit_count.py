from sqlalchemy import Column, Integer, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from ..database import Base
import datetime

class HitCount(Base):
    __tablename__ = "hit_counts"

    id = Column(Integer, primary_key=True, index=True)
    policy_id = Column(Integer, ForeignKey("policies.id"), nullable=False, unique=True)
    hit_count = Column(Integer, default=0, nullable=False)
    last_hit_at = Column(DateTime, default=datetime.datetime.utcnow)

    policy = relationship("Policy")