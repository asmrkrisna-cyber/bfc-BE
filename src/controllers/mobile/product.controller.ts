import { Request, Response } from 'express';
import pool from '../../config/database';
import { getUserFavoriteProductIds } from '../../services/favorite.service';

/**
 * 1. Ambil Katalog Produk untuk Aplikasi Mobile
 * Mendukung filter: category, subcategory, dan query pencarian.
 * Menyertakan is_favorite / isFavorite jika customer terautentikasi.
 */
export const getMobileProducts = async (req: Request, res: Response): Promise<any> => {
  try {
    const { category, subcategory, search, availableOnly } = req.query;

    let query = 'SELECT * FROM products WHERE 1=1';
    const params: any[] = [];

    if (availableOnly === 'true') {
      query += ' AND is_available = 1';
    }

    if (category && category !== 'Semua') {
      query += ' AND LOWER(category) = LOWER(?)';
      params.push(category);
    }

    if (subcategory && subcategory !== 'Semua') {
      query += ' AND LOWER(subcategory) = LOWER(?)';
      params.push(subcategory);
    }

    if (search) {
      query += ' AND (LOWER(name) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?))';
      const term = `%${search}%`;
      params.push(term, term);
    }

    query += ' ORDER BY id ASC';

    const [rows]: any = await pool.query(query, params);
    const favoriteIds = req.customer?.id
      ? await getUserFavoriteProductIds(req.customer.id)
      : new Set<number>();

    const mapped = rows.map((p: any) => {
      const numId = Number(p.id);
      const isFav = favoriteIds.has(numId);
      return {
        id: p.id.toString(),
        name: p.name,
        price: Math.round(Number(p.price)),
        category: p.category || 'Kopi',
        subcategory: p.subcategory || null,
        tag: p.tag || null,
        description: p.description || '',
        image: p.image || '',
        isAvailable: p.is_available === 1 || p.is_available === true,
        is_available: p.is_available === 1 || p.is_available === true,
        isFavorite: isFav,
        is_favorite: isFav,
      };
    });

    return res.json({
      success: true,
      count: mapped.length,
      products: mapped,
    });
  } catch (error: any) {
    console.error('Error getMobileProducts:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat katalog produk mobile.',
      error: error.message,
    });
  }
};

/**
 * 2. Ambil Daftar Kategori & Subkategori Menu Mobile
 */
export const getMobileCategories = async (_req: Request, res: Response): Promise<any> => {
  try {
    const [categories]: any = await pool.query(
      `SELECT category, COUNT(*) as count 
       FROM products 
       WHERE is_available = 1 
       GROUP BY category`
    );

    const defaultHierarchy = [
      {
        name: 'Kopi',
        subcategories: ['Semua', 'Hot Coffee', 'Ice Coffee', 'Ice Cube'],
      },
      {
        name: 'Non-Kopi',
        subcategories: ['Semua', 'Coklat', 'Teh & Buah', 'Signature'],
      },
      {
        name: 'Makanan',
        subcategories: ['Semua', 'Goreng', 'Nyemek', 'Paket'],
      },
      {
        name: 'Snack',
        subcategories: ['Semua'],
      },
    ];

    return res.json({
      success: true,
      categories: defaultHierarchy,
      summary: categories,
    });
  } catch (error: any) {
    console.error('Error getMobileCategories:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat daftar kategori.',
      error: error.message,
    });
  }
};
