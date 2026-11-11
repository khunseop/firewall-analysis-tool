# 시스템 현황 대시보드 → FAT 장비 정보 가져오기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Devices 페이지에서 `system_dashboard`의 현황을 읽어 미리보기 → 선택 적용(+되돌리기)으로 FAT 장비 정보를 갱신·보충한다.

**Architecture:** 대시보드 `GET /api/assets`를 읽는 클라이언트 + 순수 함수 4개(벤더 변환, HA 쌍 판정, 장비 매칭, 필드 diff)로 미리보기를 계산하고, 선택된 변경만 충돌 검사 후 한 트랜잭션으로 적용한다. DB 스키마 변경 없음.

**Tech Stack:** FastAPI, SQLAlchemy(async), httpx, pytest(`asyncio.run` 방식, pytest-asyncio 없음), React 19 + TanStack Query + Tailwind.

**Spec:** `docs/superpowers/specs/2026-11-11-system-dashboard-import-design.md`

## Global Constraints

- 벤더: `Paloalto`→`paloalto`, `SECUI`+모델명에 `ngf`(대소문자 무시)→`ngf`, 그 외 `SECUI`→`mf2`, 나머지는 제외. 비교 시 공백·하이픈·대소문자 무시.
- HA 쌍: hostname 마지막 1글자를 뗀 앞부분이 같고 마지막 글자가 `p`/`s` 또는 `1`/`2` 한 쌍(대소문자 무시). 규칙 혼합·3행 이상·한쪽만 있음은 자동 처리 금지, 경고.
- 본체 정보는 FAT `ip_address`와 같은 IP의 행에서만 가져온다(역할 무관). 반대편 행은 `ha_peer_ip`에만 사용.
- 대시보드 기준: `hostname`(적용 시 `hostname_manual=True`), `vendor`, `ip_address`. FAT 수집값 기준(비어 있을 때만 채움): `model`, `serial_number`, `os_name`, `os_version`, `install_date`←OS 설치일, `location_*`, `description`←업무명. 대시보드 값이 비면 FAT 값을 지우지 않는다. `*_manual`이 True인 필드는 건드리지 않는다. 채우기는 `*_manual`을 False로 둔다.
- IP·벤더 변경은 `kind="connection"`: 확인(`confirm_connection`) 없이는 적용 거부. `ip_address` UNIQUE 충돌은 적용 제외.
- 호출: GET만, 연결 5초/전체 30초, 리다이렉트 미추종, 응답 20MB 상한. 읽기 실패·0건이면 오류만 반환(변경 없음).
- 프로젝트 규칙: 백엔드 임포트는 `app.` 절대경로, 테스트 실행은 `cd backend && ../.venv/bin/python -m pytest <path> -v`, 파일은 코드 1000줄·문서 300줄 이하, 쿼리키는 `queryKeys.ts` 팩토리, DB 직접 수정 금지, 작업 완료 후 main에 커밋·푸시.

## Review Focus

- 대시보드가 빈 배열을 돌려줌 → 오류, 변경 없음 (Task 5, 6)
- hostname·IP가 `None`/공백인 행이 섞임 → 매칭에서 제외되고 예외 없음 (Task 3)
- `"Palo Alto "`, `"PALOALTO"`, `"secui"` 같은 표기 흔들림 → 같은 벤더로 인식 (Task 1)
- 미리보기 후 다른 사용자가 FAT 값을 바꿈 → 해당 항목만 충돌로 건너뜀 (Task 7)
- 같은 IP를 가진 대시보드 행 2개 / IP 변경이 다른 장비의 IP와 겹침 → 매칭·적용 제외 + 경고 (Task 3, 7)

## File Structure

| 파일 | 책임 |
|---|---|
| `backend/app/schemas/system_import.py` | 요청·응답·내부 모델(`DashboardRow`, `FieldChange` 등) |
| `backend/app/services/system_import/vendor_map.py` | `map_vendor` |
| `backend/app/services/system_import/ha_pairing.py` | `classify_ha` |
| `backend/app/services/system_import/matcher.py` | `match_devices` |
| `backend/app/services/system_import/differ.py` | `build_diff` |
| `backend/app/services/system_import/client.py` | `fetch_assets` |
| `backend/app/services/system_import/service.py` | `build_preview`, `apply_changes` |
| `backend/app/api/api_v1/endpoints/system_import.py` | `POST /system-import/preview`, `/apply` |
| `frontend/src/api/systemImport.ts`, `components/pages/devices/SystemImportDialog.tsx` | 호출·미리보기·적용·되돌리기 UI |
| `backend/tests/test_system_import_*.py` | 단위 테스트 |

