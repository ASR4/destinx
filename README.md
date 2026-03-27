# Destinx — AI Travel Agent

WhatsApp-first, browser-automation-powered, memory-driven travel agent.

## Quick Start

```bash
cp .env.example .env
# Fill in your API keys in .env

npm install
npm run dev
```

## Architecture

- **Runtime**: Node.js 20+ / TypeScript / Fastify
- **Database**: PostgreSQL 16 + pgvector
- **Queue**: BullMQ on Redis
- **AI**: Anthropic Claude (conversation + planning)
- **WhatsApp**: Twilio Business API
- **Browser Automation**: Browserbase + Stagehand

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled output |
| `npm run db:generate` | Generate DB migrations |
| `npm run db:migrate` | Run DB migrations |
| `npm run db:push` | Push schema directly (dev) |
| `npm run db:studio` | Open Drizzle Studio |
