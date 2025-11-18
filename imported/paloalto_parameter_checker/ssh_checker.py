#!/usr/bin/env python3
"""
SSH 연결 및 명령어 실행 모듈
"""

import paramiko
import time
import re
from typing import Dict, Optional

class SSHChecker:
    def __init__(self):
        self.client = None
        self.shell = None
        self.is_connected = False
        self.connection_timeout = 30
        self.command_timeout = 10
    
    def connect(self, host: str, username: str, password: str) -> Dict:
        """SSH 연결"""
        try:
            self.client = paramiko.SSHClient()
            self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            # SSH 연결
            self.client.connect(
                hostname=host,
                username=username,
                password=password,
                timeout=self.connection_timeout,
                allow_agent=False,
                look_for_keys=False
            )
            
            # Shell 채널 생성
            self.shell = self.client.invoke_shell()
            time.sleep(1)  # 초기 프롬프트 대기
            
            # 초기 출력 읽기 (환영 메시지 등)
            self._read_until_prompt()
            
            self.is_connected = True
            
            return {
                'success': True,
                'message': f'{host}에 성공적으로 연결됨'
            }
            
        except paramiko.AuthenticationException:
            return {
                'success': False,
                'message': '인증 실패: 사용자명 또는 비밀번호를 확인하세요'
            }
        except paramiko.SSHException as e:
            return {
                'success': False,
                'message': f'SSH 연결 오류: {str(e)}'
            }
        except Exception as e:
            return {
                'success': False,
                'message': f'연결 실패: {str(e)}'
            }
    
    def test_connection(self) -> Dict:
        """연결 테스트"""
        if not self.is_connected:
            return {
                'success': False,
                'message': 'SSH 연결이 되어 있지 않음'
            }
        
        try:
            # 간단한 명령어로 연결 테스트
            result = self.execute_command("show system info | head -5")
            if result['success']:
                return {
                    'success': True,
                    'message': 'SSH 연결 정상'
                }
            else:
                return {
                    'success': False,
                    'message': f'연결 테스트 실패: {result["message"]}'
                }
        except Exception as e:
            return {
                'success': False,
                'message': f'연결 테스트 오류: {str(e)}'
            }
    
    def execute_command(self, command: str) -> Dict:
        """명령어 실행"""
        if not self.is_connected or not self.shell:
            return {
                'success': False,
                'message': 'SSH 연결이 되어 있지 않음',
                'output': ''
            }
        
        try:
            # 명령어 전송
            self.shell.send(command + '\n')
            time.sleep(1)  # 명령어 실행 대기
            
            # 출력 읽기
            output = self._read_until_prompt()
            
            # 명령어 에코 제거
            lines = output.split('\n')
            if lines and command.strip() in lines[0]:
                lines = lines[1:]  # 첫 번째 줄(명령어 에코) 제거
            
            # 마지막 프롬프트 라인 제거
            if lines and self._is_prompt_line(lines[-1]):
                lines = lines[:-1]
            
            clean_output = '\n'.join(lines).strip()
            
            return {
                'success': True,
                'message': '명령어 실행 성공',
                'output': clean_output
            }
            
        except Exception as e:
            return {
                'success': False,
                'message': f'명령어 실행 실패: {str(e)}',
                'output': ''
            }
    
    def _read_until_prompt(self) -> str:
        """프롬프트가 나올 때까지 출력 읽기"""
        output = ""
        start_time = time.time()
        
        while time.time() - start_time < self.command_timeout:
            if self.shell.recv_ready():
                chunk = self.shell.recv(4096).decode('utf-8', errors='ignore')
                output += chunk
                
                # 프롬프트 감지 (마지막 라인이 프롬프트인지 확인)
                lines = output.split('\n')
                if lines and self._is_prompt_line(lines[-1]):
                    break
            else:
                time.sleep(0.1)
        
        return output
    
    def _is_prompt_line(self, line: str) -> bool:
        """프롬프트 라인인지 확인"""
        line = line.strip()
        # Palo Alto 장비의 일반적인 프롬프트 패턴
        prompt_patterns = [
            r'.*[>#$]\s*$',  # 일반적인 프롬프트 (>, #, $ 로 끝남)
            r'.*@.*[>#$]\s*$',  # 사용자@호스트 형태
            r'.+>\s*$',  # > 로 끝나는 프롬프트
            r'.+#\s*$',  # # 로 끝나는 프롬프트
        ]
        
        for pattern in prompt_patterns:
            if re.match(pattern, line):
                return True
        return False
    
    def disconnect(self):
        """SSH 연결 종료"""
        try:
            if self.shell:
                self.shell.close()
                self.shell = None
            
            if self.client:
                self.client.close()
                self.client = None
            
            self.is_connected = False
            
        except Exception:
            pass  # 연결 종료 시 오류 무시
    
    def __del__(self):
        """객체 소멸자 - 연결 정리"""
        self.disconnect()

