import { Request, Response } from 'express';
import pool from '../../config/database';
import jwt, { Secret, SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import {
  EmailNotConfiguredError,
  sendPasswordResetOtpEmail,
} from '../../services/email.service';
import { checkHashedPasswordSimilarity } from '../../utils/passwordSimilarity';

const JWT_SECRET: Secret = (process.env.JWT_SECRET || 'rahasiabanget123') as Secret;

function formatCustomerPayload(c: any) {
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

function signCustomerToken(c: { id: number; email: string; name: string }) {
  return jwt.sign(
    { id: c.id, email: c.email, name: c.name, role: 'customer' },
    JWT_SECRET,
    { expiresIn: '30d' } as SignOptions
  );
}

/**
 * 1. Register Pelanggan Baru (Mobile App / /api/v1/auth/register)
 * Phone bersifat OPSIONAL: jika kosong atau null, simpan NULL di MySQL.
 */
export const registerCustomer = async (req: Request, res: Response): Promise<any> => {
  try {
    const { name, email, password, phone } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Nama lengkap, email, dan kata sandi wajib diisi.',
      });
    }

    const trimmedEmail = String(email).trim().toLowerCase();
    const trimmedName = String(name).trim();
    const cleanPhone =
      phone !== undefined && phone !== null && String(phone).trim().length > 0
        ? String(phone).trim()
        : null;

    if (String(password).length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Kata sandi minimal harus 8 karakter.',
      });
    }

    if (cleanPhone !== null && !/^[0-9+\-\s]{8,20}$/.test(cleanPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Format nomor telepon tidak valid (minimal 8 digit angka).',
      });
    }

    // Cek apakah email sudah terdaftar
    const [existing]: any = await pool.query(
      'SELECT id FROM customers WHERE email = ?',
      [trimmedEmail]
    );

    if (existing && existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Email sudah terdaftar. Silakan gunakan email lain atau masuk.',
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(String(password), salt);

    const initialPoints = 0;
    const [result]: any = await pool.query(
      `INSERT INTO customers (name, email, password, phone, birth_date, member_badge, points, created_at)
       VALUES (?, ?, ?, ?, NULL, 'Member BreakFree', ?, NOW())`,
      [trimmedName.toUpperCase(), trimmedEmail, hashedPassword, cleanPhone, initialPoints]
    );

    const customerId = result.insertId;
    const [rows]: any = await pool.query('SELECT * FROM customers WHERE id = ?', [customerId]);
    const customer = rows[0];
    const token = signCustomerToken(customer);

    return res.status(201).json({
      success: true,
      message: `Akun berhasil dibuat! Selamat datang di BreakFree Coffee, ${trimmedName}.`,
      token,
      customer: formatCustomerPayload(customer),
    });
  } catch (error: any) {
    console.error('Error registerCustomer:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memproses pendaftaran akun.',
      error: error.message,
    });
  }
};

/**
 * 2. Login Pelanggan Manual (Mobile App)
 */
export const loginCustomer = async (req: Request, res: Response): Promise<any> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Silakan masukkan email dan kata sandi terlebih dahulu.',
      });
    }

    const trimmedEmail = String(email).trim().toLowerCase();

    const [rows]: any = await pool.query(
      'SELECT * FROM customers WHERE email = ?',
      [trimmedEmail]
    );

    if (!rows || rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Email atau kata sandi yang Anda masukkan salah.',
      });
    }

    const customer = rows[0];

    if (!customer.password) {
      return res.status(400).json({
        success: false,
        message: 'Akun ini terdaftar menggunakan Google. Silakan masuk dengan tombol Google.',
      });
    }

    let isMatch = false;
    if (customer.password.startsWith('$2a$') || customer.password.startsWith('$2b$')) {
      isMatch = await bcrypt.compare(String(password), customer.password);
    } else {
      isMatch = String(password) === customer.password;
    }

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Email atau kata sandi yang Anda masukkan salah.',
      });
    }

    const token = signCustomerToken(customer);

    return res.json({
      success: true,
      message: `Berhasil masuk! Selamat datang, ${customer.name}.`,
      token,
      customer: formatCustomerPayload(customer),
    });
  } catch (error: any) {
    console.error('Error loginCustomer:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memproses masuk ke aplikasi.',
      error: error.message,
    });
  }
};

/**
 * 3. Autentikasi Google / Gmail (POST /api/v1/auth/google & /api/v1/mobile/auth/google)
 */
