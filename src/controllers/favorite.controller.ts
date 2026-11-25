import { Request, Response } from 'express';
import {
  getUserFavoritesService,
  toggleUserFavoriteService,
} from '../services/favorite.service';

/**
 * GET /api/v1/favorites
 * Mengambil daftar produk favorit milik user yang sedang login.
 */
export const getFavorites = async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.customer?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Silakan login terlebih dahulu untuk melihat daftar favorit.',
      });
    }

    const favorites = await getUserFavoritesService(userId);
    return res.json({
      success: true,
      count: favorites.length,
      favorites,
    });
  } catch (error: any) {
    console.error('Error getFavorites:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat daftar menu favorit.',
      error: error.message,
    });
  }
};

/**
 * POST /api/v1/favorites/toggle
 * Body: { productId, productName? }
 */
export const toggleFavorite = async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.customer?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Silakan login terlebih dahulu untuk menyimpan favorit.',
      });
    }

    const { productId, productName } = req.body;
    if (!productId && !productName) {
      return res.status(400).json({
        success: false,
        message: 'productId wajib disertakan.',
      });
    }

    const result = await toggleUserFavoriteService(userId, productId, productName);
    return res.json({
      success: true,
      isFavorite: result.isFavorite,
      productId: result.productId,
      productName: result.productName,
    });
  } catch (error: any) {
    console.error('Error toggleFavorite:', error);
    return res.status(400).json({
      success: false,
      message: error.message || 'Gagal memperbarui menu favorit.',
    });
  }
};
