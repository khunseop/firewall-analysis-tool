# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
사내 방화벽 운영·보안 담당자(소수). Windows 서버에 설치된 FAT를 내부망(폐쇄망)에서 데스크톱 브라우저로 사용한다. 여러 벤더 장비의 정책을 조회·분석하고, 신청 기반 정책 삭제 워크플로우를 수행하는 것이 주 업무.

## Product Purpose
FAT(Firewall Analysis Tool)는 멀티 벤더 방화벽 정책을 한 곳에서 통합 조회·분석·정리하는 웹 도구. 성공 = 담당자가 수만 건 정책을 범위 기반으로 빠르게 찾고, 위험·중복·미사용 정책을 식별하며, 안전하게 변경·삭제 계획을 세우는 것.

## Positioning
- 멀티 벤더(Palo Alto, SECUI MF2/NGF) 정책을 하나의 모델로 통합하고 IP/포트 숫자 범위 기반으로 검색·중첩 판정.
- 장비에 직접 반영하지 않고 편집 내용을 CLI 텍스트로만 생성해 사람이 실행(정책 빌더).
- 통합 조회/분석과 신청 기반 삭제 워크플로우 자동화(분석 → Excel 산출)가 동등한 핵심 가치.

## Operating Context
- Windows 서버, 폐쇄망/내부망 운영. FastAPI가 빌드된 React 정적 파일을 직접 서빙.
- 데스크톱·대용량 그리드(Ag-Grid) 중심 작업. 모바일은 대상 아님.
- 동기화·분석은 백그라운드로 실행되고 WebSocket으로 진행 상태를 브로드캐스트.

## Capabilities and Constraints
- 지원 벤더: Palo Alto(XML API + SSH, HA), SECUI MF2(SSH), SECUI NGF(REST), Mock.
- 기능: 장비 동기화/스케줄, 정책·오브젝트 검색, 분석 엔진 7종, 삭제 워크플로우, 정책 빌더(Palo Alto 전용, 편집모드), 가이드 페이지.
- UI는 한국어 전용. 기술 용어·식별자는 원문 유지.
- 외부 CDN·웹폰트 등 외부 자원 의존 불가(폐쇄망).

## Evidence on Hand
README.md, docs/ (ARCHITECTURE, DATABASE, 삭제 워크플로우 운영 매뉴얼). 고객 후기·벤치마크·가격 정보는 없음 — 만들어내지 말 것.

## Product Principles
1. 데이터 밀도와 스캔 속도가 장식보다 우선한다 — 대용량 그리드 작업이 중심.
2. 장비를 직접 건드리지 않는다 — 변경은 검토 가능한 CLI/산출물로 제시하고 사람이 최종 실행.
3. 위험하거나 되돌리기 어려운 작업은 상태·영향 범위를 명확히 드러낸다.
4. 벤더 차이는 통합 모델 뒤에 숨기되, 벤더 고유 사실은 왜곡하지 않는다.
5. 폐쇄망에서도 동작해야 한다 — 외부 자원 없이 자체 포함.

## Accessibility & Inclusion
특별한 표준 요구 없음. 기존 DESIGN.md 기준(WCAG 대비 4.5:1)을 준수.
