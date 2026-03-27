import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { sql } from 'drizzle-orm';
import { logger } from '../utils/logger.js';

interface DependencyHealth {
  status: 'ok' | 'degraded' | 'down';
  latencyMs: number;
  error?: string;
}

interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  uptime: number;
  dependencies: Record<string, DependencyHealth>;
}

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.status(200).send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  app.get('/health/detailed', async (request: FastifyRequest, reply: FastifyReply) => {
    const apiKey = (request.headers['x-api-key'] ?? '') as string;
    const expectedKey = process.env.HEALTH_CHECK_API_KEY;
    if (expectedKey && apiKey !== expectedKey) {
      reply.status(401).send({ error: 'Unauthorized' });
      return;
    }

    const [postgres, redis, anthropic, twilio, browserbase] = await Promise.all([
      checkPostgres(),
      checkRedis(),
      checkAnthropic(),
      checkTwilio(),
      checkBrowserbase(),
    ]);

    const deps: Record<string, DependencyHealth> = {
      postgres, redis, anthropic, twilio, browserbase,
    };

    const criticalDown = postgres.status === 'down' || redis.status === 'down';
    const anyDegraded = Object.values(deps).some((d) => d.status !== 'ok');

    const overallStatus = criticalDown ? 'down' : anyDegraded ? 'degraded' : 'ok';

    const response: HealthResponse = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      dependencies: deps,
    };

    reply.status(criticalDown ? 503 : 200).send(response);
  });
}

async function checkCriticalDeps() {
  const [postgres, redis] = await Promise.all([checkPostgres(), checkRedis()]);
  return { postgres, redis };
}

async function checkPostgres(): Promise<DependencyHealth> {
  const start = Date.now();
  try {
    const { getDb } = await import('../db/client.js');
    const db = getDb();
    await db.execute(sql`SELECT 1`);
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    return { status: 'down', latencyMs: Date.now() - start, error: String(err) };
  }
}

async function checkRedis(): Promise<DependencyHealth> {
  const start = Date.now();
  try {
    const { Redis } = await import('ioredis');
    const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true, connectTimeout: 3000 });
    await redis.ping();
    await redis.quit();
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    return { status: 'down', latencyMs: Date.now() - start, error: String(err) };
  }
}

async function checkAnthropic(): Promise<DependencyHealth> {
  const start = Date.now();
  try {
    const { getAnthropicClient } = await import('../ai/client.js');
    const client = getAnthropicClient();
    await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    return { status: 'degraded', latencyMs: Date.now() - start, error: String(err) };
  }
}

async function checkTwilio(): Promise<DependencyHealth> {
  const start = Date.now();
  try {
    const Twilio = (await import('twilio')).default;
    const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const account = await client.api.accounts(process.env.TWILIO_ACCOUNT_SID!).fetch();
    const status = account.status === 'active' ? 'ok' : 'degraded';
    return { status, latencyMs: Date.now() - start };
  } catch (err) {
    return { status: 'degraded', latencyMs: Date.now() - start, error: String(err) };
  }
}

async function checkBrowserbase(): Promise<DependencyHealth> {
  const start = Date.now();
  try {
    const Browserbase = (await import('@browserbasehq/sdk')).default;
    const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! });
    await bb.sessions.list();
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    return { status: 'degraded', latencyMs: Date.now() - start, error: String(err) };
  }
}
