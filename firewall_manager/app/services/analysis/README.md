# Analysis Services (분석 서비스)

이 모듈은 수집된 방화벽 정책과 객체 데이터를 분석하여 중복 탐지, 사용률 식별, 영향도 평가 등 보안 최적화를 위한 핵심 비즈니스 로직을 제공합니다.

## 1. 개요 (Overview)

분석 서비스는 대량의 데이터를 처리해야 하므로 비동기 작업(Task) 방식으로 실행됩니다. 각 분석 로직은 독립된 엔진으로 구현되어 있으며, 정책 간의 포함 관계(Subsumption) 분석과 IP/Port 범위 중첩 분석을 위해 특화된 알고리즘을 사용합니다.

## 2. 아키텍처 및 구성 (Architecture)

### 주요 분석 모듈
- **[Redundancy (중복)](./redundancy.py)**: 상위 정책에 의해 완전히 포함되어 불필요해진 하위 정책 탐지. `analyze_logical()`을 사용하여 정수형 IP/포트 범위 기반 포함 관계(A ⊆ B)를 탐지하며, 텍스트 완전 일치뿐 아니라 서브넷 포함 관계(예: 10.1.0.0/16 ⊆ 10.0.0.0/8)도 탐지합니다. fpat `RedundancyAnalyzer.analyze_logical()` 이식.
- **[Unused (미사용)](./unused.py)**: 특정 기간(예: 90일) 동안 트래픽 매칭이 없는 정책 식별.
- **[Impact (영향)](./impact.py)**: 정책 이동 시 발생할 트래픽 흐름의 변화(Shadowing, Blocking) 사전 시뮬레이션.
- **[Unreferenced (미참조)](./unreferenced_objects.py)**: 어떤 정책에서도 참조되지 않는 네트워크/서비스 객체 탐지.
- **[Risky Ports (위험)](./risky_ports.py)**: Any 서비스 허용이나 취약 포트(Telnet 등) 포함 정책 탐지.

### 비동기 작업 관리 (`tasks.py`)
- **비동기 락 (Lock)**: 장비별로 한 번에 하나의 분석 작업만 실행되도록 보장합니다.
- **상태 추적**: `AnalysisTask` 모델을 통해 작업의 시작/종료 시간 및 현재 상태(`pending`, `in_progress`, `success`, `failure`)를 기록합니다.

## 3. 주요 로직 및 흐름 (Main Flow)

1.  **작업 생성**: 분석 요청 시 `AnalysisTask` 레코드를 생성하고 초기 상태를 설정합니다.
2.  **분석 실행**: 각 분석 엔진(Analyzer)이 DB로부터 인덱스 데이터를 로드하여 비교 분석을 수행합니다.
3.  **데이터 저장**: 
    - 중간 상세 결과(예: 중복 정책 쌍)는 전용 테이블(`redundancypolicysets`)에 저장됩니다.
    - 최종 통합 결과는 `AnalysisResult` 테이블의 `result_data` 컬럼에 JSON 형식으로 저장됩니다.
4.  **작업 종료**: 성공 여부에 따라 `AnalysisTask`의 상태를 업데이트하고 소요 시간을 기록합니다.

## 4. 데이터 규격 (Data Specification)

분석 결과는 `AnalysisResult` 모델을 통해 저장되며, `result_data` 컬럼은 분석 유형별로 다음과 같은 JSON 구조를 가집니다.

### 미사용 정책 분석 결과 예시 (`unused`)
```json
[
  {
    "id": 1205,
    "vsys": "vsys1",
    "rule_name": "Old_Legacy_Rule",
    "last_hit_date": "2023-01-15T10:00:00",
    "days_unused": 150
  }
]
```

### 중복 정책 분석 결과 예시 (`redundancy`)
```json
[
  {
    "set_number": 1,
    "type": "UPPER",
    "policy_id": 501,
    "policy": { "rule_name": "Main_Web_Access", "action": "allow" }
  },
  {
    "set_number": 1,
    "type": "LOWER",
    "policy_id": 602,
    "policy": { "rule_name": "Redundant_HTTP_Rule", "action": "allow" }
  }
]
```

### 미참조 객체 분석 결과 예시 (`unreferenced_objects`)
```json
{
  "network_objects": [
    { "name": "TEMP_HOST_01", "type": "ip-netmask", "value": "1.1.1.1" }
  ],
  "service_groups": [
    { "name": "UNUSED_GROUP", "entry": "TCP_8080,UDP_9090" }
  ]
}
```
