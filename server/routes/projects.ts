import express from "express";
import {
  blank,
  isPhotoPage,
  profileOnlyChange,
  type Project,
} from "../../shared/model";
import { mergePostText } from "../../shared/post-text";
import { list, read, save, mutate } from "../store";
import { wrap, validateProject } from "../http";
import { aiAssetIdOf, backgroundFromSidecar } from "../../shared/ai-background";
import { assetUsableBy, foreignAsset, loadSidecar } from "../ai-background";

const cardKey = (pg: Project["copy"]["pages"][number]) =>
  JSON.stringify([
    pg.id ?? "",
    isPhotoPage(pg) ? "photo" : "text",
    isPhotoPage(pg) ? pg.photoCard?.photo : "",
  ]);
/**
 * Images kept after a save: the cover's, and each card's while the same card
 * (ID, kind, photo) stays at the same place. A card that was added, moved,
 * changed kind or got another photo loses only its own image, so an old
 * image never previews under another card and the others stay visible.
 */
function keptRenders(old: Project, input: Project) {
  if (!old.renders.length) return old.renders;
  return [
    old.renders[0] ?? "",
    ...input.copy.pages.map((pg, i) => {
      const before = old.copy.pages[i];
      return pg.id && before && cardKey(before) === cardKey(pg)
        ? (old.renders[i + 1] ?? "")
        : "";
    }),
  ];
}
// Project CRUD and version history.
export const projectsRouter = express.Router();
projectsRouter.get(
  "/api/projects",
  wrap(async (_req, res) =>
    res.json(
      (await list()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    ),
  ),
);
projectsRouter.post(
  "/api/projects",
  wrap(async (_req, res) =>
    res.json(await mutate(() => save(blank(), 0, "새 작업"))),
  ),
);
projectsRouter.get(
  "/api/projects/:id",
  wrap(async (req, res) => {
    const d = await read(req.params.id);
    res.json({
      ...d.current,
      history: d.versions
        .map((v) => ({
          revision: v.project.revision,
          date: v.project.updatedAt,
          label: v.label,
        }))
        .reverse(),
    });
  }),
);
projectsRouter.put(
  "/api/projects/:id",
  wrap(async (req, res) =>
    res.json(
      await mutate(async () => {
        const data = await read(req.params.id);
        const old = data.current;
        // AI provenance is decided here, never taken from the client.
        const input = validateProject({ ...req.body, background: undefined });
        let background = old.background;
        const aiAssetId = aiAssetIdOf(input.photo);
        if (aiAssetId && input.photo !== old.photo) {
          const sidecar = await loadSidecar(aiAssetId);
          if (!assetUsableBy(sidecar, data)) throw foreignAsset();
          background = backgroundFromSidecar(sidecar);
        }
        const displayOnly = profileOnlyChange(old, input);
        const p = {
          ...input,
          // Review and provenance of post texts are the server's to decide.
          postText: mergePostText(old, input),
          background,
          id: old.id,
          versions: old.versions,
          renders: keptRenders(old, input),
          coverLayout: old.coverLayout,
          coverRenderRevision:
            displayOnly && old.coverRenderRevision === old.revision
              ? old.revision + 1
              : old.coverRenderRevision || 0,
          renderRevision:
            displayOnly && old.renderRevision === old.revision
              ? old.revision + 1
              : old.renderRevision,
          status: displayOnly ? old.status : "edited",
          copyApproved: displayOnly && old.copyApproved,
          imageApproved: displayOnly && old.imageApproved,
          generation: old.generation,
        };
        if (!p.background) delete p.background;
        delete p.history;
        return save(p, req.body.revision);
      }),
    ),
  ),
);
projectsRouter.post(
  "/api/projects/:id/duplicate",
  wrap(async (req, res) =>
    res.json(
      await mutate(async () => {
        const p = (await read(req.params.id)).current;
        return save(
          {
            ...p,
            id: crypto.randomUUID(),
            name: p.name + " (복사)",
            renders: [],
            renderRevision: 0,
            coverRenderRevision: 0,
            revision: 0,
            status: "edited",
            copyApproved: false,
            imageApproved: false,
          },
          0,
          "작업 복제",
        );
      }),
    ),
  ),
);
projectsRouter.post(
  "/api/projects/:id/restore",
  wrap(async (req, res) =>
    res.json(
      await mutate(async () => {
        const d = await read(req.params.id);
        const version = d.versions.find(
          (v) => v.project.revision === req.body.version,
        );
        if (!version) throw new Error("복원할 버전이 없습니다.");
        return save(
          {
            ...version.project,
            renders: [],
            renderRevision: 0,
            coverRenderRevision: 0,
            status: "edited",
            copyApproved: false,
            imageApproved: false,
          },
          req.body.revision,
          "이전 버전 복원",
        );
      }),
    ),
  ),
);
