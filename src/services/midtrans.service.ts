import crypto from 'crypto';
import pool from '../config/database';
import { confirmCashOrderPoints, refundOrderPoints } from './point.service';

export interface MidtransItemDetail {
  id: string;
  price: number;
  quantity: number;
  name: string;
}

export interface CreateSnapParams {
  internalOrderId: string;
  grossAmount: number;
  items: MidtransItemDetail[];
  discountAmount?: number;
  taxAmount?: number;
  customer?: {
    firstName?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  enabledPayments?: string[];
}

export interface MidtransSnapResult {
  token: string;
  redirectUrl: string;
  midtransOrderId: string;
  isProduction: boolean;
}

export interface MidtransStatusSyncResult {
  found: boolean;
  orderId: string;
  midtransOrderId: string | null;
  transactionStatus: string;
  paymentStatus: 'PENDING' | 'PAID' | 'CANCELLED' | 'EXPIRED' | 'FAILED';
  paymentChannel: string | null;
  paymentMethodLabel: string | null;
  snapRedirectUrl: string | null;
  isPaid: boolean;
  isFailed: boolean;
  grossAmount: number;
  message: string;
}

function getMidtransConfig() {
  const serverKey = (process.env.MIDTRANS_SERVER_KEY || '').trim();
  const clientKey = (process.env.MIDTRANS_CLIENT_KEY || '').trim();
  const isProduction =
    String(process.env.MIDTRANS_IS_PRODUCTION || 'false').toLowerCase() === 'true';

  if (!serverKey) {
    throw new Error('MIDTRANS_SERVER_KEY belum dikonfigurasi di file .env backend.');
  }

  const snapBaseUrl = isProduction
    ? 'https://app.midtrans.com/snap/v1/transactions'
    : 'https://app.sandbox.midtrans.com/snap/v1/transactions';

  const coreApiBaseUrl = isProduction
    ? 'https://api.midtrans.com/v2'
    : 'https://api.sandbox.midtrans.com/v2';

  const authHeader = 'Basic ' + Buffer.from(`${serverKey}:`).toString('base64');

  return {
    serverKey,
    clientKey,
    isProduction,
    snapBaseUrl,
    coreApiBaseUrl,
    authHeader,
  };
}

export function buildMidtransOrderId(internalOrderId: string): string {
  const cleanBase = internalOrderId.replace(/[^a-zA-Z0-9_-]/g, '');
  const suffix = Date.now().toString(36).toUpperCase();
  const combined = `${cleanBase}-${suffix}`;
  return combined.slice(0, 50);
}

export function formatMidtransPaymentLabel(paymentType?: string | null, extraDetail?: string | null): string {
  const pt = String(paymentType || '').trim().toLowerCase();
  const extra = String(extraDetail || '').trim().toUpperCase();

  switch (pt) {
    case 'qris':
      return 'QRIS (Midtrans)';
    case 'gopay':
      return 'GoPay (Midtrans)';
    case 'dana':
      return 'DANA (Midtrans)';
    case 'ovo':
      return 'OVO (Midtrans)';
    case 'shopeepay':
      return 'ShopeePay (Midtrans)';
    case 'bank_transfer':
      return extra ? `${extra} VA (Midtrans)` : 'Virtual Account (Midtrans)';
    case 'echannel':
      return 'Mandiri Bill (Midtrans)';
    case 'permata':
      return 'Permata VA (Midtrans)';
    case 'cstore':
      return extra ? `${extra} (Midtrans)` : 'Gerai Retail (Midtrans)';
    case 'credit_card':
      return 'Kartu Kredit (Midtrans)';
    default:
      return pt ? `${pt.toUpperCase()} (Midtrans)` : 'Midtrans Online';
  }
}

function buildReconciledItems(params: CreateSnapParams): MidtransItemDetail[] {
  const list: MidtransItemDetail[] = params.items.map((item, idx) => ({
    id: String(item.id || `item-${idx + 1}`).slice(0, 50),
    price: Math.round(Number(item.price) || 0),
    quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
    name: String(item.name || 'Menu BreakFree').slice(0, 50),
  }));

  const discount = Math.round(Number(params.discountAmount) || 0);
  if (discount > 0) {
    list.push({
      id: 'DISCOUNT',
      price: -discount,
      quantity: 1,
      name: 'Diskon Voucher / Poin BreakFree',
    });
  }

  const tax = Math.round(Number(params.taxAmount) || 0);
  if (tax > 0) {
    list.push({
      id: 'TAX-PPN',
      price: tax,
      quantity: 1,
      name: 'PPN 10%',
    });
  }

  const itemsTotal = list.reduce((sum, it) => sum + it.price * it.quantity, 0);
  const targetGross = Math.round(Number(params.grossAmount) || 0);
  const diff = targetGross - itemsTotal;
  if (diff !== 0) {
    list.push({
      id: 'ADJ',
      price: diff,
      quantity: 1,
      name: 'Penyesuaian Pembulatan',
    });
  }

  return list;
}

export async function createMidtransSnapTransaction(
  params: CreateSnapParams
): Promise<MidtransSnapResult> {
  const cfg = getMidtransConfig();
  const midtransOrderId = buildMidtransOrderId(params.internalOrderId);
  const grossAmount = Math.max(100, Math.round(Number(params.grossAmount) || 0));

  const payload: any = {
    transaction_details: {
      order_id: midtransOrderId,
      gross_amount: grossAmount,
    },
    item_details: buildReconciledItems({ ...params, grossAmount }),
    customer_details: {
      first_name: (params.customer?.firstName || 'Pelanggan BreakFree').slice(0, 50),
      ...(params.customer?.email ? { email: params.customer.email } : {}),
      ...(params.customer?.phone ? { phone: params.customer.phone } : {}),
    },
  };

  if (params.enabledPayments && params.enabledPayments.length > 0) {
    payload.enabled_payments = params.enabledPayments;
  }

  const response = await fetch(cfg.snapBaseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: cfg.authHeader,
    },
    body: JSON.stringify(payload),
  });

  const data: any = await response.json().catch(() => ({}));
  if (!response.ok || !data.token || !data.redirect_url) {
    const errMessages = Array.isArray(data?.error_messages)
      ? data.error_messages.join(', ')
      : data?.status_message || `HTTP ${response.status}`;
    throw new Error(`Midtrans Snap gagal: ${errMessages}`);
  }

  return {
    token: String(data.token),
    redirectUrl: String(data.redirect_url),
    midtransOrderId,
    isProduction: cfg.isProduction,
  };
}

