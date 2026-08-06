import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';

/**
 * Sauvegarde applicative au format JSON : indépendante de la version de
 * PostgreSQL et restaurable depuis n'importe quel hébergement (Render inclus,
 * où pg_dump n'est pas toujours disponible dans l'image de déploiement).
 */
export async function createBackup(kind: 'AUTO' | 'MANUEL' = 'MANUEL') {
  await fs.mkdir(env.backupDir, { recursive: true });

  const payload = {
    version: 1,
    genereLe: new Date().toISOString(),
    donnees: {
      zones: await prisma.zone.findMany(),
      tables: await prisma.restaurantTable.findMany(),
      categories: await prisma.category.findMany(),
      produits: await prisma.product.findMany(),
      prix: await prisma.productPrice.findMany(),
      utilisateurs: await prisma.user.findMany(),
      categoriesStock: await prisma.stockCategory.findMany(),
      articlesStock: await prisma.stockItem.findMany(),
      fichesTechniques: await prisma.recipeLine.findMany(),
      commandes: await prisma.order.findMany(),
      lignesCommande: await prisma.orderItem.findMany(),
      reglements: await prisma.payment.findMany(),
      sessionsCaisse: await prisma.cashSession.findMany(),
      mouvementsCaisse: await prisma.cashMovement.findMany(),
      mouvementsStock: await prisma.stockMovement.findMany(),
      parametres: await prisma.setting.findMany(),
    },
  };

  const filename = `kossipo-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const filepath = path.join(env.backupDir, filename);
  const content = JSON.stringify(payload, null, 2);
  await fs.writeFile(filepath, content, 'utf8');

  const record = await prisma.backup.create({
    data: { filename, sizeBytes: Buffer.byteLength(content), kind },
  });

  await purgeOldBackups();
  return record;
}

async function purgeOldBackups() {
  const limite = new Date();
  limite.setDate(limite.getDate() - env.backupRetentionDays);
  const anciennes = await prisma.backup.findMany({ where: { createdAt: { lt: limite } } });
  for (const backup of anciennes) {
    await fs.rm(path.join(env.backupDir, backup.filename), { force: true });
    await prisma.backup.delete({ where: { id: backup.id } });
  }
}

export async function listBackups() {
  return prisma.backup.findMany({ orderBy: { createdAt: 'desc' }, take: 60 });
}

export async function readBackup(filename: string): Promise<string> {
  return fs.readFile(path.join(env.backupDir, path.basename(filename)), 'utf8');
}

/**
 * Restaure une sauvegarde. Opération destructive : la base est vidée puis
 * réécrite dans l'ordre des dépendances, le tout dans une seule transaction.
 */
export async function restoreBackup(filename: string) {
  const raw = await readBackup(filename);
  const parsed = JSON.parse(raw) as { donnees: Record<string, unknown[]> };
  const d = parsed.donnees;

  await prisma.$transaction(
    async (tx) => {
      await tx.stockMovement.deleteMany();
      await tx.cashMovement.deleteMany();
      await tx.payment.deleteMany();
      await tx.orderItem.deleteMany();
      await tx.order.deleteMany();
      await tx.cashSession.deleteMany();
      await tx.recipeLine.deleteMany();
      await tx.stockItem.deleteMany();
      await tx.stockCategory.deleteMany();
      await tx.productPrice.deleteMany();
      await tx.product.deleteMany();
      await tx.category.deleteMany();
      await tx.restaurantTable.deleteMany();
      await tx.zone.deleteMany();
      await tx.auditLog.deleteMany();
      await tx.user.deleteMany();
      await tx.setting.deleteMany();

      const insert = async (model: string, rows: unknown[]) => {
        if (!rows?.length) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (tx as any)[model].createMany({ data: rows, skipDuplicates: true });
      };

      await insert('user', d.utilisateurs);
      await insert('zone', d.zones);
      await insert('restaurantTable', d.tables);
      await insert('category', d.categories);
      await insert('product', d.produits);
      await insert('productPrice', d.prix);
      await insert('stockCategory', d.categoriesStock);
      await insert('stockItem', d.articlesStock);
      await insert('recipeLine', d.fichesTechniques);
      await insert('cashSession', d.sessionsCaisse);
      await insert('order', d.commandes);
      await insert('orderItem', d.lignesCommande);
      await insert('payment', d.reglements);
      await insert('cashMovement', d.mouvementsCaisse);
      await insert('stockMovement', d.mouvementsStock);
      await insert('setting', d.parametres);
    },
    { timeout: 120_000 },
  );

  return { restaure: true, fichier: filename };
}

/** Planificateur : une sauvegarde automatique par jour à l'heure configurée. */
export function scheduleAutomaticBackups(): NodeJS.Timeout {
  const CHECK_INTERVAL = 15 * 60 * 1000; // toutes les 15 minutes
  let lastRunDay = '';

  return setInterval(() => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (now.getHours() === env.backupHour && lastRunDay !== today) {
      lastRunDay = today;
      createBackup('AUTO')
        .then((b) => console.log(`[backup] sauvegarde automatique créée : ${b.filename}`))
        .catch((e) => console.error('[backup] échec de la sauvegarde automatique', e));
    }
  }, CHECK_INTERVAL);
}
