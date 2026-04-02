# CRUD Layer (Data Access Object)

이 디렉토리는 애플리케이션의 데이터 접근 계층(DAO)을 담당하며, SQLAlchemy 비동기 세션(`AsyncSession`)을 사용하여 데이터베이스 연산을 수행합니다.

## 1. 전체 데이터베이스 스키마 및 관계 (ERD 개요)

시스템은 다음과 같은 주요 엔티티들로 구성되어 있습니다:

- **Device (장비)**: 방화벽 장비 정보를 관리합니다. 모든 정책과 객체는 특정 장비에 종속됩니다.
- **Policy (정책)**: 방화벽 보안 규칙 정보를 저장합니다.
- **NetworkObject & NetworkGroup**: IP 주소, 대역폭, FQDN 등을 정의하는 네트워크 객체 및 그룹입니다.
- **Service & ServiceGroup**: TCP/UDP 포트 및 프로토콜을 정의하는 서비스 객체 및 그룹입니다.
- **Member Indexes (인덱싱 테이블)**:
    - `PolicyAddressMember`: 정책 내의 모든 IP(출발지/목적지)를 개별 행으로 전개하여 저장합니다.
    - `PolicyServiceMember`: 정책 내의 모든 서비스(포트/프로토콜)를 개별 행으로 전개하여 저장합니다.

### 주요 관계:
- `Device` (1) : (N) `Policy`
- `Device` (1) : (N) `NetworkObject` / `Service`
- `Policy` (1) : (N) `PolicyAddressMember` / `PolicyServiceMember`

---

## 2. 인덱싱 기반 정책 검색 알고리즘

방화벽 정책은 출발지/목적지/서비스 항목에 수많은 객체와 그룹이 포함될 수 있어 일반적인 문자열 매칭으로는 검색 성능을 보장할 수 없습니다. 이를 해결하기 위해 **멤버 인덱싱(Member Indexing)** 방식을 사용합니다.

### IP/Port 범위 검색 원리 (Range Search)
모든 IP 주소와 포트는 내부적으로 **숫자 형태의 시작값(Start)과 종료값(End)**으로 변환되어 저장됩니다.

- **IPv4**: 32비트 정수형(`BIGINT`)으로 변환 (예: `192.168.0.1` -> `3232235521`)
- **Port**: 0~65535 정수형으로 저장

#### 검색 쿼리 예시 (중첩 구간 검색):
사용자가 `192.168.0.10 ~ 192.168.0.20` 범위 내의 정책을 검색할 때, DB 인덱스를 활용하여 다음과 같은 조건으로 정책을 추출합니다:
```sql
WHERE PolicyAddressMember.ip_start <= :search_end
  AND PolicyAddressMember.ip_end >= :search_start
```
이 방식은 단일 IP 검색뿐만 아니라 대역폭(CIDR) 간의 중첩 여부를 매우 빠르게 판단할 수 있게 합니다.

---

## 3. 대용량 데이터 처리를 위한 최적화

방화벽 장비의 수만 건 이상의 정책과 수십만 건의 인덱스 데이터를 효율적으로 처리하기 위해 다음과 같은 기법을 적용했습니다.

### Bulk 연산 (Bulk Operations)
- **`AsyncSession.add_all()`**: 수천 개의 객체를 단일 트랜잭션 내에서 생성하여 오버헤드를 최소화합니다.
- **Chunking**: 동기화 과정에서 수집된 데이터를 일정 단위(예: 1,000개)로 나누어 처리함으로써 메모리 사용량을 조절합니다.

### 비동기 처리 (Asynchronous Execution)
- **`AsyncSession` 활용**: I/O 바운드 작업인 DB 쿼리 수행 시 이벤트 루프를 차단하지 않아, 다수의 사용자가 동시에 검색하거나 대규모 분석 작업이 진행 중일 때도 API 응답성을 유지합니다.

### 효율적인 삭제 (Cascade Deletion 대체)
- 장비 삭제와 같은 대규모 연관 데이터 삭제 시, 외래키 제약 조건을 순차적으로 처리하는 대신 관련 테이블별로 `DELETE` 문을 명시적으로 실행하여 속도를 향상시킵니다 (`crud_device.py`의 `remove_device` 참고).
