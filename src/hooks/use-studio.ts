import { useState, useEffect, useRef } from "react";
import { sourceHeadline } from "../../shared/source-title";
import {
  Project,
  movePage,
  profileOnlyChange,
  renderFresh,
} from "../../shared/model";
import {
  Drafts,
  applyDrafts,
  draftItem,
  reorderDrafts,
} from "../../shared/editor-drafts";
import { api } from "../api";
import { copyText } from "../browser";
import { draftsStorageKey, keepPageDraftsBelow } from "../format";

export type Studio = ReturnType<typeof useStudio>;

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
  const [saved, setSaved] = useState("서버에 자동 저장");
  const [dirty, setDirty] = useState(false);
  const [index, setIndex] = useState(0);
  const [preview, setPreview] = useState("phone");
  const [width, setWidth] = useState(360);
  const [clipboardStatus, setClipboardStatus] = useState("");
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
    sessionStorage.setItem("studio-project", next.id);
    if (ref.current?.id !== next.id) {
      let stored: Drafts = {};
      try {
        stored = JSON.parse(
          localStorage.getItem(draftsStorageKey(next.id)) || "{}",
        );
      } catch {}
      stored = keepPageDraftsBelow(stored, next.count);
      draftsRef.current = stored;
      setDrafts(stored);
      saveBlocked.current = false;
    }
    ref.current = next;
    setIndex((index) => Math.min(index, next.count));
    setP(next);
    setDirty(false);
    dirtyRef.current = false;
    autosavePaused.current = false;
    setSaved("서버 저장 완료");
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
        if (partial) {
          const keys = payload.scope.startsWith("page:")
            ? ["role", "title", "body", "highlight", "alt"].map(
                (k) => payload.scope + ":" + k,
              )
            : payload.scope === "pages"
              ? result.copy.pages.flatMap((_: unknown, i: number) =>
                  ["role", "title", "body", "highlight", "alt"].map(
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
  function copy(k: string, v: any) {
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
    pageField,
    photo,
    files,
  };
}
