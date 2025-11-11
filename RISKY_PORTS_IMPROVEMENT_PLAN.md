# 위험 포트 분석 개선 계획 (재작성)

## 근본적인 문제점

### 핵심 문제: `filtered_members`가 비어있는 이유

1. **그룹 멤버는 `original_service_objects`에 포함되지 않음**
   - 정책에서 직접 사용된 것은 그룹(`ServiceGroup_Admin_2`)이지, 그룹의 멤버(`Svc_3389`, `Svc_8080`)가 아님
   - 따라서 `filtered_service_objects`에도 그룹 멤버가 포함되지 않음

2. **`filtered_members` 생성 로직의 문제**
   - 현재 로직: `filtered_service_objects`에 있는 멤버만 `filtered_members`에 포함
   - 문제: 그룹 멤버는 `filtered_service_objects`에 없으므로 모두 제외됨
   - 결과: `filtered_members`가 비어있음

3. **복잡한 분리 로직의 문제**
   - 여러 포트 범위를 가진 서비스 객체를 여러 개로 분리 (`ServiceName_TCP_1`, `ServiceName_TCP_2` 등)
   - 그룹 멤버를 분리된 객체 이름으로 변환하는 복잡한 로직
   - 실제로는 불필요한 복잡성

## 해결 방안

### 원칙

1. **그룹 멤버는 방화벽에 이미 존재하는 객체**
   - 그룹의 멤버는 정책에서 직접 사용되지 않았지만, 방화벽에 이미 존재하는 서비스 객체
   - 따라서 `filtered_members`에 원본 멤버 이름을 그대로 사용 가능

2. **위험 포트가 있는 멤버는 제외**
   - 그룹의 `filtered_members`에는 위험 포트가 없는 멤버만 포함
   - 위험 포트가 있는 멤버는 제외 (개별 서비스 객체 생성 불필요)

3. **서비스 객체는 프로토콜별로만 분리**
   - 여러 포트 범위가 있어도 하나의 서비스 객체로 유지
   - 프로토콜이 다르면 별도의 서비스 객체로 생성 (Palo Alto 요구사항)

### 수정 사항

#### 백엔드 (`risky_ports.py`)

**현재 문제점:**
```python
# 529-543 라인: filtered_members 생성 로직
if not member_has_risky:
    found_original = any(
        f_obj.get("type") == "service" and 
        f_obj.get("name") == member_name and
        f_obj.get("original_name") == member_name
        for f_obj in filtered_service_objects
    )
    if found_original:
        filtered_members.append(member_name)
    else:
        filtered_members.append(member_name)  # 이미 이렇게 되어 있지만 작동하지 않음
```

**문제:** `filtered_service_objects`에 멤버가 없어도 포함하도록 되어 있지만, 실제로는 작동하지 않음

**해결책:**
```python
# 그룹 멤버는 방화벽에 이미 존재하는 객체이므로, 
# filtered_service_objects에 없어도 무조건 포함
if not member_has_risky:
    filtered_members.append(member_name)
```

#### 프론트엔드 (`scriptGenerator.js`)

**현재 문제점:**
- `serviceObjectsToGroups` 맵을 사용하여 여러 포트 범위로 분리된 서비스 객체를 처리
- 복잡한 멤버 변환 로직

**해결책:**
- `filtered_members`에 있는 멤버 이름을 그대로 사용
- 분리 로직 제거

## 구현 계획

### 1단계: 백엔드 수정 (즉시 적용)

#### 1.1 `filtered_members` 생성 로직 단순화
```python
# Safe 그룹의 필터된 멤버 목록 생성
# 위험 포트가 없는 멤버만 포함 (위험 포트가 있는 멤버는 제외)
filtered_members = []
for member_name in group_members:
    # 이 멤버가 위험 포트를 가지고 있는지 확인
    member_has_risky = (
        member_name in services_with_removed_ports or 
        self._check_service_has_risky_port(member_name)
    )
    
    if not member_has_risky:
        # 위험 포트가 없는 멤버는 무조건 포함
        # (그룹 멤버는 방화벽에 이미 존재하는 객체이므로)
        filtered_members.append(member_name)
    # 위험 포트가 있는 멤버는 제외
```

