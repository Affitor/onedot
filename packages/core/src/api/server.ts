import { OneDotEngine } from '../engine.js'
import { createDatabase } from '../db.js'
import type {
  CreateProgramInput,
  CreatePartnerInput,
  TrackClickInput,
  TrackSignupInput,
  RecordSaleInput,
} from '../types.js'

interface ServerConfig {
  databaseUrl: string
  port?: number
  apiKey?: string
}

export function createServer(config: ServerConfig) {
  const db = createDatabase(config.databaseUrl)
  const engine = new OneDotEngine(db)
  const port = config.port || 3456

  function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  function error(message: string, status = 400) {
    return json({ error: message }, status)
  }

  async function parseBody<T = Record<string, unknown>>(req: Request): Promise<T | null> {
    try { return await req.json() as T } catch { return null }
  }

  function checkAuth(req: Request): Response | null {
    if (!config.apiKey) return null
    const auth = req.headers.get('Authorization')
    if (auth !== `Bearer ${config.apiKey}`) {
      return error('Unauthorized', 401)
    }
    return null
  }

  // Use globalThis.Bun for type safety without @types/bun dep
  const BunRuntime = (globalThis as any).Bun
  if (!BunRuntime?.serve) {
    throw new Error('[onedot] Standalone server requires Bun runtime. Use the SDK for Node.js.')
  }

  const server = BunRuntime.serve({
    port,
    async fetch(req: Request) {
      const url = new URL(req.url)
      const path = url.pathname
      const method = req.method

      const authError = checkAuth(req)
      if (authError) return authError

      // ─── Programs ─────────────────────────────────

      if (method === 'POST' && path === '/onedot/programs') {
        const body = await parseBody<CreateProgramInput>(req)
        if (!body?.name) return error('name is required')
        const program = await engine.createProgram(body)
        return json(program, 201)
      }

      if (method === 'GET' && path === '/onedot/programs') {
        const programs = await engine.listPrograms()
        return json(programs)
      }

      if (method === 'GET' && path.startsWith('/onedot/programs/')) {
        const id = path.split('/')[3]
        const program = await engine.getProgram(id)
        if (!program) return error('Program not found', 404)
        return json(program)
      }

      // ─── Partners ─────────────────────────────────

      if (method === 'POST' && path === '/onedot/partners') {
        const body = await parseBody<CreatePartnerInput>(req)
        if (!body?.programId) return error('programId is required')
        const partner = await engine.createPartner(body)
        return json(partner, 201)
      }

      if (method === 'GET' && path === '/onedot/partners') {
        const programId = url.searchParams.get('programId')
        if (!programId) return error('programId query param is required')
        const partners = await engine.listPartners(programId)
        return json(partners)
      }

      if (method === 'GET' && path.match(/^\/onedot\/partners\/[^/]+\/earnings$/)) {
        const id = path.split('/')[3]
        const earnings = await engine.getPartnerEarnings(id)
        if (!earnings) return error('Partner not found', 404)
        return json(earnings)
      }

      if (method === 'GET' && path.startsWith('/onedot/partners/')) {
        const id = path.split('/')[3]
        const partner = await engine.getPartner(id)
        if (!partner) return error('Partner not found', 404)
        return json(partner)
      }

      // ─── Tracking ─────────────────────────────────

      if (method === 'POST' && path === '/onedot/track/click') {
        const body = await parseBody<TrackClickInput>(req)
        if (!body?.partnerCode || !body?.programId) {
          return error('partnerCode and programId are required')
        }
        try {
          const click = await engine.trackClick(body)
          return json(click, 201)
        } catch (e: unknown) {
          return error((e as Error).message)
        }
      }

      if (method === 'POST' && path === '/onedot/track/signup') {
        const body = await parseBody<TrackSignupInput>(req)
        if (!body?.customerId || !body?.programId) {
          return error('customerId and programId are required')
        }
        if (!body.clickId && !body.partnerCode) {
          return error('Either clickId or partnerCode is required')
        }
        try {
          const referral = await engine.trackSignup(body)
          return json(referral, 201)
        } catch (e: unknown) {
          return error((e as Error).message)
        }
      }

      // ─── Sales ────────────────────────────────────

      if (method === 'POST' && path === '/onedot/sales') {
        const body = await parseBody<RecordSaleInput>(req)
        if (!body?.customerId || !body?.amountCents) {
          return error('customerId and amountCents are required')
        }
        try {
          const result = await engine.recordSale(body)
          return json(result, result.created ? 201 : 200)
        } catch (e: unknown) {
          return error((e as Error).message)
        }
      }

      // ─── Commissions ──────────────────────────────

      if (method === 'GET' && path === '/onedot/commissions') {
        const filters = {
          partnerId: url.searchParams.get('partnerId') || undefined,
          programId: url.searchParams.get('programId') || undefined,
          status: url.searchParams.get('status') || undefined,
          limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined,
          offset: url.searchParams.has('offset') ? Number(url.searchParams.get('offset')) : undefined,
        }
        const commissions = await engine.listCommissions(filters)
        return json(commissions)
      }

      if (method === 'POST' && path.match(/^\/onedot\/commissions\/[^/]+\/approve$/)) {
        const id = path.split('/')[3]
        try {
          const commission = await engine.approveCommission(id)
          return json(commission)
        } catch (e: unknown) {
          return error((e as Error).message)
        }
      }

      if (method === 'POST' && path.match(/^\/onedot\/commissions\/[^/]+\/reject$/)) {
        const id = path.split('/')[3]
        const body = await parseBody<{ reason?: string }>(req)
        try {
          const commission = await engine.rejectCommission(id, body?.reason)
          return json(commission)
        } catch (e: unknown) {
          return error((e as Error).message)
        }
      }

      // ─── Auto-approve ─────────────────────────────

      if (method === 'POST' && path === '/onedot/commissions/auto-approve') {
        const approved = await engine.processAutoApprovals()
        return json({ approved: approved.length, commissions: approved })
      }

      // ─── Health ───────────────────────────────────

      if (method === 'GET' && (path === '/onedot/health' || path === '/health')) {
        return json({ status: 'ok', version: '0.1.0' })
      }

      return error('Not found', 404)
    },
  })

  console.log(`[onedot] Server running on http://localhost:${port}`)
  return { server, engine }
}
