# 위험 포트 분석 개선 계획

## 현재 문제점

### 1. 여러 포트 범위 분리 로직의 문제
- **현재 동작**: 서비스 객체가 여러 포트 범위를 가지면 `ServiceName_TCP_1`, `ServiceName_TCP_2` 등으로 분리
- **문제**: 시나리오3에서 요구하는 것처럼 하나의 서비스 객체로 유지되어야 함
- **예시**:
  ```
  원본: CustomService (tcp/10-15, tcp/20-25)
  위험 포트: tcp/12, tcp/14, tcp/22
  
  현재 결과: CustomService_Safe_TCP_1 (tcp/10-11), CustomService_Safe_TCP_2 (tcp/13), ...
  원하는 결과: CustomService_Safe (tcp/10-11, tcp/13, tcp/15, tcp/20-21, tcp/23-25)
  ```

### 2. 프로토콜별 분리 로직
- **현재 동작**: 프로토콜별로 서비스 객체를 분리하고, 각 프로토콜 내에서도 여러 범위로 분리
- **문제**: 프로토콜별 분리는 필요하지만, 각 프로토콜 내에서는 하나의 서비스 객체로 유지해야 함
- **예시**:
  ```
  원본: WebService (tcp/80, tcp/443, udp/53)
  위험 포트: tcp/80
  
  현재 결과: WebService_Safe_TCP_1 (tcp/443), WebService_Safe_UDP_1 (udp/53)
  원하는 결과: 
    - WebService_Safe (tcp/443) - 프로토콜별로는 분리
    - WebService_Safe (udp/53) - 하지만 각 프로토콜 내에서는 하나의 객체
  ```

### 3. 그룹 멤버 처리의 복잡성
- **현재 동작**: `script_members`를 사용하여 여러 포트 범위로 분리된 서비스 객체를 그룹 멤버로 포함
- **문제**: 그룹 멤버는 원본 서비스 객체 이름을 유지해야 하며, 분리된 객체 이름을 사용하면 안 됨

## 개선 목표

### 원칙
1. **서비스 객체 구조 유지**: 여러 포트 범위가 있어도 하나의 서비스 객체로 유지
2. **프로토콜별 분리**: 프로토콜이 다르면 별도의 서비스 객체로 생성 (Palo Alto 요구사항)
3. **그룹 멤버 단순화**: 그룹 멤버는 원본 서비스 객체 이름 사용

### 시나리오별 기대 결과

#### 시나리오 1: 단순한 경우
```
원본: HTTP 서비스 (tcp/80, tcp/443)
위험 포트: tcp/80
결과: HTTP_Safe 서비스 (tcp/443) - 하나의 서비스 객체
```

#### 시나리오 2: 그룹의 경우
```
원본 그룹: WebServices (HTTP, HTTPS)
- HTTP: tcp/80, tcp/443
- HTTPS: tcp/443, tcp/8443
위험 포트: tcp/80

결과:
- HTTP_Safe: tcp/443
- HTTPS: tcp/443, tcp/8443 (변경 없음)
- WebServices_Safe 그룹: [HTTP_Safe, HTTPS]
```

#### 시나리오 3: 여러 포트 범위가 있는 경우 (그룹 내 범위)
```
원본: CustomService (tcp/10-15, tcp/20-25)
위험 포트: tcp/12, tcp/14, tcp/22

결과: CustomService_Safe (tcp/10-11, tcp/13, tcp/15, tcp/20-21, tcp/23-25)
- 하나의 서비스 객체로 유지
- 프로토콜이 같으므로 하나의 서비스 객체
```

#### 시나리오 4: 여러 프로토콜이 있는 경우
```
원본: MixedService (tcp/80, tcp/443, udp/53, udp/123)
위험 포트: tcp/80

결과:
- MixedService_Safe (tcp/443) - TCP 프로토콜용
- MixedService_Safe (udp/53, udp/123) - UDP 프로토콜용
- 프로토콜별로는 분리되지만, 각 프로토콜 내에서는 하나의 객체
```

