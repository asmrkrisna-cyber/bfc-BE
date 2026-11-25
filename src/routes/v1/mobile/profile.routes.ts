import { Router } from 'express';
import {
  getProfile,
  updateProfile,
  verifyCurrentPassword,
  changePassword,
  getPointsHistory,
  getNotifications,
} from '../../../controllers/mobile/profile.controller';
import { customerAuth, optionalCustomerAuth } from '../../../middlewares/customerAuth.middleware';

const router = Router();

router.get('/me', customerAuth, getProfile);
router.put('/me', customerAuth, updateProfile);
router.post('/verify-password', customerAuth, verifyCurrentPassword);
router.put('/password', customerAuth, changePassword);
router.get('/points', customerAuth, getPointsHistory);
router.get('/notifications', optionalCustomerAuth, getNotifications);

export default router;
