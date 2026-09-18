import React, { useEffect, useState } from "react";

export function PreviewImage({
  src,
  alt,
  original = false,
}: {
  src: string;
  alt?: string;
  original?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [expired, setExpired] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!failed) return;
    let active = true;
    fetch("/api/session")
      .then((response) => response.json())
      .then((session) => {
        if (active) setExpired(!session.authenticated);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [failed]);
  if (failed)
    return (
      <div className="preview-empty" role="status">
        <strong>
          {expired ? "로그인이 만료되었습니다" : "이미지를 불러오지 못했습니다"}
        </strong>
        <small>
          {expired
            ? "새 창에서 로그인한 뒤 다시 불러오세요."
            : "다시 불러오거나 전체 미리보기를 갱신해 주세요."}
        </small>
        {expired && (
          <a href="/" target="_blank" rel="noreferrer">
            새 창에서 로그인
          </a>
        )}
        <button
          onClick={() => {
            setExpired(false);
            setFailed(false);
            setAttempt((n) => n + 1);
          }}
        >
          이미지 다시 불러오기
        </button>
      </div>
    );
  const image = (
    <img
      src={
        attempt ? `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}` : src
      }
      alt={alt || "완성 카드 이미지"}
      onError={() => setFailed(true)}
    />
  );
  return original ? (
    <a href={src} target="_blank" rel="noreferrer">
      {image}
    </a>
  ) : (
    image
  );
}
