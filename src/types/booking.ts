export type BookingType =
  | 'flight'
  | 'hotel'
  | 'experience'
  | 'restaurant'
  | 'transport';

export type BookingStatus =
  | 'planned'
  | 'pending_booking'
  | 'pending_payment'
  | 'link_sent'
  | 'user_confirmed'
  | 'booked'
  | 'cancelled'
  | 'failed';

export interface BookingPrice {
  amount: number;
  currency: string;
  loyaltyPointsUsed?: number;
}

export interface HotelBookingDetails {
  destination: string;
  propertyName?: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  roomType?: string;
  specialRequests?: string;
  userPhone: string;
}

export interface FlightBookingDetails {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  passengers: number;
  cabinClass?: 'economy' | 'premium_economy' | 'business' | 'first';
  preferredAirlines?: string[];
  userPhone: string;
}

export interface RestaurantBookingDetails {
  restaurantName: string;
  location: string;
  date: string;
  time: string;
  partySize: number;
  specialRequests?: string;
  userPhone: string;
}

export interface ExperienceBookingDetails {
  experienceName: string;
  destination: string;
  date: string;
  participants: number;
  userPhone: string;
}

export type BookingDetails =
  | ({ type: 'hotel' } & HotelBookingDetails)
  | ({ type: 'flight' } & FlightBookingDetails)
  | ({ type: 'restaurant' } & RestaurantBookingDetails)
  | ({ type: 'experience' } & ExperienceBookingDetails);

export interface BookingSummary {
  hotelName?: string;
  flightNumber?: string;
  checkIn?: string;
  checkOut?: string;
  roomType?: string;
  totalPrice?: string;
  loyaltyPoints?: string;
  cancellationPolicy?: string;
}

export interface BookingResult {
  status: 'confirmed' | 'failed' | 'timeout' | 'cancelled';
  confirmationNumber?: string;
  summary?: BookingSummary;
  error?: string;
}

export interface DeepLinks {
  bookingCom?: string | null;
  agoda?: string | null;
  skyscanner?: string | null;
  googleFlights?: string | null;
  kayak?: string | null;
  openTable?: string | null;
  resy?: string | null;
  getYourGuide?: string | null;
  viator?: string | null;
  direct?: string | null;
  googleMaps?: string | null;
  marriott?: string | null;
  hilton?: string | null;
  hyatt?: string | null;
  airbnb?: string | null;
}

export interface BookingSession {
  sessionId: string;
  liveViewUrl: string;
  status: BookingStatus;
  provider: string;
  bookingType: BookingType;
  createdAt: Date;
}
