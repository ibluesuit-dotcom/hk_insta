import type {
  ErrorRequestHandler,
  Request,
  RequestHandler,
  Response,
} from "express";
import { z } from "zod";
import { Project, projectSchema, migrateCover } from "../shared/model";

// Forward async handler rejections to the error handler.
type Params = Record<string, string>;
export const wrap =
  (
    fn: (req: Request<Params>, res: Response) => unknown,
  ): RequestHandler<Params> =>
  (req, res, next) =>
    Promise.resolve(fn(req, res)).catch(next);

export function validateProject(body: unknown): Project {
  return migrateCover(projectSchema.parse(body));
}

export const errorHandler: ErrorRequestHandler = (
  error: any,
  _req,
  res,
  _next,
) =>
  res.status(error.code === "ENOENT" ? 404 : error.status || 400).json({
    code: error.code || "INPUT",
    message:
      error instanceof z.ZodError
        ? "입력 형식이 올바르지 않습니다. 문안·본문 장수·잠금·사진·폰트(54~60px)를 확인하세요."
        : error.code === "ENOENT"
          ? "작업 또는 파일을 찾을 수 없습니다. 보관함을 확인하세요."
          : error.code === "LIMIT_FILE_SIZE"
            ? "파일 용량 제한을 초과했습니다 (원문 10MB, 사진 25MB)."
            : typeof error.message === "string" &&
                /[가-힣]/.test(error.message) &&
                !/\/(Users|home|private|tmp)\//.test(error.message)
              ? error.message
              : "처리하지 못했습니다. 입력 파일과 설정을 확인하고 다시 시도하세요.",
  });
