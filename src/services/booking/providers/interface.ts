import type { FlightOffer, FlightSearchParams, DuffelPassenger, FlightBookingResult } from '../../search/flights.js';

export type { FlightOffer, FlightSearchParams, DuffelPassenger };

export interface BookingResult {
  orderId: string;
  bookingReference: string;
  totalAmount: string;
  totalCurrency: string;
}

export interface FlightSearchResult {
  /** Populated by the orchestrator after storing offers in Redis */
  searchId?: string;
  flights: FlightOffer[];
}

export interface FlightProvider {
  readonly name: string;
  search(params: FlightSearchParams): Promise<FlightSearchResult>;
  book(cachedOffer: unknown, passengers: DuffelPassenger[]): Promise<BookingResult>;
}

// Re-export for convenience
export type { FlightBookingResult };
