
import logging
from typing import List, Dict, Any, Set
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Policy, AnalysisTask,
    NetworkObject, NetworkGroup,
    Service, ServiceGroup
)

logger = logging.getLogger(__name__)


class UnreferencedObjectsAnalyzer:
    """
    어떠한 보안 정책에서도 참조되지 않는 고립된(Unreferenced) 객체를 탐지하는 분석 클래스입니다.
    
    네트워크 객체, 네트워크 그룹, 서비스 객체, 서비스 그룹 중 정책의 출발지(Source), 
    목적지(Destination), 서비스(Service) 항목에서 한 번도 호출되지 않은 객체들을 식별하여 
    방화벽 설정 최적화를 돕습니다.
    """

    def __init__(self, db_session: AsyncSession, task: AnalysisTask):
        """
        UnreferencedObjectsAnalyzer 초기화

        :param db_session: 데이터베이스 비동기 세션
        :param task: 분석 작업 객체
        """
        self.db = db_session
        self.task = task
        self.device_id = task.device_id

    async def _get_all_objects(self) -> Dict[str, Set[str]]:
        """
        해당 장비에 등록된 모든 객체와 그룹의 이름을 조회합니다.
        분석의 대조군이 되는 전체 목록을 생성합니다.
        """
        # 활성화된 모든 네트워크 객체 조회
        net_objects_stmt = select(NetworkObject).where(
            NetworkObject.device_id == self.device_id,
            NetworkObject.is_active == True
        )
        net_objects_result = await self.db.execute(net_objects_stmt)
        net_objects = net_objects_result.scalars().all()
        
        # 모든 네트워크 그룹 조회
        net_groups_stmt = select(NetworkGroup).where(
            NetworkGroup.device_id == self.device_id
        )
        net_groups_result = await self.db.execute(net_groups_stmt)
        net_groups = net_groups_result.scalars().all()
        
        # 활성화된 모든 서비스 객체 조회
        services_stmt = select(Service).where(
            Service.device_id == self.device_id,
            Service.is_active == True
        )
        services_result = await self.db.execute(services_stmt)
        services = services_result.scalars().all()
        
        # 모든 서비스 그룹 조회
        service_groups_stmt = select(ServiceGroup).where(
            ServiceGroup.device_id == self.device_id
        )
        service_groups_result = await self.db.execute(service_groups_stmt)
        service_groups = service_groups_result.scalars().all()
        
        all_objects = {
            "network_objects": {obj.name for obj in net_objects},
            "network_groups": {group.name for group in net_groups},
            "services": {svc.name for svc in services},
            "service_groups": {group.name for group in service_groups}
        }
        
        logger.info(f"총 객체 수 - 네트워크: {len(all_objects['network_objects'])}, 네트워크 그룹: {len(all_objects['network_groups'])}, "
                   f"서비스: {len(all_objects['services'])}, 서비스 그룹: {len(all_objects['service_groups'])}")
        
        return all_objects

    async def _get_referenced_objects(self) -> Dict[str, Set[str]]:
        """
        현재 사용 중인(Enable=True) 모든 정책을 순회하며, 각 정책에서 참조하고 있는
        객체들의 이름을 추출합니다. (역참조/Reverse Lookup 분석)
        
        정책의 Source, Destination, Service 필드에 명시된 토큰들을 파싱하여 
        실제 존재하는 객체와 매칭되는 것들만 수집합니다.
        """
        stmt = select(Policy).where(
            Policy.device_id == self.device_id,
            Policy.enable == True
        )
        result = await self.db.execute(stmt)
        policies = result.scalars().all()
        
        referenced = {
            "network_objects": set(),
            "network_groups": set(),
            "services": set(),
            "service_groups": set()
        }
        
        # 대조를 위한 전체 객체 이름 셋 구성
        all_objects = await self._get_all_objects()
        all_network_names = all_objects["network_objects"] | all_objects["network_groups"]
        all_service_names = all_objects["services"] | all_objects["service_groups"]
        
        # 각 정책별 참조 객체 추출 로직
        for policy in policies:
            # 1. 출발지(Source) 네트워크 객체 추출
            if policy.source:
                source_tokens = [token.strip() for token in policy.source.split(',')]
                for token in source_tokens:
                    if token in all_network_names:
                        if token in all_objects["network_objects"]:
                            referenced["network_objects"].add(token)
                        elif token in all_objects["network_groups"]:
                            referenced["network_groups"].add(token)
            
            # 2. 목적지(Destination) 네트워크 객체 추출
            if policy.destination:
                dest_tokens = [token.strip() for token in policy.destination.split(',')]
                for token in dest_tokens:
                    if token in all_network_names:
                        if token in all_objects["network_objects"]:
                            referenced["network_objects"].add(token)
                        elif token in all_objects["network_groups"]:
                            referenced["network_groups"].add(token)
            
            # 3. 서비스(Service) 객체 추출
            if policy.service:
                service_tokens = [token.strip() for token in policy.service.split(',')]
                for token in service_tokens:
                    if token in all_service_names:
                        if token in all_objects["services"]:
                            referenced["services"].add(token)
                        elif token in all_objects["service_groups"]:
                            referenced["service_groups"].add(token)
        
        logger.info(f"참조된 객체 수 - 네트워크: {len(referenced['network_objects'])}, 네트워크 그룹: {len(referenced['network_groups'])}, "
                   f"서비스: {len(referenced['services'])}, 서비스 그룹: {len(referenced['service_groups'])}")
        
        return referenced

    async def analyze(self) -> List[Dict[str, Any]]:
        """
        미참조 객체 분석을 실행합니다.
        
        전체 객체 목록에서 참조된 객체 목록을 차집합 연산하여 
        한 번도 사용되지 않은 객체들만 결과 리스트로 구성합니다.
        """
        logger.info(f"Task ID {self.task.id}에 대한 미참조 객체 분석 시작.")

        all_objects = await self._get_all_objects()
        referenced_objects = await self._get_referenced_objects()
        
        results = []
        
        # [네트워크 객체] 미참조 식별
        for obj_name in all_objects["network_objects"]:
            if obj_name not in referenced_objects["network_objects"]:
                results.append({
                    "object_name": obj_name,
                    "object_type": "network_object",
                    "referenced": False
                })
        
        # [네트워크 그룹] 미참조 식별
        for group_name in all_objects["network_groups"]:
            if group_name not in referenced_objects["network_groups"]:
                results.append({
                    "object_name": group_name,
                    "object_type": "network_group",
                    "referenced": False
                })
        
        # [서비스 객체] 미참조 식별
        for svc_name in all_objects["services"]:
            if svc_name not in referenced_objects["services"]:
                results.append({
                    "object_name": svc_name,
                    "object_type": "service",
                    "referenced": False
                })
        
        # [서비스 그룹] 미참조 식별
        for group_name in all_objects["service_groups"]:
            if group_name not in referenced_objects["service_groups"]:
                results.append({
                    "object_name": group_name,
                    "object_type": "service_group",
                    "referenced": False
                })
        
        logger.info(f"{len(results)}개의 미참조 객체가 발견되었습니다.")
        return results







