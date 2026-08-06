import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import { HttpError } from '../utils/http-error';

type Source = 'body' | 'query' | 'params';

/** Valide et normalise une partie de la requête via un schéma Zod. */
export function validate(schema: ZodSchema, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse(req[source]);
      if (source === 'body') req.body = parsed;
      else Object.assign(req[source], parsed);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.issues.map((i) => ({ champ: i.path.join('.'), message: i.message }));
        return next(HttpError.badRequest('Données invalides', details));
      }
      next(error);
    }
  };
}
