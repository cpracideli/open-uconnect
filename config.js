/**
 * Configurações para o script Uconnect API
 * 
 * As credenciais são lidas do arquivo .env na raiz do projeto.
 * Copie .env.example para .env e preencha com seus dados.
 */

const fs   = require('fs');
const path = require('path');

// Carregar .env manualmente (sem dependências externas)
(function loadEnv() {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx === -1) continue;
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
    }
})();

module.exports = {
    // Credenciais lidas do .env
    credentials: {
        email:    process.env.UCONNECT_EMAIL    || '',
        password: process.env.UCONNECT_PASSWORD || ''
    },
    
    // API Keys lidas do .env
    apiKeys: {
        login:    process.env.GIGYA_API_KEY    || '',
        vehicles: process.env.VEHICLES_API_KEY || ''
    },
    
    // URLs da API
    urls: {
        login: 'https://login-us.jeep.com/accounts.login',
        vehiclesBase: 'https://channels.sdpr-02.fcagcv.com'
    },
    
    // Headers comuns
    headers: {
        common: {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7,es;q=0.6',
            'sec-ch-ua': '"Microsoft Edge";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'priority': 'u=1, i'
        },
        
        // Headers específicos para login
        login: {
            'content-type': 'application/x-www-form-urlencoded',
            'sec-fetch-site': 'same-site'
        },
        
        // Headers específicos para API de veículos
        vehicles: {
            'content-type': 'application/json',
            'locale': 'br_pt',
            'region': 'us-east-1',
            'service': 'execute-api',
            'x-clientapp-name': 'CWP',
            'x-clientapp-version': '1.0',
            'x-originator-type': 'web',
            'sec-fetch-site': 'cross-site'
        }
    },
    
    // Configurações de exemplo para AWS credentials
    // NOTA: Em produção, estas seriam obtidas dinamicamente após login
    awsExample: {
        // Exemplo do Request 4
        request4: {
            authorization: 'AWS4-HMAC-SHA256 Credential=ASIAZ5FM7PRM72DDCHYN/20260624/us-east-1/execute-api/aws4_request',
            xAmzDate: '20260624T005329Z',
            clientRequestId: 'w3swq55hulbsqs8v',
            signature: '14e60c58d07a59fa2d97357173dbf2d9799c4d0ea6903f9fa47b9947654aa9f3'
        },
        
        // Exemplo do Request 5
        request5: {
            authorization: 'AWS4-HMAC-SHA256 Credential=ASIAZ5FM7PRM47ZPGKTI/20260624/us-east-1/execute-api/aws4_request',
            xAmzDate: '20260624T011213Z',
            clientRequestId: '4wt5cvp4qi66mr86',
            signature: 'ae1e11179363208b1f3f187ca0c6c4d854f740d469785138848393dc749fcee3'
        }
    },
    
    // Configurações de logging
    logging: {
        enabled: true,
        level: 'info', // 'debug', 'info', 'warn', 'error'
        saveToFile: true,
        filePrefix: 'uconnect-log-'
    },
    
    // Configurações de execução
    execution: {
        timeout: 30000, // 30 segundos
        retryAttempts: 3,
        retryDelay: 1000 // 1 segundo
    }
};