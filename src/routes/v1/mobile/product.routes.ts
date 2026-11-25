import { Router } from 'express';
import {
  getMobileProducts,
  getMobileCategories,
} from '../../../controllers/mobile/product.controller';
import { optionalCustomerAuth } from '../../../middlewares/customerAuth.middleware';

const router = Router();

router.get('/', optionalCustomerAuth, getMobileProducts);
router.get('/categories', getMobileCategories);

export default router;
