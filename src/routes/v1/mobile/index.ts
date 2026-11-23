import { Router } from 'express';
import authRoutes from './auth.routes';
import profileRoutes from './profile.routes';
import productRoutes from './product.routes';
import promoRoutes from './promo.routes';
import orderRoutes from './order.routes';
import aiRoutes from './ai.routes';
import pointRoutes from '../point.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/profile', profileRoutes);
router.use('/products', productRoutes);
router.use('/promos', promoRoutes);
router.use('/orders', orderRoutes);
router.use('/ai-chat', aiRoutes);
router.use('/ai', aiRoutes);
router.use('/points', pointRoutes);

export default router;
