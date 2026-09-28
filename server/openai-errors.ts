/** OpenAI 가 크레딧 소진·할당량 초과를 알리는 오류인지 (status 429 + insufficient_quota 계열). */
export function isQuotaExhausted(e: unknown): boolean {
  const x = e as { status?: number; code?: string | null; type?: string | null };
  return (
    x?.status === 429 &&
    (x.type === "insufficient_quota" ||
      x.code === "insufficient_quota" ||
      x.code === "credit_balance_exhausted")
  );
}
