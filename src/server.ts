import app from './app';
import pool from './config/database';
import { logger } from './utils/logger';

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    // Tes koneksi database MySQL
    await pool.query('SELECT 1');
    logger.info('MySQL Database connected successfully.');

    app.listen(PORT, () => {
      logger.info(`Server is running securely on http://localhost:${PORT}`);
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server due to database connection error');
    process.exit(1);
  }
}

startServer();
