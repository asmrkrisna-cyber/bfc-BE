import { Router } from 'express';
import authRoutes from './auth.routes';
import productRoutes from './product.routes';
import shiftRoutes from './shift.routes';
import transactionRoutes from './transaction.routes';
import discountRoutes from './discount.routes';
import kitchenRoutes from './kitchen.routes';
import cashierRoutes from './cashier.routes';
import mobileRoutes from './mobile';
import aiRoutes from './ai.routes';
import pointRoutes from './point.routes';
import favoriteRoutes from './favorite.routes';
import userRoutes from './user.routes';
import orderRoutes from './order.routes';
import paymentRoutes from './payment.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/favorites', favoriteRoutes);
router.use('/orders', orderRoutes);
router.use('/payments', paymentRoutes);
router.use('/products', productRoutes);
router.use('/shifts', shiftRoutes);
router.use('/transactions', transactionRoutes);
router.use('/discounts', discountRoutes);
router.use('/kitchen-orders', kitchenRoutes);
router.use('/cashiers', cashierRoutes);
router.use('/mobile', mobileRoutes);
router.use('/ai', aiRoutes);
router.use('/points', pointRoutes);

export default router;
