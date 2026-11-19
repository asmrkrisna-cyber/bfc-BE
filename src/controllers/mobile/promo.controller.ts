import { Request, Response } from 'express';
import pool from '../../config/database';

/**
 * 1. Validasi Kode Promo / Voucher di Mobile Checkout
 */
export const validatePromo = async (req: Request, res: Response): Promise<any> => {
  try {
    const { code, subtotal } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: 'Kode promo wajib diisi.',
      });
    }

    const currentSubtotal = Number(subtotal) || 0;
    const cleanCode = code.trim().toUpperCase().replace(/^KODE\s*PROMO\s*:\s*/, '');

    const [rows]: any = await pool.query(
      'SELECT * FROM discounts WHERE code = ? AND is_active = 1',
      [cleanCode]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        valid: false,
        message: `Kode promo "${cleanCode}" tidak valid atau sudah tidak berlaku.`,
      });
    }

    const promo = rows[0];
    const minPurchase = Number(promo.min_purchase) || 0;

    if (currentSubtotal < minPurchase) {
      return res.status(400).json({
        success: false,
        valid: false,
        message: `Minimal belanja untuk kode promo ini adalah Rp ${minPurchase.toLocaleString('id-ID')}.`,
      });
    }

    let discountAmount = 0;
    const promoValue = Number(promo.value) || 0;

    if (promo.type === 'percentage') {
      discountAmount = Math.round((currentSubtotal * promoValue) / 100);
      // Batas maksimal diskon khusus voucher tertentu (misal BREAK20 maks 10.000)
      if (cleanCode === 'BREAK20' && discountAmount > 10000) {
        discountAmount = 10000;
      }
    } else {
      discountAmount = Math.min(currentSubtotal, promoValue);
    }

    const totalAfterDiscount = Math.max(0, currentSubtotal - discountAmount);

    return res.json({
      success: true,
      valid: true,
      code: promo.code,
      name: promo.name,
      type: promo.type,
      value: promoValue,
      discountAmount,
      subtotal: currentSubtotal,
      totalPayment: totalAfterDiscount,
      message: `Voucher "${promo.name}" berhasil diterapkan! Hemat Rp ${discountAmount.toLocaleString('id-ID')}.`,
    });
  } catch (error: any) {
    console.error('Error validatePromo:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memvalidasi kode promo.',
      error: error.message,
    });
  }
};
