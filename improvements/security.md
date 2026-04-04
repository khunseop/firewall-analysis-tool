# 보안 개선사항

---

## 심각도: 높음

### 1. 인증/접근제어 미구현 ✅ 완료 (2026-04-04)
- **문제**: 현재 웹 UI 및 모든 API 엔드포인트가 인증 없이 누구나 접근 가능. 내부망이라도 비인가 접근 위험 존재
- **구현 내용:**
  - `requirements.txt`: `python-jose[cryptography]`, `passlib[bcrypt]` 추가
  - `app/models/user.py`: `users` 테이블 ORM 모델 (id, username, hashed_password, is_active, is_admin, created_at, last_login_at)
  - `alembic/versions/n8o9p0q1r2s3_add_users_table.py`: DB 마이그레이션
  - `app/core/auth.py`: JWT 발급/검증, bcrypt 비밀번호 해시, `get_current_user` 의존성
  - `app/core/config.py`: `JWT_SECRET_KEY` (자동 생성), `JWT_ALGORITHM`, `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` (480분) 추가
  - `app/api/api_v1/endpoints/auth.py`: `POST /api/v1/auth/login`, `GET /api/v1/auth/me`
  - `app/api/api_v1/api.py`: 모든 `/api/v1/*` 라우터에 `get_current_user` 의존성 적용 (auth 엔드포인트 제외)
  - `app/main.py`: `AuthMiddleware` — 쿠키 기반 토큰 검증, 미인증 시 `/login` 리다이렉트
  - `app/frontend/login.html`: 로그인 페이지 (Bulma 스타일)
  - `app/frontend/js/api.js`: 모든 요청에 `Authorization: Bearer` 헤더 자동 추가, 401 시 로그아웃/리다이렉트
  - `app/frontend/js/main.js`: 페이지 진입 시 토큰 존재 여부 확인, 로그아웃 버튼 연결
  - `app/frontend/index.html`: 네비게이션 바에 로그아웃 버튼 추가
  - `app/api/api_v1/endpoints/websocket.py`: WebSocket은 헤더 인증 불가 → query param `?token=` 방식으로 별도 처리
  - `create_admin.py`: 초기 관리자 계정 생성 스크립트

- **초기 설정:**
  ```bash
  python3 firewall_manager/migrate.py          # users 테이블 생성
  python3 firewall_manager/create_admin.py     # 관리자 계정 생성
  ```

### 2. `.env` 파일 권한 미검증 ✅ 완료 (2026-04-04)
- **위치**: `app/core/config.py`
- **구현 내용**: `.env` 파일 생성/갱신 시 `os.chmod(ENV_PATH, 0o600)` 적용. 서버 시작 시 world-readable 권한이면 경고 로그 출력

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
