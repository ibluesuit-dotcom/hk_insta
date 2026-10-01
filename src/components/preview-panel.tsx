import { useRef } from "react";
import { Icon } from "../icons";
import { PreviewImage } from "../preview-image";
import { Studio } from "../hooks/use-studio";
import { cardAlt, cardKind } from "../../shared/model";
import { exportCaption } from "../../shared/post-text";

/** Right-hand live output: phone mockup / original card, render and export. */
export function PreviewPanel({ s }: { s: Studio }) {
  const {
    p,
    committed,
    drafts,
    dirty,
    index,
    setIndex,
    preview,
    setPreview,
    width,
    setWidth,
    busy,
    exportReady,
  } = s;
  const touch = useRef(0);
  if (!p) return null;
  return (
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
      {/* Cards rendered one by one (photo post, text first) are not stale:
          the rest are simply not ready yet. */}
      {p.renders.length > 0 && !p.renders.every(Boolean) && !dirty ? (
        <div className="stale partial">
          일부 카드만 렌더됨 · 모든 카드가 준비되면 ‘미리보기 갱신’을 누르세요
        </div>
      ) : (
        (dirty ||
          (index === 0 ? p.coverRenderRevision : p.renderRevision) !==
            p.revision) &&
        p.renders.length > 0 && (
          <div className="stale">변경 내용 미반영 · 다시 렌더해 주세요</div>
        )
      )}
      {Object.keys(drafts).length > 0 && (
        <p className="draft-notice">
          미반영 초안 {Object.keys(drafts).length}개 · 미리보기 갱신으로 모든
          초안을 함께 저장하세요. 내보내기는 갱신 후 가능합니다.
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
              {p.profilePhoto ? <img src={p.profilePhoto} /> : <b>W</b>}
              <strong>{p.profile}</strong>
              <span>•••</span>
            </div>
            <div
              className="feed-image"
              onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
              onTouchEnd={(e) => {
                const dx = e.changedTouches[0].clientX - touch.current;
                if (Math.abs(dx) > 30)
                  setIndex(
                    Math.max(0, Math.min(p.count, index + (dx < 0 ? 1 : -1))),
                  );
              }}
            >
              {p.renders[index] ? (
                <PreviewImage
                  key={p.renders[index]}
                  alt={cardAlt(committed!, index)}
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
              {exportCaption(committed!) ||
                "원문을 바탕으로, 오늘의 경제를 쉽게 전합니다."}
              <small>미리보기 · 실제 게시물이나 통계가 아닙니다</small>
            </div>
            <div className="ig-nav">
              {["home", "search", "plus", "video", "user"].map((name) => (
                <Icon key={name} name={name} size={21} />
              ))}
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
              <div className="preview-empty">렌더된 이미지가 없습니다</div>
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
          {index === 0
            ? "표지"
            : `${cardKind(p, index) === "photo" ? "사진" : "본문"} ${index}`}{" "}
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
        onClick={() => s.action("render")}
      >
        ▧ 전체 {p.count + 1}장 렌더 · 미리보기 갱신
      </button>
      <a
        className={
          "primary download full " + (!exportReady(p) || busy ? "disabled" : "")
        }
        role="link"
        tabIndex={exportReady(p) && !busy ? 0 : -1}
        aria-disabled={!exportReady(p) || !!busy}
        href={
          exportReady(p) && !busy ? `/api/projects/${p.id}/download` : undefined
        }
        onClick={(e) => {
          if (!exportReady(p) || busy) e.preventDefault();
        }}
      >
        내보내기
      </a>
    </aside>
  );
}
