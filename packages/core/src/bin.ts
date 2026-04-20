#!/usr/bin/env node

/**
 * OneDot CLI — database migration tool
 *
 * Usage:
 *   npx onedot migrate              # Run pending migrations
 *   npx onedot migrate --dry-run    # Print SQL without executing
 *   npx onedot migrate --status     # Show migration status
 *   npx onedot migrate --adopt      # Adopt existing tables (manual SQL users)
 */

import { migrate, migrateStatus, migrateAdopt } from './migrate.js'

const args = process.argv.slice(2)
const command = args[0]

const DATABASE_URL = process.env.ONEDOT_DATABASE_URL || process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('[onedot] No database connection string found.')
  console.error('')
  console.error('Set one of:')
  console.error('  ONEDOT_DATABASE_URL=postgres://user:pass@host:5432/db')
  console.error('  DATABASE_URL=postgres://user:pass@host:5432/db')
  console.error('')
  console.error('Find your connection string:')
  console.error('  Supabase: Dashboard → Settings → Database → Connection string → URI')
  console.error('  Neon:     Dashboard → Connection Details → Connection string')
  console.error('  RDS:      Use your endpoint with postgres:// prefix')
  process.exit(1)
}

async function main() {
  if (!command || command === 'migrate') {
    const flags = args.slice(command === 'migrate' ? 1 : 0)

    if (flags.includes('--status')) {
      const status = await migrateStatus(DATABASE_URL!)
      console.log(`[onedot] Schema version: ${status.currentVersion}/${status.latestVersion}`)
      console.log(`[onedot] Pending: ${status.pending} migration(s)`)
      for (const m of status.migrations) {
        console.log(`  ${m.applied ? '✓' : '○'} v${m.version}: ${m.description}`)
      }
      return
    }

    if (flags.includes('--adopt')) {
      await migrateAdopt(DATABASE_URL!)
      return
    }

    const dryRun = flags.includes('--dry-run')
    const result = await migrate(DATABASE_URL!, { dryRun })
    if (!dryRun) {
      console.log(`[onedot] ${result.message}`)
    }
    return
  }

  // Unknown command
  console.error(`[onedot] Unknown command: ${command}`)
  console.error('')
  console.error('Usage:')
  console.error('  npx onedot migrate              Run pending migrations')
  console.error('  npx onedot migrate --dry-run    Print SQL without executing')
  console.error('  npx onedot migrate --status     Show migration status')
  console.error('  npx onedot migrate --adopt      Adopt existing tables')
  process.exit(1)
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
