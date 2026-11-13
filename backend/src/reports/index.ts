import { query } from '../db';
import { money } from '../money';

const CASH_CODES = ['1000', '1005', '1010'];
const WORKING_CAPITAL_CODES = ['1100', '1200', '2000', '2100'];
const EQUITY_CODES = ['3000'];

export async function accountBalances(startDate?: string, endDate?: string): Promise<Record<number, { debit: any; credit: any }>> {
  let sql = `
    SELECT l.account_id,
           COALESCE(SUM(l.amount) FILTER (WHERE l.line_type = 'debit'), 0) AS debit,
           COALESCE(SUM(l.amount) FILTER (WHERE l.line_type = 'credit'), 0) AS credit
    FROM journal_entry_lines l
    JOIN journal_entries je ON je.id = l.journal_entry_id
    WHERE je.status = 'posted'`;
  const params: string[] = [];
  if (startDate) { params.push(startDate); sql += ` AND je.entry_date >= $${params.length}::date`; }
  if (endDate) { params.push(endDate); sql += ` AND je.entry_date <= $${params.length}::date`; }
  sql += ' GROUP BY l.account_id';
  const { rows } = await query(sql, params);
  const map: Record<number, { debit: any; credit: any }> = {};
  for (const r of rows) map[r.account_id] = { debit: money(r.debit), credit: money(r.credit) };
  return map;
}

export async function trialBalance(): Promise<any[]> {
  const balances = await accountBalances();
  const { rows } = await query('SELECT * FROM accounts WHERE is_active = TRUE ORDER BY code');
  return rows
    .map((a) => {
      const b = balances[a.id] || { debit: money(0), credit: money(0) };
      return { code: a.code, name: a.name, type: a.type, debit: b.debit, credit: b.credit };
    })
    .filter((r) => r.debit.isPositive() || r.credit.isPositive());
}

export async function profitAndLoss(startDate?: string, endDate?: string): Promise<any> {
  const balances = await accountBalances(startDate, endDate);
  const { rows } = await query(
    "SELECT * FROM accounts WHERE type IN ('revenue','expense') AND is_active = TRUE ORDER BY code",
  );
  const revenue: any[] = [];
  const expense: any[] = [];
  let totalRevenue = money(0);
  let totalExpense = money(0);
  for (const a of rows) {
    const b = balances[a.id] || { debit: money(0), credit: money(0) };
    if (a.type === 'revenue') {
      const amount = b.credit.minus(b.debit);
      if (!amount.isZero()) { revenue.push({ code: a.code, name: a.name, amount }); totalRevenue = totalRevenue.plus(amount); }
    } else {
      const amount = b.debit.minus(b.credit);
      if (!amount.isZero()) { expense.push({ code: a.code, name: a.name, amount }); totalExpense = totalExpense.plus(amount); }
    }
  }
  return { revenue, expense, totalRevenue, totalExpense, netIncome: totalRevenue.minus(totalExpense) };
}

export async function balanceSheet(asOfDate?: string): Promise<any> {
  const balances = await accountBalances(undefined, asOfDate);
  const { rows } = await query(
    "SELECT * FROM accounts WHERE type IN ('asset','liability','equity') AND is_active = TRUE ORDER BY code",
  );
  const assets: any[] = [];
  const liabilities: any[] = [];
  const equity: any[] = [];
  let totalAssets = money(0);
  let totalLiabilities = money(0);
  let totalEquity = money(0);
  for (const a of rows) {
    const b = balances[a.id] || { debit: money(0), credit: money(0) };
    if (a.type === 'asset') {
      const amt = b.debit.minus(b.credit);
      if (!amt.isZero()) { assets.push({ code: a.code, name: a.name, amount: amt }); totalAssets = totalAssets.plus(amt); }
    } else if (a.type === 'liability') {
      const amt = b.credit.minus(b.debit);
      if (!amt.isZero()) { liabilities.push({ code: a.code, name: a.name, amount: amt }); totalLiabilities = totalLiabilities.plus(amt); }
    } else {
      const amt = b.credit.minus(b.debit);
      if (!amt.isZero()) { equity.push({ code: a.code, name: a.name, amount: amt }); totalEquity = totalEquity.plus(amt); }
    }
  }
  const netIncome = (await profitAndLoss(undefined, asOfDate)).netIncome;
  const totalEquityInclNi = totalEquity.plus(netIncome);
  return {
    assets, liabilities, equity, netIncome,
    totalAssets, totalLiabilities, totalEquity: totalEquityInclNi,
    balanced: totalAssets.minus(totalLiabilities).minus(totalEquityInclNi).abs().lessThan(0.01),
  };
}

