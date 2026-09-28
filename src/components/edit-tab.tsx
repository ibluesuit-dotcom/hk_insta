import { headlineLayout, headlineEditorText } from "../../shared/model";
import { Studio } from "../hooks/use-studio";
import { AiBackgroundPicker } from "./ai-background";
import { CoverPhotoUpload, Evidence, LockButton, RegenButton } from "./fields";

/** 02 문안·사진 편집: page tabs, cover fields + crop, body page fields. */
export function EditTab({ s }: { s: Studio }) {
  const { p, index, setIndex, reorder } = s;
  if (!p) return null;
  const currentPage = p.copy.pages[index - 1];
  return (
    <>
      <div className="section-title">
        <div>
          <span className="eyebrow">EDIT YOUR STORY</span>
          <h2>문구와 사진을 다듬으세요</h2>
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
        <summary>원문 나란히 확인 · 숫자 / 시점 / 전망 / 조건</summary>
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
      {index === 0 ? <CoverFields s={s} /> : <PageFields s={s} />}
    </>
  );
}

function CoverFields({ s }: { s: Studio }) {
  const { p, set, copy } = s;
  if (!p) return null;
  return (
    <>
      <label>
        표지 제목{" "}
        <div>
          <LockButton s={s} lockKey="headline" />
          <RegenButton s={s} scope="headline" />
        </div>
      </label>
      <textarea
        aria-label="표지 제목"
        value={headlineEditorText(p)}
        disabled={p.locks.headline}
        onChange={(e) => copy("headline", e.target.value)}
      />
      <p className="hint">
        /는 줄바꿈, {"\\/"}는 원문 슬래시입니다. 최대 3줄이며 렌더된 줄바꿈을
        표시합니다.
      </p>
      {!!s.headlineSuggestions.length && (
        <div className="headline-suggestions">
          <strong>카드 폭에 맞게 줄인 제목</strong>
          {s.headlineSuggestions.map((text) => (
            <button
              key={text}
              disabled={p.locks.headline}
              onClick={() => s.applyHeadlineSuggestion(text)}
            >
              {text}
            </button>
          ))}
        </div>
      )}
      {headlineLayout(p.copy.headline, p.copy.headlineMode).error && (
        <p className="warn" role="alert">
          {headlineLayout(p.copy.headline, p.copy.headlineMode).error}
        </p>
      )}
      <Evidence s={s} quotes={p.copy.headlineEvidence} title />
      <label>
        노란색 강조 시작 줄 <span>미리보기 갱신으로 함께 저장</span>
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
            e.target.value === "none" ? null : Number(e.target.value),
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
        <span className={[...p.copy.kicker].length > 20 ? "warn" : ""}>
          {[...p.copy.kicker].length} / 20자
        </span>
        <div>
          <LockButton s={s} lockKey="kicker" />
          <RegenButton s={s} scope="kicker" />
        </div>
      </label>
      <input
        aria-label="부제"
        value={p.copy.kicker}
        disabled={p.locks.kicker}
        onChange={(e) => copy("kicker", e.target.value)}
      />
      <small className="hint">
        작성 유형: {p.copy.kickerOrigin} · 불필요하면 비워 두세요.
      </small>
      <label className="check">
        <input
          type="checkbox"
          disabled={p.locks.kicker}
          checked={!!p.kickerHidden}
          onChange={(e) => set("kickerHidden", e.target.checked)}
        />
        보조제목 끄기
      </label>
      <Evidence s={s} quotes={p.copy.kickerEvidence} />
      <hr />
      <label>
        메인 카드 배경 이미지 <span>첫 번째 카드 · 표지</span>
      </label>
      <CoverPhotoUpload s={s} />
      <AiBackgroundPicker s={s} />

      {p.photo && <PhotoCrop s={s} />}
    </>
  );
}

function PhotoCrop({ s }: { s: Studio }) {
  const { p, set } = s;
  if (!p) return null;
  return (
    <>
      <div
        className="crop-frame"
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          set("focal", {
            ...p.focal,
            x: Math.round(((e.clientX - r.left) / r.width) * 100),
            y: Math.round(((e.clientY - r.top) / r.height) * 100),
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
        <small>초점 위치를 클릭하거나 슬라이더로 조절</small>
      </div>
      {(["x", "y", "zoom"] as const).map((k) => (
        <label className="slider" key={k}>
          {k === "x" ? "가로 초점" : k === "y" ? "세로 초점" : "확대"}
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
  );
}

function PageFields({ s }: { s: Studio }) {
  const { p, index, set, pageField } = s;
  const currentPage = p?.copy.pages[index - 1];
  if (!p || !currentPage) return null;
  return (
    <>
      <label>
        본문 {index} 역할{" "}
        <div>
          <LockButton s={s} lockKey={"page:" + (index - 1)} />
          <RegenButton s={s} scope={"page:" + (index - 1)} />
        </div>
      </label>
      <input
        aria-label="본문 역할"
        value={currentPage.role}
        disabled={p.locks["page:" + (index - 1)]}
        onChange={(e) => pageField("role", e.target.value)}
      />
      <Evidence s={s} quotes={currentPage.evidence} />
      <label>페이지 제목 </label>
      <input
        aria-label="페이지 제목"
        value={currentPage.title}
        disabled={p.locks["page:" + (index - 1)]}
        onChange={(e) => pageField("title", e.target.value)}
      />
      <label>
        본문{" "}
        <span
          className={
            currentPage.body.replace(/\n/g, "").length > 140 ? "warn" : ""
          }
        >
          {currentPage.body.replace(/\n/g, "").length}자 · 목표 100~120자
        </span>
      </label>
      <textarea
        className="body-editor"
        aria-label="페이지 본문"
        value={currentPage.body}
        disabled={p.locks["page:" + (index - 1)]}
        onChange={(e) => pageField("body", e.target.value)}
      />
      <p className="hint">
        표시용 줄바꿈은 글자 수에서 제외합니다. 140자 초과 또는 실제 영역 넘침은
        직접 수정하세요.
      </p>
      <label>노란색 강조 문구 </label>
      <input
        aria-label="노란색 강조 문구"
        value={currentPage.highlight}
        disabled={p.locks["page:" + (index - 1)]}
        onChange={(e) => pageField("highlight", e.target.value)}
      />
      <label>
        본문 글자 크기 <span>기본 60px · 54px 미만 축소 없음</span>
      </label>
      <select
        aria-label="본문 글자 크기"
        value={p.bodyFont}
        onChange={(e) => set("bodyFont", Number(e.target.value))}
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
  );
}

/** 버전 기록: restore an earlier revision. */
export function HistoryTab({ s }: { s: Studio }) {
  const { p } = s;
  if (!p) return null;
  return (
    <>
      <div className="section-title">
        <h2>이전 버전 복원</h2>
        <button onClick={() => s.setTab("edit")}>편집으로</button>
      </div>
      <p className="hint">
        원문·문안·사진·크롭·잠금·설정을 함께 복원합니다. 복원 후에는 미리보기를
        갱신하세요.
      </p>
      {p.history?.map((h) => (
        <div className="history" key={h.revision}>
          <div>
            <strong>
              버전 {h.revision} · {h.label}
            </strong>
            <small>{new Date(h.date).toLocaleString("ko-KR")}</small>
          </div>
          <button onClick={() => s.action("restore", { version: h.revision })}>
            복원
          </button>
        </div>
      ))}
    </>
  );
}
