# 방화벽 서비스 모듈 (Firewall Service Module)

이 모듈은 다양한 벤더의 방화벽 장비로부터 정책, 객체, 시스템 정보를 일관된 방식으로 수집하기 위한 추상화 계층을 제공합니다.

## 모듈 목적
- **다중 벤더 추상화**: Palo Alto, SECUI MF2, AhnLab TrusGuard 등 서로 다른 인터페이스(XML API, REST API, SSH/CLI)를 가진 장비들을 동일한 메서드로 제어합니다.
- **데이터 표준화**: 각 장비의 고유한 응답 형식을 분석하여 Pandas DataFrame 형태의 표준화된 스키마로 변환합니다.

## 아키텍처 구조
이 모듈은 **Interface-Factory-Vendor** 패턴을 따릅니다.

1.  **Interface (`interface.py`)**: 모든 방화벽 벤더가 구현해야 하는 추상 베이스 클래스(`FirewallInterface`)를 정의합니다.
2.  **Factory (`factory.py`)**: 장비 모델명 또는 제조사 정보를 기반으로 적절한 벤더 클래스 인스턴스를 생성합니다.
3.  **Vendors (`vendors/`)**: 각 제조사별 실제 구현체들이 포함되어 있습니다.
    - `paloalto.py`: Palo Alto PAN-OS (XML API & SSH)
    - `mf2.py`: SECUI MF2 (SSH & Regex Parsing)
    - `ngf.py`: AhnLab TrusGuard NGF (REST API)

## 신규 벤더 추가 가이드
새로운 방화벽 제조사를 지원하려면 다음 단계를 따르세요.

1.  `firewall_manager/app/services/firewall/vendors/` 디렉토리에 새 파이썬 파일(예: `juniper.py`)을 생성합니다.
2.  `FirewallInterface`를 상속받는 클래스를 구현합니다.
3.  다음 필수 메서드들을 오버라이딩합니다:
    - `connect()`, `disconnect()`: 인증 및 세션 관리
    - `export_security_rules()`: 보안 정책 수집
    - `export_network_objects()`, `export_network_group_objects()`: 주소 객체 수집
    - `export_service_objects()`, `export_service_group_objects()`: 서비스(포트) 객체 수집
4.  `firewall_manager/app/services/firewall/factory.py`의 `get_collector` 메서드에 새 벤더를 등록합니다.

## 기대 데이터 스키마 (Expected DataFrame Schemas)

모든 `export_*` 메서드는 아래 지정된 컬럼을 포함하는 Pandas DataFrame을 반환해야 합니다.

### 1. 보안 정책 (`export_security_rules`)
| 컬럼명 | 설명 | 예시 |
| :--- | :--- | :--- |
| `vsys` | 가상 시스템/컨텍스트 이름 | `vsys1` |
| `seq` | 정책 순번 (1부터 시작) | `1` |
| `rule_name` | 정책 이름 또는 ID | `Web_Access_Policy` |
| `enable` | 활성화 여부 (Y/N) | `Y` |
| `action` | 허용/차단 (allow/deny) | `allow` |
| `source` | 출발지 객체 (콤마 구분) | `Internal_Net,DMZ_Host` |
| `destination` | 목적지 객체 (콤마 구분) | `Any` |
| `service` | 서비스/포트 객체 (콤마 구분) | `HTTP,HTTPS` |
| `user` | 사용자 정보 | `any` |
| `application` | 애플리케이션 필터 | `web-browsing` |
| `description` | 정책 설명 | `User access to web` |

### 2. 네트워크 객체 (`export_network_objects`)
| 컬럼명 | 설명 | 예시 |
| :--- | :--- | :--- |
| `Name` | 객체 이름 | `Net_10_1_1_0` |
| `Type` | 객체 타입 | `ip-netmask`, `ip-range`, `fqdn` |
| `Value` | 실제 주소 값 | `10.1.1.0/24`, `192.168.1.1-192.168.1.10` |

### 3. 네트워크 그룹 객체 (`export_network_group_objects`)
| 컬럼명 | 설명 | 예시 |
| :--- | :--- | :--- |
| `Group Name` | 그룹 이름 | `Internal_Networks` |
| `Entry` | 포함된 멤버 이름 (콤마 구분) | `Net_A,Net_B,Host_C` |

### 4. 서비스 객체 (`export_service_objects`)
| 컬럼명 | 설명 | 예시 |
| :--- | :--- | :--- |
| `Name` | 서비스 이름 | `TCP_8080` |
| `Protocol` | 프로토콜 | `tcp`, `udp`, `icmp` |
| `Port` | 포트 번호 | `8080`, `1-65535` |

### 5. 서비스 그룹 객체 (`export_service_group_objects`)
| 컬럼명 | 설명 | 예시 |
| :--- | :--- | :--- |
| `Group Name` | 그룹 이름 | `Web_Services` |
| `Entry` | 포함된 서비스 멤버 (콤마 구분) | `HTTP,HTTPS,Custom_Proxy` |
