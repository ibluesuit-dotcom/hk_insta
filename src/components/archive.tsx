import { api } from "../api";
import { statusNames } from "../format";
import { Studio } from "../hooks/use-studio";

export function Archive({ s }: { s: Studio }) {
  const { list, query, setQuery, filter, setFilter, open, run, accept } = s;
  return (
    <>
      <div className="archive-tools">
        <input
          placeholder="작업 제목 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
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
              <button className="archive-thumb" onClick={() => open(x.id)}>
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
                <p>{x.sourceTitle || x.sourceUrl || "직접 입력 원문"}</p>
                <small>
                  총 {x.count + 1}장 ·{" "}
                  {new Date(x.updatedAt).toLocaleString("ko-KR")}
                </small>
                <div className="row">
                  <button onClick={() => open(x.id)}>이어서 편집</button>
                  <button
                    onClick={() =>
                      run("복제 중", async () => {
                        accept(
                          await api("/projects/" + x.id + "/duplicate", "POST"),
                        );
                        s.setView("studio");
                      })
                    }
                  >
                    복제
                  </button>
                  {s.exportReady(x) && (
                    <a href={"/api/projects/" + x.id + "/download"}>ZIP ↓</a>
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
  );
}
