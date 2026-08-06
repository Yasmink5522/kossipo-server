import { Router } from 'express';
import { z } from 'zod';
import { CashMovementType } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/async-handler';
import { HttpError } from '../../utils/http-error';
import { logAction } from '../audit/audit.service';
import { emit } from '../../realtime/socket';
import { EVENTS, ROOMS } from '../../realtime/events';

export const cashRouter = Router();

/** Espèces théoriques en tiroir : fond + encaissements espèces + entrées − sorties. */
async function expectedCash(sessionId: string): Promise<number> {
  const session = await prisma.cashSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: {
      payments: { where: { method: 'ESPECES' } },
      movements: true,
    },
  });
  const especes = session.payments.reduce((s, p) => s + p.amount, 0);
  const entrees = session.movements.filter((m) => m.type === 'ENTREE').reduce((s, m) => s + m.amount, 0);
  const sorties = session.movements.filter((m) => m.type === 'SORTIE').reduce((s, m) => s + m.amount, 0);
  return session.openingFloat + especes + entrees - sorties;
}

/** Session en cours du caissier connecté. */
cashRouter.get(
  '/session',
  authenticate,
  requirePermission('cash:read'),
  asyncHandler(async (req, res) => {
    const session = await prisma.cashSession.findFirst({
      where: { userId: req.auth!.sub, status: 'OUVERTE' },
      include: { movements: { orderBy: { createdAt: 'desc' } } },
    });
    if (!session) return res.json(null);
    return res.json({ ...session, especesTheoriques: await expectedCash(session.id) });
  }),
);

cashRouter.post(
  '/ouvrir',
  authenticate,
  requirePermission('cash:open'),
  validate(z.object({ fondDeCaisse: z.number().int().min(0), note: z.string().max(200).optional() })),
  asyncHandler(async (req, res) => {
    const existing = await prisma.cashSession.findFirst({
      where: { userId: req.auth!.sub, status: 'OUVERTE' },
    });
    if (existing) throw HttpError.conflict('Une caisse est déjà ouverte pour ce compte');

    const session = await prisma.cashSession.create({
      data: {
        userId: req.auth!.sub,
        openingFloat: req.body.fondDeCaisse,
        note: req.body.note ?? null,
      },
    });
    await logAction(req, 'OUVERTURE_CAISSE', 'CashSession', session.id, {
      fond: req.body.fondDeCaisse,
    });
    emit(EVENTS.CASH_OPENED, { session, caissier: req.auth!.fullName }, [ROOMS.ADMIN]);
    res.status(201).json(session);
  }),
);

cashRouter.post(
  '/fermer',
  authenticate,
  requirePermission('cash:close'),
  validate(z.object({ especesComptees: z.number().int().min(0), note: z.string().max(300).optional() })),
  asyncHandler(async (req, res) => {
    const session = await prisma.cashSession.findFirst({
      where: { userId: req.auth!.sub, status: 'OUVERTE' },
    });
    if (!session) throw HttpError.badRequest('Aucune caisse ouverte');

    const encours = await prisma.order.count({
      where: { cashSessionId: session.id, status: { in: ['OUVERTE', 'ENVOYEE', 'EN_PREPARATION', 'SERVIE'] } },
    });
    if (encours > 0) {
      throw HttpError.badRequest(`${encours} commande(s) encore ouverte(s) : réglez-les avant la fermeture`);
    }

    const attendu = await expectedCash(session.id);
    const closed = await prisma.cashSession.update({
      where: { id: session.id },
      data: {
        status: 'FERMEE',
        closedAt: new Date(),
        countedCash: req.body.especesComptees,
        expectedCash: attendu,
        difference: req.body.especesComptees - attendu,
        note: req.body.note ?? session.note,
      },
    });

    await logAction(req, 'FERMETURE_CAISSE', 'CashSession', closed.id, {
      attendu,
      compte: req.body.especesComptees,
      ecart: closed.difference,
    });
    emit(EVENTS.CASH_CLOSED, { session: closed, caissier: req.auth!.fullName }, [ROOMS.ADMIN]);
    res.json(closed);
  }),
);

cashRouter.post(
  '/mouvement',
  authenticate,
  requirePermission('cash:read'),
  validate(
    z.object({
      type: z.nativeEnum(CashMovementType),
      amount: z.number().int().min(1),
      reason: z.string().min(3, 'Motif obligatoire'),
    }),
  ),
  asyncHandler(async (req, res) => {
    const session = await prisma.cashSession.findFirst({
      where: { userId: req.auth!.sub, status: 'OUVERTE' },
    });
    if (!session) throw HttpError.badRequest('Aucune caisse ouverte');

    const movement = await prisma.cashMovement.create({
      data: { ...req.body, sessionId: session.id, userId: req.auth!.sub },
    });
    await logAction(req, 'MOUVEMENT_CAISSE', 'CashMovement', movement.id, req.body);
    res.status(201).json(movement);
  }),
);

/** Journal de caisse détaillé d'une session (rapport Z). */
cashRouter.get(
  '/session/:id/journal',
  authenticate,
  requirePermission('cash:read'),
  asyncHandler(async (req, res) => {
    const session = await prisma.cashSession.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { fullName: true } },
        movements: { orderBy: { createdAt: 'asc' } },
        payments: {
          orderBy: { createdAt: 'asc' },
          include: { order: { select: { number: true, zone: { select: { name: true } } } } },
        },
      },
    });
    if (!session) throw HttpError.notFound('Session de caisse introuvable');

    const parMoyen = session.payments.reduce<Record<string, number>>((acc, p) => {
      acc[p.method] = (acc[p.method] ?? 0) + p.amount;
      return acc;
    }, {});

    const nbCommandes = await prisma.order.count({
      where: { cashSessionId: session.id, status: 'PAYEE' },
    });

    res.json({
      session: {
        id: session.id,
        caissier: session.user.fullName,
        ouverteLe: session.openedAt,
        fermeeLe: session.closedAt,
        statut: session.status,
        fondDeCaisse: session.openingFloat,
        especesComptees: session.countedCash,
        especesTheoriques: session.status === 'FERMEE' ? session.expectedCash : await expectedCash(session.id),
        ecart: session.difference,
      },
      totaux: {
        encaisse: session.payments.reduce((s, p) => s + p.amount, 0),
        parMoyen,
        nombreCommandes: nbCommandes,
        nombreReglements: session.payments.length,
      },
      mouvements: session.movements,
      reglements: session.payments,
    });
  }),
);

cashRouter.get(
  '/sessions',
  authenticate,
  requirePermission('cash:read'),
  asyncHandler(async (req, res) => {
    const from = typeof req.query.from === 'string' ? new Date(req.query.from) : undefined;
    res.json(
      await prisma.cashSession.findMany({
        where: from ? { openedAt: { gte: from } } : {},
        include: { user: { select: { fullName: true } } },
        orderBy: { openedAt: 'desc' },
        take: 100,
      }),
    );
  }),
);
