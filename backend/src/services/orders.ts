import { query, withTransaction } from '../db';
import { money } from '../money';
import { nextNumber } from '../numbering';
import { _createInvoice } from './invoice';

async function _createOrder(args: any, client: any): Promise<any> {
  const {
    orderType, partyId, orderDate, expectedDate = null, lines,
    taxRateId = null, orderNumber: orderNumberArg, status = 'confirmed',
  } = args;

  const subtotal = lines.reduce((s: any, l: any) => s.plus(money(l.amount)), money(0));
  if (!subtotal.greaterThan(0)) throw new Error('Order subtotal must be positive.');

  let taxAmount = money(0);
  if (taxRateId) {
    const { rows } = await client.query('SELECT rate FROM tax_rates WHERE id = $1', [taxRateId]);
    if (rows.length) taxAmount = subtotal.times(money(rows[0].rate)).div(100).toDecimalPlaces(2);
  }
  const total = subtotal.plus(taxAmount);

  const seqName = orderType === 'purchase' ? 'purchase_order' : 'sales_order';
  const orderNumber = orderNumberArg || await nextNumber(client, seqName);

  const order = await client.query(
    `INSERT INTO orders (order_number, order_type, party_id, order_date, expected_date, status, subtotal, tax_rate_id, tax_amount, total)
     VALUES ($1,$2,$3,$4::date,$5::date,$6,$7,$8,$9,$10) RETURNING id`,
    [orderNumber, orderType, partyId, orderDate, expectedDate, status, subtotal.toFixed(2), taxRateId, taxAmount.toFixed(2), total.toFixed(2)],
  );
  const orderId = order.rows[0].id;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    await client.query(
      'INSERT INTO order_lines (order_id, description, account_code, quantity, unit_price, amount, line_no) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [orderId, l.description, l.accountCode, l.quantity || 1, l.unitPrice || 0, l.amount, i + 1],
    );
  }

  return { orderId, orderNumber, orderType, total: total.toFixed(2) };
}

export async function createOrder(args: any): Promise<any> {
  return withTransaction((client) => _createOrder(args, client));
}

export async function convertOrderToInvoice(orderId: number): Promise<any> {
  return withTransaction(async (client) => {
    const order = (await client.query('SELECT * FROM orders WHERE id = $1', [orderId])).rows[0];
    if (!order) throw new Error('Order not found');
    if (order.status === 'billed') throw new Error('Order is already billed');
    if (order.status === 'cancelled') throw new Error('Order is cancelled');

    const lines = (await client.query('SELECT * FROM order_lines WHERE order_id = $1 ORDER BY line_no', [orderId])).rows;

    const invoice = await _createInvoice({
      invoiceNumber: null, // let invoice auto-numbering assign it
      partyId: order.party_id,
      invoiceType: order.order_type,
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: order.expected_date || new Date().toISOString().slice(0, 10),
      taxRateId: order.tax_rate_id,
      lines: lines.map((l) => ({
        description: l.description,
        accountCode: l.account_code,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unit_price),
        amount: l.amount,
      })),
    }, client);

    await client.query("UPDATE orders SET status = 'billed' WHERE id = $1", [orderId]);

    return { orderId, orderNumber: order.order_number, invoiceId: invoice.invoiceId, invoiceNumber: invoice.invoiceNumber };
  });
}