## 구현 계획

### 1. 백엔드 개선 (`risky_ports.py`)

#### 1.1 `_generate_script_members` 메서드 제거 또는 단순화
- **현재**: 여러 포트 범위를 분리하여 여러 서비스 객체 이름 생성
- **개선**: 프로토콜별로만 분리하고, 각 프로토콜 내에서는 하나의 서비스 객체 이름만 반환
- **변경 사항**:
  ```python
  # 현재 반환값
  {
      "members": ["Service_Safe_TCP_1", "Service_Safe_TCP_2"],
      "member_tokens": {...}
  }
  
  # 개선 후 반환값
  {
      "members": ["Service_Safe"],  # 프로토콜별로는 분리되지만, 각 프로토콜 내에서는 하나
      "member_tokens": {"Service_Safe": ["tcp/10-11", "tcp/13", ...]}
  }
  ```

#### 1.2 서비스 객체 생성 로직 단순화
- `script_members`와 `script_member_tokens` 필드 제거
- `filtered_tokens`만 사용하여 스크립트 생성
- 프로토콜별 분리는 프론트엔드에서 처리

#### 1.3 그룹 멤버 처리 단순화
- `filtered_members`에 원본 서비스 객체 이름만 포함
- 분리된 서비스 객체 이름 사용하지 않음

### 2. 프론트엔드 개선 (`scriptGenerator.js`)

#### 2.1 서비스 객체 생성 로직 단순화
- 프로토콜별로 서비스 객체 생성 (Palo Alto 요구사항)
- 각 프로토콜 내에서는 하나의 서비스 객체로 유지
- 여러 포트 범위를 하나의 서비스 객체에 포함

#### 2.2 그룹 멤버 처리 단순화
- `filtered_members`에 있는 서비스 객체 이름을 그대로 사용
- 분리 로직 제거

### 3. 제거할 코드

#### 백엔드
- `_generate_script_members` 메서드의 복잡한 분리 로직
- `script_members`, `script_member_tokens` 필드 생성 로직
- 그룹의 `filtered_members`에서 `script_members` 사용하는 로직

#### 프론트엔드
- `serviceObjectsToGroups` 맵 및 관련 로직
- 여러 포트 범위로 분리하는 로직
- `script_member_tokens` 사용하는 로직

## 예상 결과

### 코드 라인 수 감소
- 백엔드: 약 200줄 감소 (850줄 → 650줄)
- 프론트엔드: 약 100줄 감소 (250줄 → 150줄)

### 스크립트 생성 예시

#### 입력
```json
{
  "filtered_service_objects": [
    {
      "type": "service",
      "name": "HTTP_Safe",
      "filtered_tokens": ["tcp/443"]
    },
    {
      "type": "service",
      "name": "CustomService_Safe",
      "filtered_tokens": ["tcp/10-11", "tcp/13", "tcp/15", "tcp/20-21", "tcp/23-25"]
    },
    {
      "type": "group",
      "name": "WebServices_Safe",
      "filtered_members": ["HTTP_Safe", "HTTPS"]
    }
  ]
}
```

#### 출력 (Palo Alto CLI)
```
set service HTTP_Safe protocol tcp port 443

set service CustomService_Safe protocol tcp port 10-11,13,15,20-21,23-25

set service-group WebServices_Safe members [ HTTP_Safe HTTPS ]
```

## 검증 방법

1. 시나리오별 테스트 케이스 작성
2. 각 시나리오에서 생성된 스크립트 검증
3. 실제 방화벽에 적용 가능한지 확인

## 주의사항

1. **Palo Alto 제약사항**: 프로토콜별로 서비스 객체를 분리해야 함
2. **하위 호환성**: 기존 분석 결과와의 호환성 유지
3. **성능**: 코드 단순화로 인한 성능 개선 확인

