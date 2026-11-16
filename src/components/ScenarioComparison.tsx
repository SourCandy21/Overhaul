import { useState } from 'react'
import { fetchSiteAnalysis, type SiteAnalysisRequest } from '../api/client'
import type { SiteAnalysis } from '../types/analysis'

export interface ScenarioDraft {
  latitude: number
  longitude: number
  altitude_m: number
  startDateTime: string
  durationHours: number
  step: string
}

interface Scenario extends ScenarioDraft { id: number; name: string }
interface ComparedScenario { scenario: Scenario; analysis: SiteAnalysis; sunlight: number; earthVisibility: number }

function horizonElevation(observation: SiteAnalysis['observations'][number]) {
  return observation.terrain?.available ? observation.terrain.horizon_elevation_deg : observation.geometric_horizon_elevation_deg ?? 0
}

function aboveHorizon(observation: SiteAnalysis['observations'][number], body: 'sun' | 'earth') {
  const position = observation[body]
  if (position.above_local_horizon !== undefined) return position.above_local_horizon
  return position.elevation_deg > horizonElevation(observation)
}

function estimateHours(analysis: SiteAnalysis, body: 'sun' | 'earth') {
  if (body === 'sun' && analysis.summary?.sunlight_hours !== undefined) return analysis.summary.sunlight_hours
  if (body === 'earth' && analysis.summary?.earth_visibility_hours !== undefined) return analysis.summary.earth_visibility_hours
  return analysis.observations.slice(0, -1).reduce((hours, current, index) => {
    const next = analysis.observations[index + 1]
    const elapsed = (Date.parse(next.time) - Date.parse(current.time)) / 3_600_000
    if (!Number.isFinite(elapsed) || elapsed <= 0) return hours
    const firstMargin = current[body].elevation_deg - horizonElevation(current)
    const nextMargin = next[body].elevation_deg - horizonElevation(next)
    const firstAbove = aboveHorizon(current, body)
    const nextAbove = aboveHorizon(next, body)
    if (firstAbove && nextAbove) return hours + elapsed
    if (!firstAbove && !nextAbove) return hours
    const difference = firstMargin - nextMargin
    const crossing = difference === 0 ? 0.5 : Math.max(0, Math.min(1, firstMargin / difference))
    return hours + elapsed * (firstAbove ? crossing : 1 - crossing)
  }, 0)
}

function buildRequest(scenario: Scenario): Omit<SiteAnalysisRequest, 'signal'> {
  const start = new Date(scenario.startDateTime)
  const end = new Date(start.getTime() + scenario.durationHours * 3_600_000)
  return {
    latitude: scenario.latitude,
    longitude: scenario.longitude,
    altitude_m: scenario.altitude_m,
    start: start.toISOString(),
    end: end.toISOString(),
    step: scenario.step,
  }
}

function miniLine(analysis: SiteAnalysis, body: 'sun' | 'earth' | 'horizon') {
  return analysis.observations.map((item, index) => {
    const x = analysis.observations.length < 2 ? 50 : index / (analysis.observations.length - 1) * 100
    const sourceElevation = body === 'horizon' ? horizonElevation(item) : item[body].elevation_deg
    const elevation = Math.max(-10, Math.min(90, sourceElevation))
    const y = 100 - (elevation + 10)
    return `${x},${y}`
  }).join(' ')
}

function MiniEphemeris({ analysis }: { analysis: SiteAnalysis }) {
  return <div className="mini-ephemeris" role="img" aria-label="Sun and Earth elevation relative to the horizon during this scenario"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><line x1="0" x2="100" y1="90" y2="90" className="mini-horizon" /><polyline points={miniLine(analysis, 'horizon')} className="mini-horizon-profile" /><polyline points={miniLine(analysis, 'sun')} className="mini-sun-line" /><polyline points={miniLine(analysis, 'earth')} className="mini-earth-line" /></svg><div><span><i className="mini-sun-swatch" />Sun</span><span><i className="mini-earth-swatch" />Earth</span></div></div>
}

