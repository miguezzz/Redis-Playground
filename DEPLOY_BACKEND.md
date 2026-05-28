# Deploy do backend no Dockploy

Depois desse passo, o Dozzle passa a mostrar os logs ricos do backend (HOLD, ADMIT, SOLD, conflitos), e o backend usa a URL **interna** do Redis (sem expor porta na internet, latência menor).

## Pré-requisitos

- Repositório no GitHub/GitLab com o código (Dockploy puxa de lá), OU upload manual via Docker Compose
- O Redis já tá no Dockploy ✓
- Dozzle já tá no Dockploy ✓

## Caminho A — Deploy via Git (recomendado)

### 1. Sobe o código pro GitHub

```bash
cd /home/victor/Downloads/redis
git init
git add .
git commit -m "initial commit"
git branch -M main
gh repo create queue-redis --private --source=. --push
# ou crie manualmente em github.com/new e: git remote add origin ... && git push -u origin main
```

### 2. Cria a Application no Dockploy

No painel:

1. **Create → Application**
2. **Provider**: GitHub (autorize o app se ainda não fez)
3. **Repository**: `seu-usuario/queue-redis`
4. **Branch**: `main`
5. **Build Type**: **Dockerfile**
6. **Build Context Path**: `./backend`
7. **Dockerfile Path**: `Dockerfile` (relativo ao build context)

### 3. Environment Variables

Em **Environment**:

```env
REDIS_URL=redis://default:SUA_SENHA@redis-ecrou-cxymvh:6379
QUEUE_CAPACITY=3
SESSION_TTL_MS=60000
ADMIT_INTERVAL_MS=1000
PORT=3000
NODE_ENV=production
```

**Importante — Redis URL aqui é a INTERNA**:
- Hostname `redis-ecrou-cxymvh` (o "Internal Host" que aparece no painel do Redis)
- Sem TLS, porta `6379`
- A senha continua sendo a mesma do painel do Redis

### 4. Networking — colocar na mesma rede do Redis

No Dockploy, services dentro do mesmo **Project** compartilham a rede Docker automaticamente. Verifica que o backend e o Redis estão no mesmo project. Se estiverem em projects diferentes, ou move um deles, ou em **Advanced → Network** adiciona o nome da rede do Redis.

### 5. Domain / Port

Você tem duas escolhas:

**Opção A (com Traefik, o default do Dockploy):**
- **Domains** → adiciona um domínio tipo `queue-api.seu-dominio.com`
- **Container Port**: `3000`
- O Traefik resolve HTTPS automaticamente via Let's Encrypt

**Opção B (porta exposta direta):**
- **Advanced → Ports** → `3000 (container) → 3001 (host)`
- Vai responder em `http://SEU-IP:3001` sem HTTPS

### 6. Healthcheck

O Dockerfile já tem `HEALTHCHECK` apontando pro `/health`. O Dockploy mostra o status na lista de aplicações.

### 7. Deploy

Clica **Deploy**. Acompanha o build em **Logs → Build**.

Quando subir, testa:
```bash
curl https://queue-api.seu-dominio.com/health
# { "ok": true, "redisLatencyMs": 1, "uptimeSec": 5 }
```

## Caminho B — Deploy via Docker Compose (sem Git)

Se preferir não usar Git, cria um **Compose** no Dockploy e cola:

```yaml
services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    environment:
      REDIS_URL: "redis://default:SUA_SENHA@redis-ecrou-cxymvh:6379"
      QUEUE_CAPACITY: "3"
      SESSION_TTL_MS: "60000"
      ADMIT_INTERVAL_MS: "1000"
      PORT: "3000"
      NODE_ENV: "production"
    ports:
      - "3001:3000"
    restart: unless-stopped
```

Mas pra build via Compose o Dockploy precisa do código no servidor, então acaba caindo na necessidade de Git ou upload manual. Por isso o caminho A é mais limpo.

## Apontando seu frontend local pro backend deployado

Edita o `frontend/vite.config.ts` trocando os targets do proxy:

```ts
proxy: {
  '/api': { target: 'https://queue-api.seu-dominio.com', changeOrigin: true, rewrite: p => p.replace(/^\/api/, '') },
  '/socket.io': { target: 'https://queue-api.seu-dominio.com', ws: true, changeOrigin: true },
  '/admin/queues': { target: 'https://queue-api.seu-dominio.com', changeOrigin: true },
}
```

Aí `npm run dev` no frontend continua local, mas todos os requests vão pro Dockploy. CORS já tá liberado (`app.enableCors({ origin: true })`).

## Verificando que tudo se conectou

1. **Dozzle**: abre o Dozzle, escolhe o container do backend na sidebar. Devia ver:
   ```
   [redis] connected
   bull-board → http://localhost:3000/admin/queues
   [queue] admit job every 1000ms
   ```
2. **Healthcheck**: `curl https://queue-api.../health` retorna `ok: true`
3. **Fluxo end-to-end**: abre o frontend local, entra na fila, e:
   - Dozzle mostra `JOIN`, `ADMIT`, `HOLD`, `SOLD`
   - Bull Board (`https://queue-api.../admin/queues`) mostra jobs rodando
   - Timeline na dashboard preenche em tempo real

## Escalando (se quiser brincar de horizontal)

⚠️ Atenção: a admissão da fila roda como `repeat: { every: 1000 }`. Se você subir **2 réplicas** do backend, cada uma tenta agendar o mesmo job. BullMQ resolve isso (job é deduplicado pelo jobId interno do scheduler), mas **dois workers** vão concorrer pra processar o tick.

Isso é **bom** pra throughput, mas você precisa garantir que:
- O script Lua `admitFromQueue` é atômico (já é — `redis-cli` executa Lua sob lock global)
- O `SET NX EX` do lock de assento é atômico (já é — primitiva nativa do Redis)

Então pode escalar à vontade. Pra testar local: `docker compose up --scale backend=3`.

## Troubleshooting

**Backend não conecta no Redis (`ECONNREFUSED` ou `getaddrinfo ENOTFOUND`):**
- Confirma que o hostname é o "Internal Host" exato do painel (com o sufixo aleatório tipo `-cxymvh`)
- Confirma que os dois estão no mesmo project no Dockploy
- Teste de dentro do container: no Dockploy, abre o terminal do backend e roda `wget -qO- redis-ecrou-cxymvh:6379` — se conecta (vai dar erro estranho do Redis, mas conecta), DNS tá ok

**`Connection is closed` no startup:**
- ioredis tentando conectar antes do Redis responder. Já tá com `maxRetriesPerRequest: null` — vai eventualmente conectar. Se persistir, aumenta `start-period` no healthcheck.

**Frontend não fala com o backend deployado:**
- Verifica que `app.enableCors` tá liberando seu domínio (já está com `origin: true`)
- Se trocou pra HTTPS no backend e o frontend tá em HTTP, vai dar erro de mixed content. Use HTTPS nos dois ou HTTP nos dois durante dev
