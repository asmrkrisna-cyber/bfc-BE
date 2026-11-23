import { GoogleGenAI } from '@google/genai';
import pool from '../config/database';

export interface ChatHistoryItem {
  role: 'user' | 'model';
  text: string;
}

export interface ProductItem {
  id: number;
  name: string;
  category: string;
  subcategory: string;
  price: number;
  description: string;
  image: string;
  imageUrl: string;
  tag?: string;
  isAvailable: boolean;
  totalSold?: number;
}

export interface ChatResponse {
  reply: string;
  recommendedProducts: ProductItem[];
}

/**
 * 1. Ambil semua produk aktif dari database MySQL
 */
export const getActiveProducts = async (): Promise<ProductItem[]> => {
  const [rows]: any = await pool.query(
    `SELECT id, name, category, subcategory, price, description, image, tag, is_available 
     FROM products 
     WHERE is_available = 1 
     ORDER BY id ASC`
  );

  return rows.map((p: any) => ({
    id: Number(p.id),
    name: p.name,
    category: p.category || 'Espresso Based',
    subcategory: p.subcategory || p.category || 'Espresso Based',
    price: Number(p.price) || 0,
    description: p.description || '',
    image: p.image || '',
    imageUrl: p.image || '',
    tag: p.tag || '',
    isAvailable: p.is_available === 1 || p.is_available === true,
  }));
};

/**
 * 2. Ambil 5 Menu Pilihan Barista Hari Ini (Berdasarkan Terlaris di transaction_items)
 */
export const getBaristaRecommendations = async (): Promise<ProductItem[]> => {
  try {
    const [rows]: any = await pool.query(
      `SELECT p.id, p.name, p.category, p.subcategory, p.price, p.description, p.image, p.tag, p.is_available,
              COALESCE(SUM(ti.quantity), 0) AS total_sold
       FROM products p
       LEFT JOIN transaction_items ti ON LOWER(TRIM(ti.product_name)) = LOWER(TRIM(p.name))
       WHERE p.is_available = 1
       GROUP BY p.id
       ORDER BY total_sold DESC, p.id ASC
       LIMIT 5`
    );

    if (rows && rows.length > 0 && rows.some((r: any) => Number(r.total_sold) > 0)) {
      return rows.map((p: any) => ({
        id: Number(p.id),
        name: p.name,
        category: p.category || 'Espresso Based',
        subcategory: p.subcategory || p.category || 'Espresso Based',
        price: Number(p.price) || 0,
        description: p.description || '',
        image: p.image || '',
        imageUrl: p.image || '',
        tag: p.tag || 'Favorit',
        isAvailable: p.is_available === 1 || p.is_available === true,
        totalSold: Number(p.total_sold || 0),
      }));
    }

    // Fallback jika transaksi masih kosong: ambil 5 produk unggulan/terbaru
    const [fallbackRows]: any = await pool.query(
      `SELECT id, name, category, subcategory, price, description, image, tag, is_available 
       FROM products 
       WHERE is_available = 1 
       ORDER BY id ASC 
       LIMIT 5`
    );

    return fallbackRows.map((p: any) => ({
      id: Number(p.id),
      name: p.name,
      category: p.category || 'Espresso Based',
      subcategory: p.subcategory || p.category || 'Espresso Based',
      price: Number(p.price) || 0,
      description: p.description || '',
      image: p.image || '',
      imageUrl: p.image || '',
      tag: p.tag || 'Rekomendasi',
      isAvailable: p.is_available === 1 || p.is_available === true,
      totalSold: 0,
    }));
  } catch (error) {
    console.error('Error fetching barista recommendations:', error);
    throw error;
  }
};

/**
 * 3. Chat dengan Barista AI menggunakan Gemini 2.5 Flash + Structured Output
 */
