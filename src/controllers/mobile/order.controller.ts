import { Request, Response } from 'express';
import pool from '../../config/database';
import {
  calculateRedemption,
  calculateEarning,
  confirmCashOrderPoints,
  refundOrderPoints,
} from '../../services/point.service';
import { validateDiscountService } from '../../services/discount.service';
import { getActiveShiftRecord } from '../../services/shift.service';
import {
  createMidtransSnapTransaction,
  syncPendingMidtransOrders,
} from '../../services/midtrans.service';

function normalizeOrderStatusForApi(rawStatus: string | null | undefined, trxStatus?: string | null): string {
  const s = String(rawStatus || '').trim().toLowerCase();
  const ts = String(trxStatus || '').trim().toUpperCase();

  if (s === 'dibatalkan' || s === 'cancelled' || ts === 'CANCELLED' || ts === 'VOID' || ts === 'DIBATALKAN') {
    return 'CANCELLED';
  }
  if (s === 'menunggupembayaran' || s === 'menunggu pembayaran' || s === 'menunggu bayar' || ts === 'PENDING') {
    return 'menungguPembayaran';
  }
  if (s === 'diproses' || s === 'processing') {
    return 'diproses';
  }
  if (s === 'siapdiambil' || s === 'siap diambil' || s === 'siap' || s === 'ready') {
    return 'siapDiambil';
  }
  if (s === 'selesai' || s === 'completed') {
    return 'selesai';
  }
  return 'diterima';
}

