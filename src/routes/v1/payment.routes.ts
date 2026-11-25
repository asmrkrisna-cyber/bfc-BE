import { Router } from 'express';
import {
  createPosOrStandaloneSnap,
  getMidtransPaymentStatus,
  handleMidtransNotification,
} from '../../controllers/payment.controller';

const router = Router();

// Webhook resmi dari server Midtrans (divalidasi dengan SHA-512 signature_key)
router.post('/midtrans/notification', handleMidtransNotification);

// Polling/verifikasi status langsung ke Midtrans API + sinkron MySQL
router.get('/midtrans/status/:orderId', getMidtransPaymentStatus);

// Membuat transaksi Snap Midtrans
router.post('/midtrans/snap', createPosOrStandaloneSnap);

export default router;
