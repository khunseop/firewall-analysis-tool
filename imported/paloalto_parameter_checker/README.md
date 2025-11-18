# Palo Alto Parameter Checker v2.0

SSH 기반 Palo Alto Networks 보안 매개변수 점검 시스템

## 개요

기존 API 기반 방식에서 SSH 연결을 통한 명령어 실행 방식으로 전환하여 API가 지원하지 않는 명령어들도 점검할 수 있도록 개선된 시스템입니다.

## 주요 기능

- **SSH 연결 기반**: Paramiko를 사용한 안전한 SSH 연결
- **유연한 매개변수 설정**: YAML 기반 설정으로 쉬운 관리
- **다중 결과 처리**: 구분자 옵션과 다중 결과 지원
- **현대적인 웹 UI**: Vue.js 기반 SPA 인터페이스
- **리포트 형식**: Excel 형식 지원
- **실시간 상태 표시**: 연결 상태 및 점검 진행 상황 표시

## 기술 스택

### 백엔드
- **Flask**: 웹 프레임워크
- **Paramiko**: SSH 클라이언트
- **PyYAML**: 설정 파일 파싱
- **openpyxl**: Excel 파일 생성

### 프론트엔드
- **Vue.js 3**: SPA 프레임워크
- **Axios**: HTTP 클라이언트
- **Font Awesome**: 아이콘
- **CSS Grid/Flexbox**: 반응형 레이아웃

## 설치 및 실행

### 1. 의존성 설치

```bash
cd fpat/paloalto_parameter_checker
pip install -r requirements.txt
```

### 2. 애플리케이션 실행

```bash
python app.py
```

### 3. 웹 브라우저 접속

```
http://localhost:5000
```

## 설정 파일 구조

### parameters.yaml

```yaml
parameters:
  - name: "ctd_mode"
    description: "Content-ID 확인 모드 설정"
    expected_value: "disabled"
    query_command: "show system setting ctd mode"
    modify_command: "set system setting ctd-mode disabled"
    match_pattern: "CTD mode is: (\\S+)"
    match_group: 1
    separator: null
    multi_result: false
    result_type: "single"

ssh_config:
  default_timeout: 30
  connection_retry: 3
  command_timeout: 10
  prompt_pattern: "\\S+[>#]\\s*$"
  enable_logging: true

report_config:
  title: "Palo Alto Networks 보안 매개변수 점검 보고서"
  # ... 기타 설정
```

### 매개변수 설정 필드

- **name**: 매개변수 고유 이름
- **description**: 매개변수 설명
- **expected_value**: 기대값 (문자열 또는 리스트)
- **query_command**: SSH로 실행할 조회 명령어
- **modify_command**: 설정 변경 명령어
- **match_pattern**: 출력에서 값을 추출할 정규식 패턴
- **match_group**: 정규식 그룹 번호 (기본: 1)
- **separator**: 다중 값을 분할할 구분자
- **multi_result**: 다중 결과 여부
- **result_type**: 결과 타입 ("single" 또는 "list")

## 사용 방법

### 1. SSH 연결 설정
- 호스트 IP 주소 입력
- 사용자명 입력
- 비밀번호 입력
- 포트 번호 입력 (기본: 22)

### 2. 매개변수 선택
- 점검할 매개변수를 선택
- 전체 선택/해제 기능 활용

### 3. 점검 실행
- 선택된 매개변수에 대해 점검 실행
- 실시간 진행 상황 표시

### 4. 결과 확인
- 항목별 점검 결과 확인
- 상태별 통계 확인
- 상세 정보 및 명령어 확인

### 5. 리포트 생성
- Excel: 스프레드시트 형식의 상세 리포트 (셀 서식 및 차트 포함)

## API 엔드포인트

### 연결 관리
- `POST /api/connect`: SSH 연결 설정
- `GET /api/health`: 서비스 상태 확인

### 매개변수 관리
- `GET /api/parameters`: 사용 가능한 매개변수 목록 조회
- `POST /api/check`: 선택된 매개변수 점검 실행

### 리포트 관리
- `GET /api/download/excel`: Excel 리포트 다운로드

## 파일 구조

```
fpat/paloalto_parameter_checker/
├── app.py                 # Flask 메인 애플리케이션
├── ssh_connector.py       # SSH 연결 관리
├── parameter_checker.py   # 매개변수 점검 로직
├── report_generator.py    # 리포트 생성
├── parameters.yaml        # 매개변수 설정
├── requirements.txt       # Python 의존성
├── __init__.py           # 모듈 초기화
├── templates/
│   └── index.html        # SPA 프론트엔드
├── static/               # 정적 파일
├── reports/              # 생성된 리포트
└── README.md            # 이 파일
```

## 주요 개선사항

### v1.x에서 v2.0으로

1. **API → SSH 전환**
   - 더 많은 명령어 지원
   - API 제한사항 해결

2. **설정 구조 개선**
   - 구분자 옵션 추가
   - 다중 결과 처리
   - 정규식 패턴 지원

3. **UI/UX 개선**
   - Vue.js 기반 SPA
   - 반응형 디자인
   - 실시간 상태 표시

4. **리포트 기능 강화**
   - Excel 형식의 전문적인 리포트
   - 상세 통계 및 차트
   - 셀 서식 및 스타일링

## 문제 해결

### 연결 오류
- 네트워크 연결 확인
- 인증 정보 확인
- 방화벽 설정 확인

### 명령어 실행 오류
- 권한 확인
- 명령어 문법 확인
- 디바이스 버전 호환성 확인

### 정규식 매칭 오류
- 실제 출력과 패턴 비교
- 정규식 문법 확인
- 그룹 번호 확인

## 보안 고려사항

- SSH 연결은 암호화됨
- 비밀번호는 메모리에만 저장
- 세션 기반 연결 관리
- 입력 검증 수행

## 라이센스

FPAT 내부 사용

## 버전 히스토리

- **v2.0.0**: SSH 기반 전환, SPA UI, 다중 결과 지원
- **v1.x**: API 기반 버전 (백업됨)

## 기여

FPAT 팀 내부 프로젝트

## 지원

FPAT 팀에 문의