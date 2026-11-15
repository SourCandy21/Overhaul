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
    title: 'Iluminação no polo sul',
    description: 'Percentual de iluminação solar observado pelo instrumento WAC.',
    capabilities: 'https://trek.nasa.gov/tiles/Moon/SP/WAC_POLE_ILL_PCT_SOUTH_100M/1.0.0/WMTSCapabilities.xml',
  },
  {
    id: 'AVGVISIB_85S_060M_201608_EARTH_SP',
    title: 'Visibilidade da Terra',
    description: 'Camada LOLA de visibilidade média da Terra no polo sul lunar.',
    capabilities: 'https://trek.nasa.gov/tiles/Moon/SP/AVGVISIB_85S_060M_201608_EARTH_SP/1.0.0/WMTSCapabilities.xml',
  },
]

function findTileUrl(xml: Document, layerId: string, latitude: number, longitude: number) {
  const wmtsLayer = [...xml.getElementsByTagNameNS('*', 'Layer')].find((node) =>
    [...node.getElementsByTagNameNS('*', 'Identifier')].some((identifier) => identifier.textContent?.trim() === layerId),
  )
  if (!wmtsLayer) throw new Error('A camada não foi anunciada pelo catálogo WMTS.')

  const tileResource = [...wmtsLayer.getElementsByTagNameNS('*', 'ResourceURL')]
    .find((resource) => resource.getAttribute('resourceType')?.toLowerCase() === 'tile')
  const template = tileResource?.getAttribute('template')
  if (!template) throw new Error('O catálogo não informou um template de tiles para esta camada.')

  const style = [...wmtsLayer.getElementsByTagNameNS('*', 'Style')][0]
  const styleId = style && [...style.getElementsByTagNameNS('*', 'Identifier')][0]?.textContent?.trim()
  const matrixSetLink = [...wmtsLayer.getElementsByTagNameNS('*', 'TileMatrixSetLink')][0]
  const matrixSetId = matrixSetLink && [...matrixSetLink.getElementsByTagNameNS('*', 'TileMatrixSet')][0]?.textContent?.trim()
  const matrixSet = [...xml.getElementsByTagNameNS('*', 'TileMatrixSet')].find((node) =>
    [...node.getElementsByTagNameNS('*', 'Identifier')][0]?.textContent?.trim() === matrixSetId,
  )
  const matrices = matrixSet ? [...matrixSet.getElementsByTagNameNS('*', 'TileMatrix')] : []
  if (!styleId || !matrixSetId || !matrices.length) throw new Error('O catálogo não informou estilo ou matriz de tiles válidos.')

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
    throw new Error('A matriz WMTS não contém a geometria necessária para localizar o ponto.')
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
    throw new Error('As coordenadas estão fora da cobertura desta camada polar.')
  }

  const limit = matrixSetLink && [...matrixSetLink.getElementsByTagNameNS('*', 'TileMatrixLimits')].find((node) => value(node, 'TileMatrix') === matrixId)
  if (limit) {
    const minRow = Number(value(limit, 'MinTileRow'))
    const maxRow = Number(value(limit, 'MaxTileRow'))
    const minCol = Number(value(limit, 'MinTileCol'))
    const maxCol = Number(value(limit, 'MaxTileCol'))
    if (row < minRow || row > maxRow || col < minCol || col > maxCol) throw new Error('Esta coordenada não tem tile publicado nesta matriz.')
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
        throw new Error('O catálogo informou um endereço de tile fora do domínio HTTPS autorizado.')
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
  const [layerState, setLayerState] = useState<LayerState>({ status: 'loading', message: 'Consultando catálogo WMTS da NASA…' })
  const [tileLoaded, setTileLoaded] = useState(false)
  const [marker, setMarker] = useState<{ x: number; y: number } | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  function selectLayer(layer: TerrainLayer) {
    setSelected(layer)
    setTileLoaded(false)
    setMarker(null)
    setLayerState({ status: 'loading', message: 'Consultando catálogo WMTS da NASA…' })
  }

  useEffect(() => {
    const controller = new AbortController()
    async function requestLayer() {
      try {
        const response = await fetch(selected.capabilities, { signal: controller.signal })
        if (!response.ok) throw new Error(`Catálogo respondeu HTTP ${response.status}`)
        const xml = new DOMParser().parseFromString(await response.text(), 'application/xml')
        if (xml.querySelector('parsererror')) throw new Error('O catálogo retornou XML inválido.')
        const tile = findTileUrl(xml, selected.id, latitude, longitude)
        if (controller.signal.aborted) return
        setLayerState({ status: 'ready', message: 'Tiles ao redor do local encontrados no catálogo. Carregando…', tiles: tile.tiles })
        setMarker(tile.marker)
      } catch (error) {
        if (controller.signal.aborted) return
        setLayerState({ status: 'error', message: error instanceof Error ? error.message : 'Não foi possível consultar o catálogo WMTS.' })
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
      if (!context) throw new Error('Canvas indisponível')
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      const hasData = pixels.some((alpha, index) => index % 4 === 3 && alpha > 0)
      if (!hasData) {
        setLayerState({ status: 'error', message: 'O servidor entregou um tile sem pixels de dados para este local.' })
        return
      }
    } catch {
      // A successful image load still counts when the browser disallows canvas inspection.
    }
    setTileLoaded(true)
  }

  return (
    <section className="terrain-explorer" aria-label="Camadas lunares da API NASA Moon Trek">
      <div className="terrain-explorer-heading">
        <div><span className="panel-overline">DADOS DE MAPA · WMTS NASA</span><h3>Explore camadas do polo sul</h3></div>
        <a href="https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon" target="_blank" rel="noreferrer">Documentação da API ↗</a>
      </div>
      <div className="terrain-layer-tabs" role="tablist" aria-label="Camada de terreno">
        {layers.map((layer) => <button key={layer.id} type="button" role="tab" aria-selected={selected.id === layer.id} className={selected.id === layer.id ? 'selected' : ''} onClick={() => selectLayer(layer)}>{layer.title}</button>)}
      </div>
      <div className="terrain-map">
        {layerState.tiles && !tileLoaded && <div className="terrain-map-loading">Carregando mapa lunar ao redor do local…</div>}
        {layerState.tiles && <div className={`terrain-image-frame ${tileLoaded ? 'loaded' : 'pending'}`}>
          {layerState.tiles.map((tile) => <img key={`${tile.rowOffset}-${tile.colOffset}`} src={tile.url} alt="" crossOrigin="anonymous" style={{ left: `${50 - (marker?.x ?? 50) + tile.colOffset * 100}%`, top: `${50 - (marker?.y ?? 50) + tile.rowOffset * 100}%` }} onLoad={(event) => { if (tile.center) inspectLoadedTile(event.currentTarget) }} onError={() => { if (tile.center) setLayerState({ status: 'error', message: 'O catálogo respondeu, mas o tile central deste local não foi carregado. Verifique a cobertura ou a conexão com o serviço.' }) }} />)}
          {tileLoaded && <span className="terrain-site-marker" aria-label="Local selecionado" title="Local selecionado" />}
        </div>}
        {layerState.status === 'error' && <div className="terrain-map-fallback"><strong>Camada indisponível</strong><span>{layerState.message}</span><button type="button" onClick={() => { setLayerState({ status: 'loading', message: 'Consultando catálogo WMTS da NASA…' }); setRetryKey((value) => value + 1) }}>Tentar novamente</button><a href="https://trek.nasa.gov/moon/" target="_blank" rel="noreferrer">Abrir NASA Moon Trek ↗</a></div>}
        <span className="terrain-coordinate">LOCAL SELECIONADO · {latitude.toFixed(2)}°, {longitude.toFixed(2)}°</span>
        <a className="terrain-open-trek" href={`https://trek.nasa.gov/moon/?lat=${latitude}&lon=${longitude}`} target="_blank" rel="noreferrer">Abrir no Moon Trek ↗</a>
      </div>
      <div className="terrain-api-status" role="status"><span className={`api-status-dot ${layerState.status}`} />{tileLoaded ? 'Tile carregado do serviço WMTS da NASA.' : layerState.message}<code>{selected.id}</code></div>
      <p className="terrain-layer-description">{selected.description} A imagem, matriz e marcador são calculados para as coordenadas escolhidas a partir do catálogo WMTS público do Moon Trek.</p>
    </section>
  )
}
