# 개선사항 목록

코드베이스 분석 및 웹 UI 직접 확인(2026-04-04) 기준

## 파일 목록

| 파일 | 내용 | 항목 수 |
|------|------|---------|
| [ui_ux.md](ui_ux.md) | UI/UX 개선 — 모바일 반응형, 테이블, 툴팁, 색상 안내 등 | 11개 |
| [security.md](security.md) | 보안 — **인증/접근제어 미구현**, .env 권한, MIME 검증 등 | 5개 |
| [performance.md](performance.md) | 성능 — 정책 검색 쿼리, Excel 크기 제한, Eager loading | 5개 |
| [code_quality.md](code_quality.md) | 코드 품질 — 예외 처리, 빈 catch, 세션 전달, 매직 넘버 | 7개 |
| [architecture.md](architecture.md) | 아키텍처 — WebSocket 폴백, 태스크 큐, 감사 로그, SQLite | 6개 |

## 우선순위 요약

### 즉시 처리 권장
1. **인증/접근제어 구현** (`security.md`) — `fastapi-users[sqlalchemy]` 사용, 현재 인증 없음
2. **설정 탭 버그** (`ui_ux.md`) — "일반 설정" 탭 내용 미표시
3. **백그라운드 태스크 DB 세션 전달** (`code_quality.md`) — 세션 수명 불일치

### 단기 개선
4. 정책 테이블 컬럼 가시성 토글 및 툴팁 (`ui_ux.md`)
5. Excel 업로드 MIME 검증 (`security.md`)
6. 서버 재시작 시 `running` 태스크 초기화 (`architecture.md`)
7. WebSocket 재연결 로직 (`architecture.md`)

### 장기 개선
8. 모바일 반응형 (`ui_ux.md`)
9. 감사 로그 (`architecture.md`, `security.md`)
10. SQLite WAL 모드 또는 PostgreSQL 전환 (`architecture.md`)
