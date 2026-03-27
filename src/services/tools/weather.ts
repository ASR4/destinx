import { logger } from '../../utils/logger.js';

export interface WeatherForecast {
  date: string;
  tempHigh: number;
  tempLow: number;
  condition: string;
  precipitation: number;
  humidity: number;
  wind: string;
  unit: 'celsius' | 'fahrenheit';
}

/**
 * Get weather forecast for a location on a specific date.
 * Uses OpenWeatherMap API.
 */
export async function getWeather(
  location: string,
  date: string,
): Promise<WeatherForecast> {
  // TODO: Implement with OpenWeatherMap API
  // Use forecast endpoint for future dates, current weather for today
  logger.warn('getWeather not yet implemented');
  throw new Error('Not implemented');
}
