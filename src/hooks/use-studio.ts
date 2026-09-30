import { useState, useEffect, useRef } from "react";
import { sourceHeadline } from "../../shared/source-title";
import { AiVariant, sourceHash } from "../../shared/ai-background";
import {
  PHOTO_CARD_LIMIT,
  Project,
  blankTextPage,
  keepPages,
  photoLimit,
  emptyPage,
  isPhotoPage,
  movePage,
  photoPageCount,
  profileOnlyChange,
  removePage,
  renderFresh,
  photoStyleOf,
  withStyle,
  type PhotoCard,
  type PhotoStyle,
} from "../../shared/model";
import {
  Drafts,
  applyDrafts,
  draftItem,
  reorderDrafts,
} from "../../shared/editor-drafts";
import {
  defaultPostOptions,
  postTextOf,
  type PostFormat,
  type PostOptions,
  type PostText,
} from "../../shared/post-text";
import { api } from "../api";
import { copyText } from "../browser";
import { captionKey, draftsStorageKey, keepPageDraftsBelow } from "../format";

export type Studio = ReturnType<typeof useStudio>;

/** A generated cover background candidate as returned by the server. */
export type AiCandidate = {
  assetId: string;
  url: string;
  variant: AiVariant;
  status: "ready" | "needs_review";
  reviewReason: string | null;
  subject: string;
  label: string;
  sourceHash: string;
  model: string;
  at: string;
};
export type AiSlot = {
  status: "idle" | "generating" | "done" | "failed";
  requestId: number;
  candidate?: AiCandidate;
  error?: string;
  blocked?: boolean;
};
export type AiState = {
  projectId: string;
  briefId?: string;
  briefHash?: string;
  notice: string;
  slots: Record<AiVariant, AiSlot>;
};
export const AI_VARIANTS: AiVariant[] = ["photo", "art"];
export type GenFormat = Exclude<PostFormat, "full">;
/** A generated post text waiting to be applied or discarded. */
export type PostCandidate = {
  id: string;
  format: GenFormat;
  text: string;
  /** This format's text when the candidate was made. */
  baseText: string;
  warnings: string[];
  omitted: string[];
  lengthExceptionReason: string | null;
  review: {
    overall: "pass" | "fail" | "needs_review";
    issues: string[];
    missing: string[];
  } | null;
  reviewError: string | null;
  ratio: number;
  model: string;
};
export type PostJob = {
  status: "generating" | "done" | "failed";
  request: number;
  candidate?: PostCandidate;
  error?: string;
};
const emptyAi = (projectId: string): AiState => ({
  projectId,
  notice: "",
  slots: {
    photo: { status: "idle", requestId: 0 },
    art: { status: "idle", requestId: 0 },
  },
});

// An unsaved caption plus the server caption it was written over (`base`).
type PendingCaption = { caption: string; base?: string };
function pendingCaption(projectId: string): PendingCaption | undefined {
  try {
    const raw = localStorage.getItem(captionKey(projectId));
    if (raw === null) return undefined;
    const value = JSON.parse(raw);
    if (typeof value?.caption === "string") return value;
  } catch {}
  return undefined;
}
function clearPendingCaption(projectId: string) {
  try {
    localStorage.removeItem(captionKey(projectId));
  } catch {}
}
// A pending caption that could not be applied safely is parked here until the
// user explicitly applies or discards it; later typing never touches it.
const recoveryKey = (projectId: string) => "caption-recovery:" + projectId;
function recoveredCaption(projectId: string) {
  try {
    return localStorage.getItem(recoveryKey(projectId));
  } catch {
    return null;
  }
}
function setRecoveredCaption(projectId: string, caption: string | null) {
  try {
    if (caption === null) localStorage.removeItem(recoveryKey(projectId));
    else localStorage.setItem(recoveryKey(projectId), caption);
  } catch {}
}
/**
 * Project editing state: the committed server project, browser-local drafts,
 * the busy lock, and save/flush/generate/render actions with their revision
 * and stale-result guards.
 */
