import { z } from 'zod';
import { WHATSAPP } from '../../config/constants.js';
import { formatCurrency } from '../../utils/currency.js';

const dayItemTypeSchema = z.enum([
  'flight', 'hotel', 'experience', 'restaurant', 'transport', 'free_time',
]);

const priceSchema = z.object({
  amount: z.number(),
  currency: z.string().default('USD'),
});

const dayItemSchema = z.object({
  time: z.string(),
  type: dayItemTypeSchema,
  name: z.string(),
  description: z.string().optional(),
  duration_min: z.number().optional(),
  price: priceSchema.optional(),
  booking_url: z.string().optional(),
  maps_url: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  notes: z.string().optional(),
});

const accommodationSchema = z.object({
  name: z.string(),
  check_in: z.boolean().optional(),
  check_out: z.boolean().optional(),
  loyalty_program: z.string().optional(),
  confirmation: z.string().optional(),
  price_per_night: priceSchema.optional(),
});

const dayPlanSchema = z.object({
  date: z.string(),
  day_number: z.number().int().positive(),
  theme: z.string().optional(),
  items: z.array(dayItemSchema).min(1),
  accommodation: accommodationSchema.optional(),
  day_total: priceSchema.optional(),
});

export const tripPlanSchema = z.object({
  days: z.array(dayPlanSchema).min(1),
  overview: z.string().optional(),
  total_budget: priceSchema.optional(),
  packing_tips: z.array(z.string()).optional(),
  important_notes: z.array(z.string()).optional(),
});

/**
 * Lenient schema that accepts common Claude output variations.
 * Tries the strict schema first, then relaxes field-by-field.
 */
const lenientDayItemSchema = z.object({
  time: z.string().default('TBD'),
  type: z.string().default('experience'),
  name: z.string(),
  description: z.string().optional(),
  duration_min: z.number().optional(),
  price: z.any().optional(),
  booking_url: z.string().optional(),
  maps_url: z.string().optional(),
  rating: z.number().optional(),
  notes: z.string().optional(),
});

const lenientDaySchema = z.object({
  date: z.string(),
  day_number: z.coerce.number().int().positive(),
  theme: z.string().optional(),
  items: z.array(lenientDayItemSchema).default([]),
  accommodation: z.any().optional(),
  day_total: z.any().optional(),
});

const lenientTripSchema = z.object({
  days: z.array(lenientDaySchema).min(1),
  overview: z.string().optional(),
  total_budget: z.any().optional(),
  packing_tips: z.array(z.string()).optional(),
  important_notes: z.array(z.string()).optional(),
});

export { lenientTripSchema };

export type ValidatedTripPlan = z.infer<typeof tripPlanSchema>;
export type ValidatedDayPlan = z.infer<typeof dayPlanSchema>;

/**
 * Validate and parse Claude's trip plan JSON output.
 * Returns the parsed plan on success, or null with errors.
 */
export function validateTripPlan(
  raw: unknown,
): { success: true; plan: ValidatedTripPlan } | { success: false; errors: string[] } {
  // Try strict schema first
  const result = tripPlanSchema.safeParse(raw);
  if (result.success) {
    return { success: true, plan: result.data };
  }

  // Try lenient schema — accepts looser types, coerces day_number, relaxes URLs
  const lenient = lenientTripSchema.safeParse(raw);
  if (lenient.success && lenient.data.days.length > 0) {
    return { success: true, plan: lenient.data as unknown as ValidatedTripPlan };
  }

  return {
    success: false,
    errors: result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`,
    ),
  };
}

const ITEM_EMOJI: Record<string, string> = {
  flight: '✈️', hotel: '🏨', experience: '🎭',
  restaurant: '🍽️', transport: '🚕', free_time: '🌴',
};

/**
 * Format a validated trip plan for WhatsApp, respecting character limits.
 * Splits into per-day messages if the full plan would exceed limits.
 */
export function formatForWhatsApp(plan: ValidatedTripPlan): string[] {
  const messages: string[] = [];

  if (plan.overview) {
    const header = [
      '🗺️ *Your Trip Plan*',
      '',
      plan.overview,
    ];
    if (plan.total_budget) {
      header.push('');
      header.push(`💰 Estimated total: ${formatCurrency(plan.total_budget.amount, plan.total_budget.currency)}`);
    }
    messages.push(header.join('\n'));
  }

  for (const day of plan.days) {
    const dayMsg = formatDayForWhatsApp(day, plan.days.length);
    messages.push(dayMsg);
  }

  if (plan.packing_tips && plan.packing_tips.length > 0) {
    const tips = [
      '🎒 *Packing Tips*',
      '',
      ...plan.packing_tips.map((t) => `• ${t}`),
    ].join('\n');
    messages.push(tips.slice(0, WHATSAPP.MAX_MESSAGE_LENGTH));
  }

  if (plan.important_notes && plan.important_notes.length > 0) {
    const notes = [
      '⚠️ *Important Notes*',
      '',
      ...plan.important_notes.map((n) => `• ${n}`),
    ].join('\n');
    messages.push(notes.slice(0, WHATSAPP.MAX_MESSAGE_LENGTH));
  }

  return messages;
}

function formatDayForWhatsApp(day: ValidatedDayPlan, totalDays: number): string {
  const lines: string[] = [];

  lines.push(
    `📍 *Day ${day.day_number} of ${totalDays}: ${day.date}${day.theme ? ` — ${day.theme}` : ''}*`,
  );
  lines.push('');

  for (const item of day.items) {
    const emoji = ITEM_EMOJI[item.type] || '📌';
    const priceStr = item.price
      ? ` (${formatCurrency(item.price.amount, item.price.currency)})`
      : '';
    const durationStr = item.duration_min
      ? ` · ${formatDuration(item.duration_min)}`
      : '';
    lines.push(`${emoji} ${item.time} — ${item.name}${durationStr}${priceStr}`);
  }

  if (day.accommodation) {
    lines.push('');
    const loyaltyStr = day.accommodation.loyalty_program
      ? ` (${day.accommodation.loyalty_program} ✨)`
      : '';
    lines.push(`🏨 Staying at: ${day.accommodation.name}${loyaltyStr}`);
  }

  if (day.day_total) {
    lines.push('');
    lines.push(`Day total: ~${formatCurrency(day.day_total.amount, day.day_total.currency)} per person`);
  }

  const result = lines.join('\n');
  return result.slice(0, WHATSAPP.MAX_MESSAGE_LENGTH);
}

function formatDuration(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h}h${m}m` : `${h}h`;
  }
  return `${minutes}m`;
}

/**
 * Build a stricter prompt addendum to guide Claude when initial output was invalid.
 */
export function buildStrictPlanPrompt(errors: string[]): string {
  return [
    'Your previous trip plan output had validation errors. Please fix and return valid JSON.',
    '',
    'Errors found:',
    ...errors.map((e) => `- ${e}`),
    '',
    'Required structure: { days: [{ date: string, day_number: number, theme?: string, items: [{ time: string, type: "flight"|"hotel"|"experience"|"restaurant"|"transport"|"free_time", name: string, price?: { amount: number, currency: string }, duration_min?: number, booking_url?: string, maps_url?: string }], accommodation?: { name: string, loyalty_program?: string }, day_total?: { amount: number, currency: string } }], overview?: string, total_budget?: { amount: number, currency: string }, packing_tips?: string[], important_notes?: string[] }',
    '',
    'Return ONLY the corrected JSON object, no other text.',
  ].join('\n');
}
