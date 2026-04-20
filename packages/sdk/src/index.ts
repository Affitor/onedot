import { OneDotEngine, createDatabase, migrate as runMigrate } from '@one-dot/core'
import type {
  CreateProgramInput,
  CreatePartnerInput,
  TrackClickInput,
  TrackSignupInput,
  RecordSaleInput,
  EventType,
  EventListener,
  MigrateResult,
} from '@one-dot/core'

export interface OneDotConfig {
  /** Self-hosted mode: provide your PostgreSQL connection string. OneDot creates od_* tables in your database. */
  databaseUrl?: string

  /** Cloud mode (future): provide your OneDot API key. Data managed by Affitor Cloud. */
  apiKey?: string

  /** Cloud mode (future): API endpoint. Defaults to https://api.onedot.dev */
  apiUrl?: string

  /**
   * Migration behavior:
   * - "auto": run migrations on first use (recommended for development)
   * - "manual": throw if tables don't exist (recommended for production)
   * - "skip": don't check or run migrations
   * Default: "auto" when NODE_ENV !== "production", "manual" otherwise
   */
  migrate?: 'auto' | 'manual' | 'skip'
}

/**
 * OneDot SDK — the client interface for partnership tracking.
 *
 * Two modes (same interface, swap one config line to migrate):
 *
 *   // Self-hosted: your database, your data
 *   const onedot = new OneDot({ databaseUrl: process.env.DATABASE_URL })
 *
 *   // Cloud (future): managed by Affitor
 *   const onedot = new OneDot({ apiKey: process.env.ONEDOT_API_KEY })
 */
export class OneDot {
  private engine: OneDotEngine
  private databaseUrl: string
  private migrateMode: 'auto' | 'manual' | 'skip'
  private migrated = false

  programs: ProgramsAPI
  partners: PartnersAPI
  track: TrackAPI
  sales: SalesAPI
  commissions: CommissionsAPI

  constructor(config: OneDotConfig) {
    if (config.apiKey) {
      // Cloud mode — future (Affitor managed)
      throw new Error(
        '[onedot] Cloud mode is not yet available. Use databaseUrl for self-hosted mode. ' +
        'Cloud mode (managed by Affitor) is coming soon at https://affitor.com'
      )
    }

    if (!config.databaseUrl) {
      throw new Error(
        '[onedot] databaseUrl is required. Provide your PostgreSQL connection string.\n' +
        'Example: new OneDot({ databaseUrl: "postgres://user:pass@host:5432/db" })'
      )
    }

    this.databaseUrl = config.databaseUrl
    this.migrateMode = config.migrate ??
      (process.env.NODE_ENV === 'production' ? 'manual' : 'auto')

    const db = createDatabase(config.databaseUrl)
    this.engine = new OneDotEngine(db)

    this.programs = new ProgramsAPI(this.engine)
    this.partners = new PartnersAPI(this.engine)
    this.track = new TrackAPI(this.engine)
    this.sales = new SalesAPI(this.engine)
    this.commissions = new CommissionsAPI(this.engine)
  }

  /**
   * Run database migrations (creates od_* tables if they don't exist).
   * Safe to call multiple times — idempotent, uses advisory lock for concurrency.
   */
  async migrate(): Promise<MigrateResult> {
    if (this.migrated) {
      return { applied: 0, currentVersion: 0, message: 'Already migrated this session.' }
    }
    const result = await runMigrate(this.databaseUrl)
    this.migrated = true
    return result
  }

  /** Subscribe to events */
  on(type: EventType | '*', listener: EventListener) {
    this.engine.on(type, listener)
  }

  /** Process auto-approvals for commissions past their hold period */
  async processAutoApprovals() {
    return this.engine.processAutoApprovals()
  }
}

// ─── Sub-APIs (clean namespaced interface) ────────────────

class ProgramsAPI {
  constructor(private engine: OneDotEngine) {}

  create(input: CreateProgramInput) {
    return this.engine.createProgram(input)
  }

  get(id: string) {
    return this.engine.getProgram(id)
  }

  list() {
    return this.engine.listPrograms()
  }
}

class PartnersAPI {
  constructor(private engine: OneDotEngine) {}

  create(input: CreatePartnerInput) {
    return this.engine.createPartner(input)
  }

  get(id: string) {
    return this.engine.getPartner(id)
  }

  getByCode(code: string) {
    return this.engine.getPartnerByCode(code)
  }

  list(programId: string) {
    return this.engine.listPartners(programId)
  }

  earnings(partnerId: string) {
    return this.engine.getPartnerEarnings(partnerId)
  }
}

class TrackAPI {
  constructor(private engine: OneDotEngine) {}

  /** Record a partner referral click. Returns click object with ID for cookie. */
  click(input: TrackClickInput) {
    return this.engine.trackClick(input)
  }

  /** Link a customer signup to a referral click. Idempotent per customer+program. */
  signup(input: TrackSignupInput) {
    return this.engine.trackSignup(input)
  }
}

class SalesAPI {
  constructor(private engine: OneDotEngine) {}

  /**
   * Record a sale and auto-calculate commission.
   * Idempotent if externalId is provided.
   * Returns { sale, commission, created } — commission is null for organic customers.
   */
  record(input: RecordSaleInput) {
    return this.engine.recordSale(input)
  }

  /** Reverse commissions for a refunded sale (by externalId). */
  refund(externalId: string) {
    return this.engine.refundSale(externalId)
  }
}

class CommissionsAPI {
  constructor(private engine: OneDotEngine) {}

  list(filters?: {
    partnerId?: string
    programId?: string
    status?: string
    limit?: number
    offset?: number
  }) {
    return this.engine.listCommissions(filters)
  }

  approve(commissionId: string) {
    return this.engine.approveCommission(commissionId)
  }

  reject(commissionId: string, reason?: string) {
    return this.engine.rejectCommission(commissionId, reason)
  }
}

// Re-export types for convenience
export type {
  CreateProgramInput,
  CreatePartnerInput,
  TrackClickInput,
  TrackSignupInput,
  RecordSaleInput,
  PartnerEarnings,
  CommissionRecord,
  EventType,
  EventListener,
  OneDotEvent,
} from '@one-dot/core'
