import type { DayPlan, DayItem, Itinerary } from '../../types/trip.js';

const TYPE_EMOJI: Record<string, string> = {
  flight: '✈️',
  hotel: '🏨',
  experience: '🎭',
  restaurant: '🍽️',
  transport: '🚗',
  free_time: '🌅',
};

/**
 * Format a single day as a WhatsApp message.
 * Uses *bold* and _italic_ which render in WhatsApp.
 */
export function formatDayPlan(day: DayPlan): string {
  const dateLabel = day.date ? formatDate(day.date) : `Day ${day.day_number}`;
  const lines: string[] = [];

  lines.push(`*Day ${day.day_number} — ${dateLabel}*`);
  if (day.theme) lines.push(`_${day.theme}_`);
  lines.push('');

  for (const item of day.items) {
    lines.push(formatDayItem(item));
    lines.push('');
  }

  if (day.accommodation) {
    const acc = day.accommodation;
    const verb = acc.check_in ? '🔑 Check-in' : acc.check_out ? '👋 Check-out' : null;
    if (verb) {
      lines.push(`${verb} · *${acc.name}*`);
      if (acc.loyalty_program) lines.push(`  💎 ${acc.loyalty_program} points eligible`);
      lines.push('');
    }
  }

  if (day.day_total) {
    lines.push(`💰 Est. day spend: ${formatPrice(day.day_total.amount, day.day_total.currency)}`);
  }

  return lines.join('\n').trimEnd();
}

function formatDayItem(item: DayItem): string {
  const emoji = TYPE_EMOJI[item.type] ?? '📍';
  const time = item.time ? `${item.time} · ` : '';
  const lines: string[] = [];

  lines.push(`${emoji} ${time}*${item.name}*`);

  if (item.description) lines.push(`  ${item.description}`);

  const meta: string[] = [];
  if (item.duration_min) {
    const h = Math.floor(item.duration_min / 60);
    const m = item.duration_min % 60;
    meta.push(`⏱ ${h > 0 ? `${h}h` : ''}${m > 0 ? `${m}m` : ''}`);
  }
  if (item.rating) meta.push(`⭐ ${item.rating}`);
  if (item.price) meta.push(`~${formatPrice(item.price.amount, item.price.currency)}/person`);
  if (meta.length) lines.push(`  ${meta.join(' · ')}`);

  return lines.join('\n');
}

/**
 * Format the plan overview — sent before the day-by-day messages.
 */
export function formatPlanOverview(plan: Itinerary, destination: string): string {
  const lines: string[] = [];

  lines.push(`🗺️ *Your ${destination} Itinerary*`);
  lines.push(`${plan.days.length} days · ${Math.max(plan.days.length - 1, 1)} nights`);

  if (plan.overview) {
    lines.push('');
    lines.push(plan.overview);
  }

  if (plan.packing_tips?.length) {
    lines.push('');
    lines.push('🧳 *Packing tips:*');
    for (const tip of plan.packing_tips) lines.push(`• ${tip}`);
  }

  if (plan.important_notes?.length) {
    lines.push('');
    lines.push('📌 *Good to know:*');
    for (const note of plan.important_notes) lines.push(`• ${note}`);
  }

  return lines.join('\n');
}

/**
 * Final message after all days are sent — prompts the user to act.
 */
export function formatPlanActions(dayCount: number): string {
  return [
    `That's your *${dayCount}-day plan* above! 🎉`,
    '',
    'What would you like to do?',
    '',
    '❤️  Reply *LOVE IT* to start booking',
    '✏️  Reply *CHANGE [what]* to modify something',
    `🔁  Reply *DAY 1* (or any day up to ${dayCount}) to see it again`,
  ].join('\n');
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return dateStr;
  }
}

function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}
