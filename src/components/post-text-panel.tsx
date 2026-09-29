import { sourceHash } from "../../shared/ai-background";
import {
  ONE_ARTICLE_MESSAGE,
  POST_FORMATS,
  POST_FORMAT_HELP,
  POST_FORMAT_NAMES,
  REVIEW_NAMES,
  measure,
  postTextOf,
  reviewOf,
  reviewState,
  selectedFormat,
  sourceDocumentCount,
  type PostFormat,
  type PostOptions,
} from "../../shared/post-text";
import type { GenFormat, Studio } from "../hooks/use-studio";
import { LockButton } from "./fields";

/**
 * 03 인스타 게시글: four formats, one editor at a time. Choosing a format
 * never calls AI; generation makes a candidate that is applied explicitly.
 */
export function PostTextPanel({ s }: { s: Studio }) {
  const { p, postView: view, setPostView, busy } = s;
  if (!p) return null;
  const text = postTextOf(p, view);
  const exported = selectedFormat(p);
  const sourceLength = measure(p.source);
  const length = measure(text);
  const locked = view === "short" && !!p.locks.caption;
  const variant = view === "short" ? undefined : p.postText?.[view];
  const manyDocuments = sourceDocumentCount(p) > 1;
  const sourceChanged =
    view === "full" &&
    variant?.provenance === "source_copy" &&
    variant.sourceHash !== sourceHash(p);
  return (
    <>
      <div className="section-title">
        <div>
          <span className="eyebrow">INSTAGRAM POST</span>
          <h2>인스타 게시글을 준비하세요</h2>
        </div>
        <span className="pill">03 / 게시글</span>
      </div>
      <div className="segmented post-formats" role="tablist">
        {POST_FORMATS.map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={view === f}
            className={view === f ? "selected" : ""}
            onClick={() => setPostView(f)}
          >
            {POST_FORMAT_NAMES[f]}
          </button>
        ))}
      </div>
      <p className="hint">{POST_FORMAT_HELP[view]}</p>
      {(view === "summary" || view === "bullets") && (
        <PostOptionsFields s={s} format={view} />
      )}
      <label>
        {POST_FORMAT_NAMES[view]}{" "}
        <span>
          {length.toLocaleString()}자
          {sourceLength > 0 && view !== "short" && view !== "full"
            ? ` · 원문 대비 ${Math.round((length / sourceLength) * 100)}%`
            : ""}
        </span>
        {view === "short" && (
          <div>
            <LockButton s={s} lockKey="caption" />
          </div>
        )}
      </label>
      <textarea
        className="post-editor"
        aria-label={`${POST_FORMAT_NAMES[view]} 글`}
        value={text}
        disabled={locked}
        placeholder={
          view === "full"
            ? "‘원문 불러오기’로 확인한 기사 원문을 가져오세요."
            : "직접 쓰거나 ‘생성’으로 후보를 만든 뒤 적용하세요."
        }
        onChange={(e) =>
          view === "short"
            ? s.setCaption(e.target.value)
            : s.setPostText(view, e.target.value)
        }
      />
      {view === "short" && <CaptionRecovery s={s} />}
      {sourceChanged && (
        <p className="warn" role="alert">
          원문이 바뀌었습니다. 필요하면 ‘원문 불러오기’로 다시 가져오세요.
        </p>
      )}
      {manyDocuments && view !== "short" && (
        <p className="warn">{ONE_ARTICLE_MESSAGE}</p>
      )}
      <ReviewLine s={s} format={view} />
      <div className="row post-actions">
        {view === "full" ? (
          <button
            disabled={!!busy || !p.source.trim() || manyDocuments}
            onClick={() => {
              if (
                !text.trim() ||
                text === p.source ||
                window.confirm(
                  "지금 풀 기사 글을 원문으로 바꿀까요? 수정한 내용은 버전 기록에 남습니다.",
                )
              )
                s.setPostText("full", p.source);
            }}
          >
            원문 불러오기
          </button>
        ) : (
          <button
            className="primary"
            disabled={
              locked ||
              !p.source.trim() ||
              s.postJobs[view]?.status === "generating"
            }
            onClick={() => s.generatePostText(view)}
          >
            {s.postJobs[view]?.status === "generating"
              ? "생성·원문 대조 중…"
              : text.trim()
                ? "다시 생성"
                : "생성"}
          </button>
        )}
        <button
          disabled={!!busy || !text.trim() || exported === view}
          onClick={() => s.setExportFormat(view)}
        >
          {exported === view ? "내보낼 형식 ✓" : "내보낼 형식으로 지정"}
        </button>
        <button disabled={!text.trim()} onClick={() => s.copyPost(text)}>
          복사
        </button>
      </div>
      <p className="hint" aria-live="polite">
        내보낼 형식: <b>{POST_FORMAT_NAMES[exported]}</b>
        {s.postCopyStatus ? ` · ${s.postCopyStatus}` : ""}
      </p>
      {view !== "full" && <CandidateBox s={s} format={view} />}
      <details className="source-reference">
        <summary>원문과 비교</summary>
        <div className="comparison">
          <p>
            <b>원문</b>
            {p.source}
          </p>
          <p>
            <b>{POST_FORMAT_NAMES[view]}</b>
            {text}
          </p>
        </div>
      </details>
    </>
  );
}