**변경 사항:**
- `filtered_service_objects`에 있는지 확인하는 로직 제거
- 위험 포트가 없는 멤버는 무조건 포함

### 2단계: 프론트엔드 단순화 (선택적)

#### 2.1 여러 포트 범위 분리 로직 제거
- `serviceObjectsToGroups` 맵 제거
- 여러 포트 범위를 하나의 서비스 객체로 유지
- 프로토콜별로만 분리

#### 2.2 그룹 멤버 처리 단순화
- `filtered_members`에 있는 멤버 이름을 그대로 사용
- 변환 로직 제거

## 예상 결과

### 입력 예시
```json
{
  "filtered_service_objects": [
    {
      "type": "group",
      "name": "ServiceGroup_Admin_2_Safe",
      "original_name": "ServiceGroup_Admin_2",
      "filtered_members": ["Svc_8080"]  // Svc_3389는 위험 포트가 있어서 제외됨
    }
  ]
}
```

### 출력 (Palo Alto CLI)
```
set service-group ServiceGroup_Admin_2_Safe members [ Svc_8080 ]
```

## 검증 방법

1. 백엔드 수정 후 재시작
2. 위험 포트 분석 재실행
3. 콘솔 로그 확인:
   - `filtered_members`가 비어있지 않은지 확인
   - 위험 포트가 없는 멤버만 포함되는지 확인
4. 생성된 스크립트 확인:
   - 그룹의 `filtered_members`에 있는 멤버가 스크립트에 포함되는지 확인

## 주의사항

1. **백엔드 재시작 필수**: 코드 수정 후 반드시 재시작해야 함
2. **하위 호환성**: 기존 분석 결과와의 호환성 유지
3. **테스트**: 다양한 시나리오에서 테스트 필요

## 다음 단계

1. ✅ 백엔드 `filtered_members` 생성 로직 단순화 (완료)
2. ✅ 백엔드 로깅 강화 및 검증 로직 개선 (완료)
3. ✅ 프론트엔드 단순화 (완료)
4. ✅ `_check_service_has_risky_port` 재귀적 그룹 확인 지원 (완료)
5. ⏳ 백엔드 재시작 및 테스트
6. ⏳ 전체 시나리오 테스트

## 구현 완료 사항

### 백엔드 개선
1. **`filtered_members` 생성 로직 검증 강화**
   - 위험 포트가 있는 멤버와 없는 멤버를 명확히 분리
   - 상세한 로깅 추가 (원본 멤버, 필터된 멤버, 제외된 멤버 개수)
   - `filtered_members`가 비어있는 경우 경고 로그 추가

2. **`_check_service_has_risky_port` 메서드 개선**
   - 서비스 그룹의 멤버도 재귀적으로 확인하도록 개선
   - 순환 참조 방지 로직 추가
   - 중첩된 그룹 구조도 정확히 검증 가능

### 프론트엔드 개선
1. **멤버 변환 로직 단순화**
   - 복잡한 멤버 변환 로직 제거
   - `filtered_members`에 있는 멤버 이름을 그대로 사용
   - `_Safe` 버전이 새로 생성된 경우에만 우선 사용
   - 상세한 콘솔 로그 추가로 디버깅 용이

## 검증 포인트

1. **백엔드 검증**
   - 그룹 멤버가 위험 포트를 가지고 있는지 정확히 확인
   - `filtered_members`에 위험 포트가 없는 멤버만 포함되는지 확인
   - 로그를 통해 각 멤버의 처리 과정 추적 가능

2. **프론트엔드 검증**
   - `filtered_members`에 있는 멤버가 스크립트에 올바르게 포함되는지 확인
   - 새로 생성된 `_Safe` 버전이 우선 사용되는지 확인
   - 원본 멤버가 올바르게 사용되는지 확인
