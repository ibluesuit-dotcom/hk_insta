import express from "express";
import { blank, profileOnlyChange } from "../../shared/model";
import { list, read, save, mutate } from "../store";
import { wrap, validateProject } from "../http";

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
        const old = (await read(req.params.id)).current;
        const input = validateProject(req.body);
        const displayOnly = profileOnlyChange(old, input);
        const p = {
          ...input,
          id: old.id,
          versions: old.versions,
          renders: old.renders,
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
