/**
 * 그리드 셀 편집 시 원본 값과 편집된 값을 비교해 PAN-OS `set`(추가)/`delete`(제거) 명령
 * 생성에 필요한 최소한의 diff를 계산하는 순수 함수.
 */

export interface FieldDiff {
  added: string[]
  removed: string[]
}

function tokenize(value: string): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function diffMultiValueField(original: string, edited: string): FieldDiff {
  const originalTokens = new Set(tokenize(original))
  const editedTokens = new Set(tokenize(edited))
  const added = [...editedTokens].filter((t) => !originalTokens.has(t))
  const removed = [...originalTokens].filter((t) => !editedTokens.has(t))
  return { added, removed }
}

export function isFieldDiffEmpty(diff: FieldDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0
}
