import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

/**
 * 1. 404 Not Found Handler
 * Menangkap seluruh request ke endpoint yang tidak terdaftar.
 */
export const notFoundHandler = (req: Request, res: Response): void => {
  const reqId = (req.id as string) || (res.getHeader('X-Request-Id') as string) || '-';
  res.status(404).json({
    success: false,
    status: 404,
    message: `Rute API [${req.method} ${req.originalUrl}] tidak ditemukan.`,
    requestId: reqId,
  });
};

/**
 * 2. Terminal Global Error Handler (Wajib 4 Argumen: err, req, res, next)
 * Bertindak sebagai 'Pintu Darurat' agar pengunjung tidak melihat isi dapur (stack trace).
 */
export const globalErrorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void => {
  const reqId = (req.id as string) || (res.getHeader('X-Request-Id') as string) || '-';
  const statusCode = err.statusCode || 500;
  const isExpected = statusCode < 500;

  // Catat ke Pino Logger dengan Request ID untuk audit
  if (isExpected) {
    logger.warn({
      requestId: reqId,
      path: req.originalUrl,
      method: req.method,
      statusCode,
      message: err.message,
    }, 'Operational client error occurred');
  } else {
    logger.error({
      requestId: reqId,
      path: req.originalUrl,
      method: req.method,
      statusCode,
      err: {
        message: err.message,
        stack: err.stack,
      },
    }, 'Unexpected server crash/internal error occurred');
  }

  // Response ke client: JANGAN bocorkan stack trace di production!
  res.status(statusCode).json({
    success: false,
    status: statusCode,
    message: isExpected ? err.message : 'Terjadi kesalahan internal pada server.',
    requestId: reqId,
    // Stack trace hanya ditampilkan saat mode pengembangan lokal (development)
    ...(process.env.NODE_ENV !== 'production' && !isExpected ? { stack: err.stack } : {}),
  });
};

