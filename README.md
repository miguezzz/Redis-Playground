# Fila de Ingressos com Redis

Playground de sistemas distribuídos pra entender, na prática, **fila de espera estilo Ticketmaster**, **locks distribuídos** e **admissão controlada** — tudo orquestrado por Redis. Inspirado no fluxo de venda de ingresso pra show com lugar marcado.

Não é template de produção: é um sandbox pequeno onde cada decisão (TTL, capacity, lock pessimista vs otimista) aparece no terminal e na dashboard imediatamente, pra você sentir o efeito de cada parâmetro.

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | NestJS 11 · ioredis · BullMQ · Socket.io |
| Frontend | React 19 · Vite 6 · socket.io-client |
| Redis | Hospedado no Dockploy |
| Observabilidade | Dashboard ao vivo + Bull Board + Redis Streams + Dozzle |

## O que tem aqui

- **Fila de espera FIFO** com `ZSET` ordenado por timestamp de entrada — posição via `ZRANK`.
- **Admissão atômica** via script Lua que limpa sessões expiradas e faz `ZPOPMIN` até preencher a capacidade.
- **Lock pessimista de assento** com `SET NX PX` — TTL curto garante que assento abandonado volta sozinho.
- **Confirmação transacional** via `MULTI/EXEC` (`SADD sold ... DEL lock ...`).
- **Event log** em `Redis Streams` (`XADD ... MAXLEN ~ 5000`) com timeline visual na dashboard.
- **Worker periódico** com BullMQ rodando a cada 1s pra admissão e broadcast de estado.
- **Push em tempo real** via Socket.io: posição na fila, "sua vez", mudanças de assento.

## Como funciona

1. Usuário clica "Comprar ingresso" → backend gera ticket e faz `ZADD waiting:show:{id} {ts} {ticketId}`.
2. Frontend abre WebSocket e entra na room daquele ticket.
3. Worker BullMQ roda a cada 1s e executa script Lua atômico ([queue.service.ts](backend/src/queue/queue.service.ts)):
   - Remove sessões expiradas: `ZREMRANGEBYSCORE active:show:{id} -inf NOW`
   - Enquanto `ZCARD active < capacity`, faz `ZPOPMIN waiting` e cria sessão com TTL
