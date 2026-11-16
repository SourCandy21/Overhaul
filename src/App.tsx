import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { fetchSiteAnalysis, isApiConfigured } from './api/client'
import { MoonTerrainExplorer } from './components/MoonTerrainExplorer'
import { QuickMapExplorer } from './components/QuickMapExplorer'
import { ScenarioComparison } from './components/ScenarioComparison'
import { OperationalWindows } from './components/OperationalWindows'
import { LolaReferenceSites } from './components/LolaReferenceSites'
import type { LolaReferenceSite } from './data/lolaReferenceSites'
import type { Observation, SiteAnalysis } from './types/analysis'
import './App.css'

type CelestialBody = 'sun' | 'earth'
type RequestState = 'idle' | 'loading' | 'success' | 'error'

const currentLocalTime = new Date()
const today = new Date(currentLocalTime.getTime() - currentLocalTime.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
const HORIZONS_SYSTEM = 'https://ssd.jpl.nasa.gov/horizons/'
const HORIZONS_DOCS = 'https://ssd-api.jpl.nasa.gov/doc/horizons.html'
const MOON_TREK = 'https://trek.nasa.gov/moon/'
const QUICKMAP = 'https://quickmap.lroc.im-ldi.com/'

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
  const horizon = observation.terrain?.available ? observation.terrain.horizon_elevation_deg : observation.geometric_horizon_elevation_deg ?? 0
  return position.elevation_deg > horizon
}

