import { Drafts } from "../shared/editor-drafts";

export const statusNames: Record<string, string> = {
  draft: "초안",
  generated: "문안 생성",
  edited: "미리보기 갱신 필요",
  rendered: "이미지 확인",
  reviewed: "이미지 준비 완료",
  exported: "내보내기 완료",
};

export function draftsStorageKey(projectId: string) {
  return "editor-drafts:" + projectId;
}

/** Drops page drafts whose page index no longer exists (index >= count). */
export function keepPageDraftsBelow(drafts: Drafts, count: number): Drafts {
  return Object.fromEntries(
    Object.entries(drafts).filter(
      ([key]) => !key.startsWith("page:") || Number(key.split(":")[1]) < count,
    ),
  );
}
