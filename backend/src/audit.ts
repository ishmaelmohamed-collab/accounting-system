import { query } from './db';

export async function logAudit(
  userId: number | undefined,
  username: string | undefined,
  action: string,
  entityType: string,
  entityId?: number | null,
  details?: any,
): Promise<void> {
  await query(
    'INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5,$6)',
    [userId ?? null, username ?? null, action, entityType, entityId ?? null, details ?? null],
  );
}