export const chatWithBarista = async (
  message: string,
  history: ChatHistoryItem[] = []
): Promise<ChatResponse> => {
  const products = await getActiveProducts();

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();

  // Susun konteks daftar produk dari database MySQL untuk System Instruction
  const productCatalogText = products
    .map(
      (p) =>
        `- [ID: ${p.id}] "${p.name}" | Kategori: ${p.category} (${p.subcategory}) | Harga: Rp ${p.price.toLocaleString('id-ID')} | Deskripsi: ${p.description || 'Racikan khas BreakFree'}${p.tag ? ' | Tag: ' + p.tag : ''}`
    )
    .join('\n');

  const systemInstruction = `Kamu adalah "Barista AI BreakFree", asisten virtual dan barista ramah, ceria, dan santai dari kedai kopi BreakFree Hub di Malang.
Gaya bicaramu:
- Hangat, ramah, santai, dan bersahabat seperti barista kafe anak muda (gunakan panggilan santai seperti "kak" atau "kamu").
- Sangat mengerti detail racikan kopi, espresso, tingkat manis, kopi ramah lambung, minuman non-kopi (cokelat, matcha, red velvet, taro, teh/buah/mocktail), makanan berat (nasi goreng, indomie nyemek, indomie goreng), hingga camilan renyah.
- Boleh menggunakan emoji kopi dan makanan yang natural (☕, 🥐, ✨, 🧊, dll) secara wajar.

ATURAN PALING PENTING:
1. HANYA rekomendasikan produk yang ADA di dalam DAFTAR KATALOG MENU BREAKFREE di bawah ini. JANGAN PERNAH mengarang atau menyebutkan nama menu fiktif yang tidak terdaftar.
2. PERHATIKAN DENGAN SANGAT TELITI KATA NEGASI ATAU PENGECUALIAN dari pelanggan (seperti 'bukan', 'tanpa', 'selain', 'gak mau', 'jangan', 'jangan yang...', 'bukan kopi', 'bukan nasi'):
   - Jika pelanggan meminta 'makan tapi BUKAN nasi' atau 'jangan yang nasi kak', JANGAN rekomendasikan menu nasi apa pun! Berikan alternatif makanan seperti Indomie Goreng, Indomie Nyemek, atau cemilan porsi kenyang seperti Mix Platter / French Fries.
   - Jika pelanggan meminta 'coklat' / 'chocolate', rekomendasikan menu cokelat seperti Hot Coklat Ori, Hot Coklat Milk, atau Signature Coklat. JANGAN merekomendasikan kopi (seperti Aren Latte atau Americano)!
   - Jika pelanggan meminta 'non-kopi' atau 'bukan kopi', HANYA rekomendasikan minuman dari kategori non-kopi/tea/signature coklat/matcha/taro.
   - Jika pelanggan mencari kopi tertentu (strong, manis, ramah lambung), sesuaikan secara akurat.
3. Saat merekomendasikan produk, masukkan ID produk tersebut ke dalam array \`recommended_product_ids\` (maksimal 3-4 produk paling relevan).
4. Jika pertanyaan pelanggan tidak berkaitan dengan rekomendasi menu (misalnya sapaan halo, tanya kabar, tanya jam buka, atau lokasi Wi-Fi), jawab dengan ramah dan isi \`recommended_product_ids\` dengan array kosong [].
5. Selalu kembalikan respon dalam format JSON sesuai schema: { "reply": string, "recommended_product_ids": number[] }.

DAFTAR KATALOG MENU BREAKFREE (DATABASE RESMI):
${productCatalogText}
`;

  // Fallback handler jika GEMINI_API_KEY belum diset
  if (!apiKey) {
    console.warn('⚠️ GEMINI_API_KEY belum dikonfigurasi di file .env. Menggunakan response fallback berbasis katalog.');
    return generateLocalFallback(message, products);
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    // Format riwayat chat
    const contents: any[] = [];
    if (history && Array.isArray(history)) {
      for (const h of history) {
        if (h.text && h.text.trim()) {
          contents.push({
            role: h.role === 'model' ? 'model' : 'user',
            parts: [{ text: h.text.trim() }],
          });
        }
      }
    }

    // Tambahkan pesan user saat ini
    contents.push({
      role: 'user',
      parts: [{ text: message.trim() }],
    });

    const modelsToTry = [
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.6-flash',
      'gemini-3.8-flash',
    ];
    let lastError: any = null;
    let rawText = '';

    for (const modelName of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
          },
        });

        if (response && response.text && response.text.trim()) {
          rawText = response.text.trim();
          break;
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`Model ${modelName} kendala (${err.status || err.message?.slice(0, 80)}), mencoba model berikutnya...`);
      }
    }

    if (!rawText) {
      throw lastError || new Error('Semua model AI sedang mengalami lonjakan trafik.');
    }
    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch (parseErr) {
      console.error('Gagal parse JSON Gemini structured output:', rawText);
      parsed = { reply: rawText, recommended_product_ids: [] };
    }

    const reply = parsed.reply || 'Ada yang bisa barista bantu lagi untuk pesananmu?';
    const recommendedIds: number[] = Array.isArray(parsed.recommended_product_ids)
      ? parsed.recommended_product_ids.map((id: any) => Number(id))
      : [];

    // Cocokkan ID dengan data produk asli MySQL
    const matchedProducts = products.filter((p) => recommendedIds.includes(p.id));

    return {
      reply,
      recommendedProducts: matchedProducts,
    };
  } catch (err: any) {
    console.error('Gemini API Error:', err.message || err);
    // Jika terjadi error kuota / koneksi, gunakan fallback cerdas dari katalog
    return generateLocalFallback(message, products);
  }
};

