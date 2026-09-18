import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import sharp from "sharp";

const examples = [
  {
    name: "price-predicate",
    headline: "테슬라 주가 12.5% 급락 시가총액 1,200억 달러 증발",
    lines: ["테슬라 주가 12.5% 급락", "시가총액 1,200억 달러 증발"],
  },
  {
    name: "earnings-phrase",
    headline: "현대차 3분기 영업이익 3조 5천억 원 돌파 사상 최대 실적",
    lines: ["현대차 3분기", "영업이익 3조 5천억 원 돌파", "사상 최대 실적"],
  },
  {
    name: "target-price-raise",
    headline: "“지금이라도 사야 하나” SK하이닉스 목표주가 35만원으로 상향",
    lines: ["“지금이라도 사야 하나”", "SK하이닉스", "목표주가 35만원으로 상향"],
  },
  {
    name: "quoted-question",
    headline: "“이대로 진짜 계속 갈 수 있나?” 삼성전자 목표가 40만원",
    lines: ["“이대로 진짜 계속 갈 수 있나?”", "삼성전자 목표가 40만원"],
  },
  {
    name: "long-quote-phrase",
    headline: "“올해에도 실적이 계속 좋아질 수 있을까?” 삼성전자 목표가 40만원",
    lines: [
      "“올해에도 실적이",
      "계속 좋아질 수 있을까?”",
      "삼성전자 목표가 40만원",
    ],
  },
  {
    name: "clause-boundary",
    headline: "금리 인상은 문제도 아니다, 코스피 6800선 안착",
    lines: ["금리 인상은 문제도 아니다,", "코스피 6800선 안착"],
  },
  {
    name: "currency-phrase",
    headline: "8월 스위스 무역 흑자, 37억 9천만 스위스 프랑 기록",
    lines: ["8월 스위스 무역 흑자,", "37억 9천만 스위스 프랑 기록"],
  },
];
for (const example of examples) {
  test(`automatic meaning-first render: ${example.name}`, async ({
    request,
  }) => {
    let p = await (await request.post("/api/projects")).json();
    const photo = await request.post("/api/photos", {
      multipart: {
        file: {
          name: "photo.png",
          mimeType: "image/png",
          buffer: await sharp({
            create: {
              width: 1080,
              height: 1350,
              channels: 3,
              background: "#223745",
            },
          })
            .png()
            .toBuffer(),
        },
      },
    });
    p.photo = (await photo.json()).url;
    p.copy.headline = example.headline;
    p.copy.headlineMode = "literal";
    p = await (await request.put(`/api/projects/${p.id}`, { data: p })).json();
    const rendered = await request.post(`/api/projects/${p.id}/render`, {
      data: { revision: p.revision, only: 0 },
    });
    expect(rendered.ok(), await rendered.text()).toBe(true);
    p = await rendered.json();
    expect(p.copy.headline).toBe(example.headline);
    expect(p.coverLayout.lines).toEqual(example.lines);
    const artifact =
      process.env.E2E_ARTIFACT_DIR || "/tmp/semantic-linebreak-artifacts";
    await fs.mkdir(artifact, { recursive: true });
    await fs.writeFile(
      `${artifact}/${example.name}.png`,
      await (await request.get(p.renders[0])).body(),
    );
    // Explicit editor breaks are authoritative, even if automatic layout could
    // keep this sentence together. Literal source punctuation is not rewritten.
    p.copy.headline = "수동 / 제목";
    p.copy.headlineMode = "escaped";
    p = await (await request.put(`/api/projects/${p.id}`, { data: p })).json();
    const manual = await request.post(`/api/projects/${p.id}/render`, {
      data: { revision: p.revision, only: 0 },
    });
    expect(manual.ok()).toBe(true);
    expect((await manual.json()).coverLayout.lines).toEqual(["수동", "제목"]);
  });
}
