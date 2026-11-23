import { Request, Response } from 'express';
import pool from '../../config/database';

/**
 * 1. Ambil Katalog Produk untuk Aplikasi Mobile
 * Mendukung filter: category, subcategory, dan query pencarian.
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

    const mapped = rows.map((p: any) => ({
      id: p.id.toString(),
      name: p.name,
      price: Math.round(Number(p.price)),
      category: p.category || 'Kopi',
      subcategory: p.subcategory || 'Hot Coffee',
      tag: p.tag || null,
      description: p.description || '',
      image: p.image || '',
      isAvailable: p.is_available === 1 || p.is_available === true,
    }));

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
