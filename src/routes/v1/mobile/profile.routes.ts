import { Router } from 'express';
import {
  getProfile,
  updateProfile,
  getPointsHistory,
} from '../../../controllers/mobile/profile.controller';
import { customerAuth } from '../../../middlewares/customerAuth.middleware';

const router = Router();

router.get('/me', customerAuth, getProfile);
router.put('/me', customerAuth, updateProfile);
router.get('/points', customerAuth, getPointsHistory);

export default router;
