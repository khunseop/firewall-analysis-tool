# 프론트엔드 UX 2차 점검 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실제 dev 서버(Playwright 헤드리스 + 실제 Chrome 양쪽)를 띄워 로그인/대시보드 플로우를 직접 조작하며 찾은 UX 버그를 고친다.

**Architecture:** 로그인 실패 메시지가 백엔드가 보내는 한국어 상세 사유 대신 axios 기본 영어 메시지로 표시되는 근본 원인 하나만 수정한다 (`api/auth.ts`가 `apiClient`를 거치지 않고 원시 `axios`를 써서 `client.ts`의 에러 메시지 추출 로직을 못 타는 문제).

**Tech Stack:** 기존 스택 그대로 — 새 의존성 없음.

**Spec:** `docs/superpowers/plans/2026-09-30-production-readiness-roadmap.md` (항목 8, 2차 점검)

## Global Constraints

- `api/auth.ts`의 `login()`이 원시 `axios`를 쓰는 이유(전역 401 인터셉터의 로그아웃+리다이렉트를 로그인 페이지 자체에서는 피하기 위함)는 그대로 유지한다 — `apiClient`로 바꾸지 않는다. 메시지 추출 로직만 가져온다.

---

## 이번 점검에서 실제로 확인한 것

### 확인된 버그 (이번에 수정)

- **로그인 실패 시 영어 원시 에러 메시지 노출**: `api/auth.ts`의 `login()`이 `apiClient`가 아닌 원시 `axios.post()`를 직접 호출해, `client.ts`의 응답 인터셉터가 하는 "`err.response.data.detail` 추출" 로직을 타지 않는다. 그 결과 백엔드가 실제로 보내는 한국어 사유(`"아이디 또는 비밀번호가 올바르지 않습니다"`, `"비활성화된 계정입니다"`, 방금 추가한 rate limit의 `"로그인 시도 횟수를 초과했습니다..."`)가 전부 버려지고, `toast.error()`에는 axios의 제네릭 메시지("Request failed with status code 401")만 전달된다. 실제 Chrome에서 잘못된 비밀번호로 로그인해 재현·스크린샷으로 확인함.

### 재현했으나 원인 미확정 — 후속 조사 필요 (수정하지 않음)

- **로그인 직후 간헐적 401 토스트**: 로그아웃 상태에서 처음 로그인했을 때 한 번, 대시보드가 정상적으로(실제 데이터 포함) 렌더링된 것과 동시에 "Request failed with status code 401" 토스트가 떴다. 동일한 조건으로 재시도했을 때는 재현되지 않았다(React Query 캐시가 남아있어 재조회를 안 했을 가능성). `useSyncStatusWebSocket`은 `token`을 zustand에서 반응형으로 구독해 재연결하므로 이 레이스의 원인일 가능성은 낮아 보이지만, Dashboard/Navbar가 처음 마운트될 때 발생하는 특정 REST 요청 중 하나가 로그인 직후 아주 짧은 순간에 인증 헤더 없이 나가는 것으로 추정된다. **간헐적이라 근본 원인을 확실히 특정하지 못한 채 코드를 고치는 것은 위험 — 이번에는 고치지 않고 로드맵에 기록만 한다.** 재현 시도 방법: 매 시도 전 `localStorage`/쿠키를 완전히 지우고 React Query 캐시가 비어 있는 완전히 새로운 탭에서 로그인.

### 확인했으나 버그가 아닌 것 (참고용으로 기록)

