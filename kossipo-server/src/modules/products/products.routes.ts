import { Router } from 'express';
import { z } from 'zod';
import { Destination } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/async-handler';
import { HttpError } from '../../utils/http-error';
import { logAction } from '../audit/audit.service';

export const productsRouter = Router();

/**
 * Carte d'une zone : uniquement les produits disponibles, avec le prix
 * applicable à cette zone. C'est l'appel que fait la caisse au démarrage.
 */
productsRouter.get(
  '/carte/:zoneId',
  authenticate,
  requirePermission('product:read'),
  asyncHandler(async (req, res) => {
    const zone = await prisma.zone.findUnique({ where: { id: req.params.zoneId } });
    if (!zone) throw HttpError.notFound('Zone inconnue');

    const categories = await prisma.category.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        products: {
          where: { active: true, prices: { some: { zoneId: zone.id, available: true } } },
          orderBy: { sortOrder: 'asc' },
          include: { prices: { where: { zoneId: zone.id } } },
        },
      },
    });

    res.json({
      zone: { id: zone.id, code: zone.code, nom: zone.name, boissonPrixLibre: zone.freeDrinkPrice },
      categories: categories
        .map((c) => ({
          id: c.id,
          nom: c.name,
          destination: c.destination,
          couleur: c.color,
          produits: c.products.map((p) => ({
            id: p.id,
            nom: p.name,
            prix: p.prices[0]?.price ?? 0,
            prixLibre: p.prices[0]?.freePrice ?? false,
            destination: c.destination,
            categorieId: c.id,
          })),
        }))
        .filter((c) => c.produits.length > 0),
    });
  }),
);

productsRouter.get(
  '/',
  authenticate,
  requirePermission('product:read'),
  asyncHandler(async (_req, res) => {
    res.json(
      await prisma.product.findMany({
        orderBy: [{ categoryId: 'asc' }, { sortOrder: 'asc' }],
        include: { category: true, prices: { include: { zone: true } } },
      }),
    );
  }),
);

productsRouter.get(
  '/categories',
  authenticate,
  requirePermission('product:read'),
  asyncHandler(async (_req, res) => {
    res.json(await prisma.category.findMany({ orderBy: { sortOrder: 'asc' } }));
  }),
);

const productSchema = z.object({
  name: z.string().min(2),
  categoryId: z.string().uuid(),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
  prices: z
    .array(
      z.object({
        zoneId: z.string().uuid(),
        price: z.number().int().min(0),
        available: z.boolean().default(true),
        freePrice: z.boolean().default(false),
      }),
    )
    .min(1, 'Au moins un prix de zone est requis'),
});

productsRouter.post(
  '/',
  authenticate,
  requirePermission('product:write'),
  validate(productSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof productSchema>;
    const product = await prisma.product.create({
      data: {
        name: body.name,
        categoryId: body.categoryId,
        sortOrder: body.sortOrder,
        active: body.active,
        prices: { create: body.prices },
      },
      include: { prices: true },
    });
    await logAction(req, 'CREATION_PRODUIT', 'Product', product.id, { nom: product.name });
    res.status(201).json(product);
  }),
);

productsRouter.patch(
  '/:id',
  authenticate,
  requirePermission('product:write'),
  validate(productSchema.partial()),
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<z.infer<typeof productSchema>>;
    const product = await prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id: req.params.id },
        data: {
          ...(body.name ? { name: body.name } : {}),
          ...(body.categoryId ? { categoryId: body.categoryId } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
        },
      });
      if (body.prices) {
        for (const price of body.prices) {
          await tx.productPrice.upsert({
            where: { productId_zoneId: { productId: updated.id, zoneId: price.zoneId } },
            create: { ...price, productId: updated.id },
            update: { price: price.price, available: price.available, freePrice: price.freePrice },
          });
        }
      }
      return tx.product.findUnique({ where: { id: updated.id }, include: { prices: true } });
    });
    await logAction(req, 'MODIFICATION_PRODUIT', 'Product', req.params.id, body);
    res.json(product);
  }),
);

productsRouter.delete(
  '/:id',
  authenticate,
  requirePermission('product:write'),
  asyncHandler(async (req, res) => {
    await prisma.product.update({ where: { id: req.params.id }, data: { active: false } });
    await logAction(req, 'DESACTIVATION_PRODUIT', 'Product', req.params.id);
    res.json({ message: 'Produit retiré de la carte' });
  }),
);

const categorySchema = z.object({
  name: z.string().min(2),
  destination: z.nativeEnum(Destination).default(Destination.KITCHEN),
  sortOrder: z.number().int().default(0),
  color: z.string().default('#2F9E8F'),
});

productsRouter.post(
  '/categories',
  authenticate,
  requirePermission('product:write'),
  validate(categorySchema),
  asyncHandler(async (req, res) => {
    const category = await prisma.category.create({ data: req.body });
    await logAction(req, 'CREATION_CATEGORIE', 'Category', category.id);
    res.status(201).json(category);
  }),
);
