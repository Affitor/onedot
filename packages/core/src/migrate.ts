/**
 * OneDot — Programmatic Migration Engine
 *
 * Handles all edge cases:
 * - Fresh install (no od_* tables)
 * - Already migrated (idempotent)
 * - Schema upgrades (version tracking)
 * - Supabase pooler detection (port 6543)
 * - Concurrent startup safety (pg_advisory_lock)
 * - Dry-run mode (print SQL without executing)
 */

import postgres from 'postgres'

// Advisory lock ID — unique to OneDot migrations (CRC32 of "onedot")
const ADVISORY_LOCK_ID = 0x6f6e6564

export interface MigrateOptions {
  /** Print SQL without executing */
  dryRun?: boolean
  /** Suppress console output */
  silent?: boolean
}

export interface MigrateResult {
  applied: number
  currentVersion: number
  message: string
}

// ── Migration Registry ─────────────────────────────────────
// Each migration is idempotent SQL. Add new versions here.

const MIGRATIONS: { version: number; description: string; sql: string }[] = [
  {
    version: 1,
    description: 'Initial schema — 8 tables, indexes, foreign keys',
    sql: `
-- od_programs (must be first — referenced by all others)
CREATE TABLE IF NOT EXISTS "od_programs" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "commission_type" text DEFAULT 'cps_recurring' NOT NULL,
  "commission_percent" numeric(8, 4),
  "commission_fixed" integer,
  "cookie_days" integer DEFAULT 30 NOT NULL,
  "hold_days" integer DEFAULT 14 NOT NULL,
  "auto_approve" boolean DEFAULT true NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "od_programs_slug_unique" UNIQUE("slug")
);

-- od_partners
CREATE TABLE IF NOT EXISTS "od_partners" (
  "id" text PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "name" text,
  "email" text,
  "program_id" text NOT NULL REFERENCES "od_programs"("id"),
  "balance_cents" integer DEFAULT 0 NOT NULL,
  "paid_cents" integer DEFAULT 0 NOT NULL,
  "lifetime_earnings_cents" integer DEFAULT 0 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "od_partners_code_unique" UNIQUE("code")
);

-- od_clicks
CREATE TABLE IF NOT EXISTS "od_clicks" (
  "id" text PRIMARY KEY NOT NULL,
  "partner_id" text NOT NULL REFERENCES "od_partners"("id"),
  "program_id" text NOT NULL REFERENCES "od_programs"("id"),
  "ip" text,
  "user_agent" text,
  "referer" text,
  "landing_page" text,
  "utm_source" text,
  "utm_medium" text,
  "utm_campaign" text,
  "converted" boolean DEFAULT false NOT NULL,
  "converted_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- od_referrals
CREATE TABLE IF NOT EXISTS "od_referrals" (
  "id" text PRIMARY KEY NOT NULL,
  "click_id" text REFERENCES "od_clicks"("id"),
  "partner_id" text NOT NULL REFERENCES "od_partners"("id"),
  "program_id" text NOT NULL REFERENCES "od_programs"("id"),
  "customer_id" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- od_sales
CREATE TABLE IF NOT EXISTS "od_sales" (
  "id" text PRIMARY KEY NOT NULL,
  "referral_id" text NOT NULL REFERENCES "od_referrals"("id"),
  "partner_id" text NOT NULL REFERENCES "od_partners"("id"),
  "program_id" text NOT NULL REFERENCES "od_programs"("id"),
  "customer_id" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "currency" text DEFAULT 'usd' NOT NULL,
  "external_id" text,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "od_sales_external_id_unique" UNIQUE("external_id")
);

-- od_commissions
CREATE TABLE IF NOT EXISTS "od_commissions" (
  "id" text PRIMARY KEY NOT NULL,
  "sale_id" text NOT NULL REFERENCES "od_sales"("id"),
  "partner_id" text NOT NULL REFERENCES "od_partners"("id"),
  "program_id" text NOT NULL REFERENCES "od_programs"("id"),
  "sale_amount_cents" integer NOT NULL,
  "commission_percent" numeric(8, 4) NOT NULL,
  "amount_cents" integer NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "hold_until" timestamp,
  "approved_at" timestamp,
  "rejected_at" timestamp,
  "paid_at" timestamp,
  "rejection_reason" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- od_transactions
CREATE TABLE IF NOT EXISTS "od_transactions" (
  "id" text PRIMARY KEY NOT NULL,
  "partner_id" text NOT NULL REFERENCES "od_partners"("id"),
  "type" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "commission_id" text REFERENCES "od_commissions"("id"),
  "description" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- od_webhook_events
CREATE TABLE IF NOT EXISTS "od_webhook_events" (
  "id" text PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "delivered_at" timestamp,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Indexes (IF NOT EXISTS requires PG 9.5+)
CREATE INDEX IF NOT EXISTS "od_clicks_partner_idx" ON "od_clicks" ("partner_id");
CREATE INDEX IF NOT EXISTS "od_clicks_created_idx" ON "od_clicks" ("created_at");
CREATE INDEX IF NOT EXISTS "od_commissions_partner_idx" ON "od_commissions" ("partner_id");
CREATE INDEX IF NOT EXISTS "od_commissions_status_idx" ON "od_commissions" ("status");
CREATE INDEX IF NOT EXISTS "od_commissions_hold_idx" ON "od_commissions" ("hold_until");
CREATE INDEX IF NOT EXISTS "od_partners_program_idx" ON "od_partners" ("program_id");
CREATE INDEX IF NOT EXISTS "od_partners_email_idx" ON "od_partners" ("email");
CREATE UNIQUE INDEX IF NOT EXISTS "od_referrals_customer_program_idx" ON "od_referrals" ("customer_id","program_id");
CREATE INDEX IF NOT EXISTS "od_referrals_partner_idx" ON "od_referrals" ("partner_id");
CREATE INDEX IF NOT EXISTS "od_sales_partner_idx" ON "od_sales" ("partner_id");
CREATE INDEX IF NOT EXISTS "od_sales_customer_idx" ON "od_sales" ("customer_id");
CREATE INDEX IF NOT EXISTS "od_sales_created_idx" ON "od_sales" ("created_at");
CREATE INDEX IF NOT EXISTS "od_transactions_partner_idx" ON "od_transactions" ("partner_id");
CREATE INDEX IF NOT EXISTS "od_transactions_type_idx" ON "od_transactions" ("type");
CREATE INDEX IF NOT EXISTS "od_webhook_events_type_idx" ON "od_webhook_events" ("type");
`,
  },
  // Future migrations go here:
  // { version: 2, description: 'Add payout columns', sql: `ALTER TABLE ...` },
]

