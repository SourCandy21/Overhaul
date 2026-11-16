import { lolaReferenceSites, type LolaReferenceSite } from '../data/lolaReferenceSites'

export function LolaReferenceSites({ onChoose }: { onChoose: (site: LolaReferenceSite) => void }) {
  return (
    <section className="lola-reference" aria-labelledby="lola-reference-title">
      <div className="lola-reference-heading">
        <div>
          <span className="panel-overline">REFERENCE SITES · LOLA</span>
          <h3 id="lola-reference-title">South Pole Reference Sites</h3>
          <p>Select a site to fill in its coordinates and elevation, then calculate ephemerides for the chosen date.</p>
        </div>
      </div>
      <div className="lola-reference-grid">
        {lolaReferenceSites.map((site) => (
          <article className="lola-site" key={site.id}>
            <div className="lola-site-title"><h4>{site.name}</h4><span>{site.id}</span></div>
            <p className="lola-coordinates">{site.latitude.toFixed(4)}°, {site.longitude.toFixed(4)}°</p>
            <dl>
              <div><dt>Average illumination · long-term cycle</dt><dd>{site.illumination.toFixed(2)}%</dd></div>
              <div><dt>Earth visibility · long-term cycle</dt><dd>{site.earthVisibility.toFixed(2)}%</dd></div>
              <div><dt>Local slope</dt><dd>{site.slope.toFixed(2)}°</dd></div>
              <div><dt>LOLA elevation · above R=1,737.4 km</dt><dd>{site.elevation_m.toFixed(0)} m</dd></div>
            </dl>
            <button type="button" onClick={() => onChoose(site)}>Use site and elevation</button>
          </article>
        ))}
      </div>
      <p className="lola-method-note">
        Illumination and Earth visibility are averages over the lunar nodal cycle (~18.6 years), not forecasts for the selected date. The LOLA method considers Earth visible when any part of its disk appears; this does not guarantee a radio link. Slope and elevation values are static references for the point and product resolution; they are not a complete survey of the area. Named sites mark reference centers, not certified landing zones.
      </p>
      <div className="lola-sources">
        Sources: <a href="https://pgda.gsfc.nasa.gov/products/69" target="_blank" rel="noreferrer">LOLA polar illumination</a>, <a href="https://pgda.gsfc.nasa.gov/products/78" target="_blank" rel="noreferrer">LOLA topography</a> and <a href="https://ntrs.nasa.gov/citations/20230007818" target="_blank" rel="noreferrer">Lunar Surface Data Book</a>.
        Malapert Massif (R23) has not been identified as an exact equivalent of Malapert A/IM-1.
      </div>
    </section>
  )
}
