import asyncio
import logging
import json
from datetime import datetime
from typing import Any, List, Iterable, Dict, Tuple
from zoneinfo import ZoneInfo

import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete, update
from sqlalchemy.future import select

from app import crud, models, schemas
from app.db.session import SessionLocal
from app.models.policy_members import PolicyAddressMember, PolicyServiceMember
from app.services.sync.transform import (
    dataframe_to_pydantic,
    get_key_attribute,
    get_singular_name,
    normalize_value,
)
from app.services.sync.collector import create_collector_from_device
from app.services.policy_indexer import rebuild_policy_indices

# 동적 세마포어를 위한 전역 변수
_device_sync_semaphore: asyncio.Semaphore | None = None


async def get_sync_semaphore() -> asyncio.Semaphore:
    """
    데이터베이스 설정값(sync_parallel_limit)을 읽어 동기화 병렬 처리를 위한 세마포어를 생성하거나 반환합니다.
    
    이 세마포어는 여러 장비의 동기화가 동시에 실행되어 시스템 자원(CPU, Memory, DB Connection)이 
    고갈되는 것을 방지하는 역할을 합니다.
    
    Returns:
        asyncio.Semaphore: 설정된 limit 값을 가진 세마포어 객체
    """
    global _device_sync_semaphore
    
    # 이미 생성된 세마포어가 있으면 재사용 (싱글톤 패턴과 유사)
    if _device_sync_semaphore is not None:
        return _device_sync_semaphore
    
    # DB에서 설정값 읽기 (설정이 없으면 기본값 4 사용)
    async with SessionLocal() as db:
        setting = await crud.settings.get_setting(db, key="sync_parallel_limit")
        if setting:
            limit = int(setting.value)
        else:
            # 기본 병렬 처리 제한값
            limit = 4
    
    # 세마포어 초기화: 지정된 limit 개수만큼의 비동기 작업만 동시 실행 허용
    _device_sync_semaphore = asyncio.Semaphore(limit)
    logging.info(f"[sync] 동기화 병렬 처리 개수 설정: {limit}")
    return _device_sync_semaphore


async def reset_sync_semaphore():
    """
    전역 세마포어 객체를 초기화합니다. 
    
    설정값이 변경된 경우 이 함수를 호출하여 다음 동기화 작업 시 
    DB에서 새로운 설정값을 읽어 세마포어를 재생성하도록 합니다.
    """
    global _device_sync_semaphore
    _device_sync_semaphore = None


