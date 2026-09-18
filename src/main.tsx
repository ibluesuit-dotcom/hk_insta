import type React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { useStudio } from "./hooks/use-studio";
import { useAuth } from "./hooks/use-auth";
import { Archive } from "./components/archive";
import { ErrorBanner, Rail } from "./components/chrome";
import { Welcome } from "./components/login";
import { StudioWorkspace } from "./components/studio-workspace";

function App() {
  const s = useStudio();
  const auth = useAuth(s.enterStudio);
  const { authenticated } = auth;
  const { p, view, busy, busyRef, health } = s;
  const blockWhileBusy = (e: React.SyntheticEvent) => {
    if (busyRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  return (
    <>
      <Rail s={s} authenticated={authenticated} />
      <main
        onClickCapture={blockWhileBusy}
        onDropCapture={blockWhileBusy}
        onPointerDownCapture={blockWhileBusy}
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
                onClick={s.createCard}
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
          <ErrorBanner s={s} />
          {busy && (
            <div className="progress">
              <i />
              {busy}… 처리 중에는 편집이 잠시 비활성화됩니다.
            </div>
          )}
          {authenticated && view === "archive" ? (
            <Archive s={s} />
          ) : !authenticated ? (
            <Welcome auth={auth} />
          ) : !p ? (
            <section className="empty">
              <p>
                {busy
                  ? "스튜디오를 열고 있습니다…"
                  : "스튜디오를 열지 못했습니다."}
              </p>
              {!busy && <button onClick={s.enterStudio}>다시 시도</button>}
            </section>
          ) : (
            <StudioWorkspace s={s} />
          )}
        </fieldset>
      </main>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
