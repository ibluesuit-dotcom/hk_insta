import type { Copy } from "./model";

const protectedTags = new Set(["속보", "단독"]);

export function normalizeSourceTitle(sourceTitle: string): string {
  let title = sourceTitle.replace(/\s+/g, " ").trim();
  // Every bracket in the contiguous runs at both edges is a corner label, so
  // only the protected tags survive. Brackets elsewhere are headline content.
  const cleanRun = (run: string) =>
    run.replace(/\[[^\[\]]+\]/g, (tag) =>
      protectedTags.has(tag.slice(1, -1).trim()) ? tag : "",
    );
  title = title.replace(/^(?:\[[^\[\]]+\]\s*)+/, cleanRun);
  title = title.replace(/(?:\s*\[[^\[\]]+\])+$/, cleanRun);
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
