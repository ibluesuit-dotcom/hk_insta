import type { Copy } from "./model";

const protectedTags = new Set(["속보", "단독"]);
// Kept tags are masked while the loop removes the rest, then restored.
const PROTECT: Record<string, string> = {
  "[": "\uE000",
  "]": "\uE001",
  "(": "\uE002",
  ")": "\uE003",
};
const UNPROTECT = Object.fromEntries(
  Object.entries(PROTECT).map(([k, v]) => [v, k]),
);

export function normalizeSourceTitle(sourceTitle: string): string {
  let title = sourceTitle.replace(/\s+/g, " ").trim();
  // Every [ ] and ( ) is dropped with its contents, wherever it stands, except
  // the protected tags [단독] (단독) [속보] (속보). Innermost first, so nested
  // brackets go too.
  let before;
  do {
    before = title;
    title = title.replace(/\[[^\[\]()]*\]|\([^\[\]()]*\)/g, (tag) =>
      protectedTags.has(tag.slice(1, -1).trim())
        ? tag.replace(/[[\]()]/g, (c) => PROTECT[c])
        : "",
    );
  } while (title !== before);
  title = title.replace(/[\uE000-\uE003]/g, (c) => UNPROTECT[c]);
  title = title.replace(/\s+/g, " ").trim();
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
  return {
    headline,
    headlineMode: "literal",
    highlight: "",
    headlineEvidence: [sourceTitle],
  };
}
