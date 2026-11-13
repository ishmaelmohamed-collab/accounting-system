import * as journal from './services/journal';
import * as reports from './reports';
import { money } from './money';

async function main(): Promise<void> {
  try {
    await journal.postJournalEntry({
      date: '2026-11-13', reference: 'VERIFY-1', description: 'unbalanced',
      lines: [{ accountCode: '1000', lineType: 'debit', amount: '50' }],
    });
    console.log('1. FAIL: unbalanced entry was not rejected');
  } catch (e: any) {
    console.log(`1. unbalanced rejected: ${e.message}`);
  }

  const tb = await reports.trialBalance();
  const totalDebit = tb.reduce((s, r) => s.plus(r.debit), money(0));
  const totalCredit = tb.reduce((s, r) => s.plus(r.credit), money(0));
  console.log(`2. trial balance: debits ${totalDebit.toFixed(2)} == credits ${totalCredit.toFixed(2)} -> ${totalDebit.equals(totalCredit)}`);

  const pnl = await reports.profitAndLoss();
  console.log(`3. P&L net income: ${pnl.netIncome.toFixed(2)}`);

  const bs = await reports.balanceSheet();
  console.log(`4. balance sheet: assets ${bs.totalAssets.toFixed(2)} = liabilities ${bs.totalLiabilities.toFixed(2)} + equity ${bs.totalEquity.toFixed(2)} -> ${bs.balanced}`);

  const cf = await reports.cashFlow();
  console.log(`5. cash flow reconciled: ${cf.reconciled}`);

  const fr = await reports.financialRatios();
  console.log(`6. ratios: net margin ${fr.netMargin === null ? 'n/a' : fr.netMargin.times(100).toFixed(2) + '%'}`);

  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