async def sync_data_task(
    device_id: int,
    data_type: str,
    items_to_sync: List[Any],
) -> None:
    """
    특정 장비의 데이터(정책, 객체 등)를 데이터베이스와 대량(Bulk) 동기화합니다.
    
    기존 데이터와 새로 수집된 데이터를 비교하여:
    1. 신규 데이터: 생성(Insert)
    2. 변경 데이터: 수정(Update)
    3. 사라진 데이터: 삭제(Delete)
    
    모든 데이터 변경 내역은 ChangeLog 테이블에 기록됩니다.
    데이터 무결성을 위해 전체 프로세스는 단일 데이터베이스 트랜잭션 블록 내에서 실행됩니다.
    
    Args:
        device_id (int): 대상 방화벽 장비 ID
        data_type (str): 동기화할 데이터 유형 (policies, network_objects 등)
        items_to_sync (List[Any]): 수집되어 Pydantic 모델로 변환된 데이터 리스트
    """
    logging.info(f"Starting sync for device_id: {device_id}, data_type: {data_type}")

    # 데이터 유형별 모델 매핑
    model_map = {
        "policies": models.Policy,
        "network_objects": models.NetworkObject,
        "network_groups": models.NetworkGroup,
        "services": models.Service,
        "service_groups": models.ServiceGroup,
    }
    model = model_map[data_type]
    key_attribute = get_key_attribute(data_type)

    def _make_key(obj: Any) -> Tuple:
        """
        데이터 비교를 위한 고유 키를 생성합니다.
        정책(policies)은 (vsys, rule_name) 조합을 사용하며, 다른 객체는 name 속성을 사용합니다.
        """
        if data_type == "policies":
            vsys = str(getattr(obj, "vsys", "") or "").strip().lower()
            return (vsys if vsys else None, getattr(obj, "rule_name"))
        return (getattr(obj, key_attribute),)

    # 새로 수집된 데이터를 키 기반 Map으로 변환
    items_to_sync_map = {_make_key(item): item for item in items_to_sync}

    async with SessionLocal() as db:
        try:
            # 1단계: 기존 DB 데이터를 한 번에 가져와서 Map으로 구성 (메모리 상에서 비교 준비)
            existing_items_query = await db.execute(select(model).where(model.device_id == device_id))
            existing_items = existing_items_query.scalars().all()
            existing_items_map = {_make_key(item): item for item in existing_items}

            # 변경 사항 저장을 위한 리스트 초기화
            items_to_create, items_to_update, ids_to_delete = [], [], []
            change_logs_to_create = []

            # 2단계: 신규/수정 데이터 분류
            for key, new_item in items_to_sync_map.items():
                existing_item = existing_items_map.get(key)
                if not existing_item:
                    # --- 신규 데이터 생성 ---
                    items_to_create.append(new_item.model_dump())
                    change_logs_to_create.append(schemas.ChangeLogCreate(
                        device_id=device_id, data_type=data_type, object_name=key[-1], action="created",
                        details=json.dumps(new_item.model_dump(), default=str)
                    ))
                else:
                    # --- 기존 데이터 업데이트 확인 ---
                    update_data = new_item.model_dump(exclude_unset=True)

                    # 2-1. 정책 데이터의 경우 '마지막 히트 일시(last_hit_date)' 변경 별도 체크
                    is_hit_date_changed = False
                    if data_type == "policies":
                        old_hit_date = getattr(existing_item, 'last_hit_date', None)
                        # exclude_unset=True로 누락될 수 있으므로 직접 접근
                        new_hit_date = getattr(new_item, 'last_hit_date', None)
                        
                        def _to_datetime(val):
                            """다양한 형식의 날짜 값을 Python naive datetime 객체로 변환합니다."""
                            if val is None:
                                return None
                            # 이미 datetime 객체인 경우
                            if isinstance(val, datetime):
                                if val.tzinfo is not None:
                                    return val.replace(tzinfo=None)
                                return val
                            # pandas Timestamp인 경우
                            if hasattr(val, 'to_pydatetime'):
                                try:
                                    dt = val.to_pydatetime()
                                    if dt.tzinfo is not None:
                                        return dt.replace(tzinfo=None)
                                    return dt
                                except:
                                    pass
                            # 문자열인 경우 파싱 시도
                            if isinstance(val, str):
                                try:
                                    dt = datetime.strptime(val, "%Y-%m-%d %H:%M:%S")
                                    return dt
                                except (ValueError, TypeError):
                                    try:
                                        dt = pd.to_datetime(val).to_pydatetime()
                                        if dt.tzinfo is not None:
                                            return dt.replace(tzinfo=None)
                                        return dt
                                    except:
                                        return None
                            return None

                        old_dt = _to_datetime(old_hit_date)
                        new_dt = _to_datetime(new_hit_date)

                        # 최신 수집된 값이 있으면 업데이트, 없으면 None으로 초기화 (Palo Alto 전용)
                        if new_dt is not None:
                            update_data['last_hit_date'] = new_dt
                            is_hit_date_changed = (old_dt != new_dt)
                        else:
                            update_data['last_hit_date'] = None
                            is_hit_date_changed = (old_dt is not None)

                    # 2-2. 실제 주요 필드들의 변경 여부(is_dirty) 확인
                    fields_to_compare = set(update_data.keys())
                    if data_type == "policies":
                        fields_to_compare -= {'seq', 'last_hit_date'} # 순서와 히트 정보는 주요 변경에서 제외

                    is_dirty = any(
                        normalize_value(update_data.get(k)) != normalize_value(getattr(existing_item, k))
                        for k in fields_to_compare
                    )

                    # 2-3. 최종 업데이트 대상 결정
                    # 주요 필드가 바뀌었거나, 정책의 경우 히트 일시가 바뀌었을 때 업데이트 실행
                    needs_update = is_dirty or (data_type == "policies" and 'last_hit_date' in update_data)

                    if needs_update:
                        update_data["id"] = existing_item.id
                        if data_type == "policies" and is_dirty:
                            # 주요 정보(Source, Dest 등)가 바뀌면 분석을 위해 인덱싱 필요 표시
                            update_data["is_indexed"] = False
                            
                        items_to_update.append(update_data)

                        # 로깅 로직: 실제 변경이 있을 때만 로그 생성
                        if is_dirty:
                            change_logs_to_create.append(schemas.ChangeLogCreate(
                                device_id=device_id, data_type=data_type, object_name=key[-1], action="updated",
                                details=json.dumps({"before": {k: getattr(existing_item, k) for k in update_data if k != 'id'}, "after": update_data}, default=str)
                            ))
                        elif is_hit_date_changed: # 히트 일시만 바뀐 경우 전용 로그
                            change_logs_to_create.append(schemas.ChangeLogCreate(
                                device_id=device_id, data_type=data_type, object_name=key[-1], action="hit_date_updated",
                                details=json.dumps({"before": {"last_hit_date": old_hit_date}, "after": {"last_hit_date": new_hit_date}}, default=str)
                            ))

            # 3단계: 삭제 대상 분류 (수집 목록에 없는 기존 데이터)
            for key, existing_item in existing_items_map.items():
                if key not in items_to_sync_map:
                    ids_to_delete.append(existing_item.id)
                    change_logs_to_create.append(schemas.ChangeLogCreate(
                        device_id=device_id, data_type=data_type, object_name=key[-1], action="deleted"
                    ))

            # 4단계: 실제 DB 반영 (단일 트랜잭션 블록)
            # 4-1. 삭제 처리 (정책 삭제 시 연관된 멤버 정보부터 삭제)
            if ids_to_delete:
                if data_type == "policies":
                    await db.execute(delete(PolicyAddressMember).where(PolicyAddressMember.policy_id.in_(ids_to_delete)))
                    await db.execute(delete(PolicyServiceMember).where(PolicyServiceMember.policy_id.in_(ids_to_delete)))
                await db.execute(delete(model).where(model.id.in_(ids_to_delete)))

            # 4-2. 대량 생성 (Bulk Insert)
            if items_to_create:
                await db.run_sync(lambda sync_session: sync_session.bulk_insert_mappings(model, items_to_create))

            # 4-3. 대량 수정 (Bulk Update)
            if items_to_update:
                await db.run_sync(lambda sync_session: sync_session.bulk_update_mappings(model, items_to_update))

            # 4-4. 변경 로그 일괄 생성
            if change_logs_to_create:
                await crud.change_log.create_change_logs(db, change_logs=change_logs_to_create)

            # 5단계: 최종 커밋 - 모든 작업이 성공해야만 DB에 반영됨
            await db.commit()

            logging.info(f"Sync for {data_type} completed. "
                         f"Created: {len(items_to_create)}, Updated: {len(items_to_update)}, Deleted: {len(ids_to_delete)}")

        except Exception as e:
            # 오류 발생 시 모든 변경 사항 롤백
            await db.rollback()
            logging.error(f"Failed to sync {data_type} for device_id {device_id}: {e}", exc_info=True)
            raise


