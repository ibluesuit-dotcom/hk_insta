import {
  PHOTO_POST_LIMIT,
  photoStyleOf,
  type PhotoStyle,
  blankTextPage,
  isPhotoPage,
  resizePages,
} from "../../shared/model";
import { api } from "../api";
import { keepPageDraftsBelow } from "../format";
import { Studio } from "../hooks/use-studio";
import { AiBackgroundPicker } from "./ai-background";
import { CoverPhotoUpload, Evidence } from "./fields";

/** 01 원문과 제작 방향: source input, keyword suggestions, cover photo. */
export function SourceTab({ s }: { s: Studio }) {
  const { p, busy, run, edit, set, files, action } = s;
  if (!p) return null;
  return (
    <>
      <div className="section-title">
        <div>
          <span className="eyebrow">SOURCE MATERIAL</span>
          <h2>어떤 소식을 전할까요?</h2>
        </div>
        <span className="pill">01 / 원문</span>
      </div>
      <PostTypeFields s={s} />
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
                  sourceFromUrl: true,
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
          disabled={!!busy || !p.source.trim() || p.locks.keywords}
          onClick={() => {
            s.setClipboardStatus("");
            action("generate", { scope: "keywords" });
          }}
        >
          사진 키워드 추천받기
        </button>
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
                  onClick={() => s.copyKeyword(k.query)}
                >
                  복사
                </button>
              </div>
              <small>{k.reason}</small>
              <Evidence s={s} quotes={[k.quote]} />
            </div>
          ))}
        </div>
        {p.generation?.scope === "keywords" && !p.copy.keywords.length && (
          <p className="hint">
            현재 원문에서 추천할 단어를 찾지 못했습니다. 원문을 보완한 뒤 다시
            추천받으세요.
          </p>
        )}
        <p role="status" aria-live="polite">
          {s.clipboardStatus}
        </p>
      </section>
      <section
        className="cover-upload-panel"
        aria-label="메인 카드 배경 이미지 첨부"
      >
        <h3>메인 카드 배경 이미지</h3>
        <CoverPhotoUpload s={s} />
        <AiBackgroundPicker s={s} />

        {p.photo && (
          <button
            type="button"
            onClick={() => {
              s.setIndex(0);
              s.setTab("edit");
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
                  // The source is now the files only.
                  sourceFromUrl: false,
                }))
              }
            >
              수정한 파일 전체로 통합 원문 갱신
            </button>
          )}
          <small>
            통합 원문이 AI 생성에 사용됩니다. 파일 수정·제거 후 갱신 버튼을 눌러
            반영하세요.
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
      <label>
        추출 원문 확인·수정{" "}
        <span>{p.source.length.toLocaleString()}자 / 60,000자</span>
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
            sourceFromUrl: e.target.value.trim() ? p.sourceFromUrl : false,
          }))
        }
        placeholder="기사 본문이나 방송 스크립트를 붙여넣으세요. 숫자, 시점, 조건이 빠지지 않았는지 확인하세요."
      />
      <div className="row">
        <button disabled={!p.source.trim()} onClick={() => s.copySource()}>
          기사 복사하기
        </button>
        <p className="hint" aria-live="polite">
          {s.sourceCopyStatus}
        </p>
      </div>
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
      {p.direction !== p.appliedDirection && p.copy.headline && (
        <p className="warn">
          ● 새 방향 미반영 · 전체 또는 선택 필드에 적용하세요.
        </p>
      )}
      {p.postType === "photo" ? (
        <PhotoPostFields s={s} />
      ) : (
        <div className="count-setting">
          <div>
            <strong>본문 페이지 수</strong>
          </div>
          <select
            aria-label="본문 페이지 수"
            value={p.count}
            onChange={(e) => {
              const count = Number(e.target.value);
              if (
                count < p.count &&
                !window.confirm(
                  `카드 ${count + 2}~${p.count + 1}을(를) 삭제할까요? 해당 카드의 문안·사진 설정과 잠금이 삭제됩니다${
                    p.copy.pages.slice(count).some((pg) => pg.kind === "photo")
                      ? " (사진 카드 포함)"
                      : ""
                  }. 이전 버전에서 복원할 수 있습니다.`,
                )
              )
                return;
              s.persistDrafts(keepPageDraftsBelow(s.draftsRef.current, count));
              edit((p) => resizePages(p, count));
              s.setIndex(0);
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
      )}
      <button
        className="primary full"
        disabled={!!busy}
        onClick={() => action("generate", { scope: "all" })}
      >
        생성
      </button>
    </>
  );
}

