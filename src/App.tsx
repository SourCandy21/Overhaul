import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { fetchSiteAnalysis, isApiConfigured } from './api/client'
import { buildMockAnalysis } from './api/mock'
import { MoonTerrainExplorer } from './components/MoonTerrainExplorer'
import { QuickMapExplorer } from './components/QuickMapExplorer'
import { ScenarioComparison } from './components/ScenarioComparison'
import { OperationalWindows } from './components/OperationalWindows'
import type { Observation, SiteAnalysis } from './types/analysis'
import './App.css'

type CelestialBody = 'sun' | 'earth'
type RequestState = 'idle' | 'loading' | 'success' | 'error'
type DataSource = 'api' | 'mock' | null

const currentLocalTime = new Date()
const today = new Date(currentLocalTime.getTime() - currentLocalTime.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
const HORIZONS_SYSTEM = 'https://ssd.jpl.nasa.gov/horizons/'
const HORIZONS_DOCS = 'https://ssd-api.jpl.nasa.gov/doc/horizons.html'
const MOON_TREK = 'https://trek.nasa.gov/moon/'
const QUICKMAP = 'https://quickmap.lroc.asu.edu/'

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    moon: 'M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z',
    pin: 'M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z M12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42',
    earth: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z',
    terrain: 'm12 3 9 16H3L12 3Z M12 9v4m0 3h.01',
    arrow: 'M7 17 17 7M7 7h10v10',
    orbit: 'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M12 2a10 10 0 1 0 10 10 M20 4l2 0 0 2',
    clock: 'M12 8v4l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
    refresh: 'M20 7v5h-5M4 17v-5h5 M5.6 9a7 7 0 0 1 11.7-2L20 12M4 12l2.7 5a7 7 0 0 0 11.7-2',
    check: 'm5 12 4 4L19 6',
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name] ?? paths.moon} /></svg>
}

function durationHours(step: string) {
  const match = step.match(/^(\d+(?:\.\d+)?)(m|h|d)$/i)
  if (!match) return 1
  const value = Number(match[1])
  return match[2].toLowerCase() === 'm' ? value / 60 : match[2].toLowerCase() === 'd' ? value * 24 : value
}

function visible(observation: Observation, body: CelestialBody) {
  const position = observation[body]
  if (position.above_local_horizon !== undefined) return position.above_local_horizon
  const horizon = observation.terrain?.available ? observation.terrain.horizon_elevation_deg : 0
  return position.elevation_deg > horizon
}

function hoursAboveHorizon(observations: Observation[], body: CelestialBody, stepHours: number) {
  if (observations.length < 2) return 0
  return observations.slice(0, -1).reduce((hours, item, index) => {
    const next = observations[index + 1]
    const first = item[body]
    const second = next[body]
    const elapsed = (Date.parse(next.time) - Date.parse(item.time)) / 3_600_000
    if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed > stepHours * 2) return hours
    const firstAbove = visible(item, body)
    const secondAbove = visible(next, body)
    if (firstAbove && secondAbove) return hours + elapsed
    if (!firstAbove && !secondAbove) return hours
    const firstHorizon = item.terrain?.available ? item.terrain.horizon_elevation_deg : 0
    const nextHorizon = next.terrain?.available ? next.terrain.horizon_elevation_deg : 0
    const firstMargin = first.elevation_deg - firstHorizon
    const nextMargin = second.elevation_deg - nextHorizon
    const difference = firstMargin - nextMargin
    const crossing = difference === 0 ? 0.5 : Math.max(0, Math.min(1, firstMargin / difference))
    return hours + elapsed * (firstAbove ? crossing : 1 - crossing)
  }, 0)
}

function horizonPoint(observation: Observation, body: CelestialBody) {
  const position = observation[body]
  const azimuth = (position.azimuth_deg - 90) * Math.PI / 180
  const radius = 1 - Math.max(0, Math.min(90, position.elevation_deg)) / 120
  return { x: 50 + Math.cos(azimuth) * radius * 43, y: 50 + Math.sin(azimuth) * radius * 43, elevation: position.elevation_deg, azimuth: position.azimuth_deg }
}

