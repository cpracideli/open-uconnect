# Uconnect API — Documentação

Base URL local: `http://localhost:3000`  
Base URL Railway: `https://SEU-APP.up.railway.app`

## Autenticação

Todas as rotas `/api/*` exigem **Basic Auth**:

```
Authorization: Basic <base64(API_USER:API_PASSWORD)>
```

> Configure `API_USER` e `API_PASSWORD` no `.env`.  
> Para gerar o valor Base64: `btoa("jeep:sua_senha")` → ex: `amVlcDpzdWFfc2VuaGE=`

---

## Endpoints

### `GET /api/health-check`
Verifica se o servidor está online. **Sem autenticação.**

```
GET /api/health-check
→ { ok: true, uptime: 123.4, env: "production" }
```

---

### `GET /api/data`
Status completo do veículo (odômetro, combustível, pneus, bateria).  
Usa cache de 5 min.

```
GET /api/data
Authorization: Basic amVlcDpzdWFfc2VuaGE=
→ { vehicles: [...], status: { ... }, maintenance: { ... } }
```

---

### `GET /api/refresh`
Força limpeza do cache.

```
GET /api/refresh
Authorization: Basic amVlcDpzdWFfc2VuaGE=
→ { ok: true, message: "Cache limpo..." }
```

---

### `GET /api/location?vin=VIN`
Última localização GPS conhecida.

```
GET /api/location?vin=98867516TNKL53814
Authorization: Basic amVlcDpzdWFfc2VuaGE=
→ { latitude: -23.5, longitude: -46.6, altitude: 760, ... }
```

---

### `GET /api/doors?vin=VIN`
Status de portas, janelas, ignição e porta-malas.

```
GET /api/doors?vin=98867516TNKL53814
Authorization: Basic amVlcDpzdWFfc2VuaGE=
→ { doors: {...}, windows: {...}, ignitionStatus: "OFF", ... }
```

---

### `GET /api/lasttrip?vin=VIN`
Dados da última viagem (distância, duração, eco score).

```
GET /api/lasttrip?vin=98867516TNKL53814
Authorization: Basic amVlcDpzdWFfc2VuaGE=
→ { distance: 12.3, duration: 900, ecoScore: 78, ... }
```

---

### `POST /api/command`
Envia um comando remoto ao veículo.

**Body JSON:**
```json
{
  "vin":        "98867516TNKL53814",
  "pin":        "1234",
  "command":    "REON",
  "apiVersion": "v1",
  "cmdUrl":     "remote"
}
```

| command        | ação                     | apiVersion |
|----------------|--------------------------|-----------|
| `REON`         | Ligar motor              | v1        |
| `REOFF`        | Desligar motor           | v1        |
| `RDU`          | Destrancar               | v1        |
| `RDL`          | Trancar                  | v1        |
| `HBLF`         | Buzina / faróis          | v1        |
| `ROLIGHTS`     | Só acender faróis        | v1        |
| `ROTRUNKUNLOCK`| Abrir porta-malas        | v2        |
| `ROTRUNKLOCK`  | Fechar porta-malas       | v2        |
| `ROPRECOND`    | Pré-climatizar           | v1        |
| `ROPRECOND_OFF`| Parar climatização       | v1        |

**Resposta:**
```json
{ "ok": true, "correlationId": "abc-123", "command": "REON", "vin": "..." }
```

---

### `GET /api/command/status?vin=VIN&correlationId=ID`
Consulta status de um comando enviado.

```
→ { responseStatus: "pending" | "SUCCESS" | "FAILED" }
```

---

### `POST /api/location/update`
Força o carro a atualizar a posição GPS.

**Body JSON:**
```json
{ "vin": "98867516TNKL53814", "pin": "1234" }
```

---

## iOS Shortcuts — Exemplos prontos

### Variáveis globais sugeridas (salvar nos Shortcuts)
| Variável       | Valor                                      |
|----------------|--------------------------------------------|
| `API_BASE`     | `https://SEU-APP.up.railway.app`           |
| `API_AUTH`     | `Basic amVlcDpzdWFfc2VuaGE=` *(ver abaixo)* |
| `VIN`          | `98867516TNKL53814`                        |
| `PIN`          | `1234`                                     |

> **Gerar API_AUTH:** No terminal: `node -e "console.log('Basic ' + Buffer.from('jeep:SUA_SENHA').toString('base64'))"`

---

### Shortcut: 🔒 Trancar Carro

```
Ação: "Obter conteúdo da URL"
  URL:     https://SEU-APP.up.railway.app/api/command
  Método:  POST
  Cabeçalhos:
    Authorization: Basic amVlcDpzdWFfc2VuaGE=
    Content-Type:  application/json
  Corpo (JSON):
    {
      "vin":     "98867516TNKL53814",
      "pin":     "1234",
      "command": "RDL"
    }

Ação: "Obter [ok] do dicionário"
Ação: "Se [ok] for verdadeiro → Mostrar notificação: ✅ Carro trancado"
```

---

### Shortcut: 🔓 Destrancar Carro

Igual ao acima, troque `"command": "RDL"` por `"command": "RDU"`.

---

### Shortcut: 🚗 Ligar Motor

```json
{
  "vin":     "98867516TNKL53814",
  "pin":     "1234",
  "command": "REON"
}
```

---

### Shortcut: 📊 Status do Carro

```
Ação: "Obter conteúdo da URL"
  URL:    https://SEU-APP.up.railway.app/api/data
  Método: GET
  Cabeçalhos:
    Authorization: Basic amVlcDpzdWFfc2VuaGE=

Ação: "Obter [status] do dicionário"
Ação: "Obter [fuelLevel] de [status]"
Ação: "Mostrar alerta: Combustível: [fuelLevel]%"
```

---

### Shortcut: 📍 Localização do Carro

```
Ação: "Obter conteúdo da URL"
  URL:    https://SEU-APP.up.railway.app/api/location?vin=98867516TNKL53814
  Método: GET
  Cabeçalhos:
    Authorization: Basic amVlcDpzdWFfc2VuaGE=

Ação: "Obter [latitude] do dicionário"
Ação: "Obter [longitude] do dicionário"
Ação: "Abrir URL: https://maps.apple.com/?ll=[latitude],[longitude]"
```

---

## Deploy no Railway

### 1. Criar conta e instalar CLI
```bash
# No terminal:
npm install -g @railway/cli
railway login
```

### 2. Subir o projeto
```bash
cd C:\temp\Projects\uconnect
railway init        # cria novo projeto
railway up          # faz deploy
```

### 3. Configurar variáveis de ambiente no Railway
No painel Railway → seu projeto → **Variables**, adicione:

| Variável          | Valor                        |
|-------------------|------------------------------|
| `NODE_ENV`        | `production`                 |
| `UCONNECT_EMAIL`  | seu email                    |
| `UCONNECT_PASSWORD` | sua senha                  |
| `GIGYA_API_KEY`   | chave Gigya                  |
| `VEHICLES_API_KEY`| chave vehicles               |
| `AUTH_API_KEY`    | chave auth MFA               |
| `API_USER`        | usuário da API (ex: `jeep`)  |
| `API_PASSWORD`    | senha forte da API           |

> ⚠️ **Nunca suba o `.env` para o git.** O `.gitignore` já está configurado para ignorá-lo.

### 4. Pegar a URL pública
Após o deploy: Railway → seu projeto → **Settings** → **Domains** → copie a URL gerada.

### 5. Testar
```bash
curl -u jeep:SUA_SENHA https://SEU-APP.up.railway.app/api/health-check
```
