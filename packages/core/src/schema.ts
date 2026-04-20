import {
  pgTable,
  text,
  integer,
  decimal,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { nanoid } from 'nanoid'

// Helper: generate prefixed IDs
const prefixedId = (prefix: string) => () => `${prefix}_${nanoid(16)}`

// ─── Programs ───────────────────────────────────────────────

export const odPrograms = pgTable('od_programs', {
  id: text('id').primaryKey().$defaultFn(prefixedId('prg')),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),

  // Commission defaults
  commissionType: text('commission_type').notNull().default('cps_recurring'),
  // cpc | cpl | cps_one_time | cps_recurring | cps_lifetime
  commissionPercent: decimal('commission_percent', { precision: 8, scale: 4 }),
  commissionFixed: integer('commission_fixed'), // cents

  // Attribution
  cookieDays: integer('cookie_days').notNull().default(30),

  // Approval
  holdDays: integer('hold_days').notNull().default(14),
  autoApprove: boolean('auto_approve').notNull().default(true),

  // Status
  active: boolean('active').notNull().default(true),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Partners ───────────────────────────────────────────────

export const odPartners = pgTable('od_partners', {
  id: text('id').primaryKey().$defaultFn(prefixedId('ptr')),
  code: text('code').notNull().unique(), // unique referral code
  name: text('name'),
  email: text('email'),

  // Program membership
  programId: text('program_id').notNull().references(() => odPrograms.id),

  // Financials
  balanceCents: integer('balance_cents').notNull().default(0), // pending earnings
  paidCents: integer('paid_cents').notNull().default(0), // total paid out
  lifetimeEarningsCents: integer('lifetime_earnings_cents').notNull().default(0),

  // Status
  active: boolean('active').notNull().default(true),

  // Metadata
  metadata: jsonb('metadata'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('od_partners_program_idx').on(table.programId),
  index('od_partners_email_idx').on(table.email),
])

// ─── Clicks ─────────────────────────────────────────────────

export const odClicks = pgTable('od_clicks', {
  id: text('id').primaryKey().$defaultFn(prefixedId('clk')),
  partnerId: text('partner_id').notNull().references(() => odPartners.id),
  programId: text('program_id').notNull().references(() => odPrograms.id),

  // Attribution data
  ip: text('ip'),
  userAgent: text('user_agent'),
  referer: text('referer'),
  landingPage: text('landing_page'),
  utmSource: text('utm_source'),
  utmMedium: text('utm_medium'),
  utmCampaign: text('utm_campaign'),

  // Conversion tracking
  converted: boolean('converted').notNull().default(false),
  convertedAt: timestamp('converted_at'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('od_clicks_partner_idx').on(table.partnerId),
  index('od_clicks_created_idx').on(table.createdAt),
])

// ─── Referrals (click → customer link) ──────────────────────

export const odReferrals = pgTable('od_referrals', {
  id: text('id').primaryKey().$defaultFn(prefixedId('ref')),
  clickId: text('click_id').references(() => odClicks.id),
  partnerId: text('partner_id').notNull().references(() => odPartners.id),
  programId: text('program_id').notNull().references(() => odPrograms.id),

  // Customer identity (your system's user ID)
  customerId: text('customer_id').notNull(),

  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('od_referrals_customer_program_idx').on(table.customerId, table.programId),
  index('od_referrals_partner_idx').on(table.partnerId),
])

// ─── Sales ──────────────────────────────────────────────────

export const odSales = pgTable('od_sales', {
  id: text('id').primaryKey().$defaultFn(prefixedId('sal')),
  referralId: text('referral_id').notNull().references(() => odReferrals.id),
  partnerId: text('partner_id').notNull().references(() => odPartners.id),
  programId: text('program_id').notNull().references(() => odPrograms.id),
  customerId: text('customer_id').notNull(),

  // Money
  amountCents: integer('amount_cents').notNull(), // gross sale in cents
  currency: text('currency').notNull().default('usd'),

  // Idempotency
  externalId: text('external_id').unique(), // your payment/request ID

  // Metadata
  metadata: jsonb('metadata'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('od_sales_partner_idx').on(table.partnerId),
  index('od_sales_customer_idx').on(table.customerId),
  index('od_sales_created_idx').on(table.createdAt),
])

// ─── Commissions ────────────────────────────────────────────

export const odCommissions = pgTable('od_commissions', {
  id: text('id').primaryKey().$defaultFn(prefixedId('com')),
  saleId: text('sale_id').notNull().references(() => odSales.id),
  partnerId: text('partner_id').notNull().references(() => odPartners.id),
  programId: text('program_id').notNull().references(() => odPrograms.id),

  // Calculation
  saleAmountCents: integer('sale_amount_cents').notNull(),
  commissionPercent: decimal('commission_percent', { precision: 8, scale: 4 }).notNull(),
  amountCents: integer('amount_cents').notNull(), // commission earned

  // Lifecycle: pending → approved → paid | rejected
  status: text('status').notNull().default('pending'),
  // pending | approved | rejected | paid

  // Hold period
  holdUntil: timestamp('hold_until'),
  approvedAt: timestamp('approved_at'),
  rejectedAt: timestamp('rejected_at'),
  paidAt: timestamp('paid_at'),
  rejectionReason: text('rejection_reason'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('od_commissions_partner_idx').on(table.partnerId),
  index('od_commissions_status_idx').on(table.status),
  index('od_commissions_hold_idx').on(table.holdUntil),
])

// ─── Transactions (double-entry ledger) ─────────────────────

export const odTransactions = pgTable('od_transactions', {
  id: text('id').primaryKey().$defaultFn(prefixedId('txn')),
  partnerId: text('partner_id').notNull().references(() => odPartners.id),

  // Type: commission_earned | commission_approved | payout | adjustment
  type: text('type').notNull(),
  amountCents: integer('amount_cents').notNull(), // positive = credit, negative = debit

  // Reference
  commissionId: text('commission_id').references(() => odCommissions.id),
  description: text('description'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('od_transactions_partner_idx').on(table.partnerId),
  index('od_transactions_type_idx').on(table.type),
])

// ─── Webhook Events (outbound delivery log) ─────────────────

export const odWebhookEvents = pgTable('od_webhook_events', {
  id: text('id').primaryKey().$defaultFn(prefixedId('evt')),
  type: text('type').notNull(), // click.created, sale.created, commission.approved, etc.
  payload: jsonb('payload').notNull(),
  deliveredAt: timestamp('delivered_at'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('od_webhook_events_type_idx').on(table.type),
])

// ─── Relations ──────────────────────────────────────────────

export const programRelations = relations(odPrograms, ({ many }) => ({
  partners: many(odPartners),
  clicks: many(odClicks),
  referrals: many(odReferrals),
  sales: many(odSales),
  commissions: many(odCommissions),
}))

export const partnerRelations = relations(odPartners, ({ one, many }) => ({
  program: one(odPrograms, {
    fields: [odPartners.programId],
    references: [odPrograms.id],
  }),
  clicks: many(odClicks),
  referrals: many(odReferrals),
  sales: many(odSales),
  commissions: many(odCommissions),
  transactions: many(odTransactions),
}))

export const clickRelations = relations(odClicks, ({ one, many }) => ({
  partner: one(odPartners, {
    fields: [odClicks.partnerId],
    references: [odPartners.id],
  }),
  program: one(odPrograms, {
    fields: [odClicks.programId],
    references: [odPrograms.id],
  }),
  referrals: many(odReferrals),
}))

export const referralRelations = relations(odReferrals, ({ one, many }) => ({
  click: one(odClicks, {
    fields: [odReferrals.clickId],
    references: [odClicks.id],
  }),
  partner: one(odPartners, {
    fields: [odReferrals.partnerId],
    references: [odPartners.id],
  }),
  program: one(odPrograms, {
    fields: [odReferrals.programId],
    references: [odPrograms.id],
  }),
  sales: many(odSales),
}))

export const saleRelations = relations(odSales, ({ one, many }) => ({
  referral: one(odReferrals, {
    fields: [odSales.referralId],
    references: [odReferrals.id],
  }),
  partner: one(odPartners, {
    fields: [odSales.partnerId],
    references: [odPartners.id],
  }),
  program: one(odPrograms, {
    fields: [odSales.programId],
    references: [odPrograms.id],
  }),
  commissions: many(odCommissions),
}))

export const commissionRelations = relations(odCommissions, ({ one, many }) => ({
  sale: one(odSales, {
    fields: [odCommissions.saleId],
    references: [odSales.id],
  }),
  partner: one(odPartners, {
    fields: [odCommissions.partnerId],
    references: [odPartners.id],
  }),
  program: one(odPrograms, {
    fields: [odCommissions.programId],
    references: [odPrograms.id],
  }),
  transactions: many(odTransactions),
}))

export const transactionRelations = relations(odTransactions, ({ one }) => ({
  partner: one(odPartners, {
    fields: [odTransactions.partnerId],
    references: [odPartners.id],
  }),
  commission: one(odCommissions, {
    fields: [odTransactions.commissionId],
    references: [odCommissions.id],
  }),
}))
