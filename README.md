# Fila de Ingressos com Redis

Playground de sistemas distribuídos pra entender, na prática, **fila de espera estilo Ticketmaster**, **locks distribuídos** e **admissão controlada** — tudo orquestrado por Redis. Inspirado no fluxo de venda de ingresso pra show com lugar marcado.

Não é template de produção: é um sandbox onde cada decisão (TTL, capacity, lock pessimista) aparece no terminal e na dashboard imediatamente, pra você sentir o efeito de cada parâmetro. A interface imita uma bilheteria real (home com carrossel, busca, pôsteres, mapa de assentos) pra deixar a brincadeira concreta.

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | NestJS 11 · ioredis · BullMQ · Socket.io |
| Frontend | React 19 · Vite 6 · socket.io-client |
| Redis | Hospedado no [Dockploy](https://dockploy.com) |
| Observabilidade | Dashboard ao vivo + Bull Board + Redis Streams + Dozzle |

## O que tem aqui

- **Home estilo bilheteria** — carrossel full-width, busca no nav, fileira de eventos com pôsteres reais.
<img width="1908" height="919" alt="image" src="https://github.com/user-attachments/assets/8efabcc1-4715-4587-993c-e4bd683f16df" />

- **Fila de espera FIFO** com `ZSET` ordenado por timestamp — posição via `ZRANK`.
- **Admissão atômica** via script Lua que limpa sessões expiradas e faz `ZPOPMIN` até preencher a capacidade.
- **Lock pessimista de assento** com `SET NX PX` — TTL curto garante que assento abandonado volta sozinho.
- **Seleção de múltiplos assentos** com confirmação transacional em lote (`MULTI/EXEC`), validando todos os locks antes de vender.
- **Event log** em `Redis Streams` (`XADD ... MAXLEN ~ 5000`) com timeline filtrável na dashboard.
- **Worker periódico** com BullMQ (1s) pra admissão e broadcast de estado.
- **Push em tempo real** via Socket.io: posição na fila, "sua vez", mudanças de assento.

## Como funciona

1. Usuário escolhe um evento → backend gera ticket e faz `ZADD waiting:show:{id} {ts} {ticketId}`.
2. Frontend abre WebSocket e entra na room daquele ticket; a sala de espera mostra a posição com um anel de progresso.
3. Worker BullMQ roda a cada 1s e executa script Lua atômico ([queue.service.ts](backend/src/queue/queue.service.ts)):
   - Remove sessões expiradas: `ZREMRANGEBYSCORE active:show:{id} -inf NOW`
   - Enquanto `ZCARD active < capacity`, faz `ZPOPMIN waiting` e cria sessão com TTL
4. Quando admitido, servidor emite `your-turn` → frontend abre o mapa de assentos (timer de 60s).
5. Cada assento escolhido faz `SET lock:seat:{showId}:{seatId} {ticketId} NX PX 30000` ([seats.service.ts](backend/src/seats/seats.service.ts)). Clicar de novo solta o lock.
6. Confirmação em lote valida **todos** os locks, então `MULTI / SADD sold / DEL lock / EXEC` e libera a sessão **uma vez** ([`confirmMany`](backend/src/seats/seats.service.ts)) → próximo da fila admitido no tick seguinte.
7. Cada operação dispara `XADD events:show:{id}` ([events.service.ts](backend/src/events/events.service.ts)) — vira timeline auditável.

### O conceito de "tick"

A admissão **não** roda a cada requisição do usuário — roda num **ritmo fixo**. Um job repetível do BullMQ (`repeat: { every: ADMIT_INTERVAL_MS }`, default 1000ms) dispara de tempos em tempos, e cada disparo é um **tick**. A cada tick o worker faz, na ordem:

1. expira sessões vencidas (`ZREMRANGEBYSCORE`),
2. admite quantos couberem na capacidade livre (`ZPOPMIN` em loop, no script Lua),
3. recalcula as posições da fila e faz broadcast do estado.

Por que pulsar em vez de reagir a cada evento?

- **Atomicidade barata** — concentrar a lógica de admissão num único script Lua por tick evita corrida entre vários pedidos simultâneos.
- **Custo previsível** — a carga no Redis é constante (1 execução/segundo por show), não cresce com o número de gente na fila.
- **Simplicidade** — expirar sessão e admitir o próximo viram a mesma rotina, em vez de timers espalhados.

Consequência prática: **ser admitido não é instantâneo**. Entre você entrar na fila (ou alguém liberar uma vaga) e ser admitido pode passar até ~1 tick. Diminuir `ADMIT_INTERVAL_MS` deixa a fila mais "responsiva" mas bate mais no Redis; aumentar economiza, à custa de latência. É um dos parâmetros mais legais de mexer pra sentir o trade-off.

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

## Eventos

Quatro eventos seedados em [shows.service.ts](backend/src/shows/shows.service.ts), cada um com pôster vertical (cards) e banner horizontal (carrossel) em [frontend/public/](frontend/public/):

| Evento | Local | Lugares |
|---|---|---|
| Foo Fighters | Allianz Parque | 60 |
| Dune: Parte II (IMAX) | Cinépolis JK | 40 |
| The Weeknd | MorumBIS | 70 |
| Ludmilla (Numanice) | Espaço Unimed | 54 |

A metadata de exibição é decorativa; a mecânica de fila/lock funciona igual pra qualquer show.

## Observabilidade em 3 camadas

| Camada | URL | O que mostra |
|---|---|---|
| **Dashboard ao vivo** | aba **Admin** no header | Fila, sessões ativas, locks, vendidos e timeline de eventos (com busca e filtros) em tempo real |
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

### Bull Board — o que é e pra que serve

[Bull Board](https://github.com/felixmosh/bull-board) é a UI oficial pra inspecionar as filas do BullMQ. Pensa nele como o "painel da fábrica de workers", enquanto a dashboard Admin é o "painel da bilheteria".

No app existem **dois jobs repetíveis** rodando a cada 1s:

- **`admission`** ([queue.processor.ts](backend/src/queue/queue.processor.ts)) — limpa sessões expiradas e admite gente da fila (`ZPOPMIN`).
- **`admin-broadcast`** ([admin-broadcast.processor.ts](backend/src/admin/admin-broadcast.processor.ts)) — empurra o snapshot de estado pra dashboard via Socket.io.

Pra cada fila o Bull Board mostra abas de **Ativo**, **Completo**, **Erro** (com stack trace completo), **Atrasado/Aguardando** e **Repetir** (o agendador `every: 1000`). Use pra:

1. **Ver se os workers estão vivos** — se a fila parou de admitir, o job `admission` está rodando ou empilhou em "Atrasado"?
2. **Debugar falhas** — se o script Lua falhar ou o Redis cair, o job vai pra aba **Erro** com a stack trace exata.
3. **Ver o histórico** — quantas vezes o tick rodou, quanto tempo levou cada um.
4. **Reprocessar/limpar** jobs manualmente pela UI.

A divisão de responsabilidade entre as três camadas:

| Pergunta | Onde olhar |
|---|---|
| O que aconteceu de **negócio** (admit, hold, sold)? | Dashboard Admin (Redis Streams) |
| Os **workers** estão saudáveis? Quantos falharam? | **Bull Board** |
| Que **erro/exceção** o processo lançou? | Dozzle (logs do container) |

> Como os jobs aqui são só dois ticks repetidos, o Bull Board é mais "legal de ver o BullMQ trabalhando" do que estritamente necessário. Ele brilha quando há filas com payload e retry (ex: um job `emitir-ingresso` ou `processar-pagamento` disparado no `confirmMany`).

## Deploy

- **Backend no Dockploy** (Dockerfile + healthcheck): [DEPLOY_BACKEND.md](DEPLOY_BACKEND.md)
- **Dozzle no Dockploy** (UI de logs com auth): [DOZZLE_DOCKPLOY.md](DOZZLE_DOCKPLOY.md)

## Estrutura do código

**Backend**

| Arquivo | Pra que serve |
|---|---|
| [queue/queue.service.ts](backend/src/queue/queue.service.ts) | Script Lua de admissão atômica, `ZADD/ZRANK/ZPOPMIN` |
| [queue/queue.processor.ts](backend/src/queue/queue.processor.ts) | BullMQ worker que admite e empurra posição via socket |
| [queue/queue.gateway.ts](backend/src/queue/queue.gateway.ts) | Socket.io com rooms por ticket pra push direcionado |
| [seats/seats.service.ts](backend/src/seats/seats.service.ts) | Lock pessimista + `confirmMany` transacional |
| [events/events.service.ts](backend/src/events/events.service.ts) | Wrapper de Redis Streams (`XADD`/`XREVRANGE`) |
| [admin/admin-state.service.ts](backend/src/admin/admin-state.service.ts) | Snapshot do show (fila + ativos + locks + sold + eventos) |
| [shows/shows.service.ts](backend/src/shows/shows.service.ts) | Catálogo de eventos + metadata de exibição |

**Frontend**

| Arquivo | Pra que serve |
|---|---|
| [App.tsx](frontend/src/App.tsx) | Shell, vibe arena, role switch Cliente/Admin, máquina de passos |
| [components/Header.tsx](frontend/src/components/Header.tsx) | Nav com brand, busca e troca de papel |
| [components/Carousel.tsx](frontend/src/components/Carousel.tsx) | Banner full-width auto-rotativo |
| [components/Poster.tsx](frontend/src/components/Poster.tsx) | Imagem do evento (fallback gradiente por hue) |
| [components/Ticker.tsx](frontend/src/components/Ticker.tsx) | Marquee de Redis Streams |
| [pages/Home.tsx](frontend/src/pages/Home.tsx) | Carrossel + fileira de eventos + resultados da busca |
| [pages/Queue.tsx](frontend/src/pages/Queue.tsx) | Sala de espera com anel de progresso |
| [pages/Seats.tsx](frontend/src/pages/Seats.tsx) | Mapa multi-seleção + pôster lateral + timer/expiração |
| [pages/Done.tsx](frontend/src/pages/Done.tsx) | Ingresso emitido com QR |
| [pages/Admin.tsx](frontend/src/pages/Admin.tsx) | Dashboard ao vivo com timeline filtrável |

## Variáveis de ambiente

| Var | Default | Descrição |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` | URL do Redis. Use `rediss://` pra TLS |
| `QUEUE_CAPACITY` | `3` | Quantos usuários compram simultaneamente |
| `SESSION_TTL_MS` | `60000` | Tempo do ticket admitido pra escolher e confirmar |
| `ADMIT_INTERVAL_MS` | `1000` | Frequência do worker de admissão |
| `PORT` | `3000` | Porta do backend |

## Coisas pra brincar

- **Forçar contenção**: `QUEUE_CAPACITY=1` + 10 abas. Vira fila séria e dá pra cronometrar.
- **Ver expiração**: `SESSION_TTL_MS=15000` e não confirmar. As vagas voltam sozinhas pro próximo no tick seguinte.
- **Race de assento**: duas abas tentando o mesmo lugar — só uma ganha o `SET NX`, a outra recebe `seat.hold-conflict` na timeline (e vê o 🔒).
- **Multi-compra**: selecione vários assentos numa aba e veja que a confirmação só fecha se **todos** os locks ainda forem seus.
- **Stream cru**: `redis-cli XREAD BLOCK 0 STREAMS events:show:foo-fighters '$'` te dá tail em tempo real dos mesmos eventos da dashboard.
- **MONITOR**: `redis-cli MONITOR` enquanto roda mostra todo o tráfego — bom pra entender o custo de cada operação.
- **Mais nodes**: substitui o `SET NX` por [Redlock](https://github.com/mike-marcacci/node-redlock) e adiciona instâncias do Redis pra simular cluster.

## Comandos Redis usados (referência)

Cada comando que o projeto usa, o que faz e o papel dele aqui.

**Fila e sessões (Sorted Sets)** — um `ZSET` guarda membros ordenados por um número (`score`). Usamos timestamp como score pra ter ordem FIFO e expiração por tempo.

| Comando | O que faz | Papel aqui |
|---|---|---|
| `ZADD key score member` | adiciona/atualiza um membro com um score | entrar na fila (`score` = quando entrou) e criar sessão ativa (`score` = quando expira) |
| `ZRANK key member` | posição 0-based do membro na ordem crescente | calcular "quantos estão na sua frente" |
| `ZCARD key` | conta os membros | quantas sessões ativas existem (checar a capacidade) |
| `ZPOPMIN key [n]` | remove e retorna o(s) de **menor** score | admitir o próximo da fila (o que entrou primeiro), atômico |
| `ZRANGE key 0 -1 [WITHSCORES]` | lista membros por faixa | montar fila/ativos/locks na dashboard |
| `ZREM key member` | remove um membro | sair da fila / encerrar sessão |
| `ZREMRANGEBYSCORE key -inf {agora}` | remove membros num intervalo de score | limpar sessões cujo prazo já passou |

**Lock de assento e vendas (String + Set)**

| Comando | O que faz | Papel aqui |
|---|---|---|
| `SET key val NX PX {ms}` | grava **só se não existir** (`NX`), com expiração em ms (`PX`) | lock pessimista do assento — quem grava primeiro "ganha", e o TTL solta sozinho se a pessoa sumir |
| `GET` / `DEL key` | lê / apaga uma chave | conferir o dono do lock / soltar o lock |
| `SADD` / `SISMEMBER` / `SMEMBERS key` | adiciona / testa / lista membros de um conjunto | conjunto de assentos já vendidos |
| `MULTI` … `EXEC` | executa vários comandos numa transação atômica | confirmar vários assentos de uma vez (ou tudo, ou nada) |

**Event log (Streams)** — um Stream é um log append-only com IDs por tempo.

| Comando | O que faz | Papel aqui |
|---|---|---|
| `XADD key MAXLEN ~ N * campo val` | anexa um evento, capando o tamanho em ~N | gravar cada ação (join/admit/hold/sold…) |
| `XREVRANGE key + - COUNT n` | lê os `n` eventos mais recentes (novo→antigo) | alimentar a timeline da dashboard |
| `XREAD BLOCK 0 STREAMS key $` | **bloqueia** esperando eventos novos a partir de agora (`$`) | tail ao vivo no terminal (o `BLOCK 0` = espera pra sempre) |

**Inspeção / infra**

| Comando | O que faz | Papel aqui |
|---|---|---|
| `PING` | responde `PONG` | usado no endpoint `/health` |
| `MONITOR` | espelha em tempo real **todo** comando que o servidor recebe | debug — ver o tráfego cru enquanto você usa o app (verboso; nunca em produção) |
| `defineCommand` (ioredis) | registra um script Lua como um comando próprio | carrega o script de admissão **uma vez**; o Redis cacheia por SHA e roda atômico a cada tick |

> Por que Lua? Um script Lua roda **atomicamente** no Redis — nenhum outro comando se intercala no meio. É isso que garante que "limpar expirados + admitir até a capacidade" não sofra corrida quando vários ticks/clientes acontecem junto.

## Licença

MIT — código aqui é pra estudo, copia à vontade.
