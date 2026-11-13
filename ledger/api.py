"""REST API for the accounting system (Django REST Framework).

Read endpoints are read-only viewsets. Write endpoints call the service layer
so business rules (balanced entries, invoice/payment posting) are applied
consistently with the rest of the app.
"""
from decimal import Decimal, ROUND_HALF_UP

from django.utils.dateparse import parse_date
from rest_framework import status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from . import serializers, services
from .models import Account, Budget, FiscalPeriod, Invoice, JournalEntry, Party, Payment, TaxRate
from .reports import (
    account_ledger,
    aged_payables,
    aged_receivables,
    balance_sheet,
    budget_variance,
    cash_flow,
    financial_ratios,
    general_ledger,
    party_statement,
    profit_and_loss,
    vat_return,
)


class AccountViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Account.objects.all().order_by('code')
    serializer_class = serializers.AccountSerializer


class PartyViewSet(viewsets.ModelViewSet):
    queryset = Party.objects.all().order_by('name')
    serializer_class = serializers.PartySerializer


class TaxRateViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = TaxRate.objects.all().order_by('name')
    serializer_class = serializers.TaxRateSerializer


class JournalEntryViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = JournalEntry.objects.prefetch_related('lines__account').order_by('-entry_date', '-id')
    serializer_class = serializers.JournalEntrySerializer


class InvoiceViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Invoice.objects.prefetch_related('lines__account').order_by('-issue_date', '-id')
    serializer_class = serializers.InvoiceSerializer


class PaymentViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Payment.objects.order_by('-payment_date', '-id')
    serializer_class = serializers.PaymentSerializer


