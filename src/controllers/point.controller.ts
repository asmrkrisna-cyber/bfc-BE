import { Request, Response } from 'express';
import { getPointsInfo, previewPoints } from '../services/point.service';

/**
 * GET /api/v1/points/me
 * Mengembalikan saldo, setara rupiah, aturan cashback/poin, dan log mutasi
 */
export const getMyPoints = async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.customer?.id || (req as any).user?.id || 1;
    const typeFilter = req.query.type as string | undefined;

    const data = await getPointsInfo(userId, typeFilter);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.error('Error in getMyPoints controller:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat informasi poin dan cashback.',
      error: error.message,
    });
  }
};

/**
 * POST /api/v1/points/preview
 * Menerima body: { subtotal: number }
 * Menghitung simulasi poin yang bisa dipakai, diskon, dan sisa poin
 */
export const previewPointsDiscount = async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.customer?.id || (req as any).user?.id || 1;
    const { subtotal } = req.body;

    const calculation = await previewPoints(userId, Number(subtotal) || 0);

    return res.status(200).json({
      success: true,
      data: calculation,
    });
  } catch (error: any) {
    console.error('Error in previewPointsDiscount controller:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal menghitung kalkulasi poin.',
      error: error.message,
    });
  }
};
