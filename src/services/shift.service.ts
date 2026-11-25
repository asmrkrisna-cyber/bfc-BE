import pool from '../config/database';

export interface ActiveShiftInfo {
  id: number;
  cashier_name: string;
  shift_status: string;
  starting_cash: number;
  start_time: Date | string;
}

export interface ShiftRevenueBreakdown {
  totalTransactions: number;
  grandTotal: number;
  totalCash: number;
  totalQRIS: number;
  totalShopeeFood: number;
  totalBreakfreeHub: number;
  countBreakfreeHub: number;
  tax: number;
  netRevenue: number;
}

/**
 * Mengambil shift yang saat ini berstatus aktif (OPEN / Shift Opening Aktif / Shift Closing Aktif).
 */
export async function getActiveShiftRecord(conn: any = pool): Promise<ActiveShiftInfo | null> {
  const [rows]: any = await conn.query(
    `SELECT id, cashier_name, shift_status, starting_cash, start_time
     FROM shifts
     WHERE UPPER(COALESCE(shift_status, '')) != 'CLOSED' AND end_time IS NULL
     ORDER BY id DESC LIMIT 1`
  );

  if (!rows || rows.length === 0) return null;
  const s = rows[0];
  return {
    id: Number(s.id),
    cashier_name: s.cashier_name || 'Kasir',
    shift_status: s.shift_status,
    starting_cash: Number(s.starting_cash) || 0,
    start_time: s.start_time,
  };
}

/**
 * Menghitung rincian pendapatan shift dengan pemisahan ketat berdasarkan order_source
 * agar transaksi POS (Cash, QRIS, ShopeeFood) dan aplikasi mobile ("BreakFree Hub")
 * tidak terhitung ganda (anti double-counting), serta mengecualikan transaksi CANCELLED/VOID/PENDING.
 */
export async function calculateShiftRevenue(
  shiftId: number,
  startTime: Date | string,
  endTime?: Date | string | null
): Promise<ShiftRevenueBreakdown> {
  const params: any[] = [shiftId, startTime];
  let endCondition = '';
  if (endTime) {
    endCondition = ' AND created_at <= ?';
    params.push(endTime);
  }

  const [rows]: any = await pool.query(
    `SELECT
      COUNT(*) AS totalTransactions,
      COALESCE(SUM(total), 0) AS grandTotal,
      COALESCE(SUM(CASE
        WHEN COALESCE(order_source, 'POS') != 'MOBILE'
         AND (LOWER(payment_method) LIKE '%cash%' OR LOWER(payment_method) LIKE '%tunai%')
        THEN total ELSE 0 END), 0) AS totalCash,
      COALESCE(SUM(CASE
        WHEN COALESCE(order_source, 'POS') != 'MOBILE'
         AND (LOWER(payment_method) LIKE '%qris%' OR LOWER(payment_method) LIKE '%non%')
        THEN total ELSE 0 END), 0) AS totalQRIS,
      COALESCE(SUM(CASE
        WHEN COALESCE(order_source, 'POS') != 'MOBILE'
         AND LOWER(payment_method) LIKE '%shopee%'
        THEN total ELSE 0 END), 0) AS totalShopeeFood,
      COALESCE(SUM(CASE
        WHEN order_source = 'MOBILE'
        THEN total ELSE 0 END), 0) AS totalBreakfreeHub,
      COALESCE(SUM(CASE
        WHEN order_source = 'MOBILE'
        THEN 1 ELSE 0 END), 0) AS countBreakfreeHub
     FROM transactions
     WHERE (shift_id = ? OR (shift_id IS NULL AND created_at >= ?${endCondition}))
       AND UPPER(COALESCE(status, 'SUKSES')) NOT IN ('VOID', 'CANCELLED', 'DIBATALKAN', 'PENDING')`,
    params
  );

  const r = rows[0] || {};
  const totalCash = Number(r.totalCash) || 0;
  const totalQRIS = Number(r.totalQRIS) || 0;
  const totalShopeeFood = Number(r.totalShopeeFood) || 0;
  const totalBreakfreeHub = Number(r.totalBreakfreeHub) || 0;
  const countBreakfreeHub = Number(r.countBreakfreeHub) || 0;
  const grandTotal = totalCash + totalQRIS + totalShopeeFood + totalBreakfreeHub;

  const tax = Math.round(grandTotal * 0.1);
  const netRevenue = grandTotal - tax;

  return {
    totalTransactions: Number(r.totalTransactions) || 0,
    grandTotal,
    totalCash,
    totalQRIS,
    totalShopeeFood,
    totalBreakfreeHub,
    countBreakfreeHub,
    tax,
    netRevenue,
  };
}

export async function startShiftService(cashierName?: string, shiftStatus?: string, startingCash?: number) {
  await pool.query(
    `UPDATE shifts SET shift_status = 'CLOSED', end_time = NOW() WHERE UPPER(COALESCE(shift_status, '')) != 'CLOSED'`
  );

  const [result]: any = await pool.query(
    `INSERT INTO shifts (cashier_name, shift_status, starting_cash, start_time)
     VALUES (?, ?, ?, NOW())`,
    [cashierName || 'Kasir', shiftStatus || 'Opening', Number(startingCash) || 0]
  );

  return {
    shiftId: result.insertId,
    cashierName: cashierName || 'Kasir',
    startingCash: Number(startingCash) || 0,
  };
}

