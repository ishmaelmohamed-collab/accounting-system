import { query, withTransaction } from '../db';
import { postJournalEntry } from './journal';

const FREQUENCY_INTERVALS: Record<string, string> = {
  weekly: '1 week',
  monthly: '1 month',
  quarterly: '3 months',
  yearly: '1 year',
};

export async function createRecurringEntry(args: any): Promise<any> {
  return withTransaction(async (client) => {
    const r = await client.query(
      'INSERT INTO recurring_entries (description, frequency, next_run_date) VALUES ($1, $2, $3::date) RETURNING id',
      [args.description, args.frequency, args.nextRunDate],
    );
    const id = r.rows[0].id;
    for (let i = 0; i < args.lines.length; i++) {
      const l = args.lines[i];
      await client.query(
        'INSERT INTO recurring_entry_lines (recurring_entry_id, account_code, line_type, amount, description, line_no) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, l.accountCode, l.lineType, l.amount, l.description || null, i + 1],
      );
    }
    return { recurringEntryId: id, description: args.description };
  });
}

export async function processRecurringEntries(asOfDate: string): Promise<any[]> {
  const due = (await query(
    'SELECT * FROM recurring_entries WHERE is_active = TRUE AND next_run_date <= $1::date ORDER BY next_run_date, id',
    [asOfDate],
  )).rows;
  const posted: any[] = [];
  for (const r of due) {
    const lines = (await query(
      'SELECT * FROM recurring_entry_lines WHERE recurring_entry_id = $1 ORDER BY line_no',
      [r.id],
    )).rows;
    if (!lines.length) continue;
    const entry = await postJournalEntry({
      date: r.next_run_date,
      reference: `RECUR-${r.id}`,
      description: r.description,
      lines: lines.map((l) => ({ accountCode: l.account_code, lineType: l.line_type, amount: l.amount })),
    });
    const interval = FREQUENCY_INTERVALS[r.frequency] || '1 month';
    const next = await query(
      'UPDATE recurring_entries SET next_run_date = (next_run_date + $1::interval)::date WHERE id = $2 RETURNING next_run_date',
      [interval, r.id],
    );
    posted.push({
      recurringEntryId: r.id,
      description: r.description,
      journalEntryId: entry.id,
      nextRunDate: next.rows[0].next_run_date,
    });
  }
  return posted;
}
