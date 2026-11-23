import pool from '../config/database';

export interface PointRules {
  rate: string;
  cashbackPercent: number;
  minRedeemPoints: number;
  maxDiscountPercent: number;
  stepPoints: number;
}

export const DEFAULT_POINT_RULES: PointRules = {
  rate: '100 poin = Rp 1.000',
  cashbackPercent: 5,
  minRedeemPoints: 100,
  maxDiscountPercent: 25,
  stepPoints: 100,
};

export interface PointRedemptionCalculation {
  pointsUsed: number;
  discountAmount: number;
  remainingPoints: number;
  maxDiscountPercent: number;
}

export interface PointLogItem {
  id: number;
  userId: number;
  transactionId?: string | null;
  type: 'EARN' | 'REDEEM' | 'VOID_REFUND';
  points: number;
  description: string;
  createdAt: string;
}

export interface UserPointsInfo {
  balance: number;
  equivalentRp: number;
  rules: PointRules;
  logs: PointLogItem[];
}

/**
 * Rumus Kalkulasi Pemakaian Poin (Redemption):
 * - Minimal tukar: 100 poin
 * - Kelipatan tukar: 100 poin (usableUserPoints = Math.floor(userBalance / 100) * 100)
 * - Maksimal diskon: 25% dari subtotal pesanan, dibulatkan ke bawah per Rp 1.000
 */
export function calculateRedemption(userBalance: number, subtotal: number): PointRedemptionCalculation {
  const safeBalance = Math.max(0, Number(userBalance) || 0);
  const safeSubtotal = Math.max(0, Number(subtotal) || 0);

  if (safeBalance < DEFAULT_POINT_RULES.minRedeemPoints || safeSubtotal <= 0) {
    return {
      pointsUsed: 0,
      discountAmount: 0,
      remainingPoints: safeBalance,
      maxDiscountPercent: DEFAULT_POINT_RULES.maxDiscountPercent,
    };
  }

  // Wajib kelipatan 100 poin
  const usableUserPoints = Math.floor(safeBalance / DEFAULT_POINT_RULES.stepPoints) * DEFAULT_POINT_RULES.stepPoints;

  // Batas maksimal potongan: 25% dari subtotal, dibulatkan ke bawah per Rp 1.000
  const maxDiscountRp = Math.floor((safeSubtotal * (DEFAULT_POINT_RULES.maxDiscountPercent / 100)) / 1000) * 1000;
  const maxPointsAllowed = Math.floor(maxDiscountRp / 10);

  const pointsUsed = Math.min(maxPointsAllowed, usableUserPoints);
  const discountAmount = pointsUsed * 10;
  const remainingPoints = safeBalance - pointsUsed;

  return {
    pointsUsed,
    discountAmount,
    remainingPoints,
    maxDiscountPercent: DEFAULT_POINT_RULES.maxDiscountPercent,
  };
}

/**
 * Rumus Earning Cashback (Poin Masuk = 5% Cashback):
 * earnedPoints = Math.floor(payableSubtotal / 1000) * 5
 */
export function calculateEarning(payableSubtotal: number): number {
  const safePayable = Math.max(0, Number(payableSubtotal) || 0);
  return Math.floor(safePayable / 1000) * DEFAULT_POINT_RULES.cashbackPercent;
}

/**
 * Mengambil Saldo Poin & Mutasi Riwayat Poin Pelanggan
 */
export async function getPointsInfo(userId: number, typeFilter?: string): Promise<UserPointsInfo> {
  // Ambil saldo dari customers
  const [custRows]: any = await pool.query(
    'SELECT points FROM customers WHERE id = ?',
    [userId]
  );

  let balance = 0;
  if (custRows.length > 0) {
    balance = Number(custRows[0].points) || 0;
  } else {
    // Fallback jika id tercatat di tabel users
    const [uRows]: any = await pool.query(
      'SELECT points FROM users WHERE id = ?',
      [userId]
    );
    if (uRows.length > 0) {
      balance = Number(uRows[0].points) || 0;
    }
  }

  const equivalentRp = Math.floor(balance / 100) * 1000;

  // Query mutasi log
  let query = 'SELECT * FROM point_logs WHERE user_id = ?';
  const queryParams: any[] = [userId];

  if (typeFilter && ['EARN', 'REDEEM', 'VOID_REFUND'].includes(typeFilter.toUpperCase())) {
    query += ' AND type = ?';
    queryParams.push(typeFilter.toUpperCase());
  }

  query += ' ORDER BY id DESC LIMIT 50';

  const [logRows]: any = await pool.query(query, queryParams);

  const logs: PointLogItem[] = logRows.map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    transactionId: row.transaction_id,
    type: row.type,
    points: row.points,
    description: row.description,
    createdAt: row.created_at,
  }));

  return {
    balance,
    equivalentRp,
    rules: DEFAULT_POINT_RULES,
    logs,
  };
}

