import { Request, Response } from 'express';
import { chatWithBarista, getBaristaRecommendations } from '../services/ai.service';

/**
 * POST /api/v1/ai/chat
 * Mengirim pesan ke Barista AI dengan riwayat obrolan dan menerima balasan terstruktur beserta produk rekomendasi.
 */
export const chatWithBaristaController = async (req: Request, res: Response): Promise<any> => {
  try {
    const { message, history } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Pesan wajib diisi dan berupa string.',
      });
    }

    const result = await chatWithBarista(message, history || []);

    return res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('Error in chatWithBaristaController:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memproses pesan Barista AI.',
      error: error.message || error,
    });
  }
};

/**
 * GET /api/v1/ai/recommendations
 * Mengambil maksimal 5 menu "Menu Pilihan Barista Hari Ini" berdasarkan transaksi terlaris.
 */
export const getBaristaRecommendationsController = async (req: Request, res: Response): Promise<any> => {
  try {
    const recommendations = await getBaristaRecommendations();

    return res.json({
      success: true,
      data: recommendations,
    });
  } catch (error: any) {
    console.error('Error in getBaristaRecommendationsController:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat rekomendasi menu barista.',
      error: error.message || error,
    });
  }
};
