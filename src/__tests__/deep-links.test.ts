import { describe, it, expect } from 'vitest';
import {
  buildHotelDeepLinks,
  buildFlightDeepLinks,
  buildRestaurantDeepLinks,
  buildExperienceDeepLinks,
} from '../utils/deeplink.js';

describe('buildHotelDeepLinks', () => {
  it('generates booking.com and agoda links', () => {
    const links = buildHotelDeepLinks({
      destination: 'Tokyo',
      checkIn: '2026-05-01',
      checkOut: '2026-05-05',
      guests: 2,
      userPhone: '+1234567890',
    });

    expect(links.bookingCom).toContain('booking.com');
    expect(links.bookingCom).toContain('checkin=2026-05-01');
    expect(links.bookingCom).toContain('checkout=2026-05-05');
    expect(links.agoda).toContain('agoda.com');
    expect(links.agoda).toContain('Tokyo');
  });

  it('includes property name in search when provided', () => {
    const links = buildHotelDeepLinks({
      destination: 'Paris',
      propertyName: 'Ritz Paris',
      checkIn: '2026-06-01',
      checkOut: '2026-06-03',
      guests: 1,
      userPhone: '+1234567890',
    });

    expect(links.bookingCom).toContain('Ritz');
  });
});

describe('buildFlightDeepLinks', () => {
  it('generates skyscanner and google flights links', () => {
    const links = buildFlightDeepLinks({
      origin: 'SFO',
      destination: 'NRT',
      departureDate: '2026-05-01',
      passengers: 1,
      userPhone: '+1234567890',
    });

    expect(links.skyscanner).toContain('skyscanner.com');
    expect(links.skyscanner).toContain('sfo');
    expect(links.skyscanner).toContain('nrt');
    expect(links.googleFlights).toContain('google.com/travel/flights');
  });

  it('includes return date when provided', () => {
    const links = buildFlightDeepLinks({
      origin: 'LAX',
      destination: 'CDG',
      departureDate: '2026-07-01',
      returnDate: '2026-07-15',
      passengers: 2,
      userPhone: '+1234567890',
    });

    expect(links.skyscanner).toContain('/');
  });
});

describe('buildRestaurantDeepLinks', () => {
  it('generates opentable and maps links', () => {
    const links = buildRestaurantDeepLinks({
      restaurantName: 'Sushi Nakazawa',
      location: 'New York',
      date: '2026-05-01',
      time: '19:00',
      partySize: 4,
      userPhone: '+1234567890',
    });

    expect(links.openTable).toContain('opentable.com');
    expect(links.openTable).toContain('Sushi');
    expect(links.googleMaps).toContain('google.com/maps');
  });
});

describe('buildExperienceDeepLinks', () => {
  it('generates viator and getyourguide links', () => {
    const links = buildExperienceDeepLinks({
      experienceName: 'Colosseum Tour',
      destination: 'Rome',
      date: '2026-05-01',
      participants: 2,
      userPhone: '+1234567890',
    });

    expect(links.viator).toContain('viator.com');
    expect(links.getYourGuide).toContain('getyourguide.com');
    expect(links.getYourGuide).toContain('Rome');
  });
});
