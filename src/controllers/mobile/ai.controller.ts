import { Request, Response } from 'express';
import pool from '../../config/database';

/**
 * Endpoint AI Barista Chatbot untuk Aplikasi Mobile
 * Mampu menjawab rekomendasi menu, preferensi lambung, promo, jam buka, dan melampirkan menu langsung.
 */
export const handleBaristaChat = async (req: Request, res: Response): Promise<any> => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Pesan chat wajib diisi.',
      });
    }

    const lower = message.toLowerCase().trim();

    // Default quick replies yang interaktif
    const defaultSuggestions = [
      '☕ Kopi Manis & Creamy',
      '⚡ Kopi Strong / Nugas',
      '🥤 Non-Kopi Segar',
      '🍜 Makanan Lapar',
      '🍟 Camilan Nongkrong',
      '🏷️ Info Promo BREAK20',
      '📍 Jam Buka & Wi-Fi',
      '❤️ Kopi Aman di Lambung',
    ];

    let responseText = '';
    let productSearchTerms: string[] = [];
    let quickReplies: string[] = defaultSuggestions;

    // 1. Rekomendasi Kopi Manis & Creamy
    if (
      lower.includes('manis') ||
      lower.includes('creamy') ||
      lower.includes('aren') ||
      lower.includes('caramel') ||
      lower.includes('gula aren')
    ) {
      responseText =
        'Buat kamu pencinta rasa kopi yang manis, lembut, dan creamy, aku sangat rekomendasikan **Breakfree Aren Latte** atau **Ice Kopi Susu**! Menggunakan gula aren murni dengan susu segar yang pas banget di lidah.';
      productSearchTerms = ['Aren Latte', 'Ice Kopi Susu', 'Caramel Macchiato'];
      quickReplies = ['⚡ Mau yang lebih strong?', '🍟 Camilan pendamping?', '🏷️ Ada promo apa?'];
    }
    // 2. Kopi Strong / Melek Nugas
    else if (
      lower.includes('strong') ||
      lower.includes('melek') ||
      lower.includes('nugas') ||
      lower.includes('pahit') ||
      lower.includes('lembur') ||
      lower.includes('americano') ||
      lower.includes('hitam')
    ) {
      responseText =
        'Butuh dorongan kafein biar fokus nugas dan nggak ngantuk? Coba **Americano** dengan double shot espresso murni, atau **Kopi Hitam Sarijan** seduhan tradisional yang mantap dan nendang!';
      productSearchTerms = ['Americano', 'Kopi Hitam', 'Espresso'];
      quickReplies = ['❤️ Ada yang aman di lambung?', '🍜 Menu makanannya?', '📍 Info Wi-Fi kafe'];
    }
    // 3. Minuman Segar Non-Kopi / Mocktails
    else if (
      lower.includes('non-kopi') ||
      lower.includes('non kopi') ||
      lower.includes('segar') ||
      lower.includes('mocktail') ||
      lower.includes('buah') ||
      lower.includes('soda') ||
      lower.includes('matcha') ||
      lower.includes('coklat')
    ) {
      responseText =
        'Lagi nggak pengen kopi? Tenang kak! Kami punya mocktail dingin bersoda yang super segar seperti **Manggo Orange Twist** dan **Grape Fizz**, atau pilihan creamy seperti **Matcha Latte** dan **Hot Coklat Milk**.';
      productSearchTerms = ['Manggo Orange Twist', 'Grape Fizz', 'Matcha Latte', 'Hot Coklat Milk'];
      quickReplies = ['☕ Kalau menu kopi terlaris?', '🍟 Camilan cireng / kentang', '🏷️ Cek voucher diskon'];
    }
    // 4. Makanan Berat & Mie
    else if (
      lower.includes('makan') ||
      lower.includes('lapar') ||
      lower.includes('nasi') ||
      lower.includes('mie') ||
      lower.includes('kenyang')
    ) {
      responseText =
        'Lapar saat nongkrong? Cobain **Nasi Goreng Breakfree** spesial dengan telur mata sapi dan bumbu gurih, atau **Mie Goreng Spesial** hangat yang siap mengisi energimu!';
      productSearchTerms = ['Nasi Goreng Breakfree', 'Mie Goreng Spesial'];
      quickReplies = ['🥤 Mau minum yang segar', '🍟 Tambah camilan kentang', '☕ Kopi susu aren'];
    }
    // 5. Camilan / Snack
    else if (
      lower.includes('snack') ||
      lower.includes('camilan') ||
      lower.includes('kentang') ||
      lower.includes('cireng') ||
      lower.includes('fries')
    ) {
      responseText =
        'Camilan renyah teman ngobrol favorit pelanggan: **Kentang Goreng (French Fries)** renyah dengan bumbu gurih, atau **Cireng Crispy Rujak** kenyal dengan cocolan saus rujak pedas manis!';
      productSearchTerms = ['Kentang Goreng (French Fries)', 'Cireng Crispy Rujak'];
      quickReplies = ['☕ Rekomendasi kopi manis', '🥤 Mocktail soda dingin', '🏷️ Cara pakai promo'];
    }
    // 6. Kopi Aman di Lambung / Maag
    else if (
      lower.includes('lambung') ||
      lower.includes('maag') ||
      lower.includes('asam') ||
      lower.includes('aman')
    ) {
      responseText =
        'Bagi yang sensitif terhadap asam lambung, kami sarankan memilih varian berbasis susu creamy seperti **Breakfree Aren Latte** atau menu non-kopi seperti **Matcha Latte**. Kamu juga bisa minta takaran less espresso ke barista!';
      productSearchTerms = ['Breakfree Aren Latte', 'Matcha Latte'];
      quickReplies = ['🥤 Pilihan non-kopi segar', '🍟 Camilan ramah lambung', '☕ Kopi manis creamy'];
    }
    // 7. Info Promo & Voucher
    else if (
      lower.includes('promo') ||
      lower.includes('voucher') ||
      lower.includes('diskon') ||
      lower.includes('break20') ||
      lower.includes('hemat')
    ) {
      responseText =
        'Kabar gembira! Gunakan voucher **BREAK20** untuk diskon 20% (maks. Rp 10.000 dengan min. belanja Rp 30.000). Selain itu ada promo komunitas **KOPIKAMPUS** untuk hemat 20% tanpa minimum belanja.';
      quickReplies = ['☕ Pesan Kopi Aren sekarang', '🍜 Mau pesan makanan', '📍 Lokasi & Jam buka'];
    }
    // 8. Jam Buka & Wi-Fi Kafe
    else if (
      lower.includes('buka') ||
      lower.includes('jam') ||
      lower.includes('wifi') ||
      lower.includes('wi-fi') ||
      lower.includes('lokasi') ||
      lower.includes('alamat')
    ) {
      responseText =
        '📍 **BreakFree Coffee Malang**\n' +
        '• Jam Operasional: Setiap hari 08.00 - 23.00 WIB.\n' +
        '• Fasilitas: Full Wi-Fi High Speed (**SSID: BreakFree_Guest**, Password: *kopikampus2026*), colokan listrik di tiap meja, indoor AC & outdoor area.';
      quickReplies = ['☕ Rekomendasi menu nugas', '🏷️ Cek promo hari ini', '⚡ Kopi strong melek'];
    }
    // 9. Pertanyaan Umum / Default
    else {
      responseText =
        `Halo kak! Senang bisa ngobrol denganmu. Sebagai Barista AI BreakFree, aku bisa kasih saran menu kopi, non-kopi, makanan hangat, hingga info promo dan fasilitas kafe. Ada yang bisa aku bantu rekomendasikan?`;
      productSearchTerms = ['Breakfree Aren Latte', 'Manggo Orange Twist', 'Kentang Goreng'];
    }

    // Ambil data produk nyata dari database MySQL sesuai kata kunci pencarian
    let products: any[] = [];
    if (productSearchTerms.length > 0) {
      const placeholders = productSearchTerms.map(() => 'LOWER(name) LIKE LOWER(?)').join(' OR ');
      const searchValues = productSearchTerms.map((term) => `%${term}%`);

      const [dbProducts]: any = await pool.query(
        `SELECT * FROM products WHERE is_available = 1 AND (${placeholders}) LIMIT 4`,
        searchValues
      );

      products = dbProducts.map((p: any) => ({
        id: p.id.toString(),
        name: p.name,
        price: Math.round(Number(p.price)),
        category: p.category,
        description: p.description,
        image: p.image || '',
      }));
    }

    return res.json({
      success: true,
      responseText,
      products,
      quickReplies,
    });
  } catch (error: any) {
    console.error('Error handleBaristaChat:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memproses obrolan AI Barista.',
      error: error.message,
    });
  }
};
