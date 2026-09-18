import { spawn } from "node:child_process";
// A malformed PDF/DOCX cannot block the app's event loop indefinitely.
export async function isolatedExtract(
  name: string,
  buffer: Buffer,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=256",
        "--import",
        "tsx",
        "server/extract-worker.ts",
        name,
      ],
      { stdio: ["pipe", "pipe", "ignore"], env: { PATH: process.env.PATH } },
    );
    let output = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else {
        try {
          const result = JSON.parse(output);
          if (result.error) reject(new Error(result.error));
          else resolve(result.text);
        } catch {
          reject(
            new Error(
              "문서 추출 실패. 파일을 확인하거나 텍스트를 붙여넣으세요.",
            ),
          );
        }
      }
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(
        new Error(
          "문서 추출 시간이 15초를 초과했습니다. 파일을 나누거나 텍스트로 입력하세요.",
        ),
      );
    }, 15000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.length > 500000) {
        child.kill("SIGKILL");
        finish(new Error("문서 추출 결과가 너무 큽니다."));
      }
    });
    child.on("error", () =>
      finish(new Error("문서 추출 프로세스를 시작하지 못했습니다.")),
    );
    child.on("close", () => finish());
    child.stdin.on("error", () => {});
    child.stdin.end(buffer);
  });
}
