# 시스템 현황 대시보드 → FAT 장비 정보 가져오기 설계

작성일: 2026-11-11 · 상태: 승인 대기

## 1. 배경과 목적

사내 자원 현황은 별도 앱 `system_dashboard`(엑셀 현황 → SQLite, FastAPI, 인증 없음, 기본 포트 5012)에
관리된다. FAT의 장비(방화벽) 정보 중 hostname·위치·모델 등을 사람이 다시 입력하는 수고를 줄이고,
**현황 파일과 실제 장비가 어긋난 곳을 한눈에 보이게** 하는 것이 목적이다.

성공 기준
- Devices 페이지에서 버튼 한 번으로 대시보드의 최신 현황을 읽고, 적용 전에 변경 내용을 미리보기로 확인한다.
- 사용자가 확인한 항목만 반영한다. 읽기에 실패하면 FAT 데이터는 하나도 바뀌지 않는다.

## 2. 목표 / 비목표 / 안티목표

목표
- FAT에 **이미 등록된 장비**의 정보를 대시보드 값으로 갱신·보충한다.
- HA 쌍(두 대)을 FAT의 1건(`ip_address` + `ha_peer_ip`)으로 올바르게 대응시킨다.
- 대시보드와 FAT 수집값이 다른 항목을 "불일치"로 보여준다(적용하지 않음).

비목표 (이번 범위 아님)
- FAT에 없는 장비를 새로 등록하지 않는다(접속 계정·비밀번호 필수). 목록으로만 보여준다.
- FAT → 대시보드 방향 쓰기, 자동 주기 동기화(스케줄), 대시보드 앱 수정.
- 랙 정면도 등 대시보드 기능 이관(별도 검토 사항).
- 담당자·재해등급·연동 여부 등 FAT에 대응 필드가 없는 컬럼.

안티목표 (이러면 실패)
- 사용자가 확인하지 않은 값이 FAT에 반영되는 것.
- 장비 접속에 쓰는 IP·벤더가 경고 없이 바뀌는 것.
- 자동 수집(동기화)이 가져온 값을 덮어쓰지 못하게 의도치 않게 고정하는 것.

## 3. 데이터 소스

대시보드 `GET {base_url}/api/assets` 를 **수정 없이** 사용한다.
- 쿼리: `vendor=Paloalto&vendor=SECUI&retired=1&page=N&page_size=<최대>` — 컬럼 key 파라미터는 정확 일치(반복 시 OR),
  `retired=1`이면 폐기 장비 포함. 응답은 `{total, page, page_size, items}`; 모든 페이지를 순회해 합친다.
- 사용 컬럼 key: `status, hostname, task_name, vendor, model, ip, serial, intro_date, os_install_date, os_name,
  os_version, region, building, floor, room, coord_x, coord_y, coord_z, remarks`.
- 대시보드 주소는 **Settings**(기존 settings 테이블, key `system_dashboard`)에 저장한다. 스키마 변경 없음.
- 호출 제약: GET만, 연결 5초/전체 30초 타임아웃, 리다이렉트 따라가지 않음, 응답 크기 상한(예: 20MB).
  주소를 바꿀 수 있는 사용자는 기존 Settings 권한과 같다.
- 네트워크 도달성(FAT 서버 → 대시보드 PC)은 운영 쪽 과제이며 코드에서 해결하지 않는다.

## 4. 벤더 변환

비교는 공백·하이픈·대소문자를 무시한다(`Palo Alto`, `Paloalto` 모두 같은 값).

| 대시보드 벤더 | 조건 | FAT `vendor` |
|---|---|---|
| Paloalto | - | `paloalto` |
| SECUI | 모델명에 `ngf` 포함(대소문자 무시) | `ngf` |
| SECUI | 그 외 | `mf2` |
| 그 밖 | - | 대상 제외(건수만 안내) |

MF2는 구버전이라 정리 중이지만 정책 조회가 가능하므로 대상에 포함한다.

## 5. 장비 매칭

FAT 장비를 기준으로 대시보드 행을 찾는다(대시보드 행이 기준이 아님).

