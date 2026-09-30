import { api } from "../api";
import { downloadJson } from "../browser";
import { Studio } from "../hooks/use-studio";

/** Left navigation rail. */
export function Rail({
  s,
  authenticated,
}: {
  s: Studio;
  authenticated: boolean;
}) {
  const { view, setView, busy, run, p, dirty, flush, list } = s;
  return (
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
            s.setList(await api("/projects"));
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
  );
}

/** Error alert with local-draft download and conflict recovery actions. */
export function ErrorBanner({ s }: { s: Studio }) {
  const {
    error,
    errorCode,
    setError,
    p,
    ref,
    draftsRef,
    saveBlocked,
    run,
    accept,
  } = s;
  if (!error) return null;
  return (
    <div role="alert" className="error">
      <div>
        <strong>처리를 완료하지 못했습니다</strong>
        <p>{error}</p>
        {errorCode && (
          <small className="error-code" title="진단 코드">
            진단 코드 {errorCode}
          </small>
        )}
        <small>
          입력·설정을 확인한 뒤 해당 작업을 다시 실행하세요. 작성 내용은
          유지됩니다.
        </small>
      </div>
      <button onClick={() => setError("")}>닫기</button>
      {p && (
        <button
          onClick={() =>
            downloadJson(
              {
                project: ref.current,
                editorDrafts: draftsRef.current,
              },
              "news-card-local-draft.json",
            )
          }
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
                const latest = await api("/projects/" + ref.current!.id);
                saveBlocked.current = false;
                accept(latest);
              });
          }}
        >
          최신 작업 열기
        </button>
      )}
    </div>
  );
}
