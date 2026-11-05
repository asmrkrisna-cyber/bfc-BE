import express, { Application } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import v1Router from './routes/v1';
import { httpLogger } from './utils/logger';
import { securityHeaders, globalRateLimiter, authRateLimiter } from './middlewares/security.middleware';
import { notFoundHandler, globalErrorHandler } from './middlewares/error.middleware';

dotenv.config();

const app: Application = express();

// 0. Pengaturan Trust Proxy (Wajib aktif jika di belakang reverse proxy seperti Nginx / Docker / Cloudflare)
app.set('trust proxy', 1);

// 1. LOGGER (Pino-HTTP): Diletakkan pertama agar mencatat semua request dan menempelkan Request ID
app.use(httpLogger);

// 2. HELMET: Dipasang sebelum routing untuk mengamankan 13 header HTTP & hapus X-Powered-By
app.use(securityHeaders);

// 3. CORS & BODY PARSERS
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 4. RATE LIMITER: Pembatasan laju request sebelum routing
app.use('/api', globalRateLimiter);
app.use('/api/v1/auth/login', authRateLimiter);
app.use('/api/v1/cashiers/verify-pin', authRateLimiter);

// 5. ROUTE / ENDPOINT: Terletak di tengah aplikasi
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    message: 'BreakFree POS Backend API is running securely!',
    version: '1.0.0',
    requestId: res.getHeader('X-Request-Id'),
  });
});

app.use('/api/v1', v1Router);

// 6. 404 NOT FOUND HANDLER: Untuk endpoint yang tidak terdaftar
app.use(notFoundHandler);

// 7. GLOBAL ERROR HANDLER: Diletakkan di urutan paling akhir dengan 4 argumen (err, req, res, next)
app.use(globalErrorHandler);

export default app;
