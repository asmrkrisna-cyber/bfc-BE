import { Router } from 'express';
import {
  createMobileOrder,
  getActiveOrder,
  getOrderHistory,
  trackOrder,
  updateOrderStatus,
} from '../../../controllers/mobile/order.controller';
import { optionalCustomerAuth, customerAuth } from '../../../middlewares/customerAuth.middleware';

const router = Router();

router.post('/checkout', optionalCustomerAuth, createMobileOrder);
router.get('/active', optionalCustomerAuth, getActiveOrder);
router.get('/history', optionalCustomerAuth, getOrderHistory);
router.get('/:id/track', trackOrder);
router.patch('/:id/status', updateOrderStatus);

export default router;
