import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { HttpError } from '../utils/http-error';
import { env } from '../config/env';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(HttpError.notFound(`Route inconnue : ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ erreur: err.message, code: err.code, details: err.details });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({ erreur: 'Cet enregistrement existe déjà', code: 'DOUBLON' });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ erreur: 'Élément introuvable', code: 'INTROUVABLE' });
      return;
    }
  }

  console.error('[erreur]', err);
  res.status(500).json({
    erreur: 'Erreur interne du serveur',
    code: 'ERREUR_SERVEUR',
    details: env.isProd ? undefined : String(err),
  });
}
