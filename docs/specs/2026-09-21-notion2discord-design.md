# Notion2Discord — Design (v1)

**Data:** 21/09/2026 · **Status:** aprovado pelo operador
**Repo:** https://github.com/TheViniAlmeida/Notion2Discord (público — nenhum segredo em arquivo versionado)

## 1. Problema e objetivo

O operador controla documentação e demandas de clientes em databases do Notion e quer
notificações em canais do Discord conforme mexe nas tarefas: tarefa adicionada, status
atualizado, tarefa concluída etc. O caso inicial usa 5 canais (`Demandas-Historico`,
`Demandas-Adicionadas`, `Demandas-EmAndamento`, `Demandas-Atualizadas`,
`Demandas-Finalizadas`), mas o sistema é **genérico**: nada dessa semântica vive no código —
tudo é configuração declarativa. Uma instância atende múltiplas databases/projetos.

## 2. Decisões fechadas

| Decisão | Escolha |
|---|---|
| Hospedagem | VPS do operador, container Docker, atrás de reverse proxy com TLS em hostname dedicado (só a rota do webhook exposta) |
| Stack | Node.js 22 + TypeScript (ESM), Fastify, better-sqlite3, zod, yaml, pino, vitest |
| Ingestão | Webhooks nativos do Notion (não polling) |
| Roteamento | Rules engine 100% declarativo em YAML — semântica dos canais é config, não código |
| Escopo | Multi-database: uma instância, N sources, N targets, N rules |
| Saída | Discord via webhook com **embeds**; target genérico `webhook` (JSON) para outros consumidores |
| Fase 2 | n8n consome o target genérico `webhook` — coexiste sem duplicar ingestão/diff |

## 3. Restrições impostas pelo Notion (medidas na doc oficial, 21/09/2026)

- O payload do webhook é **magro**: id do evento, tipo, timestamp, entidade e ids de
  propriedades alteradas — **sem valores**. Para saber "Status mudou de X para Y" é
  obrigatório buscar a página na API e comparar com um **snapshot local** anterior.
- Assinatura: header `X-Notion-Signature` = `sha256=` + HMAC-SHA256 do corpo bruto com o
  `verification_token`. Comparação deve ser timing-safe.
- Ativação da subscription: o Notion envia um POST único com `verification_token`; o valor
  é guardado (env) e colado de volta na UI do Notion.
- Eventos como `page.properties_updated` chegam **agregados/com atraso** (batch); entrega
  pode se repetir → dedup por id de evento é necessário.

## 4. Arquitetura

```
Notion ──POST──▶ /webhook/notion (Fastify)
                   │ 1. valida X-Notion-Signature (HMAC-SHA256, timing-safe)
                   │ 2. dedup por event id (SQLite) → ACK 200 imediato
                   ▼
              Fila interna (in-process, retry com backoff)
                   ▼
              Processor
                   │ 3. busca a página na API do Notion
                   │ 4. normaliza propriedades e faz diff contra snapshot (SQLite)
                   │ 5. gera evento enriquecido {type, page, changes[from→to]}
                   ▼
              Rules Engine (YAML)
                   │ 6. casa: source (database) + tipos de evento + condições when
                   ▼
              Senders
                   ├ target discord → monta embed do template e POSTa (respeita 429)
                   └ target webhook → POSTa o evento enriquecido em JSON (fase 2: n8n)
```

### Componentes (cada um com uma responsabilidade, testável isolado)

| Módulo | Responsabilidade |
|---|---|
| `config` | parse + validação (zod) do YAML na subida; resolve nomes de env dos targets; **fail-fast** |
| `server` | rotas HTTP, verificação de assinatura, captura do verification_token, ACK rápido |
| `queue` | fila em memória com retry/backoff; desacopla ACK do processamento |
| `notion` | client da API + normalização de propriedades para tipos simples |
| `store` | SQLite: snapshots de página + dedup de eventos (volume Docker) |
| `diff` | compara snapshot anterior × atual → lista de mudanças `{property, from, to}` |
| `rules` | matching declarativo: source, tipos `on`, condições `when` |
| `template` | interpolação `{{...}}` nos embeds; limites do Discord |
| `senders` | `discord` (embed) e `webhook` (JSON genérico); 429/erros |
| `processor` | orquestra fetch → diff → rules → send |

## 5. Configuração

Dois arquivos, papéis distintos:

- **`config/rules.yaml`** (versionável com placeholders; exemplo em
  `config/rules.example.yaml`): sources, targets e rules. **Nunca contém URL/segredo** —
  target referencia o **nome** da env var.
- **`.env`** (nunca versionado; template `.env.example`): `NOTION_API_TOKEN`,
  `NOTION_VERIFICATION_TOKEN`, `DISCORD_WH_*`, `N2D_*`.

