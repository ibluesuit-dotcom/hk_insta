import { test, expect } from "./auth-fixture";
import fs from "node:fs/promises";
import yauzl from "yauzl";

const article =
  "산업통상자원부는 9월 1일 지난달 수출이 전년 동기 대비 증가했다고 밝혔다. 자동차와 반도체 수출이 증가세를 이끌었다. 이번 집계는 잠정치이며 품목별 확정 수치는 추후 발표할 예정이다.";
async function zipEntries(bytes: Buffer): Promise<Record<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      const entries: Record<string, Buffer> = {};
      zip.on("end", () => resolve(entries));
      zip.on("entry", (entry) =>
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return reject(error);
          const chunks: Buffer[] = [];
          stream.on("data", (c) => chunks.push(c));
          stream.on("end", () => {
            entries[entry.fileName] = Buffer.concat(chunks);
            zip.readEntry();
          });
        }),
      );
      zip.readEntry();
    });
  });
}

test("mixed text/photo cards: AI writes text cards only, render and ZIP follow kinds", async ({
  request,
}) => {
  const upload = async () =>
    (
      await (
        await request.post("/api/photos", {
          multipart: {
            file: {
              name: "p.jpg",
              mimeType: "image/jpeg",
              buffer: await fs.readFile(
                "design_handoff_news_card_fullbleed/PYH2026090110410005100.jpg",
              ),
            },
          },
        })
      ).json()
    ).url;
  let p = await (await request.post("/api/projects")).json();
  const put = async (change: (p: any) => void) => {
    change(p);
    const r = await request.put("/api/projects/" + p.id, { data: p });
    expect(r.ok(), await r.text()).toBe(true);
    p = await r.json();
  };
  const cardPhoto = await upload();
  await put((p) => {
    p.source = article;
    p.sourceTitle = "지난달 수출 증가";
    p.photo = cardPhoto;
    p.count = 3;
    p.copy.pages = [0, 1, 2].map((i) => ({
      role: "",
      title: "",
      body: "",
      highlight: "",
      evidence: [],
      alt: "",
      ...(i === 1
        ? {
            kind: "photo",
            photoCard: {
              photo: cardPhoto,
              fit: "cover",
              focal: { x: 40, y: 50, zoom: 1.2 },
              text: "수출 현장",
              textVisible: true,
              credit: "연합뉴스",
              alt: "수출 선적 부두",
            },
          }
        : {}),
    }));
  });

  // A photo card is refused before any AI call.
  const refused = await request.post(`/api/projects/${p.id}/generate`, {
    data: { revision: p.revision, scope: "page:1" },
  });
  expect(refused.ok()).toBe(false);
  expect((await refused.json()).message).toContain("사진 카드");

  const generated = await request.post(`/api/projects/${p.id}/generate`, {
    data: { revision: p.revision, scope: "all" },
  });
  expect(generated.ok(), await generated.text()).toBe(true);
  p = await generated.json();
  expect(p.copy.pages[0].title).toBe("변화의 흐름 1");
  expect(p.copy.pages[2].title).toBe("변화의 흐름 2");
  expect(p.copy.pages[1]).toMatchObject({
    kind: "photo",
    title: "",
    photoCard: { text: "수출 현장", alt: "수출 선적 부두" },
  });

  const rendered = await request.post(`/api/projects/${p.id}/render`, {
    data: { revision: p.revision },
  });
  expect(rendered.ok(), await rendered.text()).toBe(true);
  p = await rendered.json();
  expect(p.renders).toHaveLength(4);
  const zip = await zipEntries(
    await (await request.get(`/api/projects/${p.id}/download`)).body(),
  );
  expect(Object.keys(zip).filter((n) => n.endsWith(".png"))).toEqual([
    "01-cover.png",
    "02-body.png",
    "03-photo.png",
    "04-body.png",
  ]);
  expect(zip["alt-text.txt"].toString()).toContain("03: 수출 선적 부두");
  expect(JSON.parse(zip["manifest.json"].toString()).cards[2]).toEqual({
    order: 3,
    kind: "photo",
  });

  // Every card has a stable ID; editing text keeps the (stale) images, while
  // moving two text cards drops them so neither shows the other's image.
  expect(new Set(p.copy.pages.map((pg: any) => pg.id)).size).toBe(3);
  const images = p.renders;
  await put((p) => {
    p.copy.pages[0].title = "고친 제목";
  });
  expect(p.renders).toEqual(images);
  await put((p) => {
    [p.copy.pages[0], p.copy.pages[2]] = [p.copy.pages[2], p.copy.pages[0]];
  });
  expect(p.renders).toEqual([images[0]]);
  const again = await request.post(`/api/projects/${p.id}/render`, {
    data: { revision: p.revision },
  });
  expect(again.ok(), await again.text()).toBe(true);
  p = await again.json();

  // Changing a card's kind or photo drops the old images, except the cover.
  const before = p.renders[0];
  await put((p) => {
    p.copy.pages[2].kind = "photo";
    p.copy.pages[2].photoCard = { ...p.copy.pages[1].photoCard };
  });
  expect(p.renders).toEqual([before]);
  await put((p) => {
    p.copy.pages[2].kind = "text";
  });

  // A long unbroken string wraps inside the card instead of being cut
  // sideways; wide text that needs a fourth line is reported.
  await put((p) => {
    p.copy.pages[1].photoCard.text = "https://example.com/" + "a".repeat(80);
  });
  const wrapped = await request.post(`/api/projects/${p.id}/render`, {
    data: { revision: p.revision, only: 2 },
  });
  expect(wrapped.ok(), await wrapped.text()).toBe(true);
  p = await wrapped.json();
  await put((p) => {
    p.copy.pages[1].photoCard.text = "Ｗ".repeat(100);
  });
  const wide = await request.post(`/api/projects/${p.id}/render`, {
    data: { revision: p.revision, only: 2 },
  });
  expect(wide.ok()).toBe(false);
  expect((await wide.json()).message).toContain("3줄");

  // A photo caption over 3 lines is reported, never cut.
  await put((p) => {
    p.copy.pages[1].photoCard.text = "가\n나\n다\n라";
  });
  const overflow = await request.post(`/api/projects/${p.id}/render`, {
    data: { revision: p.revision },
  });
  expect(overflow.ok()).toBe(false);
  expect((await overflow.json()).message).toContain("3줄");
});
