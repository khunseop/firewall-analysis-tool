# Firewall Module

다양한 방화벽 벤더와 연동하는 통합 인터페이스를 제공하는 Python 모듈입니다.

## 🔥 주요 개선사항 (v1.2.0)

### 1단계: 기본 안정성 확보 ✅
- **로깅 시스템**: 구조화된 로깅으로 디버깅 및 모니터링 지원
- **예외 처리 강화**: 세분화된 예외 클래스로 정확한 오류 진단
- **입력 검증**: 모든 입력값에 대한 엄격한 검증 로직
- **연결 상태 확인**: 실시간 연결 상태 모니터링

### 성능 최적화 🚀
- **청크 처리**: 대용량 데이터를 메모리 효율적으로 처리
- **재시도 로직**: 지수 백오프를 이용한 스마트 재시도
- **진행률 추적**: 실시간 작업 진행률 모니터링
- **메모리 최적화**: Excel 파일 작성 시 메모리 사용량 최소화

### 사용성 개선 📖
- **상세한 문서화**: API 레퍼런스와 사용 예제
- **타입 힌트**: 모든 함수와 메서드에 타입 힌트 추가
- **진행률 콜백**: 사용자 정의 진행률 표시 지원

## 지원 벤더

| 벤더 | 타입 코드 | 지원 기능 |
|------|-----------|-----------|
| PaloAlto Networks | `paloalto` | 정책, 객체, 그룹, 사용 로그 |
| SECUI NGF | `ngf` | 정책, 객체, 그룹 |
| SECUI MF2 | `mf2` | 정책, 객체, 그룹 |
| Mock (테스트용) | `mock` | 모든 기능 (가상 데이터) |

## 기본 사용법

### 1. 간단한 정책 추출

```python
import firewall_module as fw

# 로깅 설정
logger = fw.setup_firewall_logger(__name__)

try:
    # 정책 데이터 추출
    output_file = fw.export_policy_to_excel(
        vendor="paloalto",
        hostname="192.168.1.100",
        username="admin",
        password="password",
        export_type="policy",
        output_path="./firewall_policies.xlsx"
    )
    
    logger.info(f"정책 추출 완료: {output_file}")
    
except fw.FirewallConnectionError as e:
    logger.error(f"방화벽 연결 실패: {e}")
except fw.FirewallAuthenticationError as e:
    logger.error(f"인증 실패: {e}")
except fw.FirewallDataError as e:
    logger.error(f"데이터 추출 실패: {e}")
```

### 2. 진행률 표시가 있는 전체 데이터 추출

```python
import firewall_module as fw

def progress_callback(current: int, total: int):
    """진행률 콜백 함수"""
    percentage = (current / total) * 100
    print(f"진행률: {percentage:.1f}% ({current}/{total})")

# 로깅 설정
logger = fw.setup_firewall_logger(__name__, level=logging.INFO)

try:
    # 전체 데이터 추출 (진행률 표시)
    output_file = fw.export_policy_to_excel(
        vendor="paloalto",
        hostname="firewall.company.com",
        username="api_user",
        password="secure_password",
        export_type="all",
        output_path="./complete_firewall_data.xlsx",
        config_type="running",
        chunk_size=500,  # 메모리 최적화
        progress_callback=progress_callback
    )
    
    logger.info(f"전체 데이터 추출 완료: {output_file}")
    
except Exception as e:
    logger.error(f"데이터 추출 실패: {e}")
```

### 3. 고급 사용 - Collector 직접 사용

