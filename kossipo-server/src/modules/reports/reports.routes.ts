import { Router } from 'express';
import { prisma } from '../../config/prisma';
import { authenticate, requirePermission } from '../../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';
import { dayRange, rangeFromQuery, addDays } from '../../utils/dates';
import { lowStockItems, stockValuation } from '../stock/stock.service';
import { connectedUsers } from '../../realtime/socket';

export const reportsRouter = Router();

/** Tableau de bord temps réel de la journée. */
reportsRouter.get(
  '/tableau-de-bord',
  authenticate,
  requirePermission('report:read'),
  asyncHandler(async (_req, res) => {
    const { start, end } = dayRange();

    const [payees, ouvertes, alertes, valorisation] = await Promise.all([
      prisma.order.findMany({
        where: { status: 'PAYEE', closedAt: { gte: start, lte: end } },
        include: { zone: { select: { code: true, name: true } }, items: true },
      }),
      prisma.order.count({
        where: { status: { in: ['OUVERTE', 'ENVOYEE', 'EN_PREPARATION', 'SERVIE'] } },
      }),
      lowStockItems(),
      stockValuation(),
    ]);

    const chiffreAffaires = payees.reduce((s, o) => s + o.total, 0);
    const couverts = payees.reduce((s, o) => s + o.guests, 0);

    const parZone = new Map<string, { zone: string; total: number; tickets: number }>();
    for (const order of payees) {
      const entry = parZone.get(order.zone.code) ?? { zone: order.zone.name, total: 0, tickets: 0 };
      entry.total += order.total;
      entry.tickets += 1;
      parZone.set(order.zone.code, entry);
    }

    const produits = new Map<string, { nom: string; quantite: number; total: number }>();
    for (const order of payees) {
      for (const item of order.items.filter((i) => i.status !== 'ANNULE')) {
        const entry = produits.get(item.productId) ?? { nom: item.name, quantite: 0, total: 0 };
        entry.quantite += item.quantity;
        entry.total += item.total;
        produits.set(item.productId, entry);
      }
    }

    const reglements = await prisma.payment.groupBy({
      by: ['method'],
      where: { createdAt: { gte: start, lte: end } },
      _sum: { amount: true },
      _count: true,
    });

    // Évolution horaire de la journée (service du midi et du soir).
    const parHeure = Array.from({ length: 24 }, (_, h) => ({ heure: h, total: 0 }));
    for (const order of payees) {
      if (order.closedAt) parHeure[order.closedAt.getHours()].total += order.total;
    }

    res.json({
      journee: start.toISOString().slice(0, 10),
      chiffreAffaires,
      nombreTickets: payees.length,
      nombreClients: couverts,
      ticketMoyen: payees.length ? Math.round(chiffreAffaires / payees.length) : 0,
      commandesOuvertes: ouvertes,
      ventesParZone: Array.from(parZone.values()),
      meilleuresVentes: Array.from(produits.values())
        .sort((a, b) => b.quantite - a.quantite)
        .slice(0, 10),
      reglements: reglements.map((r) => ({
        moyen: r.method,
        montant: r._sum.amount ?? 0,
        nombre: r._count,
      })),
      evolutionHoraire: parHeure,
      stockCritique: alertes.map((i) => ({
        nom: i.name,
        quantite: i.quantity,
        seuil: i.minQuantity,
        unite: i.unit,
      })),
      valorisationStock: valorisation.total,
      employesConnectes: connectedUsers(),
    });
  }),
);

