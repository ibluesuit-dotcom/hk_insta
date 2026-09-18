import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import sharp from "sharp";

const sandbox = await fs.mkdtemp(
  path.join(os.tmpdir(), "headline-plans-test-"),
);
process.env.DATA_DIR = sandbox;
process.env.MOCK_AI = "0";
process.env.OPENAI_API_KEY = "test-only-not-a-real-key";
const { validateHeadlinePlans, headlinePlans, headlinePlanCacheKey } =
  await import("../server/headline-plans");
const oil = "유가 100달러 돌파에 한미 증시 긴장'100달러 시나리오'도";
const oilLines = [
  "유가 100달러 돌파에",
  "한미 증시 긴장",
  "'100달러 시나리오'도",
];
const output = (lines: string[]) => ({ layouts: [{ lines }] });
const clauseCases = [
  ["삼성전자, 3.4% 급등 마감…", "SK하이닉스는 6.4% 뛰어(종합)"],
  ["李 “연임 생각 전혀 없어…", "국회, 조작기소 진상 규명만", "집중해 달라”"],
];
const clauseTitle = (lines: string[]) => lines[0] + lines.slice(1).join(" ");

test("real AI clause cuts after attached ellipses preserve every original character", () => {
  for (const lines of clauseCases) {
    assert.deepEqual(validateHeadlinePlans(clauseTitle(lines), output(lines)), [lines]);
  }
  for (const mark of ["…", "……", "...", "......"]) {
    const lines = ["증시 상승" + mark, "투자 심리 회복"];
    assert.deepEqual(validateHeadlinePlans(lines.join(""), output(lines)), [lines]);
  }
  for (const lines of [
    ["삼성전자, 3.", "4% 급등"],
    ["매출 1,", "400억원"],
    ["증시 상승.", "..투자 심리 회복"],
    ["증시 상승…", "…투자 심리 회복"],
    ["“증시 상승…", "”도 호재"],
    ["“증시 상승…”,", "도 호재"],
  ]) assert.throws(() => validateHeadlinePlans(lines.join(""), output(lines)));
  assert.throws(() => validateHeadlinePlans(clauseTitle(clauseCases[0]), output([
    "삼성전자, 3.4% 급등 마감...", clauseCases[0][1],
  ])));
});

test("AI cut validation preserves exact source slices, attached quotations and particles", () => {
  assert.deepEqual(validateHeadlinePlans(oil, output(oilLines)), [oilLines]);
  for (const lines of [
    ["유가 200달러 돌파에", ...oilLines.slice(1)],
    ["유가 100달러 돌파에", "한미 증시 긴장", "100달러 시나리오 도"],
    ["유가100달러 돌파에", ...oilLines.slice(1)],
    ["유가 100달러 돌파에 한", "미 증시 긴장", "'100달러 시나리오'도"],
    ["유가 100달러 돌파에", "한미 증시 긴장'100달러 시나리오'", "도"],
    ["유가 100달러 돌파에", "한미 증시 긴장'100달러 시나리오", "'도"],
    [oil, "추가"],
    [],
    ["유가", "100달러 돌파에", "한미 증시 긴장", "'100달러 시나리오'도"],
  ])
    assert.throws(() => validateHeadlinePlans(oil, output(lines)));
  assert.deepEqual(
    validateHeadlinePlans(
      "원/달러 환율 1,400원 돌파",
      output(["원/달러 환율", "1,400원 돌파"]),
    ),
    [["원/달러 환율", "1,400원 돌파"]],
  );
});

test("validated cache is reused, concurrent plans coalesce, altered cache is rejected", async () => {
  let calls = 0;
  const request = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return output(oilLines);
  };
  assert.deepEqual(
    await Promise.all([
      headlinePlans(oil, request),
      headlinePlans(oil, request),
    ]),
    [[oilLines], [oilLines]],
  );
  assert.equal(calls, 1);
  await headlinePlans(oil, request);
  assert.equal(calls, 1);
  const filename = path.join(
    sandbox,
    "cache",
    "headline-layout-" + headlinePlanCacheKey(oil) + ".json",
  );
  await fs.writeFile(filename, JSON.stringify(output(["변조된 제목"])));
  await headlinePlans(oil, request);
  assert.equal(calls, 2);
  await assert.rejects(
    headlinePlans("실패하는 제목", async () => {
      throw Error("provider unavailable");
    }),
    /provider unavailable/,
  );
  assert.equal(
    await fs
      .stat(
        path.join(
          sandbox,
          "cache",
          "headline-layout-" + headlinePlanCacheKey("실패하는 제목") + ".json",
        ),
      )
      .then(
        () => true,
        () => false,
      ),
    false,
  );
});

