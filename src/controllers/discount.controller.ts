import { Request, Response } from 'express';
import {
  getAllDiscountsService,
  getActiveDiscountsService,
  createDiscountService,
  updateDiscountService,
  toggleDiscountStatusService,
  deleteDiscountService,
  validateDiscountService,
} from '../services/discount.service';

// 1. Ambil Semua Diskon (Web POS)
export const getDiscounts = async (_req: Request, res: Response): Promise<any> => {
  try {
    const discounts = await getAllDiscountsService();
    return res.json(discounts);
  } catch (error: any) {
    console.error('Error getDiscounts:', error);
    return res.status(500).json({ message: 'Gagal mengambil data diskon', error: error.message });
  }
};

// 2. Ambil Hanya Diskon Aktif (Aplikasi Mobile)
export const getActiveDiscounts = async (_req: Request, res: Response): Promise<any> => {
  try {
    const discounts = await getActiveDiscountsService();
    return res.json({
      success: true,
      count: discounts.length,
      discounts,
    });
  } catch (error: any) {
    console.error('Error getActiveDiscounts:', error);
    return res.status(500).json({ success: false, message: 'Gagal mengambil promo aktif', error: error.message });
  }
};

// 3. Tambah Diskon Baru (Web POS)
export const createDiscount = async (req: Request, res: Response): Promise<any> => {
  try {
    const { code, name, title, description, type, discountType, value, discountValue, minPurchase, minOrder, maxDiscount } = req.body;
    if (!code || (!name && !title) || (value === undefined && discountValue === undefined)) {
      return res.status(400).json({ message: 'Kode, judul/nama, dan nilai diskon wajib diisi' });
    }

    const discount = await createDiscountService({
      code,
      name,
      title,
      description,
      type,
      discountType,
      value,
      discountValue,
      minPurchase,
      minOrder,
      maxDiscount,
    });

    return res.status(201).json({
      success: true,
      message: 'Diskon berhasil dibuat',
      discount,
    });
  } catch (error: any) {
    console.error('Error createDiscount:', error);
    return res.status(500).json({ message: 'Gagal menambahkan diskon', error: error.message });
  }
};

// 4. Update / Edit Detail Diskon (Web POS)
export const updateDiscount = async (req: Request, res: Response): Promise<any> => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const discount = await updateDiscountService(id, req.body);
    return res.json({
      success: true,
      message: 'Diskon berhasil diperbarui',
      discount,
    });
  } catch (error: any) {
    console.error('Error updateDiscount:', error);
    return res.status(500).json({ message: error.message || 'Gagal memperbarui diskon' });
  }
};

// 5. Toggle Status Aktif Diskon (Web POS)
export const toggleDiscountStatus = async (req: Request, res: Response): Promise<any> => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const isActive = await toggleDiscountStatusService(id);
    return res.json({
      success: true,
      message: 'Status diskon berhasil diubah',
      isActive,
    });
  } catch (error: any) {
    console.error('Error toggleDiscountStatus:', error);
    return res.status(500).json({ message: error.message || 'Gagal mengubah status diskon' });
  }
};

// 6. Hapus Diskon (Web POS)
export const deleteDiscount = async (req: Request, res: Response): Promise<any> => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    await deleteDiscountService(id);
    return res.json({
      success: true,
      message: 'Diskon berhasil dihapus',
    });
  } catch (error: any) {
    console.error('Error deleteDiscount:', error);
    return res.status(500).json({ message: 'Gagal menghapus diskon', error: error.message });
  }
};

// 7. Validasi Diskon & Hitung Potongan Server-Side (Mobile & POS Checkout)
export const validateDiscount = async (req: Request, res: Response): Promise<any> => {
  try {
    const { code, subtotal } = req.body;
    const result = await validateDiscountService(code, Number(subtotal) || 0);

    if (!result.valid) {
      return res.status(400).json({
        success: false,
        valid: false,
        message: result.message,
      });
    }

    return res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('Error validateDiscount:', error);
    return res.status(500).json({ success: false, message: 'Gagal memvalidasi diskon', error: error.message });
  }
};
