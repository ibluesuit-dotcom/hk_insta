export async function api(url: string, method = "GET", body?: any) {
  const res = await fetch("/api" + url, {
    method,
    headers:
      body instanceof FormData ? {} : { "Content-Type": "application/json" },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(
              method === "PUT" ? { ...body, partialDirection: "" } : body,
            ),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    // Editors read the Korean message; the code is shown apart as a detail.
    throw Object.assign(
      new Error(e.message || "요청을 처리하지 못했습니다. 다시 시도하세요."),
      { code: e.code, suggestions: e.suggestions, startedAt: e.startedAt },
    );
  }
  return res.json();
}
