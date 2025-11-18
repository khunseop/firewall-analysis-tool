# Palo Alto Parameter Checker PRD (Product Requirements Document)

## 📋 프로젝트 개요

### 목적
Palo Alto Networks 장비의 보안 매개변수를 SSH를 통해 점검하고 결과를 리포트로 제공하는 웹 애플리케이션

### 배경
- 기존 API 방식은 일부 명령어 미지원
- 폐쇄망 환경에서 사용 필요
- 복잡한 설정 없이 바로 사용 가능해야 함

## 🎯 핵심 기능

### 1. SSH 연결
- IP, 사용자ID, 비밀번호 입력
- SSH 연결 테스트 및 상태 표시

### 2. 매개변수 관리
- 앱 내에서 매개변수 직접 추가/수정/삭제
- 매개변수 설정 내보내기/가져오기 (JSON)
- 기본 매개변수 템플릿 제공

### 3. 매개변수 점검
- 등록된 명령어들을 순차 실행
- SSH 출력 결과 파싱
- 기대값과 현재값 비교

### 4. 결과 표시 및 저장
- 실시간 점검 결과 테이블 표시
- Excel 리포트 생성
- 결과 다운로드 기능

## 🖥️ UI 구성

### 메인 화면 (탭 구성)

```
┌─────────────────────────────────────────────────────────┐
│                Palo Alto Parameter Checker              │
├─────────────────────────────────────────────────────────┤
│ [점검] [매개변수 관리] [설정]                              │
├─────────────────────────────────────────────────────────┤
│ 연결 정보                                                │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│ │   IP    │ │   ID    │ │   PW    │ │ 점검시작 │        │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘        │
├─────────────────────────────────────────────────────────┤
│ 점검 결과                                 ┌─────────┐    │
│ ┌─────────────────────────────────────────┐ │결과저장 │    │
│ │ 파라미터 │기대값│현재값│상태│조회방법│변경방법│ └─────────┘    │
│ ├─────────────────────────────────────────┤             │
│ │ ctd_mode │disabled│enabled│FAIL│show...│set...│             │
│ │ rematch  │yes     │yes    │PASS│show...│set...│             │
│ │ timeout  │60      │30     │FAIL│show...│set...│             │
│ └─────────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────┘
```

### 매개변수 관리 탭

```
┌─────────────────────────────────────────────────────────┐
│ 매개변수 관리                                            │
├─────────────────────────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│ │파라미터추가│ │ 내보내기 │ │ 가져오기 │ │ 초기화  │        │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘        │
├─────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 이름 │ 설명     │ 기대값 │ 명령어        │ 패턴  │수정│삭제││
│ ├─────────────────────────────────────────────────────┤ │
│ │ctd_mode│CTD모드  │disabled│show system...│CTD.* │[수정][삭제]││
│ │rematch │재매칭   │yes     │show running..│rem.* │[수정][삭제]││
│ │timeout │타임아웃 │60      │show system...│tim.* │[수정][삭제]││
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## 🔧 기술 사양

### 기술 스택
- **백엔드**: Flask (Python)
- **프론트엔드**: HTML + Bootstrap + Vanilla JavaScript
- **SSH 라이브러리**: Paramiko
- **데이터 저장**: 로컬 JSON 파일
- **데이터베이스**: SQLite (매개변수 저장)

### 파일 구조
```
paloalto_parameter_checker/
├── app.py                  # Flask 메인 앱
├── ssh_checker.py          # SSH 연결 및 명령어 실행
├── parser.py               # 출력 파싱 로직
├── report.py               # 리포트 생성
├── parameter_manager.py    # 매개변수 관리 (CRUD)
├── database.py             # SQLite 데이터베이스 관리
├── templates/
│   └── index.html         # 메인 UI (탭 구조)
├── static/
│   ├── bootstrap.min.css  # 스타일
│   └── app.js            # JavaScript
├── data/
│   ├── parameters.db      # SQLite 데이터베이스
│   └── default_params.json # 기본 매개변수 템플릿
└── reports/               # 생성된 리포트
```

## 📊 데이터 구조

### SQLite 데이터베이스 (parameters.db)
```sql
CREATE TABLE parameters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL,
    expected_value TEXT NOT NULL,
    command TEXT NOT NULL,
    modify_command TEXT NOT NULL,
    pattern TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 기본 매개변수 템플릿 (default_params.json)
```json
[
  {
    "name": "ctd_mode",
    "description": "Content-ID 확인 모드",
    "expected_value": "disabled",
    "command": "show system setting ctd mode",
    "modify_command": "set system setting ctd-mode disabled",
    "pattern": "CTD mode is: (\\w+)"
  },
  {
    "name": "session_timeout",
    "description": "세션 타임아웃",
    "expected_value": "60", 
    "command": "show system setting session timeout",
    "modify_command": "set system setting session timeout 60",
    "pattern": "timeout: (\\d+)"
  }
]
```

