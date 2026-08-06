import { PrismaClient } from '@prisma/client';
import { env } from './env';

export const prisma = new PrismaClient({
  log: env.isProd ? ['error', 'warn'] : ['error', 'warn'],
});

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  console.log('[db] PostgreSQL connecté');
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
