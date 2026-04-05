# FAT (Firewall Analysis Tool) 마이그레이션 계획서

## 1. 마이그레이션 개요

본 계획은 기존 웹 기반(FastAPI + Vanilla JS)으로 동작하던 FAT 프로젝트를 **Tauri 기반의 데스크톱 애플리케이션**으로 전환하는 것을 목표로 합니다. 이를 통해 파이썬이나 외부 의존성 설치 없이 `.exe` 파일 단일 실행만으로 폐쇄망 환경에서 완벽하게 동작하도록 구성합니다.

### 1.1. 핵심 변경 사항 (AS-IS vs TO-BE)

* **프론트엔드**: Vanilla JS + Bulma (`app/frontend/`) ➔ **Vite + React + Tailwind CSS**
* **백엔드**: uvicorn 직접 실행 ➔ **PyInstaller 단일 실행 파일 (Tauri Sidecar)**
* **실행 환경**: 브라우저 접속 (http://localhost:8000) ➔ **독립된 OS 네이티브 윈도우 앱**
* **설치 방식**: Python 및 패키지 수동 설치 ➔ **설치 불필요 (Zero-Install) 또는 One-click Installer**

---

## 2. 단계별 마이그레이션 상세 계획

### 1단계: 프론트엔드 현대화 (React 기반 컴포넌트 이식)

현재 `app/frontend/js/` 하위에 분산된 로직과 `app/static/vendor/`의 외부 라이브러리를 최신 Node.js 빌드 시스템으로 통합합니다.

* **프로젝트 초기화**: 프로젝트 루트에 새로운 프론트엔드 작업 폴더 생성 (`npm create vite@latest ui -- --template react`).
* **의존성 로컬 내재화**: 폐쇄망 대응을 위해 구글 폰트(`styles/fonts/`) 및 Font Awesome 아이콘을 React 프로젝트의 `assets/`로 완전 이관.
* **UI 컴포넌트 변환**:
    * `app/frontend/templates/`의 HTML 파일들을 React JSX로 변환.
    * `app/frontend/js/components/` (navbar, impactAnalysis 등)를 React State 기반 컴포넌트로 재작성.
    * Bulma CSS를 **Tailwind CSS**로 대체하여 스타일링 고도화 (shadcn/ui 적극 활용 권장).
* **상태 관리 및 API 연동**: `app/frontend/js/api.js`를 Axios 또는 Fetch API 기반의 커스텀 훅(Custom Hook)으로 재구성하여 FastAPI와 통신.

### 2단계: 백엔드 바이너리 패키징 (PyInstaller)

현재의 `firewall_manager/` 디렉토리를 파이썬 환경 없이 실행 가능한 `.exe`로 묶습니다.

* **엔트리포인트 수정 (`main.py`)**:
    * 실행 시 `alembic upgrade head` 스크립트를 파이썬 코드 레벨에서 자동 호출하도록 수정하여 DB 마이그레이션 자동화.
    * 앱 실행 시 `fat.db`가 사용자 데이터 폴더(`%APPDATA%`) 등에 안전하게 생성 및 연결되도록 경로 동적 할당.
* **정적 파일 처리**: PyInstaller `.spec` 파일을 수정하여 `alembic/` 디렉토리와 `alembic.ini`, 초기 설정 파일들이 바이너리에 포함(Bundle)되도록 설정.
* **빌드 및 검증**: `requirements.txt` 기반으로 PyInstaller를 통해 `fat_backend.exe` 생성 후 단독 실행 및 API 응답 검증.

### 3단계: 데스크톱 래퍼 통합 (Tauri)

React 프론트엔드와 패키징된 백엔드 바이너리를 하나의 데스크톱 앱으로 결합합니다.

* **Tauri 초기화**: React 프로젝트 내에 Tauri 환경 구성 (`npm run tauri init`).
* **사이드카(Sidecar) 설정**:
    * 2단계에서 생성한 `fat_backend.exe`를 Tauri의 `src-tauri/tauri.conf.json`에 사이드카로 등록.
    * Tauri 앱(UI)이 켜질 때 백엔드 프로세스가 백그라운드에서 자동 실행되고, 앱 종료 시 함께 안전하게 종료(Graceful Shutdown)되도록 Rust 코드 작성.
* **보안 및 권한**: `tauri.conf.json`에서 로컬 파일 시스템 접근, 네트워크 통신 등 필요한 권한만 최소한으로 허용하도록 설정.

---

## 3. 예상 디렉토리 구조 (TO-BE)

마이그레이션 완료 후 프로젝트 구조는 다음과 같이 재편됩니다.

```text
.
├── backend/                  # (구 firewall_manager) 파이썬 백엔드 소스
│   ├── app/                  # FastAPI 로직 (기존 유지, frontend/static 제외)
│   ├── alembic/              # DB 마이그레이션
│   ├── main.py               # 엔트리포인트 (Alembic 자동화 로직 추가)
│   └── fat_backend.spec      # PyInstaller 빌드 설정 파일
├── frontend/                 # (신규) React UI 프로젝트
│   ├── src/                  # React 컴포넌트 및 자바스크립트 로직
│   ├── public/               # 폰트, 아이콘 등 정적 자원 (폐쇄망용)
│   └── package.json
└── src-tauri/                # (신규) 데스크톱 앱 래퍼 및 Rust 로직
    ├── src/                  # 백엔드 프로세스 제어 Rust 코드
    ├── tauri.conf.json       # 앱 설정 및 사이드카 등록
    └── binaries/             # 빌드된 fat_backend.exe 위치
```

---

## 4. 마이그레이션 실행 체크리스트

- [ ] **1. 프론트엔드 뼈대 구축**: Vite + React + Tailwind 환경 세팅.
- [ ] **2. 정적 자원 마이그레이션**: 로컬 폰트(`Pretendard` 등), 아이콘 파일 `frontend/public/`으로 이동.
- [ ] **3. UI 마이그레이션**: 기존 `.html` 및 `.js` 코드를 React 컴포넌트로 순차적 이식.
- [ ] **4. DB 마이그레이션 자동화**: `main.py`에 시작 시 Alembic 실행 로직 추가.
- [ ] **5. 백엔드 바이너리화**: PyInstaller를 이용해 파이썬 앱을 단일 `.exe`로 패키징.
- [ ] **6. Tauri 결합**: 프론트엔드에 Tauri 연동 및 백엔드 `.exe`를 사이드카로 등록.
- [ ] **7. 프로세스 생명주기 테스트**: 앱 실행/종료 시 백엔드 프로세스의 정상 동작 및 좀비 프로세스 방지 확인.
- [ ] **8. 폐쇄망 테스트**: 외부 인터넷 연결을 차단한 완전히 격리된 PC에서 앱 정상 작동 검증 (DB 생성, 장비 연동 등).