function PostOptionsFields({
  s,
  format,
}: {
  s: Studio;
  format: "summary" | "bullets";
}) {
  const options = s.postOptions[format];
  const set = (patch: Partial<PostOptions>) =>
    s.setPostOptions((all) => ({
      ...all,
      [format]: { ...all[format], ...patch },
    }));
  return (
    <details className="post-options">
      <summary>요약 설정</summary>
      {format === "summary" ? (
        <>
          <label>길이</label>
          <select
            aria-label="요약 길이"
            value={options.length}
            onChange={(e) =>
              set({ length: e.target.value as PostOptions["length"] })
            }
          >
            <option value="short">더 짧게 · 약 1/5</option>
            <option value="default">기본 · 약 1/3</option>
            <option value="long">자세히 · 약 1/2</option>
          </select>
        </>
      ) : (
        <>
          <label>항목 길이</label>
          <select
            aria-label="불릿 길이"
            value={options.detail}
            onChange={(e) =>
              set({ detail: e.target.value as PostOptions["detail"] })
            }
          >
            <option value="brief">더 간결하게</option>
            <option value="default">기본 · 소제목+1~2문장</option>
            <option value="detailed">조금 자세히</option>
          </select>
        </>
      )}
      <label>초점</label>
      <select
        aria-label="요약 초점"
        value={options.focus}
        onChange={(e) => set({ focus: e.target.value as PostOptions["focus"] })}
      >
        <option value="balanced">기사 전체 균형</option>
        <option value="numbers">핵심 수치 중심</option>
        <option value="context">배경·맥락 중심</option>
      </select>
      <label>추가 요청</label>
      <input
        aria-label="추가 요청"
        maxLength={200}
        placeholder="예: 소비자에게 미치는 영향을 먼저"
        value={options.instruction}
        onChange={(e) => set({ instruction: e.target.value })}
      />
      <small className="hint">
        설정은 다음 생성에 적용됩니다. 정확성 규칙은 바뀌지 않습니다.
      </small>
    </details>
  );
}

function ReviewLine({ s, format }: { s: Studio; format: PostFormat }) {
  const { p, busy } = s;
  if (!p) return null;
  const text = postTextOf(p, format);
  if (!text.trim()) return null;
  const state = reviewState(p, format);
  const review = reviewOf(p, format);
  return (
    <div className={"post-review " + state}>
      <span>{REVIEW_NAMES[state]}</span>
      <button
        className="tiny"
        disabled={!!busy || !p.source.trim()}
        onClick={() => s.verifyPostText(format)}
      >
        {state === "unchecked" ? "원문과 대조" : "검증만 다시"}
      </button>
      {state !== "unchecked" &&
        state !== "pass" &&
        review &&
        (review.issues.length > 0 || review.missing.length > 0) && (
          <details>
            <summary>대조 결과 보기</summary>
            <ul>
              {review.issues.map((x) => (
                <li key={"i" + x}>{x}</li>
              ))}
              {review.missing.map((x) => (
                <li key={"m" + x}>누락: {x}</li>
              ))}
            </ul>
          </details>
        )}
      <small className="hint">
        원문 대조는 원문과의 일치 여부만 봅니다. 사실 검증이나 게시 승인이
        아닙니다.
      </small>
    </div>
  );
}

