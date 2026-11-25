import { Request, Response } from 'express';
import pool from '../../config/database';
import bcrypt from 'bcryptjs';
import {
  checkHashedPasswordSimilarity,
  comparePlaintextPasswordSimilarity,
  verifyStoredPassword,
} from '../../utils/passwordSimilarity';

function mapProfileRow(c: any) {
  return {
    id: Number(c.id),
    name: c.name,
    email: c.email,
    phone: c.phone && String(c.phone).trim().length > 0 ? String(c.phone).trim() : null,
    birthDate: c.birth_date && String(c.birth_date).trim().length > 0 ? String(c.birth_date).trim() : null,
    avatarUrl: c.avatar_url || null,
    googleId: c.google_id || null,
    hasPassword: Boolean(c.password),
    memberBadge: c.member_badge || 'Member BreakFree',
    points: Number(c.points) || 0,
    createdAt: c.created_at,
  };
}

/**
 * 1. Ambil Data Profil Pelanggan yang Sedang Login (100% Real MySQL, zero dummy)
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
      `SELECT id, name, email, phone, birth_date, avatar_url, google_id, password, member_badge, points, created_at
       FROM customers WHERE id = ?`,
      [customerId]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data profil pelanggan tidak ditemukan.',
      });
    }

    return res.json({
      success: true,
      profile: mapProfileRow(rows[0]),
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
 * 2. Perbarui Data Profil Pelanggan (Nama, Nomor HP opsional, Tanggal Lahir, Avatar)
 */
export const updateProfile = async (req: Request, res: Response): Promise<any> => {
  try {
    const customerId = req.customer?.id;
    const { name, phone, birthDate, avatarUrl } = req.body;

    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Pengguna belum terautentikasi.',
      });
    }

    const [existingRows]: any = await pool.query(
      'SELECT * FROM customers WHERE id = ?',
      [customerId]
    );
    if (!existingRows || existingRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data profil pelanggan tidak ditemukan.',
      });
    }

    const current = existingRows[0];

    // Wajib verifikasi kata sandi saat ini bila akun memiliki kata sandi
    if (current.password) {
      const { currentPassword } = req.body;
      if (!currentPassword || String(currentPassword).length === 0) {
        return res.status(400).json({
          success: false,
          requiresPasswordVerification: true,
          message: 'Verifikasi kata sandi saat ini wajib diisi untuk mengubah profil.',
        });
      }

      const isPasswordValid = await verifyStoredPassword(
        String(currentPassword),
        current.password
      );
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          requiresPasswordVerification: true,
          message: 'Kata sandi saat ini tidak sesuai. Perubahan profil dibatalkan.',
        });
      }
    }

    const nextName =
      name !== undefined && String(name).trim().length > 0
        ? String(name).trim().toUpperCase()
        : current.name;

    let nextPhone: string | null = current.phone;
    if (phone !== undefined) {
      const trimmedPhone = phone === null ? '' : String(phone).trim();
      if (trimmedPhone.length === 0) {
        nextPhone = null;
      } else {
        if (!/^[0-9+\-\s]{8,20}$/.test(trimmedPhone)) {
          return res.status(400).json({
            success: false,
            message: 'Format nomor telepon tidak valid (minimal 8 digit angka).',
          });
        }
        nextPhone = trimmedPhone;
      }
    }

    let nextBirthDate: string | null = current.birth_date;
    if (birthDate !== undefined) {
      const trimmedBirth = birthDate === null ? '' : String(birthDate).trim();
      nextBirthDate = trimmedBirth.length > 0 ? trimmedBirth : null;
    }

    const nextAvatarUrl = avatarUrl !== undefined ? avatarUrl : current.avatar_url;

    await pool.query(
      `UPDATE customers
       SET name = ?, phone = ?, birth_date = ?, avatar_url = ?, updated_at = NOW()
       WHERE id = ?`,
      [nextName, nextPhone, nextBirthDate, nextAvatarUrl, customerId]
    );

    const [updatedRows]: any = await pool.query(
      `SELECT id, name, email, phone, birth_date, avatar_url, google_id, password, member_badge, points, created_at
       FROM customers WHERE id = ?`,
      [customerId]
    );

    return res.json({
      success: true,
      message: 'Profil berhasil diperbarui!',
      profile: mapProfileRow(updatedRows[0]),
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
 * 3. Verifikasi Kata Sandi Saat Ini Sebelum Ubah Profil atau Ubah Kata Sandi
 */
export const verifyCurrentPassword = async (req: Request, res: Response): Promise<any> => {
  try {
    const customerId = req.customer?.id;
    if (!customerId) {
      return res.status(401).json({
        success: false,
        verified: false,
        message: 'Pengguna belum terautentikasi.',
      });
    }

    const [rows]: any = await pool.query(
      'SELECT password FROM customers WHERE id = ?',
      [customerId]
    );
    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        verified: false,
        message: 'Pengguna tidak ditemukan.',
      });
    }

    const existingPassword = rows[0].password;
    if (!existingPassword) {
      return res.json({
        success: true,
        verified: true,
        hasPassword: false,
        message: 'Akun Google belum memiliki kata sandi.',
      });
    }

    const { currentPassword } = req.body;
    if (!currentPassword || String(currentPassword).length === 0) {
      return res.status(400).json({
        success: false,
        verified: false,
        message: 'Kata sandi saat ini wajib diisi.',
      });
    }

    const isMatch = await verifyStoredPassword(String(currentPassword), existingPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        verified: false,
        message: 'Kata sandi saat ini tidak sesuai.',
      });
    }

    return res.json({
      success: true,
      verified: true,
      hasPassword: true,
      message: 'Verifikasi kata sandi berhasil!',
    });
  } catch (error: any) {
    console.error('Error verifyCurrentPassword:', error);
    return res.status(500).json({
      success: false,
      verified: false,
      message: 'Gagal memverifikasi kata sandi.',
      error: error.message,
    });
  }
};

