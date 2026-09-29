# Configuração do Notion2Discord

Referência completa de como configurar uma instância: arquivos, variáveis de ambiente, cada
seção do `config/rules.yaml`, placeholders, visual dos embeds, menções, comentários e o passo a
passo no Notion e no Discord. O modelo pronto para copiar é o
[`config/rules.example.yaml`](../config/rules.example.yaml).

## Arquivos

| Arquivo | Papel | Versionado? |
|---|---|---|
| `.env` | tokens e URLs de webhook (segredos) | **não** — modelo em [`.env.example`](../.env.example) |
| `config/rules.yaml` | sources, targets, regras, visual, mapa de pessoas | **não** (gitignored): tem dados da instância e pessoais (`people`) |
| `config/rules.example.yaml` | modelo genérico, só com valores fictícios | sim |
| `data/` (volume) | SQLite de snapshots e dedup, `verification_token` | não |

Regra de ouro: o que é segredo vai no `.env`; o que é da instância (ids, marca, imagens,
pessoas) vai no `rules.yaml` do host. Nada disso entra no repositório.

## Variáveis de ambiente (`.env`)

| Variável | Obrigatória | Padrão | Uso |
|---|---|---|---|
| `NOTION_API_TOKEN` | sim | — | token da integração interna do Notion |
| `NOTION_VERIFICATION_TOKEN` | sim, depois do handshake | vazio | chave HMAC dos webhooks; vazia = todo evento recebe 401 |
| `N2D_PORT` | não | `8080` | porta HTTP |
| `N2D_CONFIG_PATH` | não | `config/rules.yaml` | caminho do YAML |
| `N2D_DB_PATH` | não | `data/n2d.sqlite` | SQLite; o `verification_token` fica na mesma pasta |
| `N2D_LOG_LEVEL` | não | `info` | nível do log (pino): `debug` mostra eventos descartados |
| `<qualquer nome>` | conforme targets | — | uma env por webhook, referenciada **pelo nome** no YAML |

Config inválida ou env referenciada que não existe derruba a subida com o nome do campo.

## `config/rules.yaml`, seção por seção

### `sources` — de onde vêm os eventos

```yaml
sources:
  demandas:                                         # chave usada pelas regras
    database_id: "0123456789abcdef0123456789abcdef"  # 32 hex da URL da database, antes do ?v=
```

Uma instância pode atender várias databases, uma chave por database. Com ou sem hífens, tanto faz.

### `targets` — para onde as mensagens vão

```yaml
targets:
  canal-x:
    type: discord                 # embed num webhook do Discord
    webhook_env: DISCORD_WH_X     # NOME da env com a URL do webhook
  automacao:
    type: webhook                 # POST com o evento em JSON (n8n etc.)
    url_env: N8N_WEBHOOK_X
```

O contrato do JSON enviado a `type: webhook` está em [`n8n.md`](n8n.md).

### `rules` — quando e o quê

```yaml
rules:
  - name: tarefa-finalizada               # identificador (aparece no log)
    source: demandas                       # chave de sources
    on: [page.properties_updated]          # tipos de evento (lista)
    when: { property: "Status", changed_to: "Concluido" }   # opcional
    send_to: [canal-x]                     # chaves de targets (lista)
    mention: [Atribuido, "Criado por"]     # opcional: quem notificar
    ignore: ["Feito?"]                     # opcional: propriedades que esta regra não vê mudar
    embed: { ... }                         # obrigatório para targets discord
```

Todas as regras que casarem com o evento disparam (não há "primeira que casar").

**`ignore`** tira as propriedades listadas das mudanças que a regra enxerga (`when`,
`{{change.*}}`, `{{changes.summary}}`). Um `page.properties_updated` que, sem elas, não tem
mudança nenhuma não dispara a regra — útil para checkbox de controle, fórmulas de apoio etc.

**Eventos (`on`):**

