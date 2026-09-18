import { Auth } from "../hooks/use-auth";

export function Welcome({ auth }: { auth: Auth }) {
  const {
    login,
    username,
    setUsername,
    password,
    setPassword,
    loggingIn,
    checkingSession,
    loginError,
  } = auth;
  return (
    <section className="welcome">
      <div className="welcome-copy">
        <span className="eyebrow">FROM ARTICLE TO STORY</span>
        <h2>
          읽히는 뉴스,
          <br />
          기억에 남는 카드.
        </h2>
        <p>
          원문을 바탕으로 문안을 다듬고, 직접 고른 사진으로 완성하세요.
          <br />
          표지부터 본문까지 일관된 한국경제TV 디자인으로 제작합니다.
        </p>
      </div>
      <form
        className="login-panel"
        onSubmit={login}
        aria-label="공용 계정 로그인"
      >
        <span className="eyebrow">NEWS CARD STUDIO</span>
        <h2>로그인</h2>
        <p>공용 계정으로 뉴스 카드 제작을 시작하세요.</p>
        <label htmlFor="login-username">아이디</label>
        <input
          id="login-username"
          name="username"
          autoComplete="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={loggingIn || checkingSession}
        />
        <label htmlFor="login-password">비밀번호</label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loggingIn || checkingSession}
        />
        {loginError && (
          <p className="login-error" role="alert">
            {loginError}
          </p>
        )}
        <button
          className="primary"
          type="submit"
          disabled={loggingIn || checkingSession}
        >
          {checkingSession
            ? "접속 확인 중…"
            : loggingIn
              ? "로그인 중…"
              : "로그인"}
        </button>
      </form>
      <div className="welcome-card">
        <span>NEWS BRIEF</span>
        <strong>
          기사의 핵심을
          <br />
          <em>더 선명하게.</em>
        </strong>
        <small>1080 × 1350 · PRETENDARD</small>
      </div>
    </section>
  );
}
