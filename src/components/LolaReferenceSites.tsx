import { lolaReferenceSites, type LolaReferenceSite } from '../data/lolaReferenceSites'

export function LolaReferenceSites({ onChoose }: { onChoose: (site: LolaReferenceSite) => void }) {
  return (
    <section className="lola-reference" aria-labelledby="lola-reference-title">
      <div className="lola-reference-heading">
        <div>
          <span className="panel-overline">PONTOS DE REFERÊNCIA · LOLA</span>
          <h3 id="lola-reference-title">Pontos de referência do polo sul</h3>
          <p>Selecione um ponto para preencher coordenadas e elevação no cenário e calcular novas efemérides para a data escolhida.</p>
        </div>
      </div>
      <div className="lola-reference-grid">
        {lolaReferenceSites.map((site) => (
          <article className="lola-site" key={site.id}>
            <div className="lola-site-title"><h4>{site.name}</h4><span>{site.id}</span></div>
            <p className="lola-coordinates">{site.latitude.toFixed(4)}°, {site.longitude.toFixed(4)}°</p>
            <dl>
              <div><dt>Iluminação média · ciclo longo</dt><dd>{site.illumination.toFixed(2)}%</dd></div>
              <div><dt>Terra visível · ciclo longo</dt><dd>{site.earthVisibility.toFixed(2)}%</dd></div>
              <div><dt>Declividade local</dt><dd>{site.slope.toFixed(2)}°</dd></div>
              <div><dt>Elevação LOLA · acima de R=1.737,4 km</dt><dd>{site.elevation_m.toFixed(0)} m</dd></div>
            </dl>
            <button type="button" onClick={() => onChoose(site)}>Usar ponto e elevação</button>
          </article>
        ))}
      </div>
      <p className="lola-method-note">
        Iluminação e visibilidade da Terra são médias do ciclo de nutação lunar (~18,6 anos), não previsões para a data selecionada. O método LOLA considera a Terra visível quando qualquer parte do disco aparece, o que não garante um enlace de rádio. Os valores de declividade e elevação são referências estáticas do ponto e da resolução do produto; não representam um levantamento completo da área. Os pontos nomeados indicam centros de referência, não áreas de pouso certificadas.
      </p>
      <div className="lola-sources">
        Fontes: <a href="https://pgda.gsfc.nasa.gov/products/69" target="_blank" rel="noreferrer">LOLA polar illumination</a>, <a href="https://pgda.gsfc.nasa.gov/products/78" target="_blank" rel="noreferrer">LOLA topografia</a> e <a href="https://ntrs.nasa.gov/citations/20230007818" target="_blank" rel="noreferrer">Lunar Surface Data Book</a>.
        Malapert Massif (R23) não foi identificado como equivalente exato a Malapert A/IM-1.
      </div>
    </section>
  )
}