Formato (exemplo com o caso Demandas):

```yaml
sources:
  demandas:
    database_id: "REPLACE_WITH_DATABASE_ID"

targets:
  demandas-historico:
    type: discord
    webhook_env: DISCORD_WH_DEMANDAS_HISTORICO
  demandas-finalizadas:
    type: discord
    webhook_env: DISCORD_WH_DEMANDAS_FINALIZADAS
  n8n-geral:
    type: webhook
    url_env: N8N_WEBHOOK_DEMANDAS

rules:
  - name: historico-tudo
    source: demandas
    on: [page.created, page.properties_updated, page.deleted]
    send_to: [demandas-historico]
    embed:
      title: "{{event.label}}: {{page.title}}"
      url: "{{page.url}}"
      color: "#5865F2"

  - name: finalizada
    source: demandas
    on: [page.properties_updated]
    when: { property: "Status", changed_to: "Concluido" }
    send_to: [demandas-finalizadas]
    embed:
      title: "✅ Concluída: {{page.title}}"
      color: "#57F287"
      fields:
        - { name: "Status", value: "{{change.from}} → {{change.to}}", inline: true }
        - { name: "Atribuído", value: "{{prop.Atribuido}}", inline: true }
```

Condições `when` suportadas na v1: `changed_to`, `changed_from`, `equals`, `changed`
(bool — qualquer mudança naquela propriedade). Sem `when` → a regra casa por tipo de evento.
Uma regra pode mandar para vários targets; várias regras podem casar o mesmo evento.

## 6. Segurança (repo público + VPS de produção)

- Nenhum segredo em código, YAML ou commit; envs referenciadas por nome; `.env.example`
  versionado com placeholders.
- Requisição sem assinatura válida → **401**, sem processamento. Corpo bruto preservado
  para o HMAC (sem re-serialização).
- Container non-root, imagem multistage, volume dedicado só para o SQLite.
- Na VPS: serviço nasce interno na rede Docker; só `POST /webhook/notion` ganha rota
  pública via reverse proxy (TLS, hostname dedicado). `GET /healthz` fica interno.
- Log nunca imprime token, URL de webhook ou corpo completo de credencial.

## 7. Tratamento de erros

| Falha | Comportamento |
|---|---|
| Assinatura inválida / ausente | 401, log warn com event id ausente do processamento |
| Evento duplicado | 200, ignorado (dedup) |
| Fetch da página falha | retry com backoff (3 tentativas), depois log error e descarte |
| Discord 429 | respeita `retry_after` e reenvia |
| Discord 4xx/5xx | 1 retry para 5xx; 4xx loga e descarta (config errada não derruba o serviço) |
| Config inválida | processo **não sobe** (fail-fast com mensagem apontando o campo) |
| Evento sem regra | log debug e descarte |
| Página nova sem snapshot | diff trata como criação (todas as propriedades `from: null`) |

## 8. Testes

- **Unitários** (vitest): rules engine, diff, template de embed, verificação de assinatura
  (vetores conhecidos), normalização de propriedades, config zod.
- **Integração**: servidor via `fastify.inject` com payloads-fixture reais do Notion;
  senders com fetch mockado.
- Sem teste e2e contra APIs reais na v1 (validação manual no deploy).

## 9. Fase 2 — n8n (coexistência sem duplicação)

O serviço é a única porta de entrada (assinatura, dedup, snapshot, diff, regras). O n8n
**não** recebe webhook do Notion diretamente: recebe do serviço, via target `type: webhook`,
o evento **enriquecido** (JSON com `type`, `page`, `changes[]`, `properties`). Entregas da
fase 2: doc `docs/n8n.md` + workflow de exemplo. Nenhum código novo no serviço — o target
genérico já nasce na v1.

## 10. Fora de escopo (YAGNI, v1)

- Hot-reload de config (restart resolve), UI/dashboard, fila externa (Redis), múltiplos
  workspaces Notion por instância, edição de mensagens já enviadas no Discord, comentários
  (`comment.*`) e eventos de schema (`database.*`) — o schema aceita os tipos, mas os
  templates da v1 focam em `page.*`.

## 11. Deploy (resumo; runbook no README)

1. Build da imagem e `docker compose up -d` na VPS (stack própria; volume `n2d-data`).
2. Rota no reverse proxy: hostname dedicado → `POST /webhook/notion` do container.
3. Criar webhooks dos canais no Discord e preencher `DISCORD_WH_*` no `.env`.
4. Criar a integração no Notion, apontar a subscription para a URL pública, capturar o
   `verification_token` (o serviço loga a chegada), preencher no `.env` e colar o token na
   UI do Notion para ativar.
5. Testar: criar/alterar tarefa na database e conferir os embeds.