- **401 응답마다 브라우저 콘솔에 "Failed to load resource: 401" 표시**: 이건 애플리케이션 코드가 만드는 게 아니라 Chrome 자체가 모든 비-2xx `fetch`/`XHR` 응답에 대해 자동으로 남기는 표준 동작이라 JS에서 억제할 방법이 없다. 로그인 실패·만료된 토큰 등 "정상적으로 실패하는" 흐름에서마다 발생하며, 사용자가 원래 언급한 "콘솔에 가끔 오류가 보인다"의 상당 부분이 이 항목일 가능성이 높다 — 코드 수정 대상이 아니라는 점을 기록해둔다.
- **Sonner 토스트가 안 뜨는 것처럼 보였던 최초 관찰**: 헤드리스 Playwright에서 `sonner`의 pre-bundle된 모듈을 수동으로 `import`해 `toast.error()`를 직접 호출했을 때 화면에 아무것도 안 떴다. 그런데 실제 Chrome에서 앱의 실제 코드 경로(로그인 폼 제출 → `onError` → `toast.error`)로 트리거했을 때는 정상적으로 떴다. 수동 `import`가 앱이 이미 로드한 것과 다른 sonner 모듈 인스턴스를 만들어 별도의 내부 상태를 가졌던 것으로 추정 — **애플리케이션 버그가 아니라 테스트 방법론상의 오탐**이었다.
- **React Router v7 future-flag 경고 2건**: 모든 페이지 로드마다 콘솔에 찍히는 `React Router Future Flag Warning` 2건은 React Router v6→v7 마이그레이션을 위한 사전 안내성 경고로, 기능에 영향 없다. 원하면 `<BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>`로 조기 옵트인해 제거할 수 있지만, 우선순위가 낮아 이번 배치에는 포함하지 않는다.

---

### Task 1: 로그인 에러 메시지에 백엔드 상세 사유 반영

**Files:**
- Modify: `frontend/src/api/auth.ts`

`frontend/src/api/auth.ts`의 기존:

```typescript
import axios from 'axios'

export interface LoginResponse {
  access_token: string
  token_type: string
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const params = new URLSearchParams()
  params.append('username', username)
  params.append('password', password)

  const res = await axios.post<LoginResponse>('/api/v1/auth/login', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  return res.data
}
```

를 다음으로 교체 (요청 방식은 그대로, 실패 시에만 `client.ts`의 인터셉터와 동일한 방식으로 `detail`을 추출해 던짐):

```typescript
import axios from 'axios'

export interface LoginResponse {
  access_token: string
  token_type: string
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const params = new URLSearchParams()
  params.append('username', username)
  params.append('password', password)

  try {
    const res = await axios.post<LoginResponse>('/api/v1/auth/login', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    return res.data
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const detail = err.response?.data?.detail ?? err.response?.data?.msg ?? err.message
      throw new Error(detail)
    }
    throw err
  }
}
```

- [ ] **Step 1: 위 교체 적용**
- [ ] **Step 2: 타입체크 + 린트 + 빌드**

```bash
cd frontend && npm run lint && npx tsc --noEmit && npm run build
```

Expected: 전부 에러 없이 통과.

- [ ] **Step 3: 수동 검증 (실제 브라우저)**

```bash
cd /Users/hoon/Code/firewall-analysis-tool
.venv/bin/uvicorn app.main:app --app-dir backend --port 8000 &
cd frontend && npm run dev &
```

브라우저에서 `http://localhost:5173/login`에 접속해 존재하는 계정에 틀린 비밀번호로 로그인 시도.

Expected: 토스트에 "Request failed with status code 401" 대신 "아이디 또는 비밀번호가 올바르지 않습니다"가 표시된다.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/api/auth.ts
git commit -m "$(cat <<'EOF'
fix: 로그인 실패 시 백엔드 한국어 사유 메시지가 표시되도록 수정

api/auth.ts의 login()이 apiClient를 거치지 않는 원시 axios 호출이라
client.ts 인터셉터의 에러 메시지 추출 로직을 타지 못해, 백엔드가 보낸
구체적인 사유(아이디/비밀번호 불일치, 비활성 계정, rate limit 등) 대신
axios의 제네릭 영어 메시지("Request failed with status code 401")가
그대로 노출되고 있었다. 실제 Chrome에서 재현·스크린샷으로 확인.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review 메모

- **스펙 커버리지**: 이번 점검에서 실제로 재현·확정한 버그 1건을 Task 1이 수정. 재현했으나 원인 미확정인 1건은 의도적으로 미수정 — 로드맵에 후속 조사 항목으로 남긴다.
- **플레이스홀더 스캔**: 없음.
- **의도적으로 하지 않은 것**: 간헐적 401 토스트(원인 미확정), React Router future-flag 경고(저우선순위 코스메틱) — 둘 다 근거가 부족하거나 가치가 낮아 이번 범위에서 제외.
