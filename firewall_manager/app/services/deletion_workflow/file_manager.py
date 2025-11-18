"""
임시 파일 관리 시스템
"""
import os
import logging
from pathlib import Path
from typing import Optional
from datetime import datetime
import shutil

logger = logging.getLogger(__name__)


class FileManager:
    """임시 파일 관리 클래스"""
    
    def __init__(self, base_dir: Optional[str] = None):
        """
        FileManager 초기화
        
        Args:
            base_dir: 기본 디렉토리 경로 (None이면 프로젝트 루트의 temp 디렉토리 사용)
        """
        if base_dir is None:
            # 프로젝트 루트 기준으로 temp 디렉토리 설정
            project_root = Path(__file__).resolve().parents[3]
            self.base_dir = project_root / "firewall_manager" / "temp" / "deletion_workflow"
        else:
            self.base_dir = Path(base_dir)
        
        # 기본 디렉토리 생성
        self.base_dir.mkdir(parents=True, exist_ok=True)
    
    def get_workflow_dir(self, device_id: int) -> Path:
        """
        특정 장비의 워크플로우 디렉토리 경로 반환
        
        Args:
            device_id: 장비 ID
            
        Returns:
            워크플로우 디렉토리 Path 객체
        """
        workflow_dir = self.base_dir / str(device_id)
        workflow_dir.mkdir(parents=True, exist_ok=True)
        return workflow_dir
    
    def create_master_file_path(self, device_id: int) -> str:
        """
        마스터 파일 경로 생성
        
        Args:
            device_id: 장비 ID
            
        Returns:
            마스터 파일 경로 (문자열)
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        workflow_dir = self.get_workflow_dir(device_id)
        file_path = workflow_dir / f"master_{timestamp}.xlsx"
        return str(file_path)
    
    def create_step_file_path(self, device_id: int, step_number: int) -> str:
        """
        단계별 결과 파일 경로 생성
        
        Args:
            device_id: 장비 ID
            step_number: 단계 번호 (1-7)
            
        Returns:
            단계별 파일 경로 (문자열)
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        workflow_dir = self.get_workflow_dir(device_id)
        file_path = workflow_dir / f"step_{step_number}_{timestamp}.xlsx"
        return str(file_path)
    
    def create_final_file_path(self, device_id: int, category: str) -> str:
        """
        최종 결과 파일 경로 생성
        
        Args:
            device_id: 장비 ID
            category: 파일 카테고리 (예: 'master', 'expired_used', 'expired_unused' 등)
            
        Returns:
            최종 파일 경로 (문자열)
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        workflow_dir = self.get_workflow_dir(device_id)
        file_path = workflow_dir / f"final_{category}_{timestamp}.xlsx"
        return str(file_path)
    
    def ensure_file_exists(self, file_path: str) -> bool:
        """
        파일이 존재하는지 확인
        
        Args:
            file_path: 파일 경로
            
        Returns:
            파일 존재 여부
        """
        return Path(file_path).exists()
    
    def delete_file(self, file_path: str) -> bool:
        """
        파일 삭제
        
        Args:
            file_path: 삭제할 파일 경로
            
        Returns:
            삭제 성공 여부
        """
        try:
            file_path_obj = Path(file_path)
            if file_path_obj.exists():
                file_path_obj.unlink()
                logger.info(f"파일 삭제 완료: {file_path}")
                return True
            else:
                logger.warning(f"파일이 존재하지 않음: {file_path}")
                return False
        except Exception as e:
            logger.error(f"파일 삭제 실패: {file_path}, 오류: {e}")
            return False
    
    def delete_workflow_files(self, device_id: int) -> bool:
        """
        특정 장비의 워크플로우 디렉토리 전체 삭제
        
        Args:
            device_id: 장비 ID
            
        Returns:
            삭제 성공 여부
        """
        try:
            workflow_dir = self.get_workflow_dir(device_id)
            if workflow_dir.exists():
                shutil.rmtree(workflow_dir)
                logger.info(f"워크플로우 디렉토리 삭제 완료: {workflow_dir}")
                return True
            else:
                logger.warning(f"워크플로우 디렉토리가 존재하지 않음: {workflow_dir}")
                return False
        except Exception as e:
            logger.error(f"워크플로우 디렉토리 삭제 실패: device_id={device_id}, 오류: {e}")
            return False
    
    def get_file_size(self, file_path: str) -> int:
        """
        파일 크기 반환 (바이트)
        
        Args:
            file_path: 파일 경로
            
        Returns:
            파일 크기 (바이트), 파일이 없으면 0
        """
        file_path_obj = Path(file_path)
        if file_path_obj.exists():
            return file_path_obj.stat().st_size
        return 0
    
    def get_latest_file_by_pattern(self, device_id: int, pattern: str) -> Optional[str]:
        """
        패턴에 맞는 최신 파일 경로 반환
        
        Args:
            device_id: 장비 ID
            pattern: 파일명 패턴 (예: 'step_1_', 'master_', 'final_master_')
            
        Returns:
            최신 파일 경로 (문자열), 없으면 None
        """
        try:
            workflow_dir = self.get_workflow_dir(device_id)
            if not workflow_dir.exists():
                return None
            
            # 패턴에 맞는 파일 찾기
            matching_files = []
            for file_path in workflow_dir.iterdir():
                if file_path.is_file() and pattern in file_path.name:
                    matching_files.append(file_path)
            
            if not matching_files:
                return None
            
            # 수정 시간 기준으로 정렬 (최신 파일이 맨 앞)
            matching_files.sort(key=lambda x: x.stat().st_mtime, reverse=True)
            
            latest_file = matching_files[0]
            logger.debug(f"최신 파일 찾음: {latest_file.name} (수정 시간: {datetime.fromtimestamp(latest_file.stat().st_mtime)})")
            return str(latest_file)
        except Exception as e:
            logger.error(f"최신 파일 찾기 실패: device_id={device_id}, pattern={pattern}, 오류: {e}")
            return None
    
    def cleanup_old_files(self, device_id: int, days: int = 7) -> int:
        """
        오래된 파일 정리 (지정된 일수 이상 경과한 파일 삭제)
        
        Args:
            device_id: 장비 ID
            days: 보관 일수 (기본값: 7일)
            
        Returns:
            삭제된 파일 개수
        """
        deleted_count = 0
        try:
            workflow_dir = self.get_workflow_dir(device_id)
            if not workflow_dir.exists():
                return 0
            
            cutoff_time = datetime.now().timestamp() - (days * 24 * 60 * 60)
            
            for file_path in workflow_dir.iterdir():
                if file_path.is_file():
                    file_mtime = file_path.stat().st_mtime
                    if file_mtime < cutoff_time:
                        file_path.unlink()
                        deleted_count += 1
                        logger.info(f"오래된 파일 삭제: {file_path}")
            
            logger.info(f"총 {deleted_count}개의 오래된 파일 삭제 완료")
            return deleted_count
        except Exception as e:
            logger.error(f"파일 정리 실패: device_id={device_id}, 오류: {e}")
            return deleted_count

