import { Request, Response } from 'express';
import pool from '../config/database';
import { getUserFavoriteProductIds } from '../services/favorite.service';

// 1. Ambil Semua Produk (POS & Optional Customer Favorite flag)
export const getProducts = async (req: Request, res: Response): Promise<any> => {
  try {
    const [rows]: any = await pool.query('SELECT * FROM products ORDER BY id DESC');
    const favoriteIds = req.customer?.id
      ? await getUserFavoriteProductIds(req.customer.id)
      : new Set<number>();

    const mapped = rows.map((p: any) => {
      const isFav = favoriteIds.has(Number(p.id));
      return {
        id: p.id.toString(),
        name: p.name,
        category: p.category || 'Espresso Based',
        subcategory: p.subcategory || null,
        price: Number(p.price) || 0,
        description: p.description || '',
        image: p.image || '',
        isAvailable: p.is_available === 0 ? false : true,
        isFavorite: isFav,
        is_favorite: isFav,
      };
    });
    return res.json(mapped);
  } catch (error: any) {
    console.error('Error getProducts:', error);
    return res.status(500).json({ message: 'Gagal mengambil data produk', error: error.message });
  }
};

// 2. Tambah Produk Baru
export const createProduct = async (req: Request, res: Response): Promise<any> => {
  try {
    const { name, category, price, description, image } = req.body;
    if (!name || price === undefined) {
      return res.status(400).json({ message: 'Nama dan harga produk wajib diisi' });
    }

    if (/\d/.test(name)) {
      return res.status(400).json({ message: 'Nama produk hanya boleh berupa huruf (tidak boleh mengandung angka)' });
    }

    if (isNaN(Number(price)) || Number(price) <= 0) {
      return res.status(400).json({ message: 'Harga produk harus berupa angka lebih dari 0' });
    }

    const [result]: any = await pool.query(
      `INSERT INTO products (name, category, price, description, image, is_available, created_at)
       VALUES (?, ?, ?, ?, ?, 1, NOW())`,
      [name, category || 'Espresso Based', Number(price), description || '', image || '']
    );

    return res.status(201).json({
      success: true,
      message: 'Produk berhasil ditambahkan',
      product: {
        id: result.insertId.toString(),
        name,
        category: category || 'Espresso Based',
        price: Number(price),
        description: description || '',
        isAvailable: true,
      },
    });
  } catch (error: any) {
    console.error('Error createProduct:', error);
    return res.status(500).json({ message: 'Gagal menambahkan produk', error: error.message });
  }
};

// 3. Edit / Update Produk
export const updateProduct = async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const { name, category, price, description, isAvailable } = req.body;

    if (name && /\d/.test(name)) {
      return res.status(400).json({ message: 'Nama produk hanya boleh berupa huruf (tidak boleh mengandung angka)' });
    }

    if (price !== undefined && (isNaN(Number(price)) || Number(price) <= 0)) {
      return res.status(400).json({ message: 'Harga produk harus berupa angka lebih dari 0' });
    }

    await pool.query(
      `UPDATE products 
       SET name = ?, category = ?, price = ?, description = ?, is_available = ?
       WHERE id = ?`,
      [
        name,
        category,
        Number(price),
        description || '',
        isAvailable !== false ? 1 : 0,
        id,
      ]
    );

    return res.json({
      success: true,
      message: 'Produk berhasil diperbarui',
    });
  } catch (error: any) {
    console.error('Error updateProduct:', error);
    return res.status(500).json({ message: 'Gagal memperbarui produk', error: error.message });
  }
};

// 4. Toggle Status Ketersediaan Produk
export const toggleProductStatus = async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    await pool.query(
      `UPDATE products SET is_available = CASE WHEN is_available = 1 THEN 0 ELSE 1 END WHERE id = ?`,
      [id]
    );

    const [updated]: any = await pool.query('SELECT is_available FROM products WHERE id = ?', [id]);
    const isAvailable = updated.length > 0 && updated[0].is_available === 1;

    return res.json({
      success: true,
      message: 'Status produk berhasil diubah',
      isAvailable,
    });
  } catch (error: any) {
    console.error('Error toggleProductStatus:', error);
    return res.status(500).json({ message: 'Gagal mengubah status produk', error: error.message });
  }
};

// 5. Hapus Produk
export const deleteProduct = async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM products WHERE id = ?', [id]);
    return res.json({
      success: true,
      message: 'Produk berhasil dihapus',
    });
  } catch (error: any) {
    console.error('Error deleteProduct:', error);
    return res.status(500).json({ message: 'Gagal menghapus produk', error: error.message });
  }
};
