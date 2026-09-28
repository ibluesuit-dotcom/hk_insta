import { initStore } from "./store";
import { createApp } from "./app";
await initStore();
const app = await createApp();
const port = Number(process.env.PORT || 4310);
const server = app.listen(port, "127.0.0.1", () =>
  console.log(`News Card Studio http://127.0.0.1:${port}`),
);

// 배포·재시작 시 진행 중인 저장·AI 생성·렌더를 끊지 않도록, 새 연결은 받지 않고
// 처리 중인 요청이 끝나면 종료한다. 너무 오래 걸리면 강제 종료한다.
const DRAIN_LIMIT_MS = 150_000;
let closing = false;
function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  console.log(`${signal}: 진행 중 요청을 마친 뒤 종료합니다.`);
  server.close(() => process.exit(0));
  const idle = setInterval(() => server.closeIdleConnections(), 500);
  idle.unref();
  server.closeIdleConnections();
  setTimeout(() => {
    console.error(`종료 대기 ${DRAIN_LIMIT_MS / 1000}초 초과, 강제 종료합니다.`);
    process.exit(1);
  }, DRAIN_LIMIT_MS).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
