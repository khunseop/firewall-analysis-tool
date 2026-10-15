# 삭제 워크플로우 가이드 페이지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영 담당자가 삭제 워크플로우의 프로세스 로직을 앱 안에서 이해할 수 있는 읽기 전용 가이드 페이지(`/guide/deletion-workflow`)를 추가한다.

**Architecture:** 프론트 전용 정적 페이지. 콘텐츠는 `guideContent.ts` 데이터로 분리하고, 흐름도/의사결정 트리/Phase 카드는 Tailwind 기반 소형 컴포넌트로 직접 그린다. 라우트는 `App.tsx`에 lazy 등록, 내비는 `Navbar.tsx`에 항목 추가. 백엔드 변경 없음(SPA catch-all).

**Tech Stack:** React 19, TypeScript, Tailwind(ds-* 토큰), React Router v6. 신규 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-10-15-deletion-workflow-guide-page-design.md`

## Global Constraints

- 신규 npm 의존성 추가 금지.
- 코드 파일 1000줄 이하, 문서 파일 300줄 이하 (파일당).
- 내용 정본은 **코드**(`backend/app/services/deletion_workflow/core/pipeline.py` + processors). 매뉴얼과 다르면 코드 기준.
- 독자는 비개발자: 클래스명·설정 키 노출 금지(용어는 업무 용어).
- 기준일(신규정책 N일, 미사용 N일)은 "기본값 90일(설정에 따라 변경 가능)"로 표기.
- 페이지 파일 위치는 기존 관례대로 `frontend/src/components/pages/` 하위 (스펙의 `pages/guide/` → `components/pages/guide/`로 정정).
- 이 프론트엔드에는 테스트 러너(vitest 등)가 없다. 검증은 `npm run lint`, `npm run build`(tsc 포함), 브라우저 확인으로 한다. 테스트 러너를 새로 도입하지 않는다.

## Review Focus

- 좁은 화면(모바일 폭)에서 의사결정 트리/흐름도가 가로로 넘치지 않고 세로로 읽혀야 함.
- 다크모드에서 모든 박스·화살표·텍스트 대비가 유지돼야 함 (ds-* 토큰만 사용, 하드코딩 색 금지).
- 흐름도 단계 클릭 시 해당 카드로 스크롤 + 카드가 자동으로 펼쳐져야 함 (접힌 카드로 스크롤만 되면 내용이 안 보임).
- 해시(`#phase-3`)로 직접 진입해도 해당 카드가 펼쳐져야 함.
- 코드와 불일치하는 설명이 남지 않아야 함(특히 장기미사용은 GENERAL만 해당).

---

## File Structure

| 파일 | 책임 |
|---|---|
| `frontend/src/components/pages/guide/guideContent.ts` | 모든 문구 데이터(Phase, 용어, FAQ, 트리). 타입 정의 포함 |
| `frontend/src/components/pages/guide/FlowDiagram.tsx` | Phase 세로 플로우, 클릭 시 `#phase-N`으로 이동 |
| `frontend/src/components/pages/guide/DecisionTree.tsx` | "정책 한 건의 운명" 의사결정 트리 |
| `frontend/src/components/pages/guide/PhaseCard.tsx` | 접이식 Phase 상세 카드 (해시 연동) |
| `frontend/src/components/pages/guide/DeletionWorkflowGuidePage.tsx` | 페이지 조립 + 용어표 + FAQ |
| `frontend/src/App.tsx` | 라우트 `guide/deletion-workflow` 추가 |
| `frontend/src/components/layout/Navbar.tsx` | `Guide` 링크 추가 |

---

### Task 1: 콘텐츠 데이터와 타입

**Files:**
- Create: `frontend/src/components/pages/guide/guideContent.ts`

**Interfaces:**
- Produces: `Phase`, `Step`, `Term`, `Faq`, `TreeNode` 타입, `PHASES`, `OUTCOMES`, `EXCEPTION_ORDER`, `TERMS`, `FAQS`, `DECISION_STEPS` 상수. 이후 모든 Task가 사용.

