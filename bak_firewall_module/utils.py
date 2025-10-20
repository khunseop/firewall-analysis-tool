"""
Firewall 모듈용 유틸리티 함수들
"""

import logging
import time
import functools
from typing import Callable, Optional, Any, Iterator
from contextlib import contextmanager
import pandas as pd
from .exceptions import FirewallTimeoutError, FirewallConnectionError

def setup_firewall_logger(name: str, level: int = logging.INFO) -> logging.Logger:
    """방화벽 모듈용 로거 설정
    
    Args:
        name: 로거 이름
        level: 로그 레벨
        
    Returns:
        logging.Logger: 설정된 로거
    """
    logger = logging.getLogger(name)
    
    if not logger.handlers:  # 핸들러가 없을 때만 설정
        handler = logging.StreamHandler()
        formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        logger.setLevel(level)
    
    return logger

def retry_on_failure(
    max_attempts: int = 3,
    delay: float = 1.0,
    backoff_factor: float = 2.0,
    exceptions: tuple = (ConnectionError, TimeoutError, FirewallConnectionError, FirewallTimeoutError)
):
    """재시도 데코레이터
    
    Args:
        max_attempts: 최대 시도 횟수
        delay: 초기 지연 시간 (초)
        backoff_factor: 지연 시간 증가 배수
        exceptions: 재시도할 예외 타입들
    """
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs) -> Any:
            logger = logging.getLogger(f"{func.__module__}.{func.__name__}")
            
            for attempt in range(max_attempts):
                try:
                    result = func(*args, **kwargs)
                    if attempt > 0:
                        logger.info(f"{func.__name__} 재시도 성공 (시도 {attempt + 1}/{max_attempts})")
                    return result
                except exceptions as e:
                    if attempt == max_attempts - 1:
                        logger.error(f"{func.__name__} 최종 실패 (시도 {attempt + 1}/{max_attempts}): {e}")
                        raise
                    
                    wait_time = delay * (backoff_factor ** attempt)
                    logger.warning(f"{func.__name__} 실패 (시도 {attempt + 1}/{max_attempts}): {e}. "
                                 f"{wait_time:.1f}초 후 재시도...")
                    time.sleep(wait_time)
            
            return None  # 여기까지 오면 안되지만 타입 힌트를 위해
        return wrapper
    return decorator

@contextmanager
def performance_monitor(operation_name: str, logger: Optional[logging.Logger] = None):
    """성능 모니터링 컨텍스트 매니저
    
    Args:
        operation_name: 작업 이름
        logger: 로거 (없으면 기본 로거 사용)
    """
    if logger is None:
        logger = logging.getLogger(__name__)
    
    start_time = time.time()
    logger.info(f"{operation_name} 시작")
    
    try:
        yield
        end_time = time.time()
        duration = end_time - start_time
        logger.info(f"{operation_name} 완료 (소요시간: {duration:.2f}초)")
    except Exception as e:
        end_time = time.time()
        duration = end_time - start_time
        logger.error(f"{operation_name} 실패 (소요시간: {duration:.2f}초): {e}")
        raise

def chunk_dataframe(df: pd.DataFrame, chunk_size: int = 1000) -> Iterator[pd.DataFrame]:
    """DataFrame을 청크 단위로 분할
    
    Args:
        df: 분할할 DataFrame
        chunk_size: 청크 크기
        
    Yields:
        pd.DataFrame: 청크 단위 DataFrame
    """
    if df.empty:
        yield df
        return
    
    for i in range(0, len(df), chunk_size):
        yield df.iloc[i:i + chunk_size]

def safe_dataframe_operation(
    operation: Callable[[], pd.DataFrame],
    operation_name: str,
    logger: Optional[logging.Logger] = None,
    default_columns: Optional[list] = None
) -> pd.DataFrame:
    """안전한 DataFrame 작업 실행
    
    Args:
        operation: 실행할 작업
        operation_name: 작업 이름
        logger: 로거
        default_columns: 오류 시 반환할 기본 컬럼
        
    Returns:
        pd.DataFrame: 작업 결과 또는 빈 DataFrame
    """
    if logger is None:
        logger = logging.getLogger(__name__)
    
    try:
        with performance_monitor(operation_name, logger):
            result = operation()
            
            if not isinstance(result, pd.DataFrame):
                logger.warning(f"{operation_name}: 결과가 DataFrame이 아닙니다. 빈 DataFrame 반환")
                return pd.DataFrame(columns=default_columns or [])
            
            logger.info(f"{operation_name}: {len(result)}개 레코드 반환")
            return result
            
    except Exception as e:
        logger.error(f"{operation_name} 실패: {e}")
        return pd.DataFrame(columns=default_columns or [])