/** 게시물 형식: cover + summary text cards, or cover + photos. */
function PostTypeFields({ s }: { s: Studio }) {
  const { p, busy } = s;
  if (!p) return null;
  const photo = p.postType === "photo";
  return (
    <div className="post-type">
      <strong>게시물 형식</strong>
      <div className="segmented" role="radiogroup" aria-label="게시물 형식">
        {(
          [
            ["summary", "사진 + 요약 텍스트"],
            ["photo", "사진 게시물"],
          ] as const
        ).map(([type, label]) => (
          <button
            key={type}
            role="radio"
            aria-checked={(p.postType ?? "summary") === type}
            className={(p.postType ?? "summary") === type ? "selected" : ""}
            disabled={!!busy}
            onClick={() => s.setPostType(type)}
          >
            {label}
          </button>
        ))}
      </div>
      <small className="hint">
        {photo
          ? `표지 다음에 사진을 최대 ${PHOTO_POST_LIMIT}장(표지 포함 ${PHOTO_POST_LIMIT + 1}장) 넣습니다. AI는 표지 제목·부제만 씁니다.`
          : "표지 사진·제목 다음에 기사 요약 카드가 이어집니다. 필요한 카드만 02 편집에서 사진으로 바꿀 수 있습니다."}
      </small>
    </div>
  );
}

/** Photo post: upload the following photos here, choose captions or not. */
function PhotoPostFields({ s }: { s: Studio }) {
  const { p, busy } = s;
  if (!p) return null;
  const photos = p.copy.pages.filter(isPhotoPage);
  const texts = p.copy.pages.filter(
    (pg) => !isPhotoPage(pg) && !blankTextPage(pg),
  ).length;
  const room = PHOTO_POST_LIMIT - photos.length;
  // What the photos actually output: one design for all, or mixed.
  const styles = photos.map((pg) => photoStyleOf(pg.photoCard!));
  const style: PhotoStyle | null = !styles.length
    ? p.photoFrame
      ? "frame"
      : p.photoText
        ? "caption"
        : "image"
    : styles.every((x) => x === styles[0])
      ? styles[0]
      : null;
  const upload = (files: File[]) => {
    if (files.length > room)
      s.setError(
        `사진은 표지 외 ${PHOTO_POST_LIMIT}장까지입니다. ${room}장만 더 올릴 수 있습니다.`,
      );
    else s.addPhotoCards(files);
  };
  return (
    <div className="photo-post">
      <strong>사진 카드 디자인</strong>
      <div
        className="segmented"
        role="radiogroup"
        aria-label="사진 카드 디자인"
      >
        {PHOTO_STYLES.map(([value, label]) => (
          <button
            key={value}
            role="radio"
            aria-checked={style === value}
            className={style === value ? "selected" : ""}
            disabled={!!busy}
            onClick={() => s.setPhotoStyle(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <small className="hint">
        {style === null
          ? "사진마다 디자인이 다릅니다. 하나를 고르면 모든 사진에 같이 적용됩니다."
          : PHOTO_STYLE_HELP[style]}
      </small>
      <div
        className="photo-add"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          upload(Array.from(e.dataTransfer.files));
        }}
      >
        <label
          className={`file-pick primary ${busy || room <= 0 ? "disabled" : ""}`}
        >
          ＋ 사진 추가
          <input
            aria-label="사진 추가"
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            disabled={!!busy || room <= 0}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              upload(files);
            }}
          />
        </label>
        <span>
          <b>
            사진 {photos.length}/{PHOTO_POST_LIMIT}장
          </b>{" "}
          (표지 외)
        </span>
        <small className="hint">
          {room > 0
            ? "여러 장을 한 번에 고르거나 여기에 끌어다 놓으세요 · JPG·PNG·WebP"
            : "사진을 모두 채웠습니다. 바꾸려면 02 편집에서 삭제하세요."}
        </small>
      </div>
      {photos.length > 0 && (
        <div className="photo-strip">
          {photos.map((pg, i) => (
            <img
              key={pg.id ?? i}
              src={pg.photoCard!.photo}
              alt={`사진 ${i + 1}`}
            />
          ))}
        </div>
      )}
      <small className="hint">
        순서 바꾸기·삭제·사진별 글은 02 문안·사진 편집에서 합니다.
        {texts > 0 ? ` 텍스트 카드 ${texts}장도 함께 있습니다.` : ""}
      </small>
    </div>
  );
}

export const PHOTO_STYLES: [PhotoStyle, string][] = [
  ["image", "이미지만"],
  ["caption", "이미지 + 하단 글"],
  ["frame", "제목·사진·요약 (액자형)"],
];
const PHOTO_STYLE_HELP: Record<PhotoStyle, string> = {
  image: "사진만 카드를 가득 채웁니다.",
  caption:
    "사진 아래쪽에 넣을 글(최대 100자·3줄)을 02 문안·사진 편집에서 직접 씁니다.",
  frame:
    "위에 제목, 가운데 흰 액자 사진, 아래 3줄 요약이 들어갑니다. 제목·요약은 02 문안·사진 편집에서 직접 씁니다.",
};
