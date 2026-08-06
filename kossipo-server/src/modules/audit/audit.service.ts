import type { Request } from 'express';
import { prisma } from '../../config/prisma';

/**
 * Journalise une action. N'échoue jamais l'appelant : un défaut de journal
 * ne doit pas bloquer une vente.
 */
export async function logAction(
  req: Request,
  action: string,
  entity: string,
  entityId?: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: req.auth?.sub ?? null,
        action,
        entity,
        entityId: entityId ?? null,
        details: details ? (details as object) : undefined,
        ip: req.ip ?? null,
      },
    });
  } catch (error) {
    console.error('[audit] journalisation impossible', error);
  }
}
