import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  APP_URL: z.string().url(),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-'),

  TWILIO_ACCOUNT_SID: z.string().startsWith('AC'),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_WHATSAPP_NUMBER: z.string().startsWith('+'),

  BROWSERBASE_API_KEY: z.string().min(1),
  BROWSERBASE_PROJECT_ID: z.string().min(1),

  GOOGLE_MAPS_API_KEY: z.string().min(1),
  AMADEUS_CLIENT_ID: z.string().min(1),
  AMADEUS_CLIENT_SECRET: z.string().min(1),
  BRAVE_SEARCH_API_KEY: z.string().min(1),

  TWO_CAPTCHA_API_KEY: z.string().optional(),

  VOYAGE_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

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
