import { describe, it, expect } from 'vitest';
import { money } from '../src/money';
import * as journal from '../src/services/journal';
import * as reports from '../src/reports';
import { postEntrySchema, createInvoiceSchema } from '../src/validation';

describe('money (decimal.js precision)', () => {
  it('adds decimals exactly (0.1 + 0.2 = 0.3)', () => {
    expect(money('0.1').plus(money('0.2')).toFixed(1)).toBe('0.3');
  });

  it('treats null/undefined as zero', () => {
    expect(money(null).toNumber()).toBe(0);
    expect(money(undefined).toNumber()).toBe(0);
  });

  it('avoids float drift across repeated sums', () => {
    let sum = money(0);
    for (let i = 0; i < 10; i++) sum = sum.plus(money('0.1'));
    expect(sum.toFixed(1)).toBe('1.0');
  });
});

describe('journal service', () => {
  it('rejects an unbalanced entry', async () => {
    await expect(journal.postJournalEntry({
      date: '2026-11-13', reference: 'TEST-UNBAL', description: 'unbalanced',
      lines: [{ accountCode: '1000', lineType: 'debit', amount: '50' }],
    })).rejects.toThrow(/not balanced/);
  });

  it('rejects an empty entry', async () => {
    await expect(journal.postJournalEntry({ date: '2026-11-13', lines: [] }))
      .rejects.toThrow(/at least one line/);
  });
});

describe('reports (read-only, must stay internally consistent)', () => {
  it('trial balance: debits equal credits', async () => {
    const tb = await reports.trialBalance();
    const d = tb.reduce((s, r) => s.plus(r.debit), money(0));
    const c = tb.reduce((s, r) => s.plus(r.credit), money(0));
    expect(d.equals(c)).toBe(true);
  });

  it('balance sheet balances', async () => {
    const bs = await reports.balanceSheet();
    expect(bs.balanced).toBe(true);
  });

  it('cash flow reconciles with cash accounts', async () => {
    const cf = await reports.cashFlow();
    expect(cf.reconciled).toBe(true);
  });

  it('profit and loss returns exact net income', async () => {
    const pnl = await reports.profitAndLoss();
    expect(pnl.netIncome.isFinite()).toBe(true);
    expect(pnl.totalRevenue.minus(pnl.totalExpense).equals(pnl.netIncome)).toBe(true);
  });
});

describe('validation (Zod)', () => {
  it('rejects an entry with missing lines', () => {
    expect(postEntrySchema.safeParse({ date: '2026-11-13' }).success).toBe(false);
  });

  it('rejects an invalid line type', () => {
    const r = postEntrySchema.safeParse({
      date: '2026-11-13',
      lines: [{ accountCode: '1000', lineType: 'invalid', amount: '10' }],
    });
    expect(r.success).toBe(false);
  });

  it('accepts a valid balanced entry', () => {
    const r = postEntrySchema.safeParse({
      date: '2026-11-13',
      lines: [
        { accountCode: '1000', lineType: 'debit', amount: '50' },
        { accountCode: '4000', lineType: 'credit', amount: '50' },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rejects an invoice with a non-positive partyId', () => {
    const r = createInvoiceSchema.safeParse({
      invoiceNumber: 'X', partyId: 0, invoiceType: 'sale',
      issueDate: '2026-11-13', dueDate: '2026-12-13',
      lines: [{ description: 'd', accountCode: '4000', amount: '100' }],
    });
    expect(r.success).toBe(false);
  });
});
