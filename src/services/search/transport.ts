import { logger } from '../../utils/logger.js';

export interface TransportOption {
  mode: string;
  provider?: string;
  duration: string;
  price?: { amount: number; currency: string };
  frequency?: string;
  bookingUrl?: string;
  steps?: string[];
}

export interface TransportSearchParams {
  from: string;
  to: string;
  date?: string;
  preference?: 'fastest' | 'cheapest' | 'scenic' | 'most_comfortable';
}

type TravelMode = 'driving' | 'transit' | 'walking' | 'bicycling';

const MODES: TravelMode[] = ['driving', 'transit', 'walking'];

export async function searchTransport(
  params: TransportSearchParams,
): Promise<TransportOption[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    logger.error('GOOGLE_MAPS_API_KEY not set');
    return [];
  }

  logger.info({ from: params.from, to: params.to }, 'Searching transport');

  const results: TransportOption[] = [];

  const modePromises = MODES.map(async (mode) => {
    try {
      const queryParams = new URLSearchParams({
        origin: params.from,
        destination: params.to,
        mode,
        key: apiKey,
      });

      if (params.date) {
        const departure = new Date(params.date);
        if (departure.getTime() > Date.now()) {
          queryParams.set('departure_time', String(Math.floor(departure.getTime() / 1000)));
        }
      }

      const response = await fetch(
        `https://maps.googleapis.com/maps/api/directions/json?${queryParams}`,
      );

      if (!response.ok) return null;

      const data = (await response.json()) as {
        status: string;
        routes?: Array<{
          legs?: Array<{
            distance?: { text: string; value: number };
            duration?: { text: string; value: number };
            steps?: Array<{
              html_instructions?: string;
              travel_mode?: string;
              transit_details?: {
                line?: { name?: string; short_name?: string; vehicle?: { type?: string } };
                departure_stop?: { name?: string };
                arrival_stop?: { name?: string };
                num_stops?: number;
              };
            }>;
          }>;
        }>;
      };

      if (data.status !== 'OK' || !data.routes?.length) return null;

      const leg = data.routes[0]!.legs?.[0];
      if (!leg) return null;

      const steps = (leg.steps ?? []).map((step) => {
        const instruction = (step.html_instructions ?? '')
          .replace(/<[^>]*>/g, '')
          .replace(/&nbsp;/g, ' ');

        if (step.transit_details) {
          const td = step.transit_details;
          const lineName = td.line?.short_name || td.line?.name || '';
          const vehicle = td.line?.vehicle?.type?.toLowerCase() || 'transit';
          return `Take ${vehicle} ${lineName} from ${td.departure_stop?.name ?? '?'} to ${td.arrival_stop?.name ?? '?'} (${td.num_stops ?? '?'} stops)`;
        }
        return instruction;
      }).filter(Boolean);

      const option: TransportOption = {
        mode: formatMode(mode),
        duration: leg.duration?.text ?? 'unknown',
        steps,
      };

      if (mode === 'driving') {
        const distanceKm = (leg.distance?.value ?? 0) / 1000;
        option.price = estimateDrivingCost(distanceKm);
        option.provider = 'Taxi / Rideshare';
        option.bookingUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(params.from)}&destination=${encodeURIComponent(params.to)}&travelmode=driving`;
      } else if (mode === 'transit') {
        option.provider = 'Public Transit';
        option.bookingUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(params.from)}&destination=${encodeURIComponent(params.to)}&travelmode=transit`;
      } else if (mode === 'walking') {
        option.provider = 'Walking';
        option.bookingUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(params.from)}&destination=${encodeURIComponent(params.to)}&travelmode=walking`;
      }

      return option;
    } catch (err) {
      logger.error({ err, mode }, 'Transport search failed for mode');
      return null;
    }
  });

  const resolved = await Promise.all(modePromises);
  for (const option of resolved) {
    if (option) results.push(option);
  }

  if (params.preference) {
    results.sort((a, b) => {
      if (params.preference === 'fastest') {
        return parseDurationMinutes(a.duration) - parseDurationMinutes(b.duration);
      }
      if (params.preference === 'cheapest') {
        return (a.price?.amount ?? 0) - (b.price?.amount ?? 0);
      }
      return 0;
    });
  }

  return results;
}

function formatMode(mode: string): string {
  const map: Record<string, string> = {
    driving: 'Car / Taxi',
    transit: 'Public Transit',
    walking: 'Walking',
    bicycling: 'Cycling',
  };
  return map[mode] ?? mode;
}

function estimateDrivingCost(distanceKm: number): { amount: number; currency: string } {
  const baseFare = 3;
  const perKm = 1.5;
  return { amount: Math.round(baseFare + distanceKm * perKm), currency: 'USD' };
}

function parseDurationMinutes(duration: string): number {
  let total = 0;
  const hourMatch = duration.match(/(\d+)\s*hour/);
  const minMatch = duration.match(/(\d+)\s*min/);
  if (hourMatch) total += parseInt(hourMatch[1]!) * 60;
  if (minMatch) total += parseInt(minMatch[1]!);
  return total || 9999;
}
