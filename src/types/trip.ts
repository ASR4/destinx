export interface Traveler {
  name: string;
  age?: number;
  relation?: string;
}

export interface Budget {
  total: number;
  currency: string;
  breakdown?: {
    accommodation?: number;
    flights?: number;
    food?: number;
    experiences?: number;
    transport?: number;
    misc?: number;
  };
}

export type DayItemType =
  | 'flight'
  | 'hotel'
  | 'experience'
  | 'restaurant'
  | 'transport'
  | 'free_time';

export interface DayItem {
  time: string;
  type: DayItemType;
  name: string;
  description?: string;
  duration_min?: number;
  price?: { amount: number; currency: string };
  booking_url?: string;
  maps_url?: string;
  rating?: number;
  notes?: string;
}

export interface Accommodation {
  name: string;
  check_in?: boolean;
  check_out?: boolean;
  loyalty_program?: string;
  confirmation?: string;
}

export interface DayPlan {
  date: string;
  day_number: number;
  theme?: string;
  items: DayItem[];
  accommodation?: Accommodation;
  day_total?: { amount: number; currency: string };
}

export interface Itinerary {
  days: DayPlan[];
  overview?: string;
  packing_tips?: string[];
  important_notes?: string[];
}

export type TripStatus =
  | 'planning'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export interface Trip {
  id: string;
  userId: string;
  destination: string;
  startDate: string;
  endDate: string;
  status: TripStatus;
  plan: Itinerary;
  budget?: Budget;
  travelers?: Traveler[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PlanInput {
  destination: string;
  startDate: string;
  endDate: string;
  travelers?: Traveler[];
  budgetTotal?: number;
  currency?: string;
  interests?: string[];
  pace?: 'packed' | 'balanced' | 'relaxed';
  mustDos?: string[];
  avoid?: string[];
}
