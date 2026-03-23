#!/usr/bin/env node
import pg from 'pg'
import bcrypt from 'bcryptjs'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dir, '..', '.env.local')
try {
  const env = readFileSync(envPath, 'utf8')
  for (const line of env.split('\n')) {
    const [k, ...v] = line.split('=')
    if (k && v.length) process.env[k.trim()] = v.join('=').trim()
  }
} catch { /* env may already be set */ }

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

async function setup() {
  console.log('\n=== Field Manager Pro — Database Setup ===\n')

  // Create tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL CHECK (role IN ('employee','manager','ops_manager','developer')),
      full_name VARCHAR(100) NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      created_by UUID REFERENCES users(id)
    )
  `)
  console.log('✓ users table')

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      week_start DATE NOT NULL,
      days_working INTEGER[] NOT NULL,
      submitted_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, week_start)
    )
  `)
  console.log('✓ schedules table')

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shifts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      clock_in_at TIMESTAMPTZ,
      clock_in_lat DECIMAL(10,8),
      clock_in_lng DECIMAL(11,8),
      clock_in_address TEXT,
      clock_out_at TIMESTAMPTZ,
      clock_out_lat DECIMAL(10,8),
      clock_out_lng DECIMAL(11,8),
      clock_out_address TEXT,
      is_manual BOOLEAN DEFAULT FALSE,
      manual_note TEXT,
      manual_by UUID REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  console.log('✓ shifts table')

  await pool.query(`
    CREATE TABLE IF NOT EXISTS gps_breadcrumbs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lat DECIMAL(10,8) NOT NULL,
      lng DECIMAL(11,8) NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL,
      is_gap BOOLEAN DEFAULT FALSE
    )
  `)
  console.log('✓ gps_breadcrumbs table')

  await pool.query(`
    CREATE TABLE IF NOT EXISTS flags (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL,
      type VARCHAR(50) NOT NULL CHECK (type IN ('missing_clock_out','missing_clock_in','no_activity','overtime')),
      date DATE NOT NULL,
      detail TEXT,
      resolved BOOLEAN DEFAULT FALSE,
      resolved_by UUID REFERENCES users(id),
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  console.log('✓ flags table')

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dev_config (
      key VARCHAR(100) PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  console.log('✓ dev_config table')

  // Seed default dev_config
  await pool.query(`
    INSERT INTO dev_config (key, value) VALUES
      ('schedule_submit_notify_manager', 'true'::jsonb),
      ('schedule_submit_notify_developer', 'true'::jsonb),
      ('flag_notify_email', 'true'::jsonb)
    ON CONFLICT (key) DO NOTHING
  `)
  console.log('✓ dev_config seeded')

  // Check if master accounts already exist
  const existing = await pool.query(`SELECT COUNT(*) FROM users WHERE role IN ('manager','developer')`)
  if (parseInt(existing.rows[0].count) > 0) {
    console.log('\nAccounts already exist — skipping seed.')
    await pool.end()
    return
  }

  // Create manager account
  const managerHash = await bcrypt.hash('FmpManager2026!', 12)
  await pool.query(`
    INSERT INTO users (username, email, password_hash, role, full_name)
    VALUES ('manager', 'sg2425231@gmail.com', $1, 'manager', 'Manager')
  `, [managerHash])
  console.log('\n✓ Manager account created')
  console.log('  username: manager')
  console.log('  password: FmpManager2026!')

  // Create developer account
  const devHash = await bcrypt.hash('FmpDev2026!', 12)
  await pool.query(`
    INSERT INTO users (username, email, password_hash, role, full_name)
    VALUES ('developer', 'sg2425231@gmail.com', $1, 'developer', 'Developer')
  `, [devHash])
  console.log('\n✓ Developer account created')
  console.log('  username: developer')
  console.log('  password: FmpDev2026!')

  console.log('\n✅ Database setup complete!\n')
  await pool.end()
}

setup().catch(e => { console.error(e); process.exit(1) })
