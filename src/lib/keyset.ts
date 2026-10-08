/** Read every row of a user's table in 1,000-row pages using keyset pagination
 *  (fast at any depth, unlike OFFSET) with an explicit user filter so indexes are used. */
export async function readAllRows<T extends Record<string, unknown>>(
  supabase: any,
  table: string,
  columns: string,
  key: string,
  userId: string | null,
  max = 200000,
): Promise<T[]> {
  const out: T[] = [];
  let last: string | null = null;
  while (out.length < max) {
    let q = supabase.from(table).select(columns).order(key).limit(1000);
    if (userId) q = q.eq("user_id", userId);
    if (last !== null) q = q.gt(key, last);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
    last = String((data[data.length - 1] as Record<string, unknown>)[key]);
  }
  return out;
}
