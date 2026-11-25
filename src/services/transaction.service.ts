import pool from '../config/database';
import { calculateRedemption, calculateEarning } from './point.service';
import { getActiveShiftRecord } from './shift.service';

export interface PointsResult {
  earned: number;
  used: number;
  discountAmount: number;
  currentBalance: number;
  isPending: boolean;
}

export interface CreateTransactionParams {
  transactionId: string;
  customerId?: number | null;
  customerName?: string;
  tableNumber?: string;
  subtotal: number;
  discountAmount?: number; // Promo voucher discount
  tax?: number;
  total?: number;
  paymentMethod?: string;
  cashGiven?: number;
  change?: number;
  items: Array<{
    id?: any;
    name?: string;
    product_name?: string;
    price: number;
    quantity: number;
    note?: string;
  }>;
  usePoints?: boolean;
}

/**
 * Membuat transaksi baru dari POS Kasir dengan penautan shift aktif
 * serta proteksi integritas saldo poin & MySQL transaction.
 */
export async function createTransactionService(params: CreateTransactionParams): Promise<{
  success: boolean;
  message: string;
  transactionId: string;
  points: PointsResult;
}> {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const {
      transactionId,
      customerId,
      customerName = 'Tamu / Umum',
      tableNumber = '-',
      subtotal = 0,
      discountAmount: promoDiscount = 0,
      tax = 0,
      paymentMethod = 'Cash',
      cashGiven = 0,
      change = 0,
      items = [],
      usePoints = false,
    } = params;

    const activeShift = await getActiveShiftRecord(connection);
    const shiftId = activeShift ? activeShift.id : null;
    const cashierName = activeShift ? activeShift.cashier_name : null;

    let pointsUsed = 0;
    let pointDiscountAmount = 0;
    let currentBalance = 0;

    if (usePoints && customerId) {
      const [userRows]: any = await connection.query(
        'SELECT points FROM customers WHERE id = ? FOR UPDATE',
        [customerId]
      );

      if (userRows.length > 0) {
        const userBalance = Number(userRows[0].points) || 0;
        const calc = calculateRedemption(userBalance, subtotal);

        pointsUsed = calc.pointsUsed;
        pointDiscountAmount = calc.discountAmount;

        if (pointsUsed > 0) {
          await connection.query(
            'UPDATE customers SET points = points - ? WHERE id = ?',
            [pointsUsed, customerId]
          );

          await connection.query(
            `INSERT INTO point_logs (user_id, transaction_id, type, points, description, created_at)
             VALUES (?, ?, 'REDEEM', ?, ?, NOW())`,
            [
              customerId,
              transactionId,
              pointsUsed,
              `Tukar ${pointsUsed} Poin (Diskon Rp ${pointDiscountAmount.toLocaleString('id-ID')}) untuk Pesanan ${transactionId}`,
            ]
          );
        }
      }
    }

    const totalDiscount = Number(promoDiscount) + pointDiscountAmount;
    const payableSubtotal = Math.max(0, Number(subtotal) - pointDiscountAmount);
    const finalTotal = Math.max(0, Number(subtotal) - totalDiscount) + Number(tax);

    const earnedPoints = calculateEarning(payableSubtotal);
    const isCash = paymentMethod.toLowerCase() === 'cash' || paymentMethod.toLowerCase() === 'tunai';
    const isPending = isCash;

    if (!isPending && earnedPoints > 0 && customerId) {
      await connection.query(
        'UPDATE customers SET points = points + ? WHERE id = ?',
        [earnedPoints, customerId]
      );

      await connection.query(
        `INSERT INTO point_logs (user_id, transaction_id, type, points, description, created_at)
         VALUES (?, ?, 'EARN', ?, ?, NOW())`,
        [
          customerId,
          transactionId,
          earnedPoints,
          `Cashback 5% (+${earnedPoints} Poin) dari Pesanan ${transactionId}`,
        ]
      );
    }

    if (customerId) {
      const [finalUserRows]: any = await connection.query(
        'SELECT points FROM customers WHERE id = ?',
        [customerId]
      );
      if (finalUserRows.length > 0) {
        currentBalance = Number(finalUserRows[0].points) || 0;
      }
    }

    const orderType = tableNumber && tableNumber !== '-' ? 'DINE_IN' : 'TAKEAWAY';

    await connection.query(
      `INSERT INTO transactions 
      (transaction_id, shift_id, cashier_name, order_number, order_source, order_type, customer_id, customer_name, table_number, subtotal, discount_amount, points_used, points_discount, points_earned, tax, tax_amount, total, payment_method, cash_given, change_amount, status, created_at) 
      VALUES (?, ?, ?, ?, 'POS', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUKSES', NOW())`,
      [
        transactionId,
        shiftId,
        cashierName,
        transactionId,
        orderType,
        customerId || null,
        customerName,
        tableNumber,
        subtotal,
        totalDiscount,
        pointsUsed,
        pointDiscountAmount,
        earnedPoints,
        tax,
        tax,
        finalTotal,
        paymentMethod,
        cashGiven,
        change,
      ]
    );

    if (items && Array.isArray(items) && items.length > 0) {
      for (const item of items) {
        const itemPrice = Number(item.price) || 0;
        const itemQty = Number(item.quantity) || 1;
        await connection.query(
          `INSERT INTO transaction_items 
          (transaction_id, product_id, product_name, price, quantity, subtotal_item, note) 
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            transactionId,
            item.id || null,
            item.name || item.product_name || 'Item Menu',
            itemPrice,
            itemQty,
            itemPrice * itemQty,
            item.note || '',
          ]
        );
      }
    }

    // Teruskan ke antrian Kitchen Live Tracking
    try {
      const orderSuffix = transactionId ? transactionId.replace(/[^0-9]/g, '').slice(-4) : '';
      const orderNumber = `#BF-${orderSuffix || Math.floor(1000 + Math.random() * 9000)}`;
      const kitchenOrderType = tableNumber && tableNumber !== '-' ? 'Dine-in' : 'Takeaway';

      const [kResult]: any = await connection.query(
        `INSERT INTO kitchen_orders 
        (order_number, transaction_id, customer_name, source, order_type, table_number, payment_method, status, created_at)
        VALUES (?, ?, ?, 'Kasir', ?, ?, ?, 'Baru', NOW())`,
        [orderNumber, transactionId, customerName, kitchenOrderType, tableNumber, paymentMethod]
      );

      const kitchenOrderId = kResult.insertId;
      for (const item of items) {
        await connection.query(
          `INSERT INTO kitchen_order_items (kitchen_order_id, name, quantity, variant)
           VALUES (?, ?, ?, ?)`,
          [kitchenOrderId, item.name || item.product_name, item.quantity || 1, item.note || '']
        );
      }
    } catch (kitchenErr) {
      console.warn('Gagal meneruskan ke antrian dapur (non-blocking):', kitchenErr);
    }

    await connection.commit();

    return {
      success: true,
      message: 'Transaksi berhasil disimpan ke database',
      transactionId,
      points: {
        earned: earnedPoints,
        used: pointsUsed,
        discountAmount: pointDiscountAmount,
        currentBalance,
        isPending,
      },
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

/**
 * Void / Batalkan transaksi dari Web POS:
 * - Mengubah status transaksi menjadi CANCELLED + menyimpan cancel_reason/void_reason
 * - Sinkronisasi ke kitchen_orders & mobile_orders (dibatalkan)
 * - Mengembalikan/menarik poin di point_logs (VOID_REFUND) dalam 1 MySQL transaction
 */
export async function voidTransactionService(
  rawTransactionId: string,
  reason?: string
): Promise<{ success: boolean; message: string }> {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const cleanId = decodeURIComponent(rawTransactionId).trim();
    const withHash = cleanId.startsWith('#') ? cleanId : `#${cleanId}`;
    const withoutHash = cleanId.startsWith('#') ? cleanId.slice(1) : cleanId;

    const [txRows]: any = await connection.query(
      'SELECT * FROM transactions WHERE transaction_id = ? OR transaction_id = ? FOR UPDATE',
      [withHash, withoutHash]
    );

    if (txRows.length === 0) {
      throw new Error(`Transaksi dengan ID ${cleanId} tidak ditemukan.`);
    }

    const tx = txRows[0];
    const txId = tx.transaction_id;
    const currentStatus = String(tx.status || '').toUpperCase();

    if (['VOID', 'CANCELLED', 'DIBATALKAN'].includes(currentStatus)) {
      await connection.rollback();
      return { success: true, message: 'Transaksi sudah berstatus dibatalkan sebelumnya.' };
    }

    const cancelReason = (reason && reason.trim()) || 'Dibatalkan oleh Kasir POS';
    const customerId = tx.customer_id;
    const pointsUsed = Number(tx.points_used) || 0;
    const pointsEarned = Number(tx.points_earned) || 0;

    // 1. Jika ada customer dan pernah memakai poin, kembalikan poin (cek anti double-refund)
    if (customerId && pointsUsed > 0) {
      const [existingUsedRefund]: any = await connection.query(
        'SELECT id FROM point_logs WHERE user_id = ? AND transaction_id = ? AND type = "VOID_REFUND" AND points > 0',
        [customerId, txId]
      );

      if (existingUsedRefund.length === 0) {
        await connection.query(
          'UPDATE customers SET points = points + ? WHERE id = ?',
          [pointsUsed, customerId]
        );

        await connection.query(
          `INSERT INTO point_logs (user_id, transaction_id, type, points, description, created_at)
           VALUES (?, ?, 'VOID_REFUND', ?, ?, NOW())`,
          [
            customerId,
            txId,
            pointsUsed,
            `Pengembalian ${pointsUsed} Poin dari Pesanan Dibatalkan ${txId} (${cancelReason})`,
          ]
        );
      }
    }

    // 2. Jika poin cashback EARN sudah sempat dikreditkan, tarik kembali
    if (customerId && pointsEarned > 0) {
      const [earnLogs]: any = await connection.query(
        'SELECT id FROM point_logs WHERE user_id = ? AND transaction_id = ? AND type = "EARN"',
        [customerId, txId]
      );
      const [existingEarnRefund]: any = await connection.query(
        'SELECT id FROM point_logs WHERE user_id = ? AND transaction_id = ? AND type = "VOID_REFUND" AND points < 0',
        [customerId, txId]
      );

      if (earnLogs.length > 0 && existingEarnRefund.length === 0) {
        await connection.query(
          'UPDATE customers SET points = GREATEST(0, points - ?) WHERE id = ?',
          [pointsEarned, customerId]
        );

        await connection.query(
          `INSERT INTO point_logs (user_id, transaction_id, type, points, description, created_at)
           VALUES (?, ?, 'VOID_REFUND', ?, ?, NOW())`,
          [
            customerId,
            txId,
            -pointsEarned,
            `Penarikan Cashback -${pointsEarned} Poin karena Pesanan Dibatalkan ${txId}`,
          ]
        );
      }
    }

    // 3. Cari shift aktif jika belum tertaut
    const activeShift = await getActiveShiftRecord(connection);
    const shiftId = tx.shift_id || (activeShift ? activeShift.id : null);
    const cashierName = tx.cashier_name || (activeShift ? activeShift.cashier_name : null);

    // 4. Update status transaksi menjadi CANCELLED
    await connection.query(
      `UPDATE transactions
       SET status = 'CANCELLED', void_reason = ?, cancel_reason = ?,
           shift_id = COALESCE(shift_id, ?), cashier_name = COALESCE(cashier_name, ?)
       WHERE transaction_id = ?`,
      [cancelReason, cancelReason, shiftId, cashierName, txId]
    );

    // 5. Sinkronisasi status batal ke kitchen_orders & mobile_orders
    await connection.query(
      'UPDATE kitchen_orders SET status = "Dibatalkan", cancel_reason = ? WHERE transaction_id = ? OR order_number = ?',
      [cancelReason, txId, tx.order_number || txId]
    ).catch(() => {});

    await connection.query(
      `UPDATE mobile_orders
       SET status = 'dibatalkan',
           cancel_reason = ?,
           barista_note = ?,
           shift_id = COALESCE(shift_id, ?),
           cashier_name = COALESCE(cashier_name, ?),
           updated_at = NOW()
       WHERE order_id = ?`,
      [
        cancelReason,
        `Pesanan dibatalkan oleh kasir: ${cancelReason}`,
        shiftId,
        cashierName,
        txId,
      ]
    ).catch(() => {});

    await connection.commit();

    return {
      success: true,
      message: 'Transaksi berhasil dibatalkan (CANCELLED), disinkronkan ke mobile, dan poin disesuaikan.',
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
