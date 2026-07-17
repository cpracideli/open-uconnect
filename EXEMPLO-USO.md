# Exemplo de Uso - Script Uconnect API

## Passo a Passo para Executar

### 1. Preparação do Ambiente
```bash
# Navegue até a pasta do projeto
cd c:\temp\Projects\uconnect

# Verifique se tem Node.js instalado
node --version
# Deve mostrar versão 12 ou superior
```

### 2. Configure suas Credenciais
Edite o arquivo `uconnect-api.js` e atualize as linhas 18-19:
```javascript
const CONFIG = {
    // Credenciais de login (substitua com suas credenciais)
    email: 'SEU-EMAIL@gmail.com',      // ← Substitua aqui
    password: 'SUA-SENHA',             // ← Substitua aqui
    // ... resto do código
};
```

### 3. Execute o Script Completo
```bash
# Execute o script principal
node uconnect-api.js

# Ou use o comando npm
npm start
```

### 4. Execute o Script de Teste Simples
```bash
# Para um teste rápido (com dados simulados)
node test-simple.js

# Ou use o comando npm
npm test
```

## Comandos Disponíveis

### Via npm scripts:
```bash
# Autenticação apenas
npm run auth

# Buscar lista de veículos
npm run vehicles

# Buscar status de um veículo específico
npm run status
```

### Via linha de comando direta:
```bash
# Script completo
node uconnect-api.js

# Teste simplificado
node test-simple.js

# Apenas login
node -e "const { login } = require('./uconnect-api.js'); login().then(console.log).catch(console.error);"
```

## Exemplo de Saída do Script Completo

```
🚀 Iniciando script Uconnect API...

🔐 Iniciando autenticação...
✅ Request para https://login-us.jeep.com/accounts.login - Status: 200
✅ Login realizado com sucesso!
   User ID: a8ccd0e04c1d4e4ea9b91779f18d0f17
   Token: Obtido

==================================================

🚗 Buscando lista de veículos...
✅ Request para https://channels.sdpr-02.fcagcv.com/v4/accounts/a8ccd0e04c1d4e4ea9b91779f18d0f17/vehicles?stage=ALL&sdp=ALL - Status: 200
✅ Encontrados 1 veículo(s):
   1. Jeep COMPASS (2022)
      VIN: 98867516TNKL53814
      Cor: CINZA GRANITE CRYSTAL BICOLOR
      Combustível: G

==================================================

📊 Buscando status do veículo 98867516TNKL53814...
✅ Request para https://channels.sdpr-02.fcagcv.com/v2/accounts/a8ccd0e04c1d4e4ea9b91779f18d0f17/vehicles/98867516TNKL53814/status - Status: 200
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

## Arquivos Gerados

Após a execução, serão criados:

1. **Arquivos de log**: `uconnect-log-*.json` (se configurado)
2. **Arquivos de dados**: `uconnect-data-*.json` com todas as informações
3. **Saída no console**: Informações detalhadas do processo

## Estrutura do Arquivo de Dados Gerado

```json
{
  "timestamp": "2026-06-23T12:00:00.000Z",
  "session": {
    "userId": "a8ccd0e04c1d4e4ea9b91779f18d0f17",
    "hasLoginToken": true
  },
  "vehicles": [
    {
      "color": "CINZA GRANITE CRYSTAL BICOLOR",
      "year": 2022,
      "vin": "98867516TNKL53814",
      "make": "Jeep",
      "modelDescription": "COMPASS",
      "fuelType": "G"
    }
  ],
  "summary": {
    "totalVehicles": 1,
    "vehicleModels": ["Jeep COMPASS"]
  }
}
```

## Solução de Problemas

### Erro: "Invalid credentials"
- Verifique se o email e senha estão corretos no arquivo `uconnect-api.js`
- Confirme que as credenciais são válidas para o site myuconnect.jeep.com

### Erro: "Network error" ou "ECONNREFUSED"
- Verifique sua conexão com a internet
- Tente acessar https://myuconnect.jeep.com no navegador para testar

### Erro: "Unexpected token" ou syntax error
- Certifique-se de que está usando Node.js versão 12 ou superior
- Verifique se não há erros de digitação no código

### Script funciona mas não mostra dados reais
- O script usa credenciais AWS de exemplo
- Em produção, seria necessário implementar a obtenção dinâmica dessas credenciais

## Personalização

### Para modificar o script:

1. **Alterar nível de log**: Edite `uconnect-api.js`, linha ~30
2. **Mudar timeout**: Ajuste as configurações de timeout nas funções `makeRequest`
3. **Adicionar mais veículos**: O script já suporta múltiplos veículos automaticamente
4. **Exportar para outros formatos**: Modifique a função `saveDataToFile()`

## Próximos Passos Recomendados

1. **Implementar renovação automática de tokens AWS**
2. **Criar interface web simples**
3. **Adicionar agendamento automático (cron job)**
4. **Configurar alertas por email/telegram**
5. **Integrar com Home Assistant ou outras plataformas IoT**

## Avisos Importantes

⚠️ **Este script é para fins educacionais e de demonstração**

- As credenciais AWS são exemplos estáticos e expiram rapidamente
- Em produção, é necessário implementar o fluxo completo de autenticação
- Use por sua conta e risco
- Mantenha suas credenciais em segurança
- Não compartilhe tokens ou dados sensíveis