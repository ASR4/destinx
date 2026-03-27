import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_URL: z.string().default('http://localhost:3000'),

  // Core infra — required
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  // AI — required for conversations, optional for boot
  ANTHROPIC_API_KEY: z.string().optional(),

  // WhatsApp — optional for local testing without Twilio
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_NUMBER: z.string().default('+14155238886'),

  // Browser automation — optional
  BROWSERBASE_API_KEY: z.string().optional(),
  BROWSERBASE_PROJECT_ID: z.string().optional(),

  // Search APIs — optional (features degrade gracefully)
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  AMADEUS_CLIENT_ID: z.string().optional(),
  AMADEUS_CLIENT_SECRET: z.string().optional(),
  BRAVE_SEARCH_API_KEY: z.string().optional(),

  TWO_CAPTCHA_API_KEY: z.string().optional(),

  VOYAGE_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  OPENWEATHERMAP_API_KEY: z.string().optional(),

  HEALTH_CHECK_API_KEY: z.string().optional(),

  CLOUDFLARE_R2_ACCESS_KEY: z.string().optional(),
  CLOUDFLARE_R2_SECRET_KEY: z.string().optional(),
  CLOUDFLARE_R2_BUCKET: z.string().default('travel-agent'),
  CLOUDFLARE_R2_ENDPOINT: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function loadEnv(): Env {
  if (_env) return _env;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }
  _env = result.data;
  return _env;
}

export function getEnv(): Env {
  if (!_env) return loadEnv();
  return _env;
}
