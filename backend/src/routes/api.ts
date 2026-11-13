import express from 'express';
import { query } from '../db';
import { requireAuth } from '../auth';
import * as journal from '../services/journal';
import { createInvoice } from '../services/invoice';
import { recordPayment } from '../services/payment';
import * as reports from '../reports';
import { validate, postEntrySchema, createInvoiceSchema, recordPaymentSchema, partySchema, reverseEntrySchema } from '../validation';

const router = express.Router();
router.use(requireAuth);

function handleError(res: express.Response, err: any): express.Response {
  const status = /balanced|closed|positive|not found|reversed|posted|no lines|zero|required/i.test(err.message) ? 400 : 500;
  return res.status(status).json({ error: err.message });
}

router.get('/accounts', async (req, res, next) => {
  try { res.json((await query('SELECT * FROM accounts WHERE is_active = TRUE ORDER BY code')).rows); } catch (e) { next(e); }
});

router.get('/parties', async (req, res, next) => {
  try { res.json((await query('SELECT * FROM parties ORDER BY name')).rows); } catch (e) { next(e); }
});

router.post('/parties', validate(partySchema), async (req, res, next) => {
  try {
    const { name, type = 'customer', email, phone, address } = req.body || {};
    const r = await query('INSERT INTO parties (name, type, email, phone, address) VALUES ($1,$2,$3,$4,$5) RETURNING *', [name, type, email, phone, address]);
    res.status(201).json(r.rows[0]);
  } catch (e) { next(e); }
});

router.get('/tax-rates', async (req, res, next) => {
  try { res.json((await query('SELECT * FROM tax_rates ORDER BY name')).rows); } catch (e) { next(e); }
});

router.get('/journal-entries', async (req, res, next) => {
  try { res.json((await query('SELECT * FROM journal_entries ORDER BY entry_date DESC, id DESC')).rows); } catch (e) { next(e); }
});

router.get('/invoices', async (req, res, next) => {
  try { res.json((await query('SELECT * FROM invoices ORDER BY issue_date DESC, id DESC')).rows); } catch (e) { next(e); }
});

router.get('/payments', async (req, res, next) => {
  try { res.json((await query('SELECT * FROM payments ORDER BY payment_date DESC, id DESC')).rows); } catch (e) { next(e); }
});

router.post('/actions/post-entry', validate(postEntrySchema), async (req, res, next) => {
  try {
    const entry = await journal.postJournalEntry(req.body || {});
    res.status(201).json(entry);
  } catch (e) { handleError(res, e); }
});

router.post('/actions/create-invoice', validate(createInvoiceSchema), async (req, res, next) => {
  try {
    const result = await createInvoice(req.body || {});
    res.status(201).json(result);
  } catch (e) { handleError(res, e); }
});

router.post('/actions/record-payment', validate(recordPaymentSchema), async (req, res, next) => {
  try {
    const result = await recordPayment(req.body || {});
    res.status(201).json(result);
  } catch (e) { handleError(res, e); }
});

router.post('/actions/reverse-entry', validate(reverseEntrySchema), async (req, res, next) => {
  try {
    const { entryId } = req.body || {};
    const result = await journal.reverseEntry(entryId);
    res.status(201).json(result);
  } catch (e) { handleError(res, e); }
});

router.get('/reports/trial-balance', async (req, res, next) => {
  try { res.json(await reports.trialBalance()); } catch (e) { next(e); }
});
router.get('/reports/profit-and-loss', async (req, res, next) => {
  try { res.json(await reports.profitAndLoss(req.query.start as string, req.query.end as string)); } catch (e) { next(e); }
});
router.get('/reports/balance-sheet', async (req, res, next) => {
  try { res.json(await reports.balanceSheet(req.query.as_of as string)); } catch (e) { next(e); }
});
router.get('/reports/cash-flow', async (req, res, next) => {
  try { res.json(await reports.cashFlow(req.query.start as string, req.query.end as string)); } catch (e) { next(e); }
});
router.get('/reports/aged-receivables', async (req, res, next) => {
  try { res.json(await reports.agedReceivables(req.query.as_of as string)); } catch (e) { next(e); }
});
router.get('/reports/aged-payables', async (req, res, next) => {
  try { res.json(await reports.agedPayables(req.query.as_of as string)); } catch (e) { next(e); }
});
router.get('/reports/vat-return', async (req, res, next) => {
  try { res.json(await reports.vatReturn(req.query.start as string, req.query.end as string)); } catch (e) { next(e); }
});
router.get('/reports/budget-variance', async (req, res, next) => {
  try { res.json(await reports.budgetVariance(req.query.start as string, req.query.end as string)); } catch (e) { next(e); }
});
router.get('/reports/general-ledger', async (req, res, next) => {
  try { res.json(await reports.generalLedger(req.query.start as string, req.query.end as string)); } catch (e) { next(e); }
});
router.get('/reports/account-ledger', async (req, res, next) => {
  try {
    if (!req.query.account) return res.status(400).json({ error: 'account code required' });
    res.json(await reports.accountLedger(req.query.account as string, req.query.start as string, req.query.end as string));
  } catch (e) { next(e); }
});
router.get('/reports/party-statement', async (req, res, next) => {
  try {
    if (!req.query.party) return res.status(400).json({ error: 'party id required' });
    res.json(await reports.partyStatement(Number(req.query.party), req.query.start as string, req.query.end as string));
  } catch (e) { next(e); }
});
router.get('/reports/financial-ratios', async (req, res, next) => {
  try { res.json(await reports.financialRatios(req.query.as_of as string)); } catch (e) { next(e); }
});

export default router;
