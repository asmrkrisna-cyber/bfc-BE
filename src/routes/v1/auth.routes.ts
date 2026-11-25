import { Router } from 'express';
import { login } from '../../controllers/auth.controller';
import {
  googleAuth,
  registerCustomer,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  getAuthMe,
} from '../../controllers/mobile/auth.controller';
import { customerAuth } from '../../middlewares/customerAuth.middleware';

const router = Router();

// Admin / Kasir POS login
router.post('/login', login);

// Mobile Customer Auth endpoints (/api/v1/auth/*)
router.post('/register', registerCustomer);
router.post('/google', googleAuth);
router.get('/me', customerAuth, getAuthMe);
router.post('/forgot-password', forgotPassword);
router.post('/verify-otp', verifyResetOtp);
router.post('/reset-password', resetPassword);

export default router;