export const googleAuth = async (req: Request, res: Response): Promise<any> => {
  try {
    const idToken = req.body.idToken || req.body.id_token;
    if (!idToken || typeof idToken !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Google ID Token wajib disertakan.',
      });
    }

    const rawClientIds = process.env.GOOGLE_CLIENT_ID || '';
    const audiences = rawClientIds
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.includes('your_google_oauth_client_id'));

    if (audiences.length === 0) {
      return res.status(500).json({
        success: false,
        message: 'GOOGLE_CLIENT_ID belum dikonfigurasi pada file .env backend.',
      });
    }

    const oauthClient = new OAuth2Client(audiences[0]);
    const ticket = await oauthClient.verifyIdToken({
      idToken,
      audience: audiences.length === 1 ? audiences[0] : audiences,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return res.status(401).json({
        success: false,
        message: 'Token Google tidak valid atau tidak memiliki email.',
      });
    }

    const googleId = payload.sub;
    const email = payload.email.trim().toLowerCase();
    const displayName = (payload.name || email.split('@')[0]).trim().toUpperCase();
    const avatarUrl = payload.picture || null;

    // Cari user berdasarkan google_id atau email
    const [existing]: any = await pool.query(
      'SELECT * FROM customers WHERE google_id = ? OR email = ? LIMIT 1',
      [googleId, email]
    );

    let customer: any;
    let isNewAccount = false;

    if (existing && existing.length > 0) {
      customer = existing[0];
      // Lengkapi google_id atau avatar_url bila akun sebelumnya daftar manual
      if (!customer.google_id || (!customer.avatar_url && avatarUrl)) {
        await pool.query(
          `UPDATE customers
           SET google_id = COALESCE(google_id, ?),
               avatar_url = COALESCE(?, avatar_url),
               updated_at = NOW()
           WHERE id = ?`,
          [googleId, avatarUrl, customer.id]
        );
        const [refreshed]: any = await pool.query('SELECT * FROM customers WHERE id = ?', [customer.id]);
        customer = refreshed[0];
      }
    } else {
      isNewAccount = true;
      const [insertRes]: any = await pool.query(
        `INSERT INTO customers (name, email, google_id, avatar_url, password, phone, birth_date, member_badge, points, created_at)
         VALUES (?, ?, ?, ?, NULL, NULL, NULL, 'Member BreakFree', 0, NOW())`,
        [displayName, email, googleId, avatarUrl]
      );
      const [created]: any = await pool.query('SELECT * FROM customers WHERE id = ?', [insertRes.insertId]);
      customer = created[0];
    }

    const token = signCustomerToken(customer);

    return res.status(isNewAccount ? 201 : 200).json({
      success: true,
      isNewAccount,
      message: isNewAccount
        ? `Akun Google berhasil didaftarkan! Selamat datang, ${customer.name}.`
        : `Berhasil masuk dengan Google! Selamat datang, ${customer.name}.`,
      token,
      customer: formatCustomerPayload(customer),
    });
  } catch (error: any) {
    console.error('Error googleAuth:', error);
    return res.status(401).json({
      success: false,
      message: 'Verifikasi akun Google gagal. Pastikan token valid dan GOOGLE_CLIENT_ID sesuai.',
      error: error.message,
    });
  }
};

/**
 * 4. Ambil Data Akun Terautentikasi (GET /api/v1/auth/me)
 */
export const getAuthMe = async (req: Request, res: Response): Promise<any> => {
  try {
    const customerId = req.customer?.id;
    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Pengguna belum terautentikasi.',
      });
    }

    const [rows]: any = await pool.query('SELECT * FROM customers WHERE id = ?', [customerId]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Akun pengguna tidak ditemukan.',
      });
    }

    const formatted = formatCustomerPayload(rows[0]);
    return res.json({
      success: true,
      user: formatted,
      customer: formatted,
    });
  } catch (error: any) {
    console.error('Error getAuthMe:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal mengambil data pengguna.',
      error: error.message,
    });
  }
};

/**
 * 5. Lupa Kata Sandi (Kirim OTP Verifikasi ke Gmail Pengguna via SMTP)
 */
