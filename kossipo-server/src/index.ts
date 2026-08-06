import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase } from './config/prisma';
import { initSocket } from './realtime/socket';
import { scheduleAutomaticBackups } from './modules/backup/backup.service';

async function bootstrap() {
  await connectDatabase();

  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);
  const backupTimer = scheduleAutomaticBackups();

  server.listen(env.port, () => {
    console.log(`[api] KOSSIPO RESTAURANT PRO — port ${env.port} (${env.nodeEnv})`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[api] arrêt demandé (${signal})`);
    clearInterval(backupTimer);
    server.close();
    await disconnectDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((error) => {
  console.error('[api] démarrage impossible', error);
  process.exit(1);
});