```python
import firewall_module as fw

# 로거 설정
logger = fw.setup_firewall_logger(__name__)

try:
    # Collector 생성
    collector = fw.FirewallCollectorFactory.get_collector(
        source_type="paloalto",
        hostname="192.168.1.100",
        username="admin",
        password="password",
        timeout=60
    )
    
    # 연결 상태 확인
    if collector.is_connected():
        logger.info("방화벽 연결 성공")
        
        # 연결 정보 출력
        conn_info = collector.get_connection_info()
        logger.info(f"연결 정보: {conn_info}")
        
        # 개별 데이터 추출
        policies = collector.export_security_rules(config_type="running")
        addresses = collector.export_network_objects()
        services = collector.export_service_objects()
        
        logger.info(f"추출 완료 - 정책: {len(policies)}개, "
                   f"주소: {len(addresses)}개, 서비스: {len(services)}개")
    
    else:
        logger.error("방화벽 연결 실패")
        
except fw.FirewallUnsupportedError as e:
    logger.error(f"지원하지 않는 방화벽: {e}")
except Exception as e:
    logger.error(f"예상치 못한 오류: {e}")
finally:
    # 연결 해제
    if 'collector' in locals():
        collector.disconnect()
```

### 4. 재시도 로직을 이용한 안정적인 연결

```python
import firewall_module as fw

# 재시도 데코레이터 적용
@fw.retry_on_failure(max_attempts=3, delay=2.0, backoff_factor=2.0)
def extract_policies_with_retry(vendor, hostname, username, password):
    """재시도 로직이 적용된 정책 추출"""
    return fw.export_policy_to_excel(
        vendor=vendor,
        hostname=hostname,
        username=username,
        password=password,
        export_type="policy",
        output_path=f"./policies_{vendor}.xlsx"
    )

# 로거 설정
logger = fw.setup_firewall_logger(__name__)

try:
    # 자동 재시도로 안정적인 데이터 추출
    with fw.performance_monitor("정책 추출", logger):
        output_file = extract_policies_with_retry(
            vendor="paloalto",
            hostname="unstable-firewall.company.com",
            username="admin",
            password="password"
        )
    
    logger.info(f"재시도 로직으로 추출 성공: {output_file}")
    
except Exception as e:
    logger.error(f"최종 실패: {e}")
```

### 5. 입력 검증 활용

```python
import firewall_module as fw

# 지원되는 벤더 확인
supported_vendors = fw.FirewallCollectorFactory.get_supported_vendors()
print(f"지원되는 벤더: {supported_vendors}")

# 특정 벤더의 요구사항 확인
try:
    requirements = fw.FirewallCollectorFactory.get_vendor_requirements("paloalto")
    print(f"PaloAlto 필수 파라미터: {requirements}")
except fw.FirewallUnsupportedError as e:
    print(f"지원하지 않는 벤더: {e}")

# 입력값 검증
validator = fw.FirewallValidator()

try:
    # 호스트명 검증
    hostname = validator.validate_hostname("192.168.1.100")
    
    # 인증 정보 검증
    username, password = validator.validate_credentials("admin", "password123")
    
    # 익스포트 타입 검증
    export_type = validator.validate_export_type("policy")
    
    print("모든 입력값 검증 통과")
    
except fw.FirewallConfigurationError as e:
    print(f"입력 검증 실패: {e}")
```

## API 레퍼런스

### 주요 클래스

#### FirewallInterface
방화벽 연동을 위한 추상 인터페이스

**메서드:**
- `connect() -> bool`: 방화벽 연결
- `disconnect() -> bool`: 연결 해제
- `test_connection() -> bool`: 연결 테스트
- `is_connected() -> bool`: 연결 상태 확인
- `get_connection_info() -> Dict`: 연결 정보 반환

#### FirewallCollectorFactory
방화벽 Collector 인스턴스 생성 팩토리

**메서드:**
- `get_collector(source_type, **kwargs) -> FirewallInterface`: Collector 생성
- `get_supported_vendors() -> list`: 지원 벤더 목록
- `get_vendor_requirements(vendor) -> list`: 벤더별 필수 파라미터

#### FirewallValidator
입력값 검증 유틸리티

**메서드:**
- `validate_hostname(hostname) -> str`: 호스트명 검증
- `validate_credentials(username, password) -> tuple`: 인증 정보 검증
- `validate_source_type(source_type, supported_types) -> str`: 벤더 타입 검증
- `validate_export_type(export_type) -> str`: 익스포트 타입 검증