// ── Pooler Detection ───────────────────────────────────────

function detectPooler(connectionString: string): string | null {
  try {
    const url = new URL(connectionString)
    const port = url.port

    // Supabase Supavisor pooler uses port 6543
    if (port === '6543') {
      return 'Supabase connection pooler detected (port 6543). Migrations require a direct connection.\n' +
        'Use port 5432 instead, or find your direct connection string at:\n' +
        'Supabase Dashboard → Settings → Database → Connection string → URI\n' +
        'Tip: You can set ONEDOT_DATABASE_URL for migrations and DATABASE_URL for your pooled connection.'
    }

    // PgBouncer flag
    if (url.searchParams.has('pgbouncer') || url.searchParams.get('pgbouncer') === 'true') {
      return 'PgBouncer detected in connection string. Migrations require a direct PostgreSQL connection.\n' +
        'Remove ?pgbouncer=true or use a direct connection string for migrations.'
    }

    // Neon pooler detection (-pooler in hostname)
    if (url.hostname.includes('-pooler.')) {
      return 'Neon connection pooler detected. Migrations require a direct connection.\n' +
        'Use your non-pooler endpoint (remove "-pooler" from hostname).'
    }
  } catch {
    // Not a valid URL — let postgres driver handle the error
  }
  return null
}

// ── Migration Tracking ─────────────────────────────────────

async function ensureTrackingTable(sql: postgres.Sql | postgres.TransactionSql) {
  await sql`
    CREATE TABLE IF NOT EXISTS "od_migrations" (
      "version" integer PRIMARY KEY,
      "description" text NOT NULL,
      "applied_at" timestamp DEFAULT now() NOT NULL
    )
  `
}

async function getCurrentVersion(sql: postgres.Sql | postgres.TransactionSql): Promise<number> {
  const rows = await sql`
    SELECT COALESCE(MAX(version), 0) as version FROM "od_migrations"
  `
  return rows[0]?.version ?? 0
}

async function recordMigration(sql: postgres.Sql | postgres.TransactionSql, version: number, description: string) {
  await sql`
    INSERT INTO "od_migrations" (version, description)
    VALUES (${version}, ${description})
    ON CONFLICT (version) DO NOTHING
  `
}

// ── Public API ─────────────────────────────────────────────

/**
 * Run all pending migrations.
 * Safe to call multiple times (idempotent).
 * Uses pg_advisory_lock to prevent concurrent migration runs.
 */