| Evento | Quando | Observação |
|---|---|---|
| `page.created` | página criada | |
| `page.properties_updated` | propriedade mudou | agregado pelo Notion: pode levar ~1–3 min |
| `page.content_updated` | conteúdo da página mudou | sem mudança de propriedade |
| `page.deleted` | página apagada | usa o último snapshot (sem pessoas com e-mail) |
| `page.undeleted` | página restaurada | |
| `comment.created` | comentário novo | ver [Comentários](#comentários) |
| `comment.updated` | comentário editado | só se uma regra listar |

**Condições (`when`)** — uma propriedade por regra, ao menos um operador:

| Operador | Casa quando |
|---|---|
| `changed_to: "X"` | a propriedade mudou e o valor novo é X |
| `changed_from: "X"` | a propriedade mudou e o valor antigo era X |
| `changed: true` | a propriedade mudou (qualquer valor) |
| `equals: "X"` | o valor atual é X (mudou ou não) |

Operadores combinam (E): `{ property: "Status", changed_from: "Em Revisão", changed_to: "Concluido" }`.
Os valores são o texto exato da opção no Notion, com acento e maiúsculas.

Um `page.properties_updated` sem mudança (depois do `ignore`) não dispara regra nenhuma —
inclusive regra com `equals`, que nesse tipo de evento só vale quando algo mudou.

Página vista pela primeira vez (sem snapshot): num `page.properties_updated`, só contam as
propriedades que o próprio evento aponta como alteradas (`updated_properties`), com
`from: null`; nos demais eventos (ex.: `page.created`), toda propriedade preenchida conta como
mudança `null → valor`.

### `labels` — nome legível de cada evento

Usado em `{{event.label}}`. Padrões: `page.created` = "Tarefa criada", `page.properties_updated`
= "Tarefa atualizada", `page.content_updated` = "Conteúdo atualizado", `page.deleted` = "Tarefa
removida", `page.undeleted` = "Tarefa restaurada", `comment.created` = "Novo comentário".

```yaml
labels:
  page.created: "Demanda aberta"
```

## Placeholders

Valem em qualquer texto do `embed` (inclusive URLs). Chave desconhecida ou vazia vira `—`.
Aceitam espaços e acentos: `{{prop.Esforço necessário}}`.

| Placeholder | Valor |
|---|---|
| `{{page.title}}`, `{{page.url}}`, `{{page.id}}` | título, link e id da página |
| `{{event.type}}`, `{{event.label}}` | tipo do evento e o rótulo de `labels` |
| `{{prop.<Nome>}}` | valor da propriedade como texto |
| `{{mention.<Nome>}}` | pessoas da propriedade como menção clicável (sem notificar); nome se não mapeada |
| `{{person.<Nome>}}` | as mesmas pessoas em texto puro, `Nome (discord id)`; só o nome se não mapeada |
| `{{mention.event.authors}}`, `{{person.event.authors}}` | quem fez a alteração que gerou o evento (ver [Quem fez a alteração](#quem-fez-a-alteração)) |
| `{{change.from}}`, `{{change.to}}` | mudança da propriedade do `when` (ou a primeira mudança) |
| `{{changes.summary}}` | todas as mudanças, uma por linha: `**Prop:** de → **para**` |
| `{{comment.text}}` | texto do comentário |
| `{{mention.comment.author}}`, `{{mention.comment.mentions}}` | autor e mencionados do comentário (também com `person.`) |

Tipos de propriedade convertidos em texto: title, rich_text, status, select, multi_select
(separado por vírgula), date (início, `AAAA-MM-DD`), checkbox (`true`/`false`), number, people,
created_by, last_edited_by, url, email, phone_number e unique_id (com prefixo). Fórmula,
relação e rollup ficam de fora (`—`).

Markdown do Discord funciona nos textos: `**negrito**`, `*itálico*`, `>>> ` no início da
description vira bloco de citação.

## Visual do embed

```yaml
embed:
  author: { name: "🆕 Nova demanda", icon_url: "https://…", url: "https://…" }  # linha de cima
  title: "{{page.title}}"
  url: "{{page.url}}"                   # título vira link
  description: ">>> {{changes.summary}}"
  color: "#FEE75C"                      # barra lateral, hex #RRGGBB
  fields:
    - { name: "🚨 Prioridade", value: "{{prop.Prioridade}}", inline: true }
  thumbnail: { url: "https://…/logo.png" }   # imagem pequena à direita
  image: { url: "https://…/banner.gif" }     # imagem grande embaixo
  footer: { text: "Quadro • #{{prop.ID}}", icon_url: "https://…/logo.png" }
```

- `inline: true` põe até 3 campos por linha; sem ele, o campo ocupa a linha toda.
- O horário do rodapé é o do evento (automático).
- Limites do Discord (cortados automaticamente): título e `author.name` 256, description 4096,
  field name 256 e value 1024, 25 fields, footer 2048. O total do embed não pode passar de 6000
  caracteres.
- Imagens e ícones precisam de URL `https` pública. URL inválida (ou placeholder vazio) é
  omitida para a mensagem não ser rejeitada. Prefira arquivos leves: o Discord baixa a imagem a
  cada exibição.

### `embed_defaults` — visual comum

Mesmo formato do `embed`; aplicado em toda regra que tem `embed`. A regra sobrescreve chave a
chave, e `fields`/`author` da regra substituem os do padrão por inteiro:

```yaml
embed_defaults:
  thumbnail: { url: "https://example.com/logo.png" }
  image: { url: "https://example.com/line.gif" }
  footer: { text: "Quadro de Demandas • #{{prop.ID}}", icon_url: "https://example.com/logo.png" }
```

## Menções (notificar pessoas)

1. **Mapa de pessoas** — e-mail da conta Notion → ID do usuário no Discord:

   ```yaml
   people:
     "ana@example.com": "100000000000000001"
   ```

   ID do Discord: Configurações → Avançado → **Modo desenvolvedor**; depois botão direito no
   usuário → **Copiar ID do usuário** (17 a 20 dígitos). E-mail em qualquer caixa.

2. **Quem notificar por regra** — `mention:` lista propriedades de pessoa (*Person*,
   *Created by*, *Last edited by*), `event.authors` ou `comment.mentions` / `comment.author`:

   ```yaml
   mention: [Atribuido, "Criado por"]
   ```

- A menção que notifica vai no texto da mensagem (o Discord não notifica dentro de embed);
  `{{mention.X}}` no embed só mostra a menção clicável, e `{{person.X}}` mostra nome e ID em
  texto, sem chip (bom para um canal de histórico).
- Só os IDs da regra são liberados (`allowed_mentions`): `@everyone` num título não dispara.
- Pessoa sem mapa aparece pelo nome e não é notificada. Mesma pessoa em duas listas é marcada
  uma vez.
- Precisa da capability *Read user information including email addresses* no Notion.
- `people` é dado pessoal: só no `rules.yaml` do host. O SQLite não guarda e-mail e targets
  `webhook` recebem as pessoas com `email: null`.
- Quer marcar quem criou? Crie na database uma propriedade do tipo **Created by** (ex.:
  "Criado por") e use-a em `mention:`. Evite *Last edited by* se não precisar: cada troca de
  editor vira mudança no `{{changes.summary}}`.

## Quem fez a alteração

Todo evento de página traz quem o disparou. `event.authors` são essas pessoas, com o
`discordId` do mapa `people`:

```yaml
fields:
  - { name: "🛠️ Por", value: "{{mention.event.authors}}", inline: true }   # chip clicável
  - { name: "🛠️ Por", value: "{{person.event.authors}}", inline: true }    # "Nome (id)" em texto
```

- Não notifica ninguém: quem fez a mudança não precisa de ping da própria ação. Para notificar,
  ponha `event.authors` em `mention:`.
- Evento agregado (várias edições juntas) pode ter mais de uma pessoa. Integrações e bots ficam
  de fora, assim como pessoa que a integração não consegue ler; sem ninguém, o campo mostra `—`.
- O serviço busca cada pessoa em `/users` só quando alguma regra casou com o evento. Se o Notion
  responder 429 ou 5xx, o evento volta para a fila antes de gravar o snapshot, sem perder a
  mudança.
- Não vale em comentários: lá use `comment.author`.

## Comentários

```yaml
- name: comentario
  source: demandas
  on: [comment.created]
  send_to: [canal-comentarios]
  mention: [comment.mentions]          # notifica quem foi @mencionado
  embed:
    author: { name: "💬 Novo comentário" }
    title: "{{page.title}}"
    url: "{{page.url}}"
    description: ">>> {{comment.text}}"
    fields:
      - { name: "✍️ Autor", value: "{{mention.comment.author}}", inline: true }
      - { name: "👥 Mencionados", value: "{{mention.comment.mentions}}", inline: true }
```

- O evento só traz ids: o serviço busca o comentário, a página (para achar a source) e cada
  pessoa na API. Comentário não altera o snapshot da página.
- Precisa da capability *Read comments* e do evento *Comment created* na subscription; sem a
  capability o Notion nem entrega o evento.
- `comment.deleted` é descartado; tipo sem regra é descartado sem chamar a API.

## Passo a passo de uma instância nova

1. **Notion — integração** ([notion.so/profile/integrations](https://www.notion.so/profile/integrations)):
   criar integração **Internal** no workspace e marcar as capabilities:
   - *Read content* (obrigatória; não precisa de update/insert);
   - *Read comments* (se for notificar comentários);
   - *Read user information including email addresses* (se for usar menções).

   Copiar o token para `NOTION_API_TOKEN`.
2. **Notion — acesso:** na database, `•••` → **Connections** → adicionar a integração.
3. **Discord — webhooks:** em cada canal, **Editar canal → Integrações → Webhooks → Novo
   webhook → Copiar URL** e gravar numa env (uma por canal).
4. **Config:** `cp config/rules.example.yaml config/rules.yaml`; ajustar `database_id`,
   targets, regras, visual e `people`. Conferir que os nomes de propriedade e os valores de
   status batem com a database (texto exato).
5. **Subir** o serviço acessível em HTTPS, expondo só `POST /webhook/notion`.
6. **Subscription:** na aba **Webhooks** da integração, criar a subscription para
   `https://SEU_HOST/webhook/notion` com os eventos `page.*` desejados (e `comment.created`).
7. **Verificação:** o Notion envia o token uma vez; ele fica em `data/verification_token`
   (`docker compose exec notion2discord cat /app/data/verification_token`). Gravar em
   `NOTION_VERIFICATION_TOKEN`, reiniciar e colar o token no **Verify** do Notion.
8. **Teste:** criar uma demanda, mudar o status e comentar com uma @menção; conferir os canais.

Depois de editar o `rules.yaml` ou o `.env`, recriar o container (`docker compose up -d
--force-recreate`); config inválida impede a subida e o log aponta o campo.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Nada chega e o proxy mostra 401 | `NOTION_VERIFICATION_TOKEN` vazio ou diferente do da subscription |
| Mudança de status demora | `page.properties_updated` é agregado pelo Notion (~1–3 min) |
| Evento chega mas nenhum canal recebe | `when`/nome de propriedade/valor não bate (texto exato); rode com `N2D_LOG_LEVEL=debug` |
| Pessoa aparece pelo nome, sem marcar | e-mail fora do `people`, ou integração sem permissão de ler e-mail |
| Comentários não chegam | falta *Read comments* ou o evento na subscription |
| Imagem não aparece | URL não é `https` pública, ou arquivo pesado demais |
| Mensagem descartada no log (`target responded 400`) | embed passou dos limites do Discord ou webhook apagado |
