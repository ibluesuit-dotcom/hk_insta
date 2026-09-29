import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Project, migrateCover } from "../shared/model";
export const root = path.resolve(process.env.DATA_DIR || "data");
export async function initStore() {
  await Promise.all(
    ["projects", "uploads", "renders", "ai-backgrounds"].map((x) =>
      fs.mkdir(path.join(root, x), { recursive: true }),
    ),
  );
}
export function safeId(id: string) {
  if (!/^[\w-]+$/.test(id)) throw new Error("잘못된 작업 ID");
  return id;
}
const file = (id: string) => path.join(root, "projects", safeId(id) + ".json");
export async function read(id: string): Promise<{
  current: Project;
  versions: { project: Project; label: string }[];
}> {
  const data = JSON.parse(await fs.readFile(file(id), "utf8"));
  data.current = migrateCover(data.current);
  data.versions.forEach((v: { project: Project }) => migrateCover(v.project));
  return data;
}
export async function save(p: Project, expected: number, label = "자동 저장") {
  let old;
  try {
    old = await read(p.id);
  } catch (error: any) {
    // Only a missing file means a new project; anything else would overwrite history.
    if (error?.code !== "ENOENT")
      throw Object.assign(
        new Error(
          "저장된 작업 파일을 읽지 못해 저장을 중단했습니다. 기존 기록을 보호하기 위해 덮어쓰지 않았습니다.",
        ),
        { code: "CORRUPT", status: 500 },
      );
  }
  if (old && old.current.revision !== expected)
    throw Object.assign(
      new Error(
        "다른 창의 변경과 충돌했습니다. 작성 내용은 이 창에 유지됩니다. 로컬 초안을 보관한 뒤 최신 작업과 비교하세요.",
      ),
      { code: "CONFLICT", status: 409 },
    );
  // Every following card gets a stable ID the first time it is saved.
  p = {
    ...p,
    copy: {
      ...p.copy,
      pages: p.copy.pages.map((page) =>
        page.id ? page : { ...page, id: randomUUID().slice(0, 8) },
      ),
    },
    revision: (old?.current.revision || 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  const versions = old?.versions || [];
  if (old) versions.push({ project: old.current, label });
  const tmp = file(p.id) + ".tmp";
  await fs.writeFile(tmp, JSON.stringify({ current: p, versions }));
  await fs.rename(tmp, file(p.id));
  return p;
}
// Single-process serialized mutations avoid check/write races, including delayed AI results.
let queue = Promise.resolve();
export function mutate<T>(fn: () => Promise<T>): Promise<T> {
  const task = queue.then(fn);
  queue = task.then(
    () => {},
    () => {},
  );
  return task;
}
export async function list() {
  const files = await fs.readdir(path.join(root, "projects"));
  return Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map(async (f) => (await read(f.slice(0, -5))).current),
  );
}
