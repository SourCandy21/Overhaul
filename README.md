# Overhaul · Lunar Landing Site Navigator

Interface para consultar e comparar a elevação do Sol e da Terra em coordenadas lunares e períodos selecionados. Os dados são servidos pela API Overhaul configurada; o frontend não chama fontes científicas externas diretamente.

## Desenvolvimento

1. Copie `.env.example` para `.env.local`.
2. Defina `VITE_API_BASE_URL` com a origem da API Python.
3. Inicie o backend e depois execute `npm run dev`.

Sem backend configurado, a tela mostra o estado de configuração. Use **Testar com dados mockados** para preencher gráficos, indicadores, bússola e tabela com uma amostra fictícia claramente identificada; esses valores nunca são apresentados como resultado científico. O módulo de comparação permite salvar até três combinações de coordenadas, data/hora local, duração e intervalo; **Comparar demonstração** gera resultados sintéticos e **Comparar pela API** consulta o backend em sequência.

Com uma análise carregada, a linha do tempo sincroniza o gráfico, a posição no céu e os indicadores de próximo ocaso/perda de contato. O indicador de incidência solar horizontal é apenas `sin(elevação solar)` convertido em percentual: não estima potência, orientação do painel, sombras do relevo ou condições do equipamento. Se as observações incluírem horizonte local, a disponibilidade considera essa obstrução; sem esse campo, a interface usa e identifica o horizonte geométrico de 0°. Os horários de cruzamento são interpolados entre observações e, portanto, dependem do passo retornado pelo backend.

Este repositório é somente o frontend; ainda não contém a API Python descrita abaixo. O usuário precisa apontar `VITE_API_BASE_URL` para um backend da equipe. A JPL publica a restrição de não embutir suas APIs em sites; confirme uma integração permitida antes de expor resultados do Horizons no navegador ou por um proxy. Consulte a [política do serviço](https://ssd-api.jpl.nasa.gov/) e [documentação da API](https://ssd-api.jpl.nasa.gov/doc/horizons.html).

## Contrato esperado pelo frontend

### `GET /api/analysis`

Parâmetros de query:

| Parâmetro | Tipo | Exemplo |
| --- | --- | --- |
| `latitude` | graus, número | `-89.5` |
| `longitude` | graus, número | `0` |
| `altitude_m` | metros, número | `0` |
| `start` | data/hora ISO 8601 UTC | `2026-12-01T00:00:00.000Z` |
| `end` | data/hora ISO 8601 UTC | `2026-12-02T00:00:00.000Z` |
| `step` | intervalo Horizons | `1h` |

O backend deve responder com a análise consolidada no formato abaixo. Se a equipe optar por usar o JPL Horizons, confirme primeiro que o uso e a exibição dos dados no site são permitidos: a política publicada do serviço proíbe embutir suas APIs em sites, exige requisições não simultâneas, tratamento de falhas e reutilização de respostas quando possível. Não faça chamadas diretas do navegador nem use o backend apenas como proxy para contornar CORS. Consulte a [política do serviço JPL](https://ssd-api.jpl.nasa.gov/) e a [documentação do Horizons](https://ssd-api.jpl.nasa.gov/doc/horizons.html).

Resposta de sucesso (`application/json`):

```json
{
  "site": {
    "id": "custom",
    "name": "Local personalizado",
    "latitude": -89.5,
    "longitude": 0,
    "altitude_m": 0
  },
  "interval": {
    "start": "2026-12-01T00:00:00Z",
    "end": "2026-12-02T00:00:00Z",
    "step": "1h"
  },
  "observations": [
    {
      "time": "2026-12-01T00:00:00Z",
      "sun": { "azimuth_deg": 120, "elevation_deg": 8.5, "above_local_horizon": true },
      "earth": { "azimuth_deg": 45, "elevation_deg": 12, "above_local_horizon": true },
      "terrain": { "horizon_elevation_deg": 4, "available": true }
    }
  ],
  "summary": {
    "sunlight_hours": 8,
    "earth_visibility_hours": 12,
    "terrain_adjusted": false
  }
}
```

`summary` e `terrain` são opcionais. Sem resumo, a interface estima horas geométricas contando os pontos acima de 0° e multiplicando pelo intervalo; isso não leva relevo em conta. Retorne erros com status HTTP apropriado e, quando possível, `{ "error": "mensagem" }`.

## Integrações de dados de terreno

O componente `src/components/MoonTerrainExplorer.tsx` consulta o catálogo WMTS do NASA Moon Trek, lê o template e as matrizes publicados e calcula o tile polar para as coordenadas do formulário, exibindo um marcador no ponto selecionado. Consulte a [documentação WMTS do Moon Trek](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon) para camadas, projeções e matrizes disponíveis.

As posições celestes continuam chegando pelo endpoint Overhaul `GET /api/analysis`. Não há backend de análise neste repositório: configure `VITE_API_BASE_URL` para um serviço autorizado da equipe. O frontend não chama Horizons diretamente; a política da JPL proíbe embutir essas APIs em sites. A integração backend deve ser validada pela equipe com a JPL antes de publicar resultados derivados. QuickMap permanece como ferramenta externa de exploração e referência para comparação do terreno.

## Scripts

- `npm run dev` — servidor local Vite
- `npm run build` — compilação TypeScript e build de produção
- `npm run lint` — lint do projeto