async def _collect_last_hit_date_parallel(
    collector,
    device: models.Device,
    vsys_list: List[str] | None,
    loop: asyncio.AbstractEventLoop
) -> pd.DataFrame | None:
    """
    메인 장비와 HA Peer 장비로부터 정책 히트 정보(last_hit_date)를 병렬로 수집하여 통합합니다.
    
    HA 환경에서는 트래픽이 양쪽 장비로 분산될 수 있으므로, 양쪽의 데이터를 모두 수집한 뒤 
    각 정책별로 더 최신의 히트 시간을 선택하여 병합합니다.
    
    Args:
        collector: 메인 장비용 Collector 객체
        device: 데이터베이스에 저장된 장비 정보 모델
        vsys_list: 수집 대상 가상 시스템(VSYS) 리스트
        loop: 비동기 실행을 위한 이벤트 루프
        
    Returns:
        pd.DataFrame | None: 정책별 최신 히트 정보가 포함된 DataFrame 또는 수집 실패 시 None
    """
    async def _collect_main_device() -> pd.DataFrame | None:
        """메인 장비로부터 히트 정보 수집"""
        try:
            if device.use_ssh_for_last_hit_date:
                logging.info("[orchestrator] Collecting main device last_hit_date via SSH.")
                return await loop.run_in_executor(
                    None, 
                    lambda: collector.export_last_hit_date_ssh(vsys=vsys_list)
                )
            else:
                logging.info("[orchestrator] Collecting main device last_hit_date via API.")
                return await loop.run_in_executor(
                    None,
                    lambda: collector.export_last_hit_date(vsys=vsys_list)
                )
        except Exception as e:
            logging.warning(f"[orchestrator] Failed to collect last_hit_date from main device: {e}")
            return None
    
    async def _collect_ha_peer() -> pd.DataFrame | None:
        """HA Peer 장비로부터 히트 정보 수집 (설정된 경우에만 실행)"""
        if not device.ha_peer_ip:
            return None
            
        ha_collector = None
        try:
            logging.info(f"[orchestrator] Collecting HA peer ({device.ha_peer_ip}) last_hit_date.")
            # HA Peer용 임시 Collector 생성
            ha_collector = create_collector_from_device(device, use_ha_ip=True)
            
            # 연결 수립 (동기 함수이므로 run_in_executor 사용)
            await loop.run_in_executor(None, ha_collector.connect)
            
            # 히트 정보 수집
            if device.use_ssh_for_last_hit_date:
                hit_date_df = await loop.run_in_executor(
                    None,
                    lambda: ha_collector.export_last_hit_date_ssh(vsys=vsys_list)
                )
            else:
                hit_date_df = await loop.run_in_executor(
                    None,
                    lambda: ha_collector.export_last_hit_date(vsys=vsys_list)
                )
            
            return hit_date_df
        except Exception as e:
            logging.warning(f"[orchestrator] Failed to collect last_hit_date from HA peer {device.ha_peer_ip}: {e}")
            return None
        finally:
            # HA Peer 연결 종료
            if ha_collector:
                try:
                    await loop.run_in_executor(None, ha_collector.disconnect)
                except Exception:
                    pass
    
    # 1. 병렬 처리: asyncio.gather를 사용하여 메인과 HA Peer 정보를 동시에 수집 (속도 최적화)
    main_result, ha_result = await asyncio.gather(
        _collect_main_device(),
        _collect_ha_peer(),
        return_exceptions=False
    )
    
    # 2. 결과 병합 로직: (vsys, rule_name) 조합을 기준으로 최신 날짜 선택
    
    # 케이스 A: 양쪽 모두 데이터가 없는 경우
    if (main_result is None or main_result.empty) and (ha_result is None or ha_result.empty):
        logging.info("[orchestrator] No last_hit_date records collected from either device.")
        return None

    # 케이스 B: 메인 장비 데이터만 없는 경우 (HA Peer 데이터 사용)
    if main_result is None or main_result.empty:
        hit_date_df = ha_result.copy()
        hit_date_df['last_hit_date'] = pd.to_datetime(hit_date_df['last_hit_date'], errors='coerce')
        # 중복 제거 (최신 날짜 우선)
        hit_date_df = hit_date_df.sort_values('last_hit_date', ascending=False, na_position='last')
        subset = ['vsys', 'rule_name'] if 'vsys' in hit_date_df.columns else ['rule_name']
        hit_date_df = hit_date_df.drop_duplicates(subset=subset, keep='first')
        return hit_date_df[hit_date_df['last_hit_date'].notna()]

    # 케이스 C: HA Peer 데이터만 없는 경우 (메인 장비 데이터 사용)
    if ha_result is None or ha_result.empty:
        hit_date_df = main_result.copy()
        hit_date_df['last_hit_date'] = pd.to_datetime(hit_date_df['last_hit_date'], errors='coerce')
        # 중복 제거 (최신 날짜 우선)
        hit_date_df = hit_date_df.sort_values('last_hit_date', ascending=False, na_position='last')
        subset = ['vsys', 'rule_name'] if 'vsys' in hit_date_df.columns else ['rule_name']
        hit_date_df = hit_date_df.drop_duplicates(subset=subset, keep='first')
        return hit_date_df[hit_date_df['last_hit_date'].notna()]
    
    # 케이스 D: 둘 다 있는 경우 - 데이터 병합 및 최신 시간 추출
    main_df = main_result.copy()
    main_df['last_hit_date'] = pd.to_datetime(main_df['last_hit_date'], errors='coerce')
    
    ha_df = ha_result.copy()
    ha_df['last_hit_date'] = pd.to_datetime(ha_df['last_hit_date'], errors='coerce')
    
    # 두 장비의 데이터를 하나로 합침
    combined_df = pd.concat([main_df, ha_df], ignore_index=True)
    
    # 정렬: 최신 날짜 순, 빈 값은 뒤로
    combined_df_sorted = combined_df.sort_values('last_hit_date', ascending=False, na_position='last')
    
    # 중복 제거: 같은 정책(vsys + rule_name)에 대해 가장 먼저 나오는(즉, 가장 최신인) 레코드만 유지
    subset = ['vsys', 'rule_name'] if 'vsys' in combined_df.columns else ['rule_name']
    hit_date_df = combined_df_sorted.drop_duplicates(subset=subset, keep='first')
    
    # 유효한 날짜 정보가 있는 것만 반환
    return hit_date_df[hit_date_df['last_hit_date'].notna()].copy()


