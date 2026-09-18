import type { Copy } from "./model";

// Deliberately closed list: unknown labels and factual brackets are content.
const corners = new Set([
  "fn오전시황",
  "fn오후시황",
  "fn마감시황",
  "특징주",
  "마감시황",
  "오전시황",
  "오후시황",
  "개장시황",
  "장중시황",
  "증시시황",
]);
const protectedTags = new Set(["속보", "단독"]);

export function normalizeSourceTitle(sourceTitle: string): string {
  let title = sourceTitle.replace(/\s+/g, " ").trim();
  // Scan the contiguous bracket runs at both edges. Protected tags survive and
  // permit adjacent corner removal; any unknown bracket stops the scan.
  const cleanRun = (run: string, reverse: boolean) => {
    const tags = [...run.matchAll(/\[[^\[\]]+\]/g)];
    if (reverse) tags.reverse();
    let stopped = false;
    const removed = new Set<number>();
    for (const match of tags) {
      const label = match[0].slice(1, -1).trim();
      if (stopped || protectedTags.has(label)) continue;
      if (corners.has(label)) removed.add(match.index!);
      else stopped = true;
    }
    return run.replace(/\[[^\[\]]+\]/g, (tag, offset) =>
      removed.has(offset) ? "" : tag,
    );
  };
  title = title.replace(/^(?:\[[^\[\]]+\]\s*)+/, (run) => cleanRun(run, false));
  title = title.replace(/(?:\s*\[[^\[\]]+\])+$/, (run) => cleanRun(run, true));
  // Only paired quotes. A single quote inside a word is an apostrophe, not a pair.
  title = title.replace(/"([^"\n]+)"/g, "“$1”");
  title = title.replace(
    /(^|[\s([{])'([^'\n]+)'(?=$|[\s.,!?…\])}\p{L}])/gu,
    "$1‘$2’",
  );
  // Remove only a quotation-to-text bridge, never an omission inside the quote
  // or a terminal ellipsis. Two/three ASCII dots and the ellipsis glyph occur in feeds.
  title = title.replace(/([”’])(?:…+|\.{2,})\s*(?=[\p{L}\p{N}\[])/gu, "$1 ");
  return title.replace(/\s+/g, " ").trim();
}

export function sourceHeadline(
  sourceTitle: string,
): Pick<Copy, "headline" | "headlineMode" | "highlight" | "headlineEvidence"> {
  const headline = normalizeSourceTitle(sourceTitle);
  if (!headline)
    throw new Error(
      "원문 제목을 입력해 주세요. 표지 제목은 원제에서 적용합니다.",
    );
  if (headline.length > 200)
    throw new Error(
      "원문 제목이 표지 제목 한도(200자)를 초과합니다. 원문 제목을 확인해 주세요. 자동 축약하지 않습니다.",
    );
  return { headline, headlineMode: "literal", highlight: "", headlineEvidence: [sourceTitle] };
}
