# Overhaul · Lunar Landing Site Navigator

Interface para consultar e comparar a elevação do Sol e da Terra em coordenadas lunares e períodos selecionados. Os dados são servidos pela API Overhaul configurada; o frontend não chama fontes científicas externas diretamente.

## Desenvolvimento

1. Instale Python 3.10 ou superior.
2. Execute o preparador do backend no PowerShell:

   ```powershell
   .\backend\run.ps1
   ```

   Na primeira execução, o script cria o ambiente Python, instala `spiceypy` e baixa kernels oficiais NAIF/JPL (aproximadamente 44 MB). Eles ficam em `backend/kernels/` e não são versionados no Git. O backend permanece em execução nesse terminal.
3. Em outro terminal, copie `.env.example` para `.env.local` e execute `npm run dev`.

Se preferir preparar manualmente, os comandos são `python -m venv backend/.venv`, `backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt`, `backend/.venv/Scripts/python.exe backend/download_kernels.py` e `backend/.venv/Scripts/python.exe backend/server.py`.

Sem backend configurado, a tela mostra o estado de configuração e não apresenta resultados científicos fictícios. O módulo de comparação permite salvar até três combinações de coordenadas, data/hora local, duração e intervalo; a comparação consulta cada cenário sequencialmente pela API SPICE local.

## Segurança

O backend é um serviço local de desenvolvimento, sem autenticação: ele recusa bind fora de loopback, limita origens, exige uma origem autorizada nas análises, restringe parâmetros e consultas concorrentes, adiciona headers de segurança e valida os kernels por SHA-256. Os logs registram rota e status, sem coordenadas e horários da query. Não o exponha diretamente à rede ou à internet; uma implantação remota exige autenticação, TLS e um servidor de produção endurecido. No frontend, dados remotos são renderizados pelo React sem `innerHTML`, links externos usam `rel="noreferrer"` e templates WMTS precisam permanecer em HTTPS no host `trek.nasa.gov`.

Os nomes seguem convenções por camada: componentes React em `PascalCase`, variáveis/funções TypeScript em `camelCase`, classes CSS em `kebab-case` e campos do contrato científico em `snake_case`. Os estados genéricos (`selected`, `loading`, `error`) ficam sob seletores dos componentes correspondentes.

Com uma análise carregada, a linha do tempo sincroniza o gráfico, a posição no céu e os indicadores de próximo ocaso/perda de contato. O indicador de incidência solar horizontal é apenas `sin(elevação solar)` convertido em percentual: não estima potência, orientação do painel, sombras do relevo ou condições do equipamento. Se as observações incluírem horizonte local, a disponibilidade considera essa obstrução; sem esse campo, a interface usa e identifica o horizonte geométrico de 0°. Os horários de cruzamento são interpolados entre observações e, portanto, dependem do passo retornado pelo backend.

O backend local usa `spiceypy` com os kernels NAIF/JPL `DE440s`, `moon_pa_de440_200625.bpc`, `moon_de440_250416.tf` e `naif0012.tls`. Não faz chamadas de rede durante as análises e não consulta o Horizons. O frame `MOON_ME` alinha as coordenadas de entrada ao referencial lunar mean-Earth usado para coordenadas selenográficas, com orientação de alta precisão do DE440. A referência é uma esfera lunar de 1.737,4 km; para um observador elevado, o backend calcula o mergulho geométrico do horizonte. O kernel DE440s cobre aproximadamente 1850–2149; períodos fora da cobertura são rejeitados.

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
| `step` | passo de amostragem SPICE | `1h` |

O endpoint local transforma cada posição SPICE em azimute e elevação topocêntricos vistos de um ponto fixo na superfície lunar. Usa uma esfera de referência lunar de 1.737,4 km, altitude informada em metros e correção de tempo de luz/aberração `CN+S`; a elevação reportada é geométrica, sem refração atmosférica.

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
      "geometric_horizon_elevation_deg": 0
    }
  ],
  "summary": {
    "sunlight_hours": 8,
    "earth_visibility_hours": 12,
    "terrain_adjusted": false
  }
}
```

`summary` e `terrain` são opcionais. Este backend retorna `terrain_adjusted: false` e não inclui `terrain`: calcula o horizonte geométrico da esfera e a queda angular do horizonte para a altitude informada, mas não deriva obstruções locais por crateras. As janelas em horas interpolam o cruzamento do horizonte reportado entre amostras. O endpoint limita a duração a 72 horas e os passos a `30m`, `1h`, `2h` ou `4h`. Retorna erros com status HTTP apropriado e `{ "error": "mensagem" }`.

## Integrações de dados de terreno

O componente `src/components/MoonTerrainExplorer.tsx` consulta o catálogo WMTS do NASA Moon Trek, lê o template e as matrizes publicados e calcula o tile polar para as coordenadas do formulário, exibindo um marcador no ponto selecionado. Consulte a [documentação WMTS do Moon Trek](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon) para camadas, projeções e matrizes disponíveis.

As posições celestes chegam pelo endpoint local Overhaul `GET /api/analysis`. O serviço escuta apenas em `127.0.0.1:8000`, permite por padrão as origens locais do Vite e oferece `GET /health` para confirmar dependências e kernels. Configure `OVERHAUL_API_PORT` e `OVERHAUL_CORS_ORIGINS` quando necessário; o binding remoto é bloqueado porque esta API não tem autenticação. A rota de análise exige uma origem CORS autorizada, limita o tamanho e os campos da consulta e restringe análises concorrentes. Os kernels são verificados por SHA-256 antes de serem carregados. QuickMap permanece como fonte cartográfica independente; o backend SPICE não consulta produtos LOLA nem aplica obstrução topográfica. Os kernels são distribuídos pelo [NAIF/JPL](https://naif.jpl.nasa.gov/naif/data_generic.html); consulte também a [documentação SPICE de observadores em pontos de superfície](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/spkcpo_c.html).

## Scripts

- `npm run dev` — servidor local Vite
- `npm run build` — compilação TypeScript e build de produção
- `npm run lint` — lint do projeto
