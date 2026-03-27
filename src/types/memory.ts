export type PreferenceCategory =
  | 'accommodation'
  | 'food'
  | 'transport'
  | 'budget'
  | 'travel_style'
  | 'loyalty'
  | 'dietary'
  | 'companion';

export type PreferenceSource = 'explicit' | 'inferred' | 'feedback';

export interface Preference {
  id: string;
  userId: string;
  category: PreferenceCategory;
  key: string;
  value: unknown;
  confidence: number;
  source: PreferenceSource;
  lastConfirmedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SemanticMemory {
  id: string;
  userId: string;
  content: string;
  metadata?: {
    tripId?: string;
    category?: PreferenceCategory;
    date?: string;
  };
  similarity?: number;
  createdAt: Date;
}

export interface GroupedPreferences {
  accommodation: Preference[];
  food: Preference[];
  transport: Preference[];
  budget: Preference[];
  travel_style: Preference[];
  loyalty: Preference[];
  dietary: Preference[];
  companion: Preference[];
}

export interface UserProfile {
  preferences: GroupedPreferences;
  lastTrips: Array<{
    destination: string;
    dates: string;
    status: string;
  }>;
  semanticMemories?: string[];
}

export interface ExtractedPreference {
  category: PreferenceCategory;
  key: string;
  value: string;
  confidence: number;
  source: PreferenceSource;
}

export interface ExtractionResult {
  structured_preferences: ExtractedPreference[];
  semantic_memories: string[];
  no_new_preferences: boolean;
}
