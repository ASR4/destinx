const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  INR: '₹',
  AUD: 'A$',
  CAD: 'C$',
  SGD: 'S$',
  THB: '฿',
};

export function formatCurrency(
  amount: number,
  currency: string = 'USD',
): string {
  const symbol = CURRENCY_SYMBOLS[currency] || currency;
  const formatted = amount.toLocaleString('en-US', {
    minimumFractionDigits: currency === 'JPY' ? 0 : 2,
    maximumFractionDigits: currency === 'JPY' ? 0 : 2,
  });
  return `${symbol}${formatted}`;
}

/** Stub — integrate a real FX API (e.g. exchangerate.host) in implementation */
export async function convertCurrency(
  amount: number,
  from: string,
  to: string,
): Promise<number> {
  if (from === to) return amount;
  throw new Error(
    `Currency conversion ${from}→${to} not implemented. Integrate an FX API.`,
  );
}