export function ScenarioComparison({ draft, apiConfigured }: { draft: ScenarioDraft; apiConfigured: boolean }) {
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [results, setResults] = useState<ComparedScenario[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [message, setMessage] = useState('')

  function addScenario() {
    if (scenarios.length >= 3) return
    const id = Date.now()
    setScenarios((current) => [...current, { ...draft, id, name: `Option ${current.length + 1}` }])
    setResults([])
    setState('idle')
    setMessage('')
  }

  async function compare() {
    setState('loading')
    setResults([])
    setMessage('')
    const compared: ComparedScenario[] = []
    try {
      for (const scenario of scenarios) {
        const request = buildRequest(scenario)
        const controller = new AbortController()
        const timeout = window.setTimeout(() => controller.abort(), 30_000)
        let analysis: SiteAnalysis
        try {
          analysis = await fetchSiteAnalysis({ ...request, signal: controller.signal })
        } finally {
          window.clearTimeout(timeout)
        }
        compared.push({ scenario, analysis, sunlight: estimateHours(analysis, 'sun'), earthVisibility: estimateHours(analysis, 'earth') })
        setResults([...compared])
      }
      setState('idle')
    } catch (error) {
      setState('error')
      setMessage(error instanceof DOMException && error.name === 'AbortError'
        ? 'A scenario request exceeded 30 seconds.'
        : error instanceof Error ? error.message : 'Could not compare the scenarios.')
    }
  }

  const bestSun = Math.max(-1, ...results.map((item) => item.sunlight))
  const bestEarth = Math.max(-1, ...results.map((item) => item.earthVisibility))

  return (
    <section className="scenario-comparison" aria-labelledby="scenario-title">
      <div className="scenario-heading"><div><span className="panel-overline">MISSION PLANNING</span><h3 id="scenario-title">Compare landing options</h3><p>Save location and time combinations, then compare sunlight and direct contact with Earth.</p></div><button className="scenario-add" type="button" disabled={scenarios.length >= 3} onClick={addScenario}>+ Add option</button></div>

      {scenarios.length === 0 ? <div className="scenario-empty"><span>01</span><p>Set a location and time above, then add your first option.</p></div> : <ol className="scenario-list">
        {scenarios.map((scenario) => <li key={scenario.id}>
          <span className="scenario-index">{String(scenarios.indexOf(scenario) + 1).padStart(2, '0')}</span>
          <div className="scenario-copy"><strong>{scenario.name}</strong><span>{scenario.latitude.toFixed(2)}°, {scenario.longitude.toFixed(2)}° · {new Date(scenario.startDateTime).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} · {scenario.durationHours} h</span></div>
          <button type="button" aria-label={`Remove ${scenario.name}`} disabled={state === 'loading'} onClick={() => { setScenarios((current) => current.filter((item) => item.id !== scenario.id)); setResults([]) }}>Remove</button>
        </li>)}
      </ol>}

      <div className="scenario-actions">
        <button type="button" className="scenario-run api" disabled={state === 'loading' || scenarios.length < 2 || !apiConfigured} onClick={() => void compare()}>{state === 'loading' ? `Loading ${results.length + 1}/${scenarios.length}…` : 'Compare via API'}</button>
        {scenarios.length < 2 ? <span>Add at least two options to compare.</span> : !apiConfigured && <span>Live analysis unavailable: configure the team backend.</span>}
      </div>

      {state === 'error' && <p className="scenario-error" role="alert">{message}</p>}
      {results.length > 0 && <>
        <div className="scenario-results-label" aria-live="polite">COMPARISON · SPICE BACKEND DATA</div>
        <div className="scenario-results">
          {results.map((item) => <article className="scenario-result" key={item.scenario.id}>
            <div className="scenario-result-title"><span>{item.scenario.name}</span></div>
            <p>{item.scenario.latitude.toFixed(2)}°, {item.scenario.longitude.toFixed(2)}° · {new Date(item.analysis.interval.start).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</p>
            <MiniEphemeris analysis={item.analysis} />
            <div className="scenario-metrics"><div><span>Sun above the horizon</span><strong>{item.sunlight.toFixed(1)} h</strong>{item.sunlight === bestSun && <em>Longest sunlight window</em>}</div><div><span>Earth visible</span><strong>{item.earthVisibility.toFixed(1)} h</strong>{item.earthVisibility === bestEarth && <em>Longest contact window</em>}</div></div>
          </article>)}
        </div>
      </>}
    </section>
  )
}
