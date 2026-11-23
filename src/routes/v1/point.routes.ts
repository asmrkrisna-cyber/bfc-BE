import { Router } from 'express';
import { getMyPoints, previewPointsDiscount } from '../../controllers/point.controller';
import { optionalCustomerAuth } from '../../middlewares/customerAuth.middleware';

const router = Router();

// GET /api/v1/points/me
router.get('/me', optionalCustomerAuth, getMyPoints);

// POST /api/v1/points/preview
router.post('/preview', optionalCustomerAuth, previewPointsDiscount);

export default router;