/**
 * Simulasi Preview Pemakaian Poin untuk Nominal Subtotal Tertentu
 */
export async function previewPoints(userId: number, subtotal: number): Promise<PointRedemptionCalculation> {
  const [custRows]: any = await pool.query(
    'SELECT points FROM customers WHERE id = ?',
    [userId]
  );
  let balance = 0;
  if (custRows.length > 0) {
    balance = Number(custRows[0].points) || 0;
  }

  return calculateRedemption(balance, subtotal);
}

/**
 * Konfirmasi Poin Cashback untuk Pesanan Tunai saat Kasir/Barista mengubah status ke Diproses/Selesai
 */
export async function confirmCashOrderPoints(orderIdOrQueue: string): Promise<void> {
  const [moRows]: any = await pool.query(
    'SELECT order_id, customer_id, points_earned, payment_method FROM mobile_orders WHERE order_id = ? OR queue_number = ?',
    [orderIdOrQueue, orderIdOrQueue]
  );

  if (moRows.length === 0) return;
  const mo = moRows[0];
  const customerId = mo.customer_id;
  const pointsEarned = Number(mo.points_earned) || 0;

  if (!customerId || pointsEarned <= 0) return;

  // Cek apakah poin sudah pernah masuk di point_logs
  const [logRows]: any = await pool.query(
    'SELECT id FROM point_logs WHERE user_id = ? AND transaction_id = ? AND type = "EARN"',
    [customerId, mo.order_id]
  );

  if (logRows.length === 0) {
    await pool.query(
      'UPDATE customers SET points = points + ? WHERE id = ?',
      [pointsEarned, customerId]
    );

    await pool.query(
      `INSERT INTO point_logs (user_id, transaction_id, type, points, description, created_at)
       VALUES (?, ?, 'EARN', ?, ?, NOW())`,
      [
        customerId,
        mo.order_id,
        pointsEarned,
        `Cashback 5% (+${pointsEarned} Poin) dari Pembayaran Tunai Pesanan ${mo.order_id}`,
      ]
    );
  }
}

/**
 * Refund poin jika pesanan dibatalkan (baik dari kasir/dapur maupun mobile)
 */
export async function refundOrderPoints(orderIdOrQueue: string, reason?: string): Promise<void> {
  const [moRows]: any = await pool.query(
    'SELECT order_id, customer_id, points_used, points_earned, payment_method FROM mobile_orders WHERE order_id = ? OR queue_number = ?',
    [orderIdOrQueue, orderIdOrQueue]
  );

  if (moRows.length === 0) return;
  const mo = moRows[0];
  const customerId = mo.customer_id;
  const pointsUsed = Number(mo.points_used) || 0;
  const pointsEarned = Number(mo.points_earned) || 0;

  if (!customerId) return;

  // 1. Kembalikan poin yang pernah digunakan jika belum dikembalikan
  if (pointsUsed > 0) {
    const [refundLogs]: any = await pool.query(
      'SELECT id FROM point_logs WHERE user_id = ? AND transaction_id = ? AND type = "VOID_REFUND" AND points > 0',
      [customerId, mo.order_id]
    );

    if (refundLogs.length === 0) {
      await pool.query(
        'UPDATE customers SET points = points + ? WHERE id = ?',
        [pointsUsed, customerId]
      );

      await pool.query(
        `INSERT INTO point_logs (user_id, transaction_id, type, points, description, created_at)
         VALUES (?, ?, 'VOID_REFUND', ?, ?, NOW())`,
        [
          customerId,
          mo.order_id,
          pointsUsed,
          `Pengembalian ${pointsUsed} Poin dari Pesanan Dibatalkan ${mo.order_id} (${reason || 'Dibatalkan'})`,
        ]
      );
    }
  }

  // 2. Tarik kembali cashback jika sudah sempat dikreditkan
  if (pointsEarned > 0) {
    const [earnLogs]: any = await pool.query(
      'SELECT id FROM point_logs WHERE user_id = ? AND transaction_id = ? AND type = "EARN"',
      [customerId, mo.order_id]
    );

    const [cancelledLogs]: any = await pool.query(
      'SELECT id FROM point_logs WHERE user_id = ? AND transaction_id = ? AND type = "VOID_REFUND" AND points < 0',
      [customerId, mo.order_id]
    );

    if (earnLogs.length > 0 && cancelledLogs.length === 0) {
      await pool.query(
        'UPDATE customers SET points = GREATEST(0, points - ?) WHERE id = ?',
        [pointsEarned, customerId]
      );

      await pool.query(
        `INSERT INTO point_logs (user_id, transaction_id, type, points, description, created_at)
         VALUES (?, ?, 'VOID_REFUND', ?, ?, NOW())`,
        [
          customerId,
          mo.order_id,
          -pointsEarned,
          `Pembatalan Cashback -${pointsEarned} Poin karena Pesanan Dibatalkan ${mo.order_id}`,
        ]
      );
    }
  }
}
