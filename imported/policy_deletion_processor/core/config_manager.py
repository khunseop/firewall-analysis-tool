#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
설정 파일을 관리하는 모듈
"""

import json
import logging
import sys
import os
from typing import Any, Dict

logger = logging.getLogger(__name__)

class ConfigManager:
    def __init__(self, config_filename: str = 'config.json') -> None:
        self.config_filename = config_filename
        self.config_path = self._get_config_path()
        self.config_data = self._load_config()

    def _get_base_dir(self) -> str:
        if getattr(sys, 'frozen', False):
            # PyInstaller로 빌드된 경우: .exe 파일이 있는 경로
            return os.path.dirname(sys.executable)
        else:
            # Python 스크립트 파일의 경로
            return os.path.dirname(os.path.abspath(__file__))

    def _get_config_path(self) -> str:
        return os.path.join(self._get_base_dir(), self.config_filename)

    def _load_config(self) -> Dict[str, Any]:
        if not os.path.exists(self.config_path):
            raise FileNotFoundError(f"Config file not found: {self.config_path}")

        with open(self.config_path, 'r', encoding='utf-8') as f:
            return json.load(f)

    def get(self, key, default=None):
        """
        설정값을 가져옵니다.
        
        Args:
            key (str): 설정 키 (점으로 구분된 경로)
            default: 기본값
            
        Returns:
            설정값 또는 기본값
        """
        keys = key.split('.')
        value = self.config_data
        
        try:
            for k in keys:
                value = value[k]
            return value
        except (KeyError, TypeError):
            logger.warning(f"설정 키 '{key}'를 찾을 수 없습니다. 기본값 '{default}'를 사용합니다.")
            return default 

    def all(self) -> Dict[str, Any]:
        return self.config_data