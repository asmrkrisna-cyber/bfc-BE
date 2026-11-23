import { Request, Response } from 'express';
import pool from '../config/database';
import { createTransactionService, voidTransactionService } from '../services/transaction.service';

// 1. Membuat Transaksi Baru (POS & terintegrasi dengan Poin)
export const createTransaction = async (req: Request, res: Response) => {
  try {
    const {
      transactionId,
      customerId,
      customerName,
      tableNumber,
      subtotal,
      discountAmount,
      tax,
      total,
      paymentMethod,
      cashGiven,
      change,
      items,
      usePoints,
    } = req.body;

    const result = await createTransactionService({
      transactionId: transactionId || `TRX-${Date.now()}`,
      customerId: customerId ? Number(customerId) : (req as any).customer?.id || null,
      customerName,
      tableNumber,
      subtotal: Number(subtotal) || 0,
      discountAmount: Number(discountAmount) || 0,
      tax: Number(tax) || 0,
      total: Number(total) || 0,
      paymentMethod,
      cashGiven: Number(cashGiven) || 0,
      change: Number(change) || 0,
      items: items || [],
      usePoints: usePoints === true || usePoints === 'true',
    });

    return res.status(201).json(result);
  } catch (error: any) {
    console.error('Error createTransaction:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal menyimpan transaksi ke server',
      error: error.message,
    });
  }
};

// 2. Mengambil Semua Daftar Transaksi (Riwayat)
export const getTransactions = async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query('SELECT * FROM transactions ORDER BY id DESC');
    return res.status(200).json(rows);
  } catch (error: any) {
    console.error('Error getTransactions:', error);
    return res.status(500).json({ success: false, message: 'Gagal mengambil riwayat transaksi' });
  }
};

// 3. Mengambil Detail Item Berdasarkan ID Transaksi
export const getTransactionItems = async (req: Request, res: Response) => {
  try {
    const rawId = req.params.transactionId;
    const transactionId = Array.isArray(rawId) ? rawId[0] : rawId;
    const cleanId = decodeURIComponent(transactionId).trim();
    const withHash = cleanId.startsWith('#') ? cleanId : `#${cleanId}`;
    const withoutHash = cleanId.startsWith('#') ? cleanId.slice(1) : cleanId;

    const [rows]: any = await pool.query(
      `SELECT id, transaction_id, product_id, product_name, price, quantity, 
              COALESCE(subtotal_item, price * quantity) AS subtotal_item, note, created_at 
       FROM transaction_items 
       WHERE transaction_id = ? OR transaction_id = ? 
       ORDER BY id ASC`,
      [withHash, withoutHash]
    );

    return res.status(200).json(rows);
  } catch (error: any) {
    console.error('Error getTransactionItems:', error);
    return res.status(500).json({ success: false, message: 'Gagal mengambil detail item transaksi' });
  }
};

// 4. Membatalkan / Void Transaksi (Otomatis refund / penyesuaian poin)
export const voidTransaction = async (req: Request, res: Response) => {
  try {
    const rawId = req.params.transactionId;
    const transactionId = Array.isArray(rawId) ? rawId[0] : rawId;
    const { reason } = req.body;

    const result = await voidTransactionService(transactionId, reason);
    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Error voidTransaction:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal melakukan void transaksi',
      error: error.message,
    });
  }
};
