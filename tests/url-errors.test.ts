import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { sourcesRouter } from "../server/routes/sources";
import { errorHandler, publicMessage } from "../server/http";

// URL 칸 오류는 URL 안내로(형식 오류·접속 불가), 추출 실패는 EXTRACTION 유지.
const app = express();
app.use(express.json());
app.use(sourcesRouter);
app.use(errorHandler);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
after(() => server.close());
const extract = async (url: unknown) => {
  const res = await fetch(base + "/api/extract/url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  return { status: res.status, json: (await res.json()) as any };
};

test("malformed URL input gets a URL-specific message", async () => {
  for (const url of ["abc", "", "news.example.com/1", "ftp://x.test/a", 12]) {
    const r = await extract(url);
    assert.equal(r.status, 400, String(url));
    assert.equal(r.json.code, "URL_INVALID");
    assert.match(r.json.message, /URL을 확인하세요/);
    assert.doesNotMatch(r.json.message, /폰트|문안/);
  }
});

test("an unknown host is a URL problem, not files or settings", async () => {
  const r = await extract("https://no-such-host-qa.invalid/news/1");
  assert.equal(r.json.code, "URL_UNREACHABLE");
  assert.equal(
    r.json.message,
    "기사 주소에 접속할 수 없습니다. URL을 확인하세요.",
  );
  // Local addresses keep the extraction code and its own message.
  const local = await extract("http://127.0.0.1");
  assert.equal(local.json.code, "EXTRACTION");
  assert.match(local.json.message, /내부·로컬 주소/);
});

test("network errors anywhere read as an address problem", () => {
  const dns = Object.assign(new Error("getaddrinfo ENOTFOUND x"), {
    code: "ENOTFOUND",
  });
  const viaFetch = new TypeError("fetch failed", { cause: dns });
  for (const e of [dns, viaFetch])
    assert.equal(
      publicMessage(e),
      "주소에 접속할 수 없습니다. URL을 확인하세요.",
    );
  assert.match(publicMessage(new Error("boom")), /처리하지 못했습니다/);
});
