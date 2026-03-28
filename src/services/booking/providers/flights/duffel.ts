import { searchFlights, bookFlight } from '../../../search/flights.js';
import type { FlightProvider, FlightSearchResult, BookingResult } from '../interface.js';
import type { FlightSearchParams, DuffelPassenger, FlightOffer } from '../interface.js';

export class DuffelFlightProvider implements FlightProvider {
  readonly name = 'duffel';

  async search(params: FlightSearchParams): Promise<FlightSearchResult> {
    const flights = await searchFlights(params);
    // The raw offers (with passengerIds, rawAmount, rawCurrency) are returned here.
    // The orchestrator/tool-executor is responsible for storing them in Redis
    // and attaching the searchId to the result.
    return { flights };
  }

  async book(cachedOffer: unknown, passengers: DuffelPassenger[]): Promise<BookingResult> {
    const offer = cachedOffer as FlightOffer;
    const result = await bookFlight(
      {
        offerId: offer.offerId,
        passengerIds: offer.passengerIds,
        rawAmount: offer.rawAmount,
        rawCurrency: offer.rawCurrency,
      },
      passengers,
    );

    if (!result) {
      throw new Error('Flight booking returned null — offer may have expired');
    }

    return {
      orderId: result.orderId,
      bookingReference: result.bookingReference,
      totalAmount: result.totalAmount,
      totalCurrency: result.totalCurrency,
    };
  }
}
