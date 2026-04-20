# OneDot

The open-source partnership engine. Track clicks, attribute conversions, calculate commissions, manage partners.

Every partner network starts with one dot.

## Install

```bash
npm install @one-dot/sdk
```

Requires PostgreSQL. OneDot creates tables prefixed with `od_` in your existing database.

## Quick start

### 1. Initialize + migrate

```typescript
import { OneDot } from '@one-dot/sdk'

const onedot = new OneDot({
  databaseUrl: process.env.DATABASE_URL,
})

// Creates od_* tables if they don't exist (idempotent, safe to call every startup)
await onedot.migrate()
```

Or use the CLI:

```bash
# Run migrations
DATABASE_URL=postgres://... npx onedot migrate

# Preview SQL without executing
DATABASE_URL=postgres://... npx onedot migrate --dry-run

# Check migration status
DATABASE_URL=postgres://... npx onedot migrate --status

# Adopt existing tables (if you ran SQL manually before)
DATABASE_URL=postgres://... npx onedot migrate --adopt
```

Migration behavior is configurable:

```typescript
const onedot = new OneDot({
  databaseUrl: process.env.DATABASE_URL,
  migrate: 'auto',    // auto-migrate on first use (default in dev)
  // migrate: 'manual',  // throw if tables missing (default in production)
  // migrate: 'skip',    // don't check
})
```

### 2. Create a program

```typescript
const program = await onedot.programs.create({
  name: 'My Partner Program',
  commissionType: 'cps_recurring', // % of each sale, recurring
  commissionPercent: 20,
  cookieDays: 30,        // attribution window
  holdDays: 14,          // days before auto-approve
})

// Save program.id — you'll need it for tracking
```

### 4. Register a partner

```typescript
const partner = await onedot.partners.create({
  programId: program.id,
  name: 'Alice',
  email: 'alice@example.com',
  // code is auto-generated, or pass your own:
  // code: 'alice',
})

// Partner's referral link: https://yoursite.com/?ref=alice
```

## Integration (4 touch points)

OneDot has exactly 4 integration points in your codebase. Everything else (commission calculation, hold periods, auto-approval) happens automatically.

### Touch point 1: Track clicks

When a visitor arrives with a `?ref=` parameter, record the click and set a cookie.

```typescript
// In your landing page or middleware
export async function GET(req: Request) {
  const url = new URL(req.url)
  const ref = url.searchParams.get('ref')

  if (ref) {
    const click = await onedot.track.click({
      partnerCode: ref,
      programId: PROGRAM_ID,
      ip: req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
      referer: req.headers.get('referer') || undefined,
      landingPage: url.pathname,
    })

    // Set cookie for attribution
    const response = new Response(null, { status: 302, headers: { Location: '/' } })
    response.headers.set('Set-Cookie', `od_ref=${click.id}; Max-Age=${30 * 86400}; Path=/; HttpOnly; SameSite=Lax`)
    return response
  }
}
```

### Touch point 2: Link signups

When a referred visitor creates an account, link them to the referral.

```typescript
// In your signup handler, after creating the user
const clickId = getCookie(req, 'od_ref')

if (clickId) {
  await onedot.track.signup({
    clickId,
    programId: PROGRAM_ID,
    customerId: newUser.id, // your system's user ID
  })
}
```

This is idempotent — calling it twice for the same customer+program does nothing.

### Touch point 3: Record sales

When a referred customer makes a **purchase** (payment, subscription, credit top-up), record the sale. Commission is calculated automatically.

```typescript
// In your Stripe webhook handler (or any payment callback)
// This runs when a customer PAYS — not when they use/consume.

case 'checkout.session.completed': {
  const session = event.data.object
  const userId = session.metadata.user_id

  const { sale, commission, created } = await onedot.sales.record({
    customerId: userId,
    amountCents: session.amount_total,    // what they paid
    currency: session.currency,
    externalId: session.payment_intent,   // idempotency key
  })

  // commission is null if the customer wasn't referred
  // commission.amountCents = 400 (20% of $20.00 purchase)
  break
}
```

Commission is on **purchases**, not on usage. A customer buying $20 in credits generates a $4 commission. What they do with those credits afterwards is irrelevant.

### Touch point 4: Show earnings

Display partner earnings on your dashboard.