export async function cashFlow(startDate?: string, endDate?: string): Promise<any> {
  const netIncome = (await profitAndLoss(startDate, endDate)).netIncome;
  const startBoundary = startDate ? new Date(new Date(startDate).getTime() - 86400000).toISOString().slice(0, 10) : undefined;
  const balancesStart = startBoundary ? await accountBalances(undefined, startBoundary) : {};
  const balancesEnd = await accountBalances(undefined, endDate);

  const signed = async (code: string, balances: any): Promise<any> => {
    const { rows } = await query('SELECT id, type FROM accounts WHERE code = $1', [code]);
    if (!rows.length) return money(0);
    const b = balances[rows[0].id] || { debit: money(0), credit: money(0) };
    return rows[0].type === 'asset' ? b.debit.minus(b.credit) : b.credit.minus(b.debit);
  };

  let workingCapitalChange = money(0);
  for (const code of WORKING_CAPITAL_CODES) {
    const { rows } = await query('SELECT id, type FROM accounts WHERE code = $1', [code]);
    if (!rows.length) continue;
    const a = rows[0];
    const s = balancesStart[a.id] || { debit: money(0), credit: money(0) };
    const e = balancesEnd[a.id] || { debit: money(0), credit: money(0) };
    const startBal = a.type === 'asset' ? s.debit.minus(s.credit) : s.credit.minus(s.debit);
    const endBal = a.type === 'asset' ? e.debit.minus(e.credit) : e.credit.minus(e.debit);
    const delta = endBal.minus(startBal);
    workingCapitalChange = workingCapitalChange.plus(a.type === 'asset' ? delta.negated() : delta);
  }

  const operating = netIncome.plus(workingCapitalChange);

  let financing = money(0);
  for (const code of EQUITY_CODES) {
    financing = financing.plus((await signed(code, balancesEnd)).minus(await signed(code, balancesStart)));
  }

  const netChange = operating.plus(financing);

  let cashEnd = money(0);
  let cashStart = money(0);
  for (const code of CASH_CODES) {
    cashEnd = cashEnd.plus(await signed(code, balancesEnd));
    cashStart = cashStart.plus(await signed(code, balancesStart));
  }
  const actual = cashEnd.minus(cashStart);

  return {
    netIncome, workingCapitalChange, operatingCashFlow: operating,
    financingCashFlow: financing, netChange, actualCashChange: actual,
    reconciled: netChange.minus(actual).abs().lessThan(0.01),
  };
}

