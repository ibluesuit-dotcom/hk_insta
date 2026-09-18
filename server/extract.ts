import dns from "node:dns/promises";
import https from "node:https";
import http from "node:http";
import ipaddr from "ipaddr.js";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import yauzl from "yauzl";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
export const limit = 10 * 1024 * 1024;
export function publicAddress(address: string) {
  try {
    let ip = ipaddr.parse(address);
    if (ip.kind() === "ipv6" && (ip as ipaddr.IPv6).isIPv4MappedAddress())
      ip = (ip as ipaddr.IPv6).toIPv4Address();
    return ip.range() === "unicast";
  } catch {
    return false;
  }
}
export async function fetchArticle(
  raw: string,
  redirects = 0,
): Promise<{
  text: string;
  title: string;
  subtitle: string;
  publishedAt: string;
  url: string;
}> {
  const url = new URL(raw);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw new Error("공개 HTTP/HTTPS 기사 URL만 지원합니다.");
  const addresses = await Promise.race([
    dns.lookup(url.hostname, { all: true }),
    new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error("DNS 확인 시간이 초과되었습니다.")),
        8000,
      );
      timer.unref();
    }),
  ]);
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new Error("내부·로컬 주소는 불러올 수 없습니다.");
  const address = addresses[0];
  const response = await new Promise<{
    status: number;
    location?: string;
    type: string;
    body: Buffer;
  }>((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).get(
      url,
      {
        lookup: ((_host: any, opts: any, cb: any) =>
          opts?.all
            ? cb(null, [address])
            : cb(null, address.address, address.family)) as any,
        headers: { "User-Agent": "LocalNewsCard/1.0", Accept: "text/html" },
        timeout: 12000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) {
            req.destroy(new Error("기사 용량이 2MB 제한을 넘었습니다."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode || 0,
            location: res.headers.location,
            type: res.headers["content-type"] || "",
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("timeout", () =>
      req.destroy(new Error("기사 요청 시간이 초과되었습니다.")),
    );
    const deadline = setTimeout(
      () => req.destroy(new Error("기사 요청 시간이 초과되었습니다.")),
      15000,
    );
    req.on("close", () => clearTimeout(deadline));
    req.on("error", reject);
  });
  if (response.status >= 300 && response.status < 400 && response.location) {
    if (redirects >= 3) throw new Error("리다이렉트가 너무 많습니다.");
    return fetchArticle(new URL(response.location, url).href, redirects + 1);
  }
  if (response.status !== 200 || !response.type.includes("text/html"))
    throw new Error("기사 HTML을 받지 못했습니다. 본문을 붙여넣어 주세요.");
  const dom = new JSDOM(response.body.toString("utf8"), { url: url.href });
  const doc = dom.window.document;
  const subtitle =
    doc.querySelector('meta[name="subtitle"]')?.getAttribute("content") || "";
  const publishedAt =
    doc
      .querySelector('meta[property="article:published_time"]')
      ?.getAttribute("content") || "";
  const article = new Readability(doc).parse();
  if (!article?.textContent || article.textContent.trim().length < 30)
    throw new Error("본문 추출 실패: 기사 본문을 직접 붙여넣어 주세요.");
  return {
    text: article.textContent.trim().slice(0, 60000),
    title: article.title || "",
    subtitle,
    publishedAt,
    url: url.href,
  };
}
export async function extractFile(name: string, buffer: Buffer) {
  if (buffer.length > limit) throw new Error("파일은 10MB 이하여야 합니다.");
  const ext = name.split(".").pop()?.toLowerCase();
  let text = "";
  if (ext === "txt" || ext === "md") {
    if (buffer.includes(0)) throw new Error("텍스트 파일 형식이 아닙니다.");
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      throw new Error(
        "UTF-8 텍스트 파일이 아닙니다. UTF-8로 변환하거나 내용을 붙여넣으세요.",
      );
    }
  } else if (ext === "docx") {
    if (buffer.readUInt16LE(0) !== 0x4b50)
      throw new Error("올바른 DOCX 파일이 아닙니다.");
    await checkDocxArchive(buffer);
    text = (await mammoth.extractRawText({ buffer })).value;
  } else if (ext === "pdf") {
    if (buffer.subarray(0, 5).toString() !== "%PDF-")
      throw new Error("올바른 PDF 파일이 아닙니다.");
    const parser = new PDFParse({ data: buffer });
    try {
      const info = await parser.getInfo();
      if (info.total > 100)
        throw new Error("PDF는 100페이지 이내로 나누어 주세요.");
      text = (await parser.getText({ pageJoiner: "\n\n" })).text;
    } finally {
      await parser.destroy();
    }
  } else throw new Error("TXT, MD, DOCX, PDF 파일만 지원합니다.");
  if (text.trim().length < 10)
    throw new Error(
      "추출 가능한 텍스트가 없습니다. 스캔 PDF는 OCR 후 붙여넣어 주세요.",
    );
  if (text.length > 60000)
    throw new Error("추출 문서는 60,000자 이내여야 합니다.");
  return text.trim();
}

async function checkDocxArchive(buffer: Buffer) {
  await new Promise<void>((resolve, reject) =>
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err || !zip)
        return reject(new Error("DOCX 압축 구조를 확인할 수 없습니다."));
      let bytes = 0,
        entries = 0;
      zip.on("entry", (entry) => {
        bytes += entry.uncompressedSize;
        entries++;
        if (bytes > 25 * 1024 * 1024 || entries > 1000) {
          zip.close();
          reject(new Error("DOCX 압축 해제 용량 제한(25MB)을 초과했습니다."));
        } else zip.readEntry();
      });
      zip.on("error", reject);
      zip.on("end", resolve);
      zip.readEntry();
    }),
  );
}
