import { Pool, PoolClient, QueryResult } from 'pg';
import { config } from './config';

export const pool = new Pool(
  config.databaseUrl
    ? { connectionString: config.databaseUrl, ssl: { rejectUnauthorized: false } }
    : config.db,
);

export function query(text: string, params?: unknown[]): Promise<QueryResult<any>> {
  return pool.query(text, params);
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