class ParameterChecker:
    def __init__(self):
        self.ssh = SSHChecker()
        self.command_cache = {}  # 명령어 실행 결과 캐시
    
    def connect_to_device(self, host: str, username: str, password: str) -> Dict:
        """장비에 연결"""
        self.command_cache.clear()  # 새 연결 시 캐시 초기화
        return self.ssh.connect(host, username, password)
    
    def _execute_command_with_cache(self, command: str) -> Dict:
        """캐시를 활용한 명령어 실행"""
        if command in self.command_cache:
            return self.command_cache[command]
        
        result = self.ssh.execute_command(command)
        self.command_cache[command] = result
        return result
    
    def check_parameters(self, parameters: list) -> Dict:
        """매개변수들 점검 (명령어 캐싱 적용)"""
        if not self.ssh.is_connected:
            return {
                'success': False,
                'message': 'SSH 연결이 되어 있지 않음',
                'results': []
            }
        
        results = []
        summary = {'total': len(parameters), 'pass': 0, 'fail': 0, 'error': 0}
        
        # 1. 명령어별로 파라미터 그룹화
        command_groups = {}
        for param in parameters:
            command = param['command']
            if command not in command_groups:
                command_groups[command] = []
            command_groups[command].append(param)
        
        # 2. 각 명령어 그룹 처리
        for command, param_group in command_groups.items():
            # 명령어 한 번만 실행
            cmd_result = self._execute_command_with_cache(command)
            
            if not cmd_result['success']:
                # 명령어 실행 실패 시 그룹의 모든 파라미터를 에러로 처리
                for param in param_group:
                    result = {
                        'parameter': param['name'],
                        'expected': param['expected_value'],
                        'current': 'ERROR',
                        'status': 'ERROR',
                        'query_method': command,
                        'modify_method': param['modify_command'],
                        'error': cmd_result['message']
                    }
                    results.append(result)
                    summary['error'] += 1
            else:
                # 명령어 실행 성공 시 각 파라미터별로 패턴 매칭
                output = cmd_result['output']
                for param in param_group:
                    try:
                        current_value = self._parse_output(output, param['pattern'])
                        
                        if current_value is None:
                            result = {
                                'parameter': param['name'],
                                'expected': param['expected_value'],
                                'current': 'PARSE_ERROR',
                                'status': 'ERROR',
                                'query_method': command,
                                'modify_method': param['modify_command'],
                                'error': '출력 파싱 실패'
                            }
                            summary['error'] += 1
                        else:
                            status = 'PASS' if self._compare_values(param['expected_value'], current_value) else 'FAIL'
                            result = {
                                'parameter': param['name'],
                                'expected': param['expected_value'],
                                'current': current_value,
                                'status': status,
                                'query_method': command,
                                'modify_method': param['modify_command']
                            }
                            summary['pass' if status == 'PASS' else 'fail'] += 1
                        
                        results.append(result)
                        
                    except Exception as e:
                        result = {
                            'parameter': param['name'],
                            'expected': param['expected_value'],
                            'current': 'ERROR',
                            'status': 'ERROR',
                            'query_method': command,
                            'modify_method': param['modify_command'],
                            'error': f'점검 중 오류: {str(e)}'
                        }
                        results.append(result)
                        summary['error'] += 1
        
        return {
            'success': True,
            'results': results,
            'summary': summary
        }
    
    def _parse_output(self, output: str, pattern: str) -> Optional[str]:
        """정규식으로 출력에서 값 추출 (다중 매칭 지원)"""
        try:
            import re
            
            # 모든 매칭 찾기
            matches = re.findall(pattern, output, re.MULTILINE | re.IGNORECASE)
            
            if not matches:
                return None
            
            if len(matches) == 1:
                # 단일 매칭: 기존 방식
                return matches[0].strip()
            else:
                # 다중 매칭: 모든 값이 같은지 확인
                unique_values = list(set(match.strip() for match in matches))
                
                if len(unique_values) == 1:
                    # 모든 값이 동일: "ALL_SAME(3x true)" 형태로 반환
                    return f"ALL_SAME({len(matches)}x {unique_values[0]})"
                else:
                    # 값이 다름: "MIXED(true,false,true)" 형태로 반환
                    return f"MIXED({','.join(matches)})"
            
        except Exception:
            return None
    
    def _compare_values(self, expected: str, current: str) -> bool:
        """기대값과 현재값 비교 (다중 매칭 지원)"""
        if not current:
            return False
        
        # 대소문자 무시하고 공백 제거
        expected_clean = expected.strip().lower()
        current_clean = current.strip().lower()
        
        # 다중 매칭 결과 처리
        if current_clean.startswith('all_same('):
            # "ALL_SAME(3x true)" 형태에서 실제 값 추출
            import re
            match = re.search(r'all_same\(\d+x\s*(.+)\)', current_clean)
            if match:
                actual_value = match.group(1).strip()
                return expected_clean == actual_value
            return False
        
        elif current_clean.startswith('mixed('):
            # "MIXED(true,false,true)" 형태는 항상 실패
            return False
        
        else:
            # 일반적인 단일 값 비교
            return expected_clean == current_clean
    
    def disconnect(self):
        """연결 종료"""
        self.ssh.disconnect()