function App() {
  const [latitude, setLatitude] = useState('-89.50')
  const [longitude, setLongitude] = useState('0.00')
  const [altitude, setAltitude] = useState('0')
  const [startDate, setStartDate] = useState(today)
  const [duration, setDuration] = useState('24')
  const [step, setStep] = useState('1h')
  const [analysis, setAnalysis] = useState<SiteAnalysis | null>(null)
  const [requestState, setRequestState] = useState<RequestState>('idle')
  const [dataSource, setDataSource] = useState<DataSource>(null)
  const [pendingSource, setPendingSource] = useState<DataSource>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [body, setBody] = useState<CelestialBody>('sun')
  const [selectedObservation, setSelectedObservation] = useState(0)

  const points = useMemo(() => {
    if (!analysis) return []
    const key = body
    const values = analysis.observations.map((item, index) => ({
      time: item.time,
      elevation: item[key].elevation_deg,
      azimuth: item[key].azimuth_deg,
      visible: visible(item, key),
      x: analysis.observations.length < 2 ? 50 : (index / (analysis.observations.length - 1)) * 100,
      y: 100 - ((Math.max(-10, Math.min(90, item[key].elevation_deg)) + 10) / 100) * 100,
    }))
    return values
  }, [analysis, body])

  const linePoints = points.map((point) => `${point.x},${point.y}`).join(' ')
  const fillPoints = points.length ? `0,100 ${linePoints} 100,100` : ''
  const stepHours = durationHours(analysis?.interval.step ?? step)
  const sunlightHours = analysis?.summary?.sunlight_hours ?? (analysis ? hoursAboveHorizon(analysis.observations, 'sun', stepHours) : null)
  const earthHours = analysis?.summary?.earth_visibility_hours ?? (analysis ? hoursAboveHorizon(analysis.observations, 'earth', stepHours) : null)
  const horizonDataAvailable = Boolean(analysis?.observations.length && analysis.observations.every((item) => item.terrain?.available))
  const terrainAdjusted = analysis?.summary?.terrain_adjusted ?? false
  const horizon = analysis?.observations[selectedObservation] ? horizonPoint(analysis.observations[selectedObservation], body) : null
  const apiConfigured = isApiConfigured()

  function getRequestParams() {
    const start = new Date(startDate)
    const end = new Date(start.getTime() + Number(duration) * 60 * 60 * 1000)
    return {
      latitude: Number(latitude),
      longitude: Number(longitude),
      altitude_m: Number(altitude),
      start: start.toISOString(),
      end: end.toISOString(),
      step,
    }
  }

  async function runAnalysis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAnalysis(null)
    setErrorMessage('')
    setDataSource(null)
    setPendingSource('api')
    setRequestState('loading')
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 30_000)

    try {
      const result = await fetchSiteAnalysis({
        ...getRequestParams(),
        signal: controller.signal,
      })
      setAnalysis(result)
      setSelectedObservation(0)
      setDataSource('api')
      setRequestState('success')
    } catch (error) {
      setRequestState('error')
      if (error instanceof DOMException && error.name === 'AbortError') {
        setErrorMessage('A consulta excedeu 30 segundos. Verifique o serviço de análise e tente novamente.')
      } else {
        setErrorMessage(error instanceof Error ? error.message : 'Não foi possível consultar a análise.')
      }
    } finally {
      window.clearTimeout(timeout)
      setPendingSource(null)
    }
  }

  async function runMockAnalysis() {
    setAnalysis(null)
    setErrorMessage('')
    setDataSource(null)
    setPendingSource('mock')
    setRequestState('loading')
    await new Promise((resolve) => window.setTimeout(resolve, 420))
    try {
      setAnalysis(buildMockAnalysis(getRequestParams()))
      setSelectedObservation(0)
      setDataSource('mock')
      setRequestState('success')
    } catch (error) {
      setRequestState('error')
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível gerar os dados de demonstração.')
    } finally {
      setPendingSource(null)
    }
  }

  return (
    <div className="navigator-app">
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="Overhaul — início"><span className="wordmark-symbol"><Icon name="moon" size={20} /></span><span>OVERHAUL</span></a>
        <nav className="header-nav" aria-label="Navegação principal"><a className="active" href="#analysis">Navegador</a><a href="#sources">Terreno e fontes</a></nav>
        <div className={`connection-state ${requestState === 'success' ? dataSource === 'mock' ? 'mocked' : 'connected' : requestState === 'error' ? 'disconnected' : ''}`}><span />{requestState === 'success' ? dataSource === 'mock' ? 'Dados simulados' : 'API atualizada' : requestState === 'error' ? 'Serviço indisponível' : apiConfigured ? 'API configurada' : 'API não configurada'}</div>
      </header>

      <main id="top" className="page-content">
        <section className="hero-section">
          <div className="hero-copy"><div className="overline"><span /> NAVEGADOR DE LOCAIS DE POUSO LUNARES</div><h1>Uma janela para<br /><em>o horizonte lunar.</em></h1><p>Compare a luz solar e a visibilidade da Terra no polo sul da Lua, ao longo do tempo.</p><a className="hero-link" href="#analysis">Começar uma análise <span>↓</span></a></div>
          <div className="hero-visual" aria-hidden="true"><div className="hero-orbit orbit-a" /><div className="hero-orbit orbit-b" /><div className="hero-moon"><div className="crater crater-a" /><div className="crater crater-b" /><div className="crater crater-c" /></div><div className="orbit-sun" /><div className="hero-coordinates">89° 30′ S<br />0° 00′ E</div><div className="hero-caption">POLO SUL · VISTA ORBITAL</div></div>
          <div className="hero-index"><span>01</span> / 03</div>
        </section>

        <section className="analysis-section" id="analysis">
          <div className="section-heading"><div><span className="section-number">01</span><div><h2>Defina o local e o período</h2><p>A consulta reúne as efemérides do Sol e da Terra para estas coordenadas.</p></div></div><span className="unit-caption">COORDENADAS LUNARES · GRAUS</span></div>
          <form className="query-form" onSubmit={runAnalysis} onChange={() => { if (requestState !== 'loading') { setAnalysis(null); setDataSource(null); setErrorMessage(''); setRequestState('idle') } }}>
            <fieldset className="coordinate-group" disabled={requestState === 'loading'}><legend>Local de observação</legend><label><span>Latitude</span><div className="input-with-unit"><input type="number" min="-90" max="90" step="0.01" required value={latitude} onChange={(event) => setLatitude(event.target.value)} /><small>°</small></div></label><label><span>Longitude</span><div className="input-with-unit"><input type="number" min="-180" max="180" step="0.01" required value={longitude} onChange={(event) => setLongitude(event.target.value)} /><small>°</small></div></label><label><span>Altitude</span><div className="input-with-unit"><input type="number" step="1" required value={altitude} onChange={(event) => setAltitude(event.target.value)} /><small>m</small></div></label></fieldset>
            <label className="form-control date-time-control"><span>Data e hora inicial · seu fuso</span><input type="datetime-local" required disabled={requestState === 'loading'} value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
            <label className="form-control"><span>Duração</span><select disabled={requestState === 'loading'} value={duration} onChange={(event) => setDuration(event.target.value)}><option value="12">12 horas</option><option value="24">24 horas</option><option value="48">48 horas</option><option value="72">72 horas</option></select></label>
            <label className="form-control interval-control"><span>Intervalo</span><select disabled={requestState === 'loading'} value={step} onChange={(event) => setStep(event.target.value)}><option value="30m">30 minutos</option><option value="1h">1 hora</option><option value="2h">2 horas</option><option value="4h">4 horas</option></select></label>
            <button className="query-button" type="submit" disabled={requestState === 'loading'}>{requestState === 'loading' && pendingSource === 'api' ? <span className="spinner" /> : <Icon name="orbit" size={17} />}{requestState === 'loading' && pendingSource === 'api' ? 'Consultando…' : 'Consultar API'}</button><button className="mock-button" type="button" disabled={requestState === 'loading'} onClick={runMockAnalysis}>{requestState === 'loading' && pendingSource === 'mock' ? <span className="spinner" /> : <Icon name="orbit" size={16} />}{requestState === 'loading' && pendingSource === 'mock' ? 'Preparando…' : 'Testar com dados mockados'}</button>
          </form>

          <ScenarioComparison draft={{ latitude: Number(latitude), longitude: Number(longitude), altitude_m: Number(altitude), startDateTime: startDate, durationHours: Number(duration), step }} apiConfigured={apiConfigured} />
          <OperationalWindows observations={analysis?.observations ?? []} selectedIndex={selectedObservation} onSelectIndex={setSelectedObservation} />

          {!apiConfigured && requestState === 'idle' && <div className="request-message setup-message" role="status"><span className="message-symbol">i</span><div><strong>Configure o serviço de análise</strong><p>O navegador consulta o backend configurado em <code>VITE_API_BASE_URL</code>. O backend deve chamar o Horizons no servidor; a JPL não permite chamadas embutidas diretamente no navegador.</p></div></div>}
          {requestState === 'loading' && <div className="request-message loading-message" role="status" aria-live="polite"><span className="spinner" /><div><strong>{pendingSource === 'mock' ? 'Preparando uma análise de demonstração' : 'Calculando posições celestes'}</strong><p>{pendingSource === 'mock' ? 'Gerando uma série ilustrativa para preencher os gráficos, a bússola e a tabela.' : 'Buscando as séries do Sol e da Terra para o período selecionado.'}</p></div></div>}
          {requestState === 'error' && <div className="request-message error-message" role="alert"><span className="message-symbol">!</span><div><strong>A análise não foi concluída</strong><p>{errorMessage}</p></div><button type="button" onClick={(event) => { const form = event.currentTarget.closest('.analysis-section')?.querySelector('form'); form?.requestSubmit() }}><Icon name="refresh" size={15} /> Tentar novamente</button></div>}

          {analysis ? <>
            {dataSource === 'mock' && <div className="mock-banner" role="status"><span className="mock-banner-icon">✳</span><div><strong>Modo de demonstração</strong><p>Estes dados são fictícios e servem apenas para testar a interface. Nenhuma requisição científica foi feita.</p></div><button type="button" onClick={() => { setAnalysis(null); setDataSource(null); setRequestState('idle') }}>Limpar demonstração</button></div>}
            <div className="results-meta"><span className="result-dot" /> {dataSource === 'mock' ? 'DADOS SIMULADOS' : 'RESULTADOS RECEBIDOS'} <span>·</span> {analysis.observations.length} observações <span>·</span> {analysis.interval.step} <span className="result-time">{analysis.interval.start} — {analysis.interval.end}</span></div>
            <section className="summary-strip" aria-label="Resumo da análise"><article className="summary-item sunlight-summary"><div className="summary-label"><Icon name="sun" size={16} /> Horas com Sol acima do horizonte</div><strong>{sunlightHours?.toFixed(1) ?? '—'}<small>h</small></strong><span>{terrainAdjusted ? 'Resumo ajustado pelo terreno' : 'Geométrico · horizonte de referência = 0°'}</span></article><article className="summary-item earth-summary"><div className="summary-label"><Icon name="earth" size={16} /> Visibilidade da Terra</div><strong>{earthHours?.toFixed(1) ?? '—'}<small>h</small></strong><span>{terrainAdjusted ? 'Resumo ajustado pelo terreno' : 'Sem correção de obstruções do relevo'}</span></article><article className="summary-item terrain-summary"><div className="summary-label"><Icon name="terrain" size={16} /> Horizonte do terreno</div><strong>{horizonDataAvailable ? 'Disponível' : 'Pendente'}</strong><span>{horizonDataAvailable ? 'Horizonte local informado pelo serviço' : 'Aguardando dados de elevação local'}</span></article></section>

            <section className="visualization-layout" aria-label="Visualizações da análise"><article className="ephemeris-panel"><div className="panel-heading"><div><span className="panel-overline">SÉRIE TEMPORAL</span><h3>Elevação em relação ao horizonte</h3></div><div className="body-tabs" role="tablist" aria-label="Astro exibido">{(['sun', 'earth'] as CelestialBody[]).map((item) => <button key={item} type="button" role="tab" aria-selected={body === item} className={body === item ? `selected ${item}` : ''} onClick={() => setBody(item)}><Icon name={item} size={15} />{item === 'sun' ? 'Sol' : 'Terra'}</button>)}</div></div><p className="chart-location"><Icon name="pin" size={13} />{analysis.site.name} · {analysis.site.latitude.toFixed(2)}°, {analysis.site.longitude.toFixed(2)}°</p>
                {points.length ? <><div className="chart-key"><span className={body}><i />Elevação do {body === 'sun' ? 'Sol' : 'Terra'}</span><span><i className="horizon-key" />Horizonte geométrico · 0°</span><span className="chart-unit">GRAUS</span></div><div className="chart-area"><div className="chart-y-axis"><span>90°</span><span>60°</span><span>30°</span><span>0°</span><span>−10°</span></div><div className="chart-plot"><div className="plot-grid grid-90" /><div className="plot-grid grid-60" /><div className="plot-grid grid-30" /><div className="plot-horizon" /><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`Elevação do ${body === 'sun' ? 'Sol' : 'Terra'} em ${points.length} observações`}><defs><linearGradient id="ephemeris-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={body === 'sun' ? '#e4b960' : '#8baac4'} stopOpacity=".17" /><stop offset="1" stopColor={body === 'sun' ? '#e4b960' : '#8baac4'} stopOpacity="0" /></linearGradient></defs><polygon points={fillPoints} fill="url(#ephemeris-fill)" /><polyline points={linePoints} className={`ephemeris-line ${body}`} vectorEffect="non-scaling-stroke" />{points.map((point, index) => <circle key={`${point.time}-${index}`} cx={point.x} cy={point.y} r="1.35" className={`ephemeris-point ${body} ${selectedObservation === index ? 'active' : ''}`} vectorEffect="non-scaling-stroke" />)}</svg><div className="chart-scrubber" role="slider" aria-label="Selecionar observação" aria-valuemin={0} aria-valuemax={Math.max(0, points.length - 1)} aria-valuenow={selectedObservation} tabIndex={0} style={{ left: `${points[selectedObservation]?.x ?? 0}%` }} onKeyDown={(event) => { if (event.key === 'ArrowRight') setSelectedObservation((value) => Math.min(points.length - 1, value + 1)); if (event.key === 'ArrowLeft') setSelectedObservation((value) => Math.max(0, value - 1)) }} onPointerDown={(event) => { const rect = event.currentTarget.parentElement?.getBoundingClientRect(); if (!rect || points.length < 2) return; const update = (clientX: number) => setSelectedObservation(Math.round(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * (points.length - 1))); update(event.clientX); const move = (moveEvent: PointerEvent) => update(moveEvent.clientX); const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }; window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true }) }} /></div></div><div className="chart-x-axis"><span>{new Date(analysis.interval.start).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC</span><span>{new Date(analysis.interval.end).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC</span></div><div className="selected-reading"><span>{new Date(points[selectedObservation]?.time ?? analysis.interval.start).toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC</span><span><b>{points[selectedObservation]?.elevation.toFixed(1)}°</b> elevação</span><span><b>{points[selectedObservation]?.azimuth.toFixed(1)}°</b> azimute</span><span className={points[selectedObservation]?.visible ? 'above-horizon' : 'below-horizon'}>{points[selectedObservation]?.visible ? 'Acima do horizonte' : 'Abaixo do horizonte'}</span></div></> : <div className="empty-chart">A resposta da API não contém observações para exibir.</div>}
                <div className="science-footnote"><span>i</span>Posição geométrica do astro. O bloqueio por montanhas ou crateras só pode ser avaliado com dados de horizonte local.</div>
              </article>
              <aside className="sky-panel"><div className="panel-heading"><div><span className="panel-overline">CÉU LOCAL</span><h3>Direção do astro</h3></div><span className="live-reading">{horizon ? `${horizon.azimuth.toFixed(0)}° AZ` : '—'}</span></div><div className="sky-dial"><div className="dial-ring ring-outer" /><div className="dial-ring ring-mid" /><div className="dial-ring ring-inner" /><span className="dial-axis axis-h" /><span className="dial-axis axis-v" /><span className="dial-direction north">N</span><span className="dial-direction east">E</span><span className="dial-direction south">S</span><span className="dial-direction west">W</span>{horizon && <span className={`sky-body ${body}`} style={{ left: `${horizon.x}%`, top: `${horizon.y}%` }}><Icon name={body} size={17} /></span>}<div className="dial-center"><Icon name="pin" size={14} /></div><span className="dial-horizon-label">HORIZONTE · 0°</span></div><div className="sky-reading"><div><span>Elevação</span><strong>{horizon ? `${horizon.elevation.toFixed(1)}°` : '—'}</strong></div><div><span>Azimute</span><strong>{horizon ? `${horizon.azimuth.toFixed(1)}°` : '—'}</strong></div></div><p className="sky-caption">O marcador acompanha o ponto selecionado na série temporal.</p></aside></section>

            <section className="observations-panel"><div className="panel-heading"><div><span className="panel-overline">DADOS DA RESPOSTA</span><h3>Observações</h3></div><span className="table-count">{analysis.observations.length} pontos</span></div><div className="table-scroll"><table><thead><tr><th>Horário · UTC</th><th>Sol · elevação</th><th>Sol · azimute</th><th>Terra · elevação</th><th>Terra · azimute</th><th>Terreno</th></tr></thead><tbody>{analysis.observations.slice(0, 12).map((item, index) => <tr key={`${item.time}-${index}`}><td>{new Date(item.time).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' })}</td><td>{item.sun.elevation_deg.toFixed(2)}°</td><td>{item.sun.azimuth_deg.toFixed(2)}°</td><td>{item.earth.elevation_deg.toFixed(2)}°</td><td>{item.earth.azimuth_deg.toFixed(2)}°</td><td>{item.terrain?.available ? `${item.terrain.horizon_elevation_deg.toFixed(1)}°` : '—'}</td></tr>)}</tbody></table></div>{analysis.observations.length > 12 && <p className="table-caption">Exibindo 12 de {analysis.observations.length} observações. A série completa está disponível para o gráfico.</p>}</section>
          </> : requestState !== 'loading' && <section className="empty-state"><div className="empty-orbit"><Icon name="orbit" size={28} /></div><div><span className="panel-overline">AGUARDANDO CONSULTA</span><h3>O horizonte começa com uma coordenada.</h3><p>Informe um ponto lunar e o período da missão para consultar as posições do Sol e da Terra. Os resultados aparecerão aqui quando a API responder.</p></div></section>}
        </section>

        <MoonTerrainExplorer latitude={Number(analysis?.site.latitude ?? latitude)} longitude={Number(analysis?.site.longitude ?? longitude)} />
        <QuickMapExplorer latitude={Number(analysis?.site.latitude ?? latitude)} longitude={Number(analysis?.site.longitude ?? longitude)} />

        <section className="sources-section" id="sources"><div className="sources-title"><div><span className="section-number">02</span><div><h2>Recursos do desafio</h2><p>Use cada ferramenta para a camada de informação que ela oferece.</p></div></div></div><div className="source-list"><div className="source-row horizons-source"><span className="source-icon source-sun"><Icon name="sun" size={18} /></span><span className="source-details"><strong>JPL Horizons</strong><small>Efemérides do Sol e da Terra para o local e o período</small></span><span className="source-links"><a className="source-action" href={HORIZONS_SYSTEM} target="_blank" rel="noreferrer" aria-label="Abrir interface web do JPL Horizons" title="Interface web do Horizons">Interface web <Icon name="arrow" size={14} /></a><a className="source-action" href={HORIZONS_DOCS} target="_blank" rel="noreferrer" aria-label="Abrir documentação da API do Horizons" title="Documentação da API do Horizons">Documentação da API <Icon name="arrow" size={14} /></a></span></div><a href={MOON_TREK} target="_blank" rel="noreferrer" className="source-row"><span className="source-icon source-moon"><Icon name="moon" size={18} /></span><span className="source-details"><strong>NASA Moon Trek</strong><small>Visualização 3D de elevação, iluminação e terreno lunar</small></span><span className="source-action">Abrir Moon Trek <Icon name="arrow" size={14} /></span></a><a href={QUICKMAP} target="_blank" rel="noreferrer" className="source-row"><span className="source-icon source-map"><Icon name="terrain" size={18} /></span><span className="source-details"><strong>LROC QuickMap · ASU</strong><small>Imagens da Lunar Reconnaissance Orbiter, topografia e dados de superfície</small></span><span className="source-action">Abrir QuickMap <Icon name="arrow" size={14} /></span></a></div><p className="source-disclaimer">Horizons fornece posições celestes; Moon Trek e QuickMap ajudam a explorar o relevo. A posição geométrica não inclui bloqueios por montanhas ou crateras.</p></section>

        <footer className="site-footer"><a className="wordmark footer-mark" href="#top"><span className="wordmark-symbol"><Icon name="moon" size={17} /></span><span>OVERHAUL</span></a><span>Navegador lunar · Hackathon</span><a href="#analysis">Nova análise ↑</a></footer>
      </main>
    </div>
  )
}

export default App