1. **IP 일치**: FAT `ip_address`와 같은 IP의 행. 못 찾으면 FAT `ha_peer_ip`와 같은 IP의 행도 후보로 본다
   (본체 정보는 `ip_address` 행만 쓰며, `ha_peer_ip` 행은 HA 짝 검증용).
2. **IP 불일치 시 hostname 보조 매칭**: 대시보드 hostname이 FAT 장비 `name` 또는 수집된 `hostname`과
   (대소문자 무시) 같으면 "IP 변경 후보"로 연결한다. 후보가 둘 이상이면 매칭하지 않고 경고한다.
3. 어느 쪽도 못 찾은 FAT 장비는 "대시보드에 없음"으로 표시한다. 대시보드 폐기 상태(`status`에 `폐기` 포함)와
   매칭된 장비는 "대시보드에서 폐기" 경고를 붙인다(적용은 막지 않음).
4. 같은 IP가 대시보드에 두 행 이상이면 매칭하지 않고 경고한다.

## 6. HA 쌍 판정

대시보드에는 HA 표시가 없으므로 **hostname 규칙**으로 짝을 만든다.

- 대상 행(벤더 변환을 통과한 행)의 hostname에서 마지막 한 글자를 뗀 앞부분이 같고, 마지막 글자가
  `p`/`s` 또는 `1`/`2`의 한 쌍(대소문자 무시)이면 쌍으로 본다.
  예: `mainfwp`+`mainfws`, `dmzfw1`+`dmzfw2`. 서로 다른 규칙을 섞은 조합은 쌍이 아니다.
- 짝이 없으면 단독 장비다. 한쪽만 있거나, 같은 앞부분에 3행 이상이면 자동 처리하지 않고 경고한다.
- **본체 정보는 IP로 고른 행에서만** 가져온다(Primary/Secondary 역할 무관). 짝의 반대편 행은 `ha_peer_ip`에만 쓴다.
  - FAT `ha_peer_ip`가 비어 있고 짝이 확정되면 → 채우기 제안.
  - FAT `ha_peer_ip`가 반대편 IP와 다르면 → 불일치(적용 안 함).
  - FAT에 `ha_peer_ip`가 있는데 대시보드엔 단독이면 → 경고.
- 반대편 장비의 hostname·serial은 FAT에 저장할 곳이 없어 미리보기에 참고로만 표시한다.
- 의도치 않은 쌍(무관한 단독 장비 `fw1`/`fw2`)은 막을 수 없으므로 **묶인 쌍을 항상 미리보기에 보여준다**.

## 7. 필드별 적용 규칙

| 구분 | 필드(FAT) | 규칙 |
|---|---|---|
| 대시보드 기준 | `hostname`(←Hostname), `vendor`, `ip_address`(←IP) | 값이 다르면 변경 제안. hostname 적용 시 `hostname_manual=True` |
| FAT 수집값 기준 | `model`, `serial_number`, `os_name`, `os_version`, `install_date`, `location_*`(region/building/floor/room/x/y/z), `description` | FAT 값이 있으면 유지(다르면 "불일치"로 표시만). 비어 있을 때만 채움 |
| 대응 없음 | 담당자, 등급, 연동 여부, 구성도 링크 등 | 가져오지 않음 |

세부 규칙
- 채우기로 들어간 `model`/`serial_number`/`os_version`은 `*_manual`을 **False로 둔다**(이후 자동 수집이 정상 갱신).
  `*_manual`이 이미 True인 필드는 어떤 경우에도 건드리지 않는다. `os_name`·`install_date`·`location_*`·`description`은
  플래그가 없으므로 빈 값일 때만 채운다.
- 값 비교는 앞뒤 공백 제거, 빈 문자열은 없음으로 취급한다. 대시보드가 빈 값이면 FAT 값을 지우지 않는다.
- **IP·벤더 변경은 연결에 영향**(접속 대상·수집기 결정)이므로 미리보기에서 별도 구역으로 강조하고,
  "연결 정보가 바뀌는 장비 N대"를 확인해야 적용 버튼이 활성화된다.
