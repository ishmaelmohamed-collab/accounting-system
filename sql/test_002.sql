-- ============================================================================
-- End-to-end test: invoicing + payments + double-entry integration
-- Run against: accounting database (as accounting_app)
-- Demonstrates: customer -> invoice -> post -> payment -> allocation
-- ============================================================================

\echo '=== 1. Create a customer ==='
INSERT INTO parties (name, type, email)
VALUES ('Acme Ltd', 'customer', 'billing@acme.example')
RETURNING id AS party_id \gset

\echo '=== 2. Create a sale invoice (subtotal 3000 + VAT 480 = 3480) ==='
INSERT INTO invoices (invoice_number, party_id, invoice_type, issue_date, due_date, subtotal, tax_amount, total)
VALUES ('INV-0001', :party_id, 'sale', '2026-11-13', '2026-12-13', 3000.00, 480.00, 3480.00)
RETURNING id AS invoice_id \gset

INSERT INTO invoice_lines (invoice_id, description, account_id, quantity, unit_price, amount, tax_rate_id, line_no)
VALUES
  (:invoice_id, 'Consulting services', (SELECT id FROM accounts WHERE code='4000'), 10, 200.00,  2000.00, (SELECT id FROM tax_rates WHERE name='VAT 16%'), 1),
  (:invoice_id, 'Software license',    (SELECT id FROM accounts WHERE code='4000'),  1, 1000.00, 1000.00, (SELECT id FROM tax_rates WHERE name='VAT 16%'), 2);

\echo '=== 3. Post invoice to the ledger (debit AR, credit Revenue + VAT) ==='
INSERT INTO journal_entries (entry_date, reference, description)
VALUES ('2026-11-13', 'INV-0001', 'Sale to Acme Ltd')
RETURNING id AS entry1_id \gset

INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_type, amount, line_no, party_id)
VALUES
  (:entry1_id, (SELECT id FROM accounts WHERE code='1100'), 'debit',  3480.00, 1, :party_id),
  (:entry1_id, (SELECT id FROM accounts WHERE code='4000'), 'credit', 3000.00, 2, :party_id),
  (:entry1_id, (SELECT id FROM accounts WHERE code='2100'), 'credit',  480.00, 3, :party_id);

UPDATE journal_entries SET status='posted' WHERE id = :entry1_id;
UPDATE invoices SET journal_entry_id = :entry1_id, status = 'issued' WHERE id = :invoice_id;

\echo '=== 4. Record an incoming payment and allocate it to the invoice ==='
INSERT INTO payments (payment_date, party_id, direction, amount, method, reference)
VALUES ('2026-11-13', :party_id, 'incoming', 3480.00, 'bank', 'PYMT-0001')
RETURNING id AS payment_id \gset

INSERT INTO journal_entries (entry_date, reference, description)
VALUES ('2026-11-13', 'PYMT-0001', 'Payment received from Acme Ltd')
RETURNING id AS entry2_id \gset

INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_type, amount, line_no, party_id)
VALUES
  (:entry2_id, (SELECT id FROM accounts WHERE code='1005'), 'debit',  3480.00, 1, :party_id),
  (:entry2_id, (SELECT id FROM accounts WHERE code='1100'), 'credit', 3480.00, 2, :party_id);

UPDATE journal_entries SET status='posted' WHERE id = :entry2_id;
UPDATE payments SET journal_entry_id = :entry2_id WHERE id = :payment_id;

INSERT INTO invoice_payments (invoice_id, payment_id, amount)
VALUES (:invoice_id, :payment_id, 3480.00);

UPDATE invoices SET status = 'paid' WHERE id = :invoice_id;

\echo ''
\echo '=== 5. Final state ==='
SELECT 'parties'            AS object, count(*) AS n FROM parties
UNION ALL SELECT 'invoices',            count(*) FROM invoices
UNION ALL SELECT 'invoice_lines',       count(*) FROM invoice_lines
UNION ALL SELECT 'payments',            count(*) FROM payments
UNION ALL SELECT 'journal_entries',     count(*) FROM journal_entries
UNION ALL SELECT 'journal_entry_lines', count(*) FROM journal_entry_lines;

\echo ''
\echo '=== Invoice status ==='
SELECT invoice_number, status, subtotal, tax_amount, total FROM invoices;

\echo ''
\echo '=== Accounts Receivable balance for Acme Ltd (should be 0.00 after full payment) ==='
SELECT COALESCE(SUM(CASE WHEN l.line_type = 'debit' THEN l.amount ELSE -l.amount END), 0) AS ar_balance
FROM journal_entry_lines l
JOIN accounts a ON a.id = l.account_id
WHERE a.code = '1100' AND l.party_id = :party_id;

\echo ''
\echo '=== VAT Payable accrued (should be 480.00) ==='
SELECT COALESCE(SUM(CASE WHEN l.line_type = 'credit' THEN l.amount ELSE -l.amount END), 0) AS vat_payable
FROM journal_entry_lines l
JOIN accounts a ON a.id = l.account_id
WHERE a.code = '2100';
