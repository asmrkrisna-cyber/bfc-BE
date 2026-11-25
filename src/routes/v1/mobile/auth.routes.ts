import { Router } from 'express';
import {
  registerCustomer,
  loginCustomer,
  googleAuth,
  getAuthMe,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
} from '../../../controllers/mobile/auth.controller';
import { customerAuth } from '../../../middlewares/customerAuth.middleware';

const router = Router();

router.post('/register', registerCustomer);
router.post('/login', loginCustomer);
router.post('/google', googleAuth);
router.get('/me', customerAuth, getAuthMe);
router.post('/forgot-password', forgotPassword);
router.post('/verify-otp', verifyResetOtp);
router.post('/reset-password', resetPassword);

export default router;
