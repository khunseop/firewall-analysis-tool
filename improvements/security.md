# 보안 개선사항

---

## 심각도: 높음

### 1. 인증/접근제어 미구현 (최우선)
- **문제**: 현재 웹 UI 및 모든 API 엔드포인트가 인증 없이 누구나 접근 가능. 내부망이라도 비인가 접근 위험 존재
- **추천 구현: `fastapi-users[sqlalchemy]`**
  - 폐쇄망 pip install 후 오프라인 사용 가능
  - 이미 사용 중인 SQLAlchemy + SQLite와 완전 호환
  - JWT 토큰 기반 인증, bcrypt 비밀번호 해시 내장
  - 의존 패키지: python-jose, passlib, bcrypt 포함
  - `requirements.txt`에 `fastapi-users[sqlalchemy]` 추가

- **구현 범위 (최소):**
  1. `users` 테이블 추가 (Alembic 마이그레이션)
  2. 로그인 페이지 `/login` 구현 (프론트엔드 HTML + JS)
  3. JWT 발급 엔드포인트 (`/api/v1/auth/jwt/login`)
  4. 모든 `/api/v1/*` 라우터에 `current_active_user` 의존성 추가
  5. 정적 파일(`/app`) 접근 시 토큰 검증 미들웨어 추가
  6. 초기 관리자 계정 생성 스크립트 (`create_admin.py`)
  7. 프론트엔드: 토큰 localStorage 저장, 401 응답 시 `/login` 리다이렉트
  8. 로그아웃 처리 (토큰 삭제)

- **설정 방식**: 초기 관리자 비밀번호를 `.env`에 해시 형태로 저장하거나 최초 실행 시 설정 스크립트 실행

### 2. `.env` 파일 권한 미검증
- **위치**: `app/core/config.py:42`
- **문제**: Fernet 암호화 키가 포함된 `.env` 파일 생성 시 파일 권한 설정 없음. 기본 644(world-readable) 권한으로 생성될 수 있음
- **개선**: 파일 생성 후 `os.chmod('.env', 0o600)` 적용, 권한 확인 시작 시 경고 로그 출력

---

## 심각도: 중간

### 3. Excel 업로드 MIME 타입 미검증
- **위치**: `app/api/api_v1/endpoints/devices.py:208`
- **문제**: 파일 확장자(`.xlsx`)만 체크, MIME 타입 미검증. 악성 파일 업로드 가능
- **개선**: `python-magic` 또는 `openpyxl` 로드 try-catch로 유효성 검증
  ```python
  # 현재
  if not filename.endswith('.xlsx'):
  
  # 개선
  try:
      wb = openpyxl.load_workbook(file_content)
  except Exception:
      raise HTTPException(400, "유효하지 않은 Excel 파일입니다")
  ```

### 4. 분석 엔드포인트 Rate Limiting 없음
- **위치**: `app/api/api_v1/endpoints/analysis.py:20-218`
- **문제**: 분석 요청을 제한 없이 반복 제출 가능. 현재 실행 중 태스크 존재 여부만 체크하므로 다른 디바이스로 대량 요청 가능
- **개선**: `slowapi` 라이브러리 (폐쇄망 pip 설치 가능) 또는 간단한 인메모리 카운터로 분당 요청 수 제한

---

## 심각도: 낮음

### 5. 감사 로그(Audit Log) 없음
- **위치**: `app/crud/crud_device.py`, `app/api/api_v1/endpoints/export.py`
- **문제**: 자격증명 접근, 데이터 내보내기, 장비 삭제 등 민감한 작업에 대한 로그 없음
- **개선**: 인증 구현 후 사용자 ID + 작업 + 타임스탬프를 `audit_logs` 테이블에 기록
