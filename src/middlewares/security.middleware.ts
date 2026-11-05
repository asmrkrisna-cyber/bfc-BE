import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

/**
 * 1. Helmet Middleware
 * Memasang 13 header keamanan HTTP otomatis, mengaktifkan HSTS,
 * dan menghilangkan header X-Powered-By.
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: false, // Non-aktifkan CSP strict untuk REST API JSON
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

/**
 * 2. Rate Limiter Global (Seluruh API)
 * Mencegah banjir spam request (DDoS ringan / bot scraping).
 */
export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 300, // Maksimal 300 request per window per IP
  standardHeaders: true, // Mengembalikan info rate limit di header `RateLimit-*`
  legacyHeaders: false, // Non-aktifkan header usang `X-RateLimit-*`
  message: {
    status: 429,
    message: 'Terlalu banyak permintaan dari IP ini. Silakan coba lagi setelah 15 menit.',
  },
});

/**
 * 3. Rate Limiter Ketat untuk Autentikasi & Verifikasi PIN
 * Mencegah serangan brute-force tebak password / PIN kasir.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 15, // Maksimal 15 percobaan login/PIN gagal per 15 menit
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 429,
    message: 'Terlalu banyak percobaan login/PIN yang gagal. Akses ditangguhkan sementara selama 15 menit.',
  },
});

