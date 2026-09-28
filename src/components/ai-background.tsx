import {
  AI_LABELS,
  AiVariant,
  isAiBackground,
  sourceHash,
} from "../../shared/ai-background";
import { AI_VARIANTS, AiSlot, Studio } from "../hooks/use-studio";

const variantNames: Record<AiVariant, string> = {
  photo: "사진형",
  art: "디지털 아트형",
};

/** Cover headline as the card breaks it: "/" is a line break, "\/" a slash. */
function previewTitle(text: string) {
  return text
    .replace(/\\\//g, "\u0000")
    .replace(/\//g, "\n")
    .replace(/\u0000/g, "/");
}

/**
 * AI 배경 이미지: brief → photo and art candidates side by side. Nothing
 * changes on the card until "이 이미지 사용" runs the dedicated apply action.
 */
export function AiBackgroundPicker({ s }: { s: Studio }) {
  const { p, ai, health, busy } = s;
  if (!p || !ai || ai.projectId !== p.id) return null;
  const enabled = !!health.aiBackground?.generate;
  const shown = AI_VARIANTS.some((v) => ai.slots[v].status !== "idle");
  const applied = isAiBackground(p) ? p.background! : null;
  // With the switch off, only existing candidates and the applied one remain.
  if (!enabled && !shown && !applied) return null;
  const generating = AI_VARIANTS.some(
    (v) => ai.slots[v].status === "generating",
  );
  const noText = !p.sourceTitle.trim() && !p.source.trim();
  const currentHash = sourceHash(p);
  const title = previewTitle(p.copy.headline || p.sourceTitle);
  return (
    <section className="ai-background" aria-label="AI 배경 이미지">
      <div className="ai-background-head">
        <div>
          <h4>AI 배경 이미지</h4>
          <small>
            기사 제목·본문으로 사진형과 디지털 아트형을 1장씩 만듭니다.
          </small>
        </div>
        {enabled && (
          <button
            className="primary"
            disabled={!!busy || generating || noText}
            onClick={() => s.generateAi()}
          >
            {generating ? "AI 이미지 생성 중…" : "AI로 이미지 생성하기"}
          </button>
        )}
      </div>
      {enabled && noText && (
        <p className="hint">원문 제목이나 본문을 먼저 입력하세요.</p>
      )}
      {applied && (
        <p className="ai-applied">
          현재 표지 배경: <b>{AI_LABELS[applied.variant]}</b> ·{" "}
          {applied.subject}
          {applied.status === "needs_review" && (
            <span className="warn">
              검토 필요 · {applied.reviewReason || "사유 없음"}
            </span>
          )}
        </p>
      )}
      {ai.notice && (
        <p className="ai-notice" role="status">
          {ai.notice}
        </p>
      )}
      {shown && (
        <div className="ai-candidates">
          {AI_VARIANTS.map((variant) => (
            <CandidateCard
              key={variant}
              s={s}
              variant={variant}
              slot={ai.slots[variant]}
              enabled={enabled}
              busy={!!busy}
              noText={noText}
              stale={
                !!ai.slots[variant].candidate &&
                ai.slots[variant].candidate!.sourceHash !== currentHash
              }
              applied={
                !!applied &&
                applied.assetId === ai.slots[variant].candidate?.assetId
              }
              title={title}
            />
          ))}
        </div>
      )}
      <p className="hint">
        AI가 만든 일반적 배경이며 실제 현장 사진이 아닙니다. 표지 하단에 “AI
        생성 이미지” 또는 “AI 생성 일러스트”가 표시됩니다.
      </p>
    </section>
  );
}

function CandidateCard({
  s,
  variant,
  slot,
  enabled,
  busy,
  noText,
  stale,
  applied,
  title,
}: {
  s: Studio;
  variant: AiVariant;
  slot: AiSlot;
  enabled: boolean;
  busy: boolean;
  noText: boolean;
  stale: boolean;
  applied: boolean;
  title: string;
}) {
  const name = variantNames[variant];
  const c = slot.candidate;
  const [badge, tone] =
    slot.status === "generating"
      ? ["생성 중…", "busy"]
      : slot.status === "failed"
        ? [slot.blocked ? "생성 거절됨" : "생성 실패", "bad"]
        : applied
          ? ["적용됨", "good"]
          : c?.status === "needs_review"
            ? ["검토 필요", "warn"]
            : c
              ? ["완료", "good"]
              : ["대기", ""];
  return (
    <article
      className={"ai-candidate " + slot.status}
      aria-label={name + " 후보"}
      aria-busy={slot.status === "generating"}
    >
      <div className="ai-candidate-head">
        <strong>{name}</strong>
        <span className={"ai-badge " + tone}>{badge}</span>
        {stale && <span className="ai-badge warn">이전 기사 기준</span>}
      </div>
      <div className="ai-frame">
        {c && slot.status !== "failed" ? (
          <>
            <img src={c.url} alt={`${name} AI 배경 후보: ${c.subject}`} />
            <div className="ai-scrim" aria-hidden="true" />
            {title && (
              <div className="ai-title" aria-hidden="true">
                {title}
              </div>
            )}
            <small className="ai-credit">{c.label}</small>
          </>
        ) : (
          <div className="ai-placeholder">
            {slot.status === "generating"
              ? "이미지를 만들고 있습니다"
              : slot.status === "failed"
                ? slot.blocked
                  ? "안전 정책으로 생성이 거절됐습니다"
                  : "이 칸은 생성하지 못했습니다"
                : "아직 만들지 않았습니다"}
          </div>
        )}
        {slot.status === "generating" && c && (
          <div className="ai-overlay">다시 만드는 중…</div>
        )}
      </div>
      {slot.status === "failed" && slot.error && (
        <p className="warn" role="alert">
          {slot.error}
        </p>
      )}
      {c && slot.status !== "failed" && (
        <>
          <p className="ai-subject">{c.subject}</p>
          {c.status === "needs_review" && (
            <p className="warn">검토 필요 · {c.reviewReason || "사유 없음"}</p>
          )}
        </>
      )}
      <div className="ai-actions">
        {c && slot.status !== "failed" && (
          <>
            <a href={c.url} target="_blank" rel="noreferrer">
              원본 보기
            </a>
            <button
              className="primary"
              disabled={busy || applied || slot.status === "generating"}
              onClick={() => s.applyAi(c.assetId)}
            >
              {applied ? "적용됨" : "이 이미지 사용"}
            </button>
          </>
        )}
        {enabled && slot.status !== "idle" && (
          <button
            disabled={busy || noText || slot.status === "generating"}
            onClick={() => s.generateAi([variant])}
          >
            다시 만들기
          </button>
        )}
      </div>
    </article>
  );
}
