/**
 * OneDot smoke test — run with:
 *   DATABASE_URL=postgres://... bun run test.ts
 *
 * Tests the full flow: program → partner → click → signup → sale → commission
 */

import { OneDot } from './packages/sdk/src/index.js'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const onedot = new OneDot({ databaseUrl: DATABASE_URL })

// Listen to all events
onedot.on('*', (event) => {
  console.log(`  [event] ${event.type}`)
})

async function main() {
  console.log('\n--- OneDot Smoke Test ---\n')

  // 1. Create program
  console.log('1. Creating program...')
  const program = await onedot.programs.create({
    name: 'Kyma Partners',
    commissionType: 'cps_recurring',
    commissionPercent: 20,
    cookieDays: 30,
    holdDays: 14,
  })
  console.log(`   Program: ${program.id} (${program.name})`)

  // 2. Register partner
  console.log('\n2. Registering partner...')
  const partner = await onedot.partners.create({
    programId: program.id,
    name: 'Alice',
    email: 'alice@example.com',
    code: 'alice',
  })
  console.log(`   Partner: ${partner.id} (code: ${partner.code})`)

  // 3. Track click (visitor arrives via ?ref=alice)
  console.log('\n3. Tracking click...')
  const click = await onedot.track.click({
    partnerCode: 'alice',
    programId: program.id,
    ip: '1.2.3.4',
    userAgent: 'Mozilla/5.0',
    landingPage: '/',
  })
  console.log(`   Click: ${click.id}`)

  // 4. Customer signs up (link to referral)
  console.log('\n4. Linking signup...')
  const customerId = 'user_' + Date.now()
  const referral = await onedot.track.signup({
    clickId: click.id,
    programId: program.id,
    customerId,
  })
  console.log(`   Referral: ${referral.id} (customer: ${customerId})`)

  // 5. Customer makes purchases (API usage)
  console.log('\n5. Recording sales...')
  for (let i = 1; i <= 3; i++) {
    const { sale, commission, created } = await onedot.sales.record({
      customerId,
      amountCents: 500, // $5.00
      externalId: `req_${Date.now()}_${i}`,
    })
    if (sale && commission) {
      console.log(`   Sale ${i}: $${sale.amountCents / 100} → commission $${commission.amountCents / 100} (${commission.status})`)
    } else {
      console.log(`   Sale ${i}: no commission (organic or duplicate)`)
    }
  }

  // 6. Check earnings
  console.log('\n6. Partner earnings...')
  const earnings = await onedot.partners.earnings(partner.id)
  if (earnings) {
    console.log(`   Total earned: $${earnings.totalEarnedCents / 100}`)
    console.log(`   Pending:      $${earnings.pendingCents / 100}`)
    console.log(`   Clicks:       ${earnings.totalClicks}`)
    console.log(`   Referrals:    ${earnings.totalReferrals}`)
    console.log(`   Sales:        ${earnings.totalSales}`)
  }

  // 7. List commissions
  console.log('\n7. Commissions...')
  const commissions = await onedot.commissions.list({ partnerId: partner.id })
  for (const c of commissions) {
    console.log(`   ${c.id}: $${c.amountCents / 100} (${c.status})`)
  }

  // 8. Approve one commission
  if (commissions.length > 0) {
    console.log('\n8. Approving first commission...')
    const approved = await onedot.commissions.approve(commissions[0].id)
    console.log(`   ${approved.id}: ${approved.status}`)
  }

  console.log('\n--- Done ---\n')
  process.exit(0)
}

main().catch((e) => {
  console.error('Error:', e.message)
  process.exit(1)
})
