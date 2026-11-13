"""
URL configuration for accounting_project project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import include, path
from rest_framework.authtoken.views import obtain_auth_token
from rest_framework.routers import DefaultRouter

from ledger import api, views

router = DefaultRouter()
router.register('accounts', api.AccountViewSet, basename='account')
router.register('parties', api.PartyViewSet, basename='party')
router.register('tax-rates', api.TaxRateViewSet, basename='tax-rate')
router.register('journal-entries', api.JournalEntryViewSet, basename='journal-entry')
router.register('invoices', api.InvoiceViewSet, basename='invoice')
router.register('payments', api.PaymentViewSet, basename='payment')
router.register('fiscal-periods', api.FiscalPeriodViewSet, basename='fiscal-period')
router.register('budgets', api.BudgetViewSet, basename='budget')

urlpatterns = [
    path('', views.dashboard, name='dashboard'),
    path('admin/', admin.site.urls),
    path('invoices/new/', views.invoice_create, name='invoice_create'),
    path('payments/new/', views.payment_create, name='payment_create'),
    path('reports/profit-and-loss/', views.profit_and_loss_report, name='profit_and_loss'),
    path('reports/balance-sheet/', views.balance_sheet_report, name='balance_sheet'),
    path('reports/cash-flow/', views.cash_flow_report, name='cash_flow'),
    path('reports/aged-receivables/', views.aged_receivables_report, name='aged_receivables'),
    path('reports/aged-payables/', views.aged_payables_report, name='aged_payables'),
    path('reports/vat-return/', views.vat_return_report, name='vat_return'),
    path('reports/budget-variance/', views.budget_variance_report, name='budget_variance'),
    path('reports/general-ledger/', views.general_ledger_report, name='general_ledger'),
    path('reports/account-ledger/', views.account_ledger_report, name='account_ledger'),
    path('reports/party-statement/', views.party_statement_report, name='party_statement'),
    path('reports/financial-ratios/', views.financial_ratios_report, name='financial_ratios'),
    path('api/auth/token/', obtain_auth_token),
    path('api/actions/post-entry/', api.PostEntryView.as_view()),
    path('api/actions/create-invoice/', api.CreateInvoiceView.as_view()),
    path('api/actions/record-payment/', api.RecordPaymentView.as_view()),
    path('api/actions/reverse-entry/', api.ReverseEntryView.as_view()),
    path('api/trial-balance/', api.TrialBalanceView.as_view()),
    path('api/reports/profit-and-loss/', api.ProfitAndLossView.as_view()),
    path('api/reports/balance-sheet/', api.BalanceSheetView.as_view()),
    path('api/reports/cash-flow/', api.CashFlowView.as_view()),
    path('api/reports/aged-receivables/', api.AgedReceivablesView.as_view()),
    path('api/reports/aged-payables/', api.AgedPayablesView.as_view()),
    path('api/reports/vat-return/', api.VatReturnView.as_view()),
    path('api/reports/budget-variance/', api.BudgetVarianceView.as_view()),
    path('api/reports/general-ledger/', api.GeneralLedgerView.as_view()),
    path('api/reports/account-ledger/', api.AccountLedgerView.as_view()),
    path('api/reports/party-statement/', api.PartyStatementView.as_view()),
    path('api/reports/financial-ratios/', api.FinancialRatiosView.as_view()),
    path('api/', include(router.urls)),
]
