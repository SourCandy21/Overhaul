import type { SiteAnalysis, Observation } from '../types/analysis'
import type { SiteAnalysisRequest } from './client'

function estimateTerrainWindow(observations: Observation[], body: 'sun' | 'earth') {
  return observations.slice(0, -1).reduce((hours, observation, index) => {
    const next = observations[index + 1]
    const firstElevation = observation[body].elevation_deg - (observation.terrain?.horizon_elevation_deg ?? 0)
    const nextElevation = next[body].elevation_deg - (next.terrain?.horizon_elevation_deg ?? 0)
    const intervalHours = (Date.parse(next.time) - Date.parse(observation.time)) / 3_600_000
    if (!Number.isFinite(intervalHours) || intervalHours <= 0) return hours
    if (firstElevation >= 0 && nextElevation >= 0) return hours + intervalHours
    if (firstElevation < 0 && nextElevation < 0) return hours
    const crossing = firstElevation / (firstElevation - nextElevation)
    return hours + intervalHours * (firstElevation >= 0 ? crossing : 1 - crossing)
  }, 0)
}

export function buildMockAnalysis(request: Omit<SiteAnalysisRequest, 'signal'>): SiteAnalysis {
  const startMs = Date.parse(request.start)
  const endMs = Date.parse(request.end)
  const stepHours = request.step.endsWith('m')
    ? Number.parseFloat(request.step) / 60
    : Number.parseFloat(request.step.replace('h', ''))
  const durationHours = Math.max(stepHours, (endMs - startMs) / 3_600_000)
  const intervals = Math.max(1, Math.round(durationHours / stepHours))
  const siteLongitude = request.longitude * Math.PI / 180
  const siteLatitude = request.latitude * Math.PI / 180
  const startDate = new Date(startMs)
  const dayOfYear = (Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()) - Date.UTC(startDate.getUTCFullYear(), 0, 0)) / 86_400_000
  const season = dayOfYear / 365.25 * Math.PI * 2
  const lunarDayMs = 29.53059 * 86_400_000
  const observations: Observation[] = Array.from({ length: intervals + 1 }, (_, index) => {
    const elapsed = Math.min(durationHours, index * stepHours)
    const timestamp = startMs + elapsed * 3_600_000
    const phase = timestamp / lunarDayMs * Math.PI * 2 + siteLongitude
    const solarDeclination = 1.54 * Math.sin(season - Math.PI / 2) * Math.PI / 180
    const earthLibration = 7.9 * Math.sin(phase * 1.08 + 0.4) * Math.PI / 180
    const solarTerm = Math.sin(siteLatitude) * Math.sin(solarDeclination) + Math.cos(siteLatitude) * Math.cos(solarDeclination) * Math.cos(phase)
    const earthTerm = Math.sin(siteLatitude) * Math.sin(-earthLibration) + Math.cos(siteLatitude) * Math.cos(earthLibration) * Math.cos(phase * 0.08)
    const sunElevation = Math.asin(Math.max(-1, Math.min(1, solarTerm))) * 180 / Math.PI
    const earthElevation = Math.asin(Math.max(-1, Math.min(1, earthTerm))) * 180 / Math.PI
    const terrainHorizon = 0.2 + 0.7 * (0.5 + 0.5 * Math.sin(phase * 1.2 + 0.3))

    return {
      time: new Date(timestamp).toISOString(),
      sun: {
        azimuth_deg: (phase * 180 / Math.PI + 90 + 360) % 360,
        elevation_deg: sunElevation,
        above_local_horizon: sunElevation > terrainHorizon,
      },
      earth: {
        azimuth_deg: (phase * 180 / Math.PI + 205 + 360) % 360,
        elevation_deg: earthElevation,
        above_local_horizon: earthElevation > terrainHorizon,
      },
      terrain: {
        horizon_elevation_deg: terrainHorizon,
        available: true,
      },
    }
  })

  return {
    site: {
      id: 'mock-site',
      name: 'Local de demonstração',
      latitude: request.latitude,
      longitude: request.longitude,
      altitude_m: request.altitude_m,
    },
    interval: {
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      step: request.step,
    },
    observations,
    summary: {
      sunlight_hours: estimateTerrainWindow(observations, 'sun'),
      earth_visibility_hours: estimateTerrainWindow(observations, 'earth'),
      terrain_adjusted: true,
    },
  }
}
