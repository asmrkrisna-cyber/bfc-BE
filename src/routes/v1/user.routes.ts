import { Router } from 'express';
import {
  getProfile,
  updateProfile,
  verifyCurrentPassword,
  changePassword,
} from '../../controllers/mobile/profile.controller';
import { customerAuth } from '../../middlewares/customerAuth.middleware';

const router = Router();

router.get('/profile', customerAuth, getProfile);
router.put('/profile', customerAuth, updateProfile);
router.post('/verify-password', customerAuth, verifyCurrentPassword);
router.put('/password', customerAuth, changePassword);

export default router;