async function buildFormattedOrder(mo: any) {
  const orderId = mo.order_id;

  const [trxRows]: any = await pool.query(
    `SELECT * FROM transactions WHERE transaction_id = ? LIMIT 1`,
    [orderId]
  );
  const trx = trxRows && trxRows.length > 0 ? trxRows[0] : null;

  const [kitchenRows]: any = await pool.query(
    `SELECT cancel_reason FROM kitchen_orders WHERE transaction_id = ? OR order_number = ? LIMIT 1`,
    [orderId, mo.queue_number]
  );
  const ko = kitchenRows && kitchenRows.length > 0 ? kitchenRows[0] : null;

  let cashierName: string | null =
    trx?.cashier_name ||
    mo.cashier_name ||
    (mo.barista_name && mo.barista_name !== 'Barista Reza' ? mo.barista_name : null);

  if (!cashierName && (trx?.shift_id || mo.shift_id)) {
    const [shiftRows]: any = await pool.query(
      'SELECT cashier_name FROM shifts WHERE id = ? LIMIT 1',
      [trx?.shift_id || mo.shift_id]
    );
    if (shiftRows && shiftRows.length > 0) {
      cashierName = shiftRows[0].cashier_name;
    }
  }

  let [items]: any = await pool.query(
    `SELECT product_id, product_name, options, price, quantity, image
     FROM mobile_order_items WHERE order_id = ? ORDER BY id ASC`,
    [orderId]
  );

  if (!items || items.length === 0) {
    const [trxItems]: any = await pool.query(
      `SELECT product_id, product_name, note AS options, price, quantity
       FROM transaction_items WHERE transaction_id = ? ORDER BY id ASC`,
      [orderId]
    );
    items = trxItems || [];
  }

  const formattedItems = items.map((it: any) => {
    const price = Math.round(Number(it.price) || 0);
    const qty = Number(it.quantity) || 1;
    return {
      id: it.product_id?.toString() || 'item',
      productName: it.product_name || 'Menu BreakFree',
      name: it.product_name || 'Menu BreakFree',
      options: it.options || 'Regular',
      price,
      quantity: qty,
      subtotal: price * qty,
      image: it.image || '',
    };
  });

  const computedSubtotal = formattedItems.reduce((sum: number, it: any) => sum + it.subtotal, 0);
  const subtotal = Number(trx?.subtotal) || computedSubtotal;
  const discountAmount = Number(trx?.discount_amount ?? mo.discount_amount) || 0;
  const voucherDiscount = Number(trx?.voucher_discount) || 0;
  const pointsDiscount = Number(trx?.points_discount) || 0;
  const pointsUsed = Number(trx?.points_used ?? mo.points_used) || 0;
  const pointsEarned = Number(trx?.points_earned ?? mo.points_earned) || 0;
  const voucherCode = trx?.voucher_code || mo.promo_code || null;
  const taxAmount = Number(trx?.tax_amount ?? trx?.tax ?? mo.tax_amount) || 0;
  const total = Number(trx?.total ?? mo.total_price) || 0;

  const normalizedStatus = normalizeOrderStatusForApi(mo.status, trx?.status);
  const orderType =
    trx?.order_type ||
    (String(mo.pickup_type || '').toLowerCase().includes('takeaway') ? 'TAKEAWAY' : 'DINE_IN');
  const cancelReason =
    trx?.cancel_reason || trx?.void_reason || mo.cancel_reason || ko?.cancel_reason || null;

  return {
    id: orderId,
    orderNumber: trx?.order_number || mo.queue_number || orderId,
    queueNumber: mo.queue_number || trx?.order_number || '-',
    counterName: mo.counter_name || 'Counter Bar 01',
    orderType,
    pickupType:
      mo.pickup_type ||
      (orderType === 'TAKEAWAY' ? 'Takeaway (Bungkus Bawa Pulang)' : 'Dine-in (Minum di Kafe)'),
    status: normalizedStatus,
    cancelReason,
    cashierName,
    baristaName: cashierName || 'Tim Barista BreakFree',
    baristaNote:
      normalizedStatus === 'CANCELLED'
        ? cancelReason || mo.barista_note || 'Pesanan dibatalkan oleh kasir.'
        : mo.barista_note || 'Pesanan diproses oleh tim BreakFree.',
    createdAt: mo.created_at instanceof Date ? mo.created_at.toISOString() : mo.created_at,
    updatedAt: mo.updated_at instanceof Date ? mo.updated_at.toISOString() : mo.updated_at,
    subtotal,
    discountAmount,
    voucherCode,
    voucherDiscount,
    pointsUsed,
    pointsDiscount,
    pointsEarned,
    taxAmount,
    total,
    totalPrice: total,
    paymentMethod: trx?.payment_method || mo.payment_method || 'QRIS',
    paymentStatus: mo.payment_status || trx?.payment_status || (normalizedStatus === 'menungguPembayaran' ? 'PENDING' : 'PAID'),
    paymentChannel: mo.payment_channel || trx?.payment_channel || null,
    midtransOrderId: mo.midtrans_order_id || trx?.midtrans_order_id || null,
    snapToken: mo.snap_token || trx?.snap_token || null,
    snapRedirectUrl: mo.snap_redirect_url || trx?.snap_redirect_url || null,
    promoCode: voucherCode,
    estimatedMinutes: Number(mo.estimated_minutes ?? 8),
    items: formattedItems,
  };
}

/**
 * 1. Buat Pesanan Baru dari Aplikasi Mobile (Checkout)
 */