async def run_sync_all_orchestrator(device_id: int) -> None:
    """
    특정 장비에 대한 전체 동기화 프로세스를 관리하는 오케스트레이터입니다.
    
    프로세스 순서:
    1. 병렬 처리 제한을 위한 세마포어 획득
    2. 장비 연결 및 상태 업데이트 (Connecting...)
    3. 데이터 수집 시퀀스 실행 (객체 -> 서비스 -> 정책)
    4. (Palo Alto 한정) 정책 히트 정보 수집 및 병합
    5. 데이터베이스 동기화 (sync_data_task 호출)
    6. 정책 전문 검색 인덱스 재구성 (Indexing...)
    7. 최종 상태 업데이트 (Success/Failure)
    
    Args:
        device_id (int): 동기화할 장비의 ID
    """
    # 1. 동기화 병렬 처리 제한 (Semaphore 적용)
    semaphore = await get_sync_semaphore()
    async with semaphore:
        logging.info(f"[orchestrator] Starting sync-all for device_id={device_id}")
        device = None
        
        # 2. 초기 상태 설정 및 장비 정보 로드
        async with SessionLocal() as db:
            device = await crud.device.get_device(db=db, device_id=device_id)
            if not device:
                logging.warning(f"[orchestrator] Device not found: id={device_id}")
                return
            # 상태 업데이트: 연결 중
            await crud.device.update_sync_status(db=db, device=device, status="in_progress", step="Connecting...")
            await db.commit()

        collector = create_collector_from_device(device)
        loop = asyncio.get_running_loop()

        try:
            # 3. 장비 연결 (동기 함수이므로 run_in_executor 사용)
            await loop.run_in_executor(None, getattr(collector, 'connect', lambda: None))
            
            # 연결 성공 후 상태 업데이트
            async with SessionLocal() as db:
                device = await crud.device.get_device(db=db, device_id=device_id)
                if device:
                    await crud.device.update_sync_status(db, device=device, status="in_progress", step="Connected")
                    await db.commit()

            # 4. 데이터 수집 시퀀스 정의 (종속성 관계에 따라 순차 진행)
            collection_sequence = [
                ("network_objects", "Collecting network objects...", collector.export_network_objects, schemas.NetworkObjectCreate),
                ("network_groups", "Collecting network groups...", collector.export_network_group_objects, schemas.NetworkGroupCreate),
                ("services", "Collecting services...", collector.export_service_objects, schemas.ServiceCreate),
                ("service_groups", "Collecting service groups...", collector.export_service_group_objects, schemas.ServiceGroupCreate),
                ("policies", "Collecting policies...", collector.export_security_rules, schemas.PolicyCreate),
            ]

            collected_dfs = {}
            for data_type, step_msg, export_func, schema_create in collection_sequence:
                # 상태 업데이트: 각 단계 시작
                async with SessionLocal() as db:
                    device = await crud.device.get_device(db=db, device_id=device_id)
                    if device:
                        await crud.device.update_sync_status(db, device=device, status="in_progress", step=step_msg)
                        await db.commit()

                # 실제 데이터 수집 수행 (Network I/O가 발생하는 부분)
                logging.info(f"[orchestrator] Starting export for {data_type}")
                df = await loop.run_in_executor(None, export_func)
                collected_dfs[data_type] = pd.DataFrame() if df is None else df
                logging.info(f"[orchestrator] Export completed for {data_type}, rows: {len(collected_dfs[data_type])}")
                
                # 상태 업데이트: 각 단계 완료
                async with SessionLocal() as db:
                    device = await crud.device.get_device(db=db, device_id=device_id)
                    if device:
                        completed_msg_map = {
                            "network_objects": "Network objects collected",
                            "network_groups": "Network groups collected",
                            "services": "Services collected",
                            "service_groups": "Service groups collected",
                            "policies": "Policies collected",
                        }
                        completed_msg = completed_msg_map.get(data_type, f"{data_type} collected")
                        await crud.device.update_sync_status(db, device=device, status="in_progress", step=completed_msg)
                        await db.commit()

            # 5. 후처리: 정책 히트(사용 이력) 정보 수집 (Palo Alto 전용)
            collect_hit_date = getattr(device, 'collect_last_hit_date', True) if device else True
            
            if device.vendor == 'paloalto' and collect_hit_date:
                logging.info(f"[orchestrator] Palo Alto device detected. Starting last_hit_date collection for device_id={device_id}")
                async with SessionLocal() as db:
                    device = await crud.device.get_device(db=db, device_id=device_id)
                    if device:
                        await crud.device.update_sync_status(db, device=device, status="in_progress", step="Collecting usage history...")
                        await db.commit()
                try:
                    policies_df = collected_dfs["policies"]
                    vsys_list = policies_df["vsys"].unique().tolist() if "vsys" in policies_df.columns and not policies_df["vsys"].isnull().all() else None

                    # 메인과 HA Peer로부터 병렬 수집
                    hit_date_df = await _collect_last_hit_date_parallel(
                        collector=collector,
                        device=device,
                        vsys_list=vsys_list,
                        loop=loop
                    )

                    if hit_date_df is not None and not hit_date_df.empty:
                        # 수집된 히트 정보와 정책 목록 병합 처리
                        def normalize_rule_name(name):
                            if pd.isna(name): return None
                            s = str(name).strip()
                            return s if s and s.lower() not in {"nan", "none", "-", ""} else None
                        
                        def normalize_vsys(vsys_val):
                            if pd.isna(vsys_val): return None
                            s = str(vsys_val).strip().lower()
                            return s if s and s.lower() not in {"nan", "none", "-", ""} else None
                        
                        policies_df['rule_name_normalized'] = policies_df['rule_name'].apply(normalize_rule_name)
                        hit_date_df['rule_name_normalized'] = hit_date_df['rule_name'].apply(normalize_rule_name)
                        
                        if 'vsys' in policies_df.columns:
                            policies_df['vsys_normalized'] = policies_df['vsys'].apply(normalize_vsys)
                        if 'vsys' in hit_date_df.columns:
                            hit_date_df['vsys_normalized'] = hit_date_df['vsys'].apply(normalize_vsys)
                        
                        # 히트 정보가 있는 레코드만 필터링 후 병합
                        hit_date_df = hit_date_df[hit_date_df['rule_name_normalized'].notna()].copy()
                        
                        if 'last_hit_date' in policies_df.columns:
                            policies_df['last_hit_date_old'] = pd.to_datetime(policies_df['last_hit_date'], errors='coerce')
                            hit_date_df['last_hit_date_new'] = pd.to_datetime(hit_date_df['last_hit_date'], errors='coerce')
                            
                            merge_keys = ['vsys_normalized', 'rule_name_normalized'] if 'vsys_normalized' in policies_df.columns else ['rule_name_normalized']
                            
                            merged_df = pd.merge(policies_df, hit_date_df[merge_keys + ['last_hit_date_new']], on=merge_keys, how="left")
                            
                            # 최신 정보로 갱신 (정보가 없으면 기존 값을 유지하는 대신 새로 수집된 상태(None 포함)로 동기화)
                            def choose_latest(row):
                                new_val = row.get('last_hit_date_new')
                                if pd.notna(new_val):
                                    return new_val.to_pydatetime() if hasattr(new_val, 'to_pydatetime') else new_val
                                return None
                            
                            merged_df['last_hit_date'] = merged_df.apply(choose_latest, axis=1)
                            policies_df = merged_df.drop(columns=['last_hit_date_old', 'last_hit_date_new', 'rule_name_normalized', 'vsys_normalized'], errors='ignore')
                        
                        collected_dfs["policies"] = policies_df
                        
                        # 히트 정보 수집 완료 상태 업데이트
                        async with SessionLocal() as db:
                            device = await crud.device.get_device(db=db, device_id=device_id)
                            if device:
                                await crud.device.update_sync_status(db, device=device, status="in_progress", step="Usage history collected")
                                await db.commit()
                except Exception as e:
                    logging.warning(f"Failed to collect hit dates for device {device_id}: {e}. Continuing sync...", exc_info=True)

            # 6. DB 동기화 실행 (수집된 데이터를 DB에 반영)
            for data_type, _, _, schema_create in collection_sequence:
                async with SessionLocal() as db:
                    device = await crud.device.get_device(db=db, device_id=device_id)
                    if device:
                        await crud.device.update_sync_status(db, device=device, status="in_progress", step=f"Synchronizing {data_type}...")
                        await db.commit()
                
                df = collected_dfs[data_type]
                df["device_id"] = device_id
                # DataFrame을 Pydantic 모델로 변환하여 동기화 작업 전달
                items_to_sync = dataframe_to_pydantic(df, schema_create)
                await sync_data_task(device_id, data_type, items_to_sync)

            # 7. 정책 인덱싱 및 마무리
            async with SessionLocal() as db:
                device = await crud.device.get_device(db=db, device_id=device_id)
                if device:
                    await crud.device.update_sync_status(db, device=device, status="in_progress", step="Indexing policies...")
                    await db.commit()

                    # 변경되었거나 인덱싱되지 않은 정책들 재인덱싱 (Full-text search용)
                    result = await db.execute(select(models.Policy).where(models.Policy.device_id == device_id, models.Policy.is_indexed == False))
                    policies_to_index = result.scalars().all()
                    if policies_to_index:
                        await rebuild_policy_indices(db=db, device_id=device_id, policies=policies_to_index)
                        for p in policies_to_index: p.is_indexed = True
                        db.add_all(policies_to_index)
                        await db.commit()

                    # 최종 상태 업데이트: 성공
                    device_to_update = await crud.device.get_device(db=db, device_id=device_id)
                    if device_to_update:
                        await crud.device.update_sync_status(db=db, device=device_to_update, status="success")
                        await db.commit()

            logging.info(f"[orchestrator] sync-all finished successfully for device_id={device_id}")

        except Exception as e:
            logging.error(f"[orchestrator] sync-all failed for device_id={device_id}: {e}", exc_info=True)
            async with SessionLocal() as db:
                device_to_update = await crud.device.get_device(db=db, device_id=device_id)
                if device_to_update:
                    await crud.device.update_sync_status(db=db, device=device_to_update, status="failure", step="Failed")
                    await db.commit()
        finally:
            # 장비 연결 해제
            await loop.run_in_executor(None, getattr(collector, 'disconnect', lambda: None))
