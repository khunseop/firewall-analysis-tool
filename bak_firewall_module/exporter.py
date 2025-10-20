import pandas as pd
import os
import logging
from typing import Optional
from .collector_factory import FirewallCollectorFactory
from .validators import FirewallValidator
from .utils import (
    setup_firewall_logger, 
    performance_monitor, 
    ProgressTracker,
    memory_efficient_excel_writer,
    safe_dataframe_operation
)
from .exceptions import (
    FirewallConfigurationError,
    FirewallConnectionError,
    FirewallDataError
)

def export_policy_to_excel(
    vendor: str,
    hostname: str,
    username: str,
    password: str,
    export_type: str,
    output_path: str,
    config_type: str = "running",
    chunk_size: int = 1000,
    progress_callback: Optional[callable] = None
) -> str:
    """
    방화벽 장비에서 정책, 객체, 사용 로그를 추출하여 Excel로 저장합니다.

    Args:
        vendor: 장비 유형 ('paloalto', 'mf2', 'ngf', 'mock')
        hostname: 장비 IP 또는 호스트명
        username: 장비 로그인 계정
        password: 장비 로그인 비밀번호
        export_type: 추출할 항목 ('policy', 'address', 'address_group', 'service', 'service_group', 'usage', 'all')
        output_path: 저장할 엑셀 파일 경로
        config_type: 설정 타입 ('running' 또는 'candidate', PaloAlto만 지원)
        chunk_size: 대용량 데이터 처리시 청크 크기
        progress_callback: 진행률 콜백 함수

    Returns:
        str: 저장된 엑셀 파일 경로

    Raises:
        FirewallConfigurationError: 잘못된 설정값인 경우
        FirewallConnectionError: 방화벽 연결 실패 시
        FirewallDataError: 데이터 추출 실패 시
    """
    # 로거 설정
    logger = setup_firewall_logger(__name__)
    
    try:
        # 입력 검증
        vendor = FirewallValidator.validate_source_type(
            vendor, 
            FirewallCollectorFactory.get_supported_vendors()
        )
        hostname = FirewallValidator.validate_hostname(hostname)
        username, password = FirewallValidator.validate_credentials(username, password)
        export_type = FirewallValidator.validate_export_type(export_type)
        output_path = FirewallValidator.validate_file_path(output_path)
        
        # PaloAlto 전용 설정 검증
        if vendor == "paloalto":
            config_type = FirewallValidator.validate_config_type(config_type, ['running', 'candidate'])
        else:
            config_type = "running"
        
        # 출력 디렉토리 확인 및 생성
        output_dir = os.path.dirname(output_path)
        if output_dir and not os.path.exists(output_dir):
            os.makedirs(output_dir)
            logger.info(f"출력 디렉토리 생성: {output_dir}")
        
        # 진행률 추적 설정
        export_steps = _get_export_steps(export_type)
        tracker = ProgressTracker(len(export_steps), f"{vendor} 데이터 추출", logger)
        
        logger.info(f"방화벽 데이터 추출 시작: {vendor}://{username}@{hostname}")
        
        with performance_monitor(f"{vendor} 데이터 추출", logger):
            # Collector 생성
            tracker.update("Collector 연결 중")
            collector = FirewallCollectorFactory.get_collector(
                source_type=vendor,
                hostname=hostname,
                username=username,
                password=password
            )
            
            # 데이터 추출
            sheets = {}
            
            for step in export_steps:
                tracker.update(f"{step} 추출 중")
                
                try:
                    if step == "policy":
                        if vendor == "paloalto":
                            df = safe_dataframe_operation(
                                lambda: collector.export_security_rules(config_type=config_type),
                                f"{step} 추출",
                                logger
                            )
                        else:
                            df = safe_dataframe_operation(
                                lambda: collector.export_security_rules(),
                                f"{step} 추출",
                                logger
                            )
                        sheets["policy"] = df
                        
                    elif step == "address":
                        df = safe_dataframe_operation(
                            lambda: collector.export_network_objects(),
                            f"{step} 추출",
                            logger
                        )
                        sheets["address"] = df
                        
                    elif step == "address_group":
                        df = safe_dataframe_operation(
                            lambda: collector.export_network_group_objects(),
                            f"{step} 추출",
                            logger
                        )
                        sheets["address_group"] = df
                        
                    elif step == "service":
                        df = safe_dataframe_operation(
                            lambda: collector.export_service_objects(),
                            f"{step} 추출",
                            logger
                        )
                        sheets["service"] = df
                        
                    elif step == "service_group":
                        df = safe_dataframe_operation(
                            lambda: collector.export_service_group_objects(),
                            f"{step} 추출",
                            logger
                        )
                        if not df.empty:
                            sheets["service_group"] = df
                            
                    elif step == "usage":
                        df = safe_dataframe_operation(
                            lambda: collector.export_usage_logs(),
                            f"{step} 추출",
                            logger
                        )
                        if not df.empty:
                            sheets["usage"] = df
                    
                    # 진행률 콜백 호출
                    if progress_callback:
                        progress_callback(tracker.current_step, tracker.total_steps)
                        
                except Exception as e:
                    logger.error(f"{step} 추출 실패: {e}")
                    # 개별 단계 실패는 전체 실패로 이어지지 않음
                    continue
            
            # 추출된 데이터 확인
            if not sheets:
                raise FirewallDataError(f"추출된 데이터가 없습니다: {export_type}")
            
            # Excel 파일 저장
            tracker.update("Excel 파일 저장 중")
            memory_efficient_excel_writer(sheets, output_path, chunk_size)
            
            tracker.complete()
            
            # 결과 요약
            total_records = sum(len(df) for df in sheets.values() if not df.empty)
            logger.info(f"데이터 추출 완료: {len(sheets)}개 시트, 총 {total_records}개 레코드")
            logger.info(f"출력 파일: {output_path}")
            
            return output_path
            
    except (FirewallConfigurationError, FirewallConnectionError, FirewallDataError) as e:
        logger.error(f"방화벽 데이터 추출 실패: {e}")
        raise
    except Exception as e:
        logger.error(f"방화벽 데이터 추출 중 예상치 못한 오류: {e}")
        raise FirewallDataError(f"데이터 추출 실패: {e}")

def _get_export_steps(export_type: str) -> list:
    """추출 타입에 따른 단계 리스트 반환
    
    Args:
        export_type: 추출 타입
        
    Returns:
        list: 추출 단계 리스트
    """
    if export_type == "all":
        return ["policy", "address", "address_group", "service", "service_group", "usage"]
    else:
        return [export_type]