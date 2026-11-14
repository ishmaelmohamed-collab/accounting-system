import { query, withTransaction } from '../db';
import { postJournalEntry } from './journal';
import { nextNumber } from '../numbering';

const EXPENSE_PAYABLE = '2200';
const BANK = '1005';

export async function createExpenseClaim(args: any): Promise<any> {
  const { description, accountCode, amount, expenseDate, notes = null } = args;
  return withTransaction(async (client) => {
    const claimNumber = await nextNumber(client, 'expense_claim');
    const r = await client.query(
      'INSERT INTO expense_claims (claim_number, description, account_code, amount, expense_date, notes) VALUES ($1,$2,$3,$4,$5::date,$6) RETURNING id',
      [claimNumber, description, accountCode, amount, expenseDate, notes],
    );
    return { expenseClaimId: r.rows[0].id, claimNumber };
  });
}

export async function approveExpenseClaim(claimId: number): Promise<any> {
  const claim = (await query('SELECT * FROM expense_claims WHERE id = $1', [claimId])).rows[0];
  if (!claim) throw new Error('Expense claim not found');
  if (claim.status !== 'submitted') throw new Error('Only submitted claims can be approved');

  const entry = await postJournalEntry({
    date: claim.expense_date,
    reference: claim.claim_number,
    description: `Expense: ${claim.description}`,
    lines: [
      { accountCode: claim.account_code, lineType: 'debit', amount: claim.amount },
      { accountCode: EXPENSE_PAYABLE, lineType: 'credit', amount: claim.amount },
    ],
  });
  await query("UPDATE expense_claims SET status = 'approved', journal_entry_id = $1 WHERE id = $2", [entry.id, claimId]);
  return { expenseClaimId: claimId, journalEntryId: entry.id };
}

export async function reimburseExpenseClaim(claimId: number): Promise<any> {
  const claim = (await query('SELECT * FROM expense_claims WHERE id = $1', [claimId])).rows[0];
  if (!claim) throw new Error('Expense claim not found');
  if (claim.status !== 'approved') throw new Error('Only approved claims can be reimbursed');

  const entry = await postJournalEntry({
    date: new Date().toISOString().slice(0, 10),
    reference: `REIMB-${claim.claim_number}`,
    description: `Reimburse: ${claim.description}`,
    lines: [
      { accountCode: EXPENSE_PAYABLE, lineType: 'debit', amount: claim.amount },
      { accountCode: BANK, lineType: 'credit', amount: claim.amount },
    ],
  });
  await query("UPDATE expense_claims SET status = 'reimbursed' WHERE id = $1", [claimId]);
  return { expenseClaimId: claimId, journalEntryId: entry.id };
}

export async function rejectExpenseClaim(claimId: number): Promise<any> {
  const claim = (await query('SELECT * FROM expense_claims WHERE id = $1', [claimId])).rows[0];
  if (!claim) throw new Error('Expense claim not found');
  if (claim.status !== 'submitted') throw new Error('Only submitted claims can be rejected');
  await query("UPDATE expense_claims SET status = 'rejected' WHERE id = $1", [claimId]);
  return { expenseClaimId: claimId, status: 'rejected' };
}
