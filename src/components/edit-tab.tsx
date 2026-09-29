import {
  PHOTO_CARD_LIMIT,
  PHOTO_TEXT_LIMIT,
  headlineLayout,
  headlineEditorText,
  isPhotoPage,
  photoPageCount,
} from "../../shared/model";
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
            {i === 0
              ? "표지"
              : isPhotoPage(p.copy.pages[i - 1])
                ? `사진 ${i}`
                : `본문 ${i}`}
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
            ← 카드 앞으로
          </button>
          <button
            disabled={index === p.count}
            onClick={() => {
              reorder(index - 1, index);
            }}
          >
            카드 뒤로 →
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
      {index === 0 ? (
        <CoverFields s={s} />
      ) : currentPage && isPhotoPage(currentPage) ? (
        <PhotoCardFields s={s} />
      ) : (
        <PageFields s={s} />
      )}
      {index > 0 && <CardActions s={s} />}
      <AddCard s={s} />
    </>
  );
}

/** A hidden file input behind a button-like label; the pick is reset after. */
function FilePick({
  label,
  disabled,
  onFile,
  className = "tiny",
}: {
  label: string;
  disabled?: boolean;
  onFile: (file: File) => void;
  className?: string;
}) {
  return (
    <label className={`file-pick ${className} ${disabled ? "disabled" : ""}`}>
      {label}
      <input
        type="file"
        aria-label={label}
        accept="image/jpeg,image/png,image/webp"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
    </label>
  );
}

/** Kind switch and delete for the selected following card. */
function CardActions({ s }: { s: Studio }) {
  const { p, index, busy } = s;
  const page = p?.copy.pages[index - 1];
  if (!p || !page) return null;
  const i = index - 1;
  const photoFull = !isPhotoPage(page) && photoPageCount(p) >= PHOTO_CARD_LIMIT;
  return (
    <div className="card-actions">
      {isPhotoPage(page) ? (
        <button
          className="tiny"
          disabled={!!busy}
          onClick={() => s.toTextCard(i)}
        >
          {page.title || page.body
            ? "텍스트 카드로 되돌리기"
            : "텍스트 카드로 바꾸기"}
        </button>
      ) : (
        <>
          <FilePick
            label="사진 카드로 바꾸기"
            disabled={!!busy || photoFull}
            onFile={(file) => s.toPhotoCard(i, file)}
          />
          {page.photoCard && (
            <button
              className="tiny"
              disabled={!!busy || photoFull}
              onClick={() => s.toPhotoCard(i)}
            >
              보관된 사진으로 바꾸기
            </button>
          )}
        </>
      )}
      <button
        className="tiny"
        disabled={!!busy || p.count <= 1}
        onClick={() => {
          if (
            window.confirm(
              `카드 ${index + 1}을(를) 삭제할까요? 이 카드에 보관된 요약과 사진 설정도 현재 작업에서 함께 제거됩니다. 이전 버전에서 복원할 수 있습니다.`,
            )
          )
            s.deleteCard(i);
        }}
      >
        이 카드 삭제
      </button>
      {photoFull && (
        <small className="hint">
          사진 카드는 표지 외 최대 {PHOTO_CARD_LIMIT}장입니다.
        </small>
      )}
    </div>
  );
}

/** ＋ 카드 추가: a text card, or a photo card after its upload succeeds. */
function AddCard({ s }: { s: Studio }) {
  const { p, busy } = s;
  if (!p) return null;
  const full = p.count >= 8;
  const photoFull = photoPageCount(p) >= PHOTO_CARD_LIMIT;
  return (
    <div className="add-card">
      <strong>＋ 카드 추가</strong>
      <FilePick
        label="사진 카드 추가"
        disabled={!!busy || full || photoFull}
        onFile={(file) => s.addCard(file)}
      />
      <button
        className="tiny"
        disabled={!!busy || full}
        onClick={() => s.addCard()}
      >
        텍스트 카드 추가
      </button>
      <small className="hint">
        전체 {p.count + 1}장 · 사진 {photoPageCount(p) + 1}/
        {PHOTO_CARD_LIMIT + 1}
        장(표지 포함)
        {full
          ? " · 카드는 표지 외 최대 8장입니다."
          : photoFull
            ? ` · 사진 카드는 표지 외 최대 ${PHOTO_CARD_LIMIT}장입니다.`
            : ""}
      </small>
    </div>
  );
}

