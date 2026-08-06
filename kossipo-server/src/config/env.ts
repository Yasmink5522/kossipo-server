import dotenv from 'dotenv';
dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET', 'dev-secret-a-changer-absolument-en-production'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  backupDir: process.env.BACKUP_DIR ?? './backups',
  backupHour: Number(process.env.BACKUP_CRON_HOUR ?? 3),
  backupRetentionDays: Number(process.env.BACKUP_RETENTION_DAYS ?? 30),
};