/**
 * Helper fallback cerdas jika API key kosong atau network offline.
 * Menghandle negasi (seperti 'bukan nasi', 'jangan yang nasi', 'bukan kopi') dan kategori spesifik.
 */
function generateLocalFallback(message: string, products: ProductItem[]): ChatResponse {
  const lower = message.toLowerCase();
  let recommendedIds: number[] = [];
  let reply = '';

  // 1. Deteksi Negasi / Pengecualian dengan regex fleksibel
  const hasNegationFor = (keyword: string) => {
    const reg = new RegExp(
      `(bukan|tanpa|selain|gak\\s*mau|nggak\\s*mau|gak\\s*pake|nggak\\s*pake|jangan|hindari|tidak\\s*mau|tidak\\s*pake)\\s*(yang\\s*|menu\\s*|makanan\\s*|minuman\\s*|pake\\s*)?${keyword}`,
      'i'
    );
    return reg.test(lower);
  };

  const excludeNasi = hasNegationFor('nasi');
  const excludeMie = hasNegationFor('mie') || hasNegationFor('indomie');
  const excludeKopi =
    hasNegationFor('kopi') ||
    hasNegationFor('coffee') ||
    hasNegationFor('kafein') ||
    lower.includes('non-kopi') ||
    lower.includes('non kopi') ||
    lower.includes('bukan kopi') ||
    lower.includes('tanpa kafein');

  // 1. Prioritas Negasi Makanan Spesifik (Misal: "jangan yang nasi kak", "bukan nasi")
  if (excludeNasi) {
    const nonNasiFood = products.filter(
      (p) =>
        !p.name.toLowerCase().includes('nasi') &&
        !p.description.toLowerCase().includes('nasi') &&
        (p.name.toLowerCase().includes('mie') ||
          p.name.toLowerCase().includes('indomie') ||
          p.category.toLowerCase().includes('makan') ||
          p.category.toLowerCase().includes('snack') ||
          p.name.toLowerCase().includes('platter'))
    );
    recommendedIds = nonNasiFood.slice(0, 3).map((p) => p.id);
    reply =
      'Siap kak! Kalau lagi gak mau nasi, tenang aja, BreakFree punya pilihan olahan mi dan cemilan kenyang yang gak kalah lezat! Kamu bisa cobain Indomie Nyemek kuah gurih berempah, Indomie Goreng klasik, atau Mix Platter lengkap. Mau pilih yang mana nih?';
  }
  // 2. Prioritas Negasi Mie Spesifik (Misal: "jangan mie", "bukan mie")
  else if (excludeMie) {
    const nonMieFood = products.filter(
      (p) =>
        !p.name.toLowerCase().includes('mie') &&
        !p.name.toLowerCase().includes('indomie') &&
        (p.name.toLowerCase().includes('nasi') || p.category.toLowerCase().includes('makan'))
    );
    recommendedIds = nonMieFood.slice(0, 3).map((p) => p.id);
    reply =
      'Siap kak! Kalau lagi nggak mau mie, kami punya menu nasi hangat yang lezat dan mengenyangkan seperti Nasi Goreng Telur, Nasi Telur Barendo crispy, atau Nasi Ayam Krispi.';
  }
  // 3. Kategori Cokelat / Chocolate (Diprioritaskan agar tidak tertelan kopi)
  else if (
    lower.includes('coklat') ||
    lower.includes('cokelat') ||
    lower.includes('chocolate') ||
    lower.includes('choco') ||
    lower.includes('kakao')
  ) {
    const chocoProducts = products.filter(
      (p) =>
        p.name.toLowerCase().includes('coklat') ||
        p.name.toLowerCase().includes('chocolate') ||
        p.description.toLowerCase().includes('coklat')
    );
    recommendedIds = chocoProducts.slice(0, 3).map((p) => p.id);
    reply =
      'Pilihan pas banget kak! Buat kamu pencinta cokelat yang manis dan lumer, barista rekomendasikan varian cokelat favorit kami: Hot Coklat Milk atau Signature Coklat dingin yang creamy!';
  }
  // 3. Kategori Matcha / Green Tea
  else if (lower.includes('matcha') || lower.includes('green tea')) {
    const matchaProducts = products.filter((p) => p.name.toLowerCase().includes('matcha'));
    recommendedIds = matchaProducts.slice(0, 3).map((p) => p.id);
    reply =
      'Bagi pencinta matcha, Signature Matcha kami punya rasa teh hijau autentik yang berpadu lembut dengan susu segar creamy. Wajib dicoba!';
  }
  // 4. Kategori Red Velvet / Taro
  else if (lower.includes('red velvet') || lower.includes('taro')) {
    const pList = products.filter(
      (p) =>
        (lower.includes('red velvet') && p.name.toLowerCase().includes('red velvet')) ||
        (lower.includes('taro') && p.name.toLowerCase().includes('taro'))
    );
    recommendedIds = pList.slice(0, 3).map((p) => p.id);
    reply =
      'Minuman non-kopi signature dengan rasa manis unik dan wangi khas yang memanjakan lidah. Cocok dinikmati dingin saat santai!';
  }
  // 5. Kategori Teh / Minuman Segar / Buah
  else if (
    lower.includes('teh') ||
    lower.includes('tea') ||
    lower.includes('lemon') ||
    lower.includes('lychee') ||
    lower.includes('leci') ||
    lower.includes('segar') ||
    lower.includes('fizz') ||
    lower.includes('buah')
  ) {
    const teaProducts = products.filter(
      (p) =>
        p.name.toLowerCase().includes('tea') ||
        p.name.toLowerCase().includes('teh') ||
        p.name.toLowerCase().includes('fizz') ||
        p.name.toLowerCase().includes('twist') ||
        p.subcategory.toLowerCase().includes('tea')
    );
    recommendedIds = teaProducts.slice(0, 3).map((p) => p.id);
    reply =
      'Lagi pengen minuman pelepas dahaga yang seger banget? Deretan teh buah dingin seperti Lychee Tea, Lemon Tea, atau Grape Fizz siap segarkan harimu!';
  }
  // 6. Kategori Makanan & Lapar Umum
  else if (
    lower.includes('makan') ||
    lower.includes('lapar') ||
    lower.includes('kenyang') ||
    lower.includes('laper')
  ) {
    const foodProducts = products.filter(
      (p) =>
        p.category.toLowerCase().includes('makan') ||
        p.subcategory.toLowerCase().includes('makan') ||
        p.name.toLowerCase().includes('indomie') ||
        p.name.toLowerCase().includes('nasi')
    );
    recommendedIds = foodProducts.slice(0, 3).map((p) => p.id);
    reply =
      'Lagi lapar kak? Dapur BreakFree punya menu hangat favorit seperti Indomie Nyemek dengan bumbu rempah gurih atau aneka Nasi Goreng dan Nasi Telur Barendo yang siap mengenyangkan!';
  }
  // 7. Kategori Mie / Indomie Secara Spesifik
  else if (lower.includes('mie') || lower.includes('indomie') || lower.includes('nyemek')) {
    const mieProducts = products.filter(
      (p) => p.name.toLowerCase().includes('mie') || p.name.toLowerCase().includes('indomie')
    );
    recommendedIds = mieProducts.slice(0, 3).map((p) => p.id);
    reply =
      'Indomie lovers merapat! Kami punya Indomie Nyemek dengan kuah medok gurih dan telur, serta Indomie Goreng klasik yang harum bawang gorengnya bikin nagih.';
  }
  // 8. Kategori Nasi Secara Spesifik (hanya jika TIDAK di-exclude)
  else if (lower.includes('nasi') && !excludeNasi) {
    const nasiProducts = products.filter((p) => p.name.toLowerCase().includes('nasi'));
    recommendedIds = nasiProducts.slice(0, 3).map((p) => p.id);
    reply =
      'Menu nasi hangat BreakFree siap bikin kenyang! Ada Nasi Goreng Telur, Nasi Telur Barendo crispy khas, hingga paket lengkap dengan Es Teh manis segar.';
  }
  // 9. Kategori Camilan / Snack
  else if (
    lower.includes('snack') ||
    lower.includes('camilan') ||
    lower.includes('cemilan') ||
    lower.includes('ngemil') ||
    lower.includes('kentang') ||
    lower.includes('cireng')
  ) {
    const snackProducts = products.filter(
      (p) =>
        p.category.toLowerCase().includes('snack') ||
        p.subcategory.toLowerCase().includes('snack') ||
        p.name.toLowerCase().includes('fries') ||
        p.name.toLowerCase().includes('cireng')
    );
    recommendedIds = snackProducts.slice(0, 3).map((p) => p.id);
    reply =
      'Teman ngobrol dan nugas paling asyik ya ngemil! Coba French Fries renyah, Cireng saus rujak pedas manis, atau Mix Platter komplit isi sosis, kentang, dan nugget.';
  }
  // 10. Kategori Kopi Strong / Pahit / Melek (hanya jika TIDAK di-exclude)
  else if (
    !excludeKopi &&
    (lower.includes('strong') ||
      lower.includes('pahit') ||
      lower.includes('nugas') ||
      lower.includes('melek') ||
      lower.includes('hitam') ||
      lower.includes('americano') ||
      lower.includes('espresso'))
  ) {
    const strongCoffee = products.filter(
      (p) =>
        p.name.toLowerCase().includes('americano') ||
        p.name.toLowerCase().includes('hitam') ||
        p.name.toLowerCase().includes('ori') ||
        p.name.toLowerCase().includes('espresso')
    );
    recommendedIds = strongCoffee.slice(0, 3).map((p) => p.id);
    reply =
      'Butuh suntikan kafein nendang buat fokus nugas malam? Americano dengan double shot espresso mantap atau Kopi Hitam Sarijan siap bikin mata melek segar!';
  }
  // 11. Kategori Kopi Manis & Creamy (hanya jika TIDAK di-exclude)
  else if (
    !excludeKopi &&
    (lower.includes('manis') ||
      lower.includes('creamy') ||
      lower.includes('aren') ||
      lower.includes('susu') ||
      lower.includes('caramel') ||
      lower.includes('kopi'))
  ) {
    const sweetCoffee = products.filter(
      (p) =>
        p.name.toLowerCase().includes('aren') ||
        p.name.toLowerCase().includes('caramel') ||
        p.name.toLowerCase().includes('susu')
    );
    recommendedIds = sweetCoffee.slice(0, 3).map((p) => p.id);
    reply =
      'Buat kamu pencinta kopi yang manis, lembut, dan creamy, barista sangat rekomendasikan Breakfree Aren Latte atau Caramel Macchiato dengan sentuhan karamel manis gurih!';
  }
  // 12. Jika user minta NON-KOPI tapi tidak spesifik rasanya
  else if (excludeKopi) {
    const nonCoffee = products.filter(
      (p) =>
        !p.category.toLowerCase().includes('coffee') &&
        !p.subcategory.toLowerCase().includes('coffee') &&
        !p.name.toLowerCase().includes('kopi') &&
        !p.name.toLowerCase().includes('latte') &&
        !p.name.toLowerCase().includes('americano')
    );
    recommendedIds = nonCoffee.slice(0, 3).map((p) => p.id);
    reply =
      'Bebas kafein kopi! Di BreakFree kami punya aneka pilihan non-kopi yang lezat: Signature Coklat, Signature Matcha, Red Velvet, hingga aneka teh buah dingin segar.';
  }
  // 13. Default Sapaan
  else {
    const topP = products
      .filter((p) => p.tag?.toLowerCase().includes('best') || p.tag?.toLowerCase().includes('favorit'))
      .slice(0, 3);
    const fallbackTop = topP.length > 0 ? topP : products.slice(0, 3);
    recommendedIds = fallbackTop.map((p) => p.id);
    reply =
      'Halo kak! Senang bisa menyapamu di BreakFree Hub ☕. Kamu lagi pengen minuman kopi creamy, kopi strong, minuman non-kopi manis/segar, atau makanan hangat? Ceritakan selera yang kamu mau ya!';
  }

  const matched = products.filter((p) => recommendedIds.includes(p.id));
  return {
    reply,
    recommendedProducts: matched,
  };
}
