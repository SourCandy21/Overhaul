import { useEffect, useState } from 'react'

type TerrainLayer = {
  id: string
  title: string
  description: string
  capabilities: string
}

type TerrainTile = { url: string; rowOffset: number; colOffset: number; center: boolean }
type LayerState = { status: 'loading' | 'ready' | 'error'; message: string; tiles?: TerrainTile[] }

const layers: TerrainLayer[] = [
  {
    id: 'WAC_POLE_ILL_PCT_SOUTH_100M',
    title: 'South Pole Illumination',
    description: 'Percentage of solar illumination observed by the WAC instrument.',
    capabilities: 'https://trek.nasa.gov/tiles/Moon/SP/WAC_POLE_ILL_PCT_SOUTH_100M/1.0.0/WMTSCapabilities.xml',
  },
  {
    id: 'AVGVISIB_85S_060M_201608_EARTH_SP',
    title: 'Earth Visibility',
    description: 'LOLA layer of average Earth visibility at the lunar south pole.',
    capabilities: 'https://trek.nasa.gov/tiles/Moon/SP/AVGVISIB_85S_060M_201608_EARTH_SP/1.0.0/WMTSCapabilities.xml',
  },
]

function findTileUrl(xml: Document, layerId: string, latitude: number, longitude: number) {
  const wmtsLayer = [...xml.getElementsByTagNameNS('*', 'Layer')].find((node) =>
    [...node.getElementsByTagNameNS('*', 'Identifier')].some((identifier) => identifier.textContent?.trim() === layerId),
  )
  if (!wmtsLayer) throw new Error('The layer was not advertised in the WMTS catalog.')

  const tileResource = [...wmtsLayer.getElementsByTagNameNS('*', 'ResourceURL')]
    .find((resource) => resource.getAttribute('resourceType')?.toLowerCase() === 'tile')
  const template = tileResource?.getAttribute('template')
  if (!template) throw new Error('The catalog did not provide a tile template for this layer.')

  const style = [...wmtsLayer.getElementsByTagNameNS('*', 'Style')][0]
  const styleId = style && [...style.getElementsByTagNameNS('*', 'Identifier')][0]?.textContent?.trim()
  const matrixSetLink = [...wmtsLayer.getElementsByTagNameNS('*', 'TileMatrixSetLink')][0]
  const matrixSetId = matrixSetLink && [...matrixSetLink.getElementsByTagNameNS('*', 'TileMatrixSet')][0]?.textContent?.trim()
  const matrixSet = [...xml.getElementsByTagNameNS('*', 'TileMatrixSet')].find((node) =>
    [...node.getElementsByTagNameNS('*', 'Identifier')][0]?.textContent?.trim() === matrixSetId,
  )
  const matrices = matrixSet ? [...matrixSet.getElementsByTagNameNS('*', 'TileMatrix')] : []
  if (!styleId || !matrixSetId || !matrices.length) throw new Error('The catalog did not provide a valid style or tile matrix.')

  // Moon Trek's south-pole layers use a polar stereographic grid. Pick the
  // finest advertised matrix, then calculate the tile containing the form point.
  const matrix = matrices[matrices.length - 1]
  const value = (parent: Element, name: string) => [...parent.getElementsByTagNameNS('*', name)][0]?.textContent?.trim()
  const matrixId = value(matrix, 'Identifier')
  const topLeft = value(matrix, 'TopLeftCorner')?.split(/\s+/).map(Number)
  const scale = Number(value(matrix, 'ScaleDenominator'))
  const tileWidth = Number(value(matrix, 'TileWidth'))
  const tileHeight = Number(value(matrix, 'TileHeight'))
  const matrixWidth = Number(value(matrix, 'MatrixWidth'))
  const matrixHeight = Number(value(matrix, 'MatrixHeight'))
  if (!matrixId || !topLeft || topLeft.length < 2 || !Number.isFinite(scale) || !tileWidth || !tileHeight) {
    throw new Error('The WMTS matrix does not contain the geometry required to locate this point.')
  }

  const latitudeRadians = latitude * Math.PI / 180
  const longitudeRadians = longitude * Math.PI / 180
  const lunarRadiusMeters = 1_737_400
  const polarDistance = 2 * lunarRadiusMeters * Math.tan((Math.PI / 2 + latitudeRadians) / 2)
  const x = polarDistance * Math.sin(longitudeRadians)
  const y = polarDistance * Math.cos(longitudeRadians)
  const tileSpan = scale * 0.00028 * tileWidth
  const tileSpanY = scale * 0.00028 * tileHeight
  const col = Math.floor((x - topLeft[0]) / tileSpan)
  const row = Math.floor((topLeft[1] - y) / tileSpanY)
  if (col < 0 || row < 0 || col >= matrixWidth || row >= matrixHeight) {
    throw new Error('The coordinates are outside this polar layer’s coverage.')
  }

  const limit = matrixSetLink && [...matrixSetLink.getElementsByTagNameNS('*', 'TileMatrixLimits')].find((node) => value(node, 'TileMatrix') === matrixId)
  if (limit) {
    const minRow = Number(value(limit, 'MinTileRow'))
    const maxRow = Number(value(limit, 'MaxTileRow'))
    const minCol = Number(value(limit, 'MinTileCol'))
    const maxCol = Number(value(limit, 'MaxTileCol'))
    if (row < minRow || row > maxRow || col < minCol || col > maxCol) throw new Error('No tile is published for this coordinate in this matrix.')
  }

  const localX = ((x - topLeft[0]) / tileSpan - col) * 100
  const localY = ((topLeft[1] - y) / tileSpanY - row) * 100
  const tiles: TerrainTile[] = []
  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    for (let colOffset = -1; colOffset <= 1; colOffset += 1) {
      const tileRow = row + rowOffset
      const tileCol = col + colOffset
      if (tileRow < 0 || tileCol < 0 || tileRow >= matrixHeight || tileCol >= matrixWidth) continue
      const tileTemplate = template
        .replaceAll('{Style}', styleId)
        .replaceAll('{TileMatrixSet}', matrixSetId)
        .replaceAll('{TileMatrix}', matrixId)
        .replaceAll('{TileRow}', String(tileRow))
        .replaceAll('{TileCol}', String(tileCol))
      const tileUrl = new URL(tileTemplate, 'https://trek.nasa.gov')
      if (tileUrl.protocol !== 'https:' || tileUrl.hostname !== 'trek.nasa.gov' || tileUrl.port) {
        throw new Error('The catalog provided a tile URL outside the authorized HTTPS domain.')
      }
      tiles.push({
        rowOffset,
        colOffset,
        center: rowOffset === 0 && colOffset === 0,
        url: tileUrl.href,
      })
    }
  }
  return { tiles, marker: { x: localX, y: localY } }
}

