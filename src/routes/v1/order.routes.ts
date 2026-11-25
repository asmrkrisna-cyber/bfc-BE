import { Router } from 'express';
import {
  getOrderHistory,
  trackOrder,
} from '../../controllers/mobile/order.controller';
import { customerAuth } from '../../middlewares/customerAuth.middleware';

const router = Router();

router.get('/me', customerAuth, getOrderHistory);
router.get('/:id', trackOrder);

export default router;
