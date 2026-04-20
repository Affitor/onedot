import { OneDotEngine, createDatabase } from '@onedot/core'
import type {
  CreateProgramInput,
  CreatePartnerInput,
  TrackClickInput,
  TrackSignupInput,
  RecordSaleInput,
  EventType,
  EventListener,
} from '@onedot/core'

export interface OneDotConfig {
  /** Self-hosted mode: provide your PostgreSQL connection string. OneDot creates od_* tables in your database. */
  databaseUrl?: string

  /** Cloud mode (future): provide your OneDot API key. Data managed by Affitor Cloud. */
  apiKey?: string

  /** Cloud mode (future): API endpoint. Defaults to https://api.onedot.dev */
  apiUrl?: string
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

    const db = createDatabase(config.databaseUrl)
    this.engine = new OneDotEngine(db)

    this.programs = new ProgramsAPI(this.engine)
    this.partners = new PartnersAPI(this.engine)
    this.track = new TrackAPI(this.engine)
    this.sales = new SalesAPI(this.engine)
    this.commissions = new CommissionsAPI(this.engine)
  }

  /** Run database migrations (creates od_* tables if they don't exist) */
  async migrate() {
    // In MVP, migrations are run via drizzle-kit push or SQL file
    // This is a placeholder for the programmatic migration API
    console.log('[onedot] Run migrations with: npx drizzle-kit push')
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
} from '@onedot/core'
