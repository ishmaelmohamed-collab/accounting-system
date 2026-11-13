"""pytest configuration.

The accounting tables are `managed = False`, so Django's test runner does not
create them. This session fixture loads the SQL migrations into the test
database once, before any test runs.
"""
from pathlib import Path

import pytest
from django.db import connection

SQL_DIR = Path(__file__).resolve().parent / 'sql'
MIGRATIONS = ('001_core_schema.sql', '002_invoicing.sql', '003_ledger_hardening.sql', '004_budgets.sql')


def _execute_sql_file(filename):
    sql = (SQL_DIR / filename).read_text(encoding='utf-8')
    with connection.cursor() as cursor:
        cursor.execute(sql)


@pytest.fixture(scope='session', autouse=True)
def load_ledger_schema(django_db_setup, django_db_blocker):
    with django_db_blocker.unblock():
        for migration in MIGRATIONS:
            _execute_sql_file(migration)
    yield
