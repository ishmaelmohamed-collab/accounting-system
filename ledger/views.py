from decimal import Decimal, ROUND_HALF_UP

from django.db.models import Case, DecimalField, Sum, Value, When
from django.forms import formset_factory
from django.shortcuts import redirect, render
from django.utils.dateparse import parse_date

from . import services
from .forms import InvoiceForm, InvoiceLineForm, PaymentForm
from .models import Account, Invoice, JournalEntry, JournalEntryLine, Party, Payment, TaxRate
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

InvoiceLineFormSet = formset_factory(InvoiceLineForm, extra=3)


def _money(value):
    return f"{value:,.2f}"


def dashboard(request):
    balance_rows = (
        JournalEntryLine.objects
        .filter(journal_entry__status='posted')
        .values('account__code', 'account__name', 'account__type')
        .annotate(
            debit=Sum(Case(
                When(line_type='debit', then='amount'),
                default=Value(0),
                output_field=DecimalField(max_digits=20, decimal_places=2),
            )),
            credit=Sum(Case(
                When(line_type='credit', then='amount'),
                default=Value(0),
                output_field=DecimalField(max_digits=20, decimal_places=2),
            )),
        )
        .order_by('account__code')
    )

    trial_balance = []
    total_debit = 0
    total_credit = 0
    for row in balance_rows:
        d = row['debit'] or 0
        c = row['credit'] or 0
        total_debit += d
        total_credit += c
        trial_balance.append({
            'code': row['account__code'],
            'name': row['account__name'],
            'type': row['account__type'],
            'debit': _money(d),
            'credit': _money(c),
        })

    context = {
        'account_count': Account.objects.count(),
        'entry_count': JournalEntry.objects.count(),
        'party_count': Party.objects.count(),
        'invoice_count': Invoice.objects.count(),
        'payment_count': Payment.objects.count(),
        'tax_rate_count': TaxRate.objects.count(),
        'accounts': Account.objects.filter(is_active=True),
        'tax_rates': TaxRate.objects.all(),
        'trial_balance': trial_balance,
        'total_debit': _money(total_debit),
        'total_credit': _money(total_credit),
        'balanced': total_debit == total_credit,
    }
    return render(request, 'ledger/dashboard.html', context)


def invoice_create(request):
    if request.method == 'POST':
        form = InvoiceForm(request.POST)
        formset = InvoiceLineFormSet(request.POST)
        if form.is_valid() and formset.is_valid():
            lines = []
            for line_form in formset:
                data = line_form.cleaned_data
                if not data or not data.get('description'):
                    continue
                amount = (data['quantity'] * data['unit_price']).quantize(
                    Decimal('0.01'), rounding=ROUND_HALF_UP,
                )
                lines.append({
                    'description': data['description'],
                    'account': data['account'],
                    'quantity': data['quantity'],
                    'unit_price': data['unit_price'],
                    'amount': amount,
                })
            if not lines:
                form.add_error(None, 'Add at least one line item.')
            else:
                try:
                    services.create_invoice(
                        form.cleaned_data['invoice_number'],
                        form.cleaned_data['party'],
                        form.cleaned_data['invoice_type'],
                        form.cleaned_data['issue_date'],
                        form.cleaned_data['due_date'],
                        lines,
                        form.cleaned_data.get('tax_rate'),
                    )
                    return redirect('dashboard')
                except ValueError as exc:
                    form.add_error(None, str(exc))
    else:
        form = InvoiceForm()
        formset = InvoiceLineFormSet()
    return render(request, 'ledger/invoice_form.html', {'form': form, 'formset': formset})


def payment_create(request):
    if request.method == 'POST':
        form = PaymentForm(request.POST)
        if form.is_valid():
            data = form.cleaned_data
            allocations = None
            if data.get('invoice'):
                allocations = [{'invoice': data['invoice'], 'amount': data['amount']}]
            try:
                services.record_payment(
                    data['payment_date'], data['party'], data['direction'],
                    data['amount'], data['method'], data.get('reference', ''),
                    allocations,
                )
                return redirect('dashboard')
            except ValueError as exc:
                form.add_error(None, str(exc))
    else:
        form = PaymentForm()
    return render(request, 'ledger/payment_form.html', {'form': form})


def profit_and_loss_report(request):
    start_raw = request.GET.get('start') or None
    end_raw = request.GET.get('end') or None
    start = parse_date(start_raw) if start_raw else None
    end = parse_date(end_raw) if end_raw else None
    data = profit_and_loss(start, end)
    return render(request, 'ledger/profit_and_loss.html', {
        'data': data, 'start': start_raw or '', 'end': end_raw or '',
    })


