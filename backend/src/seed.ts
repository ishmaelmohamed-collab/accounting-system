import { query } from './db';
import { hashPassword } from './auth';

async function main(): Promise<void> {
  const username = process.argv[2] || 'admin';
  const password = process.argv[3] || 'admin12345';
  const hash = await hashPassword(password);
  await query(
    'INSERT INTO users (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash',
    [username, hash],
  );
  console.log(`User created: ${username}`);
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
