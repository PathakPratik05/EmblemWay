import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const HEADER = 'x-request-id';
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Assigns (or propagates a well-formed) request id, exposed on req.id and the response header. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(HEADER);
  const id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  (req as Request & { id: string }).id = id;
  res.setHeader(HEADER, id);
  next();
}

export function getRequestId(req: Request): string | undefined {
  return (req as Request & { id?: string }).id;
}
