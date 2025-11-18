#!/usr/bin/env python3
"""
매개변수 관리 모듈 (CRUD)
"""

import json
import os
from typing import List, Dict, Optional
from database import DatabaseManager

class ParameterManager:
    def __init__(self, db_path: str = "data/parameters.db"):
        self.db = DatabaseManager(db_path)
        self.default_params_file = "data/default_params.json"
        
        # 기본 매개변수가 없으면 초기화
        if not self.db.get_all_parameters():
            self.reset_to_defaults()
    
    def get_all_parameters(self) -> List[Dict]:
        """모든 매개변수 조회"""
        return self.db.get_all_parameters()
    
    def get_parameter(self, param_id: int) -> Optional[Dict]:
        """특정 매개변수 조회"""
        return self.db.get_parameter_by_id(param_id)
    
    def add_parameter(self, name: str, description: str, expected_value: str,
                     command: str, modify_command: str, pattern: str) -> Dict:
        """새 매개변수 추가"""
        try:
            # 정규식 패턴 검증
            import re
            re.compile(pattern)
            
            param_id = self.db.add_parameter(
                name=name.strip(),
                description=description.strip(),
                expected_value=expected_value.strip(),
                command=command.strip(),
                modify_command=modify_command.strip(),
                pattern=pattern.strip()
            )
            
            return {
                'success': True,
                'message': f'매개변수 "{name}" 추가됨',
                'id': param_id
            }
        except re.error as e:
            return {
                'success': False,
                'message': f'정규식 패턴 오류: {str(e)}'
            }
        except Exception as e:
            return {
                'success': False,
                'message': f'매개변수 추가 실패: {str(e)}'
            }
    
    def update_parameter(self, param_id: int, name: str, description: str,
                        expected_value: str, command: str, modify_command: str,
                        pattern: str) -> Dict:
        """매개변수 수정"""
        try:
            # 정규식 패턴 검증
            import re
            re.compile(pattern)
            
            success = self.db.update_parameter(
                param_id=param_id,
                name=name.strip(),
                description=description.strip(),
                expected_value=expected_value.strip(),
                command=command.strip(),
                modify_command=modify_command.strip(),
                pattern=pattern.strip()
            )
            
            if success:
                return {
                    'success': True,
                    'message': f'매개변수 ID {param_id} 수정됨'
                }
            else:
                return {
                    'success': False,
                    'message': f'매개변수 ID {param_id}를 찾을 수 없음'
                }
        except re.error as e:
            return {
                'success': False,
                'message': f'정규식 패턴 오류: {str(e)}'
            }
        except Exception as e:
            return {
                'success': False,
                'message': f'매개변수 수정 실패: {str(e)}'
            }
    
    def delete_parameter(self, param_id: int) -> Dict:
        """매개변수 삭제"""
        try:
            success = self.db.delete_parameter(param_id)
            
            if success:
                return {
                    'success': True,
                    'message': f'매개변수 ID {param_id} 삭제됨'
                }
            else:
                return {
                    'success': False,
                    'message': f'매개변수 ID {param_id}를 찾을 수 없음'
                }
        except Exception as e:
            return {
                'success': False,
                'message': f'매개변수 삭제 실패: {str(e)}'
            }
    
    def export_parameters(self) -> Dict:
        """매개변수 내보내기"""
        try:
            return {
                'success': True,
                'data': self.db.export_parameters()
            }
        except Exception as e:
            return {
                'success': False,
                'message': f'내보내기 실패: {str(e)}'
            }
    
    def import_parameters(self, import_data: Dict) -> Dict:
        """매개변수 가져오기"""
        try:
            # 데이터 형식 검증
            if 'parameters' not in import_data:
                return {
                    'success': False,
                    'message': '잘못된 데이터 형식: parameters 키가 없음'
                }
            
            parameters = import_data['parameters']
            if not isinstance(parameters, list):
                return {
                    'success': False,
                    'message': 'parameters는 배열이어야 함'
                }
            
            # 각 매개변수 검증
            required_fields = ['name', 'description', 'expected_value', 'command', 'modify_command', 'pattern']
            for i, param in enumerate(parameters):
                for field in required_fields:
                    if field not in param:
                        return {
                            'success': False,
                            'message': f'매개변수 {i+1}: {field} 필드가 없음'
                        }
                
                # 정규식 패턴 검증
                try:
                    import re
                    re.compile(param['pattern'])
                except re.error as e:
                    return {
                        'success': False,
                        'message': f'매개변수 "{param["name"]}" 정규식 오류: {str(e)}'
                    }
            
            # 데이터베이스에 가져오기
            self.db.import_parameters(parameters)
            
            return {
                'success': True,
                'message': f'{len(parameters)}개 매개변수 가져오기 완료'
            }
            
        except Exception as e:
            return {
                'success': False,
                'message': f'가져오기 실패: {str(e)}'
            }
    
    def reset_to_defaults(self) -> Dict:
        """기본 매개변수로 초기화"""
        try:
            # 기본 매개변수 파일 로드
            if not os.path.exists(self.default_params_file):
                return {
                    'success': False,
                    'message': '기본 매개변수 파일을 찾을 수 없음'
                }
            
            with open(self.default_params_file, 'r', encoding='utf-8') as f:
                default_params = json.load(f)
            
            # 기존 매개변수 모두 삭제
            self.db.clear_all_parameters()
            
            # 기본 매개변수 추가
            self.db.import_parameters(default_params)
            
            return {
                'success': True,
                'message': f'{len(default_params)}개 기본 매개변수로 초기화 완료'
            }
            
        except Exception as e:
            return {
                'success': False,
                'message': f'초기화 실패: {str(e)}'
            }
    
    def validate_parameter_data(self, data: Dict) -> Dict:
        """매개변수 데이터 검증"""
        required_fields = ['name', 'description', 'expected_value', 'command', 'modify_command', 'pattern']
        
        for field in required_fields:
            if field not in data or not data[field].strip():
                return {
                    'valid': False,
                    'message': f'{field} 필드는 필수입니다'
                }
        
        # 정규식 패턴 검증
        try:
            import re
            re.compile(data['pattern'])
        except re.error as e:
            return {
                'valid': False,
                'message': f'정규식 패턴 오류: {str(e)}'
            }
        
        return {'valid': True}