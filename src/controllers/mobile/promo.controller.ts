import { Request, Response } from 'express';
import {
  getActiveDiscountsService,
  validateDiscountService,
} from '../../services/discount.service';

/**
 * 1. Ambil Daftar Promo / Voucher Aktif untuk Mobile
 */
export const getActivePromos = async (_req: Request, res: Response): Promise<any> => {
  try {
    const discounts = await getActiveDiscountsService();
    return res.json({
      success: true,
      count: discounts.length,
      promos: discounts,
    });
  } catch (error: any) {
    console.error('Error getActivePromos:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat daftar promo aktif.',
      error: error.message,
    });
  }
};

/**
 * 2. Validasi Kode Promo / Voucher di Mobile Checkout
 */
export const validatePromo = async (req: Request, res: Response): Promise<any> => {
  try {
    const { code, subtotal } = req.body;
    const result = await validateDiscountService(code, Number(subtotal) || 0);

    if (!result.valid) {
      return res.status(400).json({
        success: false,
        valid: false,
        message: result.message,
      });
    }

    return res.json({
      success: true,
      ...result,
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
