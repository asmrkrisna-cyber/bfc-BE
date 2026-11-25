import { Request, Response } from 'express';
import pool from '../config/database';
import { confirmCashOrderPoints, refundOrderPoints } from '../services/point.service';
import { getActiveShiftRecord } from '../services/shift.service';
import { syncPendingMidtransOrders } from '../services/midtrans.service';

function formatTimeAgo(dateInput: any): string {
  if (!dateInput) return 'Baru saja';
  const now = new Date();
  const created = new Date(dateInput);
  const diffInMinutes = Math.floor((now.getTime() - created.getTime()) / (1000 * 60));
  if (diffInMinutes <= 1) return '1 mnt';
  if (diffInMinutes < 60) return `${diffInMinutes} mnt`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  return `${diffInHours} jam`;
}

// 1. Ambil Semua Pesanan Dapur Aktif
export const getKitchenOrders = async (_req: Request, res: Response): Promise<any> => {
  try {
    // Sinkronkan status pembayaran Midtrans yang masih pending agar order lunas langsung otomatis ke 'Diproses'
    await syncPendingMidtransOrders();

    // Sinkronisasi Otomatis: Pastikan setiap pesanan aktif dari mobile_orders masuk ke antrean dapur Web POS
    const [unsyncedMobile]: any = await pool.query(
      `SELECT mo.* FROM mobile_orders mo
       LEFT JOIN kitchen_orders ko ON ko.transaction_id = mo.order_id
       WHERE ko.id IS NULL AND mo.status NOT IN ('selesai', 'dibatalkan', 'CANCELLED')`
    );

    for (const mo of unsyncedMobile) {
      let mappedStatus = 'Baru';
      if (mo.status === 'menungguPembayaran') mappedStatus = 'Menunggu Bayar';
      else if (mo.status === 'diproses') mappedStatus = 'Diproses';
      else if (mo.status === 'siapDiambil') mappedStatus = 'Siap Diambil';

      const [ins]: any = await pool.query(
        `INSERT INTO kitchen_orders (order_number, transaction_id, customer_name, source, order_type, table_number, payment_method, status, created_at)
         VALUES (?, ?, ?, 'App BreakFree', ?, 'Mobile', ?, ?, ?)`,
        [
          mo.queue_number,
          mo.order_id,
          mo.customer_name,
          mo.pickup_type?.includes('Takeaway') ? 'Takeaway' : 'Dine-in',
          mo.payment_method || 'QRIS',
          mappedStatus,
          mo.created_at || new Date(),
        ]
      );

      let [moItems]: any = await pool.query(
        'SELECT * FROM mobile_order_items WHERE order_id = ?',
        [mo.order_id]
      );

      if (!moItems || moItems.length === 0) {
        const [trxItems]: any = await pool.query(
          'SELECT product_name, quantity, note AS options FROM transaction_items WHERE transaction_id = ?',
          [mo.order_id]
        );
        moItems = trxItems || [];
      }

      for (const item of moItems) {
        await pool.query(
          `INSERT INTO kitchen_order_items (kitchen_order_id, name, quantity, variant)
           VALUES (?, ?, ?, ?)`,
          [ins.insertId, item.product_name, item.quantity || 1, item.options || 'Regular']
        );
      }
    }

    const [orders]: any = await pool.query(
      `SELECT * FROM kitchen_orders 
       WHERE status NOT IN ('Selesai', 'Dibatalkan') 
       ORDER BY id DESC`
    );

    const ordersWithItems = await Promise.all(
      orders.map(async (o: any) => {
        const [items]: any = await pool.query(
          'SELECT name, quantity as qty, variant FROM kitchen_order_items WHERE kitchen_order_id = ?',
          [o.id]
        );

        const diffMinutes = Math.floor((new Date().getTime() - new Date(o.created_at).getTime()) / (1000 * 60));

        return {
          id: o.order_number || `#BF-${o.id}`,
          transactionId: o.transaction_id || o.order_number,
          rawId: o.id,
          customerName: o.customer_name,
          source: o.source || 'Kasir',
          isLiveApp: o.source === 'App BreakFree',
          orderType: o.order_type || 'Dine-in',
          tableNumber: o.table_number || '-',
          paymentMethod: o.payment_method || 'Cash',
          timeAgo: formatTimeAgo(o.created_at),
          status: o.status,
          isOverdue: diffMinutes > 15 && o.status !== 'Siap Diambil',
          note: o.note || '',
          cancelReason: o.cancel_reason || '',
          items: items.map((i: any) => ({
            name: i.name,
            qty: Number(i.qty) || 1,
            variant: i.variant || '',
          })),
        };
      })
    );

    return res.json(ordersWithItems);
  } catch (error: any) {
    console.error('Error getKitchenOrders:', error);
    return res.status(500).json({ message: 'Gagal mengambil pesanan dapur', error: error.message });
  }
};