/**
 * 4. Ubah Kata Sandi dari Halaman Pengaturan / Profil Akun
 */
export const changePassword = async (req: Request, res: Response): Promise<any> => {
  try {
    const customerId = req.customer?.id;
    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Pengguna belum terautentikasi.',
      });
    }

    const { currentPassword, newPassword, allowSimilar } = req.body;
    const nextPasswordStr = String(newPassword || '');
    if (!newPassword || nextPasswordStr.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Kata sandi baru minimal harus 6 karakter.',
      });
    }

    const [rows]: any = await pool.query(
      'SELECT password FROM customers WHERE id = ?',
      [customerId]
    );
    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Pengguna tidak ditemukan.',
      });
    }

    const existingPassword = rows[0].password;
    if (existingPassword) {
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          message: 'Kata sandi saat ini wajib diisi.',
        });
      }

      const isMatch = await verifyStoredPassword(String(currentPassword), existingPassword);
      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: 'Kata sandi saat ini tidak sesuai.',
        });
      }

      const plaintextSimilarity = comparePlaintextPasswordSimilarity(
        String(currentPassword),
        nextPasswordStr
      );
      const similarity =
        plaintextSimilarity !== 'distinct'
          ? plaintextSimilarity
          : await checkHashedPasswordSimilarity(existingPassword, nextPasswordStr);

      if (similarity === 'identical') {
        return res.status(400).json({
          success: false,
          code: 'PASSWORD_SAME',
          message: 'Kata sandi baru harus berbeda dari kata sandi lama.',
        });
      }

      if (similarity === 'similar' && allowSimilar !== true) {
        return res.status(400).json({
          success: false,
          code: 'PASSWORD_TOO_SIMILAR',
          isWarning: true,
          message:
            'Peringatan: Kata sandi baru Anda hampir sama dengan kata sandi sebelumnya. Demi keamanan, disarankan gunakan kombinasi kata sandi yang lebih berbeda.',
        });
      }
    }

    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(nextPasswordStr, salt);
    await pool.query('UPDATE customers SET password = ?, updated_at = NOW() WHERE id = ?', [
      hashed,
      customerId,
    ]);

    return res.json({
      success: true,
      message: 'Kata sandi berhasil diperbarui!',
    });
  } catch (error: any) {
    console.error('Error changePassword:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memperbarui kata sandi.',
      error: error.message,
    });
  }
};