export async function closeShiftService(shiftId: number) {
  const [shiftRows]: any = await pool.query('SELECT * FROM shifts WHERE id = ?', [shiftId]);
  if (!shiftRows || shiftRows.length === 0) {
    return null;
  }

  const currentShift = shiftRows[0];
  const startingCash = Number(currentShift.starting_cash) || 0;
  const breakdown = await calculateShiftRevenue(currentShift.id, currentShift.start_time, null);
  const finalPhysicalCash = startingCash + breakdown.totalCash;

  await pool.query(
    `UPDATE shifts SET shift_status = 'CLOSED', end_time = NOW()
     WHERE id = ? OR UPPER(COALESCE(shift_status, '')) != 'CLOSED'`,
    [shiftId]
  );

  return {
    ...breakdown,
    finalPhysicalCash,
    revenueBreakdown: [
      { key: 'CASH', label: 'Cash / Tunai', amount: breakdown.totalCash },
      { key: 'QRIS', label: 'Non-Tunai / QRIS', amount: breakdown.totalQRIS },
      { key: 'SHOPEEFOOD', label: 'ShopeeFood', amount: breakdown.totalShopeeFood },
      {
        key: 'BREAKFREE_HUB',
        label: 'BreakFree Hub',
        amount: breakdown.totalBreakfreeHub,
        orderCount: breakdown.countBreakfreeHub,
      },
    ],
  };
}

export async function getShiftHistoryService() {
  const [shifts]: any = await pool.query(
    `SELECT * FROM shifts WHERE UPPER(shift_status) = 'CLOSED' ORDER BY id DESC`
  );

  const historyWithSales = await Promise.all(
    shifts.map(async (shift: any) => {
      const start = shift.start_time;
      const end = shift.end_time || new Date();
      const startingCash = Number(shift.starting_cash) || 0;
      const breakdown = await calculateShiftRevenue(shift.id, start, end);
      const finalPhysicalCash = startingCash + breakdown.totalCash;

      return {
        ...shift,
        total_cash: breakdown.totalCash,
        total_qris: breakdown.totalQRIS,
        total_shopeefood: breakdown.totalShopeeFood,
        total_breakfree_hub: breakdown.totalBreakfreeHub,
        count_breakfree_hub: breakdown.countBreakfreeHub,
        grand_total: breakdown.grandTotal,
        tax_amount: breakdown.tax,
        net_revenue: breakdown.netRevenue,
        final_physical_cash: finalPhysicalCash,
        revenueBreakdown: [
          { key: 'CASH', label: 'Cash / Tunai', amount: breakdown.totalCash },
          { key: 'QRIS', label: 'Non-Tunai / QRIS', amount: breakdown.totalQRIS },
          { key: 'SHOPEEFOOD', label: 'ShopeeFood', amount: breakdown.totalShopeeFood },
          {
            key: 'BREAKFREE_HUB',
            label: 'BreakFree Hub',
            amount: breakdown.totalBreakfreeHub,
            orderCount: breakdown.countBreakfreeHub,
          },
        ],
      };
    })
  );

  return historyWithSales;
}

export async function getActiveShiftSummaryService() {
  const currentShift = await getActiveShiftRecord();
  if (!currentShift) {
    return null;
  }

  const breakdown = await calculateShiftRevenue(currentShift.id, currentShift.start_time, null);
  const startingCash = currentShift.starting_cash;
  const expectedCashInDrawer = startingCash + breakdown.totalCash;

  const [itemRows]: any = await pool
    .query(
      `SELECT ti.product_name, SUM(ti.quantity) as total_qty, SUM(COALESCE(ti.subtotal_item, ti.price * ti.quantity)) as total_price
       FROM transaction_items ti
       INNER JOIN transactions t ON ti.transaction_id = t.transaction_id
       WHERE (t.shift_id = ? OR (t.shift_id IS NULL AND t.created_at >= ?))
         AND UPPER(COALESCE(t.status, 'SUKSES')) NOT IN ('VOID', 'CANCELLED', 'DIBATALKAN', 'PENDING')
       GROUP BY ti.product_name`,
      [currentShift.id, currentShift.start_time]
    )
    .catch(() => [[]]);

  return {
    active: true,
    shiftInfo: currentShift,
    totalTransactions: breakdown.totalTransactions,
    grandTotal: breakdown.grandTotal,
    totalCash: breakdown.totalCash,
    totalQRIS: breakdown.totalQRIS,
    totalShopeeFood: breakdown.totalShopeeFood,
    totalBreakfreeHub: breakdown.totalBreakfreeHub,
    countBreakfreeHub: breakdown.countBreakfreeHub,
    tax: breakdown.tax,
    netRevenue: breakdown.netRevenue,
    expectedCashInDrawer,
    revenueBreakdown: [
      { key: 'CASH', label: 'Cash / Tunai', amount: breakdown.totalCash },
      { key: 'QRIS', label: 'Non-Tunai / QRIS', amount: breakdown.totalQRIS },
      { key: 'SHOPEEFOOD', label: 'ShopeeFood', amount: breakdown.totalShopeeFood },
      {
        key: 'BREAKFREE_HUB',
        label: 'BreakFree Hub',
        amount: breakdown.totalBreakfreeHub,
        orderCount: breakdown.countBreakfreeHub,
      },
    ],
    soldItems: Array.isArray(itemRows) ? itemRows : [],
  };
}
