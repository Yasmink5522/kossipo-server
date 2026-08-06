import { Router } from 'express';
import { authRouter } from './modules/auth/auth.routes';
import { usersRouter } from './modules/users/users.routes';
import { tablesRouter } from './modules/tables/tables.routes';
import { productsRouter } from './modules/products/products.routes';
import { ordersRouter } from './modules/orders/orders.routes';
import { paymentsRouter } from './modules/payments/payments.routes';
import { cashRouter } from './modules/cash/cash.routes';
import { stockRouter } from './modules/stock/stock.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { settingsRouter } from './modules/settings/settings.routes';
import { backupRouter } from './modules/backup/backup.routes';
import { auditRouter } from './modules/audit/audit.routes';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/utilisateurs', usersRouter);
apiRouter.use('/salle', tablesRouter);
apiRouter.use('/carte', productsRouter);
apiRouter.use('/commandes', ordersRouter);
apiRouter.use('/encaissement', paymentsRouter);
apiRouter.use('/caisse', cashRouter);
apiRouter.use('/stock', stockRouter);
apiRouter.use('/rapports', reportsRouter);
apiRouter.use('/parametres', settingsRouter);
apiRouter.use('/sauvegardes', backupRouter);
apiRouter.use('/journal', auditRouter);
