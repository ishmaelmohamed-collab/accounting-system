-- ============================================================================
-- Smoke test for the core accounting schema
-- Run against: accounting database (as accounting_app)
-- ============================================================================

\echo ''
\echo '=== Tables in the database ==='
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;

\echo ''
\echo '=== Chart of accounts (seeded) ==='
SELECT code, name, type, normal_balance FROM accounts ORDER BY code;

\echo ''
\echo '=== TEST 1: a BALANCED entry should post successfully ==='
DO $$
DECLARE
    entry_id BIGINT;
BEGIN
    INSERT INTO journal_entries (entry_date, reference, description)
    VALUES ('2026-11-13', 'TEST-1', 'Cash sale of services')
    RETURNING id INTO entry_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_type, amount, line_no)
    VALUES
        (entry_id, (SELECT id FROM accounts WHERE code='1000'), 'debit',  5000.00, 1),
        (entry_id, (SELECT id FROM accounts WHERE code='4000'), 'credit', 5000.00, 2);

    UPDATE journal_entries SET status='posted' WHERE id = entry_id;
    RAISE NOTICE 'TEST 1 PASSED: balanced entry % posted.', entry_id;
END $$;

\echo ''
\echo '=== TEST 2: an UNBALANCED entry must be REJECTED ==='
DO $$
DECLARE
    entry_id BIGINT;
BEGIN
    INSERT INTO journal_entries (entry_date, reference, description)
    VALUES ('2026-11-13', 'TEST-2', 'Unbalanced entry (should be rejected)')
    RETURNING id INTO entry_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_type, amount, line_no)
    VALUES
        (entry_id, (SELECT id FROM accounts WHERE code='1000'), 'debit', 100.00, 1);

    UPDATE journal_entries SET status='posted' WHERE id = entry_id;
    RAISE NOTICE 'TEST 2 FAILED: unbalanced entry was allowed to post!';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TEST 2 PASSED: rejected -> %', SQLERRM;
END $$;

\echo ''
\echo '=== Posted entries and their balances ==='
SELECT je.id, je.reference, je.status, je.posted_at,
       COALESCE(SUM(l.amount) FILTER (WHERE l.line_type = 'debit'),  0) AS total_debit,
       COALESCE(SUM(l.amount) FILTER (WHERE l.line_type = 'credit'), 0) AS total_credit
FROM journal_entries je
JOIN journal_entry_lines l ON l.journal_entry_id = je.id
GROUP BY je.id, je.reference, je.status, je.posted_at
ORDER BY je.id;