interface KitchenOrderTargetRow {
  id: number;
  order_number: string | null;
  transaction_id: string | null;
  payment_method?: string | null;
}

const findTargetKitchenOrder = async (rawId: string): Promise<KitchenOrderTargetRow | null> => {
  if (/^\d+$/.test(rawId)) {
    const [byIdRows]: any = await pool.query(
      'SELECT id, order_number, transaction_id, payment_method FROM kitchen_orders WHERE id = ? LIMIT 1',
      [Number(rawId)]
    );
    if (byIdRows?.length) return byIdRows[0];
  }

  const [byTxRows]: any = await pool.query(
    'SELECT id, order_number, transaction_id, payment_method FROM kitchen_orders WHERE transaction_id = ? ORDER BY id DESC LIMIT 1',
    [rawId]
  );
  if (byTxRows?.length) return byTxRows[0];

  const [byOrderNumRows]: any = await pool.query(
    `SELECT id, order_number, transaction_id, payment_method
     FROM kitchen_orders
     WHERE order_number = ?
     ORDER BY (status NOT IN ('Selesai', 'Dibatalkan')) DESC, id DESC
     LIMIT 1`,
    [rawId]
  );
  return byOrderNumRows?.[0] ?? null;
};

// Prioritaskan transaction_id agar pembaruan status tidak menimpa pesanan lama dengan nomor antrean sama.
const buildOrderTargetFilter = (
  txColumn: string,
  fallbackOrderNumColumn: string,
  ko: KitchenOrderTargetRow
): { clause: string; param: string | null } => {
  if (ko.transaction_id) {
    return { clause: `${txColumn} = ?`, param: ko.transaction_id };
  }
  return { clause: `${fallbackOrderNumColumn} = ?`, param: ko.order_number };
};

const syncMobileOrderStatus = async (
  ko: KitchenOrderTargetRow,
  opts: {
    mobileStatus: string;
    baristaNote: string;
    estimatedMinutes: number;
    cancelReason: string;
    shiftId: number | null;
    cashierName: string | null;
  }
) => {
  const mobileTarget = buildOrderTargetFilter('order_id', 'queue_number', ko);
  if (!mobileTarget.param) return;

  await pool.query(
    `UPDATE mobile_orders 
     SET status = ?,
         barista_note = ?,
         estimated_minutes = ?,
         cancel_reason = CASE WHEN ? = 'dibatalkan' THEN ? ELSE cancel_reason END,
         shift_id = COALESCE(shift_id, ?),
         cashier_name = COALESCE(cashier_name, ?),
         barista_name = COALESCE(cashier_name, barista_name, ?),
         updated_at = NOW() 
     WHERE ${mobileTarget.clause}`,
    [
      opts.mobileStatus,
      opts.baristaNote,
      opts.estimatedMinutes,
      opts.mobileStatus,
      opts.cancelReason,
      opts.shiftId,
      opts.cashierName,
      opts.cashierName,
      mobileTarget.param,
    ]
  );
};

const cancelTransactionAndRefundPoints = async (
  ko: KitchenOrderTargetRow,
  cancelReasonText: string,
  shiftId: number | null,
  cashierName: string | null
) => {
  const txTarget = buildOrderTargetFilter('transaction_id', 'order_number', ko);
  if (txTarget.param) {
    await pool.query(
      `UPDATE transactions
       SET status = 'CANCELLED',
           cancel_reason = ?,
           void_reason = ?,
           shift_id = COALESCE(shift_id, ?),
           cashier_name = COALESCE(cashier_name, ?)
       WHERE ${txTarget.clause}`,
      [cancelReasonText, cancelReasonText, shiftId, cashierName, txTarget.param]
    );
  }

  const txOrOrderId = ko.transaction_id || ko.order_number;
  if (txOrOrderId) {
    await refundOrderPoints(txOrOrderId, cancelReasonText);
  }
};

