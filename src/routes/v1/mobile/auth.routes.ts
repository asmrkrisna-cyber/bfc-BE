import { Router } from 'express';
import {
  registerCustomer,
  loginCustomer,
  forgotPassword,
  resetPassword,
} from '../../../controllers/mobile/auth.controller';

const router = Router();

router.post('/register', registerCustomer);
router.post('/login', loginCustomer);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

export default router;
