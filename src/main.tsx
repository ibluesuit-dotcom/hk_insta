import { sourceHeadline } from "../shared/source-title";
import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  Project,
  resizePages,
  movePage,
  profileOnlyChange,
  headlineLayout,
  headlineEditorText,
  renderFresh,
} from "../shared/model";
import {
  Drafts,
  applyDrafts,
  draftItem,
  reorderDrafts,
} from "../shared/editor-drafts";
import "./style.css";
import { Icon } from "./icons";
import { PreviewImage } from "./preview-image";
const statusNames: Record<string, string> = {
  draft: "초안",
  generated: "문안 생성",
  edited: "미리보기 갱신 필요",
  rendered: "이미지 확인",
  reviewed: "이미지 준비 완료",
  exported: "내보내기 완료",
};
async function api(url: string, method = "GET", body?: any) {
  const res = await fetch("/api" + url, {
    method,
    headers:
      body instanceof FormData ? {} : { "Content-Type": "application/json" },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(
              method === "PUT" ? { ...body, partialDirection: "" } : body,
            ),
  });
  if (!res.ok) {
    const e = await res.json();
    throw Object.assign(new Error(`${e.code || "오류"} · ${e.message}`), {
      code: e.code,
    });
  }
  return res.json();
}
function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
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
  const touch = useRef(0);
  const saveBlocked = useRef(false);
  const autosavePaused = useRef(false);
  useEffect(() => {
    api("/session")
      .then(async (session) => {
        if (session.authenticated) {
          setAuthenticated(true);
          await enterStudio();
        }
      })
      .catch((e) => setLoginError(e.message))
      .finally(() => setCheckingSession(false));
  }, []);
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
  async function login(event: React.FormEvent) {
    event.preventDefault();
    if (loggingIn) return;
    setLoggingIn(true);
    setLoginError("");
    try {
      await api("/login", "POST", { username, password });
      setPassword("");
      setAuthenticated(true);
      await enterStudio();
    } catch (e) {
      setLoginError((e as Error).message);
    } finally {
      setLoggingIn(false);
    }
  }
  function accept(next: Project) {
    sessionStorage.setItem("studio-project", next.id);
    if (ref.current?.id !== next.id) {
      let stored: Drafts = {};
      try {
        stored = JSON.parse(
          localStorage.getItem("editor-drafts:" + next.id) || "{}",
        );
      } catch {}
      stored = Object.fromEntries(
        Object.entries(stored).filter(
          ([key]) =>
            !key.startsWith("page:") || Number(key.split(":")[1]) < next.count,
        ),
      );
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
        "editor-drafts:" + ref.current!.id,
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
          localStorage.getItem("editor-drafts:" + project.id) || "{}",
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
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {}
    if (!copied) {
      const previous = document.activeElement as HTMLElement | null;
      const field = document.createElement("textarea");
      field.value = text;
      field.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.append(field);
      field.select();
      try {
        copied = document.execCommand("copy");
      } catch {}
      field.remove();
      previous?.focus();
    }
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
  function coverPhotoUpload() {
    if (!p) return null;
    return (
      <div
        className="drop photo-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          photo(e.dataTransfer.files[0]);
        }}
      >
        {p.photo ? (
          <img src={p.photo} alt="메인 카드 배경 이미지" />
        ) : (
          <span aria-hidden="true">▧</span>
        )}
        <strong>{p.photo ? "배경 이미지 바꾸기" : "이미지 파일 선택"}</strong>
        <small>여기를 클릭하거나 이미지 파일을 끌어다 놓으세요</small>
        <small>JPG · PNG · WebP / 25MB까지</small>
        <input
          aria-label="표지 사진 첨부"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={!!busy}
          onChange={(e) => {
            photo(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
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
  const lock = (key: string) => (
    <button
      className={"tiny " + (p?.locks[key] ? "locked" : "")}
      onClick={() =>
        edit((p) => ({ ...p, locks: { ...p.locks, [key]: !p.locks[key] } }))
      }
      aria-label={key + " 잠금"}
    >
      {p?.locks[key] ? "● 잠김" : "○ 잠금"}
    </button>
  );
  const regen = (scope: string) => (
    <button
      className="tiny"
      disabled={!!busy || p?.locks[scope]}
      onClick={() => action("generate", { scope })}
    >
      {scope === "headline" && p?.sourceTitle.trim()
        ? "원제 적용"
        : "↻ 다시 생성"}
    </button>
  );
  const evidence = (quotes: string[], title = false) => (
    <details className="evidence">
      <summary>원문 근거 {quotes.length}개</summary>
      {quotes.map((q, i) => (
        <blockquote key={i}>
          {q}
          <span
            className={
              p?.source.includes(q) || (title && p?.sourceTitle.includes(q))
                ? "verified"
                : "warn"
            }
          >
            {p?.source.includes(q) || (title && p?.sourceTitle.includes(q))
              ? "원문 일치"
              : "원문에서 찾을 수 없음 · 재확인"}
          </span>
        </blockquote>
      ))}
    </details>
  );
  const currentPage = p?.copy.pages[index - 1];
  return (
    <>
      <aside className="rail">
        <div className="brand">
          W<span>한국경제TV</span>
        </div>
        <div className="rail-label">EDITORIAL TOOLS</div>
        <button
          className={view === "studio" ? "active" : ""}
          disabled={!authenticated || !!busy}
          onClick={() => setView("studio")}
        >
          ▤ <span>카드 스튜디오</span>
        </button>
        <button
          disabled={!authenticated || !!busy}
          className={view === "archive" ? "active" : ""}
          onClick={() =>
            run("보관함 여는 중", async () => {
              if (p && dirty) await flush();
              setList(await api("/projects"));
              setView("archive");
            })
          }
        >
          ▦ <span>작업 보관함</span>
          <small>{list.length}</small>
        </button>
        <div className="rail-bottom">
          <i /> LOCAL WORKSPACE
          <p>
            기사의 맥락을,
            <br />한 장에 선명하게.
          </p>
          <span>NEWS CARD STUDIO · 1.0</span>
        </div>
      </aside>
      <main
        onClickCapture={(e) => {
          if (busyRef.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onDropCapture={(e) => {
          if (busyRef.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onPointerDownCapture={(e) => {
          if (busyRef.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        <fieldset className="workspace-controls" disabled={!!busy}>
          <header>
            <div>
              <span className="crumb">한국경제TV / 콘텐츠 제작</span>
              <h1>
                {view === "archive" ? "작업 보관함" : "뉴스 카드 스튜디오"}
              </h1>
            </div>
            {authenticated && (
              <button
                className="primary"
                onClick={createCard}
                disabled={!!busy}
              >
                + 새 카드 만들기
              </button>
            )}
          </header>
          {health.mock && (
            <div className="mock">
              테스트 모드 · 실제 AI를 호출하지 않는 모의 문안입니다. 기사 수치와
              샘플은 형식 확인용입니다.
            </div>
          )}
          {error && (
            <div role="alert" className="error">
              <div>
                <strong>처리를 완료하지 못했습니다</strong>
                <p>{error}</p>
                <small>
                  입력·설정을 확인한 뒤 해당 작업을 다시 실행하세요. 작성 내용은
                  유지됩니다.
                </small>
              </div>
              <button onClick={() => setError("")}>닫기</button>
              {p && (
                <button
                  onClick={() => {
                    const url = URL.createObjectURL(
                      new Blob(
                        [
                          JSON.stringify(
                            {
                              project: ref.current,
                              editorDrafts: draftsRef.current,
                            },
                            null,
                            2,
                          ),
                        ],
                        {
                          type: "application/json",
                        },
                      ),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "news-card-local-draft.json";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  로컬 초안 보관
                </button>
              )}
              {saveBlocked.current && (
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        "로컬 초안을 내려받았나요? 최신 서버 작업을 열면 이 창의 미저장 내용은 대체됩니다.",
                      )
                    )
                      run("최신 작업 여는 중", async () => {
                        const latest = await api(
                          "/projects/" + ref.current!.id,
                        );
                        saveBlocked.current = false;
                        accept(latest);
                      });
                  }}
                >
                  최신 작업 열기
                </button>
              )}
            </div>
          )}
          {busy && (
            <div className="progress">
              <i />
              {busy}… 처리 중에는 편집이 잠시 비활성화됩니다.
            </div>
          )}
          {authenticated && view === "archive" ? (
            <>
              <div className="archive-tools">
                <input
                  placeholder="작업 제목 검색"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">모든 상태</option>
                  {Object.entries(statusNames).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="archive-grid">
                {list
                  .filter(
                    (x) =>
                      x.name.includes(query) &&
                      (filter === "all" || x.status === filter),
                  )
                  .map((x) => (
                    <article className="archive-card" key={x.id}>
                      <button
                        className="archive-thumb"
                        onClick={() => open(x.id)}
                      >
                        {x.renders[0] ? (
                          <img src={x.renders[0]} />
                        ) : (
                          <span>
                            NEWS
                            <br />
                            CARD
                          </span>
                        )}
                      </button>
                      <div className="archive-info">
                        <span className="badge">{statusNames[x.status]}</span>
                        <h3>{x.name}</h3>
                        <p>
                          {x.sourceTitle || x.sourceUrl || "직접 입력 원문"}
                        </p>
                        <small>
                          총 {x.count + 1}장 ·{" "}
                          {new Date(x.updatedAt).toLocaleString("ko-KR")}
                        </small>
                        <div className="row">
                          <button onClick={() => open(x.id)}>
                            이어서 편집
                          </button>
                          <button
                            onClick={() =>
                              run("복제 중", async () => {
                                accept(
                                  await api(
                                    "/projects/" + x.id + "/duplicate",
                                    "POST",
                                  ),
                                );
                                setView("studio");
                              })
                            }
                          >
                            복제
                          </button>
                          {exportReady(x) && (
                            <a href={"/api/projects/" + x.id + "/download"}>
                              ZIP ↓
                            </a>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
              </div>
              {!list.length && (
                <div className="empty">
                  아직 저장한 작업이 없습니다. 첫 카드를 만들어 보세요.
                </div>
              )}
            </>
          ) : !authenticated ? (
            <section className="welcome">
              <div className="welcome-copy">
                <span className="eyebrow">FROM ARTICLE TO STORY</span>
                <h2>
                  읽히는 뉴스,
                  <br />
                  기억에 남는 카드.
                </h2>
                <p>
                  원문을 바탕으로 문안을 다듬고, 직접 고른 사진으로 완성하세요.
                  <br />
                  표지부터 본문까지 일관된 한국경제TV 디자인으로 제작합니다.
                </p>
              </div>
              <form
                className="login-panel"
                onSubmit={login}
                aria-label="공용 계정 로그인"
              >
                <span className="eyebrow">NEWS CARD STUDIO</span>
                <h2>로그인</h2>
                <p>공용 계정으로 뉴스 카드 제작을 시작하세요.</p>
                <label htmlFor="login-username">아이디</label>
                <input
                  id="login-username"
                  name="username"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loggingIn || checkingSession}
                />
                <label htmlFor="login-password">비밀번호</label>
                <input
                  id="login-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loggingIn || checkingSession}
                />
                {loginError && (
                  <p className="login-error" role="alert">
                    {loginError}
                  </p>
                )}
                <button
                  className="primary"
                  type="submit"
                  disabled={loggingIn || checkingSession}
                >
                  {checkingSession
                    ? "접속 확인 중…"
                    : loggingIn
                      ? "로그인 중…"
                      : "로그인"}
                </button>
              </form>
              <div className="welcome-card">
                <span>NEWS BRIEF</span>
                <strong>
                  기사의 핵심을
                  <br />
                  <em>더 선명하게.</em>
                </strong>
                <small>1080 × 1350 · PRETENDARD</small>
              </div>
            </section>
          ) : !p ? (
            <section className="empty">
              <p>
                {busy
                  ? "스튜디오를 열고 있습니다…"
                  : "스튜디오를 열지 못했습니다."}
              </p>
              {!busy && <button onClick={enterStudio}>다시 시도</button>}
            </section>
          ) : (
            <>
              <section className="project-bar">
                <div>
                  <input
                    aria-label="작업 이름"
                    value={p.name}
                    onChange={(e) => set("name", e.target.value)}
                  />
                  <span className="badge">{statusNames[p.status]}</span>
                </div>
                <div className="row">
                  <small className={dirty ? "warn" : "save"}>{saved}</small>
                  <button
                    className="tiny"
                    onClick={() =>
                      run("저장 중", async () => {
                        await flush();
                      })
                    }
                  >
                    지금 저장
                  </button>
                  <button
                    className="tiny"
                    onClick={() =>
                      run("버전 불러오는 중", async () => {
                        await flush();
                        accept(await api("/projects/" + p.id));
                        setTab("history");
                      })
                    }
                  >
                    버전 기록
                  </button>
                </div>
              </section>
              <nav className="steps">
                {[
                  ["source", "01", "원문과 제작 방향"],
                  ["edit", "02", "문안·사진 편집"],
                ].map(([key, num, label]) => (
                  <button
                    className={tab === key ? "selected" : ""}
                    key={key}
                    onClick={() => setTab(key)}
                  >
                    <b>{num}</b>
                    {label}
                  </button>
                ))}
              </nav>
              <div className="workspace">
                <section className="editor">
                  {tab === "source" ? (
                    <>
                      <div className="section-title">
                        <div>
                          <span className="eyebrow">SOURCE MATERIAL</span>
                          <h2>어떤 소식을 전할까요?</h2>
                        </div>
                        <span className="pill">01 / 원문</span>
                      </div>
                      <label>기사 URL</label>
                      <div className="row">
                        <input
                          placeholder="https://… 기사 주소를 입력하세요"
                          value={p.sourceUrl}
                          onChange={(e) => set("sourceUrl", e.target.value)}
                        />
                        <button
                          disabled={!!busy}
                          onClick={() =>
                            run("기사 추출 중", async () => {
                              const r = await api("/extract/url", "POST", {
                                url: p.sourceUrl,
                              });
                              edit(
                                (p) => ({
                                  ...p,
                                  source: r.text,
                                  sourceTitle: r.title,
                                  sourceSubtitle: r.subtitle,
                                  publishedAt: r.publishedAt,
                                  sourceConfirmed: false,
                                }),
                                true,
                              );
                            })
                          }
                        >
                          불러오기
                        </button>
                      </div>
                      <div
                        className="drop"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          files(e.dataTransfer.files);
                        }}
                      >
                        <span>↥</span>
                        <strong>원문 파일을 놓거나 선택하세요</strong>
                        <small>TXT · MD · DOCX · PDF / 각 10MB까지</small>
                        <input
                          aria-label="원문 파일"
                          type="file"
                          multiple
                          accept=".txt,.md,.docx,.pdf"
                          onChange={(e) => files(e.target.files)}
                        />
                      </div>
                      <section aria-label="사진 키워드 추천">
                        <button
                          className="primary full"
                          disabled={
                            !!busy || !p.source.trim() || p.locks.keywords
                          }
                          onClick={() => {
                            setClipboardStatus("");
                            action("generate", { scope: "keywords" });
                          }}
                        >
                          사진 키워드 추천받기
                        </button>
                        <p className="hint">
                          현재 통합 원문에서 단어 4개를 추천합니다. 근거가
                          부족하면 더 적게 제안하며, 사진 검색을 실행한 결과는
                          아닙니다.
                        </p>
                        {p.locks.keywords && (
                          <button
                            className="tiny"
                            onClick={() =>
                              edit((p) => ({
                                ...p,
                                locks: { ...p.locks, keywords: false },
                              }))
                            }
                          >
                            검색어 잠금 해제
                          </button>
                        )}
                        <div className="keyword-grid">
                          {p.copy.keywords.slice(0, 4).map((k, i) => (
                            <div className="keyword" key={i}>
                              <div className="row">
                                <input
                                  aria-label={"검색어 " + (i + 1)}
                                  readOnly
                                  value={k.query}
                                />
                                <button
                                  className="tiny"
                                  aria-label={k.query + " 복사"}
                                  onClick={() => copyKeyword(k.query)}
                                >
                                  복사
                                </button>
                              </div>
                              <small>{k.reason}</small>
                              {evidence([k.quote])}
                            </div>
                          ))}
                        </div>
                        {p.generation?.scope === "keywords" &&
                          !p.copy.keywords.length && (
                            <p className="hint">
                              현재 원문에서 추천할 단어를 찾지 못했습니다.
                              원문을 보완한 뒤 다시 추천받으세요.
                            </p>
                          )}
                        <p role="status" aria-live="polite">
                          {clipboardStatus}
                        </p>
                      </section>
                      <section
                        className="cover-upload-panel"
                        aria-label="메인 카드 배경 이미지 첨부"
                      >
                        <h3>메인 카드 배경 이미지</h3>
                        <p>
                          첫 번째 카드(표지)에 사용할 사진을 첨부하세요. 문안
                          생성 전에도 넣을 수 있습니다.
                        </p>
                        {coverPhotoUpload()}

                        {p.photo && (
                          <button
                            type="button"
                            onClick={() => {
                              setIndex(0);
                              setTab("edit");
                            }}
                          >
                            사진 위치·크롭 조정 →
                          </button>
                        )}
                      </section>
                      {p.attachments.map((f, i) => (
                        <details className="file-row" key={i}>
                          <summary>
                            {f.error ? "⚠" : "✓"} {f.name}
                            <button
                              className="tiny"
                              onClick={(e) => {
                                e.preventDefault();
                                set(
                                  "attachments",
                                  p.attachments.filter((_, n) => n !== i),
                                );
                              }}
                            >
                              목록에서 제거
                            </button>
                          </summary>
                          {f.error ? (
                            <p className="warn">{f.error}</p>
                          ) : (
                            <textarea
                              aria-label={f.name + " 추출 결과"}
                              value={f.text}
                              onChange={(e) =>
                                edit((p) => {
                                  p.attachments[i].text = e.target.value;
                                  return p;
                                })
                              }
                            />
                          )}
                          {!f.error && (
                            <button
                              className="tiny"
                              onClick={() =>
                                edit((p) => ({
                                  ...p,
                                  source: p.attachments
                                    .filter((f) => !f.error)
                                    .map((f) => f.text)
                                    .join("\n\n"),
                                  sourceConfirmed: false,
                                }))
                              }
                            >
                              수정한 파일 전체로 통합 원문 갱신
                            </button>
                          )}
                          <small>
                            통합 원문이 AI 생성에 사용됩니다. 파일 수정·제거 후
                            갱신 버튼을 눌러 반영하세요.
                          </small>
                        </details>
                      ))}
                      <label htmlFor="source-title">원문 제목</label>
                      <input
                        id="source-title"
                        value={p.sourceTitle}
                        onChange={(e) => set("sourceTitle", e.target.value)}
                        placeholder="기사 제목"
                      />
                      <small>
                        원문 제목이 있으면 원제를 사용하며 가장자리의 알려진
                        코너명과 표기만 정리합니다. [속보]·[단독]은 유지합니다.
                        제목이 없으면 AI가 본문으로 작성합니다.
                      </small>
                      <label>
                        추출 원문 확인·수정{" "}
                        <span>
                          {p.source.length.toLocaleString()}자 / 60,000자
                        </span>
                      </label>
                      <textarea
                        className="source-text"
                        aria-label="통합 원문"
                        value={p.source}
                        onChange={(e) =>
                          edit((p) => ({
                            ...p,
                            source: e.target.value,
                            sourceConfirmed: false,
                          }))
                        }
                        placeholder="기사 본문이나 방송 스크립트를 붙여넣으세요. 숫자, 시점, 조건이 빠지지 않았는지 확인하세요."
                      />
                      <hr />
                      <div className="section-title">
                        <div>
                          <span className="eyebrow">EDITORIAL DIRECTION</span>
                          <h2>제작 방향</h2>
                        </div>
                      </div>
                      <label>AI에게 전달할 제작 방향</label>
                      <textarea
                        value={p.direction}
                        onChange={(e) => set("direction", e.target.value)}
                      />
                      <div className="hint">
                        입력 중에는 AI를 호출하지 않습니다. 아래 적용 버튼을
                        눌러야 문안에 반영됩니다.
                      </div>
                      {p.direction !== p.appliedDirection &&
                        p.copy.headline && (
                          <p className="warn">
                            ● 새 방향 미반영 · 전체 또는 선택 필드에 적용하세요.
                          </p>
                        )}
                      <div className="count-setting">
                        <div>
                          <strong>본문 페이지 수</strong>
                          <p>표지는 1장으로 유지됩니다</p>
                        </div>
                        <select
                          aria-label="본문 페이지 수"
                          value={p.count}
                          onChange={(e) => {
                            const count = Number(e.target.value);
                            if (
                              count < p.count &&
                              !window.confirm(
                                `본문 ${count + 1}~${p.count}장을 삭제할까요? 해당 문안과 잠금이 삭제됩니다. 이전 버전에서 복원할 수 있습니다.`,
                              )
                            )
                              return;
                            persistDrafts(
                              Object.fromEntries(
                                Object.entries(draftsRef.current).filter(
                                  ([key]) =>
                                    !key.startsWith("page:") ||
                                    Number(key.split(":")[1]) < count,
                                ),
                              ),
                            );
                            edit((p) => resizePages(p, count));
                            setIndex(0);
                          }}
                        >
                          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                            <option key={n} value={n}>
                              {n}장
                            </option>
                          ))}
                        </select>
                        <span>
                          표지 포함 <b>총 {p.count + 1}장</b>
                        </span>
                      </div>
                      <button
                        className="primary full"
                        disabled={!!busy}
                        onClick={() => action("generate", { scope: "all" })}
                      >
                        생성
                      </button>
                    </>
                  ) : tab === "edit" ? (
                    <>
                      <div className="section-title">
                        <div>
                          <span className="eyebrow">EDIT YOUR STORY</span>
                          <h2>문구와 사진을 다듬으세요</h2>
                          <p className="hint">
                            입력은 이 브라우저의 초안입니다. 미리보기 갱신을
                            누르면 모든 편집 내용을 함께 저장하고 전체 카드를
                            렌더합니다.
                          </p>
                        </div>
                        <span className="pill">02 / 편집</span>
                      </div>
                      <div className="page-tabs">
                        {Array.from({ length: p.count + 1 }, (_, i) => (
                          <button
                            key={i}
                            className={index === i ? "selected" : ""}
                            onClick={() => setIndex(i)}
                          >
                            {i === 0 ? "표지" : `본문 ${i}`}
                          </button>
                        ))}
                      </div>
                      {index > 0 && (
                        <div className="row">
                          <button
                            disabled={index === 1}
                            onClick={() => {
                              reorder(index - 1, index - 2);
                            }}
                          >
                            ← 본문 앞으로
                          </button>
                          <button
                            disabled={index === p.count}
                            onClick={() => {
                              reorder(index - 1, index);
                            }}
                          >
                            본문 뒤로 →
                          </button>
                        </div>
                      )}
                      <details className="source-reference">
                        <summary>
                          원문 나란히 확인 · 숫자 / 시점 / 전망 / 조건
                        </summary>
                        <div className="comparison">
                          <p>
                            <b>원문</b>
                            {p.source}
                          </p>
                          <p>
                            <b>현재 카드 문안</b>
                            {index
                              ? `${currentPage?.title}\n\n${currentPage?.body}`
                              : `${p.copy.headline}\n\n${p.copy.kicker}`}
                          </p>
                        </div>
                      </details>
                      {index === 0 ? (
                        <>
                          <label>
                            표지 제목{" "}
                            <div>
                              {lock("headline")}
                              {regen("headline")}
                            </div>
                          </label>
                          <textarea
                            aria-label="표지 제목"
                            value={headlineEditorText(p)}
                            disabled={p.locks.headline}
                            onChange={(e) => copy("headline", e.target.value)}
                          />
                          <p className="hint">
                            /는 줄바꿈, {"\\/"}는 원문 슬래시입니다. 최대
                            3줄이며 렌더된 줄바꿈을 표시합니다.
                          </p>
                          {headlineLayout(p.copy.headline, p.copy.headlineMode)
                            .error && (
                            <p className="warn" role="alert">
                              {
                                headlineLayout(
                                  p.copy.headline,
                                  p.copy.headlineMode,
                                ).error
                              }
                            </p>
                          )}
                          {evidence(p.copy.headlineEvidence, true)}
                          <label>
                            노란색 강조 시작 줄{" "}
                            <span>미리보기 갱신으로 함께 저장</span>
                          </label>
                          <select
                            aria-label="노란색 강조 시작 줄"
                            value={
                              p.highlightFrom === undefined
                                ? p.copy.highlight
                                  ? 1
                                  : "none"
                                : (p.highlightFrom ?? "none")
                            }
                            disabled={p.locks.headline}
                            onChange={(e) =>
                              set(
                                "highlightFrom",
                                e.target.value === "none"
                                  ? null
                                  : Number(e.target.value),
                              )
                            }
                          >
                            <option value="none">없음 · 전체 흰색</option>
                            <option value={0}>1번째 줄부터</option>
                            <option value={1}>2번째 줄부터</option>
                            <option value={2}>3번째 줄부터</option>
                          </select>
                          <label>
                            부제{" "}
                            <span
                              className={
                                [...p.copy.kicker].length > 20 ? "warn" : ""
                              }
                            >
                              {[...p.copy.kicker].length} / 20자
                            </span>
                            <div>
                              {lock("kicker")}
                              {regen("kicker")}
                            </div>
                          </label>
                          <input
                            aria-label="부제"
                            value={p.copy.kicker}
                            disabled={p.locks.kicker}
                            onChange={(e) => copy("kicker", e.target.value)}
                          />
                          <small className="hint">
                            작성 유형: {p.copy.kickerOrigin} · 불필요하면 비워
                            두세요.
                          </small>
                          <label className="check">
                            <input
                              type="checkbox"
                              disabled={p.locks.kicker}
                              checked={!!p.kickerHidden}
                              onChange={(e) =>
                                set("kickerHidden", e.target.checked)
                              }
                            />
                            보조제목 끄기
                          </label>
                          <p className="hint">
                            숨겨도 부제 문구는 보존됩니다. 미리보기 갱신을
                            누르면 숨김 설정까지 저장됩니다. 미리보기 갱신으로
                            렌더하세요.
                          </p>
                          {evidence(p.copy.kickerEvidence)}
                          <hr />
                          <label>
                            메인 카드 배경 이미지{" "}
                            <span>첫 번째 카드 · 표지</span>
                          </label>
                          {coverPhotoUpload()}

                          {p.photo && (
                            <>
                              <div
                                className="crop-frame"
                                onPointerDown={(e) => {
                                  const r =
                                    e.currentTarget.getBoundingClientRect();
                                  set("focal", {
                                    ...p.focal,
                                    x: Math.round(
                                      ((e.clientX - r.left) / r.width) * 100,
                                    ),
                                    y: Math.round(
                                      ((e.clientY - r.top) / r.height) * 100,
                                    ),
                                  });
                                }}
                              >
                                <img
                                  src={p.photo}
                                  style={{
                                    objectPosition: `${p.focal.x}% ${p.focal.y}%`,
                                    transform: `scale(${p.focal.zoom})`,
                                    transformOrigin: `${p.focal.x}% ${p.focal.y}%`,
                                  }}
                                />
                                <div
                                  className="crop-cross"
                                  style={{
                                    left: p.focal.x + "%",
                                    top: p.focal.y + "%",
                                  }}
                                >
                                  ＋
                                </div>
                                <small>
                                  초점 위치를 클릭하거나 슬라이더로 조절
                                </small>
                              </div>
                              {(["x", "y", "zoom"] as const).map((k) => (
                                <label className="slider" key={k}>
                                  {k === "x"
                                    ? "가로 초점"
                                    : k === "y"
                                      ? "세로 초점"
                                      : "확대"}
                                  <input
                                    type="range"
                                    min={k === "zoom" ? 1 : 0}
                                    max={k === "zoom" ? 3 : 100}
                                    step={k === "zoom" ? 0.05 : 1}
                                    value={p.focal[k]}
                                    onChange={(e) =>
                                      set("focal", {
                                        ...p.focal,
                                        [k]: Number(e.target.value),
                                      })
                                    }
                                  />
                                  <span>
                                    {p.focal[k]}
                                    {k === "zoom" ? "×" : "%"}
                                  </span>
                                </label>
                              ))}
                            </>
                          )}
                        </>
                      ) : (
                        currentPage && (
                          <>
                            <label>
                              본문 {index} 역할{" "}
                              <div>
                                {lock("page:" + (index - 1))}
                                {regen("page:" + (index - 1))}
                              </div>
                            </label>
                            <input
                              aria-label="본문 역할"
                              value={currentPage.role}
                              disabled={p.locks["page:" + (index - 1)]}
                              onChange={(e) =>
                                pageField("role", e.target.value)
                              }
                            />
                            {evidence(currentPage.evidence)}
                            <label>페이지 제목 </label>
                            <input
                              aria-label="페이지 제목"
                              value={currentPage.title}
                              disabled={p.locks["page:" + (index - 1)]}
                              onChange={(e) =>
                                pageField("title", e.target.value)
                              }
                            />
                            <label>
                              본문{" "}
                              <span
                                className={
                                  currentPage.body.replace(/\n/g, "").length >
                                  140
                                    ? "warn"
                                    : ""
                                }
                              >
                                {currentPage.body.replace(/\n/g, "").length}자 ·
                                목표 100~120자
                              </span>
                            </label>
                            <textarea
                              className="body-editor"
                              aria-label="페이지 본문"
                              value={currentPage.body}
                              disabled={p.locks["page:" + (index - 1)]}
                              onChange={(e) =>
                                pageField("body", e.target.value)
                              }
                            />
                            <p className="hint">
                              표시용 줄바꿈은 글자 수에서 제외합니다. 140자 초과
                              또는 실제 영역 넘침은 직접 수정하세요.
                            </p>
                            <label>노란색 강조 문구 </label>
                            <input
                              aria-label="노란색 강조 문구"
                              value={currentPage.highlight}
                              disabled={p.locks["page:" + (index - 1)]}
                              onChange={(e) =>
                                pageField("highlight", e.target.value)
                              }
                            />
                            <label>
                              본문 글자 크기{" "}
                              <span>기본 60px · 54px 미만 축소 없음</span>
                            </label>
                            <select
                              aria-label="본문 글자 크기"
                              value={p.bodyFont}
                              onChange={(e) =>
                                set("bodyFont", Number(e.target.value))
                              }
                            >
                              {[60, 58, 56, 54].map((n) => (
                                <option key={n}>{n}</option>
                              ))}
                            </select>
                            <label>이 페이지 대체 텍스트 </label>
                            <textarea
                              aria-label="이 페이지 대체 텍스트"
                              disabled={p.locks[`page:${index - 1}`]}
                              value={currentPage.alt}
                              onChange={(e) => pageField("alt", e.target.value)}
                            />
                          </>
                        )
                      )}
                    </>
                  ) : tab === "history" ? (
                    <>
                      <div className="section-title">
                        <h2>이전 버전 복원</h2>
                        <button onClick={() => setTab("edit")}>편집으로</button>
                      </div>
                      <p className="hint">
                        원문·문안·사진·크롭·잠금·설정을 함께 복원합니다. 복원
                        후에는 미리보기를 갱신하세요.
                      </p>
                      {p.history?.map((h) => (
                        <div className="history" key={h.revision}>
                          <div>
                            <strong>
                              버전 {h.revision} · {h.label}
                            </strong>
                            <small>
                              {new Date(h.date).toLocaleString("ko-KR")}
                            </small>
                          </div>
                          <button
                            onClick={() =>
                              action("restore", { version: h.revision })
                            }
                          >
                            복원
                          </button>
                        </div>
                      ))}
                    </>
                  ) : null}
                </section>
                <aside className="preview-panel">
                  <div className="preview-heading">
                    <div>
                      <span className="eyebrow">LIVE OUTPUT</span>
                      <h2>완성 이미지 미리보기</h2>
                    </div>
                    <span className="pill">4:5</span>
                  </div>
                  <div className="segmented">
                    <button
                      className={preview === "phone" ? "selected" : ""}
                      onClick={() => setPreview("phone")}
                    >
                      휴대폰 목업
                    </button>
                    <button
                      className={preview === "original" ? "selected" : ""}
                      onClick={() => setPreview("original")}
                    >
                      원본 카드
                    </button>
                  </div>
                  {(dirty ||
                    (index === 0 ? p.coverRenderRevision : p.renderRevision) !==
                      p.revision) &&
                    p.renders.length > 0 && (
                      <div className="stale">
                        변경 내용 미반영 · 다시 렌더해 주세요
                      </div>
                    )}
                  {Object.keys(drafts).length > 0 && (
                    <p className="draft-notice">
                      미반영 초안 {Object.keys(drafts).length}개 · 미리보기
                      갱신으로 모든 초안을 함께 저장하세요. 내보내기는 갱신 후
                      가능합니다.
                    </p>
                  )}
                  <div className="preview-stage">
                    {preview === "phone" ? (
                      <div className="phone" style={{ width }}>
                        <div className="phone-status">
                          <b>9:41</b>
                          <span>● ▰ ▰</span>
                        </div>
                        <div className="ig-header">
                          <strong>Instagram</strong>
                          <span className="icon-row">
                            <Icon name="heart" />
                            <Icon name="send" />
                          </span>
                        </div>
                        <div className="ig-user">
                          {p.profilePhoto ? (
                            <img src={p.profilePhoto} />
                          ) : (
                            <b>W</b>
                          )}
                          <strong>{p.profile}</strong>
                          <span>•••</span>
                        </div>
                        <div
                          className="feed-image"
                          onTouchStart={(e) =>
                            (touch.current = e.touches[0].clientX)
                          }
                          onTouchEnd={(e) => {
                            const dx =
                              e.changedTouches[0].clientX - touch.current;
                            if (Math.abs(dx) > 30)
                              setIndex(
                                Math.max(
                                  0,
                                  Math.min(p.count, index + (dx < 0 ? 1 : -1)),
                                ),
                              );
                          }}
                        >
                          {p.renders[index] ? (
                            <PreviewImage
                              key={p.renders[index]}
                              alt={
                                index
                                  ? committed!.copy.pages[index - 1]?.alt
                                  : committed!.copy.alt
                              }
                              src={p.renders[index]}
                            />
                          ) : (
                            <div className="preview-empty">
                              <span>W</span>
                              <strong>
                                당신의 다음 소식을
                                <br />
                                기다립니다.
                              </strong>
                              <small>문안·사진을 준비하고 렌더하세요</small>
                            </div>
                          )}
                          <span className="page-counter">
                            {index + 1}/{p.count + 1}
                          </span>
                        </div>
                        <div className="ig-actions">
                          <span className="icon-row">
                            <Icon name="heart" />
                            <Icon name="comment" />
                            <Icon name="send" />
                          </span>
                          <span>
                            <Icon name="bookmark" />
                          </span>
                        </div>
                        <div className="dots">
                          {Array.from({ length: p.count + 1 }, (_, i) => (
                            <button
                              aria-label={`${i + 1}장 보기`}
                              className={index === i ? "current" : ""}
                              key={i}
                              onClick={() => setIndex(i)}
                            />
                          ))}
                        </div>
                        <div className="ig-caption">
                          <b>{p.profile}</b>{" "}
                          {committed!.copy.caption ||
                            "원문을 바탕으로, 오늘의 경제를 쉽게 전합니다."}
                          <small>
                            미리보기 · 실제 게시물이나 통계가 아닙니다
                          </small>
                        </div>
                        <div className="ig-nav">
                          {["home", "search", "plus", "video", "user"].map(
                            (name) => (
                              <Icon key={name} name={name} size={21} />
                            ),
                          )}
                        </div>
                        <div className="home-bar" />
                      </div>
                    ) : (
                      <div className="original">
                        {p.renders[index] ? (
                          <PreviewImage
                            key={p.renders[index]}
                            src={p.renders[index]}
                            original
                          />
                        ) : (
                          <div className="preview-empty">
                            렌더된 이미지가 없습니다
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="preview-controls">
                    <button
                      aria-label="이전 카드"
                      onClick={() => setIndex(Math.max(0, index - 1))}
                    >
                      ←
                    </button>
                    <span>
                      {index === 0 ? "표지" : `본문 ${index}`}{" "}
                      <small>
                        {index + 1} / {p.count + 1}
                      </small>
                    </span>
                    <button
                      aria-label="다음 카드"
                      onClick={() => setIndex(Math.min(p.count, index + 1))}
                    >
                      →
                    </button>
                  </div>
                  {preview === "phone" && (
                    <div className="width-options">
                      표시 폭{" "}
                      {[320, 360, 390].map((n) => (
                        <button
                          key={n}
                          className={n === width ? "selected" : ""}
                          onClick={() => setWidth(n)}
                        >
                          {n}px
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    className="dark full"
                    disabled={!!busy}
                    onClick={() => action("render")}
                  >
                    ▧ 전체 {p.count + 1}장 렌더 · 미리보기 갱신
                  </button>
                  <a
                    className={
                      "primary download full " +
                      (!exportReady(p) || busy ? "disabled" : "")
                    }
                    role="link"
                    tabIndex={exportReady(p) && !busy ? 0 : -1}
                    aria-disabled={!exportReady(p) || !!busy}
                    href={
                      exportReady(p) && !busy
                        ? `/api/projects/${p.id}/download`
                        : undefined
                    }
                    onClick={(e) => {
                      if (!exportReady(p) || busy) e.preventDefault();
                    }}
                  >
                    내보내기
                  </a>
                  <p className="preview-note">
                    미리보기와 다운로드에 같은 PNG를 사용합니다.
                    <br />
                    Pretendard 1.3.9 · 1080 × 1350px
                  </p>
                </aside>
              </div>
            </>
          )}
        </fieldset>
      </main>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
