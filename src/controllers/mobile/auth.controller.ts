import { Request, Response } from 'express';
import pool from '../../config/database';
import jwt, { Secret, SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const JWT_SECRET: Secret = (process.env.JWT_SECRET || 'rahasiabanget123') as Secret;

/**
 * 1. Register Pelanggan Baru (Mobile App)
 */
export const registerCustomer = async (req: Request, res: Response): Promise<any> => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Nama lengkap, email, dan kata sandi wajib diisi.',
      });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Kata sandi minimal harus 8 karakter.',
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

    // Hash kata sandi untuk keamanan
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Simpan customer baru dengan bonus awal 100 poin selamat datang
    const initialPoints = 100;
    const [result]: any = await pool.query(
      `INSERT INTO customers (name, email, password, phone, birth_date, member_badge, points, created_at)
       VALUES (?, ?, ?, '0812 •••• 7890', '18 Mei 2000', 'Member Gold', ?, NOW())`,
      [trimmedName.toUpperCase(), trimmedEmail, hashedPassword, initialPoints]
    );

    const customerId = result.insertId;

    // Catat histori poin bonus pendaftaran
    await pool.query(
      `INSERT INTO customer_points_history (customer_id, type, points, description, created_at)
       VALUES (?, 'EARN', ?, 'Bonus Pendaftaran Member Baru BreakFree', NOW())`,
      [customerId, initialPoints]
    );

    // Buat JWT Token
    const token = jwt.sign(
      { id: customerId, email: trimmedEmail, name: trimmedName, role: 'customer' },
      JWT_SECRET,
      { expiresIn: '30d' } as SignOptions
    );

    return res.status(201).json({
      success: true,
      message: `Akun berhasil dibuat! Selamat datang di BreakFree Coffee, ${trimmedName}.`,
      token,
      customer: {
        id: customerId,
        name: trimmedName.toUpperCase(),
        email: trimmedEmail,
        phone: '0812 •••• 7890',
        birthDate: '18 Mei 2000',
        memberBadge: 'Member Gold',
        points: initialPoints,
      },
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
 * 2. Login Pelanggan (Mobile App)
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

    const trimmedEmail = email.trim().toLowerCase();

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

    // Verifikasi password (mendukung hash bcrypt & fallback plaintext untuk data seed awal)
    let isMatch = false;
    if (customer.password.startsWith('$2a$') || customer.password.startsWith('$2b$')) {
      isMatch = await bcrypt.compare(password, customer.password);
    } else {
      isMatch = password === customer.password;
    }

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Email atau kata sandi yang Anda masukkan salah.',
      });
    }

    // Buat JWT Token sesi mobile
    const token = jwt.sign(
      { id: customer.id, email: customer.email, name: customer.name, role: 'customer' },
      JWT_SECRET,
      { expiresIn: '30d' } as SignOptions
    );

    return res.json({
      success: true,
      message: `Berhasil masuk! Selamat datang, ${customer.name}.`,
      token,
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        birthDate: customer.birth_date,
        memberBadge: customer.member_badge,
        points: customer.points,
      },
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
 * 3. Lupa Kata Sandi (Kirim OTP Verifikasi)
 */
export const forgotPassword = async (req: Request, res: Response): Promise<any> => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email wajib diisi.',
      });
    }

    const trimmedEmail = email.trim().toLowerCase();

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

    // Buat kode OTP 6 digit acak
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // Berlaku 15 menit

    await pool.query(
      'UPDATE customers SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
      [otp, expiresAt, rows[0].id]
    );

    return res.json({
      success: true,
      message: 'Kode OTP verifikasi berhasil dikirimkan ke email Anda.',
      otpPreview: otp, // Memudahkan pengujian di aplikasi mobile
    });
  } catch (error: any) {
    console.error('Error forgotPassword:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memproses permintaan reset kata sandi.',
      error: error.message,
    });
  }
};

/**
 * 4. Reset Kata Sandi Baru
 */
export const resetPassword = async (req: Request, res: Response): Promise<any> => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email, kode OTP, dan kata sandi baru wajib diisi.',
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Kata sandi baru minimal harus 8 karakter.',
      });
    }

    const trimmedEmail = email.trim().toLowerCase();

    const [rows]: any = await pool.query(
      `SELECT id FROM customers 
       WHERE email = ? AND reset_token = ? AND reset_token_expires > NOW()`,
      [trimmedEmail, otp]
    );

    if (!rows || rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Kode OTP salah atau telah kedaluwarsa. Silakan minta kode baru.',
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await pool.query(
      'UPDATE customers SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
      [hashedPassword, rows[0].id]
    );

    return res.json({
      success: true,
      message: 'Kata sandi berhasil diperbarui! Silakan masuk dengan kata sandi baru Anda.',
    });
  } catch (error: any) {
    console.error('Error resetPassword:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memperbarui kata sandi.',
      error: error.message,
    });
  }
};
