import { Router } from 'express';
import {
  getMobileProducts,
  getMobileCategories,
} from '../../../controllers/mobile/product.controller';

const router = Router();

router.get('/', getMobileProducts);
router.get('/categories', getMobileCategories);

export default router;
