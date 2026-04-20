// ─── Input types (what the client provides) ─────────────────

export interface CreateProgramInput {
  name: string
  slug?: string // auto-generated from name if not provided
  description?: string
  commissionType?: 'cpc' | 'cpl' | 'cps_one_time' | 'cps_recurring' | 'cps_lifetime'
  commissionPercent?: number
  commissionFixed?: number // cents
  cookieDays?: number
  holdDays?: number
  autoApprove?: boolean
}

export interface CreatePartnerInput {
  programId: string
  code?: string // auto-generated if not provided
  name?: string
  email?: string
  metadata?: Record<string, unknown>
}

export interface TrackClickInput {
  partnerCode: string
  programId: string
  ip?: string
  userAgent?: string
  referer?: string
  landingPage?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
}

export interface TrackSignupInput {
  clickId?: string // from cookie
  partnerCode?: string // alternative: resolve partner from code
  programId: string
  customerId: string // your system's user ID
}

export interface RecordSaleInput {
  customerId: string
  amountCents: number
  currency?: string
  externalId?: string // idempotency key (e.g. payment ID, request ID)
  programId?: string // optional if customer only has one referral
  metadata?: Record<string, unknown>
}

// ─── Output types ───────────────────────────────────────────

export interface PartnerEarnings {
  partnerId: string
  partnerCode: string
  partnerName: string | null
  totalEarnedCents: number
  pendingCents: number
  approvedCents: number
  paidCents: number
  totalClicks: number
  totalReferrals: number
  totalSales: number
}

export interface CommissionRecord {
  id: string
  saleId: string
  partnerId: string
  saleAmountCents: number
  commissionPercent: string
  amountCents: number
  status: string
  holdUntil: Date | null
  createdAt: Date
}

// ─── Event types ────────────────────────────────────────────

export type EventType =
  | 'click.created'
  | 'referral.created'
  | 'sale.created'
  | 'commission.created'
  | 'commission.approved'
  | 'commission.rejected'
  | 'commission.paid'
  | 'payout.ready'
  | 'partner.created'

export interface OneDotEvent {
  type: EventType
  data: Record<string, unknown>
  timestamp: Date
}

export type EventListener = (event: OneDotEvent) => void | Promise<void>
