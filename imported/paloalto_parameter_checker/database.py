#!/usr/bin/env python3
"""
SQLite 데이터베이스 관리 모듈
"""

import sqlite3
import json
import os
from datetime import datetime
from typing import List, Dict, Optional

class DatabaseManager:
    def __init__(self, db_path: str = "data/parameters.db"):
        self.db_path = db_path
        self.init_database()
    
    def init_database(self):
        """데이터베이스 초기화"""
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS parameters (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL,
                    description TEXT NOT NULL,
                    expected_value TEXT NOT NULL,
                    command TEXT NOT NULL,
                    modify_command TEXT NOT NULL,
                    pattern TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.commit()
    
    def get_connection(self):
        """데이터베이스 연결 반환"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row  # dict-like access
        return conn
    
    def get_all_parameters(self) -> List[Dict]:
        """모든 매개변수 조회"""
        with self.get_connection() as conn:
            cursor = conn.execute("""
                SELECT * FROM parameters ORDER BY name
            """)
            return [dict(row) for row in cursor.fetchall()]
    
    def get_parameter_by_id(self, param_id: int) -> Optional[Dict]:
        """ID로 매개변수 조회"""
        with self.get_connection() as conn:
            cursor = conn.execute("""
                SELECT * FROM parameters WHERE id = ?
            """, (param_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
    
    def add_parameter(self, name: str, description: str, expected_value: str, 
                     command: str, modify_command: str, pattern: str) -> int:
        """새 매개변수 추가"""
        with self.get_connection() as conn:
            cursor = conn.execute("""
                INSERT INTO parameters 
                (name, description, expected_value, command, modify_command, pattern)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (name, description, expected_value, command, modify_command, pattern))
            conn.commit()
            return cursor.lastrowid
    
    def update_parameter(self, param_id: int, name: str, description: str, 
                        expected_value: str, command: str, modify_command: str, 
                        pattern: str) -> bool:
        """매개변수 수정"""
        with self.get_connection() as conn:
            cursor = conn.execute("""
                UPDATE parameters SET 
                    name = ?, description = ?, expected_value = ?, 
                    command = ?, modify_command = ?, pattern = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (name, description, expected_value, command, modify_command, pattern, param_id))
            conn.commit()
            return cursor.rowcount > 0
    
    def delete_parameter(self, param_id: int) -> bool:
        """매개변수 삭제"""
        with self.get_connection() as conn:
            cursor = conn.execute("DELETE FROM parameters WHERE id = ?", (param_id,))
            conn.commit()
            return cursor.rowcount > 0
    
    def clear_all_parameters(self):
        """모든 매개변수 삭제"""
        with self.get_connection() as conn:
            conn.execute("DELETE FROM parameters")
            conn.commit()
    
    def import_parameters(self, parameters: List[Dict]):
        """매개변수 가져오기"""
        with self.get_connection() as conn:
            for param in parameters:
                # 기존 매개변수 확인
                cursor = conn.execute("SELECT id FROM parameters WHERE name = ?", (param['name'],))
                existing = cursor.fetchone()
                
                if existing:
                    # 기존 매개변수 업데이트
                    conn.execute("""
                        UPDATE parameters SET 
                            description = ?, expected_value = ?, command = ?,
                            modify_command = ?, pattern = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE name = ?
                    """, (param['description'], param['expected_value'], param['command'],
                          param['modify_command'], param['pattern'], param['name']))
                else:
                    # 새 매개변수 추가
                    conn.execute("""
                        INSERT INTO parameters 
                        (name, description, expected_value, command, modify_command, pattern)
                        VALUES (?, ?, ?, ?, ?, ?)
                    """, (param['name'], param['description'], param['expected_value'],
                          param['command'], param['modify_command'], param['pattern']))
            conn.commit()
    
    def export_parameters(self) -> Dict:
        """매개변수 내보내기"""
        parameters = self.get_all_parameters()
        # 내보내기용 데이터 정리 (id, timestamp 제거)
        clean_params = []
        for param in parameters:
            clean_params.append({
                'name': param['name'],
                'description': param['description'],
                'expected_value': param['expected_value'],
                'command': param['command'],
                'modify_command': param['modify_command'],
                'pattern': param['pattern']
            })
        
        return {
            'version': '1.0',
            'exported_at': datetime.now().isoformat(),
            'parameters': clean_params
        }