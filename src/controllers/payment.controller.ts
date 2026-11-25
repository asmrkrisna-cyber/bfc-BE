import { Request, Response } from 'express';
import pool from '../config/database';
import {
  applyMidtransStatusToDatabase,
  checkAndSyncMidtransStatus,
  createMidtransSnapTransaction,
  verifyMidtransWebhookSignature,
} from '../services/midtrans.service';

/**
 * Webhook Resmi Midtrans HTTP Notification (POST /api/v1/payments/midtrans/notification)
 */
export const handleMidtransNotification = async (req: Request, res: Response): Promise<any> => {
  try {
    const body = req.body || {};

    if (!verifyMidtransWebhookSignature(body)) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Midtrans webhook signature.',
      });
    }

    const vaBank =
      Array.isArray(body.va_numbers) && body.va_numbers.length > 0
        ? body.va_numbers[0].bank
        : body.permata_va_number
          ? 'Permata'
          : null;

    const result = await applyMidtransStatusToDatabase(String(body.order_id || ''), {
      midtransOrderId: body.order_id,
      transactionId: body.transaction_id,
      transactionStatus: body.transaction_status,
      fraudStatus: body.fraud_status,
      paymentType: body.payment_type,
      vaBank,
      storeName: body.store,
      grossAmount: body.gross_amount,
    });

    return res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('Midtrans Notification Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memproses notifikasi Midtrans.',
      error: error.message,
    });
  }
};

/**
 * Polling / Cek Status Pembayaran Midtrans Langsung dari Server (GET /api/v1/payments/midtrans/status/:orderId)
 */
export const getMidtransPaymentStatus = async (req: Request, res: Response): Promise<any> => {
  try {
    const rawId = Array.isArray(req.params.orderId) ? req.params.orderId[0] : req.params.orderId;
    const result = await checkAndSyncMidtransStatus(rawId);

    if (!result.found) {
      return res.status(404).json({
        success: false,
        ...result,
      });
    }

    return res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('getMidtransPaymentStatus Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memeriksa status pembayaran Midtrans.',
      error: error.message,
    });
  }
};

/**
 * Membuat / Mengambil Ulang Link Snap Midtrans untuk Pesanan POS atau Pesanan Tertunda
 * POST /api/v1/payments/midtrans/snap
 */
export const createPosOrStandaloneSnap = async (req: Request, res: Response): Promise<any> => {
  try {
    const { orderId, grossAmount, items = [], customerName, customerEmail, customerPhone } = req.body;

    if (!grossAmount || Number(grossAmount) < 100) {
      return res.status(400).json({
        success: false,
        message: 'Nominal grossAmount tidak valid.',
      });
    }

    const internalOrderId = orderId ? String(orderId).trim() : `#POS-${Math.floor(1000 + Math.random() * 9000)}`;

    // Jika order sudah ada di mobile_orders/transactions dengan snap_redirect_url aktif dan belum gagal, kembalikan langsung
    const [existingRows]: any = await pool.query(
      `SELECT order_id, midtrans_order_id, snap_token, snap_redirect_url, payment_status
       FROM mobile_orders WHERE order_id = ? LIMIT 1`,
      [internalOrderId]
    );
    if (
      existingRows &&
      existingRows.length > 0 &&
      existingRows[0].snap_redirect_url &&
      existingRows[0].payment_status === 'PENDING'
    ) {
      return res.json({
        success: true,
        orderId: existingRows[0].order_id,
        midtransOrderId: existingRows[0].midtrans_order_id,
        token: existingRows[0].snap_token,
        redirectUrl: existingRows[0].snap_redirect_url,
      });
    }

    const mappedItems =
      Array.isArray(items) && items.length > 0
        ? items.map((it: any, i: number) => ({
            id: String(it.id || it.productId || `item-${i + 1}`),
            name: String(it.name || it.productName || 'Menu BreakFree'),
            price: Math.round(Number(it.price) || 0),
            quantity: Math.max(1, Math.round(Number(it.quantity) || 1)),
          }))
        : [
            {
              id: 'BREAKFREE-POS',
              name: `Pesanan ${internalOrderId}`,
              price: Math.round(Number(grossAmount)),
              quantity: 1,
            },
          ];

    const snap = await createMidtransSnapTransaction({
      internalOrderId,
      grossAmount: Math.round(Number(grossAmount)),
      items: mappedItems,
      customer: {
        firstName: customerName || 'Pelanggan BreakFree',
        email: customerEmail || undefined,
        phone: customerPhone || undefined,
      },
    });

    await pool.query(
      `UPDATE mobile_orders
       SET midtrans_order_id = ?, snap_token = ?, snap_redirect_url = ?
       WHERE order_id = ?`,
      [snap.midtransOrderId, snap.token, snap.redirectUrl, internalOrderId]
    );
    await pool.query(
      `UPDATE transactions
       SET midtrans_order_id = ?, snap_token = ?, snap_redirect_url = ?
       WHERE transaction_id = ?`,
      [snap.midtransOrderId, snap.token, snap.redirectUrl, internalOrderId]
    );

    return res.json({
      success: true,
      orderId: internalOrderId,
      midtransOrderId: snap.midtransOrderId,
      token: snap.token,
      redirectUrl: snap.redirectUrl,
      isProduction: snap.isProduction,
    });
  } catch (error: any) {
    console.error('createPosOrStandaloneSnap Error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Gagal membuat transaksi Midtrans Snap.',
    });
  }
};
