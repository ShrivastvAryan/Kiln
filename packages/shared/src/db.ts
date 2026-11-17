import './config'; // loads .env (DATABASE_URL) before the client is created
import { PrismaClient } from '@prisma/client';

/** One Prisma client per process; it manages its own connection pool. */
export const prisma = new PrismaClient({
  log: process.env.PRISMA_LOG === 'query' ? ['query', 'warn', 'error'] : ['warn', 'error'],
});

export async function pingDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
