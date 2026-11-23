import { Request, Response } from 'express';
import pool from '../../config/database';
import {
  calculateRedemption,
  calculateEarning,
  confirmCashOrderPoints,
  refundOrderPoints,
} from '../../services/point.service';
import { validateDiscountService } from '../../services/discount.service';

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
      usePoints = false,
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Keranjang pesanan masih kosong.',
      });
    }

    await connection.beginTransaction();

    // 0. Validasi ketersediaan menu (Cek status Sold Out di MySQL)
    for (const item of items) {
      const prodName = (item.name || item.productName || '').trim();
      const prodId = item.id || item.productId || 0;
      const [prodRows]: any = await connection.query(
        'SELECT id, name, is_available FROM products WHERE id = ? OR LOWER(name) = LOWER(?) LIMIT 1',
        [prodId, prodName]
      );
      if (prodRows.length > 0 && (prodRows[0].is_available === 0 || prodRows[0].is_available === false)) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `Pesanan ditolak: Menu "${prodRows[0].name}" saat ini sedang habis (Sold Out). Silakan hapus menu ini dari keranjang.`,
        });
      }
    }

    // 1. Generate / Gunakan Order ID (#BF-XXXX) & Nomor Antrean (A-XX / B-XX)
    const orderId = req.body.orderId || `#BF-${Math.floor(1000 + Math.random() * 9000)}`;
    const queueLetter = Math.random() > 0.5 ? 'A' : 'B';
    const queueNumber = req.body.queueNumber || `${queueLetter}-${Math.floor(10 + Math.random() * 89)}`;

    // Hitung subtotal pesanan dari item-item
    let calculatedSubtotal = 0;
    for (const item of items) {
      const p = Number(item.price) || 0;
      const q = Number(item.quantity) || 1;
      calculatedSubtotal += p * q;
    }

    let pointsUsed = 0;
    let pointDiscountAmount = 0;
    let currentBalance = 0;

    // 2. Jika usePoints aktif, kunci baris user & hitung diskon poin secara ketat di backend
    if (usePoints && customerId) {
      const [custRows]: any = await connection.query(
        'SELECT points FROM customers WHERE id = ? FOR UPDATE',
        [customerId]
      );

      if (custRows.length > 0) {
        const userBalance = Number(custRows[0].points) || 0;
        const calc = calculateRedemption(userBalance, calculatedSubtotal);

        pointsUsed = calc.pointsUsed;
        pointDiscountAmount = calc.discountAmount;

        if (pointsUsed > 0) {
          // Potong poin dari saldo pelanggan
          await connection.query(
            'UPDATE customers SET points = points - ? WHERE id = ?',
            [pointsUsed, customerId]
          );

          // Catat log pemakaian poin
          await connection.query(
            `INSERT INTO point_logs (user_id, transaction_id, type, points, description, created_at)
             VALUES (?, ?, 'REDEEM', ?, ?, NOW())`,
            [
              customerId,
              orderId,
              pointsUsed,
              `Tukar ${pointsUsed} Poin (Diskon Rp ${pointDiscountAmount.toLocaleString('id-ID')}) untuk Pesanan ${orderId}`,
            ]
          );
        }
      }
    }

    // Validasi & hitung ulang diskon voucher di server-side (jangan percaya input diskon client)
    let voucherDiscountAmount = 0;
    let validVoucherCode: string | null = null;
    if (promoCode && String(promoCode).trim().length > 0) {
      const vRes = await validateDiscountService(String(promoCode), calculatedSubtotal);
      if (!vRes.valid) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: vRes.message,
        });
      }
      voucherDiscountAmount = Number(vRes.discountAmount || 0);
      validVoucherCode = vRes.code || validVoucherCode;
    }

    const totalDiscount = voucherDiscountAmount + pointDiscountAmount;
    // Subtotal yang benar-benar dibayar pelanggan (setelah diskon poin & promo)
    const payableSubtotal = Math.max(0, calculatedSubtotal - totalDiscount);

    // Hitung PPN 10% dari pesanan
    const taxRate = 0.10;
    const taxAmount = Math.round(calculatedSubtotal * taxRate);
    const finalTotal = payableSubtotal + taxAmount;

    // 3. Hitung Earning Poin (Cashback 5% = Math.floor(payableSubtotal / 1000) * 5)
    const earnedPoints = calculateEarning(payableSubtotal);

    const isCash = paymentMethod?.toLowerCase() === 'cash' || paymentMethod?.toLowerCase() === 'tunai';
    const isPending = isCash;
    const initialStatus = isCash ? 'menungguPembayaran' : 'diterima';
    const initialKitchenStatus = isCash ? 'Menunggu Bayar' : 'Baru';
    const initialBaristaNote = isCash
      ? 'Menunggu pembayaran tunai di kasir. Silakan bayar ke kasir agar pesanan dapat segera diracik.'
      : 'Pesanan masuk dan segera disiapkan di bar racik.';

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
          orderId,
          earnedPoints,
          `Cashback 5% (+${earnedPoints} Poin) dari Pesanan ${orderId}`,
        ]
      );
    }

    // Ambil saldo akhir customer terkini
    if (customerId) {
      const [finalCustRows]: any = await connection.query(
        'SELECT points FROM customers WHERE id = ?',
        [customerId]
      );
      if (finalCustRows.length > 0) {
        currentBalance = Number(finalCustRows[0].points) || 0;
      }
    }

    // 4. Simpan ke tabel mobile_orders
    await connection.query(
      `INSERT INTO mobile_orders 
       (order_id, queue_number, customer_id, customer_name, counter_name, pickup_type, status, total_price, discount_amount, tax_amount, points_used, points_earned, payment_method, promo_code, estimated_minutes, barista_name, barista_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Barista Reza', ?, NOW())`,
      [
        orderId,
        queueNumber,
        customerId,
        customerName,
        counterName,
        pickupType,
        initialStatus,
        finalTotal,
        totalDiscount,
        taxAmount,
        pointsUsed,
        earnedPoints,
        paymentMethod,
        promoCode,
        isCash ? 10 : 8,
        initialBaristaNote,
      ]
    );

    // 5. Simpan item-item pesanan ke mobile_order_items
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

    // 6. Sinkronisasi Otomatis ke Dapur POS (kitchen_orders & kitchen_order_items)
    const [kitchenResult]: any = await connection.query(
      `INSERT INTO kitchen_orders (order_number, transaction_id, customer_name, source, order_type, table_number, payment_method, status, created_at)
       VALUES (?, ?, ?, 'App BreakFree', ?, 'Mobile', ?, ?, NOW())`,
      [queueNumber, orderId, customerName, pickupType.includes('Takeaway') ? 'Takeaway' : 'Dine-in', paymentMethod, initialKitchenStatus]
    );

    const kitchenOrderId = kitchenResult.insertId;
    for (const item of items) {
      await connection.query(
        `INSERT INTO kitchen_order_items (kitchen_order_id, name, quantity, variant)
         VALUES (?, ?, ?, ?)`,
        [kitchenOrderId, item.name || item.productName, item.quantity || 1, item.options || 'Regular']
      );
    }

    // 7. Simpan juga ke tabel transactions dan transaction_items agar sinkron dengan Web POS & Rekap Shift
    try {
      const orderTypeVal = pickupType.includes('Takeaway') ? 'TAKEAWAY' : 'DINE_IN';
      const posTableLabel = pickupType.includes('Takeaway') ? 'Takeaway' : 'Dine-in (Self Pick-Up)';
      const posPaymentMethod = isCash ? 'Cash' : 'QRIS';
      const initialTrxStatus = isCash ? 'PENDING' : 'PAID';

      await connection.query(
        `INSERT INTO transactions 
         (transaction_id, order_number, order_source, order_type, customer_id, customer_name, table_number, 
          subtotal, voucher_code, voucher_discount, points_used, points_discount, discount_amount, 
          tax, tax_amount, total, payment_method, cash_given, change_amount, status, created_at)
         VALUES (?, ?, 'MOBILE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, NOW())
         ON DUPLICATE KEY UPDATE 
           order_number = VALUES(order_number),
           order_source = VALUES(order_source),
           order_type = VALUES(order_type),
           customer_name = VALUES(customer_name),
           table_number = VALUES(table_number),
           subtotal = VALUES(subtotal),
           voucher_code = VALUES(voucher_code),
           voucher_discount = VALUES(voucher_discount),
           points_used = VALUES(points_used),
           points_discount = VALUES(points_discount),
           discount_amount = VALUES(discount_amount),
           tax = VALUES(tax),
           tax_amount = VALUES(tax_amount),
           total = VALUES(total),
           payment_method = VALUES(payment_method),
           status = VALUES(status)`,
        [
          orderId,
          queueNumber,
          orderTypeVal,
          customerId,
          customerName,
          posTableLabel,
          calculatedSubtotal,
          validVoucherCode,
          voucherDiscountAmount,
          pointsUsed,
          pointDiscountAmount,
          totalDiscount,
          taxAmount,
          taxAmount,
          finalTotal,
          posPaymentMethod,
          initialTrxStatus,
        ]
      );

      // Simpan item-item ke transaction_items agar Riwayat POS & Rekap Shift membaca item terjual
      for (const item of items) {
        const itemP = Number(item.price) || 0;
        const itemQ = Number(item.quantity) || 1;
        await connection.query(
          `INSERT INTO transaction_items 
           (transaction_id, product_id, product_name, price, quantity, subtotal_item, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            orderId,
            item.id || item.productId || null,
            item.name || item.productName || 'Menu BreakFree',
            itemP,
            itemQ,
            itemP * itemQ,
            item.options || '',
          ]
        );
      }
    } catch (txErr) {
      console.warn('Gagal sync ke tabel transactions & items (non-blocking):', txErr);
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: isCash
        ? 'Pesanan berhasil dibuat! Silakan bayar tunai di kasir agar pesanan segera diracik.'
        : 'Pesanan berhasil dibuat! Barista kami segera meracik pesananmu.',
      order: {
        id: orderId,
        queueNumber,
        counterName,
        pickupType,
        status: initialStatus,
        subtotal: calculatedSubtotal,
        taxAmount: taxAmount,
        totalPrice: finalTotal,
        discountAmount: totalDiscount,
        paymentMethod,
        promoCode,
        estimatedMinutes: isCash ? 10 : 8,
        baristaName: 'Barista Reza',
        baristaNote: initialBaristaNote,
        createdAt: new Date().toISOString(),
        items,
      },
      points: {
        earned: earnedPoints,
        used: pointsUsed,
        discountAmount: pointDiscountAmount,
        currentBalance: currentBalance,
        isPending: isPending,
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
         WHERE customer_id = ? AND status IN ('menungguPembayaran', 'diterima', 'diproses', 'siapDiambil')
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
        taxAmount: Number(order.tax_amount || 0),
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
        taxAmount: Number(order.tax_amount || 0),
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

    const validStatuses = ['menungguPembayaran', 'diterima', 'diproses', 'siapDiambil', 'selesai', 'dibatalkan'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status tidak valid. Pilihan: ${validStatuses.join(', ')}`,
      });
    }

    let note = baristaNote;
    if (!note) {
      switch (status) {
        case 'menungguPembayaran':
          note = 'Menunggu pembayaran tunai di kasir. Silakan bayar ke kasir agar pesanan segera diracik.';
          break;
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
    const kitchenStatus = status === 'selesai'
      ? 'Selesai'
      : status === 'diproses'
        ? 'Diproses'
        : status === 'siapDiambil'
          ? 'Siap Diambil'
          : status === 'menungguPembayaran'
            ? 'Menunggu Bayar'
            : 'Baru';
    await pool.query(
      'UPDATE kitchen_orders SET status = ? WHERE transaction_id = ?',
      [kitchenStatus, cleanId]
    );

    // Integrasi Poin: Jika pesanan tunai dikonfirmasi (diproses/selesai), kreditkan poin cashback
    if (['diterima', 'diproses', 'siapDiambil', 'selesai'].includes(status)) {
      await confirmCashOrderPoints(cleanId);
    } else if (status === 'dibatalkan') {
      await refundOrderPoints(cleanId, note || 'Pesanan dibatalkan');
    }

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
