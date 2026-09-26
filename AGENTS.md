# Notion2Discord — instruções para agentes

> **Espelho:** `CLAUDE.md` ≡ `AGENTS.md`. Alterou um, alterou o outro.

## O que é

Serviço Node.js 22 + TypeScript (ESM) que recebe **webhooks nativos do Notion**, enriquece
o evento (fetch da página + diff contra snapshot em SQLite) e roteia para **webhooks do
Discord (embeds)** ou webhooks JSON genéricos (n8n), guiado por regras declarativas em
YAML. Genérico e multi-database: a semântica dos canais é configuração, nunca código.

- **Spec (fonte da arquitetura):** `docs/specs/2026-09-21-notion2discord-design.md`
- **Plano de implementação (v1):** `docs/plans/2026-09-21-implementacao-v1.md` — tasks com
  TDD passo a passo; executar na ordem, cada task fecha com `npm test` verde + commit.
- **Fase 2 (n8n):** `docs/n8n.md` — n8n consome o target `type: webhook`; nunca criar
  segunda subscription do Notion nem duplicar a lógica de diff fora do serviço.

## Regras deste repo

1. 🔴 **Repo PÚBLICO — nenhum segredo em arquivo versionado, teste, log ou commit.**
   Token, URL de webhook do Discord e URL de n8n só existem no `.env` (gitignored) e são
   referenciados **pelo nome da env var** (`DISCORD_WH_*`, `NOTION_API_TOKEN`,
   `NOTION_VERIFICATION_TOKEN`). Placeholders no que é versionado (`.env.example`,
   `config/rules.example.yaml`). Antes de qualquer commit: reler o diff procurando valor real.
2. **Idioma:** docs, commits e comentários longos em PT-BR; código, identificadores e
   mensagens de log em inglês.
3. **Commits:** Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`), mensagem
   curta coerente com o diff. **Sem trailers de atribuição de agente** (nada de
   `Co-Authored-By`, "Generated with…" — ordem do operador).
4. **Semântica no YAML, não no código.** Nome de canal, valor de status ("Concluido",
   "Em andamento") e roteamento vivem em `config/rules.yaml`. Se um caso novo pedir código
   com nome de canal ou valor de status hardcoded, o design está errado — pare e proponha
   extensão do schema de config.
5. **Toda mudança de comportamento chega com teste** (vitest, `tests/*.test.ts`). Rodar
   `npm test` antes de todo commit; assinatura HMAC roda sobre o **corpo bruto** da
   requisição — não introduzir parser que re-serialize o JSON antes da verificação.
6. **Fail-fast:** config inválida ou env ausente derruba a subida com mensagem apontando o
   campo. Não degradar para default silencioso.
7. **Erro de destino não derruba o serviço:** 429 respeita `retry_after`; 5xx tem retry;
   4xx loga e descarta. A fila segue para o próximo evento.

## Estrutura

| Caminho | Responsabilidade |
|---|---|
| `src/index.ts` | wiring + fail-fast + shutdown gracioso |
| `src/server.ts` | rotas HTTP, assinatura, handshake de verificação, dedup |
| `src/signature.ts` | HMAC-SHA256 timing-safe do `X-Notion-Signature` |
| `src/config.ts` | schema zod do YAML + resolução de envs por nome |
| `src/queue.ts` | fila em memória serial com retry/backoff |
| `src/notion.ts` | client da API (`Notion-Version: 2025-09-03`) + normalização de propriedades |
| `src/store.ts` | SQLite: snapshots de página + dedup de eventos |
| `src/diff.ts` | mudanças `{property, from, to}` entre snapshot e página atual |
| `src/rules.ts` | matching: source + `on` + `when` (`changed_to`/`changed_from`/`equals`/`changed`) |
| `src/template.ts` | placeholders `{{...}}` + limites de embed do Discord |
| `src/senders.ts` | POST discord (embed) e webhook genérico (JSON) |
| `src/processor.ts` | orquestra fetch → diff → rules → send |
| `config/` | `rules.example.yaml` (versionado) / `rules.yaml` (local) |
| `tests/` | vitest, um arquivo por módulo |

## Comandos

```bash
npm install
npm run dev     # tsx watch
npm test        # vitest run
npm run build   # tsc → dist/
docker compose up -d --build
```

## Contexto operacional (deploy)

Produção: container Docker na VPS pessoal do operador, atrás de reverse proxy com TLS —
só `POST /webhook/notion` é público; `/healthz` fica interno. Detalhes de host/rota vivem
na doc de infra do operador, **não** neste repo público.
