import { useEffect, useState } from 'react'
import type { Observation } from '../types/analysis'

type Body = 'sun' | 'earth'

function horizonElevation(observation: Observation) {
  return observation.terrain?.available ? observation.terrain.horizon_elevation_deg : observation.geometric_horizon_elevation_deg ?? 0
}

function aboveHorizon(item: Observation, body: Body) {
  const position = item[body]
  if (position.above_local_horizon !== undefined) return position.above_local_horizon
  return position.elevation_deg > horizonElevation(item)
}

function nextSetLabel(observations: Observation[], body: Body, selectedIndex: number) {
  if (!observations.length) return '—'
  const startIndex = Math.min(selectedIndex, observations.length - 1)
  if (!aboveHorizon(observations[startIndex], body)) return 'Abaixo agora'
  for (let index = startIndex; index < observations.length - 1; index += 1) {
    const first = observations[index]
    const next = observations[index + 1]
    if (!aboveHorizon(first, body) || aboveHorizon(next, body)) continue
    const firstHorizon = horizonElevation(first)
    const nextHorizon = horizonElevation(next)
    const firstMargin = first[body].elevation_deg - firstHorizon
    const nextMargin = next[body].elevation_deg - nextHorizon
    const difference = firstMargin - nextMargin
    const fraction = difference === 0 ? 0.5 : firstMargin / difference
    const eventTime = Date.parse(first.time) + (Date.parse(next.time) - Date.parse(first.time)) * Math.max(0, Math.min(1, fraction))
    const remaining = Math.max(0, eventTime - Date.parse(observations[startIndex].time))
    const minutes = Math.round(remaining / 60_000)
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return hours ? `${hours} h ${String(rest).padStart(2, '0')} min` : `${rest} min`
  }
  return 'Sem ocaso nesta janela'
}

export function OperationalWindows({ observations, selectedIndex, onSelectIndex }: { observations: Observation[]; selectedIndex: number; onSelectIndex: (index: number) => void }) {
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    if (!playing || observations.length < 2) return
    const timer = window.setInterval(() => {
      onSelectIndex((selectedIndex + 1) % observations.length)
    }, 900)
    return () => window.clearInterval(timer)
  }, [playing, observations.length, selectedIndex, onSelectIndex])

  if (!observations.length) return null
  const current = observations[Math.min(selectedIndex, observations.length - 1)]
  const sunElevation = current.sun.elevation_deg
  const horizontalIncidence = aboveHorizon(current, 'sun') ? Math.max(0, Math.sin(sunElevation * Math.PI / 180)) * 100 : 0
  const terrainThreshold = horizonElevation(current)
  const geometryNote = current.terrain?.available ? `Horizonte local: ${terrainThreshold.toFixed(1)}°` : `Horizonte geométrico esférico: ${terrainThreshold.toFixed(1)}°`

  return (
    <section className="operational-windows" aria-label="Condições operacionais no horário selecionado">
      <div className="operational-heading"><div><span className="panel-overline">NO HORÁRIO SELECIONADO</span><p>{new Date(current.time).toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC</p></div><button type="button" className="timeline-play" aria-pressed={playing} onClick={() => setPlaying((value) => !value)}>{playing ? 'Pausar' : '▶ Reproduzir período'}</button></div>
      <div className="operational-grid">
        <article><span>Próximo pôr do Sol</span><strong>{nextSetLabel(observations, 'sun', selectedIndex)}</strong><small>Elev. solar {sunElevation.toFixed(1)}° · incidência horizontal {horizontalIncidence.toFixed(0)}%</small></article>
        <article><span>Próxima perda de contato</span><strong>{nextSetLabel(observations, 'earth', selectedIndex)}</strong><small>Elevação da Terra {current.earth.elevation_deg.toFixed(1)}°</small></article>
      </div>
      <p className="operational-note">Incidência é uma proporção geométrica no plano horizontal, não uma previsão de potência. {geometryNote}; sem refração atmosférica.</p>
    </section>
  )
}
