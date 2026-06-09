// Weather via Open-Meteo (https://open-meteo.com) — free, no API key required,
// CORS-enabled. Location is auto-detected from the user's IP (ipapi.co) unless
// they set a manual location (city name or "lat,lon") in settings.

export type DailyWeather = {
  dateKey: string // "YYYY-MM-DD", matches formatDateKey()
  tempMax: number
  tempMin: number
  code: number // WMO weather code
}

export type Located = {
  lat: number
  lon: number
  /** Human-readable label including country, e.g. "Paris, France". */
  label: string
  /** "auto" (IP) or "manual" (geocoded / coordinates). */
  source: "auto" | "manual"
}

function joinParts(...parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => !!p && p.trim().length > 0).join(", ")
}

// Resolve the forecast location. With a manual value, accept "lat,lon" or a
// city name (geocoded via Open-Meteo); otherwise geolocate from the IP. The
// returned `label` always includes the country when known, so the user can
// confirm we matched the right city (e.g. Paris, France vs Paris, US).
export async function resolveWeatherLocation(manual: string): Promise<Located | null> {
  const q = manual.trim()
  if (q) {
    const coords = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/)
    if (coords) {
      return { lat: Number(coords[1]), lon: Number(coords[2]), label: q, source: "manual" }
    }
    try {
      const r = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1`,
      )
      const j = await r.json()
      const hit = j?.results?.[0]
      if (hit) {
        return {
          lat: hit.latitude,
          lon: hit.longitude,
          label: joinParts(hit.name, hit.admin1, hit.country),
          source: "manual",
        }
      }
    } catch {
      // fall through
    }
    return null
  }

  // No manual location — geolocate from IP.
  try {
    const r = await fetch("https://ipapi.co/json/")
    const j = await r.json()
    if (typeof j?.latitude === "number" && typeof j?.longitude === "number") {
      return {
        lat: j.latitude,
        lon: j.longitude,
        label: joinParts(j.city, j.region, j.country_name),
        source: "auto",
      }
    }
  } catch {
    // fall through
  }
  return null
}

async function fetchForecast(lat: number, lon: number): Promise<DailyWeather[]> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=16`
  const r = await fetch(url)
  const j = await r.json()
  const d = j?.daily
  if (!Array.isArray(d?.time)) return []
  return d.time.map((t: string, i: number) => ({
    dateKey: t,
    tempMax: Math.round(d.temperature_2m_max[i]),
    tempMin: Math.round(d.temperature_2m_min[i]),
    code: d.weather_code[i],
  }))
}

// Cache the forecast briefly so view switches / remounts don't refetch (and to
// stay well under ipapi.co's free limit). Keyed by the manual-location string.
let cache: { key: string; ts: number; data: DailyWeather[] } | null = null
const CACHE_MS = 30 * 60 * 1000

export function clearWeatherCache() {
  cache = null
}

export async function getForecast(manualLocation: string): Promise<DailyWeather[]> {
  const key = manualLocation.trim()
  const now = Date.now()
  if (cache && cache.key === key && now - cache.ts < CACHE_MS) return cache.data

  const loc = await resolveWeatherLocation(key)
  if (!loc) return []
  const data = await fetchForecast(loc.lat, loc.lon)
  cache = { key, ts: now, data }
  return data
}

// WMO weather code → emoji + label. See Open-Meteo docs for the code table.
export function weatherCodeToEmoji(code: number): string {
  if (code === 0) return "☀️"
  if (code === 1 || code === 2) return "⛅"
  if (code === 3) return "☁️"
  if (code === 45 || code === 48) return "🌫️"
  if (code >= 51 && code <= 57) return "🌦️"
  if (code >= 61 && code <= 67) return "🌧️"
  if (code >= 71 && code <= 77) return "🌨️"
  if (code >= 80 && code <= 82) return "🌦️"
  if (code === 85 || code === 86) return "🌨️"
  if (code >= 95) return "⛈️"
  return "☁️"
}

export function weatherCodeToLabel(code: number): string {
  if (code === 0) return "Clear sky"
  if (code === 1) return "Mainly clear"
  if (code === 2) return "Partly cloudy"
  if (code === 3) return "Overcast"
  if (code === 45 || code === 48) return "Fog"
  if (code >= 51 && code <= 57) return "Drizzle"
  if (code >= 61 && code <= 67) return "Rain"
  if (code >= 71 && code <= 77) return "Snow"
  if (code >= 80 && code <= 82) return "Rain showers"
  if (code === 85 || code === 86) return "Snow showers"
  if (code >= 95) return "Thunderstorm"
  return "Cloudy"
}
