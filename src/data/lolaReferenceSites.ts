export interface LolaReferenceSite {
  id: string
  name: string
  latitude: number
  longitude: number
  illumination: number
  earthVisibility: number
  slope: number
  elevation_m: number
}

export const lolaReferenceSites: LolaReferenceSite[] = [
  { id: 'R04', name: 'Shackleton Rim', latitude: -89.7668, longitude: -171.87, illumination: 10.96, earthVisibility: 11.07, slope: 31.50, elevation_m: 771.04 },
  { id: 'R23', name: 'Malapert Massif', latitude: -85.9948, longitude: -0.23578, illumination: 28.16, earthVisibility: 50.00, slope: 3.71, elevation_m: 4783.57 },
  { id: 'Shoemaker', name: 'Shoemaker (centro)', latitude: -87.1835, longitude: 62.83502, illumination: 34.38, earthVisibility: 43.46, slope: 5.19, elevation_m: 547.57 },
  { id: 'LM7', name: 'Faustini Rim A', latitude: -87.8897, longitude: 90, illumination: 24.02, earthVisibility: 50.80, slope: 4.16, elevation_m: 46.21 },
]
