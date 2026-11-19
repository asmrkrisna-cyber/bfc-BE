import { Request, Response } from 'express';
import pool from '../../config/database';

/**
 * 1. Ambil Data Profil Pelanggan yang Sedang Login
 */
export const getProfile = async (req: Request, res: Response): Promise<any> => {
  try {
    const customerId = req.customer?.id;

    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Pengguna belum terautentikasi.',
      });
    }

    const [rows]: any = await pool.query(
      `SELECT id, name, email, phone, birth_date, member_badge, points, created_at
       FROM customers WHERE id = ?`,
      [customerId]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data profil pelanggan tidak ditemukan.',
      });
    }

    const c = rows[0];
    return res.json({
      success: true,
      profile: {
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone || '0812 •••• 7890',
        birthDate: c.birth_date || '18 Mei 2000',
        memberBadge: c.member_badge || 'Member Gold',
        points: Number(c.points) || 0,
        createdAt: c.created_at,
      },
    });
  } catch (error: any) {
    console.error('Error getProfile:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat profil pelanggan.',
      error: error.message,
    });
  }
};

/**
 * 2. Perbarui Data Profil Pelanggan
 */
export const updateProfile = async (req: Request, res: Response): Promise<any> => {
  try {
    const customerId = req.customer?.id;
    const { name, phone, birthDate } = req.body;

    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Pengguna belum terautentikasi.',
      });
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Nama lengkap wajib diisi.',
      });
    }

    const trimmedName = name.trim().toUpperCase();

    await pool.query(
      `UPDATE customers
       SET name = ?, phone = ?, birth_date = ?
       WHERE id = ?`,
      [trimmedName, phone || '0812 •••• 7890', birthDate || '18 Mei 2000', customerId]
    );

    return res.json({
      success: true,
      message: 'Profil berhasil diperbarui!',
      profile: {
        id: customerId,
        name: trimmedName,
        phone: phone || '0812 •••• 7890',
        birthDate: birthDate || '18 Mei 2000',
      },
    });
  } catch (error: any) {
    console.error('Error updateProfile:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memperbarui profil.',
      error: error.message,
    });
  }
};

/**
 * 3. Ambil Saldo Poin & Riwayat Transaksi Cashback Poin
 */
export const getPointsHistory = async (req: Request, res: Response): Promise<any> => {
  try {
    const customerId = req.customer?.id;

    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Pengguna belum terautentikasi.',
      });
    }

    // Ambil saldo poin terbaru
    const [custRows]: any = await pool.query(
      'SELECT points, member_badge FROM customers WHERE id = ?',
      [customerId]
    );

    const currentPoints = custRows?.[0]?.points || 0;
    const memberBadge = custRows?.[0]?.member_badge || 'Member Gold';

    // Ambil riwayat perolehan & penukaran poin
    const [historyRows]: any = await pool.query(
      `SELECT id, order_id, type, points, description, created_at
       FROM customer_points_history
       WHERE customer_id = ?
       ORDER BY id DESC`,
      [customerId]
    );

    return res.json({
      success: true,
      points: currentPoints,
      memberBadge,
      history: historyRows.map((h: any) => ({
        id: h.id,
        orderId: h.order_id,
        type: h.type,
        points: h.points,
        description: h.description,
        createdAt: h.created_at,
      })),
    });
  } catch (error: any) {
    console.error('Error getPointsHistory:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat riwayat poin.',
      error: error.message,
    });
  }
};
