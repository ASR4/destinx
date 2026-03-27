/**
 * Parse a variety of human-friendly date strings into YYYY-MM-DD.
 * Handles: "April 15", "4/15/2026", "2026-04-15", "next friday", etc.
 * For now, only handles ISO and common US formats. Expand with a library
 * like chrono-node for natural language parsing.
 */
export function parseFlexibleDate(input: string): string | null {
  const isoMatch = input.match(/^\d{4}-\d{2}-\d{2}$/);
  if (isoMatch) return isoMatch[0];

  const usMatch = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const [, month, day, year] = usMatch;
    return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`;
  }

  const d = new Date(input);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0]!;
  }

  return null;
}

/**
 * Format a date range for display: "Apr 15–20, 2026"
 */
export function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate);
  const end = new Date(endDate);

  const startMonth = start.toLocaleDateString('en-US', { month: 'short' });
  const endMonth = end.toLocaleDateString('en-US', { month: 'short' });
  const startDay = start.getDate();
  const endDay = end.getDate();
  const year = end.getFullYear();

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay}–${endDay}, ${year}`;
  }
  return `${startMonth} ${startDay} – ${endMonth} ${endDay}, ${year}`;
}

/**
 * Get the number of nights between two date strings
 */
export function getNights(checkIn: string, checkOut: string): number {
  const start = new Date(checkIn);
  const end = new Date(checkOut);
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}