// 2. Update Status Pesanan Dapur (Baru -> Diproses -> Siap Diambil -> Selesai -> Dibatalkan)
// Otomatis menautkan shift aktif + nama kasir, mengubah status bayar Cash menjadi PAID, dan sinkron ke Mobile Live Tracking
export const updateKitchenStatus = async (req: Request, res: Response): Promise<any> => {
  try {
    const rawId = decodeURIComponent(
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    ).trim();
    const { status, reason } = req.body;

    if (!status) {
      return res.status(400).json({ message: 'Status wajib diisi' });
    }

    const activeShift = await getActiveShiftRecord();
    const shiftId = activeShift ? activeShift.id : null;
    const cashierName = activeShift ? activeShift.cashier_name : null;

    const ko = await findTargetKitchenOrder(rawId);

    if (ko) {
      await pool.query('UPDATE kitchen_orders SET status = ? WHERE id = ?', [status, ko.id]);

      const txOrOrderId = ko.transaction_id || ko.order_number;

      let mobileStatus = 'diterima';
      let baristaNote = 'Pesanan sudah dikonfirmasi & masuk antrean barista.';
      let estimatedMinutes = 8;

      if (status === 'Diproses') {
        mobileStatus = 'diproses';
        const isCash = ko.payment_method?.toLowerCase() === 'cash' || ko.payment_method?.toLowerCase() === 'tunai';
        baristaNote = isCash
          ? 'Pembayaran tunai telah diterima kasir. Barista sedang meracik pesananmu di bar.'
          : 'Barista sedang meracik minuman & hidanganmu di bar.';
        estimatedMinutes = 5;
      } else if (status === 'Siap Diambil' || status === 'Siap') {
        mobileStatus = 'siapDiambil';
        baristaNote = `Pesananmu sudah siap! Silakan ambil di Counter Pick-up dengan nomor ${ko.order_number}.`;
        estimatedMinutes = 0;
      } else if (status === 'Selesai') {
        mobileStatus = 'selesai';
        baristaNote = 'Pesanan telah diambil. Terima kasih & selamat menikmati!';
        estimatedMinutes = 0;
      } else if (status === 'Dibatalkan') {
        mobileStatus = 'dibatalkan';
        baristaNote = reason || 'Pesanan dibatalkan oleh kasir/dapur.';
        estimatedMinutes = 0;
      }

      await syncMobileOrderStatus(ko, {
        mobileStatus,
        baristaNote,
        estimatedMinutes,
        cancelReason: reason || baristaNote,
        shiftId,
        cashierName,
      });

      if (['Diproses', 'Siap Diambil', 'Siap', 'Selesai'].includes(status)) {
        const txTarget = buildOrderTargetFilter('transaction_id', 'order_number', ko);
        if (txTarget.param) {
          // Konfirmasi pembayaran tunai di transactions & tautkan shift/kasir aktif
          await pool.query(
            `UPDATE transactions
             SET status = CASE WHEN UPPER(COALESCE(status, '')) = 'PENDING' THEN 'PAID' ELSE status END,
                 shift_id = COALESCE(shift_id, ?),
                 cashier_name = COALESCE(cashier_name, ?)
             WHERE ${txTarget.clause}`,
            [shiftId, cashierName, txTarget.param]
          );
        }
        if (txOrOrderId) {
          await confirmCashOrderPoints(txOrOrderId);
        }
      } else if (status === 'Dibatalkan') {
        const cancelReasonText = reason || 'Dibatalkan oleh staf kasir/dapur';
        await cancelTransactionAndRefundPoints(ko, cancelReasonText, shiftId, cashierName);
      }
    }

    return res.json({
      success: true,
      message: `Status pesanan berhasil diubah menjadi ${status} dan disinkronkan ke mobile tracking.`,
    });
  } catch (error: any) {
    console.error('Error updateKitchenStatus:', error);
    return res.status(500).json({ message: 'Gagal mengubah status dapur', error: error.message });
  }
};

// 3. Batalkan Pesanan Dapur dan Sinkronkan ke Transactions (CANCELLED) & Mobile Live Tracking
export const cancelKitchenOrder = async (req: Request, res: Response): Promise<any> => {
  try {
    const rawId = decodeURIComponent(
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    ).trim();
    const { reason } = req.body;
    const cancelReasonText = (reason && String(reason).trim()) || 'Dibatalkan oleh staf kasir/dapur';

    const activeShift = await getActiveShiftRecord();
    const shiftId = activeShift ? activeShift.id : null;
    const cashierName = activeShift ? activeShift.cashier_name : null;

    const ko = await findTargetKitchenOrder(rawId);

    if (ko) {
      await pool.query(
        'UPDATE kitchen_orders SET status = "Dibatalkan", cancel_reason = ? WHERE id = ?',
        [cancelReasonText, ko.id]
      );

      await syncMobileOrderStatus(ko, {
        mobileStatus: 'dibatalkan',
        baristaNote: `Pesanan dibatalkan: ${cancelReasonText}`,
        estimatedMinutes: 0,
        cancelReason: cancelReasonText,
        shiftId,
        cashierName,
      });

      await cancelTransactionAndRefundPoints(ko, cancelReasonText, shiftId, cashierName);
    }

    return res.json({
      success: true,
      message: 'Pesanan dapur berhasil dibatalkan (CANCELLED), poin disesuaikan, dan disinkronkan ke mobile.',
    });
  } catch (error: any) {
    console.error('Error cancelKitchenOrder:', error);
    return res.status(500).json({ message: 'Gagal membatalkan pesanan dapur', error: error.message });
  }
};
