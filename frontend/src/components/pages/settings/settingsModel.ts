/** 위험 포트 설정의 저장 형식 변환·검증 — 백엔드(risky_ports.py)는 "tcp/80" 문자열 또는 {"port": "tcp/80", "description": ".."} 를 읽는다. */

export interface RiskyPortRow {
  id: string
  protocol: 'TCP' | 'UDP'
  port: string
  description: string
}

const PORT_TOKEN = /^\d{1,5}(-\d{1,5})?$/

/** 포트 입력("23, 3389, 8000-8100")의 오류 문구. 올바르면 null. */
export function validatePorts(port: string): string | null {
  const tokens = port.split(',').map((t) => t.trim()).filter(Boolean)
  if (tokens.length === 0) return '포트를 입력하세요. 예: 23, 3389, 8000-8100'
  for (const t of tokens) {
    if (!PORT_TOKEN.test(t)) return `'${t}'은(는) 올바른 포트가 아닙니다. 숫자 또는 시작-끝 범위로 입력하세요.`
    const [start, end] = t.split('-').map(Number)
    if (start < 1 || start > 65535 || (end !== undefined && (end < 1 || end > 65535))) return `'${t}': 포트는 1~65535 사이여야 합니다.`
    if (end !== undefined && start > end) return `'${t}': 범위의 시작이 끝보다 큽니다.`
  }
  return null
}

/** 서버 값(JSON 문자열) → 화면 행. 문자열·객체(신형·구형) 항목을 모두 읽는다. */
export function parseRiskyPorts(raw: string | undefined): RiskyPortRow[] {
  if (!raw) return []
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return [] }
  if (!Array.isArray(parsed)) return []
  const rows: RiskyPortRow[] = []
  parsed.forEach((item, i) => {
    let token = ''
    let description = ''
    if (typeof item === 'string') {
      token = item
    } else if (item && typeof item === 'object') {
      const o = item as { port?: string; protocol?: string; description?: string }
      description = o.description ?? ''
      token = o.port ?? ''
      if (o.protocol && token && !token.includes('/')) token = `${o.protocol}/${token}`
    }
    const [proto, ...rest] = token.split('/')
    const port = rest.join('/')
    if (!port) return
    rows.push({ id: `srv-${i}`, protocol: proto.trim().toUpperCase() === 'UDP' ? 'UDP' : 'TCP', port: port.trim(), description })
  })
  return rows
}

/** 화면 행 → 서버 값. "23, 3389"처럼 쉼표로 적은 포트는 항목 하나씩으로 나눠 저장한다. */
export function serializeRiskyPorts(rows: RiskyPortRow[]): string {
  const out: { port: string; description: string }[] = []
  for (const r of rows) {
    for (const t of r.port.split(',').map((x) => x.trim()).filter(Boolean)) {
      out.push({ port: `${r.protocol.toLowerCase()}/${t}`, description: r.description })
    }
  }
  return JSON.stringify(out)
}

export const sameRiskyRows = (a: RiskyPortRow[], b: RiskyPortRow[]) =>
  a.length === b.length && a.every((r, i) => r.protocol === b[i].protocol && r.port === b[i].port && r.description === b[i].description)
