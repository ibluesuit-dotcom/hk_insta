import { Project } from "./model";
// A separate, local-only patch map. It is never spread into API project payloads.
export type Drafts = Record<string, Record<string, unknown>>;
export function itemPaths(key: string): string[] {
  if (/^page:[0-7]:(role|title|body|highlight|alt)$/.test(key)) {
    const [, i, field] = key.split(":");
    return [
      `copy.pages.${i}.${field}`,
      ...(field === "body" ? [`copy.pages.${i}.evidence`] : []),
    ];
  }
  const paths: Record<string, string[]> = {
    headline: [
      "copy.headline",
      "copy.headlineMode",
      "copy.highlight",
      "copy.headlineEvidence",
      "headlineBreaks",
      "highlightFrom",
    ],
    kicker: [
      "copy.kicker",
      "copy.kickerEvidence",
      "copy.kickerOrigin",
      "kickerHidden",
    ],
    photo: ["photo", "focal"],
    credit: ["credit"],
    bodyFont: ["bodyFont"],
    caption: ["copy.caption"],
    alt: ["copy.alt"],
  };
  return paths[key] || [];
}
export function draftItem(p: Project, key: string) {
  return Object.fromEntries(
    itemPaths(key).map((path) => [
      path,
      path.split(".").reduce((v: any, k) => v?.[k], p),
    ]),
  );
}
export function applyDrafts(p: Project, drafts: Drafts): Project {
  const next = structuredClone(p);
  for (const [key, patch] of Object.entries(drafts)) {
    if (!patch || typeof patch !== "object") continue;
    // Drafts saved before layout metadata existed used manual slash breaks.
    if (
      key === "headline" &&
      "copy.headline" in patch &&
      !("copy.headlineMode" in patch)
    )
      next.copy.headlineMode = "manual";
    for (const path of itemPaths(key)) {
      if (!(path in patch)) continue;
      const parts = path.split(".");
      const field = parts.pop()!;
      const owner = parts.reduce((v: any, k) => v?.[k], next);
      if (owner) owner[field] = structuredClone(patch[path]);
    }
  }
  return next;
}
export function reorderDrafts(
  drafts: Drafts,
  from: number,
  to: number,
): Drafts {
  const next: Drafts = {};
  for (const [key, patch] of Object.entries(drafts)) {
    const swap = (s: string) =>
      s.replace(
        /^(page:|copy\.pages\.)(\d+)([:.])/,
        (_, prefix, n, suffix) =>
          `${prefix}${+n === from ? to : +n === to ? from : n}${suffix}`,
      );
    next[swap(key)] = Object.fromEntries(
      Object.entries(patch).map(([path, value]) => [swap(path), value]),
    );
  }
  return next;
}
