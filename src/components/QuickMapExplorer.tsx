import { useEffect, useMemo, useState } from 'react'

const WMS_ENDPOINT = 'https://wms.im-ldi.com/'
const QUICKMAP_URL = 'https://quickmap.lroc.im-ldi.com/'
const MAP_WIDTH = 1024
const MAP_HEIGHT = 560

const quickMapLayers = [
  { id: 'luna_wac_global', label: 'Orbital imagery', note: 'Global mosaic of LROC Wide Angle Camera imagery.' },
  { id: 'luna_wac_dtm_hillshade', label: 'Terrain', note: 'GLD100 digital terrain model with topographic hillshade.' },
  { id: 'luna_polar_illumination_pct', label: 'Polar illumination', note: 'WAC percentage illumination layer for the lunar poles.' },
]

type RequestStatus = { state: 'loading' | 'ready' | 'error'; message: string }

function getDirectChildText(parent: Element, name: string) {
  return [...parent.children].find((child) => child.localName === name)?.textContent?.trim()
}

export function QuickMapExplorer({ latitude, longitude }: { latitude: number; longitude: number }) {
  const [selectedLayer, setSelectedLayer] = useState(quickMapLayers[1])
  const [rangeKm, setRangeKm] = useState(160)
  const [catalog, setCatalog] = useState<RequestStatus>({ state: 'loading', message: 'Loading the LROC WMS catalog…' })
  const [availableLayers, setAvailableLayers] = useState<Set<string>>(new Set())
  const [map, setMap] = useState<RequestStatus>({ state: 'loading', message: 'Preparing map request…' })
  const [imageUrl, setImageUrl] = useState('')
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    async function loadCatalog() {
      try {
        const query = new URLSearchParams({ SERVICE: 'WMS', REQUEST: 'GetCapabilities', VERSION: '1.1.1' })
        const response = await fetch(`${WMS_ENDPOINT}?${query}`, { signal: controller.signal, headers: { Accept: 'application/vnd.ogc.wms_xml, application/xml, text/xml' } })
        if (!response.ok) throw new Error(`WMS catalog returned HTTP ${response.status}.`)
        const xml = new DOMParser().parseFromString(await response.text(), 'application/xml')
        if (xml.querySelector('parsererror') || xml.documentElement.localName === 'ServiceExceptionReport') throw new Error('The service returned an invalid WMS catalog.')
        const names = new Set([...xml.getElementsByTagName('Layer')].map((layer) => getDirectChildText(layer, 'Name')).filter((name): name is string => Boolean(name)))
        if (!names.size) throw new Error('The WMS catalog did not advertise any usable layers.')
        setAvailableLayers(names)
        setCatalog({ state: 'ready', message: `${names.size} layers available in the LROC WMS catalog.` })
      } catch (error) {
        if (controller.signal.aborted) return
        setCatalog({ state: 'error', message: error instanceof Error ? error.message : 'Could not load the WMS catalog.' })
      }
    }
    void loadCatalog()
    return () => controller.abort()
  }, [retryKey])

  const getMapUrl = useMemo(() => {
    const halfWidth = rangeKm * 500
    const halfHeight = halfWidth * MAP_HEIGHT / MAP_WIDTH
    const query = new URLSearchParams({
      SERVICE: 'WMS',
      VERSION: '1.1.1',
      REQUEST: 'GetMap',
      LAYERS: selectedLayer.id,
      STYLES: '',
      SRS: `AUTO:42003,9001,${longitude},${latitude}`,
      BBOX: `${-halfWidth},${-halfHeight},${halfWidth},${halfHeight}`,
      WIDTH: String(MAP_WIDTH),
      HEIGHT: String(MAP_HEIGHT),
      FORMAT: 'image/png',
      TRANSPARENT: 'FALSE',
    })
    return `${WMS_ENDPOINT}?${query}`
  }, [latitude, longitude, rangeKm, selectedLayer.id])

  useEffect(() => {
    if (catalog.state !== 'ready') return

    const controller = new AbortController()
    let objectUrl = ''
    async function requestMap() {
      setMap({ state: 'loading', message: 'Requesting an image from the LROC WMS service…' })
      setImageUrl('')
      try {
        if (!availableLayers.has(selectedLayer.id)) {
          throw new Error(`A camada ${selectedLayer.id} was not advertised by the service.`)
        }
        const response = await fetch(getMapUrl, { signal: controller.signal, headers: { Accept: 'image/png' } })
        if (!response.ok) throw new Error(`GetMap returned HTTP ${response.status}.`)
        const contentType = response.headers.get('content-type') ?? ''
        if (!contentType.toLowerCase().startsWith('image/')) {
          const serviceMessage = (await response.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
          throw new Error(serviceMessage.slice(0, 240) || 'The service did not return a map image.')
        }
        objectUrl = URL.createObjectURL(await response.blob())
        setImageUrl(objectUrl)
        setMap({ state: 'ready', message: 'Map image received from the LROC WMS for the selected location.' })
      } catch (error) {
        if (controller.signal.aborted) return
        setMap({ state: 'error', message: error instanceof Error ? error.message : 'Could not load the LROC map.' })
      }
    }
    void requestMap()
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [availableLayers, catalog.state, getMapUrl, retryKey, selectedLayer.id])

  function retryService() {
    setCatalog({ state: 'loading', message: 'Refreshing WMS catalog…' })
    setMap({ state: 'loading', message: 'Preparing a new request…' })
    setAvailableLayers(new Set())
    setRetryKey((value) => value + 1)
  }

  return (
    <section className="quickmap-explorer" aria-label="QuickMap with LROC data via WMS">
      <div className="quickmap-heading">
        <div><span className="panel-overline">LUNAR TERRAIN · LROC DATA</span><h3>Surface at the selected location</h3><p>Terrain map centered on the scenario coordinates, retrieved in real time via WMS.</p></div>
        <a href={QUICKMAP_URL} target="_blank" rel="noreferrer">Explore in QuickMap ↗</a>
      </div>
      <div className="quickmap-controls" role="tablist" aria-label="QuickMap layer">
        {quickMapLayers.map((layer) => <button key={layer.id} type="button" role="tab" aria-selected={selectedLayer.id === layer.id} className={selectedLayer.id === layer.id ? 'selected' : ''} onClick={() => setSelectedLayer(layer)}>{layer.label}</button>)}
        <div className="quickmap-zoom" aria-label="Map scale"><button type="button" aria-label="Zoom in" disabled={rangeKm <= 80} onClick={() => setRangeKm((value) => Math.max(80, value / 2))}>−</button><span>{rangeKm} km</span><button type="button" aria-label="Zoom out" disabled={rangeKm >= 640} onClick={() => setRangeKm((value) => Math.min(640, value * 2))}>+</button></div>
      </div>
      <div className={`quickmap-frame ${map.state}`}>
        {imageUrl && <img src={imageUrl} alt={`${selectedLayer.label} near ${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°`} />}
        {catalog.state === 'loading' && <div className="quickmap-overlay"><span className="spinner" />{catalog.message}</div>}
        {catalog.state === 'error' && <div className="quickmap-overlay quickmap-error"><strong>Catalog unavailable</strong><span>{catalog.message}</span><button type="button" onClick={retryService}>Try again</button></div>}
        {catalog.state === 'ready' && map.state === 'loading' && <div className="quickmap-overlay"><span className="spinner" />{map.message}</div>}
        {catalog.state === 'ready' && map.state === 'error' && <div className="quickmap-overlay quickmap-error"><strong>Map could not be loaded</strong><span>{map.message}</span><button type="button" onClick={retryService}>Try again</button></div>}
        {map.state === 'ready' && <span className="quickmap-center-marker" aria-label="Map center: selected location" title="Selected location" />}
        {map.state === 'ready' && <div className="quickmap-scale" aria-label={`Approximate scale: ${Math.round(rangeKm / 4)} kilometers`}><span />{Math.round(rangeKm / 4)} km</div>}
        <span className="quickmap-coordinate">CENTRO · {latitude.toFixed(3)}°, {longitude.toFixed(3)}°</span>
        <span className="quickmap-layer-credit">{selectedLayer.label} · LROC</span>
      </div>
      <div className="quickmap-status" role="status"><span className={`api-status-dot ${map.state}`} /><span>{catalog.state === 'error' ? catalog.message : map.state === 'ready' ? `${catalog.message} ${map.message}` : map.message}</span></div>
      <p className="quickmap-layer-note">{selectedLayer.note} The marker centers the selected point. Open the full QuickMap in a new tab for advanced browsing and data queries.</p>
    </section>
  )
}
