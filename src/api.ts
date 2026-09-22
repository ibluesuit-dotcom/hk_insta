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
    const e = await res.json();
    throw Object.assign(new Error(`${e.code || "오류"} · ${e.message}`), {
      code: e.code,
      suggestions: e.suggestions,
    });
  }
  return res.json();
}
