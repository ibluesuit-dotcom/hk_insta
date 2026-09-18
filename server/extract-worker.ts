import { extractFile } from "./extract";
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
try {
  const text = await extractFile(process.argv[2], Buffer.concat(chunks));
  process.stdout.write(JSON.stringify({ text }));
} catch (e) {
  process.stdout.write(
    JSON.stringify({
      error:
        /[가-힣]/.test((e as Error).message) &&
        !/\/(Users|home|private|tmp)\//.test((e as Error).message)
          ? (e as Error).message
          : "문서를 읽지 못했습니다. 파일 형식과 인코딩을 확인하거나 텍스트를 붙여넣으세요.",
    }),
  );
}
