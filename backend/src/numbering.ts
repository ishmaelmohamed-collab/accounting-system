export async function nextNumber(client: any, name: string): Promise<string> {
  const { rows } = await client.query(
    'UPDATE numbering_sequences SET next_value = next_value + 1 WHERE name = $1 RETURNING prefix, next_value, pad_length',
    [name],
  );
  if (!rows.length) throw new Error(`Numbering sequence not found: ${name}`);
  const { prefix, next_value, pad_length } = rows[0];
  return `${prefix}${String(next_value).padStart(pad_length, '0')}`;
}