def balance_sheet_report(request):
    as_of_raw = request.GET.get('as_of') or None
    as_of = parse_date(as_of_raw) if as_of_raw else None
    data = balance_sheet(as_of)
    return render(request, 'ledger/balance_sheet.html', {'data': data, 'as_of': as_of_raw or ''})


def cash_flow_report(request):
    start_raw = request.GET.get('start') or None
    end_raw = request.GET.get('end') or None
    start = parse_date(start_raw) if start_raw else None
    end = parse_date(end_raw) if end_raw else None
    data = cash_flow(start, end)
    return render(request, 'ledger/cash_flow.html', {'data': data, 'start': start_raw or '', 'end': end_raw or ''})


def aged_receivables_report(request):
    as_of_raw = request.GET.get('as_of') or None
    as_of = parse_date(as_of_raw) if as_of_raw else None
    return render(request, 'ledger/aging.html', {
        'title': 'Aged Receivables',
        'rows': aged_receivables(as_of),
        'as_of': as_of_raw or '',
    })


def aged_payables_report(request):
    as_of_raw = request.GET.get('as_of') or None
    as_of = parse_date(as_of_raw) if as_of_raw else None
    return render(request, 'ledger/aging.html', {
        'title': 'Aged Payables',
        'rows': aged_payables(as_of),
        'as_of': as_of_raw or '',
    })


def vat_return_report(request):
    start_raw = request.GET.get('start') or None
    end_raw = request.GET.get('end') or None
    start = parse_date(start_raw) if start_raw else None
    end = parse_date(end_raw) if end_raw else None
    data = vat_return(start, end)
    return render(request, 'ledger/vat_return.html', {'data': data, 'start': start_raw or '', 'end': end_raw or ''})


def budget_variance_report(request):
    start_raw = request.GET.get('start') or None
    end_raw = request.GET.get('end') or None
    start = parse_date(start_raw) if start_raw else None
    end = parse_date(end_raw) if end_raw else None
    rows = budget_variance(start, end)
    return render(request, 'ledger/budget_variance.html', {'rows': rows, 'start': start_raw or '', 'end': end_raw or ''})


def general_ledger_report(request):
    start_raw = request.GET.get('start') or None
    end_raw = request.GET.get('end') or None
    start = parse_date(start_raw) if start_raw else None
    end = parse_date(end_raw) if end_raw else None
    rows = general_ledger(start, end)
    return render(request, 'ledger/general_ledger.html', {'rows': rows, 'start': start_raw or '', 'end': end_raw or ''})


def account_ledger_report(request):
    account_code = request.GET.get('account') or ''
    account = Account.objects.filter(code=account_code).first() if account_code else None
    start_raw = request.GET.get('start') or None
    end_raw = request.GET.get('end') or None
    start = parse_date(start_raw) if start_raw else None
    end = parse_date(end_raw) if end_raw else None
    data = account_ledger(account, start, end) if account else None
    return render(request, 'ledger/account_ledger.html', {
        'data': data,
        'accounts': Account.objects.filter(is_active=True),
        'account_code': account_code,
        'start': start_raw or '',
        'end': end_raw or '',
    })


def party_statement_report(request):
    party_id = request.GET.get('party') or ''
    party = Party.objects.filter(id=party_id).first() if party_id else None
    start_raw = request.GET.get('start') or None
    end_raw = request.GET.get('end') or None
    start = parse_date(start_raw) if start_raw else None
    end = parse_date(end_raw) if end_raw else None
    data = party_statement(party, start, end) if party else None
    return render(request, 'ledger/party_statement.html', {
        'data': data,
        'parties': Party.objects.all(),
        'party_id': party_id,
        'start': start_raw or '',
        'end': end_raw or '',
    })


def financial_ratios_report(request):
    as_of_raw = request.GET.get('as_of') or None
    as_of = parse_date(as_of_raw) if as_of_raw else None
    data = financial_ratios(as_of)

    def pct(v):
        return f'{v * 100:.2f}%' if v is not None else '—'

    formatted = {
        'revenue': data['revenue'],
        'gross_profit': data['gross_profit'],
        'gross_margin': pct(data['gross_margin']),
        'net_income': data['net_income'],
        'net_margin': pct(data['net_margin']),
        'current_ratio': f'{data["current_ratio"]:.2f}' if data['current_ratio'] is not None else '—',
        'return_on_equity': pct(data['return_on_equity']),
    }
    return render(request, 'ledger/financial_ratios.html', {'data': formatted, 'as_of': as_of_raw or ''})
