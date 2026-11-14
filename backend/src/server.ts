import app from './app';
import { config } from './config';
import { logger } from './logger';
import { query } from './db';
import { hashPassword } from './auth';

async function ensureAdminUser(): Promise<void> {
  try {
    const { rows } = await query('SELECT count(*)::int AS n FROM users');
    if (rows[0].n === 0) {
      const hash = await hashPassword('admin12345');
      await query("INSERT INTO users (username, password_hash, role) VALUES ('admin', $1, 'admin')", [hash]);
      logger.warn('No users found — created default admin (admin / admin12345). CHANGE THIS PASSWORD IMMEDIATELY.');
    }
  } catch (e: any) {
    logger.warn(`Could not check/create admin user: ${e.message}`);
  }
}

async function start(): Promise<void> {
  await ensureAdminUser();
  app.listen(config.port, config.host, () => {
    logger.info(`Accounting backend listening on http://${config.host}:${config.port}`);
  });
}

start();
