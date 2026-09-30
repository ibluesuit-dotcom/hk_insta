import { api } from "../api";
import { statusNames } from "../format";
import { Studio } from "../hooks/use-studio";
import { EditTab, HistoryTab } from "./edit-tab";
import { PostTextPanel } from "./post-text-panel";
import { PreviewPanel } from "./preview-panel";
import { SourceTab } from "./source-tab";

/** Open project: name/save bar, step tabs, editor column and preview. */
export function StudioWorkspace({ s }: { s: Studio }) {
  const { p, tab, setTab, run, flush, dirty, saved } = s;
  if (!p) return null;
  return (
    <>
      <section className="project-bar">
        <div>
          <input
            aria-label="작업 이름"
            value={p.name}
            onChange={(e) => s.set("name", e.target.value)}
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
                s.accept(await api("/projects/" + p.id));
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
          ["post", "03", "인스타 게시글"],
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
            <SourceTab s={s} />
          ) : tab === "edit" ? (
            <EditTab s={s} />
          ) : tab === "post" ? (
            <PostTextPanel s={s} />
          ) : tab === "history" ? (
            <HistoryTab s={s} />
          ) : null}
        </section>
        <PreviewPanel s={s} />
      </div>
    </>
  );
}
