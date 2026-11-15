import type { BodyPosition, Observation, SiteAnalysis } from '../types/analysis'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '')

export const isApiConfigured = () => Boolean(apiBaseUrl)

export interface SiteAnalysisRequest {
  latitude: number
  longitude: number
  altitude_m: number
  start: string
  end: string
  step: string
  signal?: AbortSignal
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isBodyPosition(value: unknown): value is BodyPosition {
  return isRecord(value)
    && typeof value.azimuth_deg === 'number'
    && Number.isFinite(value.azimuth_deg)
    && typeof value.elevation_deg === 'number'
    && Number.isFinite(value.elevation_deg)
    && (value.above_local_horizon === undefined || typeof value.above_local_horizon === 'boolean')
}

function isObservation(value: unknown): value is Observation {
  if (!isRecord(value) || typeof value.time !== 'string' || !isBodyPosition(value.sun) || !isBodyPosition(value.earth)) return false
  if (value.terrain === undefined) return true
  return isRecord(value.terrain)
    && typeof value.terrain.available === 'boolean'
    && typeof value.terrain.horizon_elevation_deg === 'number'
    && Number.isFinite(value.terrain.horizon_elevation_deg)
}

function isSiteAnalysis(value: unknown): value is SiteAnalysis {
  if (!isRecord(value) || !isRecord(value.site) || !isRecord(value.interval)) return false
  const { site, interval } = value
  if (typeof site.id !== 'string' || typeof site.name !== 'string'
    || typeof site.latitude !== 'number' || !Number.isFinite(site.latitude)
    || typeof site.longitude !== 'number' || !Number.isFinite(site.longitude)
    || typeof site.altitude_m !== 'number' || !Number.isFinite(site.altitude_m)) return false
  if (typeof interval.start !== 'string' || typeof interval.end !== 'string' || typeof interval.step !== 'string') return false
  if (!Array.isArray(value.observations) || !value.observations.every(isObservation)) return false
  if (value.summary !== undefined) {
    if (!isRecord(value.summary)) return false
    const { sunlight_hours, earth_visibility_hours, terrain_adjusted } = value.summary
    if (sunlight_hours !== undefined && (typeof sunlight_hours !== 'number' || !Number.isFinite(sunlight_hours))) return false
    if (earth_visibility_hours !== undefined && (typeof earth_visibility_hours !== 'number' || !Number.isFinite(earth_visibility_hours))) return false
    if (typeof terrain_adjusted !== 'boolean') return false
  }
  return true
}

export async function fetchSiteAnalysis(params: SiteAnalysisRequest): Promise<SiteAnalysis> {
  if (!apiBaseUrl) {
    throw new Error('Defina VITE_API_BASE_URL no arquivo .env.local e inicie o backend de análise.')
  }

  const query = new URLSearchParams({
    latitude: String(params.latitude),
    longitude: String(params.longitude),
    altitude_m: String(params.altitude_m),
    start: params.start,
    end: params.end,
    step: params.step,
  })

  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}/api/analysis?${query}`, {
      signal: params.signal,
      headers: { Accept: 'application/json' },
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error('Não foi possível alcançar o backend. Confirme a URL e se o serviço está em execução.')
  }

  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const apiMessage = isRecord(payload) && typeof payload.error === 'string' ? payload.error : null
    throw new Error(apiMessage ?? `O backend respondeu com erro HTTP ${response.status}.`)
  }
  if (!isSiteAnalysis(payload)) {
    throw new Error('A resposta da API não segue o contrato SiteAnalysis esperado pelo navegador.')
  }
  return payload
}
