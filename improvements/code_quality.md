# 코드 품질 개선사항

---

## 심각도: 중간

### 1. 광범위한 `except Exception:` 사용
- **위치**: 코드베이스 전반 (`devices.py:340`, `sync/tasks.py:166` 등)
- **문제**: 구체적인 예외 타입 없이 모든 예외를 포착. `KeyboardInterrupt`, `SystemExit` 등 의도치 않은 예외까지 삼킴. 디버깅 어려움
- **개선**: 예상 가능한 예외 타입 명시
  ```python
  # 현재
  except Exception as e:
      logger.error(e)
  
  # 개선
  except (ValueError, OSError) as e:
      logger.error(e)
  ```

### 2. 프론트엔드 빈 catch 블록
- **위치**: `app/frontend/js/api.js:12`
- **문제**: `catch {}` 빈 블록으로 JSON 파싱 오류 등을 무음 처리. 사용자에게 오류 표시 없음, 디버깅 불가
- **개선**:
  ```js
  // 현재
  try { ... } catch {}
  
  // 개선
  try { ... } catch (e) {
      console.error('API 응답 파싱 실패:', e);
      showNotification('오류가 발생했습니다', 'error');
  }
  ```

### 3. 분석 백그라운드 태스크에 DB 세션 직접 전달
- **위치**: `app/api/api_v1/endpoints/analysis.py:37, 121, 149, 170, 193, 216`
- **문제**: 활성 DB 세션을 백그라운드 태스크에 전달. 태스크 실행 전 세션이 닫힐 수 있음 (request lifecycle 종료)
- **개선**: 세션 대신 `device_id` 등 식별자만 전달하고, 태스크 내에서 새 세션 생성
  ```python
  # 현재
  background_tasks.add_task(run_analysis, db, device_id)
  
  # 개선
  background_tasks.add_task(run_analysis, device_id)
  # run_analysis 내부에서: async with AsyncSessionLocal() as db:
  ```

---

## 심각도: 낮음

### 4. 매직 넘버 상수화 필요
- **위치**: `app/frontend/js/utils/storage.js:37`
- **문제**: `7 * 24 * 60 * 60 * 1000` (7일 만료) 하드코딩. 의미 불명확
- **개선**:
  ```js
  const STORAGE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7일
  ```

### 5. setTimeout 중첩 재시도 로직
- **위치**: `app/frontend/js/pages/analysis/riskyPorts.js:95-144`
- **문제**: 300ms 간격 최대 5회 재시도 로직이 중첩 setTimeout으로 구현됨. 가독성 낮음, 슬로우 환경에서 5 × 300ms = 1.5초로 너무 짧을 수 있음
- **개선**: Promise 기반 retry 유틸리티 함수로 추출
  ```js
  async function retryUntil(fn, maxRetries = 5, delayMs = 300) {
      for (let i = 0; i < maxRetries; i++) {
          const result = await fn();
          if (result) return result;
          await new Promise(r => setTimeout(r, delayMs));
      }
      throw new Error('재시도 초과');
  }
  ```

### 6. 미사용 import
- **위치**: `app/api/api_v1/endpoints/firewall_query.py:101-104`
- **문제**: `Union` import가 존재하나 실제 사용되지 않음
- **개선**: 미사용 import 제거

### 7. 한국어/영어 에러 메시지 혼재
- **위치**: `app/crud/crud_policy.py:150` (영어), `app/api/api_v1/endpoints/analysis.py:99` (한국어)
- **문제**: API 응답 에러 메시지 언어 일관성 없음
- **개선**: 한국어로 통일 (내부 사용 툴이므로), 또는 에러 코드 + 메시지 구조 도입