export function MoonTerrainExplorer({ latitude, longitude }: { latitude: number; longitude: number }) {
  const [selected, setSelected] = useState(layers[0])
  const [layerState, setLayerState] = useState<LayerState>({ status: 'loading', message: 'Loading the NASA WMTS catalog…' })
  const [tileLoaded, setTileLoaded] = useState(false)
  const [marker, setMarker] = useState<{ x: number; y: number } | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  function selectLayer(layer: TerrainLayer) {
    setSelected(layer)
    setTileLoaded(false)
    setMarker(null)
    setLayerState({ status: 'loading', message: 'Loading the NASA WMTS catalog…' })
  }

  useEffect(() => {
    const controller = new AbortController()
    async function requestLayer() {
      try {
        const response = await fetch(selected.capabilities, { signal: controller.signal })
        if (!response.ok) throw new Error(`Catalog returned HTTP ${response.status}`)
        const xml = new DOMParser().parseFromString(await response.text(), 'application/xml')
        if (xml.querySelector('parsererror')) throw new Error('The catalog returned invalid XML.')
        const tile = findTileUrl(xml, selected.id, latitude, longitude)
        if (controller.signal.aborted) return
        setLayerState({ status: 'ready', message: 'Tiles around the location found in the catalog. Loading…', tiles: tile.tiles })
        setMarker(tile.marker)
      } catch (error) {
        if (controller.signal.aborted) return
        setLayerState({ status: 'error', message: error instanceof Error ? error.message : 'Could not load the WMTS catalog.' })
      }
    }
    void requestLayer()
    return () => controller.abort()
  }, [latitude, longitude, retryKey, selected])

  function inspectLoadedTile(image: HTMLImageElement) {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 24
      canvas.height = 24
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('Canvas unavailable')
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      const hasData = pixels.some((alpha, index) => index % 4 === 3 && alpha > 0)
      if (!hasData) {
        setLayerState({ status: 'error', message: 'The server returned a tile with no data pixels for this location.' })
        return
      }
    } catch {
      // A successful image load still counts when the browser disallows canvas inspection.
    }
    setTileLoaded(true)
  }

  return (
    <section className="terrain-explorer" aria-label="Lunar layers from the NASA Moon Trek API">
      <div className="terrain-explorer-heading">
        <div><span className="panel-overline">MAP DATA · NASA WMTS</span><h3>Explore South Pole layers</h3></div>
        <a href="https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon" target="_blank" rel="noreferrer">API documentation ↗</a>
      </div>
      <div className="terrain-layer-tabs" role="tablist" aria-label="Terrain layer">
        {layers.map((layer) => <button key={layer.id} type="button" role="tab" aria-selected={selected.id === layer.id} className={selected.id === layer.id ? 'selected' : ''} onClick={() => selectLayer(layer)}>{layer.title}</button>)}
      </div>
      <div className="terrain-map">
        {layerState.tiles && !tileLoaded && <div className="terrain-map-loading">Loading lunar map around the selected location…</div>}
        {layerState.tiles && <div className={`terrain-image-frame ${tileLoaded ? 'loaded' : 'pending'}`}>
          {layerState.tiles.map((tile) => <img key={`${tile.rowOffset}-${tile.colOffset}`} src={tile.url} alt="" crossOrigin="anonymous" style={{ left: `${50 - (marker?.x ?? 50) + tile.colOffset * 100}%`, top: `${50 - (marker?.y ?? 50) + tile.rowOffset * 100}%` }} onLoad={(event) => { if (tile.center) inspectLoadedTile(event.currentTarget) }} onError={() => { if (tile.center) setLayerState({ status: 'error', message: 'The catalog responded, but the center tile for this location did not load. Check coverage or your connection to the service.' }) }} />)}
          {tileLoaded && <span className="terrain-site-marker" aria-label="Selected location" title="Selected location" />}
        </div>}
        {layerState.status === 'error' && <div className="terrain-map-fallback"><strong>Layer unavailable</strong><span>{layerState.message}</span><button type="button" onClick={() => { setLayerState({ status: 'loading', message: 'Loading the NASA WMTS catalog…' }); setRetryKey((value) => value + 1) }}>Try again</button><a href="https://trek.nasa.gov/moon/" target="_blank" rel="noreferrer">Open NASA Moon Trek ↗</a></div>}
        <span className="terrain-coordinate">SELECTED LOCATION · {latitude.toFixed(2)}°, {longitude.toFixed(2)}°</span>
        <a className="terrain-open-trek" href={`https://trek.nasa.gov/moon/?lat=${latitude}&lon=${longitude}`} target="_blank" rel="noreferrer">Open in Moon Trek ↗</a>
      </div>
      <div className="terrain-api-status" role="status"><span className={`api-status-dot ${layerState.status}`} />{tileLoaded ? 'Tile loaded from NASA’s WMTS service.' : layerState.message}<code>{selected.id}</code></div>
      <p className="terrain-layer-description">{selected.description} The image, tile matrix, and marker are calculated for the selected coordinates using the public Moon Trek WMTS catalog.</p>
    </section>
  )
}
