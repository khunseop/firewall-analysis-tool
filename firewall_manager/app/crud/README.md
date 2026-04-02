# CRUD Layer (Data Access Object)

이 디렉토리는 애플리케이션의 데이터 접근 계층(DAO)을 담당하며, SQLAlchemy 비동기 세션(`AsyncSession`)을 사용하여 효율적인 데이터베이스 연산을 수행합니다.

## 1. 개요 (Overview)

CRUD 계층은 복잡한 방화벽 정책과 객체 간의 관계를 관리하며, 특히 대용량 데이터의 수집 및 검색 성능을 최적화하는 데 중점을 둡니다. 데이터 무결성을 위해 모든 관련 테이블은 외래키(Foreign Key)로 연결되어 있으며, 성능 향상을 위한 멤버 인덱싱(Member Indexing) 기법을 적용했습니다.

## 2. 아키텍처 및 구성 (Architecture)

### 주요 CRUD 모듈
- **`crud_policy.py`**: 보안 정책의 조회, 생성, 수정 및 복합 인덱스 검색을 담당합니다.
- **`crud_device.py`**: 장비 정보 관리 및 장비 삭제 시 연관된 대규모 데이터의 일괄 삭제 로직을 포함합니다.
- **`crud_analysis.py`**: 비동기 분석 작업(`AnalysisTask`)의 상태 관리 및 결과 저장(`AnalysisResult`)을 처리합니다.

### 멤버 인덱싱 기반 검색 알고리즘
문자열 기반 검색의 한계를 극복하기 위해 모든 IP와 포트를 숫자 범위로 전개하여 검색합니다.
- **`PolicyAddressMember`**: 정책별 출발지/목적지 IP를 `ip_start`, `ip_end` 숫자 범위로 저장.
- **`PolicyServiceMember`**: 정책별 서비스/포트를 `port_start`, `port_end` 숫자 범위로 저장.

## 3. 주요 로직 및 흐름 (Main Flow)

### 인덱싱 기반 정책 검색 (`search_policies`)
사용자가 특정 IP 대역으로 정책을 검색할 때의 내부 흐름은 다음과 같습니다.

1.  **변환**: 검색어(예: `10.1.1.0/24`)를 숫자 범위(`start`, `end`)로 변환합니다.
2.  **인덱스 조회 (SQL)**: `PolicyAddressMember` 테이블에서 검색 범위와 중첩(Overlapping)되는 정책 ID들을 추출합니다.
    ```sql
    SELECT policy_id FROM policy_address_members
    WHERE direction = 'source' 
      AND ip_start <= :search_end -- 정책 시작점이 검색 종료점보다 작거나 같고
      AND ip_end >= :search_start  -- 정책 종료점이 검색 시작점보다 크거나 같음
    ```
3.  **교집합 연산**: 출발지 IP, 목적지 IP, 서비스 인덱스 조회 결과를 교집합(`intersection`)하여 모든 조건을 만족하는 최종 정책 ID 목록을 확정합니다.
4.  **최종 조회**: 확정된 정책 ID를 기반으로 `Policy` 테이블에서 상세 정보를 로드합니다.

## 4. 데이터 규격 및 최적화 (Data Specification)

### 대용량 데이터 삭제 최적화
장비 삭제 시 수만 건의 정책과 수십만 건의 인덱스 데이터를 삭제해야 합니다. 일반적인 Cascade 삭제는 성능이 낮으므로 `crud_device.py`의 `remove_device` 메서드에서는 다음과 같은 명시적 벌크 삭제 방식을 사용합니다.

- **순차적 테이블 삭제**: 외래키 제약조건을 고려하여 하위 인덱스 테이블부터 상위 테이블 순으로 `DELETE` 문을 개별 실행합니다.
- **트랜잭션 관리**: 모든 삭제 작업은 단일 트랜잭션 블록 내에서 실행되어, 오류 발생 시 데이터 일관성을 보장합니다.

### 벌크 삽입 (Bulk Insert)
동기화 모듈에서 수집된 대량의 데이터는 `AsyncSession.run_sync`와 `bulk_insert_mappings`를 조합하여 DB 엔진 레벨에서 고속으로 처리합니다.
