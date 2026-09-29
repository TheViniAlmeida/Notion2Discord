# Integração com o n8n (fase 2)

O n8n entra como **consumidor** do Notion2Discord, nunca como segunda porta de entrada do
Notion. Assinatura, dedup, snapshot e diff continuam num lugar só: o serviço.

## 1. Contrato

O n8n **não** recebe webhook do Notion. Ele recebe do Notion2Discord, por um target
`type: webhook`, o evento enriquecido (`EnrichedEvent`) em JSON, via `POST` com
`Content-Type: application/json`:

```json
{
  "type": "page.properties_updated",
  "label": "Tarefa atualizada",
  "sourceKey": "demandas",
  "timestamp": "2026-09-21T12:00:00.000Z",
  "page": {
    "id": "page-uuid",
    "url": "https://www.notion.so/...",
    "title": "Colocar pacote de unifomes FLA",
    "properties": { "Status": "Concluido", "Atribuido": "Hades" },
    "people": {
      "Atribuido": [{ "name": "Hades", "email": null, "discordId": "100000000000000001" }]
    }
  },
  "changes": [
    { "property": "Status", "from": "Em andamento", "to": "Concluido" }
  ]
}
```

| Campo | Significado |
|---|---|
| `type` | tipo do evento do Notion (`page.created`, `page.properties_updated`, `page.content_updated`, `page.deleted`, `page.undeleted`, `comment.created`) |
| `label` | rótulo legível do tipo (configurável em `labels` no `rules.yaml`) |
| `sourceKey` | chave da source em `rules.yaml` (qual database gerou o evento) |
| `timestamp` | horário do evento segundo o Notion |
| `page.properties` | **todas** as propriedades da página, já normalizadas para texto (`null` = vazia) |
| `page.people` | pessoas de cada propriedade *people*, com o `discordId` do mapa `people` do `rules.yaml` (ausente se não mapeada). O `email` sempre vem `null`: e-mail não sai do serviço. Ausente em `page.deleted` |
| `authors` | quem fez a alteração (`event.authors`), no formato de `page.people` (sem e-mail); presente quando o evento traz pessoas e alguma regra casou, ausente em comentários |
| `comment` | só em `comment.created`: `{ text, author, mentions }`, pessoas no mesmo formato de `page.people` (sem e-mail) |
| `changes` | só o que mudou desde o último snapshot, com `from` e `to`; vazio em `page.deleted` |

Numa página vista pela primeira vez, `changes` traz com `from: null` só as propriedades que o
evento aponta como alteradas (`page.properties_updated`) ou todas as preenchidas (demais
eventos). Um `page.properties_updated` sem mudança não é enviado, e `changes` já sai sem as
propriedades do `ignore` da regra.

Entrega: o serviço tenta de novo uma vez em `429` (respeitando `retry_after`) e em `5xx`;
um `4xx` do n8n é registrado no log e o evento é descartado para aquele target. Cada
requisição tem timeout de 10 s. Responda `2xx` rápido no workflow (node Webhook em modo
"Respond immediately") para não segurar a fila.

## 2. Passo a passo

1. No n8n, crie um workflow com um node **Webhook**, método `POST`, e ative o workflow.
2. Copie a **Production URL** do node.
3. No `.env` do Notion2Discord, grave a URL numa env nova, por exemplo
   `N8N_WEBHOOK_DEMANDAS=...`. A URL fica **só** no `.env`: o repo é público.
4. No `config/rules.yaml`, declare o target referenciando o **nome** da env e ligue a(s)
   regra(s) a ele (exemplo abaixo).
5. Reinicie o container (`docker compose up -d`). Config inválida ou env ausente impede a
   subida, com o campo apontado no log.

## 3. Exemplo de regra

```yaml
targets:
  n8n-demandas:
    type: webhook
    url_env: N8N_WEBHOOK_DEMANDAS

rules:
  - name: n8n-demandas
    source: demandas
    on: [page.created, page.properties_updated]
    send_to: [n8n-demandas]
```

Target `webhook` não usa `embed`: o evento vai inteiro. Condições `when` (`changed_to`,
`changed_from`, `equals`, `changed`) funcionam igual às das regras de Discord, se o
workflow só quiser um recorte.

## 4. Anti-duplicação

- Toda automação nova consome o evento enriquecido deste serviço.
- **Ninguém** cria uma segunda subscription de webhook no Notion para o mesmo workspace,
  nem reimplementa snapshot ou diff dentro do n8n: isso duplicaria ingestão, dedup e estado.
- Precisa de um dado que o evento não traz? Estenda o `EnrichedEvent` no serviço (com
  teste), em vez de o n8n chamar a API do Notion por fora.
