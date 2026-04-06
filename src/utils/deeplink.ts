import type {
  HotelBookingDetails,
  FlightBookingDetails,
  RestaurantBookingDetails,
  ExperienceBookingDetails,
  DeepLinks,
} from '../types/booking.js';

export function buildHotelDeepLinks(details: HotelBookingDetails): DeepLinks {
  const searchTerm = details.propertyName
    ? `${details.propertyName} ${details.destination}`
    : details.destination;

  const guests = details.guests || 2;

  // Booking.com
  const bookingComParams = new URLSearchParams({
    ss: searchTerm,
    checkin: details.checkIn,
    checkout: details.checkOut,
    group_adults: String(guests),
    no_rooms: '1',
  });

  // Marriott
  const marriottParams = new URLSearchParams({
    search: details.propertyName || details.destination,
    fromDate: details.checkIn,
    toDate: details.checkOut,
    adultsCount: String(guests),
    roomCount: '1',
  });

  // Hilton
  const hiltonParams = new URLSearchParams({
    query: details.propertyName || details.destination,
    arrivalDate: details.checkIn,
    departureDate: details.checkOut,
    room1NumAdults: String(guests),
  });

  // Hyatt
  const hyattCheckin = details.checkIn.replace(/-/g, '');
  const hyattCheckout = details.checkOut.replace(/-/g, '');

  // Airbnb
  const airbnbParams = new URLSearchParams({
    query: details.destination,
    checkin: details.checkIn,
    checkout: details.checkOut,
    adults: String(guests),
  });

  // Google "I'm Feeling Lucky" → direct hotel site
  const directUrl = details.propertyName
    ? `https://www.google.com/search?q=${encodeURIComponent(details.propertyName + ' official site book')}&btnI=1`
    : null;

  return {
    direct: directUrl,
    bookingCom: `https://www.booking.com/searchresults.html?${bookingComParams}`,
    marriott: `https://www.marriott.com/search/default.mi?${marriottParams}`,
    hilton: `https://www.hilton.com/en/search/?${hiltonParams}`,
    hyatt: `https://www.hyatt.com/shop/rooms/${encodeURIComponent(details.destination)}?checkinDate=${hyattCheckin}&checkoutDate=${hyattCheckout}&adults=${guests}`,
    airbnb: `https://www.airbnb.com/s/${encodeURIComponent(details.destination)}/homes?${airbnbParams}`,
  };
}

export function buildFlightDeepLinks(details: FlightBookingDetails): DeepLinks {
  const skyscannerDate = details.departureDate.replace(/-/g, '').slice(2);
  const returnPart = details.returnDate
    ? `/${details.returnDate.replace(/-/g, '').slice(2)}`
    : '';

  // Google Flights
  const googleFlightsQuery = `flights from ${details.origin} to ${details.destination} on ${details.departureDate}`;

  // Kayak
  const kayakOrigin = details.origin;
  const kayakDest = details.destination;
  const kayakDate = details.departureDate;
  const kayakReturn = details.returnDate ? `/${details.returnDate}` : '';

  return {
    skyscanner: `https://www.skyscanner.com/transport/flights/${details.origin.toLowerCase()}/${details.destination.toLowerCase()}/${skyscannerDate}${returnPart}/`,
    googleFlights: `https://www.google.com/travel/flights?q=${encodeURIComponent(googleFlightsQuery)}`,
    kayak: `https://www.kayak.com/flights/${kayakOrigin}-${kayakDest}/${kayakDate}${kayakReturn}`,
    direct: null,
  };
}

export function buildRestaurantDeepLinks(
  details: RestaurantBookingDetails,
): DeepLinks {
  const otParams = new URLSearchParams({
    covers: String(details.partySize),
    dateTime: `${details.date}T${details.time}`,
  });

  // Resy
  const resyDate = details.date;
  const resySeats = details.partySize;

  return {
    openTable: `https://www.opentable.com/s?term=${encodeURIComponent(details.restaurantName)}&${otParams}`,
    resy: `https://resy.com/cities/${encodeURIComponent(details.location.toLowerCase().replace(/\s+/g, '-'))}?date=${resyDate}&seats=${resySeats}&query=${encodeURIComponent(details.restaurantName)}`,
    googleMaps: `https://www.google.com/maps/search/${encodeURIComponent(details.restaurantName + ' ' + details.location)}`,
  };
}

export function buildExperienceDeepLinks(
  details: ExperienceBookingDetails,
): DeepLinks {
  return {
    getYourGuide: `https://www.getyourguide.com/s/?q=${encodeURIComponent(details.experienceName + ' ' + details.destination)}&date_from=${details.date}`,
    viator: `https://www.viator.com/search/${encodeURIComponent(details.experienceName + ' ' + details.destination)}`,
    googleMaps: `https://www.google.com/maps/search/${encodeURIComponent(details.experienceName + ' ' + details.destination)}`,
  };
}