export const forgotPassword = async (req: Request, res: Response): Promise<any> => {
  let customerId: number | null = null;
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email wajib diisi.',
      });
    }

    const trimmedEmail = String(email).trim().toLowerCase();

    const [rows]: any = await pool.query(
      'SELECT id, name FROM customers WHERE email = ?',
      [trimmedEmail]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Email tidak ditemukan di sistem keanggotaan BreakFree.',
      });
    }

    customerId = Number(rows[0].id);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await pool.query(
      'UPDATE customers SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
      [otp, expiresAt, customerId]
    );

    await sendPasswordResetOtpEmail({
      to: trimmedEmail,
      name: rows[0].name,
      otp,
      expiresMinutes: 15,
    });

    return res.json({
      success: true,
      message: `Kode OTP 6 digit telah dikirim ke ${trimmedEmail}. Silakan periksa Kotak Masuk atau folder Spam Gmail Anda.`,
    });
  } catch (error: any) {
    if (customerId) {
      await pool
        .query('UPDATE customers SET reset_token = NULL, reset_token_expires = NULL WHERE id = ?', [
          customerId,
        ])
        .catch(() => {});
    }

    if (error instanceof EmailNotConfiguredError) {
      return res.status(503).json({
        success: false,
        message: error.message,
      });
    }

    console.error('Error forgotPassword:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal mengirim kode OTP ke email. Pastikan konfigurasi SMTP Gmail sudah benar.',
      error: error.message,
    });
  }
};

/**
 * 5b. Verifikasi Kecocokan Kode OTP Sebelum Mengizinkan Input Kata Sandi Baru
 */
export const verifyResetOtp = async (req: Request, res: Response): Promise<any> => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        valid: false,
        message: 'Email dan kode OTP 6 digit wajib diisi.',
      });
    }

    const trimmedEmail = String(email).trim().toLowerCase();
    const trimmedOtp = String(otp).trim();

    if (!/^\d{6}$/.test(trimmedOtp)) {
      return res.status(400).json({
        success: false,
        valid: false,
        message: 'Kode OTP harus berupa 6 digit angka.',
      });
    }

    const [rows]: any = await pool.query(
      `SELECT id FROM customers
       WHERE email = ? AND reset_token = ? AND reset_token_expires > NOW()
       LIMIT 1`,
      [trimmedEmail, trimmedOtp]
    );

    if (!rows || rows.length === 0) {
      return res.status(400).json({
        success: false,
        valid: false,
        message: 'Kode OTP tidak sesuai atau sudah kedaluwarsa.',
      });
    }

    return res.json({
      success: true,
      valid: true,
      message: 'Kode OTP sesuai! Silakan masukkan kata sandi baru Anda.',
    });
  } catch (error: any) {
    console.error('Error verifyResetOtp:', error);
    return res.status(500).json({
      success: false,
      valid: false,
      message: 'Gagal memverifikasi kode OTP.',
      error: error.message,
    });
  }
};

/**
 * 6. Reset Kata Sandi Baru via OTP
 */
export const resetPassword = async (req: Request, res: Response): Promise<any> => {
  try {
    const { email, otp, newPassword, allowSimilar } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email, kode OTP, dan kata sandi baru wajib diisi.',
      });
    }

    const passwordStr = String(newPassword);
    if (passwordStr.length < 8 || !/[a-zA-Z]/.test(passwordStr) || !/[0-9]/.test(passwordStr)) {
      return res.status(400).json({
        success: false,
        message: 'Kata sandi baru minimal 8 karakter serta mengandung huruf dan angka.',
      });
    }

    const trimmedEmail = String(email).trim().toLowerCase();

    const [rows]: any = await pool.query(
      `SELECT id, password FROM customers 
       WHERE email = ? AND reset_token = ? AND reset_token_expires > NOW()`,
      [trimmedEmail, String(otp).trim()]
    );

    if (!rows || rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Kode OTP tidak valid atau sudah kedaluwarsa.',
      });
    }

    const similarity = await checkHashedPasswordSimilarity(rows[0].password, passwordStr);
    if (similarity === 'identical') {
      return res.status(400).json({
        success: false,
        code: 'PASSWORD_SAME',
        message:
          'Kata sandi baru sama persis dengan kata sandi sebelumnya. Silakan gunakan kata sandi yang berbeda.',
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

    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(passwordStr, salt);

    await pool.query(
      'UPDATE customers SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
      [hashed, rows[0].id]
    );

    return res.json({
      success: true,
      message: 'Kata sandi berhasil diperbarui! Silakan masuk menggunakan kata sandi baru.',
    });
  } catch (error: any) {
    console.error('Error resetPassword:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal mengatur ulang kata sandi.',
      error: error.message,
    });
  }
};