- IP 변경으로 `ip_address` 유일 제약(UNIQUE)에 걸리는 항목은 적용 대상에서 제외하고 경고한다.
- 벤더를 바꾼 장비는 이후 수집기가 달라지므로 적용 후 안내 문구에 "연결 테스트 권장"을 표시한다.

## 8. 흐름과 안전장치

1. 사용자가 Devices 페이지의 **"시스템 현황 가져오기"** 버튼을 누른다(주소 미설정 시 Settings 안내).
2. 백엔드가 대시보드를 읽어 **미리보기만 계산**한다(DB 쓰기 없음). 결과 구역:
   변경 제안 / 연결 정보 변경(강조) / 불일치(참고) / HA 쌍 / FAT 장비 중 대시보드에 없음 / 대시보드에만 있음(FAT 미등록) / 경고.
3. 사용자가 항목(장비 또는 필드 단위)을 선택하고 적용한다. 기본값은 모두 선택, 연결 정보 변경은 확인 체크 필요.
4. 적용 요청은 `device_id, field, 새 값, 미리보기 시점의 기존 값`을 담는다. 서버는 현재 값이 기존 값과 다르면
   (그 사이 누가 고쳤다면) 그 항목을 건너뛰고 결과에 "충돌"로 보고한다.
5. 한 요청 안에서는 트랜잭션으로 처리하고, 결과(적용 N, 건너뜀 N, 충돌 N)를 응답한다.
   기존 감사 로그(`audit_log`)에 요청자·장비·필드를 남긴다.
6. 대시보드 읽기 실패·응답 형식 불일치·0건 응답이면 미리보기를 만들지 않고 오류만 반환한다.

## 9. 구성

백엔드(`backend/app/services/system_import/`)
- `client.py` 대시보드 조회(페이지 순회, 타임아웃/크기 제한)
- `vendor_map.py` 벤더 변환 · `ha_pairing.py` 쌍 판정 · `matcher.py` 장비 매칭 · `differ.py` 필드 규칙 적용(순수 함수)
- `applier.py` 선택 항목 적용(충돌 검사·감사 로그)
- 엔드포인트 `backend/app/api/api_v1/endpoints/system_import.py`: `POST /system-import/preview`, `POST /system-import/apply`
- 스키마 `app/schemas/system_import.py`. **DB 스키마 변경 없음**(마이그레이션 불필요).

프론트(`frontend/src/`)
- `components/pages/devices/SystemImportDialog.tsx`(미리보기·선택·적용) + API 함수, 쿼리키는 `queryKeys.ts` 팩토리에 추가
- Settings에 대시보드 주소 입력 추가. 적용 후 `queryKeys.devices` 무효화.

테스트: 순수 함수(`vendor_map`, `ha_pairing`, `matcher`, `differ`)는 먼저 단위 테스트를 작성한다.
수동 확인 시 대시보드는 `uvicorn`으로 띄우고 샘플 엑셀(`make_sample_xlsx.py`)을 쓴다. 실제 현황 데이터는 저장소에 넣지 않는다.

## 10. 설계자(Claude)가 정한 부분 — 확인 요청

- `install_date` ← **OS 설치일** (FAT 폼에서 OS 이름 옆에 있어 그렇게 판단. 도입일이 맞다면 변경).
- `description` ← **업무명**(비어 있을 때만). 비고·구분/분류/제품군은 가져오지 않음. `group`은 건드리지 않음.
- "FAT에 없음" 목록은 벤더 변환을 통과한 행만 보여준다.
- 미리보기에서 대시보드 폐기 장비는 조회하되 신규 제안 대상에서는 뺀다(경고만).
- 주소 형식은 `http://host:port` 한 칸. 인증 헤더는 지원하지 않는다(대시보드가 인증 없음).

## 11. 빌더 재량

화면 배치·문구, 응답 스키마의 세부 필드명, 페이지 크기, 응답 크기 상한 값, 에러 메시지.
