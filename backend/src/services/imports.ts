import { query } from '../db';
import { parseCsv } from '../csv';
import { money } from '../money';
import { postJournalEntry } from './journal';

export async function importAccounts(csvText: string): Promise<any> {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error('CSV must have a header row and at least one data row');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const created: any[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => { obj[h] = (r[idx] || '').trim(); });
    if (!obj.code || !obj.name) continue;
    const type = obj.type || 'expense';
    const normalBalance = obj.normal_balance || (type === 'asset' || type === 'expense' ? 'debit' : 'credit');
    const res = await query(
      'INSERT INTO accounts (code, name, type, normal_balance) VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id, code, name',
      [obj.code, obj.name, type, normalBalance],
    );
    created.push(res.rows[0]);
  }
  return { imported: created.length, accounts: created };
}

export async function importOpeningBalances(csvText: string, date: string): Promise<any> {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error('CSV must have a header row and at least one data row');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const lines: any[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => { obj[h] = (r[idx] || '').trim(); });
    const accountCode = obj.accountcode || obj.account_code || obj.code;
    if (!accountCode) continue;
    const debit = money(obj.debit || '0');
    const credit = money(obj.credit || '0');
    if (debit.greaterThan(0)) lines.push({ accountCode, lineType: 'debit', amount: debit.toFixed(2) });
    if (credit.greaterThan(0)) lines.push({ accountCode, lineType: 'credit', amount: credit.toFixed(2) });
  }
  if (!lines.length) throw new Error('No balance lines found in CSV');
  const entry = await postJournalEntry({ date, reference: 'OPEN-BAL', description: 'Opening balances', lines });
  return { journalEntryId: entry.id, lines: lines.length };
}