export function useStudio() {
  const [committed, setP] = useState<Project | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const draftsRef = useRef<Drafts>({});
  const p = committed ? applyDrafts(committed, drafts) : null;
  const [list, setList] = useState<Project[]>([]);
  const [view, setView] = useState("studio");
  const [tab, setTab] = useState("source");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  // Unsaved caption from an earlier session that could not be applied safely.
  const [captionConflict, setCaptionConflict] = useState<string | null>(null);
  const serverCaption = useRef("");
  const [saved, setSaved] = useState("서버에 자동 저장");
  const [dirty, setDirty] = useState(false);
  const [index, setIndex] = useState(0);
  const [preview, setPreview] = useState("phone");
  const [width, setWidth] = useState(360);
  const [clipboardStatus, setClipboardStatus] = useState("");
  const [sourceCopyStatus, setSourceCopyStatus] = useState("");
  const [headlineSuggestions, setHeadlineSuggestions] = useState<string[]>([]);
  // Post step: the format on screen (not the export format), per-format
  // options for the next generation and generation jobs. Generation runs
  // outside the global busy lock; its result is only a candidate.
  const [postView, setPostView] = useState<PostFormat>("short");
  const [postOptions, setPostOptions] = useState<
    Record<GenFormat, PostOptions>
  >({
    short: defaultPostOptions(),
    summary: defaultPostOptions(),
    bullets: defaultPostOptions(),
  });
  const [postJobs, setPostJobs] = useState<Partial<Record<GenFormat, PostJob>>>(
    {},
  );
  const postRequest = useRef(0);
  const postProject = useRef("");
  const [postCopyStatus, setPostCopyStatus] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [health, setHealth] = useState<any>({});
  const ref = useRef<Project | null>(null);
  const editSequence = useRef(0);
  const dirtyRef = useRef(false);
  const busyRef = useRef(false);
  const saving = useRef<Promise<Project> | null>(null);
  const saveBlocked = useRef(false);
  const autosavePaused = useRef(false);
  // AI background candidates live here so they survive tab switches. Late
  // responses are dropped unless project, lookup generation and request match.
  const [ai, setAiState] = useState<AiState | null>(null);
  const aiRef = useRef<AiState | null>(null);
  const aiGeneration = useRef(0);
  const aiRequest = useRef(0);
  async function enterStudio() {
    await run("스튜디오 여는 중", async () => {
      const [health, projects] = await Promise.all([
        api("/health"),
        api("/projects"),
      ]);
      setHealth(health);
      setList(projects);
      const activeId = sessionStorage.getItem("studio-project");
      const existing = projects.find((item: Project) => item.id === activeId);
      const project = existing
        ? await api("/projects/" + existing.id)
        : await api("/projects", "POST");
      accept(project);
      setList(existing ? projects : [project, ...projects]);
      setView("studio");
      setTab("source");
      setIndex(0);
    });
  }
  function accept(next: Project) {
    let recoverCaption: string | undefined;
    serverCaption.current = next.copy.caption;
    sessionStorage.setItem("studio-project", next.id);
    if (ref.current?.id !== next.id) {
      let stored: Drafts = {};
      try {
        stored = JSON.parse(
          localStorage.getItem(draftsStorageKey(next.id)) || "{}",
        );
      } catch {}
      stored = keepPageDraftsBelow(stored, next.count);
      // An unsaved caption (or a leftover draft from when captions were
      // staged locally) goes back on the save path only if the server caption
      // is still the one it was written over and is unlocked. Otherwise it is
      // kept and offered to the user, never silently applied or dropped.
      const legacy = stored.caption?.["copy.caption"];
      const unsaved: PendingCaption | undefined =
        pendingCaption(next.id) ??
        (typeof legacy === "string"
          ? { caption: legacy, base: next.copy.caption }
          : undefined);
      if (unsaved && unsaved.caption !== next.copy.caption) {
        if (!next.locks.caption && unsaved.base === next.copy.caption)
          recoverCaption = unsaved.caption;
        else setRecoveredCaption(next.id, unsaved.caption);
      }
      clearPendingCaption(next.id);
      const parked = recoveredCaption(next.id);
      if (parked === next.copy.caption) setRecoveredCaption(next.id, null);
      setCaptionConflict(parked === next.copy.caption ? null : parked);
      if (typeof legacy === "string") {
        const { caption: _old, ...rest } = stored;
        stored = rest;
        try {
          localStorage.setItem(
            draftsStorageKey(next.id),
            JSON.stringify(stored),
          );
        } catch {}
      }
      draftsRef.current = stored;
      setDrafts(stored);
      saveBlocked.current = false;
      postProject.current = next.id;
      setPostJobs({});
      setPostView(next.postText?.selected ?? "short");
      setPostCopyStatus("");
      aiGeneration.current++;
      aiRef.current = emptyAi(next.id);
      setAiState(aiRef.current);
    }
    ref.current = next;
    setIndex((index) => Math.min(index, next.count));
    setP(next);
    setDirty(false);
    dirtyRef.current = false;
    autosavePaused.current = false;
    setSaved("서버 저장 완료");
    if (pendingCaption(next.id)?.caption === next.copy.caption)
      clearPendingCaption(next.id);
    if (recoverCaption !== undefined) setCaption(recoverCaption, true);
  }
  function edit(fn: (p: Project) => Project, internal = false) {
    if (busyRef.current && !internal) return;
    const current = ref.current;
    if (!current) return;
    const next = fn(structuredClone(current));
    if (!profileOnlyChange(current, next)) {
      next.imageApproved = false;
      next.copyApproved = false;
      next.status = "edited";
    }
    ref.current = next;
    setIndex((index) => Math.min(index, next.count));
    editSequence.current++;
    autosavePaused.current = false;
    setP(next);
    setDirty(true);
    dirtyRef.current = true;
    setSaved("저장 대기…");
  }
  function persistDrafts(next: Drafts) {
    draftsRef.current = next;
    setDrafts(next);
    try {
      localStorage.setItem(
        draftsStorageKey(ref.current!.id),
        JSON.stringify(next),
      );
    } catch {
      setError(
        "이 브라우저에 초안을 보관하지 못했습니다. 창을 닫기 전에 로컬 초안 보관으로 내려받으세요.",
      );
    }
  }
  function stage(key: string, fn: (p: Project) => Project) {
    if (busyRef.current || !ref.current) return;
    const visible = applyDrafts(ref.current, draftsRef.current);
    persistDrafts({ ...draftsRef.current, [key]: draftItem(fn(visible), key) });
  }
  useEffect(() => {
    if (committed?.id) loadAiRecent(committed.id);
  }, [committed?.id]);
  function setAi(
    projectId: string,
    generation: number,
    fn: (state: AiState) => AiState,
  ) {
    const state = aiRef.current;
    if (
      !state ||
      state.projectId !== projectId ||
      generation !== aiGeneration.current ||
      ref.current?.id !== projectId
    )
      return false;
    aiRef.current = fn(state);
    setAiState(aiRef.current);
    return true;
  }
  function setSlot(
    projectId: string,
    generation: number,
    variant: AiVariant,
    requestId: number | null,
    slot: Partial<AiSlot>,
  ) {
    setAi(projectId, generation, (state) => {
      const current = state.slots[variant];
      if (requestId !== null && current.requestId !== requestId) return state;
      return {
        ...state,
        slots: { ...state.slots, [variant]: { ...current, ...slot } },
      };
    });
  }
  /** Restore completed candidates after reload or re-entering a project. */
  async function loadAiRecent(projectId: string) {
    const generation = aiGeneration.current;
    let recent: Partial<Record<AiVariant, AiCandidate>>;
    try {
      recent = await api(`/projects/${projectId}/ai-background/recent`);
    } catch {
      return;
    }
    setAi(projectId, generation, (state) => {
      const slots = { ...state.slots };
      for (const variant of AI_VARIANTS) {
        const candidate = recent[variant];
        // A running or already filled slot is never replaced by recent.
        if (candidate && slots[variant].status === "idle")
          slots[variant] = { ...slots[variant], status: "done", candidate };
      }
      return { ...state, slots };
    });
  }
  /** Brief once from the saved article, then one image per variant in parallel. */
  async function generateAi(variants: AiVariant[] = AI_VARIANTS) {
    const project = ref.current;
    const state = aiRef.current;
    if (busyRef.current || !project || !state) return;
    if (variants.some((v) => state.slots[v].status === "generating")) return;
    const projectId = project.id;
    const generation = aiGeneration.current;
    const requests = Object.fromEntries(
      variants.map((v) => [v, ++aiRequest.current]),
    ) as Record<AiVariant, number>;
    setAi(projectId, generation, (state) => ({ ...state, notice: "" }));
    for (const v of variants)
      setSlot(projectId, generation, v, null, {
        status: "generating",
        requestId: requests[v],
        error: undefined,
        blocked: false,
      });
    let briefId: string;
    try {
      const current = await flush();
      const hash = sourceHash(current);
      const known = aiRef.current;
      if (
        known?.projectId === projectId &&
        known.briefId &&
        known.briefHash === hash
      )
        briefId = known.briefId;
      else {
        const brief = await api(
          `/projects/${projectId}/ai-background/brief`,
          "POST",
          { expectedSourceHash: hash },
        );
        briefId = brief.briefId;
        setAi(projectId, generation, (state) => ({
          ...state,
          briefId: brief.briefId,
          briefHash: brief.sourceHash,
        }));
      }
    } catch (e) {
      for (const v of variants)
        setSlot(projectId, generation, v, requests[v], {
          status: "failed",
          error: (e as Error).message,
        });
      return;
    }
    await Promise.all(
      variants.map(async (variant) => {
        try {
          const candidate: AiCandidate = await api(
            `/projects/${projectId}/ai-background`,
            "POST",
            { briefId, variant },
          );
          setSlot(projectId, generation, variant, requests[variant], {
            status: "done",
            candidate,
          });
        } catch (e) {
          if ((e as any).code === "AI_BRIEF_MISSING")
            setAi(projectId, generation, (state) => ({
              ...state,
              briefId: undefined,
              briefHash: undefined,
            }));
          setSlot(projectId, generation, variant, requests[variant], {
            status: "failed",
            error: (e as Error).message,
            blocked: (e as any).code === "AI_BLOCKED",
          });
        }
      }),
    );
  }
  /**
   * Dedicated apply: save every draft, drop photo drafts, apply the asset on
   * the server and re-render only the cover, all inside one run().
   */
  async function applyAi(assetId: string) {
    const project = ref.current;
    if (!project) return false;
    const projectId = project.id;
    let notice = "";
    const ok = await run("AI 배경 적용 중", async () => {
      let current: Project;
      try {
        current = await saveDrafts();
      } catch (e) {
        if (
          !["AI_FOREIGN", "AI_ASSET"].includes((e as any).code) ||
          !draftsRef.current.photo
        )
          throw e;
        // An AI photo draft this project may not use: drop it and go on.
        const { photo: _, ...rest } = draftsRef.current;
        persistDrafts(rest);
        autosavePaused.current = false;
        notice = "사용할 수 없는 AI 사진 초안을 비웠습니다. ";
        current = await saveDrafts();
      }
      if (draftsRef.current.photo) {
        const { photo: _, ...rest } = draftsRef.current;
        persistDrafts(rest);
      }
      const applied: Project = await api(
        `/projects/${current.id}/ai-background/apply`,
        "POST",
        { revision: current.revision, assetId },
      );
      accept(applied);
      setIndex(0);
      if (!applied.copy.headline.trim()) {
        notice += "배경 적용됨. 제목이 정해지면 미리보기 갱신에서 렌더됩니다.";
        return;
      }
      try {
        setBusy("표지를 다시 렌더하고 있습니다");
        accept(
          await api(`/projects/${applied.id}/render`, "POST", {
            revision: applied.revision,
            only: 0,
          }),
        );
        notice +=
          "배경 적용됨. 표지만 다시 렌더했습니다. 내보내기 전에 전체 미리보기 갱신이 필요합니다.";
      } catch (e) {
        throw new Error(
          "배경은 적용됨, 표지 렌더 실패: " +
            (e as Error).message +
            " 미리보기 갱신으로 다시 렌더하세요.",
        );
      }
    });
    if (notice)
      setAi(projectId, aiGeneration.current, (state) => ({ ...state, notice }));
    return ok;
  }
  async function saveDrafts(): Promise<Project> {
    if (saving.current) await saving.current;
    if (saveBlocked.current) return flush();
    const next = applyDrafts(ref.current!, draftsRef.current);
    if (!dirtyRef.current && !Object.keys(draftsRef.current).length)
      return next;
    setSaved("저장 중…");
    try {
      const result = await api("/projects/" + next.id, "PUT", next);
      accept(result);
      persistDrafts({});
      return result;
    } catch (e) {
      saveFailed(e);
      throw e;
    }
  }
  function exportReady(project: Project) {
    let local = project.id === ref.current?.id ? draftsRef.current : {};
    if (project.id !== ref.current?.id) {
      try {
        local = JSON.parse(
          localStorage.getItem(draftsStorageKey(project.id)) || "{}",
        );
      } catch {
        return false;
      }
    }
    return (
      renderFresh(project) &&
      !Object.keys(local).length &&
      !(project.id === ref.current?.id && dirtyRef.current)
    );
  }
  function reorder(from: number, to: number) {
    return run("페이지 순서 저장 중", async () => {
      const current = await flush();
      const next = movePage(structuredClone(current), from, to);
      accept(await api("/projects/" + current.id, "PUT", next));
      persistDrafts(reorderDrafts(draftsRef.current, from, to));
      setIndex(to + 1);
    });
  }
  async function flush(): Promise<Project> {
    if (saving.current) {
      await saving.current;
      return flush();
    }
    const current = ref.current!;
    if (saveBlocked.current)
      throw new Error(
        "다른 창의 변경과 충돌했습니다. 작성 내용은 이 창에 유지됩니다. 로컬 초안을 내려받고 최신 작업을 다시 열어 비교하세요.",
      );
    if (!dirtyRef.current) return current;
    const seq = editSequence.current;
    setSaved("저장 중…");
    const promise = api("/projects/" + current.id, "PUT", current);
    saving.current = promise;
    try {
      const result = await promise;
      if (seq === editSequence.current) accept(result);
      else {
        // The server now holds this save's caption; newer typing is pending
        // on top of it, so rebase the pending copy to avoid a false conflict.
        serverCaption.current = result.copy.caption;
        const pending = pendingCaption(result.id);
        if (pending)
          try {
            localStorage.setItem(
              captionKey(result.id),
              JSON.stringify({ ...pending, base: result.copy.caption }),
            );
          } catch {}
        ref.current = { ...ref.current!, revision: result.revision };
        setP(ref.current);
        setSaved("저장 대기…");
      }
    } catch (e) {
      saveFailed(e);
      throw e;
    } finally {
      saving.current = null;
    }
    return dirtyRef.current ? flush() : ref.current!;
  }
  function saveFailed(e: unknown) {
    if ((e as any).code === "CONFLICT") saveBlocked.current = true;
    // Status changes, draft typing and unrelated actions must not retry a
    // rejected source save. A new explicit edit (or manual save) can retry.
    autosavePaused.current = true;
    setSaved("저장 실패 · 다시 시도");
  }
  useEffect(() => {
    if (!dirty || busy || saveBlocked.current || autosavePaused.current) return;
    const timer = setTimeout(() => {
      if (!busyRef.current && !autosavePaused.current)
        flush().catch((e) => setError(e.message));
    }, 650);
    return () => clearTimeout(timer);
  }, [committed, dirty, busy]);
  async function run(label: string, fn: () => Promise<void>) {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(label);
    setError("");
    try {
      await fn();
      return true;
    } catch (e) {
      setError((e as Error).message);
      const offered = (e as any).suggestions;
      if (Array.isArray(offered)) setHeadlineSuggestions(offered);
      return false;
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }
  async function open(id: string) {
    await run("작업 여는 중", async () => {
      if (ref.current && dirty) await flush();
      accept(await api("/projects/" + id));
      setView("studio");
      setIndex(0);
    });
  }
  async function createCard() {
    await run("새 카드 만드는 중", async () => {
      if (ref.current) await flush();
      const project = await api("/projects", "POST");
      accept(project);
      setList((items) => [project, ...items]);
      setView("studio");
      setTab("source");
      setIndex(0);
      setClipboardStatus("");
    });
  }
  async function action(kind: string, payload: any = {}) {
    return run(
      kind === "generate"
        ? payload.scope === "headline" && ref.current?.sourceTitle.trim()
          ? "원제를 적용하고 있습니다"
          : "Astra가 문안을 작성하고 있습니다"
        : kind === "render"
          ? "1080 × 1350 이미지를 렌더하고 있습니다"
          : "처리 중",
      async () => {
        if (kind === "restore" && Object.keys(draftsRef.current).length)
          throw new Error(
            "미반영 초안을 미리보기 갱신으로 저장한 뒤 버전을 복원하세요.",
          );
        let current = kind === "render" ? await saveDrafts() : await flush();
        if (
          ref.current!.revision !== current.revision ||
          saved === "저장 대기…"
        )
          current = await flush();
        if (kind === "generate" && payload.scope === "all" && !current.photo)
          throw new Error(
            "생성 전에 표지 사진을 첨부하세요. AI는 호출되지 않았습니다.",
          );
        if (
          kind === "generate" &&
          payload.scope === "all" &&
          current.postType === "photo" &&
          !photoPageCount(current)
        )
          throw new Error(
            "사진 게시물은 본문 사진을 1장 이상 올린 뒤 생성하세요. AI는 호출되지 않았습니다.",
          );
        if (
          kind === "generate" &&
          ["all", "headline"].includes(payload.scope) &&
          current.sourceTitle.trim()
        )
          sourceHeadline(current.sourceTitle);
        const partial =
          kind === "generate" && !["all", "keywords"].includes(payload.scope);
        const seq = editSequence.current;
        const result = await api(
          "/projects/" + current.id + "/" + kind,
          "POST",
          {
            revision: current.revision,
            ...payload,
          },
        );
        if (partial && payload.scope === "caption") {
          setCaption(result.copy.caption, true);
          return;
        }
        if (partial) {
          const keys = payload.scope.startsWith("page:")
            ? ["role", "title", "body", "highlight", "alt"].map(
                (k) => payload.scope + ":" + k,
              )
            : payload.scope === "pages"
              ? result.copy.pages.flatMap(
                  (page: Project["copy"]["pages"][number], i: number) =>
                    isPhotoPage(page)
                      ? []
                      : ["role", "title", "body", "highlight", "alt"].map(
                          (k) => `page:${i}:${k}`,
                        ),
                )
              : [payload.scope];
          const next = { ...draftsRef.current };
          for (const key of keys) next[key] = draftItem(result, key);
          persistDrafts(next);
          return;
        }
        if (seq === editSequence.current) accept(result);
        else {
          if (ref.current?.id === current.id) {
            ref.current = { ...ref.current, revision: result.revision };
            setP(ref.current);
          }
          throw new Error(
            "처리 중 편집된 내용이 있어 결과를 적용하지 않았습니다. 저장 후 다시 시도하세요.",
          );
        }
        if (kind === "generate" && payload.scope === "all") {
          try {
            setBusy("1080 × 1350 이미지를 렌더하고 있습니다");
            accept(
              await api(`/projects/${result.id}/render`, "POST", {
                revision: result.revision,
              }),
            );
            setIndex(0);
          } catch (e) {
            throw new Error(
              "문안 생성·저장은 완료했습니다. 이미지 렌더 실패: " +
                (e as Error).message +
                " 02 문안·사진 편집에서 수정 후 미리보기 갱신을 눌러 주세요.",
            );
          }
        }
      },
    );
  }
  function set<K extends keyof Project>(k: K, v: Project[K]) {
    const key = (
      {
        highlightFrom: "headline",
        kickerHidden: "kicker",
        photo: "photo",
        focal: "photo",
        credit: "credit",
        bodyFont: "bodyFont",
      } as Record<string, string>
    )[k];
    if (key) stage(key, (p) => ({ ...p, [k]: v }));
    else edit((p) => ({ ...p, [k]: v }));
  }
  // The post caption is not on any card: it autosaves directly instead of
  // waiting for a render, and a caption edit keeps the rendered images fresh.
  // Until the server has the caption, a copy in localStorage survives a
  // failed save and a reload; accept() clears it once the server matches.
  function setCaption(caption: string, internal = false) {
    if (busyRef.current && !internal) return;
    if (ref.current?.copy.caption === caption) return;
    const id = ref.current!.id;
    try {
      localStorage.setItem(
        captionKey(id),
        JSON.stringify({
          caption,
          base: serverCaption.current,
        }),
      );
    } catch {}
    edit((p) => ({ ...p, copy: { ...p.copy, caption } }), internal);
  }
  function applyCaptionConflict() {
    if (captionConflict === null || !ref.current) return;
    setCaption(captionConflict);
    discardCaptionConflict();
  }
  function discardCaptionConflict() {
    if (ref.current) setRecoveredCaption(ref.current.id, null);
    setCaptionConflict(null);
  }
  function copy(k: string, v: any) {
    if (k === "caption") return setCaption(v);
    stage(k, (p) => ({
      ...p,
      ...(k === "headline" ? { headlineBreaks: "" } : {}),
      copy: {
        ...p.copy,
        [k]: v,
        ...(k === "headline" ? { headlineMode: "escaped" as const } : {}),
      },
    }));
  }
  async function copyKeyword(text: string) {
    const copied = await copyText(text);
    setClipboardStatus(
      copied
        ? `${text} 복사 완료`
        : "복사하지 못했습니다. 검색어를 선택해 직접 복사해 주세요.",
    );
  }
  function applyHeadlineSuggestion(text: string) {
    copy("headline", text);
    setHeadlineSuggestions([]);
    setError("");
  }
  async function copySource() {
    const text = p?.source ?? "";
    if (!text.trim()) {
      setSourceCopyStatus("복사할 원문이 없습니다.");
      return;
    }
    const copied = await copyText(text);
    setSourceCopyStatus(
      copied
        ? `원문 ${text.length.toLocaleString()}자를 복사했습니다.`
        : "복사하지 못했습니다. 원문을 선택해 직접 복사해 주세요.",
    );
  }
  function pageField(k: string, v: any) {
    stage(`page:${index - 1}:${k}`, (p) => {
      (p.copy.pages[index - 1] as any)[k] = v;
      return p;
    });
  }
  async function photo(file: File | undefined, profile = false) {
    if (!file) return;
    await run("사진 저장 중", async () => {
      const form = new FormData();
      form.append("file", file);
      const r = await api("/photos", "POST", form);
      if (!profile && (tab !== "source" || ref.current!.photo)) {
        const visible = applyDrafts(ref.current!, draftsRef.current);
        visible.photo = r.url;
        persistDrafts({
          ...draftsRef.current,
          photo: draftItem(visible, "photo"),
        });
      } else {
        edit(
          (p) => ({ ...p, [profile ? "profilePhoto" : "photo"]: r.url }),
          true,
        );
        await flush();
      }
    });
  }
  // Photo cards. A card changes kind only after its photo is uploaded and the
  // change is saved; a cancelled pick or failed upload leaves it as it was.
  const photoLimitError = (p: Project) =>
    new Error(
      `사진 카드는 표지 외 최대 ${photoLimit(p)}장입니다. 다른 사진 카드를 텍스트로 되돌리거나 삭제하세요.`,
    );
  async function uploadPhoto(file: File): Promise<string> {
    const form = new FormData();
    form.append("file", file);
    return (await api("/photos", "POST", form)).url;
  }
  // New photo cards follow the photo post's design choice.
  const styleFields = (p: Project): Partial<PhotoCard> =>
    p.photoFrame
      ? { layout: "frame", fit: "cover", focal: { x: 30, y: 40, zoom: 1 } }
      : { textVisible: !!p.photoText };
  const newPhotoCard = (
    photo: string,
    kept?: PhotoCard,
    style: Partial<PhotoCard> = {},
  ): PhotoCard => ({
    fit: "contain",
    focal: { x: 50, y: 50, zoom: 1 },
    text: "",
    textVisible: false,
    ...style,
    credit: "",
    alt: "",
    ...kept,
    photo,
  });
  /**
   * A structural card change (kind, photo, add, delete). Card text drafts are
   * saved first so no hidden draft is left behind a photo; the change is sent
   * as one save and shown only once the server has accepted it. On failure the
   * editor keeps showing the saved cards.
   */
  async function saveCardChange(
    label: string,
    uploads: File[],
    change: (p: Project, photos: string[]) => void,
    check: (p: Project) => void = () => {},
  ) {
    return run(label, async () => {
      check(ref.current!);
      const photos: string[] = [];
      for (const file of uploads) photos.push(await uploadPhoto(file));
      const current = await saveDrafts();
      check(current);
      const next = structuredClone(current);
      change(next, photos);
      accept(await api("/projects/" + next.id, "PUT", next));
    });
  }
  const photoRoom = (p: Project, adding = 1) => {
    if (photoPageCount(p) + adding > photoLimit(p)) throw photoLimitError(p);
  };
  /** Text card i → photo card, with a new file or the photo kept from before. */
  function toPhotoCard(i: number, file?: File) {
    const kept = ref.current?.copy.pages[i]?.photoCard;
    if (!file && !kept) return;
    return saveCardChange(
      "사진 카드로 바꾸는 중",
      file ? [file] : [],
      (p, [photo]) => {
        const page = p.copy.pages[i];
        page.kind = "photo";
        page.photoCard = newPhotoCard(
          photo || kept!.photo,
          page.photoCard,
          styleFields(p),
        );
      },
      (p) => photoRoom(p),
    );
  }
  /** Photo card i → text card. Its text and photo settings both stay stored. */
  function toTextCard(i: number) {
    return saveCardChange("텍스트 카드로 바꾸는 중", [], (p) => {
      p.copy.pages[i].kind = "text";
    });
  }
  function replaceCardPhoto(i: number, file: File) {
    return saveCardChange("사진 교체 중", [file], (p, [photo]) => {
      const page = p.copy.pages[i];
      page.photoCard = newPhotoCard(photo, page.photoCard);
    });
  }
  function photoCardField(i: number, patch: Partial<PhotoCard>) {
    edit((p) => {
      const page = p.copy.pages[i];
      if (page.photoCard) page.photoCard = { ...page.photoCard, ...patch };
      return p;
    });
  }
  /** Appends a text card, or a photo card once its upload succeeds. */
  async function addCard(file?: File) {
    if (file) return addPhotoCards([file]);
    const ok = await saveCardChange(
      "카드 추가 중",
      [],
      (p) => {
        p.copy.pages.push(emptyPage());
        p.count++;
      },
      (p) => {
        if (p.count >= 8) throw new Error("카드는 표지 외 최대 8장입니다.");
      },
    );
    if (ok) setIndex(ref.current!.count);
  }
  /**
   * Adds photo cards after all uploads succeed. Untouched blank text cards
   * (a new project starts with one) make way for them.
   */
  async function addPhotoCards(files: File[]) {
    if (!files.length) return;
    const blank =
      (p: Project) => (pg: Project["copy"]["pages"][number], i: number) =>
        blankTextPage(pg, !!p.locks[`page:${i}`]);
    const room = (p: Project) => {
      const blanks = p.copy.pages.filter(blank(p)).length;
      if (p.count - blanks + files.length > 8)
        throw new Error("카드는 표지 외 최대 8장입니다.");
      photoRoom(p, files.length);
    };
    const ok = await saveCardChange(
      files.length > 1 ? `사진 ${files.length}장 추가 중` : "사진 카드 추가 중",
      files,
      (p, photos) => {
        const isBlank = blank(p);
        keepPages(
          p,
          p.copy.pages.flatMap((pg, i) => (isBlank(pg, i) ? [] : [i])),
        );
        p.copy.pages.push(
          ...photos.map((photo) => ({
            ...emptyPage(),
            kind: "photo" as const,
            photoCard: newPhotoCard(photo, undefined, styleFields(p)),
          })),
        );
        p.count = p.copy.pages.length;
      },
      room,
    );
    if (ok) setIndex(ref.current!.count);
  }
  /**
   * Summary post or photo post. A photo post may hold more photos, so going
   * back is refused while it has more than a summary post allows.
   */
  function setPostType(postType: "summary" | "photo") {
    const p = ref.current;
    if (!p) return;
    if (postType === "summary" && photoPageCount(p) > PHOTO_CARD_LIMIT) {
      setError(
        `사진이 ${photoPageCount(p)}장이라 '사진 + 요약 텍스트'로 바꿀 수 없습니다. 사진 카드를 ${PHOTO_CARD_LIMIT}장 이하로 줄이세요.`,
      );
      return;
    }
    edit((p) => {
      p.postType = postType;
      // Photo cards that already show captions keep them: the post-level
      // choice starts from what the cards actually output.
      if (postType === "photo") {
        const cards = p.copy.pages.flatMap((pg) =>
          isPhotoPage(pg) && pg.photoCard ? [pg.photoCard] : [],
        );
        p.photoFrame =
          cards.length > 0 && cards.every((c) => photoStyleOf(c) === "frame");
        p.photoText = cards.some((c) => photoStyleOf(c) === "caption");
      }
      return p;
    });
  }
  /**
   * 이미지만 / 이미지 + 하단 글 / 제목·사진·요약(액자형) for every photo card.
   * Written captions, titles and summaries are kept when switching.
   */
  function setPhotoStyle(style: PhotoStyle) {
    edit((p) => {
      p.photoText = style === "caption";
      p.photoFrame = style === "frame";
      for (const page of p.copy.pages)
        if (page.photoCard) page.photoCard = withStyle(page.photoCard, style);
      return p;
    });
  }
  function setCardStyle(i: number, style: PhotoStyle) {
    edit((p) => {
      const page = p.copy.pages[i];
      if (page.photoCard) page.photoCard = withStyle(page.photoCard, style);
      return p;
    });
  }
  async function deleteCard(i: number) {
    const ok = await saveCardChange("카드 삭제 중", [], (p) => {
      // The last card cannot go: it becomes a blank text card instead, which
      // the next photo upload replaces.
      if (p.count > 1) removePage(p, i);
      else {
        keepPages(p, []);
        p.copy.pages.push(emptyPage());
        p.count = 1;
      }
    });
    if (ok) setIndex(Math.min(i + 1, ref.current!.count));
  }
  // ---- Post texts --------------------------------------------------------
  function setPostJob(
    projectId: string,
    format: GenFormat,
    job: PostJob | undefined,
  ) {
    if (postProject.current !== projectId) return;
    setPostJobs((jobs) => {
      const current = jobs[format];
      // A late answer to an older request never replaces a newer one.
      if (job && current && job.request < current.request) return jobs;
      return { ...jobs, [format]: job };
    });
  }
  /** Creates a candidate; the text on screen stays until it is applied. */
  async function generatePostText(format: GenFormat) {
    const project = ref.current;
    if (!project || postJobs[format]?.status === "generating") return;
    const request = ++postRequest.current;
    setPostJob(project.id, format, { status: "generating", request });
    try {
      const current = await flush();
      const candidate: PostCandidate = await api(
        `/projects/${current.id}/post-text/candidates`,
        "POST",
        { revision: current.revision, format, options: postOptions[format] },
      );
      setPostJob(project.id, format, { status: "done", request, candidate });
      if (await fillEmpty(project.id, format, candidate))
        setPostJob(project.id, format, undefined);
    } catch (e) {
      setPostJob(project.id, format, {
        status: "failed",
        request,
        error: (e as Error).message,
      });
    }
  }
  /**
   * An empty field takes the candidate directly. Written text is never
   * replaced this way (it keeps the candidate box), nor is a locked caption
   * or a candidate that failed the source check.
   */
  async function fillEmpty(
    projectId: string,
    format: GenFormat,
    candidate: PostCandidate,
  ) {
    const empty = (p: Project | null) =>
      !!p &&
      p.id === projectId &&
      !postTextOf(p, format).trim() &&
      !(format === "short" && p.locks.caption);
    if (candidate.review?.overall === "fail" || !empty(ref.current))
      return false;
    let applied = false;
    await run("생성한 글을 넣는 중", async () => {
      const current = await flush();
      if (!empty(current)) return;
      accept(
        await api(`/projects/${current.id}/post-text/apply`, "POST", {
          candidateId: candidate.id,
          revision: current.revision,
        }),
      );
      applied = true;
    });
    return applied;
  }
  function discardPostCandidate(format: GenFormat) {
    if (ref.current) setPostJob(ref.current.id, format, undefined);
  }
  async function applyPostCandidate(
    format: GenFormat,
    acceptFailed = false,
    replaceEdited = false,
  ) {
    const candidate = postJobs[format]?.candidate;
    if (!candidate) return;
    const ok = await run("게시글 후보 적용 중", async () => {
      const current = await flush();
      accept(
        await api(`/projects/${current.id}/post-text/apply`, "POST", {
          candidateId: candidate.id,
          revision: current.revision,
          acceptFailed,
          replaceEdited,
        }),
      );
    });
    if (ok) discardPostCandidate(format);
  }
  /** Checks a candidate against the source again, without generating. */
  async function reverifyPostCandidate(format: GenFormat) {
    const project = ref.current;
    const job = postJobs[format];
    if (!project || !job?.candidate) return;
    const request = ++postRequest.current;
    setPostJob(project.id, format, { ...job, status: "generating", request });
    try {
      const candidate: PostCandidate = await api(
        `/projects/${project.id}/post-text/candidates/${job.candidate.id}/verify`,
        "POST",
      );
      setPostJob(project.id, format, { status: "done", request, candidate });
    } catch (e) {
      setPostJob(project.id, format, {
        status: "done",
        request,
        candidate: {
          ...job.candidate,
          reviewError: (e as Error).message,
        },
      });
    }
  }
  /** "검증만 다시": checks the saved text again without generating. */
  function verifyPostText(format: PostFormat) {
    return run("원문과 대조하는 중", async () => {
      const current = await flush();
      accept(
        await api(`/projects/${current.id}/post-text/verify`, "POST", {
          revision: current.revision,
          format,
        }),
      );
    });
  }
  /** Edits a stored format's text; the server decides provenance and review. */
  function setPostText(format: Exclude<PostFormat, "short">, text: string) {
    edit((p) => {
      const postText: PostText = p.postText ?? { selected: "short" };
      postText[format] = {
        provenance: "manual",
        sourceHash: null,
        ...postText[format],
        text,
      };
      return { ...p, postText };
    });
  }
  function setExportFormat(format: PostFormat) {
    edit((p) => ({
      ...p,
      postText: { ...(p.postText ?? {}), selected: format },
    }));
  }
  async function copyPost(text: string) {
    if (!text.trim()) {
      setPostCopyStatus("복사할 글이 없습니다.");
      return;
    }
    const copied = await copyText(text);
    setPostCopyStatus(
      copied
        ? `${[...text].length.toLocaleString()}자를 복사했습니다.`
        : "복사하지 못했습니다. 글을 선택해 직접 복사해 주세요.",
    );
  }
  async function files(files: FileList | null) {
    if (!files) return;
    await run("파일에서 텍스트 추출 중", async () => {
      const form = new FormData();
      Array.from(files).forEach((f) => form.append("files", f));
      const r = await api("/extract/files", "POST", form);
      edit(
        (p) => ({
          ...p,
          attachments: [...p.attachments, ...r],
          source: [
            p.source,
            ...r.filter((f: any) => !f.error).map((f: any) => f.text),
          ]
            .filter(Boolean)
            .join("\n\n"),
          sourceConfirmed: false,
        }),
        true,
      );
    });
  }
  return {
    captionConflict,
    applyCaptionConflict,
    discardCaptionConflict,
    committed,
    p,
    drafts,
    draftsRef,
    list,
    setList,
    view,
    setView,
    tab,
    setTab,
    busy,
    error,
    setError,
    saved,
    dirty,
    index,
    setIndex,
    preview,
    setPreview,
    width,
    setWidth,
    clipboardStatus,
    setClipboardStatus,
    query,
    setQuery,
    filter,
    setFilter,
    health,
    ref,
    busyRef,
    saveBlocked,
    enterStudio,
    accept,
    edit,
    persistDrafts,
    exportReady,
    reorder,
    flush,
    run,
    open,
    createCard,
    action,
    set,
    copy,
    copyKeyword,
    headlineSuggestions,
    applyHeadlineSuggestion,
    sourceCopyStatus,
    copySource,
    pageField,
    photo,
    files,
    postView,
    setPostView,
    postOptions,
    setPostOptions,
    postJobs,
    generatePostText,
    discardPostCandidate,
    applyPostCandidate,
    reverifyPostCandidate,
    verifyPostText,
    setPostText,
    setExportFormat,
    copyPost,
    postCopyStatus,
    setCaption,
    toPhotoCard,
    toTextCard,
    replaceCardPhoto,
    photoCardField,
    addCard,
    addPhotoCards,
    setPostType,
    setPhotoStyle,
    setCardStyle,
    deleteCard,
    isPhotoPage,
    ai,
    generateAi,
    applyAi,
  };
}
