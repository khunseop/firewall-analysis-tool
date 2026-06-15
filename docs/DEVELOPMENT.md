# 개발 환경 설정 및 명령어 (Development Guide)

프로젝트 개발 환경 구성 및 주요 명령어를 설명합니다.

---

## 백엔드 개발 환경

### 1. 의존성 설치

```bash
pip install -r backend/requirements.txt
```

### 2. 데이터베이스 마이그레이션

#### 초기 마이그레이션 (새 환경)
```bash
# 프로젝트 루트에서 실행
python backend/migrate.py
```

#### 마이그레이션 명령어
```bash
# 최신 버전 적용
python backend/migrate.py

# 현재 리비전 확인
python backend/migrate.py current

# 마이그레이션 히스토리 조회
python backend/migrate.py history base:head

# 특정 리비전으로 롤백
python backend/migrate.py downgrade <revision>
```

#### 스키마 변경 워크플로우
```bash
# 1. ORM 모델 수정 (backend/app/models/)
# 2. Pydantic 스키마 동기화 (backend/app/schemas/)

# 3. Alembic 마이그레이션 생성
cd backend
alembic revision --autogenerate -m "설명"
cd ..

# 4. 생성된 마이그레이션 파일 검토
# (backend/alembic/versions/ 폴더)

# 5. 마이그레이션 적용
python backend/migrate.py

# 6. DATABASE.md 업데이트
```

### 3. 서버 실행

```bash
# ⚠️ 반드시 프로젝트 루트에서 실행
uvicorn app.main:app --reload --app-dir backend
```

**주의사항**:
- `backend/` 디렉토리 내부에서 실행하면 안 됩니다
- `--reload` 플래그는 개발 시에만 사용 (파일 변경 시 자동 재시작)
- API 문서: `http://localhost:8000/docs` (Swagger)
- ReDoc: `http://localhost:8000/redoc`

### 4. 테스트 실행

```bash
# 기본 테스트
python backend/smoke_test.py

# 특정 장비 재인덱싱
python backend/reindex_device.py <device_id>
```

---

## 프론트엔드 개발 환경

### 1. 의존성 설치

```bash
cd frontend
npm install
```

### 2. 개발 서버 실행

```bash
cd frontend
npm run dev
```

**기본 주소**: `http://localhost:5173`

개발 서버는 Vite를 사용하며, 파일 변경 시 HMR(Hot Module Replacement)로 자동 새로고침됩니다.

#### Vite 프록시 설정
백엔드 API 요청(`/api/v1/*`)은 `localhost:8000`으로 자동 프록시됩니다.
(설정: `frontend/vite.config.ts`)

### 3. 프로덕션 빌드

```bash
cd frontend
npm run build
```

**결과**: `frontend/dist/` 디렉토리 생성
- `index.html`: React SPA 진입점
- `assets/`: 번들된 JavaScript/CSS
- `fonts/`: 폰트 파일
- `icons.svg`: 아이콘 시트

### 4. 빌드 결과물 확인

```bash
cd frontend
npm run preview
```

**주소**: `http://localhost:4173`

### 5. 린트 검사

```bash
cd frontend
npm run lint
```

---

## 프로덕션 빌드 및 배포

### 통합 빌드 (Frontend + Backend)

#### Step 1: 프론트엔드 빌드
```bash
cd frontend
npm run build
cd ..
```

`frontend/dist/` 가 생성됩니다.

#### Step 2: 백엔드 서버 시작
```bash
uvicorn app.main:app --app-dir backend
```

**동작**:
- FastAPI가 `frontend/dist/`의 정적 파일을 `/assets`, `/fonts` 경로로 마운트
- SPA 경로(`/`, `/devices`, `/policies` 등)에 `index.html` 반환
- API 요청은 `/api/v1/*` 라우터로 처리

**주소**: `http://localhost:8000`

### 배포 체크리스트

- [ ] 프론트엔드: `npm run build` 성공
- [ ] 백엔드: `python backend/migrate.py` 적용
- [ ] 환경 변수 설정 (`.env` 파일)
- [ ] DB 백업
- [ ] uvicorn 실행 위치 확인 (프로젝트 루트)

---

## 개발 팁

### 토큰 관리 (로그인 상태)
- 프론트엔드: Zustand `useAuthStore`에서 JWT 토큰을 localStorage + cookie 이중 저장
- 백엔드: `AuthMiddleware`가 쿠키의 `access_token` 검증
- 인증 실패 시 자동으로 `/login` 리다이렉트

### 실시간 업데이트 (WebSocket)
- 동기화/분석 진행 상황: `useSyncStatusWebSocket` 훅
- 연결 끊김 시 5초 후 자동 재연결

### DB 백업
```bash
# SQLite 백업
cp backend/fat.db backend/fat.db.backup
```

### 환경 변수
프로젝트 루트에 `.env` 파일 생성:
```bash
# 필요시 추가
DATABASE_URL=sqlite:///backend/fat.db
SECRET_KEY=your-secret-key-here
```