test("renderer uses valid AI plans and rejects invalid responses without heuristic fallback", async () => {
  const { initStore } = await import("../server/store");
  const { blank } = await import("../shared/model");
  const { render } = await import("../server/render");
  await initStore();
  await sharp({
    create: { width: 1080, height: 1350, channels: 3, background: "#233746" },
  })
    .png()
    .toFile(path.join(sandbox, "uploads", "photo.png"));
  let calls = 0;
  const requests: any[] = [];
  const service = http.createServer(async (req, res) => {
    calls++;
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    requests.push(request);
    const title = JSON.parse(request.input).headline;
    const clause = clauseCases.find((lines) => clauseTitle(lines) === title);
    const layouts = clause ? output(clause) : title.startsWith("거절")
      ? null
      : title.startsWith("불일치")
        ? output(["원문을 바꾼 잘못된 제목"])
      : title.startsWith("넘침")
        ? output([title])
        : {
            layouts: [
              {
                lines: oilLines.map((s, i) =>
                  i === 0 ? "유가 101달러 돌파에" : s,
                ),
              },
              {
                lines: [
                  "유가 101달러 돌파에 한미",
                  "증시 긴장'100달러 시나리오'도",
                ],
              },
            ],
          };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "resp_test",
        object: "response",
        created_at: 0,
        status: "completed",
        model: "gpt-6-astra",
        output: [
          {
            type: "message",
            id: "msg_test",
            role: "assistant",
            status: "completed",
            content: layouts
              ? [
                  {
                    type: "output_text",
                    text: JSON.stringify(layouts),
                    annotations: [],
                  },
                ]
              : [{ type: "refusal", refusal: "test refusal" }],
          },
        ],
      }),
    );
  });
  await new Promise<void>((r) => service.listen(0, "127.0.0.1", r));
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(service.address() as any).port}/v1`;
  try {
    const p = blank();
    p.photo = "/uploads/photo.png";
    p.copy.headline = oil.replace("유가 100", "유가 101");
    p.copy.headlineMode = "literal";
    let result = await render(p, 0);
    assert.deepEqual(result.coverLayout?.lines, [
      "유가 101달러 돌파에",
      ...oilLines.slice(1),
    ]);
    assert.equal(calls, 1);
    assert.equal(requests[0].store, false);
    assert.equal(requests[0].model, "gpt-6-astra");
    assert.deepEqual(Object.keys(JSON.parse(requests[0].input)), ["headline"]);
    await render(p, 0);
    assert.equal(calls, 1);
    p.copy.headline = "수동 / 제목";
    p.copy.headlineMode = "escaped";
    result = await render(p, 0);
    assert.deepEqual(result.coverLayout?.lines, ["수동", "제목"]);
    assert.equal(calls, 1);
    p.copy.headline = "본문만 렌더하는 제목";
    p.copy.headlineMode = "literal";
    p.copy.pages[0].title = "본문";
    p.copy.pages[0].body = "내용";
    await render(p, 1);
    assert.equal(calls, 1);
    p.copy.headline = "거절 확인";
    await assert.rejects(render(p, 0), /응답을 완성/);
    assert.equal(calls, 2);
    p.copy.headline = "불일치 원/달러 환율 1,400원 돌파";
    await assert.rejects(render(p, 0), /원문과 일치/);
    assert.equal(p.copy.headline, "불일치 원/달러 환율 1,400원 돌파");
    assert.equal(calls, 3);
    p.copy.headline = "넘침 " + "매우 긴 구절 ".repeat(30);
    await assert.rejects(render(p, 0), /카드 폭/);
    assert.equal(calls, 4);
    for (const lines of clauseCases) {
      p.copy.headline = clauseTitle(lines);
      result = await render(p, 0);
      assert.deepEqual(result.coverLayout?.lines, lines);
      assert.equal(result.coverLayout?.headline, p.copy.headline);
      const cached = JSON.parse(await fs.readFile(path.join(sandbox, "cache",
        "headline-layout-" + headlinePlanCacheKey(p.copy.headline) + ".json"), "utf8"));
      assert.deepEqual(cached, output(lines));
    }
    assert.equal(calls, 6);
  } finally {
    service.close();
    delete process.env.OPENAI_BASE_URL;
  }
});