function ageBucket(days: number): string {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

async function agedInvoices(invoiceType: string, asOfDate: string): Promise<any[]> {
  const { rows } = await query(
    `SELECT i.id, i.invoice_number, i.due_date, i.total, p.name AS party,
            COALESCE(SUM(ip.amount), 0) AS allocated
     FROM invoices i
     JOIN parties p ON p.id = i.party_id
     LEFT JOIN invoice_payments ip ON ip.invoice_id = i.id
     WHERE i.invoice_type = $1 AND i.status NOT IN ('void','paid')
     GROUP BY i.id, p.name
     ORDER BY p.name, i.due_date`,
    [invoiceType],
  );
  const result: any[] = [];
  for (const r of rows) {
    const outstanding = money(r.total).minus(money(r.allocated));
    if (!outstanding.isPositive()) continue;
    const days = Math.floor((new Date(asOfDate).getTime() - new Date(r.due_date).getTime()) / 86400000);
    result.push({ party: r.party, invoiceNumber: r.invoice_number, outstanding, bucket: ageBucket(days) });
  }
  const buckets: Record<string, string> = { '0-30': 'current', '31-60': 'b31_60', '61-90': 'b61_90', '90+': 'b90_plus' };
  const summary: Record<string, any> = {};
  for (const r of result) {
    const entry = summary[r.party] || (summary[r.party] = { party: r.party, current: money(0), b31_60: money(0), b61_90: money(0), b90_plus: money(0), total: money(0) });
    entry[buckets[r.bucket]] = entry[buckets[r.bucket]].plus(r.outstanding);
    entry.total = entry.total.plus(r.outstanding);
  }
  return Object.values(summary);
}

export async function agedReceivables(asOfDate?: string): Promise<any[]> {
  return agedInvoices('sale', asOfDate || new Date().toISOString().slice(0, 10));
}

export async function agedPayables(asOfDate?: string): Promise<any[]> {
  return agedInvoices('purchase', asOfDate || new Date().toISOString().slice(0, 10));
}

export async function vatReturn(startDate?: string, endDate?: string): Promise<any> {
  const balances = await accountBalances(startDate, endDate);
  const { rows } = await query("SELECT id FROM accounts WHERE code = '2100'");
  const b = (rows.length && balances[rows[0].id]) || { debit: money(0), credit: money(0) };
  return { outputVat: b.credit, inputVat: b.debit, netVat: b.credit.minus(b.debit) };
}

export async function budgetVariance(startDate?: string, endDate?: string): Promise<any[]> {
  const balances = await accountBalances(startDate, endDate);
  let sql = 'SELECT b.amount, a.id, a.code, a.name, a.type FROM budgets b JOIN accounts a ON a.id = b.account_id WHERE 1=1';
  const params: string[] = [];
  if (startDate) { params.push(startDate); sql += ` AND b.period_end >= $${params.length}::date`; }
  if (endDate) { params.push(endDate); sql += ` AND b.period_start <= $${params.length}::date`; }
  sql += ' ORDER BY a.code';
  const { rows } = await query(sql, params);
  return rows.map((r) => {
    const b = balances[r.id] || { debit: money(0), credit: money(0) };
    const actual = (r.type === 'asset' || r.type === 'expense') ? b.debit.minus(b.credit) : b.credit.minus(b.debit);
    return { account: r.code, name: r.name, budgetAmount: money(r.amount), actual, variance: actual.minus(money(r.amount)) };
  });
}

export async function generalLedger(startDate?: string, endDate?: string): Promise<any[]> {
  let sql = `
    SELECT je.id, je.entry_date, je.reference, je.description,
           l.line_type, l.amount, a.code AS account_code, a.name AS account_name, l.line_no
    FROM journal_entries je
    JOIN journal_entry_lines l ON l.journal_entry_id = je.id
    JOIN accounts a ON a.id = l.account_id
    WHERE je.status = 'posted'`;
  const params: string[] = [];
  if (startDate) { params.push(startDate); sql += ` AND je.entry_date >= $${params.length}::date`; }
  if (endDate) { params.push(endDate); sql += ` AND je.entry_date <= $${params.length}::date`; }
  sql += ' ORDER BY je.entry_date, je.id, l.line_no';
  const { rows } = await query(sql, params);
  const entries: Record<number, any> = {};
  const order: number[] = [];
  for (const r of rows) {
    if (!entries[r.id]) {
      entries[r.id] = { id: r.id, date: r.entry_date, reference: r.reference, description: r.description, lines: [] };
      order.push(r.id);
    }
    entries[r.id].lines.push({ accountCode: r.account_code, accountName: r.account_name, lineType: r.line_type, amount: money(r.amount) });
  }
  return order.map((id) => entries[id]);
}

export async function accountLedger(accountCode: string, startDate?: string, endDate?: string): Promise<any> {
  const { rows: acctRows } = await query('SELECT id, type FROM accounts WHERE code = $1', [accountCode]);
  if (!acctRows.length) throw new Error(`Account not found: ${accountCode}`);
  const account = acctRows[0];

  let sql = `
    SELECT je.entry_date, je.reference, je.description, l.line_type, l.amount
    FROM journal_entry_lines l
    JOIN journal_entries je ON je.id = l.journal_entry_id
    WHERE l.account_id = $1 AND je.status = 'posted'`;
  const params: (string | number)[] = [account.id];
  if (startDate) { params.push(startDate); sql += ` AND je.entry_date >= $${params.length}::date`; }
  if (endDate) { params.push(endDate); sql += ` AND je.entry_date <= $${params.length}::date`; }
  sql += ' ORDER BY je.entry_date, je.id, l.line_no';
  const { rows } = await query(sql, params);

  let running = money(0);
  const result = rows.map((r) => {
    const amount = money(r.amount);
    const debit = r.line_type === 'debit' ? amount : money(0);
    const credit = r.line_type === 'credit' ? amount : money(0);
    running = (account.type === 'asset' || account.type === 'expense')
      ? running.plus(debit).minus(credit)
      : running.plus(credit).minus(debit);
    return { date: r.entry_date, reference: r.reference, description: r.description, debit, credit, balance: running };
  });
  return { account: accountCode, rows: result, closingBalance: running };
}

export async function partyStatement(partyId: number, startDate?: string, endDate?: string): Promise<any> {
  const { rows: pRows } = await query('SELECT id, name, type FROM parties WHERE id = $1', [partyId]);
  if (!pRows.length) throw new Error('Party not found');
  const party = pRows[0];

  let invSql = "SELECT invoice_number, issue_date, invoice_type, total, status FROM invoices WHERE party_id = $1 AND status <> 'void'";
  let paySql = 'SELECT payment_date, direction, amount, method FROM payments WHERE party_id = $1';
  const invParams: (string | number)[] = [partyId];
  const payParams: (string | number)[] = [partyId];
  if (startDate) { invParams.push(startDate); invSql += ` AND issue_date >= $${invParams.length}::date`; payParams.push(startDate); paySql += ` AND payment_date >= $${payParams.length}::date`; }
  if (endDate) { invParams.push(endDate); invSql += ` AND issue_date <= $${invParams.length}::date`; payParams.push(endDate); paySql += ` AND payment_date <= $${payParams.length}::date`; }

  const invoices = (await query(invSql + ' ORDER BY issue_date', invParams)).rows;
  const payments = (await query(paySql + ' ORDER BY payment_date', payParams)).rows;

  const totalInvoiced = invoices.reduce((s, i) => s.plus(money(i.total)), money(0));
  const totalReceived = payments.filter((p) => p.direction === 'incoming').reduce((s, p) => s.plus(money(p.amount)), money(0));
  const totalPaid = payments.filter((p) => p.direction === 'outgoing').reduce((s, p) => s.plus(money(p.amount)), money(0));
  const balance = party.type === 'vendor' ? totalInvoiced.minus(totalPaid) : totalInvoiced.minus(totalReceived);

  return { party: party.name, invoices, payments, totalInvoiced, balance };
}

export async function financialRatios(asOfDate?: string): Promise<any> {
  const pnl = await profitAndLoss(undefined, asOfDate);
  const bs = await balanceSheet(asOfDate);
  const revenue = pnl.totalRevenue;
  const netIncome = pnl.netIncome;
  const cogs = pnl.expense.find((e) => e.code === '5000');
  const grossProfit = revenue.minus(cogs ? cogs.amount : money(0));
  return {
    revenue,
    grossProfit,
    grossMargin: revenue.isZero() ? null : grossProfit.div(revenue),
    netIncome,
    netMargin: revenue.isZero() ? null : netIncome.div(revenue),
    currentRatio: bs.totalLiabilities.isZero() ? null : bs.totalAssets.div(bs.totalLiabilities),
    returnOnEquity: bs.totalEquity.isZero() ? null : netIncome.div(bs.totalEquity),
  };
}

// ---------------------------------------------------------------------------
// Depth reports
// ---------------------------------------------------------------------------

export async function profitAndLossByDepartment(startDate?: string, endDate?: string): Promise<any[]> {
  let sql = `
    SELECT d.id, d.name,
           COALESCE(SUM(l.amount) FILTER (WHERE l.line_type = 'credit' AND a.type = 'revenue'), 0) -
           COALESCE(SUM(l.amount) FILTER (WHERE l.line_type = 'debit' AND a.type = 'revenue'), 0) AS revenue,
           COALESCE(SUM(l.amount) FILTER (WHERE l.line_type = 'debit' AND a.type = 'expense'), 0) -
           COALESCE(SUM(l.amount) FILTER (WHERE l.line_type = 'credit' AND a.type = 'expense'), 0) AS expense
    FROM journal_entry_lines l
    JOIN journal_entries je ON je.id = l.journal_entry_id
    JOIN accounts a ON a.id = l.account_id
    JOIN departments d ON d.id = l.department_id
    WHERE je.status = 'posted'`;
  const params: string[] = [];
  if (startDate) { params.push(startDate); sql += ` AND je.entry_date >= $${params.length}::date`; }
  if (endDate) { params.push(endDate); sql += ` AND je.entry_date <= $${params.length}::date`; }
  sql += ' GROUP BY d.id, d.name ORDER BY d.name';
  const { rows } = await query(sql, params);
  return rows.map((r) => {
    const revenue = money(r.revenue);
    const expense = money(r.expense);
    return { department: r.name, revenue, expense, netIncome: revenue.minus(expense) };
  });
}

export async function fixedAssetRegister(asOfDate?: string): Promise<any> {
  const asOf = asOfDate || new Date().toISOString().slice(0, 10);
  const { rows } = await query(
    `SELECT fa.*, a.code AS account_code, a.name AS account_name
     FROM fixed_assets fa JOIN accounts a ON a.id = fa.account_id
     ORDER BY fa.purchase_date, fa.id`,
  );
  const msPerYear = 365.25 * 86400000;
  const assets = rows.map((fa) => {
    const cost = money(fa.cost);
    const salvage = money(fa.salvage_value);
    const lifeYears = Number(fa.useful_life_years);
    const annualDepreciation = cost.minus(salvage).div(lifeYears).toDecimalPlaces(2);
    const elapsedYears = Math.max(0, (new Date(asOf).getTime() - new Date(fa.purchase_date).getTime()) / msPerYear);
    const accumulated = annualDepreciation.times(Math.min(elapsedYears, lifeYears)).toDecimalPlaces(2);
    return {
      id: fa.id,
      name: fa.name,
      accountCode: fa.account_code,
      accountName: fa.account_name,
      purchaseDate: fa.purchase_date,
      cost,
      salvageValue: salvage,
      usefulLifeYears: lifeYears,
      annualDepreciation,
      accumulatedDepreciation: accumulated,
      netBookValue: cost.minus(accumulated).toDecimalPlaces(2),
    };
  });
  return {
    assets,
    totalCost: assets.reduce((s, r) => s.plus(r.cost), money(0)),
    totalAccumulated: assets.reduce((s, r) => s.plus(r.accumulatedDepreciation), money(0)),
    totalNetBookValue: assets.reduce((s, r) => s.plus(r.netBookValue), money(0)),
  };
}

export async function comparativeProfitAndLoss(currentStart: string, currentEnd: string): Promise<any> {
  const current = await profitAndLoss(currentStart, currentEnd);
  const curStart = new Date(currentStart);
  const curEnd = new Date(currentEnd);
  const lengthMs = curEnd.getTime() - curStart.getTime();
  const priorEnd = new Date(curStart.getTime() - 1);
  const priorStart = new Date(priorEnd.getTime() - lengthMs);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const prior = await profitAndLoss(fmt(priorStart), fmt(priorEnd));

  return {
    currentStart, currentEnd,
    priorStart: fmt(priorStart), priorEnd: fmt(priorEnd),
    currentRevenue: current.totalRevenue, priorRevenue: prior.totalRevenue,
    currentExpense: current.totalExpense, priorExpense: prior.totalExpense,
    currentNetIncome: current.netIncome, priorNetIncome: prior.netIncome,
    revenueVariance: current.totalRevenue.minus(prior.totalRevenue),
    expenseVariance: current.totalExpense.minus(prior.totalExpense),
    netIncomeVariance: current.netIncome.minus(prior.netIncome),
  };
}

export async function changesInEquity(startDate?: string, endDate?: string): Promise<any> {
  const startBoundary = startDate ? new Date(new Date(startDate).getTime() - 86400000).toISOString().slice(0, 10) : undefined;
  const balancesStart = startBoundary ? await accountBalances(undefined, startBoundary) : {};
  const balancesEnd = await accountBalances(undefined, endDate);

  const equityBalance = async (balances: Record<number, { debit: any; credit: any }>): Promise<any> => {
    const { rows } = await query("SELECT id FROM accounts WHERE type = 'equity'");
    let total = money(0);
    for (const a of rows) {
      const b = balances[a.id] || { debit: money(0), credit: money(0) };
      total = total.plus(b.credit.minus(b.debit));
    }
    return total;
  };

  const openingEquity = await equityBalance(balancesStart);
  const closingEquityBeforeNI = await equityBalance(balancesEnd);
  const netIncome = (await profitAndLoss(startDate, endDate)).netIncome;
  const capitalMovements = closingEquityBeforeNI.minus(openingEquity);
  const closingEquity = closingEquityBeforeNI.plus(netIncome);

  return {
    openingEquity,
    capitalMovements,
    netIncome,
    closingEquity,
    reconciled: openingEquity.plus(capitalMovements).plus(netIncome).minus(closingEquity).abs().lessThan(0.01),
  };
}
