# app/services/deletion_workflow/utils/file_manager.py
"""
파일 관리 유틸리티.
fpat/fpat/policy_deletion_processor/utils/file_manager.py 이식.
대화형 선택(input) 로직은 FAT 웹 환경에서는 사용되지 않으며,
set_forced_files()를 통해 파일 경로를 주입합니다.
"""

import os
import re
import logging
from typing import List, Optional

logger = logging.getLogger(__name__)


class FileManager:
    """파일 관리 기능을 제공하는 클래스"""

    def __init__(self, config_manager):
        self.config = config_manager
        self._forced_files: List[str] = []

    def set_forced_files(self, files: List[str]):
        """API/웹 호출 시 파일 경로를 미리 지정합니다."""
        self._forced_files = list(files)

    def update_version(self, filename: str, final_version: bool = False) -> str:
        """파일 이름의 버전 접미사를 업데이트합니다."""
        base_name, ext = filename.rsplit('.', 1)

        version_format = self.config.get('file_management.policy_version_format', '_v{version}')
        final_suffix = self.config.get('file_management.final_version_suffix', '_vf')

        final_match = re.search(r'_vf$', base_name)
        if final_match:
            return filename

        match = re.search(r'_v(\d+)$', base_name)
        if final_version:
            new_base_name = re.sub(r'_v\d+$', final_suffix, base_name) if match else f"{base_name}{final_suffix}"
        else:
            if match:
                new_version = int(match.group(1)) + 1
                new_base_name = re.sub(r'_v\d+$', version_format.format(version=new_version), base_name)
            else:
                new_base_name = f"{base_name}{version_format.format(version=1)}"

        new_filename = f"{new_base_name}.{ext}"
        logger.info(f"파일 이름 업데이트: '{filename}' → '{new_filename}'")
        return new_filename

    def select_files(self, extension: Optional[str] = None) -> Optional[str]:
        """
        파일을 선택합니다.
        - forced_files가 설정된 경우 순차 반환 (웹 API 모드)
        - 그 외에는 현재 디렉토리에서 대화형 선택 (CLI 모드)
        """
        if self._forced_files:
            selected = self._forced_files.pop(0)
            logger.info(f"지정된 파일 사용: {selected}")
            return selected

        if extension is None:
            extension = self.config.get('file_management.default_extension', '.xlsx')

        file_list = [f for f in os.listdir() if f.endswith(extension)]
        if not file_list:
            logger.warning(f"'{extension}' 파일이 없습니다.")
            return None

        for i, file in enumerate(file_list, start=1):
            print(f"{i}. {file}")

        while True:
            try:
                choice = input("파일 번호를 입력하세요 (종료: 0): ")
                if choice.isdigit():
                    choice = int(choice)
                    if choice == 0:
                        return None
                    elif 1 <= choice <= len(file_list):
                        selected = file_list[choice - 1]
                        logger.info(f"파일 선택: '{selected}'")
                        return selected
                print('유효하지 않은 번호입니다.')
            except (KeyboardInterrupt, EOFError):
                return None

    def remove_extension(self, filename: str) -> str:
        """파일 이름에서 확장자를 제거합니다."""
        return os.path.splitext(filename)[0]
