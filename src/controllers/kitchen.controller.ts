import { Request, Response } from 'express';
import pool from '../config/database';
import { confirmCashOrderPoints, refundOrderPoints } from '../services/point.service';

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
export const getKitchenOrders = async (req: Request, res: Response): Promise<any> => {
  try {
    // 0. Sinkronisasi Otomatis: Pastikan setiap pesanan aktif dari mobile_orders otomatis masuk ke antrean dapur Web POS
    const [unsyncedMobile]: any = await pool.query(
      `SELECT mo.* FROM mobile_orders mo
       LEFT JOIN kitchen_orders ko ON (ko.transaction_id = mo.order_id OR ko.order_number = mo.queue_number)
       WHERE ko.id IS NULL AND mo.status NOT IN ('selesai', 'dibatalkan')`
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

      const [moItems]: any = await pool.query(
        'SELECT * FROM mobile_order_items WHERE order_id = ?',
        [mo.order_id]
      );

      if (moItems && moItems.length > 0) {
        for (const item of moItems) {
          await pool.query(
            `INSERT INTO kitchen_order_items (kitchen_order_id, name, quantity, variant)
             VALUES (?, ?, ?, ?)`,
            [ins.insertId, item.product_name, item.quantity || 1, item.options || 'Regular']
          );
        }
      } else {
        await pool.query(
          `INSERT INTO kitchen_order_items (kitchen_order_id, name, quantity, variant)
           VALUES (?, 'Breakfree Aren Latte', 1, 'Ice Coffee • Less Sugar • Oatmilk'),
                  (?, 'French Fries', 1, 'Snack • Saus Sambal & Mayo')`,
          [ins.insertId, ins.insertId]
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

// 2. Update Status Pesanan Dapur (Baru -> Diproses -> Siap Diambil -> Selesai)
// dan otomatis sinkronisasi status ke Live Tracking aplikasi Mobile Pelanggan!
export const updateKitchenStatus = async (req: Request, res: Response): Promise<any> => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ message: 'Status wajib diisi' });
    }

    // Ambil data pesanan dapur untuk sinkronisasi dengan mobile_orders
    const [kitchenRows]: any = await pool.query(
      'SELECT id, order_number, transaction_id, payment_method FROM kitchen_orders WHERE id = ? OR order_number = ? OR transaction_id = ?',
      [rawId, rawId, rawId]
    );

    await pool.query(
      'UPDATE kitchen_orders SET status = ? WHERE id = ? OR order_number = ? OR transaction_id = ?',
      [status, rawId, rawId, rawId]
    );

    // Sinkronisasi otomatis ke status Live Tracking di mobile_orders
    if (kitchenRows && kitchenRows.length > 0) {
      const ko = kitchenRows[0];
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
        baristaNote = 'Pesanan dibatalkan oleh kasir/dapur.';
        estimatedMinutes = 0;
      }

      await pool.query(
        `UPDATE mobile_orders 
         SET status = ?, barista_note = ?, estimated_minutes = ?, updated_at = NOW() 
         WHERE order_id = ? OR queue_number = ?`,
        [mobileStatus, baristaNote, estimatedMinutes, ko.transaction_id, ko.order_number]
      );

      // Konfirmasi atau kembalikan poin pelanggan otomatis
      if (['Diproses', 'Siap Diambil', 'Siap', 'Selesai'].includes(status)) {
        await confirmCashOrderPoints(ko.transaction_id || ko.order_number);
      } else if (status === 'Dibatalkan') {
        await refundOrderPoints(ko.transaction_id || ko.order_number, 'Dibatalkan oleh staf dapur');
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

// 3. Batalkan Pesanan Dapur dan Sinkronkan ke Mobile
export const cancelKitchenOrder = async (req: Request, res: Response): Promise<any> => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { reason } = req.body;

    const [kitchenRows]: any = await pool.query(
      'SELECT id, order_number, transaction_id FROM kitchen_orders WHERE id = ? OR order_number = ? OR transaction_id = ?',
      [rawId, rawId, rawId]
    );

    await pool.query(
      'UPDATE kitchen_orders SET status = "Dibatalkan", cancel_reason = ? WHERE id = ? OR order_number = ? OR transaction_id = ?',
      [reason || 'Dibatalkan oleh staf dapur', rawId, rawId, rawId]
    );

    if (kitchenRows && kitchenRows.length > 0) {
      const ko = kitchenRows[0];
      await refundOrderPoints(ko.transaction_id || ko.order_number, reason || 'Dibatalkan oleh staf kasir/dapur.');
      await pool.query(
        `UPDATE mobile_orders 
         SET status = 'dibatalkan', barista_note = ?, updated_at = NOW() 
         WHERE order_id = ? OR queue_number = ?`,
        [reason || 'Pesanan dibatalkan oleh staf kasir/dapur.', ko.transaction_id, ko.order_number]
      );
    }

    return res.json({
      success: true,
      message: 'Pesanan dapur berhasil dibatalkan dan disinkronkan ke mobile.',
    });
  } catch (error: any) {
    console.error('Error cancelKitchenOrder:', error);
    return res.status(500).json({ message: 'Gagal membatalkan pesanan dapur', error: error.message });
  }
};