4. Quando admitido, servidor emite `your-turn` → frontend redireciona pro mapa de assentos.
5. Seleção de assento: `SET lock:seat:{showId}:{seatId} {ticketId} NX PX 30000` ([seats.service.ts:48](backend/src/seats/seats.service.ts#L48)).
6. Confirmação: `MULTI / SADD sold / DEL lock / EXEC` + `ZREM active:show` → próximo da fila admitido no tick seguinte.
7. Cada operação dispara `XADD events:show:{id}` ([events.service.ts](backend/src/events/events.service.ts)) — vira timeline auditável.

## Quickstart local

```bash
# 1. URL do Redis (Dockploy ou local)
cp .env.example .env
# editar REDIS_URL — use a URL externa do Dockploy ou `redis://localhost:6379`

# 2. Backend
cd backend && npm install && npm run start:dev

# 3. Frontend (outro terminal)
cd frontend && npm install && npm run dev
```

Abre [http://localhost:5173](http://localhost:5173) e **abre várias abas em paralelo** pra ver a fila funcionando. Com `QUEUE_CAPACITY=3` (default), só 3 pessoas entram em compra ao mesmo tempo — o resto fica na fila com posição atualizando em tempo real.

## Observabilidade em 3 camadas

| Camada | URL | O que mostra |
|---|---|---|
| **Dashboard ao vivo** | [/#admin](http://localhost:5173/#admin) | Fila, sessões ativas, locks, vendidos e timeline de eventos em tempo real |
| **Bull Board** | [/admin/queues](http://localhost:5173/admin/queues) | Jobs BullMQ (admissão e broadcast): ativos, completados, falhados, histórico |
| **Dozzle** | URL do seu Dockploy | Logs do container ao vivo com busca — útil pra debug sem SSH |

Os logs do backend já vêm estruturados com o `Logger` do NestJS — cada operação produz uma linha clara:

```
[Queue] JOIN  abc123XYZ → show:foo-fighters
[Queue] ADMIT abc123XYZ → session 60000ms
[Seats] HOLD  C5 ← abc123XYZ (ttl 30000ms)
[Seats] SOLD  C5 → abc123XYZ
[Queue] DONE  abc123XYZ ← show:foo-fighters
```

## Deploy

- **Backend no Dockploy** (Dockerfile + healthcheck): [DEPLOY_BACKEND.md](DEPLOY_BACKEND.md)
- **Dozzle no Dockploy** (UI de logs com auth): [DOZZLE_DOCKPLOY.md](DOZZLE_DOCKPLOY.md)

## Estrutura do código

| Arquivo | Pra que serve |
|---|---|
| [backend/src/queue/queue.service.ts](backend/src/queue/queue.service.ts) | Script Lua de admissão atômica, `ZADD/ZRANK/ZPOPMIN` |
| [backend/src/queue/queue.processor.ts](backend/src/queue/queue.processor.ts) | BullMQ worker que admite e empurra posição via socket |
| [backend/src/queue/queue.gateway.ts](backend/src/queue/queue.gateway.ts) | Socket.io com rooms por ticket pra push direcionado |
| [backend/src/seats/seats.service.ts](backend/src/seats/seats.service.ts) | Lock pessimista, `MULTI/EXEC` na confirmação |
| [backend/src/events/events.service.ts](backend/src/events/events.service.ts) | Wrapper de Redis Streams (`XADD`/`XREVRANGE`) |
| [backend/src/admin/admin-state.service.ts](backend/src/admin/admin-state.service.ts) | Snapshot completo do show (fila + ativos + locks + sold + eventos) |
| [frontend/src/pages/Admin.tsx](frontend/src/pages/Admin.tsx) | Dashboard ao vivo |
| [frontend/src/pages/Seats.tsx](frontend/src/pages/Seats.tsx) | Mapa de assentos com timer e broadcast de holds |

## Variáveis de ambiente

| Var | Default | Descrição |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` | URL do Redis. Use `rediss://` pra TLS |
| `QUEUE_CAPACITY` | `3` | Quantos usuários compram simultaneamente |
| `SESSION_TTL_MS` | `60000` | Quanto tempo cada ticket admitido tem pra escolher e confirmar assento |
| `ADMIT_INTERVAL_MS` | `1000` | Frequência do worker de admissão |
| `PORT` | `3000` | Porta do backend |

## Coisas pra brincar

- **Forçar contenção**: `QUEUE_CAPACITY=1` + 10 abas. Vira fila séria e dá pra cronometrar.
- **Ver expiração**: `SESSION_TTL_MS=15000` e não escolher assento. A vaga volta sozinha pro próximo no tick seguinte.
- **Race de assento**: duas abas tentando o mesmo lugar — só uma ganha o `SET NX`, a outra recebe `seat.hold-conflict` na timeline.
- **Stream cru**: `redis-cli XREAD BLOCK 0 STREAMS events:show:foo-fighters '$'` no terminal te dá tail em tempo real dos mesmos eventos que aparecem na dashboard.
- **MONITOR**: `redis-cli MONITOR` enquanto roda mostra todo o tráfego — bom pra entender o custo de cada operação.
- **Mais nodes**: substitui o `SET NX` por [Redlock](https://github.com/mike-marcacci/node-redlock) e adiciona 2-3 instâncias do Redis pra simular cluster.

## Padrões de Redis em uso

- `ZSET` com score=timestamp pra fila FIFO e sessões com expiry
- `ZPOPMIN` atômico via Lua pra admissão sem race condition
- `SET NX PX` pra lock pessimista com auto-release
- `MULTI/EXEC` pra confirmação transacional
- `Streams` (`XADD MAXLEN ~`) pra event log auditável e capado
- `SMEMBERS/SADD/SISMEMBER` pra conjunto de assentos vendidos
- `defineCommand` do ioredis pra carregar script Lua uma vez (Redis cacheia por SHA)

## Licença

MIT — código aqui é pra estudo, copia à vontade.