/** Évolution du chiffre d'affaires : jour, semaine, mois ou année. */
reportsRouter.get(
  '/evolution',
  authenticate,
  requirePermission('report:read'),
  asyncHandler(async (req, res) => {
    const periode = String(req.query.periode ?? 'jour');
    const now = new Date();

    const buckets: { libelle: string; debut: Date; fin: Date }[] = [];
    if (periode === 'jour') {
      for (let i = 13; i >= 0; i--) {
        const d = addDays(now, -i);
        const { start, end } = dayRange(d);
        buckets.push({ libelle: start.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }), debut: start, fin: end });
      }
    } else if (periode === 'semaine') {
      for (let i = 11; i >= 0; i--) {
        const end = dayRange(addDays(now, -i * 7)).end;
        const start = dayRange(addDays(end, -6)).start;
        buckets.push({ libelle: `S-${i}`, debut: start, fin: end });
      }
    } else if (periode === 'mois') {
      for (let i = 11; i >= 0; i--) {
        const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
        buckets.push({ libelle: start.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }), debut: start, fin: end });
      }
    } else {
      for (let i = 4; i >= 0; i--) {
        const year = now.getFullYear() - i;
        buckets.push({
          libelle: String(year),
          debut: new Date(year, 0, 1),
          fin: new Date(year, 11, 31, 23, 59, 59, 999),
        });
      }
    }

    const points = [];
    for (const bucket of buckets) {
      const agg = await prisma.order.aggregate({
        where: { status: 'PAYEE', closedAt: { gte: bucket.debut, lte: bucket.fin } },
        _sum: { total: true },
        _count: true,
      });
      points.push({
        libelle: bucket.libelle,
        chiffreAffaires: agg._sum.total ?? 0,
        tickets: agg._count,
      });
    }

    res.json({ periode, points });
  }),
);

/** Rapport de ventes détaillé sur une période. */
reportsRouter.get(
  '/ventes',
  authenticate,
  requirePermission('report:read'),
  asyncHandler(async (req, res) => {
    const { start, end } = rangeFromQuery(req.query.from as string, req.query.to as string);

    const orders = await prisma.order.findMany({
      where: { status: 'PAYEE', closedAt: { gte: start, lte: end } },
      include: {
        items: true,
        zone: { select: { name: true } },
        user: { select: { fullName: true } },
        payments: true,
      },
      orderBy: { closedAt: 'desc' },
    });

    const chiffreAffaires = orders.reduce((s, o) => s + o.total, 0);
    const remises = orders.reduce((s, o) => s + o.discount, 0);

    const parCaissier = new Map<string, { caissier: string; total: number; tickets: number }>();
    const parCategorie = new Map<string, number>();

    const categories = await prisma.category.findMany({ include: { products: { select: { id: true } } } });
    const categoryOfProduct = new Map<string, string>();
    categories.forEach((c) => c.products.forEach((p) => categoryOfProduct.set(p.id, c.name)));

    for (const order of orders) {
      const entry = parCaissier.get(order.userId) ?? { caissier: order.user.fullName, total: 0, tickets: 0 };
      entry.total += order.total;
      entry.tickets += 1;
      parCaissier.set(order.userId, entry);

      for (const item of order.items.filter((i) => i.status !== 'ANNULE')) {
        const cat = categoryOfProduct.get(item.productId) ?? 'Autres';
        parCategorie.set(cat, (parCategorie.get(cat) ?? 0) + item.total);
      }
    }

    // Coût matière estimé à partir des fiches techniques (marge brute).
    const recipes = await prisma.recipeLine.findMany({ include: { stockItem: true } });
    let coutMatiere = 0;
    for (const order of orders) {
      for (const item of order.items.filter((i) => i.status !== 'ANNULE')) {
        for (const line of recipes.filter((r) => r.productId === item.productId)) {
          coutMatiere += line.quantity * item.quantity * line.stockItem.unitCost;
        }
      }
    }

    res.json({
      periode: { du: start, au: end },
      chiffreAffaires,
      remises,
      nombreTickets: orders.length,
      ticketMoyen: orders.length ? Math.round(chiffreAffaires / orders.length) : 0,
      coutMatiere: Math.round(coutMatiere),
      margeBrute: Math.round(chiffreAffaires - coutMatiere),
      tauxMarge: chiffreAffaires ? Number((((chiffreAffaires - coutMatiere) / chiffreAffaires) * 100).toFixed(1)) : 0,
      parCaissier: Array.from(parCaissier.values()).sort((a, b) => b.total - a.total),
      parCategorie: Array.from(parCategorie, ([categorie, total]) => ({ categorie, total })).sort(
        (a, b) => b.total - a.total,
      ),
      commandes: orders.map((o) => ({
        id: o.id,
        numero: o.number,
        zone: o.zone.name,
        caissier: o.user.fullName,
        total: o.total,
        couverts: o.guests,
        cloturee: o.closedAt,
        moyens: o.payments.map((p) => p.method),
      })),
    });
  }),
);
