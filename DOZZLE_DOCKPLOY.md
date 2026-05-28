# Subir Dozzle no Dockploy

Dozzle é um container único que mostra logs ao vivo de **todos** os containers Docker da máquina, com busca e filtros, via web UI. Não precisa instalar agente em cada serviço — ele lê o socket do Docker.

## Passo a passo

### 1. Criar o serviço no Dockploy

No painel do Dockploy:

1. **Create Application** → escolhe **Docker**
2. **Image**: `amir20/dozzle:latest`

### 2. Configurar o volume do Docker socket

Em **Advanced → Volumes** (ou **Mounts**), adiciona:

```
Source:      /var/run/docker.sock
Destination: /var/run/docker.sock
Type:        Bind
Read-only:   ✓ (importante)
```

Isso dá ao Dozzle acesso de leitura à API do Docker pra listar containers e ler logs. Marcar read-only evita que ele possa controlar o Docker.

### 3. Expor a porta

Em **Advanced → Ports**:

```
Container Port: 8080
Published Port: 8080  (ou qualquer porta livre, ex: 18080)
```

Se o seu Dockploy usa Traefik (que é o default), prefira criar um domínio em **Domains** apontando pro container, em vez de expor porta direto. Algo como `dozzle.seu-dominio.com`.

### 4. Adicionar autenticação (importante)

Dozzle aberto pra internet = qualquer um vê seus logs. Em **Environment**:

```env
DOZZLE_AUTH_PROVIDER=simple
```

Aí monta um arquivo `users.yml` via volume:

```
Source:      /var/dockploy/dozzle/users.yml
Destination: /data/users.yml
Type:        Bind
```

Conteúdo do `users.yml` (crie no host antes):

```yaml
users:
  victor:
    name: Victor
    email: dev@e-crowngroup.com
    password: $2a$11$... # bcrypt — gere com: htpasswd -bnBC 11 "" SUA_SENHA | tr -d ':\n'
```

Pra gerar o hash bcrypt rapidamente sem ter `htpasswd` instalado:
```bash
docker run --rm httpd:alpine htpasswd -bnBC 11 "" SUA_SENHA | tr -d ':\n'
```

### 5. Deploy e acesso

Clica **Deploy**. Abre `http://seu-servidor:8080` (ou o domínio que você configurou) e loga.

## Filtros úteis pro projeto

Uma vez dentro do Dozzle, você pode:

- **Filtrar por container**: clica no nome do backend na sidebar
- **Buscar texto**: barra de busca acima dos logs (case-sensitive). Tente:
  - `HOLD` → todos os locks de assento
  - `ADMIT` → toda admissão da fila
  - `SOLD` → toda venda confirmada
  - `conflict` → todos os locks que falharam
- **Multi-container**: segura `Ctrl/Cmd` na sidebar pra ver dois containers lado a lado (ex: backend + redis)
- **Acompanhar**: o `Follow` no topo direito faz auto-scroll com novos logs

## Alternativa pra desenvolvimento local

Se você só quer ver os logs do backend rodando no seu laptop (não no Dockploy ainda), pode rodar Dozzle local:

```bash
docker run --name dozzle -d --volume=/var/run/docker.sock:/var/run/docker.sock:ro \
  -p 8888:8080 amir20/dozzle:latest
```

Aí abre `http://localhost:8888`. Mas isso só vê containers que estão no Docker — não vê o `npm run start:dev` que tá rodando direto no host. Pra ver esse último, vale a pena combinar com a [Timeline do Redis Streams](http://localhost:5173/#admin) que já tá funcionando no dashboard.

## Onde o Dozzle complementa a Timeline do Redis

| Pergunta | Onde olhar |
|---|---|
| Que evento de domínio aconteceu (lock, admit, sold)? | Timeline no dashboard (Redis Streams) |
| Que erro/exceção o backend lançou? | Dozzle (stdout do container) |
| Qual a sequência exata de pacotes Redis? | `redis-cli MONITOR` |
| Quantos jobs BullMQ falharam? | Bull Board (`/admin/queues`) |
