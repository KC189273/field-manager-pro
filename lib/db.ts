import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  // max: 2 — each Vercel worker has its own pool; keeping this low prevents
  // exhausting Neon/Supabase connection limits when many workers scale up.
  // Queries that use Promise.all() still run in parallel up to this limit.
  // For higher concurrency, switch DATABASE_URL to Neon's pooler endpoint
  // (-pooler.neon.tech) which supports thousands of connections via PgBouncer.
  max: 2,
  connectionTimeoutMillis: 8000,
  idleTimeoutMillis: 10000,
})

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const res = await pool.query(text, params)
  return res.rows as T[]
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params)
  return rows[0] ?? null
}

export default pool
