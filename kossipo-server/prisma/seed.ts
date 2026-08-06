/**
 * Jeu de données initial de KOSSIPO RESTAURANT PRO.
 * Idempotent : peut être relancé sans créer de doublons.
 *   npm run seed
 */
import { PrismaClient, Destination, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();
const prisma = new PrismaClient();
const hash = (secret: string) => bcrypt.hash(secret, 10);

// ─────────────────────────────── Zones et tables

const ZONES = [
  { code: 'TERRASSE', name: 'Terrasse', freeDrinkPrice: false, sortOrder: 1, color: '#2F9E8F', tables: 12 },
  { code: 'VIP1', name: 'VIP 1', freeDrinkPrice: true, sortOrder: 2, color: '#E4A11B', tables: 8 },
  { code: 'VIP2', name: 'VIP 2', freeDrinkPrice: true, sortOrder: 3, color: '#C2703D', tables: 6 },
];

// ─────────────────────────────── Carte
// prix = [Terrasse, VIP1, VIP2]

const CATEGORIES: {
  name: string;
  destination: Destination;
  color: string;
  products: { name: string; prices: [number, number, number] }[];
}[] = [
  {
    name: 'Plats',
    destination: Destination.KITCHEN,
    color: '#2F9E8F',
    products: [
      { name: 'Riz / Foutou sauce poulet', prices: [1500, 2000, 2000] },
      { name: 'Riz / Foutou sauce poisson', prices: [2000, 2500, 2500] },
      { name: 'Riz Tchèp poulet', prices: [2000, 2500, 2500] },
      { name: 'Riz Tchèp poisson', prices: [2000, 2500, 2500] },
    ],
  },
  {
    name: 'Grillades',
    destination: Destination.KITCHEN,
    color: '#C2703D',
    products: [
      { name: '1/2 Poulet braisé', prices: [3000, 3500, 3500] },
      { name: '1 Poulet braisé', prices: [6000, 7000, 7000] },
    ],
  },
  {
    name: 'Accompagnements',
    destination: Destination.KITCHEN,
    color: '#8A9BA8',
    products: [
      { name: 'Frites', prices: [1500, 1500, 1500] },
      { name: 'Aloco', prices: [1500, 1500, 1500] },
    ],
  },
  {
    name: 'Boissons',
    destination: Destination.BAR,
    color: '#3B82F6',
    products: [
      { name: 'Eau minérale', prices: [500, 500, 500] },
      { name: 'Heineken', prices: [700, 700, 700] },
      { name: 'Beaufort', prices: [700, 700, 700] },
      { name: 'Bock 66', prices: [700, 700, 700] },
      { name: 'Racine', prices: [700, 700, 700] },
      { name: 'Dopel Energy', prices: [500, 500, 500] },
      { name: 'Sucrerie petite bouteille', prices: [500, 500, 500] },
      { name: 'Sucrerie grande bouteille', prices: [1000, 1000, 1000] },
      { name: 'Codis', prices: [500, 500, 500] },
      { name: 'Vin petite bouteille', prices: [1500, 1500, 1500] },
      { name: 'Vin grande bouteille', prices: [2500, 2500, 2500] },
    ],
  },
];

// ─────────────────────────────── Stock

const STOCK_CATEGORIES = [
  'Poulets', 'Poissons', 'Riz', 'Foutou', 'Huile', 'Boissons',
  'Légumes', 'Condiments', 'Gaz', 'Charbon', 'Divers',
];

const STOCK_ITEMS: { name: string; category: string; unit: string; qty: number; min: number; cost: number }[] = [
  { name: 'Poulet entier', category: 'Poulets', unit: 'pièce', qty: 40, min: 10, cost: 2500 },
  { name: 'Poisson frais', category: 'Poissons', unit: 'pièce', qty: 30, min: 8, cost: 1200 },
  { name: 'Riz blanc', category: 'Riz', unit: 'kg', qty: 50, min: 10, cost: 600 },
  { name: 'Riz Tchèp (préparé)', category: 'Riz', unit: 'kg', qty: 20, min: 5, cost: 900 },
  { name: 'Farine de foutou', category: 'Foutou', unit: 'kg', qty: 25, min: 6, cost: 800 },
  { name: 'Huile végétale', category: 'Huile', unit: 'litre', qty: 30, min: 8, cost: 1100 },
  { name: 'Pomme de terre', category: 'Légumes', unit: 'kg', qty: 25, min: 6, cost: 700 },
  { name: 'Banane plantain', category: 'Légumes', unit: 'kg', qty: 20, min: 5, cost: 500 },
  { name: 'Tomate', category: 'Légumes', unit: 'kg', qty: 15, min: 4, cost: 800 },
  { name: 'Oignon', category: 'Légumes', unit: 'kg', qty: 15, min: 4, cost: 600 },
  { name: 'Piment', category: 'Condiments', unit: 'kg', qty: 5, min: 1, cost: 1500 },
  { name: 'Cube assaisonnement', category: 'Condiments', unit: 'boîte', qty: 20, min: 5, cost: 1000 },
  { name: 'Sel', category: 'Condiments', unit: 'kg', qty: 10, min: 3, cost: 300 },
  { name: 'Bouteille de gaz 12 kg', category: 'Gaz', unit: 'bouteille', qty: 4, min: 2, cost: 7500 },
  { name: 'Charbon de bois', category: 'Charbon', unit: 'sac', qty: 10, min: 3, cost: 4000 },
  { name: 'Eau minérale (bouteille)', category: 'Boissons', unit: 'bouteille', qty: 120, min: 30, cost: 250 },
  { name: 'Heineken (bouteille)', category: 'Boissons', unit: 'bouteille', qty: 100, min: 24, cost: 450 },
  { name: 'Beaufort (bouteille)', category: 'Boissons', unit: 'bouteille', qty: 100, min: 24, cost: 430 },
  { name: 'Bock 66 (bouteille)', category: 'Boissons', unit: 'bouteille', qty: 80, min: 24, cost: 430 },
  { name: 'Racine (bouteille)', category: 'Boissons', unit: 'bouteille', qty: 60, min: 12, cost: 430 },
  { name: 'Dopel Energy (canette)', category: 'Boissons', unit: 'canette', qty: 60, min: 12, cost: 300 },
  { name: 'Sucrerie petite (bouteille)', category: 'Boissons', unit: 'bouteille', qty: 120, min: 24, cost: 300 },
  { name: 'Sucrerie grande (bouteille)', category: 'Boissons', unit: 'bouteille', qty: 60, min: 12, cost: 600 },
  { name: 'Codis (bouteille)', category: 'Boissons', unit: 'bouteille', qty: 60, min: 12, cost: 300 },
  { name: 'Vin petite bouteille', category: 'Boissons', unit: 'bouteille', qty: 30, min: 6, cost: 900 },
  { name: 'Vin grande bouteille', category: 'Boissons', unit: 'bouteille', qty: 20, min: 5, cost: 1600 },
  { name: 'Serviettes / emballages', category: 'Divers', unit: 'paquet', qty: 30, min: 8, cost: 500 },
];

/** Fiches techniques : produit vendu → ingrédients consommés par unité vendue. */
const RECIPES: Record<string, { item: string; qty: number }[]> = {
  'Riz / Foutou sauce poulet': [
    { item: 'Riz blanc', qty: 0.25 },
    { item: 'Poulet entier', qty: 0.2 },
    { item: 'Huile végétale', qty: 0.05 },
    { item: 'Tomate', qty: 0.08 },
    { item: 'Oignon', qty: 0.05 },
    { item: 'Cube assaisonnement', qty: 0.05 },
  ],
  'Riz / Foutou sauce poisson': [
    { item: 'Riz blanc', qty: 0.25 },
    { item: 'Poisson frais', qty: 1 },
    { item: 'Huile végétale', qty: 0.05 },
    { item: 'Tomate', qty: 0.08 },
    { item: 'Oignon', qty: 0.05 },
    { item: 'Cube assaisonnement', qty: 0.05 },
  ],
  'Riz Tchèp poulet': [
    { item: 'Riz Tchèp (préparé)', qty: 0.3 },
    { item: 'Poulet entier', qty: 0.2 },
    { item: 'Huile végétale', qty: 0.04 },
    { item: 'Cube assaisonnement', qty: 0.05 },
  ],
  'Riz Tchèp poisson': [
    { item: 'Riz Tchèp (préparé)', qty: 0.3 },
    { item: 'Poisson frais', qty: 1 },
    { item: 'Huile végétale', qty: 0.04 },
    { item: 'Cube assaisonnement', qty: 0.05 },
  ],
  '1/2 Poulet braisé': [
    { item: 'Poulet entier', qty: 0.5 },
    { item: 'Charbon de bois', qty: 0.05 },
    { item: 'Huile végétale', qty: 0.03 },
    { item: 'Piment', qty: 0.02 },
  ],
  '1 Poulet braisé': [
    { item: 'Poulet entier', qty: 1 },
    { item: 'Charbon de bois', qty: 0.1 },
    { item: 'Huile végétale', qty: 0.05 },
    { item: 'Piment', qty: 0.04 },
  ],
  Frites: [
    { item: 'Pomme de terre', qty: 0.3 },
    { item: 'Huile végétale', qty: 0.08 },
    { item: 'Sel', qty: 0.005 },
  ],
  Aloco: [
    { item: 'Banane plantain', qty: 0.3 },
    { item: 'Huile végétale', qty: 0.08 },
  ],
  'Eau minérale': [{ item: 'Eau minérale (bouteille)', qty: 1 }],
  Heineken: [{ item: 'Heineken (bouteille)', qty: 1 }],
  Beaufort: [{ item: 'Beaufort (bouteille)', qty: 1 }],
  'Bock 66': [{ item: 'Bock 66 (bouteille)', qty: 1 }],
  Racine: [{ item: 'Racine (bouteille)', qty: 1 }],
  'Dopel Energy': [{ item: 'Dopel Energy (canette)', qty: 1 }],
  'Sucrerie petite bouteille': [{ item: 'Sucrerie petite (bouteille)', qty: 1 }],
  'Sucrerie grande bouteille': [{ item: 'Sucrerie grande (bouteille)', qty: 1 }],
  Codis: [{ item: 'Codis (bouteille)', qty: 1 }],
  'Vin petite bouteille': [{ item: 'Vin petite bouteille', qty: 1 }],
  'Vin grande bouteille': [{ item: 'Vin grande bouteille', qty: 1 }],
};

const SETTINGS: Record<string, string> = {
  'restaurant.nom': 'KOSSIPO RESTAURANT',
  'restaurant.adresse': 'San-Pédro, Côte d\'Ivoire',
  'restaurant.telephone': '+225 00 00 00 00 00',
  'restaurant.devise': 'FCFA',
  'imprimante.largeur': '80',
  'ticket.logo': 'true',
  'ticket.pied': 'Merci de votre visite',
  'caisse.fondParDefaut': '20000',
};

async function main() {
  console.log('→ Zones et plan de salle');
  const zoneIds: Record<string, string> = {};
  for (const zone of ZONES) {
    const record = await prisma.zone.upsert({
      where: { code: zone.code },
      create: {
        code: zone.code,
        name: zone.name,
        freeDrinkPrice: zone.freeDrinkPrice,
        sortOrder: zone.sortOrder,
        color: zone.color,
      },
      update: { name: zone.name, freeDrinkPrice: zone.freeDrinkPrice, color: zone.color },
    });
    zoneIds[zone.code] = record.id;

    for (let n = 1; n <= zone.tables; n++) {
      const col = (n - 1) % 4;
      const row = Math.floor((n - 1) / 4);
      await prisma.restaurantTable.upsert({
        where: { zoneId_number: { zoneId: record.id, number: n } },
        create: {
          zoneId: record.id,
          number: n,
          label: `${zone.name} ${n}`,
          seats: zone.code === 'TERRASSE' ? 4 : 6,
          posX: 40 + col * 170,
          posY: 40 + row * 150,
        },
        update: {},
      });
    }
  }

  console.log('→ Carte et tarifs par zone');
  let catOrder = 0;
  for (const category of CATEGORIES) {
    catOrder += 1;
    const cat = await prisma.category.upsert({
      where: { name: category.name },
      create: {
        name: category.name,
        destination: category.destination,
        sortOrder: catOrder,
        color: category.color,
      },
      update: { destination: category.destination, sortOrder: catOrder, color: category.color },
    });

    let prodOrder = 0;
    for (const product of category.products) {
      prodOrder += 1;
      const existing = await prisma.product.findFirst({ where: { name: product.name } });
      const record = existing
        ? await prisma.product.update({
            where: { id: existing.id },
            data: { categoryId: cat.id, sortOrder: prodOrder, active: true },
          })
        : await prisma.product.create({
            data: { name: product.name, categoryId: cat.id, sortOrder: prodOrder },
          });

      const zoneCodes = ['TERRASSE', 'VIP1', 'VIP2'] as const;
      for (let i = 0; i < zoneCodes.length; i++) {
        const code = zoneCodes[i];
        // En VIP, les boissons sont en libre-service : le prix est saisi à la commande.
        const freePrice = category.destination === Destination.BAR && code !== 'TERRASSE';
        await prisma.productPrice.upsert({
          where: { productId_zoneId: { productId: record.id, zoneId: zoneIds[code] } },
          create: {
            productId: record.id,
            zoneId: zoneIds[code],
            price: product.prices[i],
            freePrice,
          },
          update: { price: product.prices[i], freePrice },
        });
      }
    }
  }

  console.log('→ Stock et fiches techniques');
  const stockCatIds: Record<string, string> = {};
  for (let i = 0; i < STOCK_CATEGORIES.length; i++) {
    const name = STOCK_CATEGORIES[i];
    const cat = await prisma.stockCategory.upsert({
      where: { name },
      create: { name, sortOrder: i + 1 },
      update: { sortOrder: i + 1 },
    });
    stockCatIds[name] = cat.id;
  }

  const stockIds: Record<string, string> = {};
  for (const item of STOCK_ITEMS) {
    const existing = await prisma.stockItem.findFirst({ where: { name: item.name } });
    const record = existing
      ? await prisma.stockItem.update({
          where: { id: existing.id },
          data: { minQuantity: item.min, unitCost: item.cost, unit: item.unit },
        })
      : await prisma.stockItem.create({
          data: {
            name: item.name,
            categoryId: stockCatIds[item.category],
            unit: item.unit,
            quantity: item.qty,
            minQuantity: item.min,
            unitCost: item.cost,
          },
        });
    stockIds[item.name] = record.id;
  }

  for (const [productName, lines] of Object.entries(RECIPES)) {
    const product = await prisma.product.findFirst({ where: { name: productName } });
    if (!product) continue;
    for (const line of lines) {
      const stockItemId = stockIds[line.item];
      if (!stockItemId) continue;
      await prisma.recipeLine.upsert({
        where: { productId_stockItemId: { productId: product.id, stockItemId } },
        create: { productId: product.id, stockItemId, quantity: line.qty },
        update: { quantity: line.qty },
      });
    }
  }

  console.log('→ Comptes utilisateurs');
  const accounts = [
    {
      fullName: 'Administrateur KOSSIPO',
      username: (process.env.SEED_ADMIN_USERNAME ?? 'admin').toLowerCase(),
      role: Role.ADMIN,
      password: process.env.SEED_ADMIN_PASSWORD ?? 'Kossipo2026!',
      pin: process.env.SEED_ADMIN_PIN ?? '1234',
    },
    { fullName: 'Gérant de salle', username: 'gerant', role: Role.MANAGER, password: 'Gerant2026!', pin: '2222' },
    { fullName: 'Caissier 1', username: 'caisse1', role: Role.CASHIER, password: 'Caisse2026!', pin: '3333' },
    { fullName: 'Caissier 2', username: 'caisse2', role: Role.CASHIER, password: 'Caisse2026!', pin: '4444' },
    { fullName: 'Poste Cuisine', username: 'cuisine', role: Role.KITCHEN, password: 'Cuisine2026!', pin: '5555' },
    { fullName: 'Poste Bar', username: 'bar', role: Role.BAR, password: 'Bar2026!', pin: '6666' },
  ];

  for (const account of accounts) {
    await prisma.user.upsert({
      where: { username: account.username },
      create: {
        fullName: account.fullName,
        username: account.username,
        role: account.role,
        passwordHash: await hash(account.password),
        pinHash: await hash(account.pin),
      },
      update: { fullName: account.fullName, role: account.role, active: true },
    });
  }

  console.log('→ Paramètres');
  for (const [key, value] of Object.entries(SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: {} });
  }

  console.log('\n✅ Base initialisée.');
  console.log('   Comptes (identifiant / mot de passe / PIN) :');
  accounts.forEach((a) => console.log(`   • ${a.username.padEnd(8)} ${a.password.padEnd(14)} PIN ${a.pin}`));
  console.log('\n   ⚠  Changez ces identifiants avant la mise en exploitation.\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