/** A following photo card: photo, fit, optional caption, credit and alt. */
function PhotoCardFields({ s }: { s: Studio }) {
  const { p, index, busy } = s;
  const card = p?.copy.pages[index - 1]?.photoCard;
  if (!p || !card) return null;
  const i = index - 1;
  const field = (patch: Parameters<Studio["photoCardField"]>[1]) =>
    s.photoCardField(i, patch);
  const showText = card.textVisible || !!card.text;
  const page = p.copy.pages[i];
  return (
    <div className="photo-card-fields">
      {!!(page.title || page.body) && (
        <p className="hint">
          원래 요약은 보관되었습니다. ‘텍스트 카드로 되돌리기’로 복구합니다.
        </p>
      )}
      <div
        className={"card-photo " + card.fit}
        onPointerDown={(e) => {
          if (card.fit !== "cover") return;
          const r = e.currentTarget.getBoundingClientRect();
          field({
            focal: {
              ...card.focal,
              x: Math.round(((e.clientX - r.left) / r.width) * 100),
              y: Math.round(((e.clientY - r.top) / r.height) * 100),
            },
          });
        }}
      >
        <img
          src={card.photo}
          alt={card.alt || `카드 ${index + 1} 사진`}
          style={
            card.fit === "cover"
              ? {
                  objectPosition: `${card.focal.x}% ${card.focal.y}%`,
                  transform: `scale(${card.focal.zoom})`,
                  transformOrigin: `${card.focal.x}% ${card.focal.y}%`,
                }
              : undefined
          }
        />
      </div>
      <div className="row">
        <FilePick
          label="사진 교체"
          disabled={!!busy}
          onFile={(file) => s.replaceCardPhoto(i, file)}
        />
        <div className="segmented" role="group" aria-label="사진 맞춤">
          {(
            [
              ["contain", "전체보기"],
              ["cover", "화면 채우기"],
            ] as const
          ).map(([fit, label]) => (
            <button
              key={fit}
              className={card.fit === fit ? "selected" : ""}
              onClick={() => field({ fit })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {card.fit === "cover" &&
        (["x", "y", "zoom"] as const).map((k) => (
          <label className="slider" key={k}>
            {k === "x" ? "가로 초점" : k === "y" ? "세로 초점" : "확대"}
            <input
              type="range"
              min={k === "zoom" ? 1 : 0}
              max={k === "zoom" ? 3 : 100}
              step={k === "zoom" ? 0.05 : 1}
              value={card.focal[k]}
              onChange={(e) =>
                field({ focal: { ...card.focal, [k]: Number(e.target.value) } })
              }
            />
            <span>
              {card.focal[k]}
              {k === "zoom" ? "×" : "%"}
            </span>
          </label>
        ))}
      {showText ? (
        <>
          <label>
            사진 문구{" "}
            <span
              className={[...card.text].length > PHOTO_TEXT_LIMIT ? "warn" : ""}
            >
              {[...card.text].length} / {PHOTO_TEXT_LIMIT}자 · 최대 3줄
            </span>
          </label>
          <textarea
            aria-label="사진 문구"
            value={card.text}
            maxLength={PHOTO_TEXT_LIMIT}
            onChange={(e) => field({ text: e.target.value })}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={!card.textVisible}
              onChange={(e) => field({ textVisible: !e.target.checked })}
            />
            문구 숨기기{" "}
            <small>(내용은 보관되고 이미지에만 나오지 않습니다)</small>
          </label>
        </>
      ) : (
        <button className="tiny" onClick={() => field({ textVisible: true })}>
          ＋ 문구 추가
        </button>
      )}
      <details className="photo-meta">
        <summary>사진 출처·설명</summary>
        <label>사진 출처</label>
        <input
          aria-label="사진 출처"
          value={card.credit}
          maxLength={100}
          onChange={(e) => field({ credit: e.target.value })}
        />
        <label>사진 대체 텍스트</label>
        <textarea
          aria-label="사진 대체 텍스트"
          value={card.alt}
          maxLength={600}
          onChange={(e) => field({ alt: e.target.value })}
        />
      </details>
    </div>
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
      <label>
        게시글 캡션 <span>{[...p.copy.caption].length}자</span>
        <div>
          <LockButton s={s} lockKey="caption" />
          <RegenButton s={s} scope="caption" />
        </div>
      </label>
      <textarea
        aria-label="게시글 캡션"
        value={p.copy.caption}
        disabled={p.locks.caption}
        onChange={(e) => copy("caption", e.target.value)}
      />
      {s.captionConflict !== null && (
        <div className="warn caption-conflict" role="alert">
          <p>
            저장되지 않은 캡션이 있습니다. 그사이 다른 곳에서 캡션이 바뀌었거나
            잠겨 있어 자동으로 적용하지 않았습니다.
          </p>
          <blockquote>{s.captionConflict}</blockquote>
          <button
            className="tiny"
            disabled={p.locks.caption}
            onClick={() => s.applyCaptionConflict()}
          >
            {p.locks.caption ? "잠금 해제 후 적용" : "적용"}
          </button>{" "}
          <button className="tiny" onClick={() => s.discardCaptionConflict()}>
            버리기
          </button>
        </div>
      )}
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