---

### Task 1: 스키마와 벤더 변환

**Files:**
- Create: `backend/app/schemas/system_import.py`, `backend/app/services/system_import/__init__.py`, `backend/app/services/system_import/vendor_map.py`
- Test: `backend/tests/test_system_import_vendor_map.py`

**Interfaces:**
- Produces (`schemas/system_import.py`, 모든 모델은 pydantic `BaseModel`):
  - `DashboardRow`: 전부 `Optional[str]` — `hostname, ip, vendor, model, status, task_name, serial, os_install_date, os_name, os_version, region, building, floor, room, coord_x, coord_y, coord_z`
  - `ChangeKind = Literal["override", "fill", "connection"]`
  - `FieldChange`: `device_id: int`, `field: str`(FAT `Device` 속성명), `old: Optional[str]`, `new: Optional[str]`, `kind: ChangeKind`, `set_manual: Optional[bool] = None`(해당 필드의 `<field>_manual` 플래그를 이 값으로 설정, None이면 미변경)
  - `Mismatch`: `device_id, field: str, fat_value: str, dashboard_value: str`
  - `DeviceDiff`: `device_id, device_name, via: Literal["ip","hostname"], changes: list[FieldChange], mismatches: list[Mismatch], partner_hostname: Optional[str], dashboard_retired: bool`
  - `UnmatchedDevice`: `id, name, ip_address`; `UnmatchedRow`: `hostname, ip, vendor, model`
  - `SystemImportPreview`: `diffs: list[DeviceDiff]`, `unmatched_devices`, `unmatched_rows`, `skipped_vendor_count: int`, `warnings: list[str]`
  - `ApplyRequest`: `changes: list[FieldChange]`, `confirm_connection: bool = False`; `ApplyResult`: `applied, skipped_conflicts, skipped_invalid: list[FieldChange]`, `reverse: list[FieldChange]`
- Produces (`vendor_map.py`): `map_vendor(vendor: Optional[str], model: Optional[str]) -> Optional[str]` — 위 표 그대로, 제외 대상은 `None`.

- [ ] **Step 1: 실패하는 테스트** — `test_map_vendor_*`: `("Palo Alto ", None)`·`("PALOALTO", "PA-3220")`→`"paloalto"`; `("SECUI","NGF-5000")`·`("secui","secui-NGF")`→`"ngf"`; `("SECUI","MF2-1000")`·`("SECUI", None)`→`"mf2"`; `("Fortinet","x")`·`(None,"x")`·`("","x")`→`None`.
- [ ] **Step 2: 실행해 실패 확인** — `cd backend && ../.venv/bin/python -m pytest tests/test_system_import_vendor_map.py -v` → ModuleNotFoundError.
- [ ] **Step 3: 구현** — 스키마 파일과 `map_vendor`(키 정규화: 소문자, 공백·`-`·`_` 제거).
- [ ] **Step 4: 통과 확인** — 같은 명령, PASS.
- [ ] **Step 5: 커밋** — `git add backend/app/schemas/system_import.py backend/app/services/system_import backend/tests/test_system_import_vendor_map.py && git commit -m "feat: 시스템 현황 가져오기 스키마와 벤더 변환"`

### Task 2: HA 쌍 판정

**Files:** Create `backend/app/services/system_import/ha_pairing.py`; Test `backend/tests/test_system_import_ha_pairing.py`

**Interfaces:**
- Consumes: `DashboardRow`
- Produces: `HaInfo`(dataclass: `kind: Literal["single","paired","orphan","ambiguous"]`, `partner_hostname: Optional[str]`); `classify_ha(rows: Sequence[DashboardRow]) -> dict[str, HaInfo]` — 키는 `hostname.strip().lower()`. hostname이 비었거나 마지막 글자가 `p/s/1/2`가 아니면 `single`.

- [ ] **Step 1: 실패하는 테스트** — `mainfwp`+`mainfws`→둘 다 `paired`(서로를 partner로); `dmzfw1`+`dmzfw2`→`paired`; `fwp`+`fw2`(규칙 혼합)→둘 다 `orphan`; `dmzfw1` 혼자→`orphan`; 같은 앞부분에 3행(`edgefwp`,`edgefws`,`edgefws`)→모두 `ambiguous`; `core-sw`·`None`·`""`→`single`; `MAINFWP`+`mainfws` 대소문자 혼용→`paired`.
- [ ] **Step 2: 실행해 실패 확인**
- [ ] **Step 3: 구현** — 후보 글자를 가진 행을 앞부분으로 그룹화한 뒤 그룹별 글자 집합·행 수로 판정.
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋**

