import { query, queryOne } from '@/lib/db'

export async function remember(
  agent: string,
  entityType: string,
  entityId: string,
  key: string,
  value: unknown
): Promise<void> {
  await queryOne(`
    INSERT INTO agent_memory (agent, entity_type, entity_id, key, value)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (agent, entity_type, entity_id, key) DO UPDATE
      SET value = $5, updated_at = NOW()
  `, [agent, entityType, entityId, key, JSON.stringify(value)])
}

export async function recall(
  agent: string,
  entityType: string,
  entityId: string
): Promise<Record<string, unknown>> {
  const rows = await query<{ key: string; value: unknown }>(`
    SELECT key, value FROM agent_memory
    WHERE agent = $1 AND entity_type = $2 AND entity_id = $3
  `, [agent, entityType, entityId])

  const result: Record<string, unknown> = {}
  for (const row of rows) {
    result[row.key] = row.value
  }
  return result
}
