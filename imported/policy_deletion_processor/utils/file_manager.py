#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
파일 관리 기능을 제공하는 모듈
"""

import os
import re
import logging

logger = logging.getLogger(__name__)

class FileManager:
    """파일 관리 기능을 제공하는 클래스"""
    
    def __init__(self, config_manager):
        """
        파일 관리자를 초기화합니다.
        
        Args:
            config_manager: 설정 관리자
        """
        self.config = config_manager
    
    def update_version(self, filename, final_version=False):
        """
        파일 이름의 버전을 업데이트합니다.
        
        Args:
            filename (str): 파일 이름
            final_version (bool): 최종 버전 여부
            
        Returns:
            str: 업데이트된 파일 이름
        """
        base_name, ext = filename.rsplit('.', 1)
        
        version_format = self.config.get('file_naming.policy_version_format', '_v{version}')
        final_suffix = self.config.get('file_naming.final_version_suffix', '_vf')
        
        match = re.search(r'_v(\d+)$', base_name)
        final_match = re.search(r'_vf$', base_name)
        
        if final_match:
            return filename
        
        if final_version:
            if match:
                new_base_name = re.sub(r'_v\d+$', final_suffix, base_name)
            else:
                new_base_name = f"{base_name}{final_suffix}"
        else:
            if match:
                version = int(match.group(1))
                new_version = version + 1
                new_base_name = re.sub(r'_v\d+$', version_format.format(version=new_version), base_name)
            else:
                new_base_name = f"{base_name}{version_format.format(version=1)}"
        
        new_filename = f"{new_base_name}.{ext}"
        logger.info(f"파일 이름을 '{filename}'에서 '{new_filename}'으로 업데이트했습니다.")
        return new_filename
    
    def select_files(self, extension=None):
        """
        지정된 확장자의 파일 목록에서 파일을 선택합니다.
        
        Args:
            extension (str): 파일 확장자
            
        Returns:
            str: 선택된 파일 이름 또는 None
        """
        if extension is None:
            extension = self.config.get('file_extensions.excel', '.xlsx')
            
        file_list = [file for file in os.listdir() if file.endswith(extension)]
        if not file_list:
            print(f"{extension} 확장자를 가진 파일이 없습니다.")
            return None
        
        for i, file in enumerate(file_list, start=1):
            print(f"{i}. {file}")
        
        while True:
            choice = input("파일 번호를 입력하세요 (종료: 0): ")
            if choice.isdigit():
                choice = int(choice)
                if choice == 0:
                    print('프로그램을 종료합니다.')
                    return None
                elif 1 <= choice <= len(file_list):
                    selected_file = file_list[choice - 1]
                    logger.info(f"파일 '{selected_file}'을 선택했습니다.")
                    return selected_file
            print('유효하지 않은 번호입니다. 다시 시도하세요.')
    
    def remove_extension(self, filename):
        """
        파일 이름에서 확장자를 제거합니다.
        
        Args:
            filename (str): 파일 이름
            
        Returns:
            str: 확장자가 제거된 파일 이름
        """
        return os.path.splitext(filename)[0] 