### 예외 클래스

- `FirewallError`: 기본 예외 클래스
- `FirewallConnectionError`: 연결 실패
- `FirewallAuthenticationError`: 인증 실패
- `FirewallTimeoutError`: 타임아웃
- `FirewallAPIError`: API 호출 실패
- `FirewallConfigurationError`: 설정 오류
- `FirewallDataError`: 데이터 처리 오류
- `FirewallUnsupportedError`: 지원하지 않는 기능

### 유틸리티 함수

#### 로깅
```python
logger = fw.setup_firewall_logger(name, level=logging.INFO)
```

#### 성능 모니터링
```python
with fw.performance_monitor("작업명", logger):
    # 모니터링할 작업
    pass
```

#### 재시도 데코레이터
```python
@fw.retry_on_failure(max_attempts=3, delay=1.0, backoff_factor=2.0)
def your_function():
    pass
```

#### 진행률 추적
```python
tracker = fw.ProgressTracker(total_steps, "작업명", logger)
tracker.update("현재 단계")
tracker.complete()
```

## 로깅 설정

모듈은 구조화된 로깅을 제공합니다:

```python
import logging
import firewall_module as fw

# 기본 로깅 설정
logger = fw.setup_firewall_logger(__name__, level=logging.INFO)

# 더 상세한 로깅을 원하는 경우
logger = fw.setup_firewall_logger(__name__, level=logging.DEBUG)

# 로깅 레벨별 출력
logger.debug("디버그 정보")
logger.info("일반 정보")
logger.warning("경고")
logger.error("오류")
```

## 성능 최적화 팁

### 1. 청크 크기 조절
```python
# 메모리가 제한적인 환경
chunk_size = 500

# 메모리가 충분한 환경
chunk_size = 2000
```

### 2. 필요한 데이터만 추출
```python
# 정책만 필요한 경우
export_type = "policy"

# 주소 객체만 필요한 경우
export_type = "address"
```

### 3. 연결 테스트 생략
```python
collector = fw.FirewallCollectorFactory.get_collector(
    source_type="paloalto",
    hostname="192.168.1.100",
    username="admin",
    password="password",
    test_connection=False  # 빠른 생성
)
```

## 문제 해결

### 일반적인 오류와 해결 방법

1. **FirewallConnectionError**
   - 네트워크 연결 확인
   - 방화벽 관리 포트 접근성 확인
   - 타임아웃 값 증가

2. **FirewallAuthenticationError**
   - 사용자명/비밀번호 확인
   - 계정 권한 확인
   - API 접근 권한 확인

3. **FirewallTimeoutError**
   - 네트워크 지연 확인
   - 타임아웃 값 증가
   - 청크 크기 감소

4. **메모리 부족**
   - 청크 크기 감소
   - 필요한 데이터만 추출
   - 시스템 리소스 확인

### 디버깅

상세한 로깅을 활성화하여 문제를 진단할 수 있습니다:

```python
import logging
import firewall_module as fw

# 디버그 모드 활성화
logger = fw.setup_firewall_logger(__name__, level=logging.DEBUG)

# 모든 모듈의 로깅 활성화
logging.basicConfig(level=logging.DEBUG)
```

## 버전 히스토리

### v1.2.0 (Latest)
- 로깅 시스템 추가
- 예외 처리 강화
- 입력 검증 시스템
- 성능 최적화 (청크 처리, 재시도 로직)
- 진행률 추적 기능
- 상세한 문서화

### v1.1.0
- ShadowAnalyzer 추가
- PolicyFilter 추가
- 기본 기능 안정화

### v1.0.0
- 초기 릴리스
- 기본 방화벽 연동 기능

## 라이선스

MIT License

## 기여하기

1. 이슈 리포트
2. 기능 요청
3. Pull Request

## 지원

- GitHub Issues: 버그 리포트 및 기능 요청
- 문서: 상세한 API 문서와 예제 