/**
 * 4. Ambil Saldo Poin & Riwayat Transaksi Cashback Poin
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

    const [custRows]: any = await pool.query(
      'SELECT points, member_badge FROM customers WHERE id = ?',
      [customerId]
    );

    const currentPoints = custRows?.[0]?.points || 0;
    const memberBadge = custRows?.[0]?.member_badge || 'Member BreakFree';

    const [historyRows]: any = await pool.query(
      `SELECT id, transaction_id AS order_id, type, points, description, created_at
       FROM point_logs
       WHERE user_id = ?
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

/**
 * 5. Ambil Notifikasi Real-Time dari Pesanan, Mutasi Poin, dan Promo Aktif di MySQL
 */
export const getNotifications = async (req: Request, res: Response): Promise<any> => {
  try {
    const customerId = req.customer?.id;
    const notifications: any[] = [];

    if (customerId) {
      // A. Notifikasi status pesanan pelanggan terbaru
      const [orders]: any = await pool.query(
        `SELECT order_id, queue_number, status, cancel_reason, barista_note, updated_at, created_at
         FROM mobile_orders
         WHERE customer_id = ?
         ORDER BY updated_at DESC LIMIT 10`,
        [customerId]
      );

      for (const o of orders) {
        const st = String(o.status || '').toLowerCase();
        let title = `Pesanan ${o.order_id} (${o.queue_number})`;
        let subtitle = o.barista_note || 'Pesanan sedang ditangani.';
        if (st === 'siapdiambil') {
          title = 'Pesananmu siap diambil!';
          subtitle = `Antrean ${o.queue_number} (${o.order_id}) siap diambil di counter bar.`;
        } else if (st === 'diproses') {
          title = `Barista sedang meracik ${o.queue_number}`;
        } else if (st === 'dibatalkan') {
          title = `Pesanan ${o.order_id} Dibatalkan`;
          subtitle = o.cancel_reason || o.barista_note || 'Pesanan dibatalkan oleh kasir.';
        } else if (st === 'selesai') {
          title = `Pesanan ${o.order_id} Selesai`;
          subtitle = 'Terima kasih sudah singgah di BreakFree Coffee!';
        } else if (st === 'menunggupembayaran') {
          title = `Menunggu Pembayaran ${o.order_id}`;
          subtitle = 'Silakan selesaikan pembayaran tunai di kasir.';
        }

        notifications.push({
          id: `order-${o.order_id}`,
          category: 'Pesanan',
          title,
          subtitle,
          orderId: o.order_id,
          createdAt: o.updated_at || o.created_at,
          isUnread: ['menunggupembayaran', 'diterima', 'diproses', 'siapdiambil', 'dibatalkan'].includes(st),
        });
      }

      // B. Notifikasi mutasi poin real dari point_logs
      const [pointLogs]: any = await pool.query(
        `SELECT id, transaction_id, type, points, description, created_at
         FROM point_logs
         WHERE user_id = ?
         ORDER BY id DESC LIMIT 10`,
        [customerId]
      );

      for (const p of pointLogs) {
        const pts = Number(p.points) || 0;
        const prefix = pts > 0 ? `+${pts}` : `${pts}`;
        notifications.push({
          id: `point-${p.id}`,
          category: 'Poin & member',
          title:
            p.type === 'VOID_REFUND'
              ? `Penyesuaian ${prefix} poin`
              : p.type === 'REDEEM'
                ? `Tukar ${Math.abs(pts)} poin`
                : `+${pts} poin cashback masuk`,
          subtitle: p.description,
          createdAt: p.created_at,
          isUnread: false,
        });
      }
    }

    // C. Notifikasi Promo Aktif langsung dari tabel discounts
    const [promos]: any = await pool.query(
      `SELECT id, code, title, description, type, value, min_purchase, max_discount, updated_at, created_at
       FROM discounts
       WHERE is_active = 1
       ORDER BY id DESC LIMIT 5`
    );

    for (const pr of promos) {
      const valText =
        pr.type === 'PERCENTAGE'
          ? `${Number(pr.value)}%`
          : `Rp ${Number(pr.value).toLocaleString('id-ID')}`;
      notifications.push({
        id: `promo-${pr.id}`,
        category: 'Promo',
        title: `${pr.title || pr.code} (${valText})`,
        subtitle: pr.description || `Gunakan kode ${pr.code} di keranjang belanja.`,
        createdAt: pr.updated_at || pr.created_at,
        isUnread: true,
      });
    }

    notifications.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return res.json({
      success: true,
      count: notifications.length,
      notifications,
    });
  } catch (error: any) {
    console.error('Error getNotifications:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat notifikasi.',
      error: error.message,
    });
  }
};
