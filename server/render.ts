import { headlinePlans, shortHeadlines } from "./headline-plans";
import { candidateLines } from "../shared/linebreak";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { Project, headlineLayout, migrateCover } from "../shared/model";
import { root } from "./store";
export const escape = (x: string) =>
  x.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function mark(text: string, highlight: string) {
  if (!highlight || !text.includes(highlight)) return escape(text);
  const i = text.indexOf(highlight);
  return (
    escape(text.slice(0, i)) +
    '<span class="gold">' +
    escape(highlight) +
    "</span>" +
    escape(text.slice(i + highlight.length))
  );
}
export function html(p: Project, index: number, font: string, image: string) {
  const c = p.copy;
  const pg = c.pages[index - 1];
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>@font-face{font-family:Pretendard;src:url(data:font/woff2;base64,${font});font-weight:45 920;font-display:block}*{box-sizing:border-box}body{margin:0;font-family:Pretendard;color:white}.card{width:1080px;height:1350px;overflow:hidden;position:relative;background:#0B1B2B}.photo{position:absolute;width:100%;height:100%;object-fit:cover;object-position:${p.focal.x}% ${p.focal.y}%;transform:scale(${p.focal.zoom});transform-origin:${p.focal.x}% ${p.focal.y}%}.scrim{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(11,27,43,0) 34%,rgba(11,27,43,.88) 72%,rgba(11,27,43,.97) 100%)}.content{position:absolute;left:64px;right:64px;bottom:64px;display:flex;flex-direction:column;gap:32px}.group{display:flex;flex-direction:column;gap:18px}.kicker{display:inline-block;background:#C8102E;padding:10px 20px;font-size:42px;font-weight:800;letter-spacing:.02em;white-space:nowrap}h1{margin:0;font-size:88px;font-weight:800;line-height:1.14;letter-spacing:-.025em;white-space:pre;word-break:keep-all}.gold{color:#FFC72C}.line{height:2px;background:rgba(255,255,255,.3)}.meta{display:flex;justify-content:space-between;gap:24px;color:rgba(255,255,255,.72);font-size:24px;font-weight:600}.domain{letter-spacing:.06em;white-space:nowrap}.bodycard{padding:80px 64px}.eyebrow{font-size:26px;font-weight:700;letter-spacing:.12em;color:#FFC72C}.bodytitle{font-size:48px;line-height:1.25;margin:64px 0 42px;word-break:keep-all;overflow-wrap:normal}.bodytext{font-size:${p.bodyFont}px;line-height:1.45;font-weight:650;white-space:pre-wrap;word-break:keep-all;overflow-wrap:normal;margin:0;max-height:840px}.bodyfooter{position:absolute;bottom:64px;left:64px;right:64px}</style></head><body><article class="card ${index ? "bodycard" : ""}">${index ? `<div class="eyebrow">NEWS BRIEF / ${String(index).padStart(2, "0")}</div><h2 class="bodytitle">${escape(pg.title)}</h2><p class="bodytext">${mark(pg.body, pg.highlight)}</p><div class="bodyfooter group"><div class="line"></div><div class="meta"><span>THE BRIEF</span><span>본문 ${index}/${p.count}</span></div></div>` : `<img class="photo" src="${image}"><div class="scrim"></div><div class="content"><div class="group">${c.kicker && !p.kickerHidden ? `<div><span class="kicker">${escape(c.kicker)}</span></div>` : ""}<h1 id="headline"></h1></div><div class="group"><div class="line"></div><div class="meta"><span id="credit">${escape(p.credit)}</span><span class="domain">THE BRIEF</span></div></div></div>`}</article></body></html>`;
}
export async function render(p: Project, only?: number) {
  p = migrateCover(structuredClone(p));
  const headline = headlineLayout(p.copy.headline, p.copy.headlineMode);
  if (headline.error) throw new Error(headline.error);
  if (!p.photo)
    throw Object.assign(new Error("표지 사진을 첨부해 주세요."), {
      code: "IMAGE",
    });
  if (!p.copy.headline.trim()) throw new Error("제목을 입력해 주세요.");
  if (
    only !== 0 &&
    p.copy.pages.some(
      (pg, i) =>
        (only === undefined || only === i + 1) &&
        (!pg.title.trim() || !pg.body.trim()),
    )
  )
    throw new Error("모든 본문 페이지의 제목과 본문을 입력해 주세요.");
  if (!p.kickerHidden && [...p.copy.kicker].length > 20)
    throw new Error("부제는 공백 포함 20자 이내로 수정해 주세요.");
  if (!Number.isInteger(p.bodyFont) || p.bodyFont < 54 || p.bodyFont > 60)
    throw new Error("본문 글자 크기는 54~60px이어야 합니다.");
  let font;
  try {
    font = (
      await fs.readFile("public/fonts/PretendardVariable.woff2")
    ).toString("base64");
  } catch {
    throw Object.assign(
      new Error("Pretendard 폰트 파일을 복구한 뒤 다시 렌더하세요."),
      { code: "FONT" },
    );
  }
  let image;
  try {
    image =
      "data:image/jpeg;base64," +
      (
        await fs.readFile(path.join(root, "uploads", path.basename(p.photo)))
      ).toString("base64");
  } catch {
    throw Object.assign(
      new Error("사진을 읽을 수 없습니다. 다시 첨부하세요."),
      { code: "IMAGE" },
    );
  }
  const semanticPlans =
    !headline.manual && (only === undefined || only === 0)
      ? await headlinePlans(headline.text)
      : null;
  // 서버 환경에서 --no-sandbox 등 실행 옵션을 넣을 때 CHROMIUM_ARGS(공백 구분)를 사용한다.
  const browser = await chromium.launch({
    headless: true,
    args: (process.env.CHROMIUM_ARGS || "").split(" ").filter(Boolean),
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1080, height: 1350 },
      deviceScaleFactor: 1,
    });
    const result = [...p.renders];
    let coverLayout = p.coverLayout;
    const indexes =
      only === undefined
        ? Array.from({ length: p.count + 1 }, (_, i) => i)
        : [only];
    for (const i of indexes) {
      await page.setContent(html(p, i, font, image));
      // tsx preserves nested function names with this esbuild helper in serialized evaluate callbacks.
      await page.addScriptTag({
        content:
          "window.__name = (fn) => fn; window.candidateLines = " +
          candidateLines.toString(),
      });
      const fontOk = await page.evaluate(async () => {
        try {
          await document.fonts.load("800 88px Pretendard");
          await document.fonts.ready;
          return (
            document.fonts.check("800 88px Pretendard") &&
            [...document.fonts].some(
              (f) => f.family === "Pretendard" && f.status === "loaded",
            )
          );
        } catch {
          return false;
        }
      });
      if (!fontOk)
        throw Object.assign(
          new Error("Pretendard 로딩 실패: 대체 폰트로 출력하지 않습니다."),
          { code: "FONT" },
        );
      if (i === 0) {
        if (
          !(await page
            .locator("img")
            .evaluate(
              (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
            ))
        )
          throw Object.assign(new Error("사진 디코딩 실패"), { code: "IMAGE" });
        const fit = await page.evaluate(
          ({ headline, manual, highlightFrom, semanticPlans }) => {
            const el = document.getElementById("headline")!;
            const measure = document.createElement("span");
            Object.assign(measure.style, {
              position: "absolute",
              visibility: "hidden",
              whiteSpace: "pre",
              fontWeight: "800",
              letterSpacing: "-.025em",
            });
            document.body.append(measure);
            let lines: string[] = [];
            let chosen = 0;
            let bestMeaning = Infinity;
            for (const size of [88, 80, 72]) {
              measure.style.fontSize = size + "px";
              const width = (s: string) => {
                measure.textContent = s;
                return measure.getBoundingClientRect().width;
              };
              let candidate: string[];
              let semanticPenalty = 0;
              if (manual.trim()) {
                if (
                  manual.replace(/\s+/g, " ").trim() !==
                  headline.replace(/\s+/g, " ").trim()
                )
                  return "수동 줄바꿈은 제목의 단어와 내용을 그대로 유지해야 합니다.";
                candidate = manual.split("\n");
              } else if (semanticPlans) {
                const rank = semanticPlans.findIndex((plan) =>
                  plan.every((line) => width(line) <= 952),
                );
                candidate = rank < 0 ? [] : semanticPlans[rank];
                // Editorial rank takes precedence over font size or balance.
                semanticPenalty = rank;
              } else {
                candidate = (window as any).candidateLines(
                  headline,
                  width,
                  952,
                  (penalty: number) => {
                    semanticPenalty = penalty;
                  },
                );
              }
              if (
                candidate.length > 0 &&
                candidate.length <= 3 &&
                candidate.every((l) => width(l) <= 952)
              ) {
                // A modest font reduction is preferable to breaking a sentence
                // or phrase. For equal semantic quality keep the larger font.
                const meaning = semanticPenalty + (88 - size) * 0.02;
                if (meaning < bestMeaning) {
                  lines = candidate;
                  chosen = size;
                  bestMeaning = meaning;
                }
                if (manual.trim()) break;
              }
            }
            measure.remove();
            if (!chosen)
              return semanticPlans
                ? "AI가 나눈 의미 단위가 카드 폭에 맞지 않습니다. 제목은 유지됩니다. 직접 줄바꿈을 지정하세요."
                : "제목이 72px에서도 3줄을 초과합니다. 단어를 줄이거나 줄바꿈을 수정하세요.";
            el.style.fontSize = chosen + "px";
            lines.forEach((line, n) => {
              const span = document.createElement("span");
              span.textContent = line;
              if (highlightFrom !== null && n >= highlightFrom)
                span.className = "gold";
              el.append(span);
              if (n < lines.length - 1) el.append(document.createElement("br"));
            });
            if (el.scrollWidth > el.clientWidth)
              return "제목의 실제 조판 너비가 넘칩니다. 문구를 수정하세요.";
            const kicker = document.querySelector(".kicker");
            if (kicker && kicker.getBoundingClientRect().width > 952)
              return "부제가 실제 너비를 초과합니다.";
            const credit = document.getElementById("credit")!;
            if (credit.scrollWidth > 700)
              return "사진 크레딧을 짧게 수정하세요.";
            return "";
          },
          {
            headline: headline.text,
            manual: headline.manual,
            semanticPlans,
            highlightFrom:
              p.highlightFrom === undefined
                ? p.copy.highlight
                  ? 1
                  : null
                : p.highlightFrom,
          },
        );
        if (fit) {
          // Offer shorter titles the card can actually hold. Suggestions are
          // measured here, never applied: the user picks one and re-renders.
          let suggestions: string[] = [];
          if (semanticPlans)
            try {
              const candidates = await shortHeadlines(headline.text);
              suggestions = await page.evaluate((candidates) => {
                const el = document.getElementById("headline")!;
                const measure = document.createElement("span");
                Object.assign(measure.style, {
                  position: "absolute",
                  visibility: "hidden",
                  whiteSpace: "pre",
                  fontWeight: "800",
                  letterSpacing: "-.025em",
                });
                document.body.append(measure);
                const fits = (text: string) =>
                  [88, 80, 72].some((size) => {
                    measure.style.fontSize = size + "px";
                    const width = (s: string) => {
                      measure.textContent = s;
                      return measure.getBoundingClientRect().width;
                    };
                    const lines = (window as any).candidateLines(
                      text,
                      width,
                      952,
                      () => {},
                    );
                    return (
                      lines.length > 0 &&
                      lines.length <= 3 &&
                      lines.every((l: string) => width(l) <= 952)
                    );
                  });
                const ok = candidates.filter(fits);
                measure.remove();
                el.textContent = "";
                return ok;
              }, candidates);
            } catch {
              /* Suggestions are optional: report the layout failure itself. */
            }
          throw Object.assign(new Error(fit), {
            code: "RENDER",
            ...(suggestions.length ? { suggestions } : {}),
          });
        }
        coverLayout = {
          headline: p.copy.headline,
          mode: p.copy.headlineMode,
          lines: await page.locator("#headline > span").allTextContents(),
        };
      } else {
        const overflow = await page.evaluate(() => {
          const t = document.querySelector(".bodytext")!;
          const h = document.querySelector(".bodytitle")!;
          return (
            t.scrollHeight > t.clientHeight ||
            t.scrollWidth > t.clientWidth ||
            t.getBoundingClientRect().bottom > 1210 ||
            h.scrollWidth > h.clientWidth
          );
        });
        if (overflow)
          throw new Error(
            `본문 ${i}장이 넘칩니다. 문구나 줄바꿈을 수정하세요 (54px 미만 축소 없음).`,
          );
      }
      const name = `${p.id}-r${p.revision}-${Date.now()}-${String(i).padStart(2, "0")}.png`;
      await page.screenshot({
        path: path.join(root, "renders", name),
        type: "png",
      });
      result[i] = "/renders/" + name;
    }
    return { images: result.slice(0, p.count + 1), coverLayout };
  } finally {
    await browser.close();
  }
}