def validate_dataframe_structure(
    df: pd.DataFrame,
    required_columns: list,
    operation_name: str,
    logger: Optional[logging.Logger] = None
) -> bool:
    """DataFrame 구조 검증
    
    Args:
        df: 검증할 DataFrame
        required_columns: 필수 컬럼 리스트
        operation_name: 작업 이름
        logger: 로거
        
    Returns:
        bool: 검증 통과 여부
    """
    if logger is None:
        logger = logging.getLogger(__name__)
    
    if df.empty:
        logger.warning(f"{operation_name}: DataFrame이 비어있습니다")
        return True  # 빈 DataFrame은 유효한 결과로 간주
    
    missing_columns = [col for col in required_columns if col not in df.columns]
    if missing_columns:
        logger.error(f"{operation_name}: 필수 컬럼 누락 - {missing_columns}")
        return False
    
    logger.debug(f"{operation_name}: DataFrame 구조 검증 통과")
    return True

def format_connection_info(hostname: str, username: str, vendor: str) -> str:
    """연결 정보 포맷팅 (비밀번호는 제외)
    
    Args:
        hostname: 호스트명
        username: 사용자명
        vendor: 벤더명
        
    Returns:
        str: 포맷된 연결 정보
    """
    return f"{vendor}://{username}@{hostname}"

def sanitize_for_logging(data: Any, max_length: int = 100) -> str:
    """로깅용 데이터 정제
    
    Args:
        data: 정제할 데이터
        max_length: 최대 길이
        
    Returns:
        str: 정제된 문자열
    """
    if data is None:
        return "None"
    
    str_data = str(data)
    if len(str_data) > max_length:
        return str_data[:max_length] + "..."
    
    # 민감한 정보 마스킹
    if any(keyword in str_data.lower() for keyword in ['password', 'token', 'secret', 'key']):
        return "[MASKED]"
    
    return str_data

class ProgressTracker:
    """작업 진행률 추적 클래스"""
    
    def __init__(self, total_steps: int, operation_name: str, logger: Optional[logging.Logger] = None):
        self.total_steps = total_steps
        self.current_step = 0
        self.operation_name = operation_name
        self.logger = logger or logging.getLogger(__name__)
        self.start_time = time.time()
    
    def update(self, step_name: str = "", increment: int = 1):
        """진행률 업데이트
        
        Args:
            step_name: 현재 단계 이름
            increment: 증가량
        """
        self.current_step += increment
        progress_pct = (self.current_step / self.total_steps) * 100
        
        elapsed_time = time.time() - self.start_time
        if self.current_step > 0:
            estimated_total = elapsed_time * self.total_steps / self.current_step
            remaining_time = estimated_total - elapsed_time
        else:
            remaining_time = 0
        
        message = f"{self.operation_name} 진행률: {progress_pct:.1f}% ({self.current_step}/{self.total_steps})"
        if step_name:
            message += f" - {step_name}"
        if remaining_time > 0:
            message += f" (예상 남은 시간: {remaining_time:.1f}초)"
        
        self.logger.info(message)
    
    def complete(self):
        """작업 완료"""
        total_time = time.time() - self.start_time
        self.logger.info(f"{self.operation_name} 완료 (총 소요시간: {total_time:.2f}초)")

def memory_efficient_excel_writer(data_dict: dict, output_path: str, chunk_size: int = 1000):
    """메모리 효율적인 Excel 파일 작성
    
    Args:
        data_dict: 시트명과 DataFrame의 딕셔너리
        output_path: 출력 파일 경로
        chunk_size: 청크 크기
    """
    logger = logging.getLogger(__name__)
    
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        for sheet_name, df in data_dict.items():
            if df.empty:
                logger.warning(f"시트 '{sheet_name}'는 빈 데이터입니다")
                df.to_excel(writer, sheet_name=sheet_name, index=False)
                continue
            
            if len(df) <= chunk_size:
                # 작은 데이터는 한 번에 처리
                df.to_excel(writer, sheet_name=sheet_name, index=False)
                logger.info(f"시트 '{sheet_name}' 작성 완료 ({len(df)}개 레코드)")
            else:
                # 큰 데이터는 청크 단위로 처리
                logger.info(f"시트 '{sheet_name}' 청크 단위 작성 시작 ({len(df)}개 레코드)")
                
                for i, chunk in enumerate(chunk_dataframe(df, chunk_size)):
                    start_row = i * chunk_size if i > 0 else 0
                    header = i == 0  # 첫 번째 청크만 헤더 포함
                    
                    chunk.to_excel(
                        writer, 
                        sheet_name=sheet_name, 
                        index=False, 
                        startrow=start_row,
                        header=header
                    )
                
                logger.info(f"시트 '{sheet_name}' 작성 완료") 