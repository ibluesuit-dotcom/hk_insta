import { headlinePlans, shortHeadlines } from "./headline-plans";
import { candidateLines } from "../shared/linebreak";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import {
  PHOTO_TEXT_LIMIT,
  Project,
  headlineLayout,
  frameLines,
  isPhotoPage,
  migrateCover,
  type PhotoCard,
} from "../shared/model";
import { root } from "./store";
import { aiLabel, photoPathAllowed } from "../shared/ai-background";
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
/**
 * Escaped text with the first occurrence of each mark wrapped in its class;
 * overlapping marks after the first are skipped.
 */
export function marked(text: string, marks: [string | undefined, string][]) {
  const ranges = marks.flatMap(([sub, cls]) => {
    const at = sub ? text.indexOf(sub) : -1;
    return at < 0 ? [] : [{ at, end: at + sub!.length, cls }];
  });
  // Cut at every mark boundary; where marks overlap both classes apply.
  const cuts = [
    ...new Set([0, text.length, ...ranges.flatMap((r) => [r.at, r.end])]),
  ].sort((a, b) => a - b);
  let out = "";
  for (let i = 0; i + 1 < cuts.length; i++) {
    const piece = escape(text.slice(cuts[i], cuts[i + 1]));
    const classes = ranges
      .filter((r) => r.at <= cuts[i] && cuts[i + 1] <= r.end)
      .map((r) => r.cls);
    out += classes.length
      ? `<span class="${classes.join(" ")}">${piece}</span>`
      : piece;
  }
  return out;
}
// 1g handoff: warm neutral card, title, the photo in a white frame with a
// credit pill, and a three-line summary whose breaks the editor sets.
function frameCardHtml(card: PhotoCard, image: string) {
  const { x, y, zoom } = card.focal;
  const title = (card.title ?? "").trim();
  // Lines exactly as typed, blank ones included (they keep their height).
  const summary = frameLines(card.summary).map((l) => l.trim());
  return `<div class="fr">${title ? `<div class="fr-title">${marked(title, [[card.titleHighlight, "fr-red"]])}</div>` : ""}<div class="fr-frame"><div class="fr-inner"><img class="fr-photo" src="${image}" style="object-position:${x}% ${y}%;transform:scale(${zoom});transform-origin:${x}% ${y}%">${card.credit.trim() ? `<span class="fr-credit">${escape(card.credit.trim())}</span>` : ""}</div></div>${
    summary.length
      ? `<p class="fr-summary">${summary
          .map(
            (line) =>
              `<span class="fr-line">${
                marked(line, [
                  [card.summaryHighlight, "fr-red"],
                  [card.summaryUnderline, "fr-under"],
                ]) || "&#8203;"
              }</span>`,
          )
          .join("<br>")}</p>`
      : ""
  }</div>`;
}
// A following photo card: the photo (whole or filling the card), an optional
// caption strip at the bottom and the credit. No cover or brief decoration.
function photoCardHtml(card: PhotoCard, image: string) {
  if (card.layout === "frame") return frameCardHtml(card, image);
  const cover = card.fit === "cover";
  const { x, y, zoom } = card.focal;
  const text = card.textVisible && card.text.trim() ? card.text.trim() : "";
  return `<img class="pc-photo" src="${image}" style="object-fit:${cover ? "cover" : "contain"};${cover ? `object-position:${x}% ${y}%;transform:scale(${zoom});transform-origin:${x}% ${y}%` : ""}">${text ? `<div class="pc-scrim"></div><p class="pc-text">${escape(text)}</p>` : ""}${card.credit.trim() ? `<span class="pc-credit${text ? "" : " alone"}">${escape(card.credit.trim())}</span>` : ""}`;
}
export function html(p: Project, index: number, font: string, image: string) {
  const c = p.copy;
  const pg = c.pages[index - 1];
  const textIndexes = c.pages.flatMap((page, i) =>
    isPhotoPage(page) ? [] : [i],
  );
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>@font-face{font-family:Pretendard;src:url(data:font/woff2;base64,${font});font-weight:45 920;font-display:block}*{box-sizing:border-box}body{margin:0;font-family:Pretendard;color:white}.card{width:1080px;height:1350px;overflow:hidden;position:relative;background:#0B1B2B}.photo{position:absolute;width:100%;height:100%;object-fit:cover;object-position:${p.focal.x}% ${p.focal.y}%;transform:scale(${p.focal.zoom});transform-origin:${p.focal.x}% ${p.focal.y}%}.scrim{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(11,27,43,0) 34%,rgba(11,27,43,.88) 72%,rgba(11,27,43,.97) 100%)}.content{position:absolute;left:64px;right:64px;bottom:64px;display:flex;flex-direction:column;gap:32px}.group{display:flex;flex-direction:column;gap:18px}.kicker{display:inline-block;background:#C8102E;padding:10px 20px;font-size:42px;font-weight:800;letter-spacing:.02em;white-space:nowrap}h1{margin:0;font-size:88px;font-weight:800;line-height:1.14;letter-spacing:-.025em;white-space:pre;word-break:keep-all}.gold{color:#FFC72C}.line{height:2px;background:rgba(255,255,255,.3)}.meta{display:flex;justify-content:space-between;gap:24px;color:rgba(255,255,255,.72);font-size:24px;font-weight:600}.domain{letter-spacing:.06em;white-space:nowrap}.bodycard{padding:80px 64px}.eyebrow{font-size:26px;font-weight:700;letter-spacing:.12em;color:#FFC72C}.bodytitle{font-size:48px;line-height:1.25;margin:64px 0 42px;word-break:keep-all;overflow-wrap:normal}.bodytext{font-size:${p.bodyFont}px;line-height:1.45;font-weight:650;white-space:pre-wrap;word-break:keep-all;overflow-wrap:normal;margin:0;max-height:840px}.bodyfooter{position:absolute;bottom:64px;left:64px;right:64px}.pc-photo{position:absolute;inset:0;width:100%;height:100%}.pc-scrim{position:absolute;left:0;right:0;bottom:0;height:520px;background:linear-gradient(to bottom,rgba(11,27,43,0),rgba(11,27,43,.9) 55%)}.pc-text{position:absolute;left:64px;right:64px;bottom:120px;margin:0;font-size:46px;line-height:1.4;font-weight:750;white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere;max-height:193px;overflow:hidden}.pc-credit{position:absolute;right:64px;bottom:56px;font-size:22px;font-weight:600;color:rgba(255,255,255,.72)}.pc-credit.alone{background:rgba(11,27,43,.6);padding:6px 12px}.fr{position:absolute;inset:0;background:#F4F2EE;padding:104px 72px 96px;display:flex;flex-direction:column;align-items:center;gap:56px;color:#171719}.fr-title{font-size:101px;line-height:1.1;font-weight:700;letter-spacing:-0.0319em;text-align:center;white-space:nowrap;max-width:936px}.fr-red{color:#FF4242}.fr-frame{flex:1;width:100%;min-height:0;background:#FFFFFF;padding:20px;box-shadow:0 6px 24px rgba(23,23,23,0.10);display:flex}.fr-inner{position:relative;flex:1;overflow:hidden}.fr-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.fr-credit{position:absolute;bottom:20px;right:24px;background:rgba(255,255,255,0.88);border-radius:999px;padding:6px 16px;font-size:20px;font-weight:500;color:#171719}.fr-summary{margin:0;font-size:66px;line-height:1.44;font-weight:600;letter-spacing:-0.012em;text-align:center;white-space:pre}.fr-under{text-decoration:underline;text-decoration-color:#171719;text-underline-offset:10px;text-decoration-thickness:4px}</style></head><body><article class="card ${index && !isPhotoPage(pg) ? "bodycard" : ""}">${index && isPhotoPage(pg) ? photoCardHtml(pg.photoCard!, image) : index ? `<div class="eyebrow">NEWS BRIEF / ${String(index).padStart(2, "0")}</div><h2 class="bodytitle">${escape(pg.title)}</h2><p class="bodytext">${mark(pg.body, pg.highlight)}</p><div class="bodyfooter group"><div class="line"></div><div class="meta"><span>THE BRIEF</span><span>본문 ${textIndexes.indexOf(index - 1) + 1}/${textIndexes.length}</span></div></div>` : `<img class="photo" src="${image}"><div class="scrim"></div><div class="content"><div class="group">${c.kicker && !p.kickerHidden ? `<div><span class="kicker">${escape(c.kicker)}</span></div>` : ""}<h1 id="headline"></h1></div><div class="group"><div class="line"></div><div class="meta"><span id="credit">${escape(aiLabel(p) ?? p.credit)}</span><span class="domain">THE BRIEF</span></div></div></div>`}</article></body></html>`;
}
// Only the canonical AI spelling is shown; an alias would hide its label.
async function readPhoto(photo: string, card?: number) {
  const failure = () =>
    Object.assign(
      new Error(
        card
          ? `카드 ${card}의 사진을 읽을 수 없습니다. 다시 첨부하세요.`
          : "사진을 읽을 수 없습니다. 다시 첨부하세요.",
      ),
      { code: "IMAGE" },
    );
  if (!photoPathAllowed(photo)) throw failure();
  try {
    return (
      "data:image/jpeg;base64," +
      (
        await fs.readFile(path.join(root, "uploads", path.basename(photo)))
      ).toString("base64")
    );
  } catch {
    throw failure();
  }
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
  // Text kept behind a photo card is not output, so it is not checked.
  const selected = (i: number) => only === undefined || only === i + 1;
  if (
    only !== 0 &&
    p.copy.pages.some(
      (pg, i) =>
        selected(i) &&
        !isPhotoPage(pg) &&
        (!pg.title.trim() || !pg.body.trim()),
    )
  )
    throw new Error("모든 본문 페이지의 제목과 본문을 입력해 주세요.");
  for (const [i, pg] of p.copy.pages.entries())
    if (selected(i) && isPhotoPage(pg)) {
      if (!pg.photoCard?.photo)
        throw Object.assign(new Error(`카드 ${i + 2}에 사진을 넣어 주세요.`), {
          code: "IMAGE",
        });
      if (
        pg.photoCard.layout === "frame" &&
        frameLines(pg.photoCard.summary).length > 3
      )
        throw new Error(
          `카드 ${i + 2}의 요약이 3줄을 넘습니다. 3줄로 줄여 주세요.`,
        );
      if ([...pg.photoCard.text].length > PHOTO_TEXT_LIMIT)
        throw new Error(
          `카드 ${i + 2}의 사진 문구는 ${PHOTO_TEXT_LIMIT}자 이내로 줄여 주세요.`,
        );
    }
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
  const image = await readPhoto(p.photo);
  const cardImages = new Map<number, string>();
  for (const [i, pg] of p.copy.pages.entries())
    if (selected(i) && only !== 0 && isPhotoPage(pg))
      cardImages.set(i + 1, await readPhoto(pg.photoCard!.photo, i + 2));
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
      await page.setContent(html(p, i, font, cardImages.get(i) ?? image));
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
      if (cardImages.has(i)) {
        const problem = await page.evaluate(() => {
          const img = document.querySelector("img")!;
          if (!img.complete || !img.naturalWidth) return "decode";
          // Frame card: the title stays on one line (101px, else 86px: the handoff sizes less 10%) and
          // each summary line keeps the editor's break within 936px.
          const title = document.querySelector<HTMLElement>(".fr-title");
          if (title && title.scrollWidth > 936) {
            title.style.fontSize = "86px";
            if (title.scrollWidth > 936) return "frame-title";
          }
          if (
            [...document.querySelectorAll<HTMLElement>(".fr-line")].some(
              (l) => l.getBoundingClientRect().width > 936.5,
            )
          )
            return "frame-summary";
          const frame = document.querySelector(".fr-inner");
          if (frame && frame.getBoundingClientRect().height < 300)
            return "frame-photo";
          const t = document.querySelector(".pc-text");
          return t &&
            (t.scrollHeight > t.clientHeight + 1 ||
              t.scrollWidth > t.clientWidth + 1)
            ? "overflow"
            : "";
        });
        if (problem === "decode")
          throw Object.assign(new Error(`카드 ${i + 1}의 사진 디코딩 실패`), {
            code: "IMAGE",
          });
        if (problem === "frame-title")
          throw new Error(
            `카드 ${i + 1}의 제목이 한 줄(86px)에 들어가지 않습니다. 제목을 줄여 주세요.`,
          );
        if (problem === "frame-summary")
          throw new Error(
            `카드 ${i + 1}의 요약 한 줄이 카드 폭을 넘습니다. 줄바꿈을 나누거나 줄여 주세요.`,
          );
        if (problem === "frame-photo")
          throw new Error(
            `카드 ${i + 1}의 사진 칸이 너무 작습니다. 제목이나 요약을 줄여 주세요.`,
          );
        if (problem)
          throw new Error(
            `카드 ${i + 1}의 사진 문구가 3줄을 넘습니다. 문구를 줄여 주세요.`,
          );
      } else if (i === 0) {
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
    // A card not rendered yet is an empty slot, never a hole (JSON null).
    return {
      images: Array.from({ length: p.count + 1 }, (_, i) => result[i] || ""),
      coverLayout,
    };
  } finally {
    await browser.close();
  }
}
