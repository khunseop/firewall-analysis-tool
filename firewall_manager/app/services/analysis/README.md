# 보안 정책 및 객체 분석 서비스 (Analysis Services)

이 패키지는 방화벽 정책과 객체 데이터를 분석하여 중복, 미사용, 위험 요소를 탐지하고 최적화 가이드를 제공하는 비즈니스 로직을 포함합니다.

## 1. 분석 모듈 개요

### [중복 정책 분석 (Redundancy)](./redundancy.py)
- **목적**: 동일한 효과를 가지거나 상위 정책에 의해 완전히 포함(Subsumed)되는 불필요한 정책 탐지.
- **알고리즘**: 모든 정책의 출발지/목적지 IP 범위, 서비스(포트), 액션을 상호 비교하여 포함 관계를 분석합니다.

### [미사용 정책 분석 (Unused)](./unused.py)
- **목적**: 장기간 트래픽 매칭 이력이 없는 정책을 식별하여 보안 홀 제거 및 성능 향상.
- **알고리즘**: 정책의 `last_hit_date`와 현재 날짜를 비교하여 지정된 기간(예: 90일) 동안 사용되지 않은 정책을 추출합니다.

### [영향 분석 (Impact)](./impact.py)
- **목적**: 정책의 위치(Sequence) 변경 시 발생할 수 있는 트래픽 흐름의 변화를 사전에 분석.
- **알고리즘**: 이동할 정책과 이동 경로상에 있는 정책들 간의 중첩(Overlap)을 분석하여, 이동 후 차단(Blocking)되거나 다른 정책을 가리는(Shadowing) 현상을 탐지합니다.

### [미참조 객체 분석 (Unreferenced Objects)](./unreferenced_objects.py)
- **목적**: 어떤 보안 정책에서도 참조되지 않는 고립된 네트워크/서비스 객체 및 그룹 탐지.
- **알고리즘**: 모든 정책의 설정값을 파싱하여 사용 중인 객체 리스트를 추출(역참조 분석)한 뒤, 전체 객체 목록과 대조하여 미사용 객체를 식별합니다.

### [위험 포트 분석 (Risky Ports)](./risky_ports.py)
- **목적**: Any 포트 허용이나 보안상 취약한 서비스(Telnet, FTP 등)가 포함된 위험 정책 탐지.
- **알고리즘**: 사전에 정의된 위험 포트/서비스 목록과 정책의 서비스 항목을 대조합니다.

### [과허용 정책 분석 (Over Permissive)](./over_permissive.py)
- **목적**: 서비스 범위가 너무 넓거나 출발지/목적지가 과도하게 설정된 정책 탐지.
- **알고리즘**: IP 범위의 크기(Subnet Mask)나 서비스 항목의 개수 등을 기준으로 임계치를 초과하는 정책을 식별합니다.

## 2. 분석 결과 데이터 저장 방식

분석 결과는 `analysis_results` 테이블에 저장되며, 프론트엔드에서 유연하게 시각화할 수 있도록 **JSON 포맷**을 사용합니다.

### 데이터베이스 테이블 구조 (`analysis_results`)
| 컬럼명 | 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | Integer | 기본키 |
| `device_id` | Integer | 해당 장비 ID (Foreign Key) |
| `analysis_type` | String | 분석 유형 (예: redundancy, unused, impact 등) |
| `result_data` | JSON | 분석 결과 상세 데이터 (JSON 형식) |
| `created_at` | DateTime | 분석 완료 및 저장 시간 (KST) |

### `result_data` JSON 포맷 예시 (미참조 객체)
```json
[
  {
    "object_name": "TEMP_OBJ_01",
    "object_type": "network_object",
    "referenced": false
  },
  {
    "object_name": "OLD_SERVICE_GROUP",
    "object_type": "service_group",
    "referenced": false
  }
]
```

## 3. 새로운 분석 로직 추가 방법

새로운 분석 기능을 추가하려면 다음 단계를 따르십시오.

### Step 1: Analyzer 클래스 작성
`firewall_manager/app/services/analysis/` 디렉토리에 새로운 Python 파일을 생성하고 분석 클래스를 구현합니다.
- `__init__(self, db_session, task, ...)`를 통해 필요한 컨텍스트를 주입받습니다.
- `async def analyze(self)` 메서드에서 실제 로직을 수행하고 결과를 반환합니다.

### Step 2: 비동기 Task 함수 등록
`firewall_manager/app/services/analysis/tasks.py` 파일에 해당 분석을 수행할 Task 함수를 추가합니다.
- `AnalysisTask`를 생성하여 진행 상태를 관리합니다.
- 분석 완료 후 결과를 `jsonable_encoder`를 사용하여 JSON화 한 뒤 `crud.analysis.create_or_update_analysis_result`를 호출하여 저장합니다.

### Step 3: API 엔드포인트 연동
필요한 경우 `app/api/api_v1/endpoints/analysis.py` 등에 해당 Task를 호출하는 API를 추가합니다.

### Step 4: 프론트엔드 시각화
`app/frontend/js/pages/analysis.js` 등에서 저장된 JSON 데이터를 파싱하여 UI(표 또는 그래프)로 출력합니다.
