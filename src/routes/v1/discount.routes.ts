import { Router } from 'express';
import {
  getDiscounts,
  getActiveDiscounts,
  createDiscount,
  updateDiscount,
  toggleDiscountStatus,
  deleteDiscount,
  validateDiscount,
} from '../../controllers/discount.controller';

const router = Router();

router.get('/', getDiscounts);
router.get('/active', getActiveDiscounts);
router.post('/', createDiscount);
router.put('/:id', updateDiscount);
router.patch('/:id/toggle', toggleDiscountStatus);
router.delete('/:id', deleteDiscount);
router.post('/validate', validateDiscount);

export default router;