class PostEntryView(APIView):
    """POST a balanced journal entry."""

    def post(self, request):
        serializer = serializers.PostEntryInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            entry = services.post_journal_entry(
                data['entry_date'],
                data.get('reference', ''),
                data.get('description', ''),
                data['lines'],
                data.get('idempotency_key'),
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(serializers.JournalEntrySerializer(entry).data, status=status.HTTP_201_CREATED)


class CreateInvoiceView(APIView):
    """POST to create + post an invoice."""

    def post(self, request):
        serializer = serializers.CreateInvoiceInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        lines = []
        for line in data['lines']:
            amount = (line['quantity'] * line['unit_price']).quantize(
                Decimal('0.01'), rounding=ROUND_HALF_UP,
            )
            lines.append({
                'description': line['description'],
                'account': line['account'],
                'quantity': line['quantity'],
                'unit_price': line['unit_price'],
                'amount': amount,
            })

        try:
            invoice = services.create_invoice(
                data['invoice_number'], data['party'], data['invoice_type'],
                data['issue_date'], data['due_date'], lines, data.get('tax_rate'),
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(serializers.InvoiceSerializer(invoice).data, status=status.HTTP_201_CREATED)


class RecordPaymentView(APIView):
    """POST to record + post a payment (optionally allocated to invoices)."""

    def post(self, request):
        serializer = serializers.RecordPaymentInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            payment = services.record_payment(
                data['payment_date'], data['party'], data['direction'], data['amount'],
                data['method'], data.get('reference', ''), data.get('allocations'),
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(serializers.PaymentSerializer(payment).data, status=status.HTTP_201_CREATED)


class TrialBalanceView(APIView):
    """GET the trial balance from posted entries."""

    def get(self, request):
        return Response(serializers.TrialBalanceRowSerializer(services.get_trial_balance(), many=True).data)


def _report_rows(items):
    return [
        {'code': i['account'].code, 'name': i['account'].name, 'amount': str(i['amount'])}
        for i in items
    ]


class ProfitAndLossView(APIView):
    """GET profit & loss. Optional ?start=YYYY-MM-DD&end=YYYY-MM-DD."""

    def get(self, request):
        start_raw = request.query_params.get('start') or None
        end_raw = request.query_params.get('end') or None
        start = parse_date(start_raw) if start_raw else None
        end = parse_date(end_raw) if end_raw else None
        data = profit_and_loss(start, end)
        return Response({
            'revenue': _report_rows(data['revenue']),
            'expense': _report_rows(data['expense']),
            'total_revenue': str(data['total_revenue']),
            'total_expense': str(data['total_expense']),
            'net_income': str(data['net_income']),
        })


class BalanceSheetView(APIView):
    """GET balance sheet. Optional ?as_of=YYYY-MM-DD."""

    def get(self, request):
        as_of_raw = request.query_params.get('as_of') or None
        as_of = parse_date(as_of_raw) if as_of_raw else None
        data = balance_sheet(as_of)
        return Response({
            'assets': _report_rows(data['assets']),
            'liabilities': _report_rows(data['liabilities']),
            'equity': _report_rows(data['equity']),
            'net_income': str(data['net_income']),
            'total_assets': str(data['total_assets']),
            'total_liabilities': str(data['total_liabilities']),
            'total_equity': str(data['total_equity']),
            'balanced': data['balanced'],
        })


class FiscalPeriodViewSet(viewsets.ModelViewSet):
    queryset = FiscalPeriod.objects.all()
    serializer_class = serializers.FiscalPeriodSerializer


class ReverseEntryView(APIView):
    """POST to reverse a posted journal entry. Body: {"entry": <id>}."""

    def post(self, request):
        entry_id = request.data.get('entry')
        try:
            entry = JournalEntry.objects.get(id=entry_id)
        except JournalEntry.DoesNotExist:
            return Response({'detail': 'Entry not found.'}, status=status.HTTP_404_NOT_FOUND)
        try:
            reversal = services.reverse_entry(entry)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(serializers.JournalEntrySerializer(reversal).data, status=status.HTTP_201_CREATED)


class CashFlowView(APIView):
    """GET cash flow statement. Optional ?start=YYYY-MM-DD&end=YYYY-MM-DD."""

    def get(self, request):
        start_raw = request.query_params.get('start') or None
        end_raw = request.query_params.get('end') or None
        start = parse_date(start_raw) if start_raw else None
        end = parse_date(end_raw) if end_raw else None
        data = cash_flow(start, end)
        return Response({
            'net_income': str(data['net_income']),
            'working_capital_change': str(data['working_capital_change']),
            'operating_cash_flow': str(data['operating_cash_flow']),
            'financing_cash_flow': str(data['financing_cash_flow']),
            'net_change': str(data['net_change']),
            'actual_cash_change': str(data['actual_cash_change']),
            'reconciled': data['reconciled'],
        })


class BudgetViewSet(viewsets.ModelViewSet):
    queryset = Budget.objects.all()
    serializer_class = serializers.BudgetSerializer


class AgedReceivablesView(APIView):
    """GET amounts owed to us by customers, bucketed by age."""

    def get(self, request):
        as_of_raw = request.query_params.get('as_of') or None
        as_of = parse_date(as_of_raw) if as_of_raw else None
        return Response([
            {
                'party': r['party'].name,
                'current': str(r['current']),
                'b31_60': str(r['b31_60']),
                'b61_90': str(r['b61_90']),
                'b90_plus': str(r['b90_plus']),
                'total': str(r['total']),
            }
            for r in aged_receivables(as_of)
        ])


class AgedPayablesView(APIView):
    """GET amounts we owe to vendors, bucketed by age."""

    def get(self, request):
        as_of_raw = request.query_params.get('as_of') or None
        as_of = parse_date(as_of_raw) if as_of_raw else None
        return Response([
            {
                'party': r['party'].name,
                'current': str(r['current']),
                'b31_60': str(r['b31_60']),
                'b61_90': str(r['b61_90']),
                'b90_plus': str(r['b90_plus']),
                'total': str(r['total']),
            }
            for r in aged_payables(as_of)
        ])


class VatReturnView(APIView):
    """GET output VAT vs input VAT for the period."""

    def get(self, request):
        start_raw = request.query_params.get('start') or None
        end_raw = request.query_params.get('end') or None
        start = parse_date(start_raw) if start_raw else None
        end = parse_date(end_raw) if end_raw else None
        data = vat_return(start, end)
        return Response({
            'output_vat': str(data['output_vat']),
            'input_vat': str(data['input_vat']),
            'net_vat': str(data['net_vat']),
        })


class BudgetVarianceView(APIView):
    """GET budget vs actual for the period."""

    def get(self, request):
        start_raw = request.query_params.get('start') or None
        end_raw = request.query_params.get('end') or None
        start = parse_date(start_raw) if start_raw else None
        end = parse_date(end_raw) if end_raw else None
        return Response([
            {
                'account': r['account'].code,
                'name': r['account'].name,
                'budget': str(r['budget_amount']),
                'actual': str(r['actual']),
                'variance': str(r['variance']),
            }
            for r in budget_variance(start, end)
        ])


class GeneralLedgerView(APIView):
    """GET all posted entries with lines. Optional ?start=&end=."""

    def get(self, request):
        start_raw = request.query_params.get('start') or None
        end_raw = request.query_params.get('end') or None
        start = parse_date(start_raw) if start_raw else None
        end = parse_date(end_raw) if end_raw else None
        return Response([
            {
                'id': r['entry'].id,
                'date': str(r['entry'].entry_date),
                'reference': r['entry'].reference,
                'description': r['entry'].description,
                'total_debit': str(r['total_debit']),
                'total_credit': str(r['total_credit']),
                'lines': [
                    {'account': l.account.code, 'line_type': l.line_type, 'amount': str(l.amount)}
                    for l in r['lines']
                ],
            }
            for r in general_ledger(start, end)
        ])


class AccountLedgerView(APIView):
    """GET a running ledger for one account. Required ?account=<code>."""

    def get(self, request):
        code = request.query_params.get('account')
        account = Account.objects.filter(code=code).first() if code else None
        if not account:
            return Response({'detail': 'account code required'}, status=status.HTTP_400_BAD_REQUEST)
        start_raw = request.query_params.get('start') or None
        end_raw = request.query_params.get('end') or None
        start = parse_date(start_raw) if start_raw else None
        end = parse_date(end_raw) if end_raw else None
        data = account_ledger(account, start, end)
        return Response({
            'account': account.code,
            'name': account.name,
            'closing_balance': str(data['closing_balance']),
            'rows': [
                {
                    'date': str(r['date']),
                    'reference': r['reference'],
                    'description': r['description'],
                    'debit': str(r['debit']),
                    'credit': str(r['credit']),
                    'balance': str(r['balance']),
                }
                for r in data['rows']
            ],
        })


class PartyStatementView(APIView):
    """GET invoices + payments for one party. Required ?party=<id>."""

    def get(self, request):
        party_id = request.query_params.get('party')
        party = Party.objects.filter(id=party_id).first() if party_id else None
        if not party:
            return Response({'detail': 'party id required'}, status=status.HTTP_400_BAD_REQUEST)
        start_raw = request.query_params.get('start') or None
        end_raw = request.query_params.get('end') or None
        start = parse_date(start_raw) if start_raw else None
        end = parse_date(end_raw) if end_raw else None
        data = party_statement(party, start, end)
        return Response({
            'party': party.name,
            'total_invoiced': str(data['total_invoiced']),
            'balance': str(data['balance']),
            'invoices': [
                {'number': i.invoice_number, 'date': str(i.issue_date), 'total': str(i.total), 'status': i.status}
                for i in data['invoices']
            ],
            'payments': [
                {'date': str(p.payment_date), 'direction': p.direction, 'amount': str(p.amount), 'method': p.method}
                for p in data['payments']
            ],
        })


class FinancialRatiosView(APIView):
    """GET key financial ratios. Optional ?as_of=YYYY-MM-DD."""

    def get(self, request):
        as_of_raw = request.query_params.get('as_of') or None
        as_of = parse_date(as_of_raw) if as_of_raw else None
        data = financial_ratios(as_of)

        def fmt(v):
            return str(v) if v is not None else None

        return Response({
            'revenue': str(data['revenue']),
            'gross_profit': str(data['gross_profit']),
            'gross_margin': fmt(data['gross_margin']),
            'net_income': str(data['net_income']),
            'net_margin': fmt(data['net_margin']),
            'current_ratio': fmt(data['current_ratio']),
            'return_on_equity': fmt(data['return_on_equity']),
        })
