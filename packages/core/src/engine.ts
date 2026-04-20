import { eq, and, sql, gt } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { Database } from './db.js'
import {
  odPrograms,
  odPartners,
  odClicks,
  odReferrals,
  odSales,
  odCommissions,
  odTransactions,
} from './schema.js'
import type {
  CreateProgramInput,
  CreatePartnerInput,
  TrackClickInput,
  TrackSignupInput,
  RecordSaleInput,
  PartnerEarnings,
  EventType,
  OneDotEvent,
  EventListener,
} from './types.js'

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export class OneDotEngine {
  private db: Database
  private listeners: Map<EventType | '*', EventListener[]> = new Map()

  constructor(db: Database) {
    this.db = db
  }

  // ─── Events ─────────────────────────────────────────────

  on(type: EventType | '*', listener: EventListener) {
    const existing = this.listeners.get(type) || []
    existing.push(listener)
    this.listeners.set(type, existing)
  }

  private async emit(type: EventType, data: Record<string, unknown>) {
    const event: OneDotEvent = { type, data, timestamp: new Date() }
    const typeListeners = this.listeners.get(type) || []
    const wildcardListeners = this.listeners.get('*') || []
    for (const listener of [...typeListeners, ...wildcardListeners]) {
      try { await listener(event) } catch { /* swallow listener errors */ }
    }
  }

  // ─── Programs ───────────────────────────────────────────

  async createProgram(input: CreateProgramInput) {
    const values: Record<string, unknown> = {
      name: input.name,
      slug: input.slug || slugify(input.name),
      description: input.description,
      commissionType: input.commissionType || 'cps_recurring',
      commissionPercent: input.commissionPercent?.toString(),
      commissionFixed: input.commissionFixed,
      cookieDays: input.cookieDays ?? 30,
      holdDays: input.holdDays ?? 14,
      autoApprove: input.autoApprove ?? true,
    }
    // Allow custom ID (e.g. "prg_kyma_referral") — otherwise auto-generated
    if (input.id) values.id = input.id

    const [program] = await this.db.insert(odPrograms).values(values as any).returning()
    return program
  }

  async getProgram(id: string) {
    return this.db.query.odPrograms.findFirst({
      where: eq(odPrograms.id, id),
    })
  }

  async getProgramBySlug(slug: string) {
    return this.db.query.odPrograms.findFirst({
      where: eq(odPrograms.slug, slug),
    })
  }

  async listPrograms() {
    return this.db.query.odPrograms.findMany({
      where: eq(odPrograms.active, true),
    })
  }

  // ─── Partners ───────────────────────────────────────────

  async createPartner(input: CreatePartnerInput) {
    const code = input.code || nanoid(8).toLowerCase()
    const values: Record<string, unknown> = {
      programId: input.programId,
      code,
      name: input.name,
      email: input.email,
      metadata: input.metadata,
    }
    if (input.id) values.id = input.id

    const [partner] = await this.db.insert(odPartners).values(values as any).returning()
    await this.emit('partner.created', { partner })
    return partner
  }

  async getPartner(id: string) {
    return this.db.query.odPartners.findFirst({
      where: eq(odPartners.id, id),
    })
  }

  async getPartnerByCode(code: string) {
    return this.db.query.odPartners.findFirst({
      where: eq(odPartners.code, code),
    })
  }

  async listPartners(programId: string) {
    return this.db.query.odPartners.findMany({
      where: and(
        eq(odPartners.programId, programId),
        eq(odPartners.active, true),
      ),
    })
  }

  async getPartnerEarnings(partnerId: string): Promise<PartnerEarnings | null> {
    const partner = await this.getPartner(partnerId)
    if (!partner) return null

    const [stats] = await this.db
      .select({
        totalClicks: sql<number>`count(distinct ${odClicks.id})`,
      })
      .from(odClicks)
      .where(eq(odClicks.partnerId, partnerId))

    const [referralStats] = await this.db
      .select({
        totalReferrals: sql<number>`count(*)`,
      })
      .from(odReferrals)
      .where(eq(odReferrals.partnerId, partnerId))

    const [saleStats] = await this.db
      .select({
        totalSales: sql<number>`count(*)`,
      })
      .from(odSales)
      .where(eq(odSales.partnerId, partnerId))

    const commissionStats = await this.db
      .select({
        status: odCommissions.status,
        total: sql<number>`coalesce(sum(${odCommissions.amountCents}), 0)`,
      })
      .from(odCommissions)
      .where(eq(odCommissions.partnerId, partnerId))
      .groupBy(odCommissions.status)

    const byStatus = Object.fromEntries(
      commissionStats.map((s) => [s.status, Number(s.total)])
    )

    return {
      partnerId: partner.id,
      partnerCode: partner.code,
      partnerName: partner.name,
      totalEarnedCents: partner.lifetimeEarningsCents,
      pendingCents: byStatus['pending'] || 0,
      approvedCents: byStatus['approved'] || 0,
      paidCents: byStatus['paid'] || 0,
      totalClicks: Number(stats.totalClicks),
      totalReferrals: Number(referralStats.totalReferrals),
      totalSales: Number(saleStats.totalSales),
    }
  }

  // ─── Tracking ───────────────────────────────────────────

  async trackClick(input: TrackClickInput) {
    // Resolve partner from code
    const partner = await this.getPartnerByCode(input.partnerCode)
    if (!partner) throw new Error(`Partner not found: ${input.partnerCode}`)
    if (partner.programId !== input.programId) {
      throw new Error(`Partner ${input.partnerCode} is not in program ${input.programId}`)
    }

    const [click] = await this.db.insert(odClicks).values({
      partnerId: partner.id,
      programId: input.programId,
      ip: input.ip,
      userAgent: input.userAgent,
      referer: input.referer,
      landingPage: input.landingPage,
      utmSource: input.utmSource,
      utmMedium: input.utmMedium,
      utmCampaign: input.utmCampaign,
    }).returning()

    await this.emit('click.created', { click })
    return click
  }

  async trackSignup(input: TrackSignupInput) {
    // Resolve partner
    let partnerId: string | undefined

    if (input.clickId) {
      // From cookie — look up the click to get partner
      const click = await this.db.query.odClicks.findFirst({
        where: eq(odClicks.id, input.clickId),
      })
      if (!click) throw new Error(`Click not found: ${input.clickId}`)

      // Enforce cookie window — check if click is still within attribution period
      const program = await this.getProgram(click.programId)
      if (program) {
        const cookieMs = (program.cookieDays || 30) * 86400000
        const clickAge = Date.now() - click.createdAt.getTime()
        if (clickAge > cookieMs) {
          throw new Error(
            `Click ${input.clickId} expired — ${program.cookieDays}-day attribution window exceeded`
          )
        }
      }

      partnerId = click.partnerId

      // Mark click as converted
      await this.db.update(odClicks).set({
        converted: true,
        convertedAt: new Date(),
      }).where(eq(odClicks.id, input.clickId))
    } else if (input.partnerCode) {
      const partner = await this.getPartnerByCode(input.partnerCode)
      if (!partner) throw new Error(`Partner not found: ${input.partnerCode}`)
      partnerId = partner.id
    } else {
      throw new Error('Either clickId or partnerCode is required')
    }

    // Check for duplicate referral
    const existing = await this.db.query.odReferrals.findFirst({
      where: and(
        eq(odReferrals.customerId, input.customerId),
        eq(odReferrals.programId, input.programId),
      ),
    })
    if (existing) return existing // idempotent

    const [referral] = await this.db.insert(odReferrals).values({
      clickId: input.clickId,
      partnerId: partnerId!,
      programId: input.programId,
      customerId: input.customerId,
    }).returning()

    await this.emit('referral.created', { referral })
    return referral
  }

  // ─── Sales + Commission ─────────────────────────────────

  async recordSale(input: RecordSaleInput) {
    // Idempotency check
    if (input.externalId) {
      const existing = await this.db.query.odSales.findFirst({
        where: eq(odSales.externalId, input.externalId),
      })
      if (existing) return { sale: existing, commission: null, created: false }
    }

    // Find referral for this customer
    const referralQuery = input.programId
      ? and(
          eq(odReferrals.customerId, input.customerId),
          eq(odReferrals.programId, input.programId),
        )
      : eq(odReferrals.customerId, input.customerId)

    const referral = await this.db.query.odReferrals.findFirst({
      where: referralQuery,
    })

    // No referral = organic customer, no commission
    if (!referral) return { sale: null, commission: null, created: false }

    // Get program for commission config
    const program = await this.getProgram(referral.programId)
    if (!program) throw new Error(`Program not found: ${referral.programId}`)

    // Atomic: insert sale + calculate commission in one transaction
    const result = await this.db.transaction(async (tx) => {
      // Insert sale
      const [sale] = await tx.insert(odSales).values({
        referralId: referral.id,
        partnerId: referral.partnerId,
        programId: referral.programId,
        customerId: input.customerId,
        amountCents: input.amountCents,
        currency: input.currency || 'usd',
        externalId: input.externalId,
        metadata: input.metadata,
      }).returning()

      // Calculate commission atomically
      const commission = await this.calculateCommission(tx, sale, program)

      return { sale, commission }
    })

    await this.emit('sale.created', { sale: result.sale })
    if (result.commission) {
      await this.emit('commission.created', { commission: result.commission, sale: result.sale })
    }

    return { ...result, created: true }
  }

  private async calculateCommission(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    sale: typeof odSales.$inferSelect,
    program: typeof odPrograms.$inferSelect,
  ) {
    const percent = Number(program.commissionPercent || 0)
    if (percent <= 0 && !program.commissionFixed) return null

    const amountCents = program.commissionFixed
      ? program.commissionFixed
      : Math.round(sale.amountCents * percent / 100)

    if (amountCents <= 0) return null

    const holdUntil = program.holdDays > 0
      ? new Date(Date.now() + program.holdDays * 86400000)
      : null

    // All three writes in one transaction
    const [commission] = await tx.insert(odCommissions).values({
      saleId: sale.id,
      partnerId: sale.partnerId,
      programId: sale.programId,
      saleAmountCents: sale.amountCents,
      commissionPercent: percent.toString(),
      amountCents,
      status: 'pending',
      holdUntil,
    }).returning()

    await tx.insert(odTransactions).values({
      partnerId: sale.partnerId,
      type: 'commission_earned',
      amountCents,
      commissionId: commission.id,
      description: `Commission on sale ${sale.id}`,
    })

    await tx.update(odPartners).set({
      lifetimeEarningsCents: sql`${odPartners.lifetimeEarningsCents} + ${amountCents}`,
      balanceCents: sql`${odPartners.balanceCents} + ${amountCents}`,
      updatedAt: new Date(),
    }).where(eq(odPartners.id, sale.partnerId))

    return commission
  }

  // ─── Commission Management ──────────────────────────────

  async approveCommission(commissionId: string) {
    return this.db.transaction(async (tx) => {
      const [commission] = await tx.update(odCommissions).set({
        status: 'approved',
        approvedAt: new Date(),
      }).where(
        and(
          eq(odCommissions.id, commissionId),
          eq(odCommissions.status, 'pending'),
        )
      ).returning()

      if (!commission) throw new Error(`Commission not found or not pending: ${commissionId}`)

      await tx.insert(odTransactions).values({
        partnerId: commission.partnerId,
        type: 'commission_approved',
        amountCents: 0,
        commissionId: commission.id,
        description: `Commission ${commission.id} approved`,
      })

      await this.emit('commission.approved', { commission })
      return commission
    })
  }

  async rejectCommission(commissionId: string, reason?: string) {
    return this.db.transaction(async (tx) => {
      const commission = await tx.query.odCommissions.findFirst({
        where: eq(odCommissions.id, commissionId),
      })
      if (!commission || commission.status !== 'pending') {
        throw new Error(`Commission not found or not pending: ${commissionId}`)
      }

      const [updated] = await tx.update(odCommissions).set({
        status: 'rejected',
        rejectedAt: new Date(),
        rejectionReason: reason,
      }).where(eq(odCommissions.id, commissionId)).returning()

      await tx.update(odPartners).set({
        balanceCents: sql`${odPartners.balanceCents} - ${commission.amountCents}`,
        lifetimeEarningsCents: sql`${odPartners.lifetimeEarningsCents} - ${commission.amountCents}`,
        updatedAt: new Date(),
      }).where(eq(odPartners.id, commission.partnerId))

      await tx.insert(odTransactions).values({
        partnerId: commission.partnerId,
        type: 'commission_rejected',
        amountCents: -commission.amountCents,
        commissionId: commission.id,
        description: reason || `Commission ${commission.id} rejected`,
      })

      await this.emit('commission.rejected', { commission: updated })
      return updated
    })
  }

  /**
   * Reverse commissions for a refunded sale.
   * All reversals happen in a single transaction.
   */
  async refundSale(externalId: string): Promise<{ reversed: number }> {
    const sale = await this.db.query.odSales.findFirst({
      where: eq(odSales.externalId, externalId),
    })
    if (!sale) return { reversed: 0 }

    const commissions = await this.db.query.odCommissions.findMany({
      where: and(
        eq(odCommissions.saleId, sale.id),
        sql`${odCommissions.status} IN ('pending', 'approved')`,
      ),
    })

    if (commissions.length === 0) return { reversed: 0 }

    const reversed = await this.db.transaction(async (tx) => {
      let count = 0
      for (const commission of commissions) {
        await tx.update(odCommissions).set({
          status: 'rejected',
          rejectedAt: new Date(),
          rejectionReason: 'refund',
        }).where(eq(odCommissions.id, commission.id))

        await tx.update(odPartners).set({
          balanceCents: sql`${odPartners.balanceCents} - ${commission.amountCents}`,
          lifetimeEarningsCents: sql`${odPartners.lifetimeEarningsCents} - ${commission.amountCents}`,
          updatedAt: new Date(),
        }).where(eq(odPartners.id, commission.partnerId))

        await tx.insert(odTransactions).values({
          partnerId: commission.partnerId,
          type: 'commission_rejected',
          amountCents: -commission.amountCents,
          commissionId: commission.id,
          description: `Refund reversal — sale ${sale.externalId}`,
        })

        count++
      }
      return count
    })

    // Events emitted outside transaction
    for (const commission of commissions) {
      await this.emit('commission.rejected', { commission })
    }

    return { reversed }
  }

  async listCommissions(filters: {
    partnerId?: string
    programId?: string
    status?: string
    limit?: number
    offset?: number
  } = {}) {
    const conditions = []
    if (filters.partnerId) conditions.push(eq(odCommissions.partnerId, filters.partnerId))
    if (filters.programId) conditions.push(eq(odCommissions.programId, filters.programId))
    if (filters.status) conditions.push(eq(odCommissions.status, filters.status))

    const where = conditions.length > 0 ? and(...conditions) : undefined

    return this.db.query.odCommissions.findMany({
      where,
      limit: filters.limit || 50,
      offset: filters.offset || 0,
      orderBy: (c, { desc }) => [desc(c.createdAt)],
    })
  }

  // ─── Auto-approve expired hold periods ──────────────────

  async processAutoApprovals() {
    const now = new Date()

    const pending = await this.db
      .select({ commission: odCommissions, program: odPrograms })
      .from(odCommissions)
      .innerJoin(odPrograms, eq(odCommissions.programId, odPrograms.id))
      .where(
        and(
          eq(odCommissions.status, 'pending'),
          eq(odPrograms.autoApprove, true),
          sql`${odCommissions.holdUntil} IS NOT NULL AND ${odCommissions.holdUntil} <= ${now}`,
        )
      )

    const approved = []
    for (const { commission } of pending) {
      const result = await this.approveCommission(commission.id)
      approved.push(result)
    }

    return approved
  }
}
