import { test } from "node:test";
import assert from "node:assert/strict";
import { blank, mergeCopy, validateEvidence } from "../shared/model";
import { publicAddress, extractFile, fetchArticle } from "../server/extract";
import { escape } from "../server/render";
test("SSRF blocks private, loopback, mapped IPv6, metadata and link-local", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("8.8.8.8"), true);
});
test("URL fetch rejects local destinations", async () => {
  await assert.rejects(fetchArticle("http://127.0.0.1"), /로컬/);
  await assert.rejects(fetchArticle("file:///etc/passwd"));
});
test("exact source quote validation rejects invented evidence", () => {
  const p = blank();
  p.copy.headlineEvidence = ["실제 원문"];
  validateEvidence(p.copy, "실제 원문입니다");
  assert.throws(() => validateEvidence(p.copy, "다른 원문"));
});
test("scope and locks preserve cover and existing pages", () => {
  const p = blank();
  p.copy.headline = "잠근 제목";
  p.locks.headline = true;
  p.copy.pages[0].body = "원래 본문";
  const n = structuredClone(p.copy);
  n.headline = "새 제목";
  n.pages[0].body = "새 본문";
  assert.equal(mergeCopy(p, n, "all").headline, "잠근 제목");
  assert.equal(mergeCopy(p, n, "kicker").pages[0].body, "원래 본문");
  assert.equal(mergeCopy(p, n, "page:0").pages[0].body, "새 본문");
});
test("file validation and UTF-8 extraction", async () => {
  assert.equal(
    await extractFile("test.md", Buffer.from("경제 뉴스 원문을 입력합니다.")),
    "경제 뉴스 원문을 입력합니다.",
  );
  await assert.rejects(extractFile("evil.exe", Buffer.from("data")));
  await assert.rejects(extractFile("fake.pdf", Buffer.from("not a PDF file")));
  await assert.rejects(
    extractFile("big.txt", Buffer.alloc(10 * 1024 * 1024 + 1)),
  );
});
test("template content escapes HTML", () =>
  assert.equal(escape('<script>"&'), "&lt;script&gt;&quot;&amp;"));

test("real DOCX and PDF extract successfully", async () => {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  pdfDoc
    .addPage()
    .drawText("Economic news source. Exports increased during August.", {
      x: 50,
      y: 700,
      font,
      size: 16,
    });
  const pdfBuffer = Buffer.from(await pdfDoc.save({ useObjectStreams: false }));
  assert.match(await extractFile("source.pdf", pdfBuffer), /Exports increased/);
  const { default: archiver } = await import("archiver");
  const chunks: Buffer[] = [];
  const archive = archiver("zip");
  archive.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise<void>((resolve) => archive.on("end", resolve));
  archive.append(
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    { name: "[Content_Types].xml" },
  );
  archive.append(
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>경제 뉴스 문서 원문을 정확히 추출합니다.</w:t></w:r></w:p></w:body></w:document>',
    { name: "word/document.xml" },
  );
  await archive.finalize();
  await done;
  assert.match(
    await extractFile("source.docx", Buffer.concat(chunks)),
    /경제 뉴스 문서/,
  );
});
