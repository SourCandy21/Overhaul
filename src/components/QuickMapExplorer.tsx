import { useEffect, useMemo, useState } from 'react'

const WMS_ENDPOINT = 'https://wms.im-ldi.com/'
const QUICKMAP_URL = 'https://quickmap.lroc.im-ldi.com/'
const MAP_WIDTH = 1024
const MAP_HEIGHT = 560

const quickMapLayers = [
  { id: 'luna_wac_global', label: 'Imagem orbital', note: 'Mosaico global de imagens LROC Wide Angle Camera.' },
  { id: 'luna_wac_dtm_hillshade', label: 'Relevo', note: 'Modelo digital de terreno GLD100 com sombreamento topográfico.' },
  { id: 'luna_polar_illumination_pct', label: 'Iluminação polar', note: 'Camada de iluminação percentual WAC dos polos lunares.' },
]

type RequestStatus = { state: 'loading' | 'ready' | 'error'; message: string }

function getDirectChildText(parent: Element, name: string) {
  return [...parent.children].find((child) => child.localName === name)?.textContent?.trim()
}

export function QuickMapExplorer({ latitude, longitude }: { latitude: number; longitude: number }) {
  const [selectedLayer, setSelectedLayer] = useState(quickMapLayers[1])
  const [rangeKm, setRangeKm] = useState(160)
  const [catalog, setCatalog] = useState<RequestStatus>({ state: 'loading', message: 'Consultando o catálogo WMS da LROC…' })
  const [availableLayers, setAvailableLayers] = useState<Set<string>>(new Set())
  const [map, setMap] = useState<RequestStatus>({ state: 'loading', message: 'Preparando requisição do mapa…' })
  const [imageUrl, setImageUrl] = useState('')
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    async function loadCatalog() {
      try {
        const query = new URLSearchParams({ SERVICE: 'WMS', REQUEST: 'GetCapabilities', VERSION: '1.1.1' })
        const response = await fetch(`${WMS_ENDPOINT}?${query}`, { signal: controller.signal, headers: { Accept: 'application/vnd.ogc.wms_xml, application/xml, text/xml' } })
        if (!response.ok) throw new Error(`Catálogo WMS respondeu HTTP ${response.status}.`)
        const xml = new DOMParser().parseFromString(await response.text(), 'application/xml')
        if (xml.querySelector('parsererror') || xml.documentElement.localName === 'ServiceExceptionReport') throw new Error('O serviço retornou um catálogo WMS inválido.')
        const names = new Set([...xml.getElementsByTagName('Layer')].map((layer) => getDirectChildText(layer, 'Name')).filter((name): name is string => Boolean(name)))
        if (!names.size) throw new Error('O catálogo WMS não anunciou camadas utilizáveis.')
        setAvailableLayers(names)
        setCatalog({ state: 'ready', message: `${names.size} camadas disponíveis no catálogo WMS da LROC.` })
      } catch (error) {
        if (controller.signal.aborted) return
        setCatalog({ state: 'error', message: error instanceof Error ? error.message : 'Não foi possível consultar o catálogo WMS.' })
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
      setMap({ state: 'loading', message: 'Solicitando imagem ao serviço WMS da LROC…' })
      setImageUrl('')
      try {
        if (!availableLayers.has(selectedLayer.id)) {
          throw new Error(`A camada ${selectedLayer.id} não foi anunciada pelo serviço.`)
        }
        const response = await fetch(getMapUrl, { signal: controller.signal, headers: { Accept: 'image/png' } })
        if (!response.ok) throw new Error(`GetMap respondeu HTTP ${response.status}.`)
        const contentType = response.headers.get('content-type') ?? ''
        if (!contentType.toLowerCase().startsWith('image/')) {
          const serviceMessage = (await response.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
          throw new Error(serviceMessage.slice(0, 240) || 'O serviço não retornou uma imagem de mapa.')
        }
        objectUrl = URL.createObjectURL(await response.blob())
        setImageUrl(objectUrl)
        setMap({ state: 'ready', message: 'Imagem recebida do WMS da LROC para o local selecionado.' })
      } catch (error) {
        if (controller.signal.aborted) return
        setMap({ state: 'error', message: error instanceof Error ? error.message : 'Não foi possível carregar o mapa da LROC.' })
      }
    }
    void requestMap()
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [availableLayers, catalog.state, getMapUrl, retryKey, selectedLayer.id])

  function retryService() {
    setCatalog({ state: 'loading', message: 'Atualizando catálogo WMS…' })
    setMap({ state: 'loading', message: 'Preparando nova requisição…' })
    setAvailableLayers(new Set())
    setRetryKey((value) => value + 1)
  }

  return (
    <section className="quickmap-explorer" aria-label="Mapa QuickMap com dados LROC por WMS">
      <div className="quickmap-heading">
        <div><span className="panel-overline">TERRENO LUNAR · DADOS LROC</span><h3>Superfície no local selecionado</h3><p>Mapa do relevo centrado nas coordenadas do cenário, consultado em tempo real via WMS.</p></div>
        <a href={QUICKMAP_URL} target="_blank" rel="noreferrer">Explorar no QuickMap ↗</a>
      </div>
      <div className="quickmap-controls" role="tablist" aria-label="Camada do mapa QuickMap">
        {quickMapLayers.map((layer) => <button key={layer.id} type="button" role="tab" aria-selected={selectedLayer.id === layer.id} className={selectedLayer.id === layer.id ? 'selected' : ''} onClick={() => setSelectedLayer(layer)}>{layer.label}</button>)}
        <div className="quickmap-zoom" aria-label="Escala do mapa"><button type="button" aria-label="Aproximar mapa" disabled={rangeKm <= 80} onClick={() => setRangeKm((value) => Math.max(80, value / 2))}>−</button><span>{rangeKm} km</span><button type="button" aria-label="Afastar mapa" disabled={rangeKm >= 640} onClick={() => setRangeKm((value) => Math.min(640, value * 2))}>+</button></div>
      </div>
      <div className={`quickmap-frame ${map.state}`}>
        {imageUrl && <img src={imageUrl} alt={`${selectedLayer.label} da região em ${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°`} />}
        {catalog.state === 'loading' && <div className="quickmap-overlay"><span className="spinner" />{catalog.message}</div>}
        {catalog.state === 'error' && <div className="quickmap-overlay quickmap-error"><strong>Catálogo indisponível</strong><span>{catalog.message}</span><button type="button" onClick={retryService}>Tentar novamente</button></div>}
        {catalog.state === 'ready' && map.state === 'loading' && <div className="quickmap-overlay"><span className="spinner" />{map.message}</div>}
        {catalog.state === 'ready' && map.state === 'error' && <div className="quickmap-overlay quickmap-error"><strong>O mapa não foi carregado</strong><span>{map.message}</span><button type="button" onClick={retryService}>Tentar novamente</button></div>}
        {map.state === 'ready' && <span className="quickmap-center-marker" aria-label="Centro do mapa: local selecionado" title="Local selecionado" />}
        {map.state === 'ready' && <div className="quickmap-scale" aria-label={`Escala aproximada: ${Math.round(rangeKm / 4)} quilômetros`}><span />{Math.round(rangeKm / 4)} km</div>}
        <span className="quickmap-coordinate">CENTRO · {latitude.toFixed(3)}°, {longitude.toFixed(3)}°</span>
        <span className="quickmap-layer-credit">{selectedLayer.label} · LROC</span>
      </div>
      <div className="quickmap-status" role="status"><span className={`api-status-dot ${map.state}`} /><span>{catalog.state === 'error' ? catalog.message : map.state === 'ready' ? `${catalog.message} ${map.message}` : map.message}</span></div>
      <p className="quickmap-layer-note">{selectedLayer.note} O marcador fixa o ponto escolhido no centro. O QuickMap completo abre em outra aba para navegação e consulta avançadas.</p>
    </section>
  )
}
