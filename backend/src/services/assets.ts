import { withTransaction } from '../db';
import { money } from '../money';
import { postJournalEntry } from './journal';

const ACCUM_DEP = '1501';
const GAIN_LOSS = '6300';
const CASH_ACCOUNT = '1005';

export async function disposeAsset(assetId: number, args: any): Promise<any> {
  const { date, proceeds = '0', method = 'sale' } = args;
  return withTransaction(async (client) => {
    const asset = (await client.query('SELECT * FROM fixed_assets WHERE id = $1', [assetId])).rows[0];
    if (!asset) throw new Error('Asset not found');
    if (asset.disposal_date) throw new Error('Asset is already disposed');

    const acct = (await client.query('SELECT code FROM accounts WHERE id = $1', [asset.account_id])).rows[0];
    const assetCode = acct.code;

    const cost = money(asset.cost);
    const salvage = money(asset.salvage_value);
    const lifeYears = Number(asset.useful_life_years);
    const annualDep = cost.minus(salvage).div(lifeYears);
    const elapsedYears = Math.max(0, (new Date(date).getTime() - new Date(asset.purchase_date).getTime()) / (365.25 * 86400000));
    const accumulated = annualDep.times(Math.min(elapsedYears, lifeYears)).toDecimalPlaces(2);
    const nbv = cost.minus(accumulated);
    const proceedsAmt = money(proceeds);

    const lines: any[] = [
      { accountCode: CASH_ACCOUNT, lineType: 'debit', amount: proceedsAmt.toFixed(2) },
      { accountCode: ACCUM_DEP, lineType: 'debit', amount: accumulated.toFixed(2) },
      { accountCode: assetCode, lineType: 'credit', amount: cost.toFixed(2) },
    ];
    const netGainLoss = proceedsAmt.plus(accumulated).minus(cost);
    if (netGainLoss.isPositive()) {
      lines.push({ accountCode: GAIN_LOSS, lineType: 'credit', amount: netGainLoss.toFixed(2) });
    } else if (netGainLoss.isNegative()) {
      lines.push({ accountCode: GAIN_LOSS, lineType: 'debit', amount: netGainLoss.abs().toFixed(2) });
    }

    const entry = await postJournalEntry({
      date,
      reference: `DISP-${assetId}`,
      description: `Disposal of ${asset.name} (${method})`,
      lines,
    }, client);

    await client.query(
      'UPDATE fixed_assets SET disposal_date = $1::date, disposal_proceeds = $2, disposal_method = $3 WHERE id = $4',
      [date, proceedsAmt.toFixed(2), method, assetId],
    );

    return {
      assetId,
      netBookValue: nbv.toFixed(2),
      accumulatedDepreciation: accumulated.toFixed(2),
      gainLoss: netGainLoss.toFixed(2),
      journalEntryId: entry.id,
    };
  });
}
