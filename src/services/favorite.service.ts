import pool from '../config/database';

function normalizeProductName(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/^sf\s+/g, '')
    .replace(/breakfree\s+/g, '')
    .replace(/krispi/g, 'crispy')
    .replace(/pau/g, 'pao')
    .replace(/sarijan/g, '')
    .replace(/\s*\+\s*es\s*teh.*/g, '')
    .replace(/\s*\+\s*telur.*/g, '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolusi ID produk numerik MySQL berdasarkan ID langsung atau kecocokan nama produk.
 */
async function resolveNumericProductId(rawId?: any, productName?: string): Promise<{ id: number; name: string } | null> {
  const numericId = Number(rawId);
  if (Number.isInteger(numericId) && numericId > 0) {
    const [byId]: any = await pool.query('SELECT id, name FROM products WHERE id = ? LIMIT 1', [numericId]);
    if (byId && byId.length > 0) {
      return { id: Number(byId[0].id), name: byId[0].name };
    }
  }

  if (productName && productName.trim().length > 0) {
    const [exact]: any = await pool.query(
      'SELECT id, name FROM products WHERE LOWER(name) = LOWER(?) LIMIT 1',
      [productName.trim()]
    );
    if (exact && exact.length > 0) {
      return { id: Number(exact[0].id), name: exact[0].name };
    }

    const normTarget = normalizeProductName(productName);
    const [allRows]: any = await pool.query('SELECT id, name FROM products ORDER BY id ASC');
    for (const row of allRows) {
      const rowNorm = normalizeProductName(row.name);
      if (rowNorm === normTarget || (rowNorm.length >= 4 && (rowNorm.includes(normTarget) || normTarget.includes(rowNorm)))) {
        return { id: Number(row.id), name: row.name };
      }
    }
  }

  return null;
}

export async function getUserFavoritesService(userId: number) {
  const [rows]: any = await pool.query(
    `SELECT uf.id AS favorite_id, uf.created_at AS favorited_at,
            p.id, p.name, p.category, p.subcategory, p.price, p.description, p.image, p.tag, p.is_available
     FROM user_favorites uf
     INNER JOIN products p ON uf.product_id = p.id
     WHERE uf.user_id = ?
     ORDER BY uf.created_at DESC`,
    [userId]
  );

  return rows.map((p: any) => ({
    id: Number(p.id),
    productId: p.id.toString(),
    name: p.name,
    category: p.category || 'Kopi',
    subcategory: p.subcategory || null,
    price: Math.round(Number(p.price) || 0),
    description: p.description || '',
    image: p.image || '',
    tag: p.tag || null,
    isAvailable: p.is_available === 1 || p.is_available === true,
    isFavorite: true,
    favoritedAt: p.favorited_at,
  }));
}

export async function getUserFavoriteProductIds(userId: number): Promise<Set<number>> {
  const [rows]: any = await pool.query(
    'SELECT product_id FROM user_favorites WHERE user_id = ?',
    [userId]
  );
  return new Set(rows.map((r: any) => Number(r.product_id)));
}

export async function toggleUserFavoriteService(
  userId: number,
  rawProductId?: any,
  productName?: string
): Promise<{ isFavorite: boolean; productId: number; productName: string }> {
  const resolved = await resolveNumericProductId(rawProductId, productName);
  if (!resolved) {
    throw new Error('Produk tidak ditemukan di database.');
  }

  const [existing]: any = await pool.query(
    'SELECT id FROM user_favorites WHERE user_id = ? AND product_id = ? LIMIT 1',
    [userId, resolved.id]
  );

  if (existing && existing.length > 0) {
    await pool.query('DELETE FROM user_favorites WHERE id = ?', [existing[0].id]);
    return {
      isFavorite: false,
      productId: resolved.id,
      productName: resolved.name,
    };
  }

  await pool.query(
    'INSERT INTO user_favorites (user_id, product_id) VALUES (?, ?)',
    [userId, resolved.id]
  );

  return {
    isFavorite: true,
    productId: resolved.id,
    productName: resolved.name,
  };
}