export async function fetchMidtransOrderStatus(midtransOrderId: string) {
  const cfg = getMidtransConfig();
  const response = await fetch(
    `${cfg.coreApiBaseUrl}/${encodeURIComponent(midtransOrderId)}/status`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: cfg.authHeader,
      },
      signal: AbortSignal.timeout(5000),
    }
  );

  const data: any = await response.json().catch(() => ({}));
  return {
    httpStatus: response.status,
    data,
  };
}

export function verifyMidtransWebhookSignature(body: {
  order_id?: string;
  status_code?: string;
  gross_amount?: string | number;
  signature_key?: string;
}): boolean {
  const cfg = getMidtransConfig();
  const orderId = String(body.order_id || '');
  const statusCode = String(body.status_code || '');
  const grossAmount = String(body.gross_amount || '');
  const signatureKey = String(body.signature_key || '').toLowerCase();

  if (!orderId || !statusCode || !grossAmount || !signatureKey) {
    return false;
  }

  const expected = crypto
    .createHash('sha512')
    .update(`${orderId}${statusCode}${grossAmount}${cfg.serverKey}`)
    .digest('hex')
    .toLowerCase();

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureKey));
  } catch {
    return false;
  }
}

export function mapMidtransStatus(
  transactionStatus?: string | null,
  fraudStatus?: string | null
): 'PENDING' | 'PAID' | 'CANCELLED' | 'EXPIRED' | 'FAILED' {
  const txStatus = String(transactionStatus || '').toLowerCase().trim();
  const fraud = String(fraudStatus || 'accept').toLowerCase().trim();

  if (txStatus === 'settlement') return 'PAID';
  if (txStatus === 'capture') {
    return fraud === 'accept' ? 'PAID' : 'FAILED';
  }
  if (txStatus === 'pending' || txStatus === '') return 'PENDING';
  if (txStatus === 'expire') return 'EXPIRED';
  if (txStatus === 'cancel') return 'CANCELLED';
  if (txStatus === 'deny' || txStatus === 'failure' || txStatus === 'refund') return 'FAILED';
  return 'PENDING';
}