export const createMobileOrder = async (req: Request, res: Response): Promise<any> => {
  const connection = await pool.getConnection();
  try {
    const customerId = req.customer?.id;
    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Silakan masuk ke akun terlebih dahulu untuk membuat pesanan.',
      });
    }

    const [custProfileRows]: any = await connection.query(
      'SELECT name, email, phone FROM customers WHERE id = ? LIMIT 1',
      [customerId]
    );
    const customerName =
      custProfileRows?.[0]?.name || req.customer?.name || req.body.customerName || 'Pelanggan BreakFree';
    const customerEmail = custProfileRows?.[0]?.email || req.customer?.email || null;
    const customerPhone = custProfileRows?.[0]?.phone || null;

    const {
      items,
      pickupType,
      orderType,
      paymentMethod = 'QRIS',
      promoCode = null,
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
    const normalizedItemsForGateway: Array<{ id: string; name: string; price: number; quantity: number }> = [];
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
      normalizedItemsForGateway.push({
        id: String(prodId || 'item'),
        name: prodName || 'Menu BreakFree',
        price: Math.round(Number(item.price) || 0),
        quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
      });
    }

    // Ambil shift POS yang sedang aktif (jika ada) untuk menautkan shift_id & cashier_name
    const activeShift = await getActiveShiftRecord(connection);
    const shiftId = activeShift ? activeShift.id : null;
    const cashierName = activeShift ? activeShift.cashier_name : null;

    // Normalisasi mode pengambilan Dine-in / Takeaway
    const isTakeaway =
      String(orderType || '').toUpperCase() === 'TAKEAWAY' ||
      String(pickupType || '').toLowerCase().includes('takeaway') ||
      String(pickupType || '').toLowerCase().includes('bungkus');
    const resolvedOrderType = isTakeaway ? 'TAKEAWAY' : 'DINE_IN';
    const resolvedPickupType =
      pickupType && String(pickupType).trim().length > 0
        ? String(pickupType).trim()
        : isTakeaway
          ? 'Takeaway (Bungkus Bawa Pulang)'
          : 'Dine-in (Minum di Kafe)';

    // 1. Generate Order ID (#BF-XXXX) & Nomor Antrean (A-XX / B-XX)
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
          await connection.query(
            'UPDATE customers SET points = points - ? WHERE id = ?',
            [pointsUsed, customerId]
          );

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

    // Validasi & hitung ulang diskon voucher di server-side
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
      validVoucherCode = vRes.code || String(promoCode).trim().toUpperCase();
    }

    const totalDiscount = voucherDiscountAmount + pointDiscountAmount;
    const payableSubtotal = Math.max(0, calculatedSubtotal - totalDiscount);

    // Hitung PPN 10%
    const taxRate = 0.10;
    const taxAmount = Math.round(calculatedSubtotal * taxRate);
    const finalTotal = payableSubtotal + taxAmount;

    // 3. Hitung Earning Poin (Cashback 5%)
    const earnedPoints = calculateEarning(payableSubtotal);

    const isCash = paymentMethod?.toLowerCase() === 'cash' || paymentMethod?.toLowerCase() === 'tunai';
    const useMidtransGateway = !isCash;
    const isPending = isCash || useMidtransGateway;
    const initialStatus = 'menungguPembayaran';
    const initialKitchenStatus = 'Menunggu Bayar';
    const initialBaristaNote = isCash
      ? 'Menunggu pembayaran tunai di kasir. Silakan bayar ke kasir agar pesanan dapat segera diracik.'
      : 'Menunggu penyelesaian pembayaran online melalui Midtrans.';

    // Jika non-tunai, buat transaksi Snap Midtrans terlebih dahulu sebelum commit ke MySQL
    let midtransSnap: {
      token: string;
      redirectUrl: string;
      midtransOrderId: string;
      isProduction: boolean;
    } | null = null;

    if (useMidtransGateway) {
      midtransSnap = await createMidtransSnapTransaction({
        internalOrderId: orderId,
        grossAmount: finalTotal,
        items: normalizedItemsForGateway,
        discountAmount: totalDiscount,
        taxAmount,
        customer: {
          firstName: customerName,
          email: customerEmail,
          phone: customerPhone,
        },
      });
    }

    const [finalCustRows]: any = await connection.query(
      'SELECT points FROM customers WHERE id = ?',
      [customerId]
    );
    if (finalCustRows.length > 0) {
      currentBalance = Number(finalCustRows[0].points) || 0;
    }

    const displayPaymentMethod = isCash ? 'Cash' : 'Midtrans (QRIS / Online)';

    // 4. Simpan ke tabel mobile_orders dengan shift_id, cashier_name, dan data Midtrans
    await connection.query(
      `INSERT INTO mobile_orders 
       (order_id, midtrans_order_id, queue_number, customer_id, customer_name, counter_name, shift_id, cashier_name, pickup_type, status, total_price, discount_amount, tax_amount, points_used, points_earned, payment_method, payment_status, snap_token, snap_redirect_url, promo_code, estimated_minutes, barista_name, barista_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, NOW())`,
      [
        orderId,
        midtransSnap?.midtransOrderId || null,
        queueNumber,
        customerId,
        customerName,
        counterName,
        shiftId,
        cashierName,
        resolvedPickupType,
        initialStatus,
        finalTotal,
        totalDiscount,
        taxAmount,
        pointsUsed,
        earnedPoints,
        displayPaymentMethod,
        midtransSnap?.token || null,
        midtransSnap?.redirectUrl || null,
        validVoucherCode,
        isCash ? 10 : 8,
        cashierName,
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
          item.name || item.productName || 'Menu BreakFree',
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
      [
        queueNumber,
        orderId,
        customerName,
        isTakeaway ? 'Takeaway' : 'Dine-in',
        displayPaymentMethod,
        initialKitchenStatus,
      ]
    );

    const kitchenOrderId = kitchenResult.insertId;
    for (const item of items) {
      await connection.query(
        `INSERT INTO kitchen_order_items (kitchen_order_id, name, quantity, variant)
         VALUES (?, ?, ?, ?)`,
        [kitchenOrderId, item.name || item.productName, item.quantity || 1, item.options || 'Regular']
      );
    }

    // 7. Simpan ke tabel transactions & transaction_items (sinkron POS + Rekap Shift "BreakFree Hub")
    const posTableLabel = isTakeaway ? 'Takeaway' : 'Dine-in (Self Pick-Up)';
    const posPaymentMethod = displayPaymentMethod;
    const initialTrxStatus = 'PENDING';

    await connection.query(
      `INSERT INTO transactions 
       (transaction_id, midtrans_order_id, shift_id, cashier_name, order_number, order_source, order_type, customer_id, customer_name, table_number, 
        subtotal, voucher_code, voucher_discount, points_used, points_discount, points_earned, discount_amount, 
        tax, tax_amount, total, payment_method, payment_status, snap_token, snap_redirect_url, cash_given, change_amount, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'MOBILE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, 0, 0, ?, NOW())
       ON DUPLICATE KEY UPDATE 
         midtrans_order_id = COALESCE(VALUES(midtrans_order_id), midtrans_order_id),
         shift_id = COALESCE(VALUES(shift_id), shift_id),
         cashier_name = COALESCE(VALUES(cashier_name), cashier_name),
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
         points_earned = VALUES(points_earned),
         discount_amount = VALUES(discount_amount),
         tax = VALUES(tax),
         tax_amount = VALUES(tax_amount),
         total = VALUES(total),
         payment_method = VALUES(payment_method),
         payment_status = VALUES(payment_status),
         snap_token = VALUES(snap_token),
         snap_redirect_url = VALUES(snap_redirect_url),
         status = VALUES(status)`,
      [
        orderId,
        midtransSnap?.midtransOrderId || null,
        shiftId,
        cashierName,
        queueNumber,
        resolvedOrderType,
        customerId,
        customerName,
        posTableLabel,
        calculatedSubtotal,
        validVoucherCode,
        voucherDiscountAmount,
        pointsUsed,
        pointDiscountAmount,
        earnedPoints,
        totalDiscount,
        taxAmount,
        taxAmount,
        finalTotal,
        posPaymentMethod,
        midtransSnap?.token || null,
        midtransSnap?.redirectUrl || null,
        initialTrxStatus,
      ]
    );

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

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: isCash
        ? 'Pesanan berhasil dibuat! Silakan bayar tunai di kasir agar pesanan segera diracik.'
        : 'Tagihan Midtrans berhasil dibuat! Silakan selesaikan pembayaran untuk memproses pesanan.',
      payment: midtransSnap
        ? {
            provider: 'MIDTRANS',
            midtransOrderId: midtransSnap.midtransOrderId,
            token: midtransSnap.token,
            redirectUrl: midtransSnap.redirectUrl,
            isProduction: midtransSnap.isProduction,
          }
        : null,
      order: {
        id: orderId,
        orderNumber: queueNumber,
        queueNumber,
        counterName,
        orderType: resolvedOrderType,
        pickupType: resolvedPickupType,
        status: initialStatus,
        cashierName,
        baristaName: cashierName || 'Tim Barista BreakFree',
        baristaNote: initialBaristaNote,
        subtotal: calculatedSubtotal,
        discountAmount: totalDiscount,
        voucherCode: validVoucherCode,
        voucherDiscount: voucherDiscountAmount,
        pointsUsed,
        pointsDiscount: pointDiscountAmount,
        pointsEarned: earnedPoints,
        taxAmount,
        total: finalTotal,
        totalPrice: finalTotal,
        paymentMethod: displayPaymentMethod,
        paymentStatus: 'PENDING',
        midtransOrderId: midtransSnap?.midtransOrderId || null,
        snapToken: midtransSnap?.token || null,
        snapRedirectUrl: midtransSnap?.redirectUrl || null,
        promoCode: validVoucherCode,
        estimatedMinutes: isCash ? 10 : 8,
        createdAt: new Date().toISOString(),
        items,
      },
      points: {
        earned: earnedPoints,
        used: pointsUsed,
        discountAmount: pointDiscountAmount,
        currentBalance,
        isPending,
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
 * 2. Ambil Pesanan Aktif Pelanggan (Untuk Live Tracking, termasuk mendeteksi transisi mendadak ke CANCELLED)
 */
export const getActiveOrder = async (req: Request, res: Response): Promise<any> => {
  try {
    const customerId = req.customer?.id;
    const requestedOrderId = req.query.orderId as string | undefined;

    if (!customerId && !requestedOrderId) {
      return res.json({
        success: true,
        hasActiveOrder: false,
        activeOrder: null,
      });
    }

    await syncPendingMidtransOrders(requestedOrderId);

    let rows: any;
    if (requestedOrderId && requestedOrderId.trim() !== '') {
      const cleanId = decodeURIComponent(requestedOrderId.trim());
      const [r]: any = await pool.query(
        `SELECT * FROM mobile_orders 
         WHERE order_id = ? OR queue_number = ? 
         ORDER BY id DESC LIMIT 1`,
        [cleanId, cleanId]
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

    const formatted = await buildFormattedOrder(rows[0]);

    return res.json({
      success: true,
      hasActiveOrder: true,
      activeOrder: formatted,
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
 * 3. Ambil Riwayat Pesanan Lengkap Pelanggan (GET /api/v1/orders/me & /api/v1/mobile/orders/history)
 */
export const getOrderHistory = async (req: Request, res: Response): Promise<any> => {
  try {
    const customerId = req.customer?.id;
    if (!customerId) {
      return res.json({
        success: true,
        count: 0,
        orders: [],
      });
    }

    await syncPendingMidtransOrders();

    const [orders]: any = await pool.query(
      `SELECT * FROM mobile_orders 
       WHERE customer_id = ? 
       ORDER BY id DESC`,
      [customerId]
    );

    const fullHistory = [];
    for (const order of orders) {
      fullHistory.push(await buildFormattedOrder(order));
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
 * 4. Detail / Live Tracking Pesanan by ID (GET /api/v1/orders/:id & /api/v1/mobile/orders/:id/track)
 */
export const trackOrder = async (req: Request, res: Response): Promise<any> => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const decoded = decodeURIComponent(String(rawId)).trim();
    const withHash = decoded.startsWith('#') ? decoded : `#${decoded}`;

    await syncPendingMidtransOrders(decoded);

    const [rows]: any = await pool.query(
      'SELECT * FROM mobile_orders WHERE order_id = ? OR order_id = ? OR queue_number = ? LIMIT 1',
      [decoded, withHash, decoded]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Pesanan dengan ID "${decoded}" tidak ditemukan.`,
      });
    }

    const formatted = await buildFormattedOrder(rows[0]);

    return res.json({
      success: true,
      order: formatted,
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
 * 5. Update Status Pesanan (Sinkron ke kitchen_orders, transactions, & poin)
 */
export const updateOrderStatus = async (req: Request, res: Response): Promise<any> => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const decoded = decodeURIComponent(String(rawId)).trim();
    const cleanId = decoded.startsWith('#') ? decoded : `#${decoded}`;
    const { status, baristaNote, cancelReason } = req.body;

    const normalizedInput = String(status || '').trim();
    const statusKey = normalizedInput.toUpperCase() === 'CANCELLED' ? 'dibatalkan' : normalizedInput;
    const validStatuses = ['menungguPembayaran', 'diterima', 'diproses', 'siapDiambil', 'selesai', 'dibatalkan'];
    if (!validStatuses.includes(statusKey)) {
      return res.status(400).json({
        success: false,
        message: `Status tidak valid. Pilihan: ${validStatuses.join(', ')}`,
      });
    }

    const activeShift = await getActiveShiftRecord();
    const shiftId = activeShift ? activeShift.id : null;
    const cashierName = activeShift ? activeShift.cashier_name : null;

    let note = baristaNote;
    if (!note) {
      switch (statusKey) {
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
          note = cancelReason || 'Pesanan dibatalkan oleh kasir.';
          break;
      }
    }

    await pool.query(
      `UPDATE mobile_orders 
       SET status = ?,
           barista_note = ?,
           cancel_reason = COALESCE(?, cancel_reason),
           shift_id = COALESCE(shift_id, ?),
           cashier_name = COALESCE(cashier_name, ?),
           barista_name = COALESCE(barista_name, ?),
           updated_at = NOW()
       WHERE order_id = ?`,
      [
        statusKey,
        note,
        statusKey === 'dibatalkan' ? cancelReason || note : null,
        shiftId,
        cashierName,
        cashierName,
        cleanId,
      ]
    );

    const kitchenStatus = statusKey === 'selesai'
      ? 'Selesai'
      : statusKey === 'diproses'
        ? 'Diproses'
        : statusKey === 'siapDiambil'
          ? 'Siap Diambil'
          : statusKey === 'menungguPembayaran'
            ? 'Menunggu Bayar'
            : statusKey === 'dibatalkan'
              ? 'Dibatalkan'
              : 'Baru';

    await pool.query(
      'UPDATE kitchen_orders SET status = ?, cancel_reason = COALESCE(?, cancel_reason) WHERE transaction_id = ?',
      [kitchenStatus, statusKey === 'dibatalkan' ? cancelReason || note : null, cleanId]
    );

    if (['diterima', 'diproses', 'siapDiambil', 'selesai'].includes(statusKey)) {
      await pool.query(
        `UPDATE transactions
         SET status = CASE WHEN UPPER(status) = 'PENDING' THEN 'PAID' ELSE status END,
             shift_id = COALESCE(shift_id, ?),
             cashier_name = COALESCE(cashier_name, ?)
         WHERE transaction_id = ?`,
        [shiftId, cashierName, cleanId]
      );
      await confirmCashOrderPoints(cleanId);
    } else if (statusKey === 'dibatalkan') {
      const reasonText = cancelReason || note || 'Pesanan dibatalkan';
      await pool.query(
        `UPDATE transactions
         SET status = 'CANCELLED',
             cancel_reason = ?,
             void_reason = ?,
             shift_id = COALESCE(shift_id, ?),
             cashier_name = COALESCE(cashier_name, ?)
         WHERE transaction_id = ?`,
        [reasonText, reasonText, shiftId, cashierName, cleanId]
      );
      await refundOrderPoints(cleanId, reasonText);
    }

    return res.json({
      success: true,
      message: `Status pesanan ${cleanId} berhasil diubah ke "${statusKey}".`,
      status: statusKey === 'dibatalkan' ? 'CANCELLED' : statusKey,
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