### Task 3: 장비 매칭

**Files:** Create `backend/app/services/system_import/matcher.py`; Test `backend/tests/test_system_import_matcher.py`

**Interfaces:**
- Consumes: `DashboardRow`; FAT 장비는 `id, name, ip_address, hostname, ha_peer_ip` 속성만 쓰는 덕 타이핑(테스트는 `SimpleNamespace`).
- Produces: `Match`(dataclass: `device`, `row: DashboardRow`, `via: Literal["ip","hostname"]`); `MatchResult`(dataclass: `matches: list[Match]`, `unmatched_devices: list`, `unmatched_rows: list[DashboardRow]`, `warnings: list[str]`); `match_devices(devices: Sequence, rows: Sequence[DashboardRow]) -> MatchResult`

- [ ] **Step 1: 실패하는 테스트** — IP 일치 시 `via="ip"`; IP가 달라도 hostname이 FAT `name` 또는 `hostname`과 대소문자 무시 일치하면 `via="hostname"`; hostname 후보가 2개면 매칭하지 않고 경고; 같은 IP 행이 2개면 그 IP는 매칭하지 않고 경고; `ip=None`·`hostname="  "` 행은 예외 없이 무시(`unmatched_rows`에도 넣지 않음); 매칭되지 않은 장비·행이 각각 목록에 남음; FAT `ha_peer_ip`와만 일치하는 행은 `matches`에 넣지 않는다.
- [ ] **Step 2: 실행해 실패 확인**
- [ ] **Step 3: 구현** — IP/hostname 인덱스를 먼저 만들고 장비별로 조회. IP 비교는 `strip()`.
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋**

### Task 4: 필드 diff 규칙

**Files:** Create `backend/app/services/system_import/differ.py`; Test `backend/tests/test_system_import_differ.py`

**Interfaces:**
- Consumes: `Match`, `HaInfo`, `DashboardRow`, `map_vendor`
- Produces: `build_diff(match: Match, ha: Optional[HaInfo], partner: Optional[DashboardRow]) -> DeviceDiff` — 변경 필드와 규칙은 Global Constraints 그대로. `hostname` 변경은 `set_manual=True`, 벤더 변환 결과가 `None`이면 벤더 변경 없음, `ha_peer_ip`는 FAT이 비어 있고 `paired`일 때만 `kind="fill"`로 제안(다르면 `Mismatch`). `dashboard_retired`는 `status`에 `폐기` 포함 여부.

- [ ] **Step 1: 실패하는 테스트** — hostname 다름→`override`+`set_manual=True`; IP/벤더 다름→`connection`; FAT `model=None`·대시보드 `"PA-3220"`→`fill`; FAT `model="PA-5220"`·대시보드 다름→변경 없이 `mismatches`; `model_manual=True`인 장비의 빈 모델→채우지 않음; 대시보드 값이 `None`/공백→FAT 값 유지; `install_date`는 `os_install_date`(`"2023-05-01"`)를 `"2023-05-01"`로 제안, 파싱 불가 문자열은 제안하지 않음; `description`←`task_name`(빈 경우만); `paired`+FAT `ha_peer_ip` 없음→`ha_peer_ip` fill, 다르면 `Mismatch`; FAT에 `ha_peer_ip`가 있는데 `ha.kind=="single"`이면 `Mismatch(field="ha_peer_ip", dashboard_value="(단독 장비)")`.
- [ ] **Step 2: 실행해 실패 확인**
- [ ] **Step 3: 구현** — 필드 매핑 표(`(device_attr, row_attr, rule)`)를 모듈 상수로 두고 순회.
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋**

### Task 5: 대시보드 클라이언트

**Files:** Create `backend/app/services/system_import/client.py`; Test `backend/tests/test_system_import_client.py`

**Interfaces:**
- Produces: `class DashboardFetchError(Exception)`; `async def fetch_assets(base_url: str, *, transport: Optional[httpx.AsyncBaseTransport] = None) -> list[DashboardRow]` — `{base_url}/api/assets?vendor=Paloalto&vendor=SECUI&retired=1&page=N&page_size=<값>`을 `items`가 빌 때까지 순회.