function CandidateBox({ s, format }: { s: Studio; format: GenFormat }) {
  const job = s.postJobs[format];
  if (!job || (job.status === "generating" && !job.candidate)) return null;
  if (job.status === "failed")
    return (
      <div className="post-candidate failed" role="alert">
        <p>{job.error}</p>
        <button className="tiny" onClick={() => s.discardPostCandidate(format)}>
          닫기
        </button>
      </div>
    );
  const c = job.candidate!;
  const failed = c.review?.overall === "fail";
  return (
    <div className="post-candidate">
      <strong>새 후보 · {POST_FORMAT_NAMES[format]}</strong>
      <small>
        {measure(c.text).toLocaleString()}자
        {format !== "short" ? ` · 원문 대비 ${Math.round(c.ratio * 100)}%` : ""}{" "}
        · {c.model}
      </small>
      <blockquote>{c.text}</blockquote>
      <p className={failed ? "warn" : "hint"}>
        {c.review
          ? REVIEW_NAMES[c.review.overall]
          : `원문 대조를 하지 못했습니다${c.reviewError ? ` (${c.reviewError})` : ""}. 적용 후 ‘원문과 대조’를 다시 실행하세요.`}
      </p>
      {c.review &&
        (c.review.issues.length > 0 || c.review.missing.length > 0) && (
          <ul className="hint">
            {c.review.issues.map((x) => (
              <li key={"i" + x}>{x}</li>
            ))}
            {c.review.missing.map((x) => (
              <li key={"m" + x}>누락: {x}</li>
            ))}
          </ul>
        )}
      {c.lengthExceptionReason && (
        <p className="hint">길이 차이: {c.lengthExceptionReason}</p>
      )}
      {c.warnings.length > 0 && (
        <p className="hint">참고: {c.warnings.join(" · ")}</p>
      )}
      <div className="row">
        <button
          className="primary tiny"
          disabled={!!s.busy}
          onClick={() => {
            // The text was edited after this candidate was made.
            const edited = !!s.p && postTextOf(s.p, format) !== c.baseText;
            if (
              edited &&
              !window.confirm(
                "후보를 만든 뒤 글을 수정했습니다. 수정한 글을 이 후보로 바꿀까요? 이전 글은 버전 기록에 남습니다.",
              )
            )
              return;
            s.applyPostCandidate(format, failed, edited);
          }}
        >
          {failed ? "검토 필요로 적용" : "이 후보 적용"}
        </button>
        {(!c.review || failed) && (
          <button
            className="tiny"
            onClick={() => s.reverifyPostCandidate(format)}
          >
            원문 대조 다시
          </button>
        )}
        <button className="tiny" onClick={() => s.discardPostCandidate(format)}>
          버리기
        </button>
      </div>
      <small className="hint">
        적용하면 지금 {POST_FORMAT_NAMES[format]} 글을 이 후보로 바꿉니다. 이전
        글은 버전 기록에 남습니다.
      </small>
    </div>
  );
}

/** Unsaved caption from an earlier session that could not be applied. */
function CaptionRecovery({ s }: { s: Studio }) {
  const { p } = s;
  if (!p || s.captionConflict === null) return null;
  return (
    <div className="warn caption-conflict" role="alert">
      <p>
        저장되지 않은 캡션이 있습니다. 그사이 다른 곳에서 캡션이 바뀌었거나 잠겨
        있어 자동으로 적용하지 않았습니다.
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
  );
}
