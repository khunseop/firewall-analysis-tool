# app/services/deletion_workflow/core/workspace_runner.py
"""
API 환경에서 파이프라인 프로세서를 실행하기 위한 워크스페이스 러너.

CLI 프로세서들은 현재 작업 디렉토리(CWD) 기준으로 파일을 읽고 씁니다.
API 환경에서는 요청별 임시 디렉토리를 CWD로 설정하여 격리합니다.
동시 실행 시 chdir 충돌을 막기 위해 threading.Lock을 사용합니다.
"""

import os
import logging
import tempfile
import threading
from typing import List, Optional, Tuple

logger = logging.getLogger(__name__)

# 전역 lock: os.chdir은 프로세스 전역이므로 한 번에 하나의 작업만 실행
_workspace_lock = threading.Lock()


class WorkspaceRunner:
    """
    임시 디렉토리에서 프로세서를 실행하고 결과 파일 목록을 반환합니다.

    사용 예::

        runner = WorkspaceRunner(config_path="/path/to/fpat.yaml")
        result_files = runner.run_task(task_id=1, input_files=[b"...excel bytes..."], filenames=["policy.xlsx"])
    """

    def __init__(self, config_path: Optional[str] = None):
        self.config_path = config_path

    def run_task(
        self,
        task_id: int,
        input_files: List[bytes],
        filenames: List[str],
        **extra_kwargs,
    ) -> List[Tuple[str, bytes]]:
        """
        임시 워크스페이스에서 단일 태스크를 실행합니다.

        Args:
            task_id: 실행할 태스크 번호 (1-14)
            input_files: 업로드된 파일 바이트 목록
            filenames: 각 파일의 원본 파일명 목록
            **extra_kwargs: 프로세서 kwargs 오버라이드 (예: vendor='secui')

        Returns:
            (파일명, 파일 내용 bytes) 튜플 목록.
            임시 디렉토리 삭제 전에 내용을 읽어 반환합니다.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            # 업로드 파일을 워크스페이스에 저장
            for content, name in zip(input_files, filenames):
                dest = os.path.join(tmpdir, name)
                with open(dest, 'wb') as f:
                    f.write(content)
                logger.debug(f"워크스페이스 파일 저장: {dest}")

            output_paths = self._execute_in_dir(tmpdir, task_id, filenames, extra_kwargs)

            # 임시 디렉토리 삭제 전에 파일 내용 읽기
            results: List[Tuple[str, bytes]] = []
            for path in output_paths:
                with open(path, 'rb') as f:
                    results.append((os.path.basename(path), f.read()))

            return results

    def _execute_in_dir(
        self,
        workspace: str,
        task_id: int,
        filenames: List[str],
        extra_kwargs: dict,
    ) -> List[str]:
        """지정된 디렉토리를 CWD로 설정하고 프로세서를 실행합니다."""
        from .config_manager import ConfigManager
        from .pipeline import TaskRegistry
        from ..utils.file_manager import FileManager
        from ..utils.excel_manager import ExcelManager

        original_cwd = os.getcwd()

        with _workspace_lock:
            try:
                os.chdir(workspace)

                config = ConfigManager(config_path=self.config_path)
                file_manager = FileManager(config)
                excel_manager = ExcelManager(config)
                file_manager.set_forced_files(list(filenames))

                info = TaskRegistry.get_processor_info(task_id)
                if not info:
                    raise ValueError(f"유효하지 않은 태스크 번호: {task_id}")

                processor_class = info["class"]
                kwargs = info["kwargs"].copy()
                kwargs.update(extra_kwargs)

                if processor_class.__name__ == 'NotificationClassifier':
                    kwargs["excel_manager"] = excel_manager

                processor = processor_class(config)

                # 실행 전 파일 목록 스냅샷
                before = set(os.listdir(workspace))

                success = processor.run(file_manager, **kwargs)

                if not success:
                    raise RuntimeError(f"Task {task_id} 실행 실패")

                # 새로 생성된 파일 탐지
                after = set(os.listdir(workspace))
                new_files = sorted(after - before)
                output_paths = [os.path.join(workspace, f) for f in new_files
                                if not f.startswith('.')]

                logger.info(f"Task {task_id} 완료 — 출력 파일: {new_files}")
                return output_paths

            finally:
                os.chdir(original_cwd)