function getHorizonElevation(observation: Observation) {
  return observation.terrain?.available ? observation.terrain.horizon_elevation_deg : observation.geometric_horizon_elevation_deg ?? 0
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
    const firstHorizon = getHorizonElevation(item)
    const nextHorizon = getHorizonElevation(next)
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
  const horizonElevation = getHorizonElevation(observation)
  return { x: 50 + Math.cos(azimuth) * radius * 43, y: 50 + Math.sin(azimuth) * radius * 43, elevation: position.elevation_deg, azimuth: position.azimuth_deg, horizonElevation }
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
      horizonElevation: getHorizonElevation(item),
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
  const hasCurvatureDip = Boolean(analysis?.observations.some((item) => Math.abs(item.geometric_horizon_elevation_deg ?? 0) > 0.001))
  const horizonLinePoints = points.map((point) => `${point.x},${90 - Math.max(-10, Math.min(90, point.horizonElevation))}`).join(' ')
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
      setRequestState('success')
    } catch (error) {
      setRequestState('error')
      if (error instanceof DOMException && error.name === 'AbortError') {
        setErrorMessage('The request exceeded 30 seconds. Check the analysis service and try again.')
      } else {
        setErrorMessage(error instanceof Error ? error.message : 'Could not retrieve the analysis.')
      }
    } finally {
      window.clearTimeout(timeout)
    }
  }

  function chooseReferenceSite(site: LolaReferenceSite) {
    setLatitude(site.latitude.toString())
    setLongitude(site.longitude.toString())
    setAltitude(site.elevation_m.toFixed(2))
    setAnalysis(null)
    setRequestState('idle')
    setErrorMessage('')
    document.getElementById('analysis')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="navigator-app">
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="Overhaul — home"><span className="wordmark-symbol"><Icon name="moon" size={20} /></span><span>OVERHAUL</span></a>
        <nav className="header-nav" aria-label="Main navigation"><a className="active" href="#analysis">Navigator</a><a href="#sources">Terrain & sources</a></nav>
        <div className={`connection-state ${requestState === 'success' ? 'connected' : requestState === 'error' ? 'disconnected' : ''}`}><span />{requestState === 'success' ? 'SPICE data updated' : requestState === 'error' ? 'Service unavailable' : apiConfigured ? 'API configured' : 'API not configured'}</div>
      </header>

      <main id="top" className="page-content">
        <section className="hero-section">
          <div className="hero-copy"><div className="overline"><span /> LUNAR LANDING SITE NAVIGATOR</div><h1>A window into<br /><em>the lunar horizon.</em></h1><p>Compare sunlight and Earth visibility at the lunar south pole over time.</p><a className="hero-link" href="#analysis">Start an analysis <span>↓</span></a></div>
          <div className="hero-visual" aria-hidden="true"><div className="hero-orbit orbit-a" /><div className="hero-orbit orbit-b" /><div className="hero-moon"><div className="crater crater-a" /><div className="crater crater-b" /><div className="crater crater-c" /></div><div className="orbit-sun" /><div className="hero-coordinates">89° 30′ S<br />0° 00′ E</div><div className="hero-caption">SOUTH POLE · ORBITAL VIEW</div></div>
          <div className="hero-index"><span>01</span> / 03</div>
        </section>

        <section className="analysis-section" id="analysis">
          <div className="section-heading"><div><span className="section-number">01</span><div><h2>Set the location and time period</h2><p>This query retrieves Sun and Earth ephemerides. Altitude is in meters above the reference lunar sphere (R = 1,737.4 km).</p></div></div><span className="unit-caption">LUNAR COORDINATES · DEGREES</span></div>
          <form className="query-form" onSubmit={runAnalysis} onChange={() => { if (requestState !== 'loading') { setAnalysis(null); setErrorMessage(''); setRequestState('idle') } }}>
            <fieldset className="coordinate-group" disabled={requestState === 'loading'}><legend>Observation site</legend><label><span>Latitude</span><div className="input-with-unit"><input lang="en-US" type="number" min="-90" max="90" step="0.00001" required value={latitude} onChange={(event) => setLatitude(event.target.value)} /><small>°</small></div></label><label><span>Longitude</span><div className="input-with-unit"><input lang="en-US" type="number" min="-180" max="180" step="0.00001" required value={longitude} onChange={(event) => setLongitude(event.target.value)} /><small>°</small></div></label><label><span>Altitude</span><div className="input-with-unit"><input lang="en-US" type="number" step="0.01" aria-label="Altitude above the reference lunar sphere, radius 1,737.4 kilometers" title="Altitude above the reference lunar sphere (R = 1,737.4 km)" required value={altitude} onChange={(event) => setAltitude(event.target.value)} /><small>m</small></div></label></fieldset>
            <label className="form-control date-time-control"><span>Start date and time · your local time</span><input type="datetime-local" required disabled={requestState === 'loading'} value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
            <label className="form-control"><span>Duration</span><select disabled={requestState === 'loading'} value={duration} onChange={(event) => setDuration(event.target.value)}><option value="12">12 hours</option><option value="24">24 hours</option><option value="48">48 hours</option><option value="72">72 hours</option></select></label>
            <label className="form-control interval-control"><span>Step</span><select disabled={requestState === 'loading'} value={step} onChange={(event) => setStep(event.target.value)}><option value="30m">30 minutes</option><option value="1h">1 hour</option><option value="2h">2 hours</option><option value="4h">4 hours</option></select></label>
            <button className="query-button" type="submit" disabled={requestState === 'loading'}>{requestState === 'loading' ? <span className="spinner" /> : <Icon name="orbit" size={17} />}{requestState === 'loading' ? 'Loading…' : 'Get ephemerides'}</button>
          </form>

          <LolaReferenceSites onChoose={chooseReferenceSite} />
          <ScenarioComparison draft={{ latitude: Number(latitude), longitude: Number(longitude), altitude_m: Number(altitude), startDateTime: startDate, durationHours: Number(duration), step }} apiConfigured={apiConfigured} />
          <OperationalWindows observations={analysis?.observations ?? []} selectedIndex={selectedObservation} onSelectIndex={setSelectedObservation} />

         {!apiConfigured && requestState === 'idle' && <div className="request-message setup-message" role="status"><span className="message-symbol">i</span><div><strong>Set up the analysis service</strong><p>The navigator uses the analysis backend configured at <code>VITE_API_BASE_URL</code>. The service calculates ephemerides with NASA/JPL SPICE kernels and does not call Horizons live.</p></div></div>}
          {requestState === 'loading' && <div className="request-message loading-message" role="status" aria-live="polite"><span className="spinner" /><div><strong>Calculating celestial positions</strong><p>Retrieving Sun and Earth data from the local SPICE backend.</p></div></div>}
          {requestState === 'error' && <div className="request-message error-message" role="alert"><span className="message-symbol">!</span><div><strong>Analysis could not be completed</strong><p>{errorMessage}</p></div><button type="button" onClick={(event) => { const form = event.currentTarget.closest('.analysis-section')?.querySelector('form'); form?.requestSubmit() }}><Icon name="refresh" size={15} /> Try again</button></div>}

          {analysis ? <>
            <div className="results-meta"><span className="result-dot" /> SPICE EPHEMERIDES · {analysis.observations.length} observations <span>·</span> {analysis.interval.step} <span className="result-time">{analysis.interval.start} — {analysis.interval.end}</span></div>
            <section className="summary-strip" aria-label="Analysis summary"><article className="summary-item sunlight-summary"><div className="summary-label"><Icon name="sun" size={16} /> Hours with the Sun above the horizon</div><strong>{sunlightHours?.toFixed(1) ?? '—'}<small>h</small></strong><span>{terrainAdjusted ? 'Terrain-adjusted summary' : 'Spherical horizon; no local terrain profile'}</span></article><article className="summary-item earth-summary"><div className="summary-label"><Icon name="earth" size={16} /> Earth visibility</div><strong>{earthHours?.toFixed(1) ?? '—'}<small>h</small></strong><span>{terrainAdjusted ? 'Terrain-adjusted summary' : 'Terrain obstruction not accounted for'}</span></article><article className="summary-item terrain-summary"><div className="summary-label"><Icon name="terrain" size={16} /> Terrain horizon</div><strong>{horizonDataAvailable ? 'Available' : 'Pending'}</strong><span>{horizonDataAvailable ? 'Local horizon provided by the service' : 'Waiting for local elevation data'}</span></article></section>

            <section className="visualization-layout" aria-label="Analysis visualizations"><article className="ephemeris-panel"><div className="panel-heading"><div><span className="panel-overline">TIME SERIES</span><h3>Elevation relative to the horizon</h3></div><div className="body-tabs" role="tablist" aria-label="Displayed body">{(['sun', 'earth'] as CelestialBody[]).map((item) => <button key={item} type="button" role="tab" aria-selected={body === item} className={body === item ? `selected ${item}` : ''} onClick={() => setBody(item)}><Icon name={item} size={15} />{item === 'sun' ? 'Sun' : 'Earth'}</button>)}</div></div><p className="chart-location"><Icon name="pin" size={13} />{analysis.site.name} · {analysis.site.latitude.toFixed(2)}°, {analysis.site.longitude.toFixed(2)}°</p>
                {points.length ? <><div className="chart-key"><span className={body}><i />Elevation of the {body === 'sun' ? 'Sun' : 'Earth'}</span><span><i className="horizon-key" />Reference horizon · 0°</span>{horizonDataAvailable ? <span><i className="local-horizon-key" />Local horizon</span> : hasCurvatureDip && <span><i className="geometry-horizon-key" />Spherical horizon</span>}<span className="chart-unit">DEGREES</span></div><div className="chart-area"><div className="chart-y-axis"><span>90°</span><span>60°</span><span>30°</span><span>0°</span><span>−10°</span></div><div className="chart-plot"><div className="plot-grid grid-90" /><div className="plot-grid grid-60" /><div className="plot-grid grid-30" /><div className="plot-horizon" /><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`Elevation of the ${body === 'sun' ? 'Sun' : 'Earth'} across ${points.length} observations`}><defs><linearGradient id="ephemeris-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={body === 'sun' ? '#e4b960' : '#8baac4'} stopOpacity=".17" /><stop offset="1" stopColor={body === 'sun' ? '#e4b960' : '#8baac4'} stopOpacity="0" /></linearGradient></defs><polygon points={fillPoints} fill="url(#ephemeris-fill)" /><polyline points={linePoints} className={`ephemeris-line ${body}`} vectorEffect="non-scaling-stroke" />{(horizonDataAvailable || hasCurvatureDip) && <polyline points={horizonLinePoints} className={horizonDataAvailable ? "terrain-horizon-line" : "geometry-horizon-line"} vectorEffect="non-scaling-stroke" />}{points.map((point, index) => <circle key={`${point.time}-${index}`} cx={point.x} cy={point.y} r="1.35" className={`ephemeris-point ${body} ${selectedObservation === index ? 'active' : ''}`} vectorEffect="non-scaling-stroke" />)}</svg><div className="chart-scrubber" role="slider" aria-label="Select observation" aria-valuemin={0} aria-valuemax={Math.max(0, points.length - 1)} aria-valuenow={selectedObservation} tabIndex={0} style={{ left: `${points[selectedObservation]?.x ?? 0}%` }} onKeyDown={(event) => { if (event.key === 'ArrowRight') setSelectedObservation((value) => Math.min(points.length - 1, value + 1)); if (event.key === 'ArrowLeft') setSelectedObservation((value) => Math.max(0, value - 1)) }} onPointerDown={(event) => { const rect = event.currentTarget.parentElement?.getBoundingClientRect(); if (!rect || points.length < 2) return; const update = (clientX: number) => setSelectedObservation(Math.round(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * (points.length - 1))); update(event.clientX); const move = (moveEvent: PointerEvent) => update(moveEvent.clientX); const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }; window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true }) }} /></div></div><div className="chart-x-axis"><span>{new Date(analysis.interval.start).toLocaleString('en-US', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC</span><span>{new Date(analysis.interval.end).toLocaleString('en-US', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC</span></div><div className="selected-reading"><span>{new Date(points[selectedObservation]?.time ?? analysis.interval.start).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC</span><span><b>{points[selectedObservation]?.elevation.toFixed(1)}°</b> elevation</span><span><b>{points[selectedObservation]?.azimuth.toFixed(1)}°</b> azimuth</span><span className={points[selectedObservation]?.visible ? 'above-horizon' : 'below-horizon'}>{points[selectedObservation]?.visible ? 'Above the horizon' : 'Below the horizon'}</span></div></> : <div className="empty-chart">The API response contains no observations to display.</div>}
                <div className="science-footnote"><span>i</span>{horizonDataAvailable ? 'The dashed line shows the local horizon provided by the service; atmospheric refraction is not included.' : terrainAdjusted ? 'The service reports terrain-adjusted visibility but did not provide horizon angles for plotting the local profile.' : 'The horizon accounts for lunar curvature at the selected altitude, but not the local crater profile.'}</div>
              </article>
              <aside className="sky-panel"><div className="panel-heading"><div><span className="panel-overline">LOCAL SKY</span><h3>Body direction</h3></div><span className="live-reading">{horizon ? `${horizon.azimuth.toFixed(0)}° AZ` : '—'}</span></div><div className="sky-dial"><div className="dial-ring ring-outer" /><div className="dial-ring ring-mid" /><div className="dial-ring ring-inner" /><span className="dial-axis axis-h" /><span className="dial-axis axis-v" /><span className="dial-direction north">N</span><span className="dial-direction east">E</span><span className="dial-direction south">S</span><span className="dial-direction west">W</span>{horizon && <span className={`sky-body ${body}`} style={{ left: `${horizon.x}%`, top: `${horizon.y}%` }}><Icon name={body} size={17} /></span>}<div className="dial-center"><Icon name="pin" size={14} /></div><span className="dial-horizon-label">{horizonDataAvailable && horizon ? `LOCAL HORIZON · ${(horizon?.horizonElevation?.toFixed(1) ?? '—')}°` : `SPHERICAL HORIZON · ${(horizon?.horizonElevation?.toFixed(1) ?? '—')}°`}</span></div><div className="sky-reading"><div><span>Elevation</span><strong>{horizon ? `${horizon.elevation.toFixed(1)}°` : '—'}</strong></div><div><span>Azimuth</span><strong>{horizon ? `${horizon.azimuth.toFixed(1)}°` : '—'}</strong></div></div><p className="sky-caption">The marker follows the selected point in the time series.</p></aside></section>

            <section className="observations-panel"><div className="panel-heading"><div><span className="panel-overline">RESPONSE DATA</span><h3>Observations</h3></div><span className="table-count">{analysis.observations.length} points</span></div><div className="table-scroll"><table><thead><tr><th>Time · UTC</th><th>Sun · elevation</th><th>Sun · azimuth</th><th>Earth · elevation</th><th>Earth · azimuth</th><th>Terrain</th></tr></thead><tbody>{analysis.observations.slice(0, 12).map((item, index) => <tr key={`${item.time}-${index}`}><td>{new Date(item.time).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' })}</td><td>{item.sun.elevation_deg.toFixed(2)}°</td><td>{item.sun.azimuth_deg.toFixed(2)}°</td><td>{item.earth.elevation_deg.toFixed(2)}°</td><td>{item.earth.azimuth_deg.toFixed(2)}°</td><td>{item.terrain?.available ? `${item.terrain.horizon_elevation_deg.toFixed(1)}°` : '—'}</td></tr>)}</tbody></table></div>{analysis.observations.length > 12 && <p className="table-caption">Showing 12 of {analysis.observations.length} observations. The full series is available in the chart.</p>}</section>
          </> : requestState !== 'loading' && <section className="empty-state"><div className="empty-orbit"><Icon name="orbit" size={28} /></div><div><span className="panel-overline">AWAITING QUERY</span><h3>The horizon starts with a coordinate.</h3><p>Enter a lunar location and mission time period to retrieve Sun and Earth positions. Results will appear here when the API responds.</p></div></section>}
        </section>

        <MoonTerrainExplorer key={`${analysis?.site.latitude ?? latitude}:${analysis?.site.longitude ?? longitude}`} latitude={Number(analysis?.site.latitude ?? latitude)} longitude={Number(analysis?.site.longitude ?? longitude)} />
        <QuickMapExplorer key={`${analysis?.site.latitude ?? latitude}:${analysis?.site.longitude ?? longitude}`} latitude={Number(analysis?.site.latitude ?? latitude)} longitude={Number(analysis?.site.longitude ?? longitude)} />

        <section className="sources-section" id="sources"><div className="sources-title"><div><span className="section-number">02</span><div><h2>Challenge resources</h2><p>Use each tool for the information it provides.</p></div></div></div><div className="source-list"><div className="source-row horizons-source"><span className="source-icon source-sun"><Icon name="sun" size={18} /></span><span className="source-details"><strong>JPL Horizons</strong><small>Sun and Earth ephemerides for the selected location and time period</small></span><span className="source-links"><a className="source-action" href={HORIZONS_SYSTEM} target="_blank" rel="noreferrer" aria-label="Open the JPL Horizons web interface" title="Horizons web interface">Web interface <Icon name="arrow" size={14} /></a><a className="source-action" href={HORIZONS_DOCS} target="_blank" rel="noreferrer" aria-label="Open the Horizons API documentation" title="Horizons API documentation">API documentation <Icon name="arrow" size={14} /></a></span></div><a href={MOON_TREK} target="_blank" rel="noreferrer" className="source-row"><span className="source-icon source-moon"><Icon name="moon" size={18} /></span><span className="source-details"><strong>NASA Moon Trek</strong><small>3D visualization of lunar elevation, illumination, and terrain</small></span><span className="source-action">Open Moon Trek <Icon name="arrow" size={14} /></span></a><a href={QUICKMAP} target="_blank" rel="noreferrer" className="source-row"><span className="source-icon source-map"><Icon name="terrain" size={18} /></span><span className="source-details"><strong>LROC QuickMap · ASU</strong><small>Lunar Reconnaissance Orbiter imagery, topography, and surface data</small></span><span className="source-action">Open QuickMap <Icon name="arrow" size={14} /></span></a></div><p className="source-disclaimer">Horizons provides celestial positions; Moon Trek and QuickMap help explore terrain. Geometric positions do not account for obstruction by mountains or craters.</p></section>

        <footer className="site-footer"><a className="wordmark footer-mark" href="#top"><span className="wordmark-symbol"><Icon name="moon" size={17} /></span><span>OVERHAUL</span></a><span>Lunar navigator · Hackathon</span><a href="#analysis">New analysis ↑</a></footer>
      </main>
    </div>
  )
}

export default App