- [ ] **Step 1: 실패하는 테스트** (`httpx.MockTransport`, `asyncio.run`) — 2페이지 응답이 합쳐짐; 쿼리에 `retired=1`·`vendor=Paloalto`·`vendor=SECUI` 포함; 최종 결과 0건이면 `DashboardFetchError`; 5xx·연결 오류·JSON 형식 오류(`items` 없음)·리다이렉트 응답은 `DashboardFetchError`; 알 수 없는 컬럼은 무시.
- [ ] **Step 2: 실행해 실패 확인**
- [ ] **Step 3: 구현** — `httpx.AsyncClient(timeout=httpx.Timeout(30, connect=5), follow_redirects=False)`, 누적 바이트 20MB 초과 시 오류.
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋**

### Task 6: 미리보기 서비스와 엔드포인트

**Files:** Create `backend/app/services/system_import/service.py`, `backend/app/api/api_v1/endpoints/system_import.py`; Modify `backend/app/api/api_v1/api.py`(라우터를 `prefix="/system-import"`, `dependencies=_auth`로 등록); Test `backend/tests/test_system_import_preview.py`

**Interfaces:**
- Consumes: Task 1~5 전부, `crud.settings.get_setting(db, key)`, `crud.device.get_devices(db)`
- Produces: `async def build_preview(db: AsyncSession, base_url: str, *, transport=None) -> SystemImportPreview`; `POST /api/v1/system-import/preview` 본문 `{"base_url": Optional[str]}` — 없으면 설정 키 `system_dashboard_url`; 둘 다 없으면 400, `DashboardFetchError`는 502(메시지 포함). 흐름: 행 읽기 → `map_vendor`로 제외 건수 집계 → `classify_ha` → `match_devices` → 매칭마다 `build_diff`(partner는 `HaInfo.partner_hostname`의 행) → 응답 조립. `unmatched_rows`는 벤더 변환을 통과한 행 중 `status`에 `폐기`가 없는 행만. DB 쓰기 없음.

- [ ] **Step 1: 실패하는 테스트** — 인메모리 SQLite(`create_async_engine("sqlite+aiosqlite://")` + `Base.metadata.create_all`, 모델 임포트 필요)에 장비 2대를 넣고 `MockTransport`로 행을 주입: 변경·불일치·HA 짝·`skipped_vendor_count`·`unmatched_*`가 기대대로 채워짐; 호출 전후 장비 행이 바뀌지 않음; `base_url` 미설정 시 400(엔드포인트 함수 직접 호출).
- [ ] **Step 2: 실행해 실패 확인**
- [ ] **Step 3: 구현** — 서비스와 라우터.
- [ ] **Step 4: 통과 확인** — 기존 전체 테스트도 실행: `cd backend && ../.venv/bin/python -m pytest -q` → 기존 통과 수 유지.
- [ ] **Step 5: 커밋**

### Task 7: 적용과 되돌리기

**Files:** Modify `backend/app/services/system_import/service.py`, `backend/app/api/api_v1/endpoints/system_import.py`; Test `backend/tests/test_system_import_apply.py`

**Interfaces:**
- Produces: `async def apply_changes(db: AsyncSession, req: ApplyRequest, *, user_id: int, username: str) -> ApplyResult`; `POST /api/v1/system-import/apply`(본문 `ApplyRequest`, 응답 `ApplyResult`). 규칙: `kind="connection"`이 있고 `confirm_connection=False`면 400. 항목마다 현재 값이 `old`와 같을 때만 적용(다르면 `skipped_conflicts`). `field`는 허용 목록(`hostname, ip_address, vendor, model, serial_number, os_name, os_version, install_date, location_region/building/floor/room/x/y/z, description, ha_peer_ip`)만 받고 그 밖의 값은 `skipped_invalid`(임의 컬럼 수정 방지). `ip_address`가 다른 장비와 겹치면 `skipped_invalid`. `install_date`는 `YYYY-MM-DD`를 `date`로 변환(실패 시 `skipped_invalid`). `set_manual`이 있으면 `<field>_manual`을 설정. 한 번의 `commit`으로 반영하고 `log_activity(category="device")`를 1건 남김. `reverse`는 각 적용 항목의 `old`/`new`를 맞바꾸고 `set_manual`은 적용 전 플래그 값으로 채운다(`new=None`은 값을 비움).

