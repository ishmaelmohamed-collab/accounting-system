import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

export const config = {
  port: parseInt(process.env.PORT || '8000', 10),
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5433', 10),
    database: process.env.DB_NAME || 'accounting',
    user: process.env.DB_USER || 'accounting_app',
    password: process.env.DB_PASSWORD || '',
  },
};
