import Decimal from 'decimal.js';

export function money(value: string | number | Decimal | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(0);
  return new Decimal(value);
}

export { Decimal };
