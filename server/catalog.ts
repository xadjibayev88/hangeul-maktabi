import type { RowDataPacket } from "mysql2/promise";
import { db } from "./database.js";
let current: unknown, expires = 0, pending: Promise<unknown> | null = null;
export async function learningCatalog(): Promise<unknown> {
  if (current && expires > Date.now()) return current;
  if (!pending) pending = (async () => {
    const [rows] = await db().execute<RowDataPacket[]>("SELECT content FROM catalog WHERE id = ? LIMIT 1", ["learning-v2"]);
    if (!rows[0]) throw new Error("Learning catalog is missing");
    const value = typeof rows[0].content === "string" ? JSON.parse(rows[0].content) : rows[0].content;
    if (!value?.data || Buffer.byteLength(JSON.stringify(value)) > 1000000) throw new Error("Invalid learning catalog");
    current = value; expires = Date.now() + 60000; return value;
  })().finally(() => { pending = null; });
  return pending;
}
