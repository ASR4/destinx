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
 * Get weather forecast using OpenWeatherMap 3.0 One Call API.
 * First geocodes the city name, then fetches the forecast.
 */
export async function getWeather(
  location: string,
  date: string,
): Promise<WeatherForecast> {
  const apiKey = process.env.OPENWEATHERMAP_API_KEY;
  if (!apiKey) {
    throw new Error('OPENWEATHERMAP_API_KEY not set');
  }

  // Step 1: Geocode the location name to lat/lon
  const geoResponse = await fetch(
    `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(location)}&limit=1&appid=${apiKey}`,
  );

  if (!geoResponse.ok) {
    throw new Error(`Geocoding failed: ${geoResponse.status}`);
  }

  const geoData = (await geoResponse.json()) as Array<{
    lat: number;
    lon: number;
    name: string;
  }>;

  if (geoData.length === 0) {
    throw new Error(`Location not found: ${location}`);
  }

  const { lat, lon } = geoData[0]!;

  // Step 2: Determine if we need current weather or forecast
  const targetDate = new Date(date);
  const now = new Date();
  const daysFromNow = Math.floor(
    (targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (daysFromNow < 0) {
    throw new Error('Cannot fetch weather for past dates');
  }

  // Use One Call API for current + 7-day forecast
  const weatherResponse = await fetch(
    `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=minutely,hourly,alerts&units=metric&appid=${apiKey}`,
  );

  if (!weatherResponse.ok) {
    const errorText = await weatherResponse.text();
    logger.error({ status: weatherResponse.status, body: errorText }, 'OpenWeatherMap API error');
    throw new Error(`Weather API failed: ${weatherResponse.status}`);
  }

  const weatherData = (await weatherResponse.json()) as {
    current?: {
      temp: number;
      humidity: number;
      wind_speed: number;
      weather: Array<{ description: string }>;
    };
    daily?: Array<{
      dt: number;
      temp: { min: number; max: number };
      humidity: number;
      wind_speed: number;
      pop: number;
      weather: Array<{ description: string }>;
    }>;
  };

  // Match the requested date to a daily forecast entry
  if (daysFromNow <= 7 && weatherData.daily) {
    const dayForecast = weatherData.daily[Math.min(daysFromNow, weatherData.daily.length - 1)];
    if (dayForecast) {
      return {
        date,
        tempHigh: Math.round(dayForecast.temp.max),
        tempLow: Math.round(dayForecast.temp.min),
        condition: dayForecast.weather[0]?.description ?? 'Unknown',
        precipitation: Math.round(dayForecast.pop * 100),
        humidity: dayForecast.humidity,
        wind: `${Math.round(dayForecast.wind_speed * 3.6)} km/h`,
        unit: 'celsius',
      };
    }
  }

  // For dates beyond 7 days, return current weather as a rough baseline
  if (weatherData.current) {
    return {
      date,
      tempHigh: Math.round(weatherData.current.temp + 3),
      tempLow: Math.round(weatherData.current.temp - 3),
      condition: weatherData.current.weather[0]?.description ?? 'Unknown',
      precipitation: 0,
      humidity: weatherData.current.humidity,
      wind: `${Math.round(weatherData.current.wind_speed * 3.6)} km/h`,
      unit: 'celsius',
    };
  }

  throw new Error('No weather data available');
}
