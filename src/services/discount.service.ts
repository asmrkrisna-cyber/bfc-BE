import pool from '../config/database';

export interface DiscountDto {
  id?: string;
  code: string;
  title?: string;
  name?: string;
  description?: string;
  type?: 'PERCENTAGE' | 'FIXED' | 'PERCENT';
  discountType?: 'PERCENT' | 'FIXED';
  value?: number;
  discountValue?: number;
  minPurchase?: number;
  minOrder?: number;
  maxDiscount?: number | null;
  isActive?: boolean;
}

export const mapDiscountRow = (row: any) => {
  const rawType = (row.type || 'PERCENTAGE').toUpperCase();
  const isPercent = rawType === 'PERCENT' || rawType === 'PERCENTAGE';
  const val = Number(row.value) || 0;
  const minOrd = Number(row.min_purchase) || 0;
  const maxDisc = row.max_discount !== null && row.max_discount !== undefined ? Number(row.max_discount) : null;
  const title = row.title || row.name || '';

  return {
    id: row.id.toString(),
    code: row.code,
    name: row.name || title,
    title,
    description: row.description || '',
    type: isPercent ? 'PERCENTAGE' : 'FIXED',
    discountType: isPercent ? 'PERCENT' : 'FIXED',
    value: val,
    discountValue: val,
    minPurchase: minOrd,
    minOrder: minOrd,
    maxDiscount: maxDisc,
    isActive: row.is_active === 1 || row.is_active === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export const getAllDiscountsService = async () => {
  const [rows]: any = await pool.query('SELECT * FROM discounts ORDER BY id DESC');
  return rows.map(mapDiscountRow);
};

export const getActiveDiscountsService = async () => {
  const [rows]: any = await pool.query('SELECT * FROM discounts WHERE is_active = 1 ORDER BY id DESC');
  return rows.map(mapDiscountRow);
};

export const createDiscountService = async (data: DiscountDto) => {
  const code = (data.code || '').trim().toUpperCase();
  const name = (data.name || data.title || '').trim();
  const title = (data.title || data.name || '').trim();
  const description = (data.description || '').trim();
  const rawType = (data.type || data.discountType || 'PERCENTAGE').toUpperCase();
  const dbType = rawType === 'PERCENT' || rawType === 'PERCENTAGE' ? 'PERCENTAGE' : 'FIXED';
  const val = Number(data.value ?? data.discountValue) || 0;
  const minOrd = Number(data.minPurchase ?? data.minOrder) || 0;
  const maxDisc = data.maxDiscount !== undefined && data.maxDiscount !== null ? Number(data.maxDiscount) : null;

  const [result]: any = await pool.query(
    `INSERT INTO discounts (code, name, title, description, type, value, min_purchase, max_discount, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
    [code, name, title, description, dbType, val, minOrd, maxDisc]
  );

  const [created]: any = await pool.query('SELECT * FROM discounts WHERE id = ?', [result.insertId]);
  return mapDiscountRow(created[0]);
};

export const updateDiscountService = async (id: string, data: Partial<DiscountDto>) => {
  const [existing]: any = await pool.query('SELECT * FROM discounts WHERE id = ?', [id]);
  if (!existing || existing.length === 0) {
    throw new Error('Diskon tidak ditemukan');
  }

  const current = existing[0];
  const code = data.code !== undefined ? data.code.trim().toUpperCase() : current.code;
  const name = data.name !== undefined ? data.name.trim() : (data.title !== undefined ? data.title.trim() : current.name);
  const title = data.title !== undefined ? data.title.trim() : (data.name !== undefined ? data.name.trim() : current.title || current.name);
  const description = data.description !== undefined ? data.description.trim() : current.description;
  
  let dbType = current.type;
  if (data.type || data.discountType) {
    const rawType = (data.type || data.discountType || '').toUpperCase();
    dbType = rawType === 'PERCENT' || rawType === 'PERCENTAGE' ? 'PERCENTAGE' : 'FIXED';
  }

  const val = data.value !== undefined ? Number(data.value) : (data.discountValue !== undefined ? Number(data.discountValue) : Number(current.value));
  const minOrd = data.minPurchase !== undefined ? Number(data.minPurchase) : (data.minOrder !== undefined ? Number(data.minOrder) : Number(current.min_purchase));
  const maxDisc = data.maxDiscount !== undefined ? (data.maxDiscount === null ? null : Number(data.maxDiscount)) : current.max_discount;
  const isActive = data.isActive !== undefined ? (data.isActive ? 1 : 0) : current.is_active;

  await pool.query(
    `UPDATE discounts 
     SET code = ?, name = ?, title = ?, description = ?, type = ?, value = ?, min_purchase = ?, max_discount = ?, is_active = ?
     WHERE id = ?`,
    [code, name, title, description, dbType, val, minOrd, maxDisc, isActive, id]
  );

  const [updated]: any = await pool.query('SELECT * FROM discounts WHERE id = ?', [id]);
  return mapDiscountRow(updated[0]);
};

export const toggleDiscountStatusService = async (id: string) => {
  await pool.query(
    `UPDATE discounts SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?`,
    [id]
  );
  const [updated]: any = await pool.query('SELECT is_active FROM discounts WHERE id = ?', [id]);
  if (!updated || updated.length === 0) {
    throw new Error('Diskon tidak ditemukan');
  }
  return updated[0].is_active === 1;
};

export const deleteDiscountService = async (id: string) => {
  const [result]: any = await pool.query('DELETE FROM discounts WHERE id = ?', [id]);
  return result.affectedRows > 0;
};

export const validateDiscountService = async (code: string, subtotal: number) => {
  const cleanCode = (code || '').trim().toUpperCase().replace(/^KODE\s*PROMO\s*:\s*/, '');
  if (!cleanCode) {
    return {
      valid: false,
      message: 'Kode voucher / promo wajib diisi.',
    };
  }

  const [rows]: any = await pool.query('SELECT * FROM discounts WHERE code = ?', [cleanCode]);
  if (!rows || rows.length === 0) {
    return {
      valid: false,
      message: `Kode promo "${cleanCode}" tidak terdaftar.`,
    };
  }

  const promo = rows[0];
  if (promo.is_active !== 1) {
    return {
      valid: false,
      message: `Kode promo "${cleanCode}" saat ini sedang dinonaktifkan oleh kasir.`,
    };
  }

  const currentSubtotal = Math.max(0, Number(subtotal) || 0);
  const minPurchase = Number(promo.min_purchase) || 0;
  if (currentSubtotal < minPurchase) {
    return {
      valid: false,
      message: `Minimal belanja untuk promo "${cleanCode}" adalah Rp ${minPurchase.toLocaleString('id-ID')}.`,
    };
  }

  const rawType = (promo.type || '').toUpperCase();
  const isPercent = rawType === 'PERCENT' || rawType === 'PERCENTAGE';
  const promoVal = Number(promo.value) || 0;
  let discountAmount = 0;

  if (isPercent) {
    discountAmount = Math.round((currentSubtotal * promoVal) / 100);
    const maxDiscount = promo.max_discount !== null ? Number(promo.max_discount) : (cleanCode === 'BREAK20' ? 10000 : null);
    if (maxDiscount !== null && discountAmount > maxDiscount) {
      discountAmount = maxDiscount;
    }
  } else {
    discountAmount = Math.min(currentSubtotal, promoVal);
  }

  const totalPayment = Math.max(0, currentSubtotal - discountAmount);

  return {
    valid: true,
    discount: mapDiscountRow(promo),
    code: promo.code,
    name: promo.name || promo.title,
    title: promo.title || promo.name,
    discountAmount,
    subtotal: currentSubtotal,
    totalPayment,
    message: `Voucher "${promo.name || promo.title}" berhasil diterapkan! Hemat Rp ${discountAmount.toLocaleString('id-ID')}.`,
  };
};
