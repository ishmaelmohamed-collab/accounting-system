import { query, withTransaction } from '../db';
import { money } from '../money';

async function getAverageCost(client: any, itemId: number): Promise<any> {
  const movements = (await client.query(
    'SELECT * FROM stock_movements WHERE item_id = $1 ORDER BY movement_date, id',
    [itemId],
  )).rows;
  let qty = money(0);
  let totalCost = money(0);
  for (const m of movements) {
    const q = money(m.quantity);
    if (q.greaterThan(0)) {
      totalCost = totalCost.plus(q.times(money(m.unit_cost)));
      qty = qty.plus(q);
    } else {
      const avg = qty.isZero() ? money(0) : totalCost.div(qty);
      totalCost = totalCost.plus(q.times(avg));
      qty = qty.plus(q);
    }
  }
  return qty.isZero() ? money(0) : totalCost.div(qty);
}

export async function createBom(args: any): Promise<any> {
  const { finishedItemId, name, lines } = args;
  return withTransaction(async (client) => {
    const r = await client.query('INSERT INTO boms (finished_item_id, name) VALUES ($1,$2) RETURNING id', [finishedItemId, name]);
    const bomId = r.rows[0].id;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      await client.query('INSERT INTO bom_lines (bom_id, component_item_id, quantity, line_no) VALUES ($1,$2,$3,$4)', [bomId, l.componentItemId, l.quantity, i + 1]);
    }
    return { bomId, name };
  });
}

export async function createProductionOrder(args: any): Promise<any> {
  const { bomId, quantity, productionDate } = args;
  const r = await query(
    'INSERT INTO production_orders (bom_id, quantity, production_date) VALUES ($1,$2,$3::date) RETURNING id',
    [bomId, quantity, productionDate],
  );
  return { productionOrderId: r.rows[0].id, bomId, quantity };
}

export async function produceOrder(orderId: number): Promise<any> {
  return withTransaction(async (client) => {
    const order = (await client.query('SELECT * FROM production_orders WHERE id = $1', [orderId])).rows[0];
    if (!order) throw new Error('Production order not found');
    if (order.status === 'completed') throw new Error('Production order is already completed');

    const bom = (await client.query('SELECT * FROM boms WHERE id = $1', [order.bom_id])).rows[0];
    const lines = (await client.query('SELECT * FROM bom_lines WHERE bom_id = $1 ORDER BY line_no', [order.bom_id])).rows;

    const orderQty = money(order.quantity);
    let totalComponentCost = money(0);

    for (const line of lines) {
      const avg = await getAverageCost(client, line.component_item_id);
      const qty = money(line.quantity).times(orderQty);
      totalComponentCost = totalComponentCost.plus(qty.times(avg));
      await client.query(
        'INSERT INTO stock_movements (item_id, movement_date, quantity, unit_cost, reference) VALUES ($1,$2::date,$3,$4,$5)',
        [line.component_item_id, order.production_date, qty.negated().toFixed(2), avg.toFixed(2), `PROD-${orderId}`],
      );
    }

    const unitCost = orderQty.isZero() ? money(0) : totalComponentCost.div(orderQty).toDecimalPlaces(2);
    await client.query(
      'INSERT INTO stock_movements (item_id, movement_date, quantity, unit_cost, reference) VALUES ($1,$2::date,$3,$4,$5)',
      [bom.finished_item_id, order.production_date, orderQty.toFixed(2), unitCost.toFixed(2), `PROD-${orderId}`],
    );

    await client.query("UPDATE production_orders SET status = 'completed' WHERE id = $1", [orderId]);

    return {
      productionOrderId: orderId,
      quantity: orderQty.toFixed(2),
      totalComponentCost: totalComponentCost.toFixed(2),
      finishedUnitCost: unitCost.toFixed(2),
    };
  });
}
