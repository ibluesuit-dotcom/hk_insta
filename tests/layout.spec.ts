import { test, expect } from "./auth-fixture";
import fs from "node:fs/promises";
import sharp from "sharp";
import { candidateLines } from "../shared/linebreak";
import { blank } from "../shared/model";
import { html } from "../server/render";

test("actual Pretendard measured candidates protect amounts and currency", async ({
  page,
}) => {
  const p = blank();
  const font = (
    await fs.readFile("public/fonts/PretendardVariable.woff2")
  ).toString("base64");
  await page.setContent(html(p, 0, font, ""));
  await page.evaluate(async () => {
    await document.fonts.load("800 88px Pretendard");
    await document.fonts.ready;
  });
  await page.addScriptTag({
    content:
      "window.__name = (fn) => fn; window.candidateLines = " +
      candidateLines.toString(),
  });
  const layouts = await page.evaluate(() => {
    const span = document.createElement("span");
    document.body.append(span);
    Object.assign(span.style, {
      whiteSpace: "pre",
      fontWeight: "800",
      letterSpacing: "-.025em",
      position: "absolute",
    });
    return [88, 80, 72].map((size) => {
      span.style.fontSize = size + "px";
      const width = (s: string) => {
        span.textContent = s;
        return span.getBoundingClientRect().width;
      };
      const lines = (window as any).candidateLines(
        "8월 스위스 무역 흑자, 37억 9천만 스위스 프랑 기록",
        width,
      );
      return { size, lines, widths: lines.map(width) };
    });
  });
  for (const layout of layouts) {
    expect(layout.lines.length).toBeGreaterThan(0);
    expect(layout.lines.some((l: string) => l.includes("37억 9천만"))).toBe(
      true,
    );
    expect(layout.lines.some((l: string) => l.includes("스위스 프랑"))).toBe(
      true,
    );
    expect(layout.widths.every((w: number) => w <= 952)).toBe(true);
  }
  await fs.mkdir((process.env.E2E_ARTIFACT_DIR || "docs/fix-evidence") + "", {
    recursive: true,
  });
  await fs.writeFile(
    (process.env.E2E_ARTIFACT_DIR || "docs/fix-evidence") +
      "/measured-layouts.json",
    JSON.stringify(layouts, null, 2),
  );
});

test("rendered cover uses exact starting-line highlight and null means white", async ({
  request,
}) => {
  let p = await (await request.post("/api/projects")).json();
  p.copy.headline = "8월 스위스 무역 흑자, 37억 9천만 스위스 프랑 기록";
  p.headlineBreaks = "8월 스위스 무역 흑자,\n37억 9천만\n스위스 프랑 기록";
  p.copy.kicker = "전년 동기 대비 +120% 성장";
  p.copy.pages[0].title = "확인";
  p.copy.pages[0].body = "본문 문안입니다.";
  const image = await request.post("/api/photos", {
    multipart: {
      file: {
        name: "sample.jpg",
        mimeType: "image/jpeg",
        buffer: await fs.readFile(
          "design_handoff_news_card_fullbleed/PYH2026090110410005100.jpg",
        ),
      },
    },
  });
  p.photo = (await image.json()).url;
  const counts: number[] = [];
  for (const start of [null, 2, 1, 0]) {
    p.highlightFrom = start;
    p = await (await request.put(`/api/projects/${p.id}`, { data: p })).json();
    const rendered = await request.post(`/api/projects/${p.id}/render`, {
      data: { revision: p.revision, only: 0 },
    });
    expect(rendered.ok()).toBe(true);
    p = await rendered.json();
    const bytes = await (await request.get(p.renders[0])).body();
    await fs.writeFile(
      `${process.env.E2E_ARTIFACT_DIR || "docs/fix-evidence"}/highlight-${start}.png`,
      bytes,
    );
    const { data, info } = await sharp(bytes)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let gold = 0;
    for (let i = 0; i < data.length; i += info.channels)
      if (data[i] === 255 && data[i + 1] === 199 && data[i + 2] === 44) gold++;
    counts.push(gold);
  }
  expect(counts[0]).toBeLessThan(20);
  expect(counts[1]).toBeGreaterThan(counts[0] + 1000);
  expect(counts[2]).toBeGreaterThan(counts[1] + 1000);
  expect(counts[3]).toBeGreaterThan(counts[2] + 1000);
  await fs.writeFile(
    (process.env.E2E_ARTIFACT_DIR || "docs/fix-evidence") +
      "/highlight-pixels.json",
    JSON.stringify({ starts: [null, 2, 1, 0], goldPixels: counts }, null, 2),
  );
});