/**
 * Menerapkan hasil status transaksi Midtrans secara idempoten ke mobile_orders, transactions, kitchen_orders, dan point_logs.
 */
export async function applyMidtransStatusToDatabase(
  orderLookupId: string,
  payload: {
    midtransOrderId?: string | null;
    transactionId?: string | null;
    transactionStatus?: string | null;
    fraudStatus?: string | null;
    paymentType?: string | null;
    vaBank?: string | null;
    storeName?: string | null;
    grossAmount?: number | string | null;
  }
): Promise<MidtransStatusSyncResult> {
  const cleanLookup = decodeURIComponent(String(orderLookupId || '')).trim();
  const withHash = cleanLookup.startsWith('#') ? cleanLookup : `#${cleanLookup}`;

  const [moRows]: any = await pool.query(
    `SELECT * FROM mobile_orders
     WHERE order_id = ? OR order_id = ? OR midtrans_order_id = ?
     ORDER BY id DESC LIMIT 1`,
    [cleanLookup, withHash, cleanLookup]
  );

  const [trxRows]: any = await pool.query(
    `SELECT * FROM transactions
     WHERE transaction_id = ? OR transaction_id = ? OR midtrans_order_id = ?
     ORDER BY id DESC LIMIT 1`,
    [cleanLookup, withHash, cleanLookup]
  );

  const mo = moRows && moRows.length > 0 ? moRows[0] : null;
  const trx = trxRows && trxRows.length > 0 ? trxRows[0] : null;

  if (!mo && !trx) {
    return {
      found: false,
      orderId: cleanLookup,
      midtransOrderId: payload.midtransOrderId || null,
      transactionStatus: String(payload.transactionStatus || 'not_found'),
      paymentStatus: 'FAILED',
      paymentChannel: null,
      paymentMethodLabel: null,
      snapRedirectUrl: null,
      isPaid: false,
      isFailed: false,
      grossAmount: Number(payload.grossAmount) || 0,
      message: 'Transaksi tidak ditemukan di database.',
    };
  }

  const internalOrderId = mo?.order_id || trx?.transaction_id;
  const midtransOrderId =
    payload.midtransOrderId || mo?.midtrans_order_id || trx?.midtrans_order_id || null;
  const mappedPaymentStatus = mapMidtransStatus(
    payload.transactionStatus,
    payload.fraudStatus
  );
  const channel = payload.paymentType || mo?.payment_channel || trx?.payment_channel || null;
  const paymentMethodLabel = payload.paymentType
    ? formatMidtransPaymentLabel(payload.paymentType, payload.vaBank || payload.storeName)
    : mo?.payment_method || trx?.payment_method || 'Midtrans';
  const grossAmount = Math.round(
    Number(payload.grossAmount ?? trx?.total ?? mo?.total_price ?? 0)
  );
  const snapRedirectUrl = mo?.snap_redirect_url || trx?.snap_redirect_url || null;

  if (mappedPaymentStatus === 'PAID') {
    await pool.query(
      `UPDATE transactions
       SET status = CASE
             WHEN UPPER(COALESCE(status, '')) IN ('CANCELLED', 'VOID', 'DIBATALKAN') THEN status
             ELSE 'PAID'
           END,
           payment_status = 'PAID',
           payment_channel = COALESCE(?, payment_channel),
           payment_method = COALESCE(?, payment_method),
           midtrans_transaction_id = COALESCE(?, midtrans_transaction_id),
           paid_at = COALESCE(paid_at, NOW())
       WHERE transaction_id = ?`,
      [channel, paymentMethodLabel, payload.transactionId || null, internalOrderId]
    );

    if (mo) {
      await pool.query(
        `UPDATE mobile_orders
         SET status = CASE
               WHEN status IN ('menungguPembayaran', 'diterima') THEN 'diproses'
               ELSE status
             END,
             barista_note = CASE
               WHEN status IN ('menungguPembayaran', 'diterima') THEN 'Pembayaran online terkonfirmasi otomatis via Midtrans! Pesanan langsung diproses oleh barista.'
               ELSE barista_note
             END,
             estimated_minutes = CASE
               WHEN status IN ('menungguPembayaran', 'diterima') THEN 8
               ELSE estimated_minutes
             END,
             payment_status = 'PAID',
             payment_channel = COALESCE(?, payment_channel),
             payment_method = COALESCE(?, payment_method),
             paid_at = COALESCE(paid_at, NOW()),
             updated_at = NOW()
         WHERE order_id = ?`,
        [channel, paymentMethodLabel, internalOrderId]
      );
    }

    await pool.query(
      `UPDATE kitchen_orders
       SET status = CASE
             WHEN status IN ('Menunggu Bayar', 'Baru') THEN 'Diproses'
             ELSE status
           END,
           payment_method = COALESCE(?, payment_method)
       WHERE transaction_id = ?`,
      [paymentMethodLabel, internalOrderId]
    );

    await confirmCashOrderPoints(internalOrderId);

    return {
      found: true,
      orderId: internalOrderId,
      midtransOrderId,
      transactionStatus: String(payload.transactionStatus || 'settlement'),
      paymentStatus: 'PAID',
      paymentChannel: channel,
      paymentMethodLabel,
      snapRedirectUrl,
      isPaid: true,
      isFailed: false,
      grossAmount,
      message: 'Pembayaran Midtrans berhasil dikonfirmasi!',
    };
  }

  if (
    mappedPaymentStatus === 'CANCELLED' ||
    mappedPaymentStatus === 'EXPIRED' ||
    mappedPaymentStatus === 'FAILED'
  ) {
    const cancelReason =
      mappedPaymentStatus === 'EXPIRED'
        ? 'Pembayaran Midtrans kedaluwarsa'
        : mappedPaymentStatus === 'CANCELLED'
          ? 'Pembayaran Midtrans dibatalkan'
          : 'Pembayaran Midtrans gagal';

    await pool.query(
      `UPDATE transactions
       SET status = CASE
             WHEN UPPER(COALESCE(status, '')) = 'PAID' OR payment_status = 'PAID' THEN status
             ELSE 'CANCELLED'
           END,
           payment_status = CASE
             WHEN payment_status = 'PAID' THEN 'PAID'
             ELSE ?
           END,
           cancel_reason = COALESCE(cancel_reason, ?)
       WHERE transaction_id = ?`,
      [mappedPaymentStatus, cancelReason, internalOrderId]
    );

    if (mo) {
      await pool.query(
        `UPDATE mobile_orders
         SET status = CASE
               WHEN payment_status = 'PAID' THEN status
               ELSE 'dibatalkan'
             END,
             payment_status = CASE
               WHEN payment_status = 'PAID' THEN 'PAID'
               ELSE ?
             END,
             cancel_reason = COALESCE(cancel_reason, ?),
             barista_note = CASE
               WHEN payment_status = 'PAID' THEN barista_note
               ELSE ?
             END,
             updated_at = NOW()
         WHERE order_id = ?`,
        [mappedPaymentStatus, cancelReason, cancelReason, internalOrderId]
      );
    }

    await pool.query(
      `UPDATE kitchen_orders
       SET status = 'Dibatalkan',
           cancel_reason = COALESCE(cancel_reason, ?)
       WHERE transaction_id = ? AND status = 'Menunggu Bayar'`,
      [cancelReason, internalOrderId]
    );

    await refundOrderPoints(internalOrderId, cancelReason);

    return {
      found: true,
      orderId: internalOrderId,
      midtransOrderId,
      transactionStatus: String(payload.transactionStatus || mappedPaymentStatus.toLowerCase()),
      paymentStatus: mappedPaymentStatus,
      paymentChannel: channel,
      paymentMethodLabel,
      snapRedirectUrl,
      isPaid: false,
      isFailed: true,
      grossAmount,
      message: cancelReason,
    };
  }

  return {
    found: true,
    orderId: internalOrderId,
    midtransOrderId,
    transactionStatus: String(payload.transactionStatus || 'pending'),
    paymentStatus: 'PENDING',
    paymentChannel: channel,
    paymentMethodLabel,
    snapRedirectUrl,
    isPaid: false,
    isFailed: false,
    grossAmount,
    message: 'Menunggu pelanggan menyelesaikan pembayaran di Midtrans.',
  };
}

