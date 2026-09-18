import { Studio } from "../hooks/use-studio";

export function LockButton({ s, lockKey }: { s: Studio; lockKey: string }) {
  const { p } = s;
  return (
    <button
      className={"tiny " + (p?.locks[lockKey] ? "locked" : "")}
      onClick={() =>
        s.edit((p) => ({
          ...p,
          locks: { ...p.locks, [lockKey]: !p.locks[lockKey] },
        }))
      }
      aria-label={lockKey + " 잠금"}
    >
      {p?.locks[lockKey] ? "● 잠김" : "○ 잠금"}
    </button>
  );
}

export function RegenButton({ s, scope }: { s: Studio; scope: string }) {
  const { p } = s;
  return (
    <button
      className="tiny"
      disabled={!!s.busy || p?.locks[scope]}
      onClick={() => s.action("generate", { scope })}
    >
      {scope === "headline" && p?.sourceTitle.trim()
        ? "원제 적용"
        : "↻ 다시 생성"}
    </button>
  );
}

export function Evidence({
  s,
  quotes,
  title = false,
}: {
  s: Studio;
  quotes: string[];
  title?: boolean;
}) {
  const { p } = s;
  return (
    <details className="evidence">
      <summary>원문 근거 {quotes.length}개</summary>
      {quotes.map((q, i) => (
        <blockquote key={i}>
          {q}
          <span
            className={
              p?.source.includes(q) || (title && p?.sourceTitle.includes(q))
                ? "verified"
                : "warn"
            }
          >
            {p?.source.includes(q) || (title && p?.sourceTitle.includes(q))
              ? "원문 일치"
              : "원문에서 찾을 수 없음 · 재확인"}
          </span>
        </blockquote>
      ))}
    </details>
  );
}

export function CoverPhotoUpload({ s }: { s: Studio }) {
  const { p, photo, busy } = s;
  if (!p) return null;
  return (
    <div
      className="drop photo-drop"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        photo(e.dataTransfer.files[0]);
      }}
    >
      {p.photo ? (
        <img src={p.photo} alt="메인 카드 배경 이미지" />
      ) : (
        <span aria-hidden="true">▧</span>
      )}
      <strong>{p.photo ? "배경 이미지 바꾸기" : "이미지 파일 선택"}</strong>
      <small>여기를 클릭하거나 이미지 파일을 끌어다 놓으세요</small>
      <small>JPG · PNG · WebP / 25MB까지</small>
      <input
        aria-label="표지 사진 첨부"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={!!busy}
        onChange={(e) => {
          photo(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
