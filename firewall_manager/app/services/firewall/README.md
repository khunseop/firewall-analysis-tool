# Firewall Service Module (방화벽 서비스 모듈)

이 모듈은 다양한 벤더의 방화벽 장비로부터 정책, 객체, 시스템 정보를 일관된 방식으로 수집하기 위한 추상화 계층을 제공합니다.

## 1. 개요 (Overview)
- **다중 벤더 추상화**: Palo Alto, SECUI MF2, SECUI NGF 등 서로 다른 인터페이스를 가진 장비들을 동일한 메서드로 제어합니다.
- **데이터 표준화**: 각 장비의 고유한 응답 형식을 분석하여 Pandas DataFrame 형태의 표준화된 스키마로 변환합니다.

## 2. 아키텍처 및 구성 (Architecture)
이 모듈은 **Interface-Factory-Vendor** 패턴을 따릅니다.

1.  **Interface (`interface.py`)**: 모든 방화벽 벤더가 구현해야 하는 추상 베이스 클래스(`FirewallInterface`)를 정의합니다.
2.  **Factory (`factory.py`)**: 장비 모델명 또는 제조사 정보를 기반으로 적절한 벤더 클래스 인스턴스를 생성합니다.
3.  **Vendors (`vendors/`)**: 각 제조사별 실제 구현체들이 포함되어 있습니다.
    - `paloalto.py`: **PaloAltoAPI** 구현체. 정책 및 객체 수집에는 **XML API**를 사용하며, 히트 정보(`last_hit_date`) 수집 시 선택적으로 **SSH**를 병행합니다.
    - `mf2.py`: **MF2Collector** 구현체. **SSH** 접속 후 CLI 명령어를 수행하고 **Regex(정규표현식)**를 통해 결과를 파싱합니다.
    - `ngf.py`: **NGFCollector** 구현체. SECUI NGF의  **REST API**를 사용하여 데이터를 수집합니다.

## 3. 주요 로직 및 흐름 (Main Flow)

1.  **연결 (`connect`)**: 장비의 IP, 포트, 계정 정보를 사용하여 세션을 수립합니다. (API Token 획득 또는 SSH 채널 오픈)
2.  **데이터 수집 (`export_*`)**: 벤더별 프로토콜에 따라 원시 데이터를 요청합니다.
3.  **정규화**: 수집된 원시 데이터(XML, JSON, CLI Text)를 Pandas DataFrame으로 변환하며, 컬럼명을 시스템 표준 규격으로 변경합니다.
4.  **연결 종료 (`disconnect`)**: 세션을 명시적으로 종료하여 장비 자원을 반납합니다.

## 4. 데이터 규격 (Data Specification)

모든 `export_*` 메서드는 아래 지정된 컬럼을 포함하는 Pandas DataFrame을 반환해야 합니다.

### 보안 정책 (`export_security_rules`)
| 컬럼명 | 설명 | 데이터 타입/예시 |
| :--- | :--- | :--- |
| `vsys` | 가상 시스템/컨텍스트 이름 | `vsys1` |
| `seq` | 정책 순번 (1부터 시작) | `1` |
| `rule_name` | 정책 이름 또는 ID | `Web_Access_Policy` |
| `enable` | 활성화 여부 (**'Y' 또는 'N' 문자열**) | **`Y`**, `N` |
| `action` | 허용/차단 (allow/deny) | `allow` |
| `source` | 출발지 객체 (콤마 구분) | `Internal_Net,DMZ_Host` |
| `destination` | 목적지 객체 (콤마 구분) | `Any` |
| `service` | 서비스/포트 객체 (콤마 구분) | `HTTP,HTTPS` |
| `user` | 사용자 정보 | `any` |
| `application` | 애플리케이션 필터 | `web-browsing` |
| `description` | 정책 설명 | `User access to web` |

### 네트워크 객체 (`export_network_objects`)
| 컬럼명 | 설명 | 예시 |
| :--- | :--- | :--- |
| `Name` | 객체 이름 | `Net_10_1_1_0` |
| `Type` | 객체 타입 | `ip-netmask`, `ip-range`, `fqdn` |
| `Value` | 실제 주소 값 | `10.1.1.0/24`, `192.168.1.1-192.168.1.10` |

### 서비스 객체 (`export_service_objects`)
| 컬럼명 | 설명 | 예시 |
| :--- | :--- | :--- |
| `Name` | 서비스 이름 | `TCP_8080` |
| `Protocol` | 프로토콜 | `tcp`, `udp`, `icmp` |
| `Port` | 포트 번호 | `8080`, `1-65535` |
