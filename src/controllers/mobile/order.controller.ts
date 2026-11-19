import { Request, Response } from 'express';
import pool from '../../config/database';

/**
 * 1. Buat Pesanan Baru dari Aplikasi Mobile (Checkout)
 */
export const createMobileOrder = async (req: Request, res: Response): Promise<any> => {
  const connection = await pool.getConnection();
  try {
    const customerId = req.customer?.id || 1;
    const customerName = req.customer?.name || req.body.customerName || 'Pelanggan Mobile';

    const {
      items,
      pickupType = 'Dine-in (Minum di Kafe)',
      paymentMethod = 'QRIS',
      promoCode = null,
      totalPrice,
      discountAmount = 0,
      counterName = 'Counter Bar 01',
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Keranjang pesanan masih kosong.',
      });
    }

    await connection.beginTransaction();

    // 1. Generate / Gunakan Order ID (#BF-XXXX) & Nomor Antrean (A-XX / B-XX)
    const orderId = req.body.orderId || `#BF-${Math.floor(1000 + Math.random() * 9000)}`;
    const queueLetter = Math.random() > 0.5 ? 'A' : 'B';
    const queueNumber = req.body.queueNumber || `${queueLetter}-${Math.floor(10 + Math.random() * 89)}`;

    const finalTotal = Number(totalPrice) || 0;
    const finalDiscount = Number(discountAmount) || 0;

    // 2. Simpan ke tabel mobile_orders
    const [orderResult]: any = await connection.query(
      `INSERT INTO mobile_orders 
       (order_id, queue_number, customer_id, customer_name, counter_name, pickup_type, status, total_price, discount_amount, payment_method, promo_code, estimated_minutes, barista_name, barista_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'diterima', ?, ?, ?, ?, 8, 'Barista Reza', 'Pesanan masuk dan segera disiapkan di bar racik.', NOW())`,
      [
        orderId,
        queueNumber,
        customerId,
        customerName,
        counterName,
        pickupType,
        finalTotal,
        finalDiscount,
        paymentMethod,
        promoCode,
      ]
    );

    // 3. Simpan item-item pesanan ke mobile_order_items
    for (const item of items) {
      await connection.query(
        `INSERT INTO mobile_order_items (order_id, product_id, product_name, options, price, quantity, image)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          item.id || item.productId || 'item',
          item.name || item.productName || 'Minuman Kopi',
          item.options || 'Regular',
          Number(item.price) || 0,
          Number(item.quantity) || 1,
          item.image || '',
        ]
      );
    }

    // 4. Sinkronisasi Otomatis ke Dapur POS (kitchen_orders & kitchen_order_items)
    // Supaya pesanan dari ponsel langsung terbaca di layar kasir & barista
    const [kitchenResult]: any = await connection.query(
      `INSERT INTO kitchen_orders (order_number, transaction_id, customer_name, source, order_type, table_number, payment_method, status, created_at)
       VALUES (?, ?, ?, 'App BreakFree', ?, 'Mobile', ?, 'Baru', NOW())`,
      [queueNumber, orderId, customerName, pickupType.includes('Takeaway') ? 'Takeaway' : 'Dine-in', paymentMethod]
    );

    const kitchenOrderId = kitchenResult.insertId;
    for (const item of items) {
      await connection.query(
        `INSERT INTO kitchen_order_items (kitchen_order_id, name, quantity, variant)
         VALUES (?, ?, ?, ?)`,
        [kitchenOrderId, item.name, item.quantity || 1, item.options || 'Regular']
      );
    }

    // 5. Hitung Cashback Poin Reward Pelanggan (100 poin per Rp 10.000 belanja)
    const cashbackPoints = Math.floor(finalTotal / 100);
    if (cashbackPoints > 0 && customerId) {
      await connection.query(
        'UPDATE customers SET points = points + ? WHERE id = ?',
        [cashbackPoints, customerId]
      );

      await connection.query(
        `INSERT INTO customer_points_history (customer_id, order_id, type, points, description, created_at)
         VALUES (?, ?, 'EARN', ?, ?, NOW())`,
        [customerId, orderId, cashbackPoints, `Cashback Poin dari Pesanan ${orderId}`]
      );
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: 'Pesanan berhasil dibuat! Barista kami segera meracik pesananmu.',
      order: {
        id: orderId,
        queueNumber,
        counterName,
        pickupType,
        status: 'diterima',
        totalPrice: finalTotal,
        discountAmount: finalDiscount,
        paymentMethod,
        promoCode,
        estimatedMinutes: 8,
        baristaName: 'Barista Reza',
        baristaNote: 'Pesanan masuk dan segera disiapkan di bar racik.',
        cashbackEarned: cashbackPoints,
        createdAt: new Date().toISOString(),
        items,
      },
    });
  } catch (error: any) {
    await connection.rollback();
    console.error('Error createMobileOrder:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal membuat pesanan mobile.',
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

/**
 * 2. Ambil Pesanan Aktif Pelanggan (Untuk Live Tracking)
 */
export const getActiveOrder = async (req: Request, res: Response): Promise<any> => {
  try {
    const customerId = req.customer?.id || 1;
    const requestedOrderId = req.query.orderId as string | undefined;

    let rows: any;
    if (requestedOrderId && requestedOrderId.trim() !== '') {
      const [r]: any = await pool.query(
        `SELECT * FROM mobile_orders 
         WHERE order_id = ? OR queue_number = ? 
         ORDER BY id DESC LIMIT 1`,
        [requestedOrderId.trim(), requestedOrderId.trim()]
      );
      rows = r;
    } else {
      const [r]: any = await pool.query(
        `SELECT * FROM mobile_orders 
         WHERE customer_id = ? AND status IN ('diterima', 'diproses', 'siapDiambil')
         ORDER BY id DESC LIMIT 1`,
        [customerId]
      );
      rows = r;
    }

    if (!rows || rows.length === 0) {
      return res.json({
        success: true,
        hasActiveOrder: false,
        activeOrder: null,
      });
    }

    const order = rows[0];

    // Ambil detail items
    const [items]: any = await pool.query(
      'SELECT * FROM mobile_order_items WHERE order_id = ?',
      [order.order_id]
    );

    return res.json({
      success: true,
      hasActiveOrder: true,
      activeOrder: {
        id: order.order_id,
        queueNumber: order.queue_number,
        counterName: order.counter_name,
        pickupType: order.pickup_type,
        status: order.status,
        totalPrice: Number(order.total_price),
        discountAmount: Number(order.discount_amount),
        paymentMethod: order.payment_method,
        promoCode: order.promo_code,
        estimatedMinutes: order.estimated_minutes,
        baristaName: order.barista_name,
        baristaNote: order.barista_note,
        createdAt: order.created_at,
        items: items.map((it: any) => ({
          id: it.product_id,
          name: it.product_name,
          options: it.options,
          price: Number(it.price),
          quantity: it.quantity,
          image: it.image,
        })),
      },
    });
  } catch (error: any) {
    console.error('Error getActiveOrder:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat pesanan aktif.',
      error: error.message,
    });
  }
};

/**
 * 3. Ambil Riwayat Pesanan Selesai / Lampau
 */
export const getOrderHistory = async (req: Request, res: Response): Promise<any> => {
  try {
    const customerId = req.customer?.id || 1;

    const [orders]: any = await pool.query(
      `SELECT * FROM mobile_orders 
       WHERE customer_id = ? 
       ORDER BY id DESC`,
      [customerId]
    );

    const fullHistory = [];
    for (const order of orders) {
      const [items]: any = await pool.query(
        'SELECT * FROM mobile_order_items WHERE order_id = ?',
        [order.order_id]
      );

      fullHistory.push({
        id: order.order_id,
        queueNumber: order.queue_number,
        counterName: order.counter_name,
        pickupType: order.pickup_type,
        status: order.status,
        totalPrice: Number(order.total_price),
        paymentMethod: order.payment_method,
        createdAt: order.created_at,
        items: items.map((it: any) => ({
          id: it.product_id,
          name: it.product_name,
          options: it.options,
          price: Number(it.price),
          quantity: it.quantity,
        })),
      });
    }

    return res.json({
      success: true,
      count: fullHistory.length,
      orders: fullHistory,
    });
  } catch (error: any) {
    console.error('Error getOrderHistory:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat riwayat pesanan.',
      error: error.message,
    });
  }
};

/**
 * 4. Lacak Pesanan Berdasarkan Order ID (Live Tracking Endpoint)
 */
export const trackOrder = async (req: Request, res: Response): Promise<any> => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const cleanId = String(rawId).startsWith('#') ? String(rawId) : `#${rawId}`;

    const [rows]: any = await pool.query(
      'SELECT * FROM mobile_orders WHERE order_id = ?',
      [cleanId]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Pesanan dengan ID "${cleanId}" tidak ditemukan.`,
      });
    }

    const order = rows[0];
    const [items]: any = await pool.query(
      'SELECT * FROM mobile_order_items WHERE order_id = ?',
      [cleanId]
    );

    return res.json({
      success: true,
      order: {
        id: order.order_id,
        queueNumber: order.queue_number,
        counterName: order.counter_name,
        pickupType: order.pickup_type,
        status: order.status,
        totalPrice: Number(order.total_price),
        discountAmount: Number(order.discount_amount),
        paymentMethod: order.payment_method,
        estimatedMinutes: order.estimated_minutes,
        baristaName: order.barista_name,
        baristaNote: order.barista_note,
        createdAt: order.created_at,
        items: items.map((it: any) => ({
          id: it.product_id,
          name: it.product_name,
          options: it.options,
          price: Number(it.price),
          quantity: it.quantity,
          image: it.image,
        })),
      },
    });
  } catch (error: any) {
    console.error('Error trackOrder:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal melacak pesanan.',
      error: error.message,
    });
  }
};

/**
 * 5. Update Status Pesanan (Untuk Simulasi / Barista Mengubah Status)
 */
export const updateOrderStatus = async (req: Request, res: Response): Promise<any> => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const cleanId = String(rawId).startsWith('#') ? String(rawId) : `#${rawId}`;
    const { status, baristaNote } = req.body;

    const validStatuses = ['diterima', 'diproses', 'siapDiambil', 'selesai', 'dibatalkan'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status tidak valid. Pilihan: ${validStatuses.join(', ')}`,
      });
    }

    let note = baristaNote;
    if (!note) {
      switch (status) {
        case 'diterima':
          note = 'Pesanan dikonfirmasi & masuk antrean barista.';
          break;
        case 'diproses':
          note = 'Barista sedang meracik minuman & hidanganmu di bar.';
          break;
        case 'siapDiambil':
          note = 'Pesananmu sudah selesai! Silakan ambil di Counter Pick-up.';
          break;
        case 'selesai':
          note = 'Pesanan telah diambil. Terima kasih & selamat menikmati!';
          break;
        case 'dibatalkan':
          note = 'Pesanan dibatalkan.';
          break;
      }
    }

    await pool.query(
      `UPDATE mobile_orders 
       SET status = ?, barista_note = ? 
       WHERE order_id = ?`,
      [status, note, cleanId]
    );

    // Sync juga status ke kitchen_orders
    const kitchenStatus = status === 'selesai' ? 'Selesai' : status === 'diproses' ? 'Diproses' : status === 'siapDiambil' ? 'Siap' : 'Baru';
    await pool.query(
      'UPDATE kitchen_orders SET status = ? WHERE transaction_id = ?',
      [kitchenStatus, cleanId]
    );

    return res.json({
      success: true,
      message: `Status pesanan ${cleanId} berhasil diubah ke "${status}".`,
      status,
      baristaNote: note,
    });
  } catch (error: any) {
    console.error('Error updateOrderStatus:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memperbarui status pesanan.',
      error: error.message,
    });
  }
};
