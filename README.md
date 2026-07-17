# Script Uconnect API Jeep

Este script permite autenticar e acessar dados da API Uconnect da Jeep.

## Funcionalidades

1. **Autenticação**: Login no sistema Uconnect Jeep
2. **Lista de Veículos**: Busca todos os veículos associados à conta
3. **Status do Veículo**: Obtém informações detalhadas do status de um veículo específico

## Estrutura dos Requests

### Request 1 - Autenticação
- **URL**: `https://login-us.jeep.com/accounts.login`
- **Método**: POST
- **Body**: Credenciais de login (email, senha, API key, etc.)

### Request 4 - Lista de Veículos
- **URL**: `https://channels.sdpr-02.fcagcv.com/v4/accounts/{userId}/vehicles`
- **Método**: GET
- **Headers**: Inclui autorização AWS4-HMAC-SHA256

### Request 5 - Status do Veículo
- **URL**: `https://channels.sdpr-02.fcagcv.com/v2/accounts/{userId}/vehicles/{vin}/status`
- **Método**: GET
- **Headers**: Inclui autorização AWS4-HMAC-SHA256

## Como Usar

### 1. Instalação
```bash
# Certifique-se de ter Node.js instalado
node --version

# Nenhuma dependência adicional é necessária
```

### 2. Configuração
Edite o arquivo `uconnect-api.js` e atualize as credenciais:

```javascript
const CONFIG = {
    email: 'seu-email@gmail.com',
    password: 'sua-senha',
    // ... outras configurações
};
```

### 3. Execução
```bash
node uconnect-api.js
```

### 4. Saída Esperada
O script irá:
1. Fazer login e obter token de sessão
2. Buscar lista de veículos
3. Buscar status do primeiro veículo
4. Salvar dados em arquivo JSON

## Arquivos Gerados

- `uconnect-data-{timestamp}.json`: Dados completos em formato JSON
- Logs no console com informações detalhadas

## Estrutura do Projeto

```
uconnect/
├── uconnect-api.js      # Script principal
├── request1.md          # Exemplos de requests (dados de referência)
├── README.md           # Esta documentação
└── uconnect-data-*.json # Arquivos de saída (gerados automaticamente)
```

## Notas Importantes

1. **Segurança**: As credenciais AWS no script são exemplos estáticos. Em um ambiente real, essas credenciais seriam obtidas dinamicamente após a autenticação.

2. **Tokens AWS**: Os tokens AWS têm validade limitada (normalmente 1 hora). Em produção, seria necessário implementar renovação automática.

3. **API Key**: A API key `OgNqp2eAv84oZvMrXPIzP8mR8a6d9bVm1aaH9LqU` parece ser pública para o aplicativo web.

4. **Limitações**: Este script é um exemplo baseado nos requests capturados. A implementação completa exigiria:
   - Tratamento dinâmico de tokens AWS
   - Renovação automática de sessão
   - Tratamento mais robusto de erros

## Exemplo de Saída

```
🚀 Iniciando script Uconnect API...

🔐 Iniciando autenticação...
✅ Request para https://login-us.jeep.com/accounts.login - Status: 200
✅ Login realizado com sucesso!
   User ID: a8ccd0e04c1d4e4ea9b91779f18d0f17
   Token: Obtido

==================================================

🚗 Buscando lista de veículos...
✅ Request para https://channels.sdpr-02.fcagcv.com/v4/accounts/... - Status: 200
✅ Encontrados 1 veículo(s):
   1. Jeep COMPASS (2022)
      VIN: 98867516TNKL53814
      Cor: CINZA GRANITE CRYSTAL BICOLOR
      Combustível: G

==================================================

📊 Buscando status do veículo 98867516TNKL53814...
✅ Request para https://channels.sdpr-02.fcagcv.com/v2/accounts/... - Status: 200
✅ Status do veículo obtido com sucesso!

📈 RESUMO DO STATUS DO VEÍCULO:
   Odômetro: 57416 km
   Combustível: 93%
   Distância até vazio: 435 km
   Nível de óleo: N/A

   Pressão dos Pneus:
      FL: 230.57 kPa - ✅ OK
      FR: 233.32 kPa - ✅ OK
      RL: 189.40 kPa - ⚠️ ALERTA
      RR: 211.36 kPa - ✅ OK

   Bateria: 14.5 volts

   Viagens:
      TripA: 10395 km
      TripB: 93 km

==================================================
✅ Script executado com sucesso!
💾 Dados salvos em: uconnect-data-1732399200000.json
```

## Próximos Passos

Para usar em produção, considere:

1. Implementar armazenamento seguro de credenciais
2. Adicionar suporte a múltiplos veículos
3. Implementar agendamento de execuções automáticas
4. Criar interface web ou aplicativo móvel
5. Adicionar alertas (ex: pressão baixa dos pneus, combustível baixo)