- [ ] **Step 1: 코드 대조** — 아래 파일을 읽고 이 Task의 콘텐츠가 코드와 일치하는지 확인한다(불일치 시 코드 기준으로 문구 수정, 최종 보고에 기록):
  `core/pipeline.py`(태스크 목록), `processors/exception_handler.py`(예외 우선순위·신규정책 기준), `processors/notification_classifier.py`(4유형 조건), `processors/policy_usage_processor.py`(미사용 기준), `processors/bottom_latest_policy_validator.py`, `processors/duplicate_policy_classifier.py`, `processors/duplicate_expired_cleaner.py`, `processors/auto_renewal_checker.py`, `processors/auto_renewal_exception_generator.py`.

- [ ] **Step 2: 파일 작성**

```ts
export interface Step {
  id: number // Task 번호
  title: string
  what: string // 무엇을 하는가 (업무 용어)
  rule?: string[] // 판단 기준
  meaning?: string // 실무적 의미
}

export interface Phase {
  id: number
  title: string
  summary: string
  input: string
  output: string
  steps: Step[]
}

export interface Term { term: string; desc: string }
export interface Faq { q: string; a: string }

export const PHASES: Phase[] = [
  {
    id: 0,
    title: '데이터 추출',
    summary: '방화벽의 현재 정책과 사용이력(히트카운트)을 한 파일로 모읍니다.',
    input: 'FAT DB(동기화된 정책·사용이력), HA 구성 시 Secondary 히트카운트',
    output: '정책+사용이력 Excel',
    steps: [
      { id: 0, title: 'DB 추출', what: 'FAT에 저장된 정책·사용이력·객체를 Excel 한 파일로 내보냅니다.' },
      {
        id: 1, title: 'HA 히트카운트 병합 (선택)', what: 'Palo Alto HA 장비는 두 장비의 사용이력을 합칩니다.',
        rule: ['히트 수는 합산', '마지막 사용일은 더 최근 날짜', '미사용 일수는 더 적은 값(보수적)'],
        meaning: '한쪽 장비에서만 쓰인 정책을 미사용으로 잘못 판단하지 않기 위함입니다. HA가 아니면 생략합니다.',
      },
    ],
  },
  {
    id: 1,
    title: '정책 파일 전처리',
    summary: '정책 이름/설명에서 신청정보를 읽어내고, 중복정책을 찾습니다.',
    input: 'Phase 0 정책 파일, MIS ID 매핑 CSV',
    output: '신청정보가 붙은 정책 파일, 중복분석 결과, 신청번호 목록',
    steps: [
      {
        id: 2, title: '신청정보 파싱', what: '정책명·설명 문구에서 신청번호, 신청자, 기간을 분리합니다.',
        rule: ['P+7자리: 그룹(GROUP)', 'F+7자리: 일반(GENERAL)', 'S: 서버, M: PAM', '구형 형식: OLD', '패턴 없음: Unknown(신청 이력 없음)'],
      },
      { id: 3, title: '중복정책 분석', what: '출발지·목적지·서비스가 같은 정책을 묶어 그룹 번호를 붙입니다(FAT 자동).', meaning: '그룹 안에서 상단(Upper)이 실제 적용되고 하단(Lower)은 가려집니다.' },
      { id: 4, title: '중복결과 신청정보 파싱', what: '중복분석 결과에도 같은 방식으로 신청정보를 붙입니다.' },
      { id: 5, title: 'MIS ID 매핑', what: '룰셋 ID로 MIS ID를 채웁니다.', rule: ['이미 값이 있으면 유지', '같은 룰셋 ID가 여러 개면 첫 번째만 사용'] },
      { id: 6, title: '신청번호 추출', what: '다음 단계에서 조회할 신청번호를 유형별로 정리합니다(이력 없음은 제외).' },
    ],
  },
  {
    id: 2,
    title: '신청정보 매핑',
    summary: 'GSAMS의 정식 신청 기간·신청자를 정책에 붙이고, 자동연장된 정책의 종료일을 갱신합니다.',
    input: 'GSAMS 신청정보 Excel',
    output: '정식 신청정보가 붙은 정책 파일',
    steps: [
      { id: 7, title: 'GSAMS 취합', what: 'GSAMS 파일의 여러 시트를 표준 형식으로 합칩니다.', rule: ['날짜를 YYYY-MM-DD로 통일', '종료일 내림차순 정렬'] },
      {
        id: 8, title: '신청정보 매핑', what: '정책마다 GSAMS의 정식 신청번호·기간·신청자를 붙입니다.',
        rule: ['그룹은 신청번호+MIS ID → 신청번호+종료일+기안자 → 신청번호+종료일+신청자 순으로 시도', '그 외 유형은 신청번호만 일치하면 매핑', '매핑 실패 시 정책에서 읽은 값을 그대로 사용', '상태값 99는 자동연장 신청으로 표시'],
      },
      {
        id: 9, title: '자동연장 날짜 갱신', what: '연장이 반복된 신청은 가장 마지막 연장의 종료일로 갱신합니다.',
        rule: ['앞 건의 종료일 = 뒤 건의 시작일', '기안자가 동일', '제목에서 [태그] 머리말을 뗀 뒤 동일', '세 조건이 모두 맞아야 연장으로 인정, 기존보다 미래일 때만 갱신'],
        meaning: '자동연장으로 실제론 유효한 정책이 만료로 오판되는 것을 막습니다.',
      },
    ],
  },
  {
    id: 3,
    title: '예외 분류 및 사용이력',
    summary: '삭제 검토에서 제외할 정책을 가려내고, 만료·사용 여부를 판정합니다.',
    input: 'Phase 2 정책 파일, 히트카운트',
    output: '예외/만료여부/신청이력/미사용여부가 채워진 정책 파일',
    steps: [
      {
        id: 10, title: '예외처리 (Palo Alto: 10 / SECUI: 11)', what: '정책마다 "예외" 사유와 만료 여부를 부여합니다. 장비 종류에 따라 시스템이 자동 선택합니다.',
        rule: ['뒤에 적용되는 사유가 앞의 사유를 덮어씀(맨 아래 차단정책이 최우선)', '만료: 종료일이 오늘보다 이전 (날짜를 읽지 못하면 보수적으로 만료 처리)'],
      },
      {
        id: 12, title: '사용이력 반영', what: '히트카운트로 사용/미사용을 표시합니다.',
        rule: ['마지막 사용 후 경과일이 기준(기본 90일)을 넘으면 미사용, 이하면 사용'],
      },
      {
        id: 13, title: '하단 최신정책 검증', what: '같은 신청번호 중 최신 신청 정책이 더 아래(순번이 큼)에 있으면 "하단최신정책"으로 표시합니다.',
        meaning: '이전 정책이 위에서 트래픽을 먼저 처리하므로, 아래 최신 정책은 사용 중처럼 보여도 실제로는 가려진 상태입니다.',
      },
    ],
  },
  {
    id: 4,
    title: '중복정책 분류',
    summary: '중복 그룹에서 남길 정책과 삭제할 정책을 정하고, 위험한 그룹은 예외로 빼냅니다.',
    input: 'Phase 1 중복분석 결과, Phase 3 정책 파일',
    output: '중복 공지/삭제/정리 파일, 정책 파일의 중복여부',
    steps: [
      {
        id: 14, title: '중복정책 분류', what: '그룹마다 종료일이 가장 늦은 정책 하나를 유지하고 나머지를 삭제 대상으로 둡니다.',
        rule: ['신청자가 서로 다르면 공지 대상, 모두 같으면 바로 삭제 대상', '자동연장 보호·PAM/SERVER/Unknown 포함·유지 정책이 없는 그룹은 결과에서 제외'],
      },
      {
        id: 15, title: '만료셋 예외처리', what: '그룹 전체가 만료됐거나, 삭제 시 차단정책 영향이 우려되는 그룹을 예외 시트로 분리합니다.',
        rule: ['전체만료: 그룹의 모든 정책이 만료', '차단영향위험: 삭제 대상보다 아래·유지 대상보다 위에 차단정책이 끼어 있음'],
        meaning: '임시 예외가 필요한 정책은 90일 유효기간으로 기록되어 다음 단계에 반영됩니다. 예외 시트가 없으면 정상입니다.',
      },
      { id: 16, title: '중복정책 상태 반영', what: '유지/삭제 결과를 정책 파일의 "중복여부"로 옮깁니다.' },
      { id: 17, title: '중복예외 반영', what: '유효한 임시 예외 정책은 "중복정책_미사용예외"로 표시합니다.', rule: ['등록일이 오늘보다 이전이고 만료일이 오늘 이후여야 유효 (당일 등록은 무효)'] },
    ],
  },
  {
    id: 5,
    title: '공지대상 분류',
    summary: '최종 정책 파일을 4가지 삭제 유형으로 나눠 공지용 파일을 만듭니다.',
    input: 'Phase 4 최종 정책 파일',
    output: '유형별 공지 Excel',
    steps: [{ id: 18, title: '공지대상 분류', what: '아래 "정책 한 건의 운명" 판정 기준대로 4유형으로 분류합니다.' }],
  },
  {
    id: 6,
    title: '자동연장예외 요청',
    summary: '삭제·공지 대상 정책의 신청번호를 모아 자동연장 담당 부서에 예외 처리를 요청할 파일을 만듭니다.',
    input: '장기미사용 공지, 중복 삭제/공지 파일, GSAMS 취합 결과',
    output: '자동연장예외파일',
    steps: [
      {
        id: 19, title: '자동연장예외파일 생성', what: '삭제 대상 정책의 일반신청(F로 시작) 번호 중 자동연장 대상인 것만 중복 없이 정렬해 담습니다.',
        rule: ['자동연장 대상 = GSAMS 상태 91(반영완료) 또는 99(자동연장)', '중복 공지 파일 안에도 "유지" 행이 섞여 있어 작업구분이 "삭제"인 행만 사용'],
      },
    ],
  },
]

export interface Outcome { key: string; label: string; audience: string; tone: 'warn' | 'info' | 'danger' | 'muted' }

export const OUTCOMES: Outcome[] = [
  { key: 'expired_used', label: '기간만료 + 사용', audience: '신청 부서: 연장 또는 삭제 결정 요청', tone: 'warn' },
  { key: 'expired_unused', label: '기간만료 + 미사용', audience: '신청 부서: 삭제 예정 안내', tone: 'danger' },
  { key: 'long_unused', label: '장기미사용', audience: '신청 부서: 재확인 요청 (일반신청 GENERAL만 해당)', tone: 'info' },
  { key: 'no_history', label: '이력없는 미사용', audience: '방화벽 관리팀 내부 검토 후 삭제', tone: 'muted' },
]

export interface DecisionStep { q: string; yes: string; no: string }

// 정책 한 건이 위에서 아래로 거치는 질문. no 가 'next' 이면 다음 질문으로, 아니면 해당 결과로 끝남.
export const DECISION_STEPS: DecisionStep[] = [
  { q: '중복정책으로 분류됐나?', yes: '중복정책 경로(유지/삭제는 중복 분류 결과대로)', no: 'next' },
  { q: '신청 이력이 없나? (Unknown)', yes: '미사용이면 → 이력없는 미사용 (예외가 없을 때만)', no: 'next' },
  { q: '삭제 검토 제외 사유(예외)가 있나?', yes: '대부분 제외. 단 신규정책은 만료 판정 계속, 자동연장정책은 일반신청 장기미사용만 계속', no: 'next' },
  { q: '신청 기간이 만료됐나?', yes: '사용 중 → 기간만료+사용 / 미사용 → 기간만료+미사용', no: '미만료: 미사용이고 일반신청(GENERAL)이면 → 장기미사용' },
]

export const EXCEPTION_ORDER = [
  '예외신청정책', '예외정책', '신규정책', '자동연장정책', '인프라정책', '특수 접두사 정책', '비활성화정책', '기준정책', '차단정책',
]

export const TERMS: Term[] = [
  { term: '예외', desc: '삭제 검토에서 제외하는 사유입니다. 위 순서대로 적용되며 뒤의 사유가 앞의 사유를 덮어씁니다(차단정책이 최우선).' },
  { term: '신규정책', desc: '최근 90일(기본값) 이내에 만들어진 정책입니다. Palo Alto는 정책명의 날짜, SECUI는 시작일 기준입니다.' },
  { term: '미사용', desc: '마지막 사용 후 90일(기본값)을 넘긴 정책입니다.' },
  { term: '만료', desc: '신청 종료일이 오늘 이전인 정책입니다. 날짜를 읽지 못하면 보수적으로 만료로 봅니다.' },
  { term: '신청유형', desc: 'P=그룹, F=일반, S=서버, M=PAM, 구형=OLD, 없음=Unknown. 서버·PAM·Unknown은 중복 분류에서 제외됩니다.' },
  { term: '하단최신정책', desc: '같은 신청번호에서 최신 정책이 더 아래에 있어 실제로는 가려진 정책입니다.' },
  { term: '자동연장', desc: '상태 99인 신청이거나, 종료일=시작일·기안자·제목이 이어지는 연장 체인입니다. 연장 체인은 종료일을 마지막 연장일로 갱신합니다.' },
]

export const FAQS: Faq[] = [
  { q: '신청유형이 Unknown인 정책이 너무 많아요', a: '정책명·설명이 정해진 형식(P/F/S/M + 7자리 등)이 아닐 때 생깁니다. 정책 설명 형식을 확인하세요. Unknown은 이력없는 미사용 분류 대상이 됩니다.' },
  { q: '중복정책 정리 파일에 예외 시트가 없어요', a: '전체만료 그룹도 차단영향위험 그룹도 없으면 정상입니다.' },
  { q: '공지대상 결과가 비어 있어요', a: '예외·중복여부·만료여부·미사용여부 컬럼이 채워졌는지 확인하세요. 앞 단계를 건너뛰면 조건에 맞는 행이 없을 수 있습니다.' },
  { q: '자동연장이 반영되지 않은 정책이 있어요', a: '연장 체인은 종료일=시작일, 기안자 동일, 제목 동일(태그 제외)을 모두 만족해야 인정됩니다.' },
]
```

