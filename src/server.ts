import app from './app';
import pool from './config/database';
import { logger } from './utils/logger';
import { runPointsMigration } from './scripts/migratePoints';

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    // Tes koneksi database MySQL
    await pool.query('SELECT 1');
    logger.info('MySQL Database connected successfully.');

    // Jalankan migrasi kolom dan tabel poin jika belum ada
    try {
      await runPointsMigration();
    } catch (migErr) {
      logger.warn({ err: migErr }, 'Point migration warning (ignored if already applied)');
    }

    app.listen(PORT, () => {
      logger.info(`Server is running securely on http://localhost:${PORT}`);
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server due to database connection error');
    process.exit(1);
  }
}

startServer();
