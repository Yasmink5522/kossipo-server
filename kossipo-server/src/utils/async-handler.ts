import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Enveloppe un handler async et transmet toute erreur au middleware d'erreurs. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
