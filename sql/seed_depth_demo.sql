-- Demo data for depth features (departments + fixed assets)
INSERT INTO departments (name) VALUES ('Sales'), ('Operations'), ('Administration')
ON CONFLICT (name) DO NOTHING;

INSERT INTO accounts (code, name, type, normal_balance) VALUES ('1500', 'Vehicles', 'asset', 'debit')
ON CONFLICT (code) DO NOTHING;

INSERT INTO fixed_assets (name, account_id, purchase_date, cost, salvage_value, useful_life_years)
SELECT 'Delivery Van', id, '2026-01-15', 15000, 2000, 5 FROM accounts WHERE code = '1500';

-- Tag existing journal lines to departments (revenue → Sales, rent → Admin, salaries/utilities → Operations)
UPDATE journal_entry_lines l SET department_id = d.id
FROM accounts a, departments d
WHERE l.account_id = a.id
  AND ((a.code = '4000' AND d.name = 'Sales')
    OR (a.code = '6000' AND d.name = 'Administration')
    OR (a.code IN ('6100','6200') AND d.name = 'Operations'));
