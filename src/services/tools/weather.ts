import { logger } from '../../utils/logger.js';
import { webSearch } from './web-search.js';

export interface WeatherForecast {
  date: string;
  tempHigh: number;
  tempLow: number;
  condition: string;
  precipitation: number;
  humidity: number;
  wind: string;
  unit: 'celsius' | 'fahrenheit';
  source: 'openweathermap' | 'brave_search';
}

/**
 * Get weather forecast. Tries OpenWeatherMap 3.0 if key is present,
 * otherwise falls back to Brave Search for a best-effort forecast.
 */
export async function getWeather(
  location: string,
  date: string,
): Promise<WeatherForecast> {
  const owmKey = process.env.OPENWEATHERMAP_API_KEY;
  if (owmKey) {
    return getWeatherFromOWM(location, date, owmKey);
  }

  return getWeatherFromBrave(location, date);
}

async function getWeatherFromOWM(
  location: string,
  date: string,
  apiKey: string,
): Promise<WeatherForecast> {
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

  const targetDate = new Date(date);
  const now = new Date();
  const daysFromNow = Math.floor(
    (targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (daysFromNow < 0) {
    throw new Error('Cannot fetch weather for past dates');
  }

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
        source: 'openweathermap',
      };
    }
  }

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
      source: 'openweathermap',
    };
  }

  throw new Error('No weather data available');
}

/**
 * Best-effort weather via Brave Search when no OWM key is configured.
 * Searches for the weather forecast and returns a structured result
 * extracted from the search snippets.
 */
async function getWeatherFromBrave(
  location: string,
  date: string,
): Promise<WeatherForecast> {
  logger.info({ location, date }, 'Fetching weather via Brave Search (OWM key not set)');

  const results = await webSearch(
    `weather forecast ${location} ${date}`,
    { count: 3, freshness: 'pw' },
  );

  if (results.length === 0) {
    throw new Error('No weather data available (Brave Search returned no results)');
  }

  const allText = results
    .map((r) => [r.snippet, ...(r.extraSnippets ?? [])].join(' '))
    .join(' ');

  const tempMatch = allText.match(/(\d{1,3})\s*°?\s*[FC]/gi);
  const temps = (tempMatch ?? [])
    .map((m) => parseInt(m.replace(/[^\d]/g, ''), 10))
    .filter((t) => t > -50 && t < 150);

  const conditionPatterns = [
    'sunny', 'partly cloudy', 'cloudy', 'overcast', 'rain', 'showers',
    'thunderstorm', 'snow', 'fog', 'haze', 'clear', 'drizzle', 'windy',
    'humid', 'hot', 'cold', 'warm', 'mild',
  ];
  const foundCondition = conditionPatterns.find((c) =>
    allText.toLowerCase().includes(c),
  );

  return {
    date,
    tempHigh: temps.length >= 2 ? Math.max(...temps) : temps[0] ?? 25,
    tempLow: temps.length >= 2 ? Math.min(...temps) : (temps[0] ?? 25) - 8,
    condition: foundCondition ?? results[0]!.snippet.slice(0, 80),
    precipitation: 0,
    humidity: 0,
    wind: 'N/A',
    unit: allText.includes('°F') ? 'fahrenheit' : 'celsius',
    source: 'brave_search',
  };
}
