import { query, withTransaction } from '../db';
import { money } from '../money';
import { JournalLineInput, PostEntryArgs } from '../types';

export const CODES = {
  CASH: '1000',
  BANK: '1005',
  MOBILE_MONEY: '1010',
  AR: '1100',
  AP: '2000',
  VAT_PAYABLE: '2100',
};

export async function getAccountByCode(code: string, client?: any): Promise<any> {
  const q = client || { query };
  const { rows } = await q.query(
    'SELECT id, code, name, type, normal_balance FROM accounts WHERE code = $1',
    [code],
  );
  return rows[0];
}

async function periodIsClosed(date: string): Promise<boolean> {
  const { rows } = await query(
    'SELECT 1 FROM fiscal_periods WHERE is_closed = TRUE AND start_date <= $1::date AND end_date >= $1::date',
    [date],
  );
  return rows.length > 0;
}

export async function getEntry(id: number, client?: any): Promise<any> {
  const q = client || { query };
  const { rows } = await q.query(
    `SELECT je.*,
            COALESCE(json_agg(json_build_object(
              'id', l.id, 'account_code', a.code, 'line_type', l.line_type,
              'amount', l.amount, 'line_no', l.line_no, 'party_id', l.party_id
            ) ORDER BY l.line_no) FILTER (WHERE l.id IS NOT NULL), '[]') AS lines
     FROM journal_entries je
     LEFT JOIN journal_entry_lines l ON l.journal_entry_id = je.id
     LEFT JOIN accounts a ON a.id = l.account_id
     WHERE je.id = $1
     GROUP BY je.id`,
    [id],
  );
  return rows[0];
}

async function _postJournalEntry(args: PostEntryArgs, client: any): Promise<any> {
  const { date, reference = '', description = '', lines, idempotencyKey = null } = args;

  if (idempotencyKey) {
    const existing = await client.query(
      'SELECT id FROM journal_entries WHERE idempotency_key = $1',
      [idempotencyKey],
    );
    if (existing.rows.length) return getEntry(existing.rows[0].id, client);
  }

  const entry = await client.query(
    'INSERT INTO journal_entries (entry_date, reference, description, idempotency_key) VALUES ($1::date, $2, $3, $4) RETURNING id',
    [date, reference, description, idempotencyKey],
  );
  const entryId = entry.rows[0].id;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const acct = await getAccountByCode(line.accountCode, client);
    if (!acct) throw new Error(`Account not found: ${line.accountCode}`);
    await client.query(
      'INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_type, amount, line_no, party_id, department_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [entryId, acct.id, line.lineType, line.amount, i + 1, line.partyId || null, line.departmentId || null],
    );
  }

  await client.query("UPDATE journal_entries SET status = 'posted' WHERE id = $1", [entryId]);
  return getEntry(entryId, client);
}

export async function postJournalEntry(args: PostEntryArgs, client?: any): Promise<any> {
  const { lines } = args;
  if (!lines || lines.length === 0) throw new Error('A journal entry needs at least one line.');

  const totalDebit = lines.filter((l) => l.lineType === 'debit').reduce((s, l) => s.plus(money(l.amount)), money(0));
  const totalCredit = lines.filter((l) => l.lineType === 'credit').reduce((s, l) => s.plus(money(l.amount)), money(0));

  if (totalDebit.isZero()) throw new Error('A journal entry cannot have zero amounts.');
  if (!totalDebit.minus(totalCredit).abs().lessThanOrEqualTo(0.005)) {
    throw new Error(`Journal entry is not balanced: debits ${totalDebit} != credits ${totalCredit}.`);
  }
  if (await periodIsClosed(args.date)) throw new Error(`Period ${args.date} is closed for posting.`);

  if (client) return _postJournalEntry(args, client);
  return withTransaction((c) => _postJournalEntry(args, c));
}

export async function reverseEntry(entryId: number): Promise<any> {
  const entry = await getEntry(entryId);
  if (!entry) throw new Error('Entry not found.');
  if (entry.status !== 'posted') throw new Error('Only posted entries can be reversed.');
  const { rows } = await query('SELECT 1 FROM journal_entries WHERE reversal_of_id = $1', [entryId]);
  if (rows.length) throw new Error('Entry is already reversed.');

  const lines: JournalLineInput[] = (entry.lines || []).map((l: any) => ({
    accountCode: l.account_code,
    lineType: l.line_type === 'debit' ? 'credit' : 'debit',
    amount: l.amount,
    partyId: l.party_id || null,
  }));

  const reversal = await postJournalEntry({
    date: entry.entry_date,
    reference: `REV-${entry.reference || entry.id}`,
    description: `Reversal of ${entry.reference || entry.id}`,
    lines,
  });

  await query('UPDATE journal_entries SET reversal_of_id = $1 WHERE id = $2', [entryId, reversal.id]);
  return reversal;
}