- [ ] **Step 3: 타입 확인**

Run: `cd frontend && npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/pages/guide/guideContent.ts
git commit -m "feat: 삭제 워크플로우 가이드 콘텐츠 데이터 추가"
```

---

### Task 2: FlowDiagram · PhaseCard · DecisionTree 컴포넌트

**Files:**
- Create: `frontend/src/components/pages/guide/FlowDiagram.tsx`
- Create: `frontend/src/components/pages/guide/PhaseCard.tsx`
- Create: `frontend/src/components/pages/guide/DecisionTree.tsx`

**Interfaces:**
- Consumes: `Phase`, `PHASES`, `DECISION_STEPS`, `OUTCOMES` from `./guideContent`.
- Produces: `FlowDiagram({ phases })`, `PhaseCard({ phase })`, `DecisionTree()`. 앵커 id 규칙 `phase-{id}`.

- [ ] **Step 1: FlowDiagram 작성** — 클릭 시 해시를 바꾸고 `hashchange` 이벤트로 PhaseCard가 펼쳐지게 한다.

```tsx
import type { Phase } from './guideContent'

export function FlowDiagram({ phases }: { phases: Phase[] }) {
  const go = (id: number) => {
    window.location.hash = `phase-${id}`
  }
  return (
    <ol className="flex flex-col items-stretch">
      {phases.map((p, i) => (
        <li key={p.id} className="flex flex-col items-center">
          <button
            type="button"
            onClick={() => go(p.id)}
            className="w-full max-w-2xl rounded-xl border border-ds-outline-variant/30 bg-ds-surface-container-lowest p-4 text-left transition-colors hover:border-ds-tertiary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-ds-tertiary px-1.5 text-10 font-bold text-ds-on-tertiary">{p.id}</span>
              <span className="text-sm font-semibold text-ds-on-surface">{p.title}</span>
              <span className="ml-auto text-10 text-ds-on-surface-variant/70">Task {p.steps.map((s) => s.id).join('·')}</span>
            </div>
            <p className="mt-1.5 text-xs text-ds-on-surface-variant">{p.summary}</p>
            <div className="mt-2 grid gap-1 text-11 text-ds-on-surface-variant/80 sm:grid-cols-2">
              <span>입력: {p.input}</span>
              <span>산출: {p.output}</span>
            </div>
          </button>
          {i < phases.length - 1 && (
            <svg aria-hidden width="16" height="24" viewBox="0 0 16 24" className="text-ds-outline-variant">
              <path d="M8 0v18M3 13l5 6 5-6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </li>
      ))}
    </ol>
  )
}
```