- [ ] **Step 1: 실패하는 테스트** — 정상 적용 후 DB 값 확인; 확인 없는 connection → 400, DB 불변; 미리보기 후 값이 바뀐 항목은 `skipped_conflicts`이고 나머지는 적용됨; UNIQUE 충돌 IP는 `skipped_invalid`; **적용 → `reverse`를 그대로 다시 적용하면 장비 행 전체가 적용 전과 동일**(hostname_manual 포함, fill로 채운 필드는 다시 NULL); 존재하지 않는 `device_id`와 허용 목록 밖의 `field`(예: `password`)는 `skipped_invalid`이고 DB 불변.
- [ ] **Step 2: 실행해 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 전체 테스트 재실행.
- [ ] **Step 5: 커밋**

### Task 8: 프론트엔드 (가져오기 창)

**Files:** Create `frontend/src/api/systemImport.ts`, `frontend/src/components/pages/devices/SystemImportDialog.tsx`; Modify `frontend/src/components/pages/DevicesPage.tsx`(툴바에 "시스템 현황 가져오기" 버튼)

**Interfaces:**
- Produces(`systemImport.ts`): 백엔드 스키마와 같은 TS 타입(`FieldChange`, `DeviceDiff`, `SystemImportPreview`, `ApplyResult` 등), `previewSystemImport(baseUrl?: string): Promise<SystemImportPreview>`, `applySystemImport(changes: FieldChange[], confirmConnection: boolean): Promise<ApplyResult>`. 주소 저장은 기존 `getSetting`/`updateSetting`(`'system_dashboard_url'`, 404면 빈 값).

- [ ] **Step 1:** 타입·API 함수 작성 후 `cd frontend && npx tsc -b` 통과 확인.
- [ ] **Step 2:** 대화창 구현 — 주소 입력·저장 → "불러오기" → 구역별 표시(변경 제안 / 연결 정보 변경(강조) / 불일치 / HA 쌍 / FAT에만 있음 / 대시보드에만 있음 / 경고); 항목 체크박스(연결 정보 변경은 별도 확인 체크가 있어야 적용 활성화); 적용 결과 요약과 **"되돌리기"** 버튼(`reverse`를 `applySystemImport`로 전송, 연결 정보가 포함되면 `confirmConnection=true`); 적용·되돌리기 후 `queryKeys.devices` 무효화. 목록이 길어도 입력이 느려지지 않게 장비 단위로 접어서 표시.
- [ ] **Step 3:** `DevicesPage` 버튼과 연결. `cd frontend && npx tsc -b && npx eslint src/components/pages/devices/SystemImportDialog.tsx src/api/systemImport.ts` 오류 없음.
- [ ] **Step 4:** 가짜 응답으로 화면 확인(Playwright로 `/api/v1/system-import/*`를 모킹) — 미리보기 렌더, 연결 정보 확인 전 적용 버튼 비활성, 적용·되돌리기 요청 본문 확인.
- [ ] **Step 5: 커밋**

### Task 9: 실제 환경 검증과 마무리

**Files:** 코드 변경 없음(스키마 불변이라 `DATABASE.md`도 그대로). 검증 중 발견한 문제의 수정만 해당 Task 파일에 반영.

- [ ] **Step 1: 백업** — `cp backend/fat.db backend/fat.db.bak-before-system-import`, 적용 전 `sqlite3 backend/fat.db "select * from devices order by id" > <scratchpad>/devices-before.txt`.
- [ ] **Step 2: 대시보드 샘플 기동** — `system_dashboard/backend`에서 `python scripts/make_sample_xlsx.py` 후 `python -m app.cli import <생성 파일>` → `uvicorn app.main:app --port 5012`(FAT 서버에서 접근 가능한 주소로).
- [ ] **Step 3: 미리보기만** — 실제 FAT 개발 DB로 미리보기를 실행하고 diff·불일치·HA 쌍·경고가 기대대로인지 눈으로 확인. 이 단계에서 `devices` 덤프가 Step 1과 동일해야 한다(`diff`).
- [ ] **Step 4: 일부 적용 → 되돌리기** — 안전한 항목 몇 건만 적용하고 `devices` 덤프의 변경 행을 확인한 뒤 "되돌리기"를 눌러 `diff <before> <after>`가 비어 있음을 확인.
- [ ] **Step 5:** 전체 테스트(`cd backend && ../.venv/bin/python -m pytest -q`)와 `cd frontend && npx tsc -b` 통과 확인 후 커밋·푸시. 확인 결과(성공/문제)를 사용자에게 그대로 보고.
