import { Router } from 'express';
import {
  getProducts,
  createProduct,
  updateProduct,
  toggleProductStatus,
  deleteProduct,
} from '../../controllers/product.controller';
import { optionalCustomerAuth } from '../../middlewares/customerAuth.middleware';

const router = Router();

router.get('/', optionalCustomerAuth, getProducts);
router.post('/', createProduct);
router.put('/:id', updateProduct);
router.patch('/:id/toggle', toggleProductStatus);
router.patch('/:id/availability', toggleProductStatus);
router.delete('/:id', deleteProduct);

export default router;