/**
 * Mengecek status pembayaran langsung ke Midtrans API lalu menyinkronkan ke MySQL.
 */
export async function checkAndSyncMidtransStatus(
  orderIdOrMidtransId: string
): Promise<MidtransStatusSyncResult> {
  const cleanId = decodeURIComponent(String(orderIdOrMidtransId || '')).trim();
  const withHash = cleanId.startsWith('#') ? cleanId : `#${cleanId}`;

  const [moRows]: any = await pool.query(
    `SELECT * FROM mobile_orders
     WHERE order_id = ? OR order_id = ? OR midtrans_order_id = ?
     ORDER BY id DESC LIMIT 1`,
    [cleanId, withHash, cleanId]
  );

  const [trxRows]: any = await pool.query(
    `SELECT * FROM transactions
     WHERE transaction_id = ? OR transaction_id = ? OR midtrans_order_id = ?
     ORDER BY id DESC LIMIT 1`,
    [cleanId, withHash, cleanId]
  );

  const mo = moRows && moRows.length > 0 ? moRows[0] : null;
  const trx = trxRows && trxRows.length > 0 ? trxRows[0] : null;

  if (!mo && !trx) {
    return {
      found: false,
      orderId: cleanId,
      midtransOrderId: null,
      transactionStatus: 'not_found',
      paymentStatus: 'FAILED',
      paymentChannel: null,
      paymentMethodLabel: null,
      snapRedirectUrl: null,
      isPaid: false,
      isFailed: false,
      grossAmount: 0,
      message: `Pesanan "${cleanId}" tidak ditemukan.`,
    };
  }

  const internalOrderId = mo?.order_id || trx?.transaction_id;
  const midtransOrderId = mo?.midtrans_order_id || trx?.midtrans_order_id;
  const currentPaymentStatus = String(
    mo?.payment_status || trx?.payment_status || 'PENDING'
  ).toUpperCase();
  const currentTrxStatus = String(trx?.status || '').toUpperCase();

  if (
    currentPaymentStatus === 'PAID' ||
    currentTrxStatus === 'PAID' ||
    currentTrxStatus === 'SUKSES'
  ) {
    return {
      found: true,
      orderId: internalOrderId,
      midtransOrderId,
      transactionStatus: 'settlement',
      paymentStatus: 'PAID',
      paymentChannel: mo?.payment_channel || trx?.payment_channel || null,
      paymentMethodLabel: mo?.payment_method || trx?.payment_method || 'Midtrans',
      snapRedirectUrl: mo?.snap_redirect_url || trx?.snap_redirect_url || null,
      isPaid: true,
      isFailed: false,
      grossAmount: Math.round(Number(trx?.total ?? mo?.total_price ?? 0)),
      message: 'Pembayaran sudah lunas.',
    };
  }

  if (!midtransOrderId) {
    return {
      found: true,
      orderId: internalOrderId,
      midtransOrderId: null,
      transactionStatus: 'pending',
      paymentStatus: 'PENDING',
      paymentChannel: null,
      paymentMethodLabel: mo?.payment_method || trx?.payment_method || null,
      snapRedirectUrl: null,
      isPaid: false,
      isFailed: false,
      grossAmount: Math.round(Number(trx?.total ?? mo?.total_price ?? 0)),
      message: 'Transaksi tidak menggunakan Midtrans atau menunggu konfirmasi kasir.',
    };
  }

  const mtRes = await fetchMidtransOrderStatus(midtransOrderId);
  let mtData = mtRes.data || {};
  let mtCode = String(mtData.status_code || '');

  // Fallback ke Snap Token Status API bila Core API v2 mengembalikan 404
  // (terjadi pada metode seperti DANA Sandbox di mana Core API memakai ID transaksi internal berbeda)
  const snapToken = mo?.snap_token || trx?.snap_token || null;
  if ((mtCode === '404' || mtRes.httpStatus === 404) && snapToken) {
    const cfg = getMidtransConfig();
    const snapResp = await fetch(
      `${cfg.snapBaseUrl}/${encodeURIComponent(snapToken)}/status`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      }
    ).catch(() => null);

    if (snapResp && snapResp.ok) {
      const snapData: any = await snapResp.json().catch(() => ({}));
      if (snapData && snapData.transaction_status && String(snapData.status_code || '') !== '404') {
        mtData = snapData;
        mtCode = String(snapData.status_code || '200');
      }
    }
  }

  // Jika user belum memilih channel di halaman Snap, Midtrans Status API mengembalikan status_code 404.
  if (mtCode === '404' || (mtRes.httpStatus === 404 && !mtData.transaction_status)) {
    return {
      found: true,
      orderId: internalOrderId,
      midtransOrderId,
      transactionStatus: 'pending',
      paymentStatus: 'PENDING',
      paymentChannel: null,
      paymentMethodLabel: mo?.payment_method || trx?.payment_method || 'Midtrans',
      snapRedirectUrl: mo?.snap_redirect_url || trx?.snap_redirect_url || null,
      isPaid: false,
      isFailed: false,
      grossAmount: Math.round(Number(trx?.total ?? mo?.total_price ?? 0)),
      message: 'Silakan selesaikan pilihan pembayaran Anda pada halaman Midtrans.',
    };
  }

  const vaBank =
    Array.isArray(mtData.va_numbers) && mtData.va_numbers.length > 0
      ? mtData.va_numbers[0].bank
      : mtData.permata_va_number
        ? 'Permata'
        : null;

  return applyMidtransStatusToDatabase(midtransOrderId, {
    midtransOrderId,
    transactionId: mtData.transaction_id || null,
    transactionStatus: mtData.transaction_status || 'pending',
    fraudStatus: mtData.fraud_status || 'accept',
    paymentType: mtData.payment_type || null,
    vaBank,
    storeName: mtData.store || null,
    grossAmount: mtData.gross_amount || null,
  });
}

