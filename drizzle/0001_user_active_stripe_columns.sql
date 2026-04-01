-- Add opt-out/opt-in compliance columns to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "active" boolean NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "opted_out_at" timestamp with time zone;
--> statement-breakpoint

-- Add Stripe payment tracking columns to bookings
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "stripe_session_id" varchar(200);
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "payment_status" varchar(30) DEFAULT 'pending';
