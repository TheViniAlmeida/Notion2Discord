# Notion2Discord

Wrapper genérico que transforma **webhooks do Notion** em **webhooks do Discord (embeds)** —
e em webhooks JSON genéricos para outras automações (n8n etc.) — guiado por regras
declarativas em YAML. Nada da semântica dos canais vive no código: uma instância atende
várias databases, cada uma com suas regras e seus destinos.

**Caso de uso original:** database de demandas de clientes no Notion espelhada em canais
do Discord (`Demandas-Historico`, `Demandas-Adicionadas`, `Demandas-EmAndamento`,
`Demandas-Atualizadas`, `Demandas-Finalizadas`) — tarefa criada, status atualizado, tarefa
concluída, cada evento vira um embed no canal certo.

## Como funciona

```
Notion ──POST──▶ /webhook/notion
                   │ assinatura HMAC (X-Notion-Signature) + dedup → ACK 200
                   ▼
              fila interna → busca a página na API → diff contra snapshot (SQLite)
                   ▼
              rules engine (config/rules.yaml)
                   ├ target discord → embed no webhook do canal
                   └ target webhook → JSON enriquecido (n8n, etc.)
```

O payload do webhook do Notion não traz valores de propriedades — por isso o serviço busca
a página e compara com o último snapshot que guardou, produzindo mudanças `from → to`
("Status: Em andamento → Concluido") que as regras usam pra rotear.

## Configuração

Dois arquivos, papéis distintos:

| Arquivo | Papel | Versionado? |
|---|---|---|
| `config/rules.yaml` | sources, targets e regras (referencia envs **por nome**) | pode (sem segredos) — exemplo em [`config/rules.example.yaml`](config/rules.example.yaml) |
| `.env` | tokens e URLs de webhook (valores reais) | **nunca** — template em [`.env.example`](.env.example) |

Exemplo de regra:

```yaml
rules:
  - name: tarefa-finalizada
    source: demandas
    on: [page.properties_updated]
    when: { property: "Status", changed_to: "Concluido" }
    send_to: [demandas-finalizadas]
    embed:
      title: "✅ {{page.title}}"
      url: "{{page.url}}"
      color: "#57F287"
      fields:
        - { name: "Status", value: "{{change.from}} → {{change.to}}", inline: true }
```

Condições `when`: `changed_to`, `changed_from`, `equals`, `changed`. Placeholders:
`{{page.title}}`, `{{page.url}}`, `{{event.label}}`, `{{prop.<Nome>}}`, `{{change.from}}`,
`{{change.to}}`, `{{changes.summary}}`.

## Rodando

Requisitos: Node.js >= 22 (local) ou Docker.

```bash
cp .env.example .env                          # preencher os valores
cp config/rules.example.yaml config/rules.yaml # ajustar database_id e regras
npm install
npm run dev        # desenvolvimento
npm test           # suite de testes
docker compose up -d --build   # produção
```

O serviço nasce interno: exponha somente `POST /webhook/notion` por um reverse proxy com
TLS (Nginx-UI, Traefik, Caddy...). `GET /healthz` é o healthcheck interno.

## Setup ponta a ponta

### 1. Discord — webhooks dos canais

Para cada canal: **Configurações do canal → Integrações → Webhooks → Novo webhook**, copie
a URL e grave no `.env` (`DISCORD_WH_*`). Uma env por canal.

### 2. Notion — integração e subscription

1. Crie uma integração interna em [notion.so/my-integrations](https://www.notion.so/my-integrations),
   copie o token para `NOTION_API_TOKEN` e dê acesso à(s) database(s) desejada(s)
   (menu `...` da database → Connections).
2. Copie o ID da database para o `database_id` do `rules.yaml` (está na URL da database).
3. Suba o serviço já acessível publicamente e, na aba **Webhooks** da integração, crie a
   subscription apontando para `https://SEU_HOST/webhook/notion`, selecionando os eventos
   `page.*` desejados.
4. O Notion envia um POST único com o `verification_token` — o serviço loga a chegada
   (prefixo mascarado). Recupere o valor, grave em `NOTION_VERIFICATION_TOKEN` no `.env`,
   reinicie o serviço e cole o token na UI do Notion para ativar a subscription.
5. Teste: crie/edite uma tarefa na database e confira os embeds. Eventos agregados
   (`page.properties_updated`) podem levar ~1 minuto para chegar.

### 3. n8n e outras automações (opcional)

Targets `type: webhook` recebem o evento enriquecido em JSON — o n8n consome isso num node
Webhook, sem tocar na API do Notion. Contrato e passo a passo: [`docs/n8n.md`](docs/n8n.md).

## Segurança

- Repo público: **nenhum segredo em arquivo versionado**. Targets referenciam envs por nome.
- Toda requisição de evento exige `X-Notion-Signature` válida (HMAC-SHA256, comparação
  timing-safe) — sem assinatura, 401.
- Dedup por id de evento (retries do Notion não duplicam mensagem).
- Container non-root; snapshot em volume dedicado.

## Documentação

- Design/spec: [`docs/specs/2026-09-21-notion2discord-design.md`](docs/specs/2026-09-21-notion2discord-design.md)
- Plano de implementação (v1): [`docs/plans/2026-09-21-implementacao-v1.md`](docs/plans/2026-09-21-implementacao-v1.md)
- Integração n8n (fase 2): `docs/n8n.md`
- Referências: [Notion webhooks](https://developers.notion.com/reference/webhooks) ·
  [Discord webhooks](https://support.discord.com/hc/pt-br/articles/228383668) ·
  [Discord embeds](https://discord.com/developers/docs/resources/webhook#execute-webhook)

## Licença

MIT