### 내보내기/가져오기 형식 (JSON)
```json
{
  "version": "1.0",
  "exported_at": "2024-01-01T12:00:00Z",
  "parameters": [
    {
      "name": "ctd_mode",
      "description": "Content-ID 확인 모드",
      "expected_value": "disabled",
      "command": "show system setting ctd mode", 
      "modify_command": "set system setting ctd-mode disabled",
      "pattern": "CTD mode is: (\\w+)"
    }
  ]
}
```

### 점검 결과 데이터
```json
{
  "parameter": "ctd_mode",
  "expected": "disabled", 
  "current": "enabled",
  "status": "FAIL",
  "query_method": "show system setting ctd mode",
  "modify_method": "set system setting ctd-mode disabled"
}
```

## 🔄 프로세스 플로우

### 1. 사용자 입력
```
사용자 → IP/ID/PW 입력 → 점검시작 버튼 클릭
```

### 2. SSH 연결 및 점검
```
Flask → SSH 연결 → 명령어 실행 → 출력 파싱 → 결과 비교
```

### 3. 결과 표시
```
결과 데이터 → JSON 응답 → JavaScript → 테이블 업데이트
```

## 🎯 상세 요구사항

### SSH 처리
- **연결 타임아웃**: 30초
- **명령어 타임아웃**: 10초
- **프롬프트 감지**: `>` 또는 `#` 문자로 명령어 완료 판단
- **에러 처리**: 연결 실패, 인증 실패, 명령어 실패 시 적절한 메시지

### 출력 파싱
- **정규식 기반**: 각 매개변수별 패턴 정의
- **공백 제거**: 출력값의 앞뒤 공백 제거
- **대소문자 무시**: 비교 시 대소문자 구분 안함
- **SSH 특성 고려**: 프롬프트, 에코, 제어 문자 제거

### 상태 판정
- **PASS**: 기대값 = 현재값
- **FAIL**: 기대값 ≠ 현재값  
- **ERROR**: 명령어 실행 실패 또는 파싱 실패

### UI 동작
- **실시간 업데이트**: 점검 진행 상황 표시
- **상태 색상**: PASS(녹색), FAIL(빨간색), ERROR(주황색)
- **로딩 표시**: 점검 중 스피너 표시
- **결과 다운로드**: HTML, CSV 형식 지원

## 📝 API 설계

### 엔드포인트
```
# 점검 관련
POST /api/check          # 매개변수 점검 실행
GET  /api/download/html  # HTML 리포트 다운로드  
GET  /api/download/csv   # CSV 리포트 다운로드

# 매개변수 관리
GET    /api/parameters           # 매개변수 목록 조회
POST   /api/parameters           # 새 매개변수 추가
PUT    /api/parameters/<id>      # 매개변수 수정
DELETE /api/parameters/<id>      # 매개변수 삭제

# 설정 관리
GET  /api/export             # 매개변수 설정 내보내기 (JSON)
POST /api/import             # 매개변수 설정 가져오기 (JSON)
POST /api/reset              # 기본 매개변수로 초기화
```

### 요청/응답 예시
```javascript
// 매개변수 추가
POST /api/parameters
{
  "name": "ctd_mode",
  "description": "Content-ID 확인 모드",
  "expected_value": "disabled",
  "command": "show system setting ctd mode",
  "modify_command": "set system setting ctd-mode disabled", 
  "pattern": "CTD mode is: (\\w+)"
}

// 점검 요청
POST /api/check
{
  "host": "192.168.1.1",
  "username": "admin", 
  "password": "password"
}

// 점검 응답
{
  "success": true,
  "results": [
    {
      "parameter": "ctd_mode",
      "expected": "disabled",
      "current": "enabled", 
      "status": "FAIL",
      "query_method": "show system setting ctd mode",
      "modify_method": "set system setting ctd-mode disabled"
    }
  ],
  "summary": {
    "total": 10,
    "pass": 7,
    "fail": 2, 
    "error": 1
  }
}

// 설정 내보내기 응답
GET /api/export
{
  "version": "1.0",
  "exported_at": "2024-01-01T12:00:00Z",
  "parameters": [...]
}
```

## 🚀 구현 우선순위

### Phase 1: 핵심 기능
1. SQLite 데이터베이스 및 기본 매개변수 설정
2. SSH 연결 및 명령어 실행
3. 기본 출력 파싱
4. 단순 결과 표시

### Phase 2: 매개변수 관리
1. 매개변수 CRUD 기능 (추가/수정/삭제)
2. 내보내기/가져오기 기능
3. 기본 템플릿 초기화 기능

### Phase 3: UI 개선
1. Bootstrap 기반 탭 구조 UI
2. 실시간 상태 업데이트
3. 로딩 상태 표시

### Phase 4: 리포트 기능
1. XLSX 리포트 생성
2. 다운로드 기능

---

이 PRD를 기반으로 **YAML 설정 없이** 앱 내에서 모든 매개변수를 관리할 수 있는 단순하고 실용적인 Palo Alto Parameter Checker를 구현합니다.
