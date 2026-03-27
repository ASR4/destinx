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

  const bookingComParams = new URLSearchParams({
    ss: searchTerm,
    checkin: details.checkIn,
    checkout: details.checkOut,
    group_adults: String(details.guests || 2),
    no_rooms: '1',
  });

  return {
    bookingCom: `https://www.booking.com/searchresults.html?${bookingComParams}`,
    agoda: `https://www.agoda.com/search?city=${encodeURIComponent(details.destination)}&checkIn=${details.checkIn}&checkOut=${details.checkOut}&rooms=1&adults=${details.guests || 2}`,
    direct: null,
  };
}

export function buildFlightDeepLinks(details: FlightBookingDetails): DeepLinks {
  const skyscannerDate = details.departureDate.replace(/-/g, '').slice(2);
  const returnPart = details.returnDate
    ? `/${details.returnDate.replace(/-/g, '').slice(2)}`
    : '';

  return {
    skyscanner: `https://www.skyscanner.com/transport/flights/${details.origin.toLowerCase()}/${details.destination.toLowerCase()}/${skyscannerDate}${returnPart}/`,
    googleFlights: `https://www.google.com/travel/flights?q=flights+from+${encodeURIComponent(details.origin)}+to+${encodeURIComponent(details.destination)}+on+${details.departureDate}`,
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

  return {
    openTable: `https://www.opentable.com/s?term=${encodeURIComponent(details.restaurantName)}&${otParams}`,
    googleMaps: `https://www.google.com/maps/search/${encodeURIComponent(details.restaurantName + ' ' + details.location)}`,
  };
}

export function buildExperienceDeepLinks(
  details: ExperienceBookingDetails,
): DeepLinks {
  return {
    getYourGuide: `https://www.getyourguide.com/s/?q=${encodeURIComponent(details.experienceName + ' ' + details.destination)}&date_from=${details.date}`,
    viator: `https://www.viator.com/search/${encodeURIComponent(details.experienceName + ' ' + details.destination)}`,
  };
}
