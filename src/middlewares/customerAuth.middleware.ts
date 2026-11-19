import { Request, Response, NextFunction } from 'express';
import jwt, { Secret } from 'jsonwebtoken';

const JWT_SECRET: Secret = (process.env.JWT_SECRET || 'rahasiabanget123') as Secret;

export interface CustomerPayload {
  id: number;
  email: string;
  name: string;
  role?: string;
}

declare global {
  namespace Express {
    interface Request {
      customer?: CustomerPayload;
    }
  }
}

/**
 * Middleware untuk memverifikasi autentikasi pelanggan (Customer App Mobile).
 * Mengharapkan header 'Authorization: Bearer <token>'.
 */
export const customerAuth = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      message: 'Akses ditolak. Token autentikasi pelanggan tidak ditemukan.',
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as CustomerPayload;
    req.customer = decoded;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Token sesi pelanggan tidak valid atau telah kedaluwarsa. Silakan login kembali.',
    });
  }
};

/**
 * Middleware opsional: jika token ada, decode dan tempelkan. Jika tidak ada, lanjutkan sebagai guest.
 */
export const optionalCustomerAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as CustomerPayload;
      req.customer = decoded;
    } catch {
      // Abaikan jika token tidak valid pada mode opsional
    }
  }
  next();
};
