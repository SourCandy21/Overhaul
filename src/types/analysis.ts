export interface LandingSite {
  id: string
  name: string
  latitude: number
  longitude: number
  altitude_m: number
}

export interface BodyPosition {
  azimuth_deg: number
  elevation_deg: number
  above_local_horizon?: boolean
}

export interface Observation {
  time: string
  sun: BodyPosition
  earth: BodyPosition
  geometric_horizon_elevation_deg?: number
  terrain?: { horizon_elevation_deg: number; available: boolean }
}

export interface SiteAnalysis {
  site: LandingSite
  interval: { start: string; end: string; step: string }
  observations: Observation[]
  summary?: {
    sunlight_hours?: number
    earth_visibility_hours?: number
    terrain_adjusted: boolean
  }
}