export async function migrate(
  connectionString: string,
  options: MigrateOptions = {}
): Promise<MigrateResult> {
  const { dryRun = false, silent = false } = options
  const log = silent ? () => {} : console.log

  // Pooler detection
  const poolerWarning = detectPooler(connectionString)
  if (poolerWarning) {
    throw new Error(`[onedot] ${poolerWarning}`)
  }

  // Create a dedicated connection for migrations (not the app pool)
  const sql = postgres(connectionString, { max: 1 })

  try {
    // Dry-run mode: just print SQL
    if (dryRun) {
      log('[onedot] Dry-run mode — SQL that would be executed:\n')
      log('-- od_migrations tracking table')
      log('CREATE TABLE IF NOT EXISTS "od_migrations" (...);')
      for (const m of MIGRATIONS) {
        log(`\n-- Migration ${m.version}: ${m.description}`)
        log(m.sql.trim())
      }
      return { applied: 0, currentVersion: MIGRATIONS.length, message: 'Dry-run complete. No changes made.' }
    }

    // Acquire advisory lock (prevents concurrent migrations)
    const lockResult = await sql`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_ID}) as acquired`
    if (!lockResult[0]?.acquired) {
      throw new Error(
        '[onedot] Another migration is already running. ' +
        'If this is stuck, run: SELECT pg_advisory_unlock(' + ADVISORY_LOCK_ID + ')'
      )
    }

    try {
      // Ensure tracking table exists
      await ensureTrackingTable(sql)

      // Get current version
      const currentVersion = await getCurrentVersion(sql)

      // Find pending migrations
      const pending = MIGRATIONS.filter(m => m.version > currentVersion)

      if (pending.length === 0) {
        log('[onedot] Database is up to date (version ' + currentVersion + ')')
        return { applied: 0, currentVersion, message: 'Already up to date.' }
      }

      log(`[onedot] Running ${pending.length} migration(s)...`)

      let applied = 0
      for (const migration of pending) {
        log(`[onedot]   ${migration.version}: ${migration.description}`)

        // Run migration in a transaction
        await sql.begin(async (tx) => {
          await tx.unsafe(migration.sql)
          await recordMigration(tx, migration.version, migration.description)
        })

        applied++
      }

      const newVersion = currentVersion + applied
      log(`[onedot] Done. Applied ${applied} migration(s). Current version: ${newVersion}`)

      return { applied, currentVersion: newVersion, message: `Applied ${applied} migration(s).` }
    } finally {
      // Release advisory lock
      await sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_ID})`
    }
  } finally {
    // Close the migration-only connection
    await sql.end()
  }
}

/**
 * Get migration status without running anything.
 */
export async function migrateStatus(connectionString: string): Promise<{
  currentVersion: number
  latestVersion: number
  pending: number
  migrations: { version: number; description: string; applied: boolean }[]
}> {
  const sql = postgres(connectionString, { max: 1 })

  try {
    // Check if tracking table exists
    const tableExists = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'od_migrations'
      ) as exists
    `

    let currentVersion = 0
    if (tableExists[0]?.exists) {
      currentVersion = await getCurrentVersion(sql)
    }

    return {
      currentVersion,
      latestVersion: MIGRATIONS.length,
      pending: MIGRATIONS.length - currentVersion,
      migrations: MIGRATIONS.map(m => ({
        version: m.version,
        description: m.description,
        applied: m.version <= currentVersion,
      })),
    }
  } finally {
    await sql.end()
  }
}

/**
 * Adopt existing tables (for users who ran raw SQL manually).
 * Checks that od_* tables exist, then records them as migrated.
 */
export async function migrateAdopt(
  connectionString: string,
  upToVersion?: number
): Promise<MigrateResult> {
  const targetVersion = upToVersion ?? MIGRATIONS.length
  const sql = postgres(connectionString, { max: 1 })

  try {
    // Verify tables actually exist
    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name LIKE 'od_%'
      ORDER BY table_name
    `

    const tableNames = tables.map((t: any) => t.table_name)
    const required = ['od_programs', 'od_partners', 'od_clicks', 'od_referrals',
                      'od_sales', 'od_commissions', 'od_transactions', 'od_webhook_events']
    const missing = required.filter(t => !tableNames.includes(t))

    if (missing.length > 0) {
      throw new Error(
        `[onedot] Cannot adopt — missing tables: ${missing.join(', ')}. ` +
        'Run migrations first or create the tables manually.'
      )
    }

    await ensureTrackingTable(sql)

    // Record all migrations up to target as applied
    for (const m of MIGRATIONS.filter(m => m.version <= targetVersion)) {
      await recordMigration(sql, m.version, m.description + ' (adopted)')
    }

    console.log(`[onedot] Adopted existing tables. Recorded as version ${targetVersion}.`)
    return { applied: 0, currentVersion: targetVersion, message: `Adopted at version ${targetVersion}.` }
  } finally {
    await sql.end()
  }
}