- [ ] **Step 2: PhaseCard 작성** — 해시가 자기 id면 펼치고 스크롤.

```tsx
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { Phase } from './guideContent'

export function PhaseCard({ phase }: { phase: Phase }) {
  const anchor = `phase-${phase.id}`
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const sync = () => {
      if (window.location.hash === `#${anchor}`) {
        setOpen(true)
        requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
      }
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [anchor])

  return (
    <section id={anchor} className="scroll-mt-20 rounded-xl border border-ds-outline-variant/30 bg-ds-surface-container-lowest">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 p-4 text-left"
      >
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-ds-tertiary px-1.5 text-10 font-bold text-ds-on-tertiary">{phase.id}</span>
        <span className="text-sm font-semibold text-ds-on-surface">{phase.title}</span>
        <span className={cn('ml-auto text-ds-on-surface-variant transition-transform', open && 'rotate-180')} aria-hidden>▾</span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-ds-outline-variant/20 p-4">
          {phase.steps.map((s) => (
            <div key={s.id}>
              <h3 className="text-13 font-semibold text-ds-on-surface">Task {s.id}. {s.title}</h3>
              <p className="mt-1 text-xs text-ds-on-surface-variant">{s.what}</p>
              {s.rule && (
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-ds-on-surface-variant">
                  {s.rule.map((r) => <li key={r}>{r}</li>)}
                </ul>
              )}
              {s.meaning && (
                <p className="mt-1.5 rounded-md bg-ds-surface-container-low px-3 py-2 text-xs text-ds-on-surface-variant">
                  <strong className="text-ds-on-surface">실무 의미 </strong>{s.meaning}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 3: DecisionTree 작성** — 질문을 세로로 쌓고 각 질문 옆 "예" 분기를 보여주며 마지막에 4유형 결과를 놓는다.

```tsx
import { DECISION_STEPS, OUTCOMES } from './guideContent'

export function DecisionTree() {
  return (
    <div className="space-y-3">
      <ol className="space-y-3">
        {DECISION_STEPS.map((s, i) => (
          <li key={s.q} className="rounded-xl border border-ds-outline-variant/30 bg-ds-surface-container-lowest p-4">
            <p className="text-13 font-semibold text-ds-on-surface">
              <span className="mr-2 text-ds-tertiary">Q{i + 1}</span>{s.q}
            </p>
            <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
              <div className="rounded-md bg-ds-surface-container-low p-2">
                <dt className="font-semibold text-ds-on-surface">예</dt>
                <dd className="text-ds-on-surface-variant">{s.yes}</dd>
              </div>
              <div className="rounded-md bg-ds-surface-container-low p-2">
                <dt className="font-semibold text-ds-on-surface">아니오</dt>
                <dd className="text-ds-on-surface-variant">{s.no === 'next' ? '다음 질문으로' : s.no}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
      <div className="grid gap-2 sm:grid-cols-2">
        {OUTCOMES.map((o) => (
          <div key={o.key} className="rounded-xl border border-ds-tertiary/40 bg-ds-surface-container-lowest p-3">
            <p className="text-13 font-semibold text-ds-on-surface">{o.label}</p>
            <p className="mt-0.5 text-xs text-ds-on-surface-variant">{o.audience}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 타입/린트**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: 에러 없음.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/pages/guide
git commit -m "feat: 가이드 흐름도·Phase 카드·의사결정 트리 컴포넌트 추가"
```

---

### Task 3: 페이지 조립, 라우트, 내비 연결

**Files:**
- Create: `frontend/src/components/pages/guide/DeletionWorkflowGuidePage.tsx`
- Modify: `frontend/src/App.tsx` (lazy import + `<Route>`)
- Modify: `frontend/src/components/layout/Navbar.tsx` (`NAV_ITEMS`)

**Interfaces:**
- Consumes: Task 1·2 산출물, `PageHeader` from `@/components/shared/PageHeader`.
- Produces: `DeletionWorkflowGuidePage` (named export).

- [ ] **Step 1: 페이지 작성**

```tsx
import { PageHeader } from '@/components/shared/PageHeader'
import { DecisionTree } from './DecisionTree'
import { FlowDiagram } from './FlowDiagram'
import { PhaseCard } from './PhaseCard'
import { EXCEPTION_ORDER, FAQS, OUTCOMES, PHASES, TERMS } from './guideContent'

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-ds-on-surface">{title}</h2>
        {desc && <p className="mt-0.5 text-xs text-ds-on-surface-variant/80">{desc}</p>}
      </div>
      {children}
    </section>
  )
}

export function DeletionWorkflowGuidePage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        title="삭제 워크플로우 가이드"
        description="방화벽 정책 중 삭제·공지 대상을 어떻게 가려내는지 단계별로 설명합니다."
      />

      <Section title="한눈에 보기" desc="외부 자료(GSAMS, MIS ID)와 방화벽 정책·사용이력을 결합해 아래 4가지 삭제 대상을 찾고, 신청 부서에 공지할 파일을 만듭니다.">
        <div className="grid gap-2 sm:grid-cols-2">
          {OUTCOMES.map((o) => (
            <div key={o.key} className="rounded-xl border border-ds-outline-variant/30 bg-ds-surface-container-lowest p-3">
              <p className="text-13 font-semibold text-ds-on-surface">{o.label}</p>
              <p className="mt-0.5 text-xs text-ds-on-surface-variant">{o.audience}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="전체 흐름" desc="단계를 누르면 아래 상세 설명으로 이동합니다.">
        <FlowDiagram phases={PHASES} />
      </Section>

      <Section title="정책 한 건의 운명" desc="정책 하나가 어떤 질문을 거쳐 공지 대상이 되는지 보여줍니다. 위에서부터 차례로 확인합니다.">
        <DecisionTree />
      </Section>

      <Section title="단계별 상세" desc="각 단계를 펼쳐 판단 기준과 실무적 의미를 확인하세요.">
        <div className="space-y-3">
          {PHASES.map((p) => <PhaseCard key={p.id} phase={p} />)}
        </div>
      </Section>

      <Section title="예외 사유 적용 순서" desc="뒤에 적용되는 사유가 앞의 사유를 덮어씁니다.">
        <ol className="flex flex-wrap gap-2">
          {EXCEPTION_ORDER.map((e, i) => (
            <li key={e} className="rounded-full border border-ds-outline-variant/30 bg-ds-surface-container-low px-3 py-1 text-xs text-ds-on-surface">
              <span className="mr-1 text-ds-tertiary">{i + 1}</span>{e}
            </li>
          ))}
        </ol>
      </Section>

      <Section title="용어와 기준">
        <dl className="divide-y divide-ds-outline-variant/20 rounded-xl border border-ds-outline-variant/30 bg-ds-surface-container-lowest">
          {TERMS.map((t) => (
            <div key={t.term} className="grid gap-1 p-3 sm:grid-cols-[8rem_1fr]">
              <dt className="text-xs font-semibold text-ds-on-surface">{t.term}</dt>
              <dd className="text-xs text-ds-on-surface-variant">{t.desc}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="자주 겪는 문제">
        <div className="space-y-2">
          {FAQS.map((f) => (
            <details key={f.q} className="rounded-xl border border-ds-outline-variant/30 bg-ds-surface-container-lowest p-3">
              <summary className="cursor-pointer text-13 font-semibold text-ds-on-surface">{f.q}</summary>
              <p className="mt-2 text-xs text-ds-on-surface-variant">{f.a}</p>
            </details>
          ))}
        </div>
      </Section>

      <p className="pb-4 text-11 text-ds-on-surface-variant/60">
        기준: 삭제 워크플로우 파이프라인(Task 0~19) 코드 · 최종 확인 2026-10-15 · 기준일(90일 등)은 설정에 따라 달라질 수 있습니다.
      </p>
    </div>
  )
}
```

- [ ] **Step 2: App.tsx 수정** — 기존 lazy 목록 끝(`DeletionWorkflowDetailPage` 줄 아래)에 추가하고, `analysis/projects/...` 라우트 근처에 Route 추가.

```tsx
const DeletionWorkflowGuidePage = lazy(() => import('@/components/pages/guide/DeletionWorkflowGuidePage').then((m) => ({ default: m.DeletionWorkflowGuidePage })))
```
```tsx
<Route path="guide/deletion-workflow" element={<DeletionWorkflowGuidePage />} />
```

- [ ] **Step 3: Navbar.tsx 수정** — `NAV_ITEMS`의 `Schedules` 뒤에 추가.

```tsx
{ to: '/guide/deletion-workflow', label: 'Guide' },
```

- [ ] **Step 4: 정적 검증**

Run: `cd frontend && npm run lint && npm run build`
Expected: 둘 다 에러 없이 통과.

- [ ] **Step 5: 브라우저 검증** — 개발 서버(`localhost:5173`)에서 로그인 후 확인:
  1. 내비 `Guide` 클릭 → 페이지 렌더.
  2. 흐름도에서 Phase 3 클릭 → Phase 3 카드가 펼쳐지고 스크롤.
  3. `/guide/deletion-workflow#phase-4` 직접 접속 → Phase 4 카드 펼침.
  4. 브라우저 폭을 375px로 줄여 가로 스크롤 없음 확인.
  5. 다크모드 전환 후 텍스트/박스 대비 확인.
  6. 콘솔 에러 없음.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/layout/Navbar.tsx frontend/src/components/pages/guide
git commit -m "feat: 삭제 워크플로우 가이드 페이지 및 라우트·내비 추가"
```

---

### Task 4: 코드 대조 최종 점검 및 문서 반영

**Files:**
- Modify: `frontend/src/components/pages/guide/guideContent.ts` (불일치 발견 시)
- Modify: `CLAUDE.md` (프론트 구조 항목에 가이드 페이지 한 줄)

- [ ] **Step 1: 대조 점검** — Task 1 Step 1에서 읽은 processor 코드와 렌더된 문구를 다시 한 번 비교한다. 특히: 예외 우선순위 순서, 신규정책 기준(Palo Alto=정책명 날짜 / SECUI=시작일), 장기미사용=GENERAL만, 중복 제외 유형, Task 19의 91/99 조건. 불일치는 `guideContent.ts`를 코드 기준으로 수정한다.
- [ ] **Step 2: 최종 불일치 목록 정리** — 매뉴얼과 코드가 달랐던 항목을 사용자에게 보고(매뉴얼 수정은 이번 범위 밖).
- [ ] **Step 3: CLAUDE.md 갱신** — 프론트엔드 구조의 "페이지 하위 구조" 줄에 `pages/guide/`(삭제 워크플로우 설명, 정적 콘텐츠 `guideContent.ts`)를 한 줄 추가.
- [ ] **Step 4: 재검증 및 Commit**

Run: `cd frontend && npm run lint && npm run build`
Expected: 통과.

```bash
git add -A frontend/src CLAUDE.md
git commit -m "docs: 가이드 콘텐츠 코드 대조 반영 및 CLAUDE.md 갱신"
```

푸시는 사용자 메모리 규칙에 따라 모든 검증 완료 후 main에 수행한다.