const pendingSyncThrottle = new Map<string, number>();

/**
 * Menyinkronkan otomatis seluruh pesanan Midtrans yang masih PENDING (dalam 24 jam terakhir),
 * diberi throttle 3 detik per pesanan agar aman dipanggil saat POS Dapur / Riwayat / Mobile polling.
 */
export async function syncPendingMidtransOrders(specificOrderId?: string): Promise<void> {
  try {
    if (!process.env.MIDTRANS_SERVER_KEY?.trim()) return;

    const now = Date.now();
    let candidates: Array<{ orderId: string; midtransOrderId: string }> = [];

    if (specificOrderId && specificOrderId.trim().length > 0) {
      const cleanId = decodeURIComponent(specificOrderId).trim();
      const withHash = cleanId.startsWith('#') ? cleanId : `#${cleanId}`;
      const [rows]: any = await pool.query(
        `SELECT order_id AS orderId, midtrans_order_id AS midtransOrderId
         FROM mobile_orders
         WHERE (order_id = ? OR order_id = ? OR queue_number = ? OR midtrans_order_id = ?)
           AND midtrans_order_id IS NOT NULL
           AND (payment_status = 'PENDING' OR status = 'menungguPembayaran')
         LIMIT 3`,
        [cleanId, withHash, cleanId, cleanId]
      );
      candidates = rows || [];
    } else {
      const [rows]: any = await pool.query(
        `SELECT DISTINCT order_id AS orderId, midtrans_order_id AS midtransOrderId
         FROM (
           SELECT order_id, midtrans_order_id, created_at
           FROM mobile_orders
           WHERE midtrans_order_id IS NOT NULL
             AND (payment_status = 'PENDING' OR status = 'menungguPembayaran')
             AND status NOT IN ('selesai', 'dibatalkan', 'CANCELLED')
             AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
           UNION ALL
           SELECT transaction_id AS order_id, midtrans_order_id, created_at
           FROM transactions
           WHERE midtrans_order_id IS NOT NULL
             AND (payment_status = 'PENDING' OR UPPER(COALESCE(status, '')) = 'PENDING')
             AND UPPER(COALESCE(status, '')) NOT IN ('CANCELLED', 'VOID', 'DIBATALKAN', 'PAID', 'SUKSES')
             AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
         ) AS pending_orders
         LIMIT 6`
      );
      candidates = rows || [];
    }

    const toCheck = candidates.filter((item) => {
      if (!item.midtransOrderId) return false;
      const lastRun = pendingSyncThrottle.get(item.midtransOrderId) || 0;
      if (now - lastRun < 3000) return false;
      pendingSyncThrottle.set(item.midtransOrderId, now);
      return true;
    });

    if (toCheck.length === 0) return;

    await Promise.all(
      toCheck.map(async (item) => {
        try {
          await checkAndSyncMidtransStatus(item.midtransOrderId);
        } catch {
          // Abaikan error sementara agar polling dapur/transaksi tetap responsif
        }
      })
    );
  } catch (err) {
    console.error('syncPendingMidtransOrders warning:', err);
  }
}