```typescript
const earnings = await onedot.partners.earnings(partnerId)

// Returns:
// {
//   partnerId: 'ptr_abc123',
//   partnerCode: 'alice',
//   partnerName: 'Alice',
//   totalEarnedCents: 12500,    // $125.00 lifetime
//   pendingCents: 3000,         // $30.00 awaiting approval
//   approvedCents: 7500,        // $75.00 approved
//   paidCents: 2000,            // $20.00 paid out
//   totalClicks: 340,
//   totalReferrals: 28,
//   totalSales: 156,
// }
```

## Commission management

### Auto-approval

Commissions are auto-approved after the hold period (default 14 days). Run this periodically (e.g., daily cron):

```typescript
const approved = await onedot.processAutoApprovals()
console.log(`Auto-approved ${approved.length} commissions`)
```

### Manual approval/rejection

```typescript
await onedot.commissions.approve('com_abc123')

await onedot.commissions.reject('com_abc123', 'Fraudulent activity')
// Reverses the partner's balance automatically
```

### List commissions

```typescript
const pending = await onedot.commissions.list({
  status: 'pending',
  programId: PROGRAM_ID,
  limit: 50,
})
```

## Events

Subscribe to real-time events for notifications, analytics, or custom logic.

```typescript
onedot.on('commission.created', async (event) => {
  console.log(`Partner earned $${event.data.commission.amountCents / 100}`)
})

onedot.on('partner.created', async (event) => {
  // Send welcome email
})

// Listen to all events
onedot.on('*', async (event) => {
  console.log(`[onedot] ${event.type}`, event.data)
})
```

Available events:

| Event | When |
|-------|------|
| `click.created` | Partner referral link clicked |
| `referral.created` | Customer linked to partner |
| `sale.created` | Sale recorded for referred customer |
| `commission.created` | Commission calculated |
| `commission.approved` | Commission approved (manual or auto) |
| `commission.rejected` | Commission rejected, balance reversed |
| `partner.created` | New partner registered |

## REST API

OneDot also exposes a REST API for use from non-Node environments or as a standalone service.

```typescript
import { createServer } from '@one-dot/core/api/server'

const { server, engine } = createServer({
  databaseUrl: process.env.DATABASE_URL,
  port: 3456,
  apiKey: process.env.ONEDOT_API_KEY, // optional
})
```

### Endpoints

```
POST   /onedot/programs                       Create program
GET    /onedot/programs                        List programs
GET    /onedot/programs/:id                    Get program

POST   /onedot/partners                        Register partner
GET    /onedot/partners?programId=X            List partners
GET    /onedot/partners/:id                    Get partner
GET    /onedot/partners/:id/earnings           Get earnings

POST   /onedot/track/click                     Record click
POST   /onedot/track/signup                    Link signup to referral

POST   /onedot/sales                           Record sale (auto-commission)

GET    /onedot/commissions?status=pending      List commissions
POST   /onedot/commissions/:id/approve         Approve commission
POST   /onedot/commissions/:id/reject          Reject commission
POST   /onedot/commissions/auto-approve        Process hold period expirations

GET    /onedot/health                          Health check
```

All endpoints accept and return JSON. Auth via `Authorization: Bearer <api_key>` header (if configured).

## Database

OneDot creates these tables in your database (all prefixed `od_` to avoid conflicts):

| Table | Purpose |
|-------|---------|
| `od_programs` | Partnership programs with commission config |
| `od_partners` | Partner accounts with referral codes |
| `od_clicks` | Click events with attribution data |
| `od_referrals` | Customer-to-partner links |
| `od_sales` | Sale events |
| `od_commissions` | Calculated commissions with lifecycle status |
| `od_transactions` | Double-entry ledger (every money movement) |
| `od_webhook_events` | Outbound event delivery log |

## Architecture

```
Your app
  │
  ├── Track click     →  od_clicks
  ├── Link signup     →  od_referrals (click → customer)
  ├── Record sale     →  od_sales → od_commissions (auto-calculated)
  │                                → od_transactions (ledger entry)
  ���── Query earnings  ←  aggregated from od_commissions
```

OneDot runs in-process. No separate service, no external calls, no network overhead. Just your app and your database.

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `commissionType` | `cps_recurring` | `cpc`, `cpl`, `cps_one_time`, `cps_recurring`, `cps_lifetime` |
| `commissionPercent` | — | Percentage of sale (e.g., `20` = 20%) |
| `commissionFixed` | — | Fixed amount in cents (overrides percent) |
| `cookieDays` | `30` | Attribution window in days |
| `holdDays` | `14` | Days before auto-approval |
| `autoApprove` | `true` | Auto-approve after hold period |

## License

[MIT](./LICENSE). Use it however you want.

---

Built by the team behind [Affitor](https://affitor.com).
