/**
 * 사용자에게 보여줄 오류 문장. `api/client.ts` 인터셉터가 서버 `detail`을 Error.message로 바꿔 던지므로
 * 서버가 준 한국어 설명은 그대로 쓰고, axios가 만든 일반 문구("Request failed with status code 500",
 * "Network Error" 등)만 복구 안내가 담긴 fallback으로 바꾼다.
 */
const GENERIC_AXIOS_MESSAGE = /^(Request failed with status code|Network Error|timeout of|Request failed$)/i

export function errorMessage(e: unknown, fallback: string): string {
  const message = e instanceof Error ? e.message : ''
  if (!message || GENERIC_AXIOS_MESSAGE.test(message)) return fallback
  return message
}
