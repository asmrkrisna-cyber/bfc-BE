import pino from 'pino';
import pinoHttp from 'pino-http';
import crypto from 'crypto';
import { Request, Response } from 'express';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * 1. Konfigurasi Pino Logger dengan Fitur Sensor (Redaction) Data Sensitif
 * Sesuai Dokumen: Password, token, cookie, header Authorization tidak boleh dicatat.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.pin',
      'body.password',
      'body.pin',
      '*.password',
      '*.pin',
      'token',
      'user.password',
    ],
    censor: '[REDACTED]',
  },
  transport: !isProduction
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

/**
 * 2. HTTP Logger Middleware (pino-http)
 * Menempelkan Request ID unik ke setiap request dan response header.
 */
export const httpLogger = pinoHttp({
  logger,
  genReqId: (req: Request, res: Response): string => {
    const existingId = req.headers['x-request-id'] as string;
    const reqId = existingId || crypto.randomUUID();
    res.setHeader('X-Request-Id', reqId);
    return reqId;
  },
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} -> ${res.statusCode}`;
  },
  customErrorMessage: (req, res, err) => {
    return `${req.method} ${req.url} failed with ${res.statusCode}: ${err.message}`;
  },
  customAttributeKeys: {
    req: 'request',
    res: 'response',
    err: 'error',
    responseTime: 'durationMs',
  },
});

