/**
 * Uconnect Jeep API — Fluxo completo de autenticação
 *
 * Fluxo:
 *   1. POST accounts.login              → login_token
 *   2. POST accounts.getJWT             → id_token (JWT Gigya)
 *   3. POST /cognito/identity/token     → IdentityId + OpenID Token (FCA)
 *   4. POST AWS GetCredentialsForIdentity → AccessKeyId + SecretKey + SessionToken
 *   5. GET  /v4/.../vehicles            → lista de veículos  (assinado AWS SigV4)
 *   6. GET  /v2/.../status              → status do veículo  (assinado AWS SigV4)
 */

'use strict';

const https  = require('https');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const { URL } = require('url');

// ─── Carregar .env (sem dependências externas) ────────────────────────────────
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

// ─── Configurações ────────────────────────────────────────────────────────────
const CONFIG = {
    email:    process.env.UCONNECT_EMAIL    || '',
    password: process.env.UCONNECT_PASSWORD || '',

    gigyaApiKey:    process.env.GIGYA_API_KEY    || '',
    vehiclesApiKey: process.env.VEHICLES_API_KEY || '',

    awsRegion: 'us-east-1',

    urls: {
        gigyaLogin:   'https://login-us.jeep.com/accounts.login',
        gigyaJWT:     'https://login-us.jeep.com/accounts.getJWT',
        cognitoToken: 'https://authz.sdpr-02.fcagcv.com/v2/cognito/identity/token',
        awsCognito:   'https://cognito-identity.us-east-1.amazonaws.com/',
        vehiclesBase: 'https://channels.sdpr-02.fcagcv.com',
    }
};

// ─── Estado da sessão ─────────────────────────────────────────────────────────
const session = {
    userId:       null,
    loginToken:   null,
    gigyaJWT:     null,
    identityId:   null,
    cognitoToken: null,
    gmid:         null,
    ucid:         null,
    aws: {
        accessKeyId:     null,
        secretAccessKey: null,
        sessionToken:    null,
        expiration:      null,
        region:          CONFIG.awsRegion,
    }
};

// ─── Cookie jar simples ───────────────────────────────────────────────────────
const cookieJar = {};

function parseCookies(setCookieHeaders, hostname) {
    if (!setCookieHeaders) return;
    const arr = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    arr.forEach(h => {
        const [nameVal] = h.split(';');
        const [name, ...rest] = nameVal.split('=');
        if (!cookieJar[hostname]) cookieJar[hostname] = {};
        cookieJar[hostname][name.trim()] = rest.join('=').trim();
    });
}

function getCookieHeader(hostname) {
    const all = {};
    // Inclui cookies de domínios pais
    Object.keys(cookieJar).forEach(domain => {
        if (hostname.endsWith(domain) || hostname === domain) {
            Object.assign(all, cookieJar[domain]);
        }
    });
    return Object.entries(all).map(([k, v]) => `${k}=${v}`).join('; ');
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────
function httpRequest(urlStr, options = {}, body = null) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(urlStr);

        const cookieHeader = getCookieHeader(parsed.hostname);
        if (cookieHeader) {
            options.headers = options.headers || {};
            options.headers['cookie'] = cookieHeader;
        }

        const reqOptions = {
            hostname: parsed.hostname,
            port:     parsed.port || 443,
            path:     parsed.pathname + parsed.search,
            method:   options.method || 'GET',
            headers:  options.headers || {}
        };

        if (body) {
            reqOptions.headers['content-length'] = Buffer.byteLength(body);
        }

        const req = https.request(reqOptions, (res) => {
            // Captura cookies da resposta
            parseCookies(res.headers['set-cookie'], parsed.hostname);

            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString();
                let data;
                try { data = JSON.parse(raw); } catch { data = raw; }

                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    const err     = new Error(`HTTP ${res.statusCode}: ${urlStr}`);
                    err.status    = res.statusCode;
                    err.body      = data;
                    reject(err);
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

// ─── AWS Signature V4 ─────────────────────────────────────────────────────────
function sha256Hex(data)     { return crypto.createHash('sha256').update(data).digest('hex'); }
function hmac(key, data)     { return crypto.createHmac('sha256', key).update(data).digest(); }
function hmacHex(key, data)  { return crypto.createHmac('sha256', key).update(data).digest('hex'); }

/**
 * Adiciona os headers de assinatura AWS SigV4 e retorna o objeto de headers completo.
 */
function signRequest({ method, url, headers = {}, body = '' }) {
    const aws    = session.aws;
    const parsed = new URL(url);
    const now    = new Date();

    const datestamp = now.toISOString().slice(0, 10).replace(/-/g, '');           // YYYYMMDD
    const amzdate   = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''); // YYYYMMDDTHHMMSSz

    const allHeaders = {
        ...headers,
        host:                   parsed.hostname,
        'x-amz-date':           amzdate,
        'x-amz-security-token': aws.sessionToken,
    };

    const sortedKeys      = Object.keys(allHeaders).map(k => k.toLowerCase()).sort();
    const canonicalHeaders = sortedKeys.map(k => `${k}:${allHeaders[k].trim()}`).join('\n') + '\n';
    const signedHeadersStr = sortedKeys.join(';');
    const payloadHash      = sha256Hex(body);

    const canonicalUri   = encodeURI(parsed.pathname) || '/';
    const canonicalQuery = parsed.search
        ? parsed.search.slice(1).split('&').map(p => p.split('=').map(encodeURIComponent).join('=')).sort().join('&')
        : '';

    const canonicalRequest = [
        method.toUpperCase(),
        canonicalUri,
        canonicalQuery,
        canonicalHeaders,
        signedHeadersStr,
        payloadHash,
    ].join('\n');

    const service         = 'execute-api';
    const credentialScope = `${datestamp}/${aws.region}/${service}/aws4_request`;

    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzdate,
        credentialScope,
        sha256Hex(canonicalRequest),
    ].join('\n');

    const kDate    = hmac(`AWS4${aws.secretAccessKey}`, datestamp);
    const kRegion  = hmac(kDate,    aws.region);
    const kService = hmac(kRegion,  service);
    const kSigning = hmac(kService, 'aws4_request');
    const signature = hmacHex(kSigning, stringToSign);

    const authorization = `AWS4-HMAC-SHA256 Credential=${aws.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`;

    return { ...allHeaders, authorization };
}

// ─── Utilitário ───────────────────────────────────────────────────────────────
function randomId() {
    return crypto.randomBytes(8).toString('hex');
}

// ─── Passo 0: Bootstrap — obtém gmid e ucid do SDK Gigya ─────────────────────
async function step0_bootstrap() {
    console.log('\n[0/6] 🌐 Obtendo gmid/ucid do SDK Gigya...');

    // socialize.getIDs retorna gmid e ucid necessários para o login
    const url = `https://login-us.jeep.com/socialize.getIDs?apikey=${CONFIG.gigyaApiKey}&sdk=js_latest&sdkBuild=2135&format=json`;

    const data = await httpRequest(url, {
        method: 'GET',
        headers: {
            'accept':          '*/*',
            'accept-language': 'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7',
            'referer':         'https://myuconnect.jeep.com/',
            'user-agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.0.0',
        }
    });

    if (data.errorCode !== 0) {
        throw new Error(`Bootstrap falhou: [${data.errorCode}] ${data.errorMessage}`);
    }

    session.gmid = data.gmid;
    session.ucid = data.ucid;

    console.log(`    ✅ gmid: ${session.gmid.substring(0, 40)}...`);
    console.log(`    ✅ ucid: ${session.ucid}`);
}

// ─── Passo 1: Login Gigya ─────────────────────────────────────────────────────
async function step1_login() {
    console.log('\n[1/6] 🔐 Login Gigya...');

    // Tenta via SDK (browser-like) — se falhar, tenta via REST API
    const body = [
        `loginID=${encodeURIComponent(CONFIG.email)}`,
        `password=${encodeURIComponent(CONFIG.password)}`,
        `sessionExpiration=86400`,
        `targetEnv=jssdk`,
        `include=profile%2Cdata`,
        `includeUserInfo=true`,
        `lang=en`,
        `APIKey=${CONFIG.gigyaApiKey}`,
        `sdk=js_latest`,
        `authMode=cookie`,
        `pageURL=${encodeURIComponent('https://myuconnect.jeep.com/br/pt/login')}`,
        `sdkBuild=2135`,
        `format=json`,
        `gmid=${encodeURIComponent(session.gmid)}`,
        `ucid=${encodeURIComponent(session.ucid)}`,
    ].join('&');

    const data = await httpRequest(CONFIG.urls.gigyaLogin, {
        method: 'POST',
        headers: {
            'accept':           '*/*',
            'accept-language':  'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7',
            'content-type':     'application/x-www-form-urlencoded',
            'origin':           'https://myuconnect.jeep.com',
            'referer':          'https://myuconnect.jeep.com/',
            'user-agent':       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.0.0',
            'sec-fetch-dest':   'empty',
            'sec-fetch-mode':   'cors',
            'sec-fetch-site':   'same-site',
        }
    }, body);

    if (data.errorCode !== 0) {
        throw new Error(`Login falhou: [${data.errorCode}] ${data.errorMessage} — ${data.errorDetails}`);
    }

    session.userId     = data.UID;
    session.loginToken = data.sessionInfo.login_token;

    console.log(`    ✅ userId:      ${session.userId}`);
    console.log(`    ✅ loginToken:  obtido`);
}

// ─── Passo 2: Obter JWT Gigya ─────────────────────────────────────────────────
async function step2_getJWT() {
    console.log('\n[2/6] 🪙  Obtendo JWT Gigya...');

    const body = [
        `fields=profile.firstName%2Cprofile.lastName%2Cprofile.email%2Ccountry%2Clocale%2Cdata.disclaimerCodeGSDP%2Cdata.disclaimerID`,
        `APIKey=${CONFIG.gigyaApiKey}`,
        `sdk=js_latest`,
        `login_token=${encodeURIComponent(session.loginToken)}`,
        `authMode=cookie`,
        `pageURL=${encodeURIComponent('https://myuconnect.jeep.com/br/pt/login')}`,
        `sdkBuild=2135`,
        `format=json`,
        `gmid=${encodeURIComponent(session.gmid)}`,
        `ucid=${encodeURIComponent(session.ucid)}`,
    ].join('&');

    const data = await httpRequest(CONFIG.urls.gigyaJWT, {
        method: 'POST',
        headers: {
            'accept':           '*/*',
            'accept-language':  'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7',
            'content-type':     'application/x-www-form-urlencoded',
            'origin':           'https://myuconnect.jeep.com',
            'referer':          'https://myuconnect.jeep.com/',
            'sec-fetch-dest':   'empty',
            'sec-fetch-mode':   'cors',
            'sec-fetch-site':   'same-site',
        }
    }, body);

    if (data.errorCode !== 0) {
        throw new Error(`getJWT falhou: [${data.errorCode}] ${data.errorMessage}`);
    }

    session.gigyaJWT = data.id_token;
    console.log(`    ✅ JWT: ${session.gigyaJWT.substring(0, 50)}...`);
}

// ─── Passo 3: Trocar JWT por token Cognito (FCA) ──────────────────────────────
async function step3_cognitoToken() {
    console.log('\n[3/6] 🔄 Trocando JWT por token Cognito (FCA)...');

    const body = JSON.stringify({ gigya_token: session.gigyaJWT });

    const data = await httpRequest(CONFIG.urls.cognitoToken, {
        method: 'POST',
        headers: {
            'accept':              '*/*',
            'accept-language':     'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7',
            'clientrequestid':     randomId(),
            'content-type':        'application/json',
            'locale':              'br_pt',
            'origin':              'https://myuconnect.jeep.com',
            'referer':             'https://myuconnect.jeep.com/',
            'x-api-key':           CONFIG.vehiclesApiKey,
            'x-clientapp-version': '1.0',
            'x-originator-type':   'web',
            'sec-fetch-dest':      'empty',
            'sec-fetch-mode':      'cors',
            'sec-fetch-site':      'cross-site',
        }
    }, body);

    session.identityId   = data.IdentityId;
    session.cognitoToken = data.Token;

    console.log(`    ✅ IdentityId:     ${session.identityId}`);
    console.log(`    ✅ Cognito Token:  obtido`);
}

// ─── Passo 4: Obter credenciais AWS temporárias ───────────────────────────────
async function step4_awsCredentials() {
    console.log('\n[4/6] 🔑 Obtendo credenciais AWS temporárias (GetCredentialsForIdentity)...');

    const body = JSON.stringify({
        IdentityId: session.identityId,
        Logins: {
            'cognito-identity.amazonaws.com': session.cognitoToken
        }
    });

    // GetCredentialsForIdentity — chamada JSON pura, sem SigV4
    const data = await httpRequest(CONFIG.urls.awsCognito, {
        method: 'POST',
        headers: {
            'content-type': 'application/x-amz-json-1.1',
            'x-amz-target': 'AWSCognitoIdentityService.GetCredentialsForIdentity',
        }
    }, body);

    const creds = data.Credentials;
    session.aws.accessKeyId     = creds.AccessKeyId;
    session.aws.secretAccessKey = creds.SecretKey;
    session.aws.sessionToken    = creds.SessionToken;
    session.aws.expiration      = creds.Expiration;

    const exp = new Date(creds.Expiration * 1000).toISOString();
    console.log(`    ✅ AccessKeyId: ${session.aws.accessKeyId}`);
    console.log(`    ✅ Válido até:  ${exp}`);
}

// ─── Passo 5: Buscar veículos (Request 4) ────────────────────────────────────
async function step5_getVehicles() {
    console.log('\n[5/6] 🚗 Buscando veículos...');

    const url = `${CONFIG.urls.vehiclesBase}/v4/accounts/${session.userId}/vehicles?stage=ALL&sdp=ALL`;

    const headers = signRequest({
        method: 'GET',
        url,
        headers: {
            accept:                'application/json, text/plain, */*',
            'accept-language':     'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7',
            clientrequestid:       randomId(),
            'content-type':        'application/json',
            locale:                'br_pt',
            'x-api-key':           CONFIG.vehiclesApiKey,
            'x-clientapp-name':    'CWP',
            'x-clientapp-version': '1.0',
            'x-originator-type':   'web',
        },
        body: '',
    });

    const data = await httpRequest(url, { method: 'GET', headers });

    console.log(`    ✅ ${data.vehicles.length} veículo(s) encontrado(s):`);
    data.vehicles.forEach((v, i) => {
        console.log(`       ${i + 1}. ${v.make} ${v.modelDescription} ${v.year}`);
        console.log(`          VIN: ${v.vin}`);
        console.log(`          Cor: ${v.color} | Combustível: ${v.fuelType}`);
    });

    return data.vehicles;
}

// ─── Passo 6: Status do veículo (Request 5) ──────────────────────────────────
async function step6_getVehicleStatus(vin) {
    console.log(`\n[6/6] 📊 Buscando status do veículo ${vin}...`);

    const url = `${CONFIG.urls.vehiclesBase}/v2/accounts/${session.userId}/vehicles/${vin}/status`;

    const headers = signRequest({
        method: 'GET',
        url,
        headers: {
            accept:                'application/json, text/plain, */*',
            'accept-language':     'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7',
            clientrequestid:       randomId(),
            'content-type':        'application/json',
            locale:                'br_pt',
            'x-api-key':           CONFIG.vehiclesApiKey,
            'x-clientapp-name':    'CWP',
            'x-clientapp-version': '1.0',
            'x-originator-type':   'web',
        },
        body: '',
    });

    const data = await httpRequest(url, { method: 'GET', headers });
    const info = data.vehicleInfo;

    console.log('\n    ════════════ STATUS DO VEÍCULO ════════════');
    console.log(`    Odômetro:           ${info.odometer?.odometer?.value} ${info.odometer?.odometer?.unit}`);
    console.log(`    Combustível:        ${info.fuel?.fuelAmountLevel}%  (${info.fuel?.fuelAmount?.value} L)`);
    console.log(`    Autonomia restante: ${info.fuel?.distanceToEmpty?.value} ${info.fuel?.distanceToEmpty?.unit}`);
    console.log(`    Bateria:            ${info.batteryInfo?.batteryVoltage?.value} ${info.batteryInfo?.batteryVoltage?.unit}`);

    if (info.tyrePressure?.length) {
        console.log('\n    Pressão dos pneus:');
        info.tyrePressure.forEach(t => {
            const warn = t.warning ? ' ⚠️  ALERTA' : ' ✅';
            console.log(`       ${t.type}: ${parseFloat(t.pressure.value).toFixed(1)} ${t.pressure.unit}  [${t.status}]${warn}`);
        });
    }

    if (info.tripsInfo?.trips?.length) {
        console.log('\n    Viagens:');
        info.tripsInfo.trips.forEach(t => {
            console.log(`       ${t.name}: ${t.totalDistance.value} ${t.totalDistance.unit}`);
        });
    }

    return data;
}

// ─── Passo 7: Histórico de manutenção ─────────────────────────────────────────────
async function step7_getMaintenanceHistory(vin) {
    console.log(`\n[7/7] 🔧 Buscando histórico de manutenção...`);

    const url = `${CONFIG.urls.vehiclesBase}/v1/accounts/${session.userId}/vehicles/${vin}/maintenance/history/`;

    const headers = signRequest({
        method: 'GET',
        url,
        headers: {
            accept:                'application/json, text/plain, */*',
            'accept-language':     'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7',
            clientrequestid:       randomId(),
            'content-type':        'application/json',
            locale:                'br_pt',
            'x-api-key':           CONFIG.vehiclesApiKey,
            'x-clientapp-name':    'CWP',
            'x-clientapp-version': '1.0',
            'x-originator-type':   'web',
        },
        body: '',
    });

    const data = await httpRequest(url, { method: 'GET', headers });

    const count = data.serviceHistory?.length || 0;
    console.log(`    ✅ ${count} registro(s) no histórico`);
    console.log(`    ✅ ${data.nonfcaServiceCategoryList?.length || 0} categorias disponíveis`);

    return data;
}

// ─── PIN Auth (necessário para comandos remotos) ──────────────────────────────
const AUTH_BASE = 'https://mfa.fcl-02.fcagcv.com';
const AUTH_KEY  = process.env.AUTH_API_KEY || '';

/**
 * Autentica o PIN do usuário e retorna um pinAuth token de curta duração.
 * Requer que a sessão AWS já esteja ativa (steps 0-4 concluídos).
 *
 * @param {string} pin  — PIN numérico do usuário (ex: "1234")
 * @returns {Promise<string>}  pinAuth token
 */
async function pinAuthenticate(pin) {
    const url  = `${AUTH_BASE}/v1/accounts/${session.userId}/ignite/pin/authenticate`;
    const body = JSON.stringify({
        pin: Buffer.from(pin).toString('base64'),
    });

    const headers = signRequest({
        method: 'POST',
        url,
        headers: {
            accept:                'application/json, text/plain, */*',
            'accept-language':     'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7',
            clientrequestid:       randomId(),
            'content-type':        'application/json',
            locale:                'br_pt',
            'x-api-key':           AUTH_KEY,
            'x-clientapp-name':    'CWP',
            'x-clientapp-version': '1.0',
            'x-originator-type':   'web',
        },
        body,
    });

    const data = await httpRequest(url, { method: 'POST', headers }, body);

    if (!data.token) {
        throw new Error(`PIN auth falhou — resposta: ${JSON.stringify(data)}`);
    }

    return data.token;
}

/**
 * Envia um comando remoto ao veículo.
 *
 * Comandos comuns:
 *   REON  / REOFF          — ligar / desligar o motor          (v1, url="remote")
 *   RDU   / RDL            — destrancar / trancar portas       (v1, url="remote")
 *   HBLF                   — buzina + luzes                    (v1, url="remote")
 *   ROCOMFORTON/OFF        — conforto                          (v2, url="remote")
 *
 * @param {string} vin
 * @param {string} pin        — PIN numérico
 * @param {string} commandName — ex: "REON", "REOFF", "RDU", "RDL", "HBLF"
 * @param {object} [opts]
 * @param {string} [opts.apiVersion="v1"]
 * @param {string} [opts.url="remote"]
 * @returns {Promise<string>}  correlationId para polling
 */
async function sendCommand(vin, pin, commandName, opts = {}) {
    const { apiVersion = 'v1', url: cmdUrl = 'remote' } = opts;

    console.log(`\n[CMD] 🔑 Autenticando PIN para comando "${commandName}"...`);
    const pinAuth = await pinAuthenticate(pin);
    console.log(`    ✅ PIN auth ok`);

    const url  = `${CONFIG.urls.vehiclesBase}/${apiVersion}/accounts/${session.userId}/vehicles/${vin}/${cmdUrl}`;
    const body = JSON.stringify({ command: commandName, pinAuth });

    console.log(`[CMD] 📡 Enviando comando "${commandName}" para VIN ${vin}...`);
    const headers = signRequest({
        method: 'POST',
        url,
        headers: {
            accept:                'application/json, text/plain, */*',
            'accept-language':     'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7',
            clientrequestid:       randomId(),
            'content-type':        'application/json',
            locale:                'br_pt',
            'x-api-key':           CONFIG.vehiclesApiKey,
            'x-clientapp-name':    'CWP',
            'x-clientapp-version': '1.0',
            'x-originator-type':   'web',
        },
        body,
    });

    const data = await httpRequest(url, { method: 'POST', headers }, body);

    if (!data.correlationId) {
        throw new Error(`Comando falhou — resposta: ${JSON.stringify(data)}`);
    }

    console.log(`    ✅ correlationId: ${data.correlationId}`);
    return data.correlationId;
}

/**
 * Consulta o status de um comando remoto já enviado.
 *
 * @param {string} vin
 * @param {string} correlationId
 * @returns {Promise<object>}  ex: { status: "SUCCESS" | "PENDING" | "FAILED", ... }
 */
async function getCommandStatus(vin, correlationId) {
    const url = `${CONFIG.urls.vehiclesBase}/v1/accounts/${session.userId}/vehicles/${vin}/remote/${correlationId}/status/`;

    const headers = signRequest({
        method: 'GET',
        url,
        headers: {
            accept:                'application/json, text/plain, */*',
            'accept-language':     'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7',
            clientrequestid:       randomId(),
            'content-type':        'application/json',
            locale:                'br_pt',
            'x-api-key':           CONFIG.vehiclesApiKey,
            'x-clientapp-name':    'CWP',
            'x-clientapp-version': '1.0',
            'x-originator-type':   'web',
        },
        body: '',
    });

    return await httpRequest(url, { method: 'GET', headers });
}

/**
 * Busca o status de um comando via endpoint de notificações do veículo.
 * Fallback usado quando o endpoint /remote/{id}/status/ retorna 404 (comum na região BR).
 *
 * @param {string} vin
 * @param {string} correlationId
 * @returns {Promise<string|null>}  'success', 'failure', ou null (ainda pendente)
 */
async function getNotificationsStatus(vin, correlationId) {
    const url = `${CONFIG.urls.vehiclesBase}/v1/accounts/${session.userId}/vehicles/${vin}/notifications?limit=30`;

    const headers = signRequest({
        method: 'GET',
        url,
        headers: {
            accept:                'application/json, text/plain, */*',
            'accept-language':     'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7',
            clientrequestid:       randomId(),
            'content-type':        'application/json',
            locale:                'br_pt',
            'x-api-key':           CONFIG.vehiclesApiKey,
            'x-clientapp-name':    'CWP',
            'x-clientapp-version': '1.0',
            'x-originator-type':   'web',
        },
        body: '',
    });

    const data = await httpRequest(url, { method: 'GET', headers });

    const items = data?.notifications?.items || [];
    const match = items.find(x => x.correlationId === correlationId);
    if (!match) return null;

    // A API retorna o status em data.status OU data.response (ambos observados)
    const d      = match?.notification?.data || {};
    const status = (d.status || d.response || '').toLowerCase();
    const SUCCESS = ['success', 'succeeded', 'completed', 'complete'];
    const FAILURE = ['failure', 'failed', 'error', 'rejected'];
    if (SUCCESS.includes(status)) return 'success';
    if (FAILURE.includes(status)) return 'failure';
    return null;
}

// ─── Novos Endpoints (baseados na lib Python) ─────────────────────────────────

/**
 * Última localização GPS conhecida do veículo.
 * GET /v1/accounts/{uid}/vehicles/{vin}/location/lastknown
 */
async function getVehicleLocation(vin) {
    const url = `${CONFIG.urls.vehiclesBase}/v1/accounts/${session.userId}/vehicles/${vin}/location/lastknown`;
    const headers = signRequest({
        method: 'GET', url,
        headers: {
            accept: 'application/json, text/plain, */*',
            clientrequestid: randomId(),
            'content-type': 'application/json',
            locale: 'br_pt',
            'x-api-key': CONFIG.vehiclesApiKey,
            'x-clientapp-name': 'CWP',
            'x-clientapp-version': '1.0',
            'x-originator-type': 'web',
        },
        body: '',
    });
    return httpRequest(url, { method: 'GET', headers });
}

/**
 * Status detalhado: portas, janelas, ignição, porta-malas.
 * GET /v1/accounts/{uid}/vehicles/{vin}/remote/status
 */
async function getVehicleRemoteStatus(vin) {
    const url = `${CONFIG.urls.vehiclesBase}/v1/accounts/${session.userId}/vehicles/${vin}/remote/status`;
    const headers = signRequest({
        method: 'GET', url,
        headers: {
            accept: 'application/json, text/plain, */*',
            clientrequestid: randomId(),
            'content-type': 'application/json',
            locale: 'br_pt',
            'x-api-key': CONFIG.vehiclesApiKey,
            'x-clientapp-name': 'CWP',
            'x-clientapp-version': '1.0',
            'x-originator-type': 'web',
        },
        body: '',
    });
    return httpRequest(url, { method: 'GET', headers });
}

/**
 * Relatório de saúde do veículo (VHR).
 * GET /v1/accounts/{uid}/vehicles/{vin}/vhr/
 */
async function getVehicleHealthReport(vin) {
    const url = `${CONFIG.urls.vehiclesBase}/v1/accounts/${session.userId}/vehicles/${vin}/vhr/`;
    const headers = signRequest({
        method: 'GET', url,
        headers: {
            accept: 'application/json, text/plain, */*',
            clientrequestid: randomId(),
            'content-type': 'application/json',
            locale: 'br_pt',
            'x-api-key': CONFIG.vehiclesApiKey,
            'x-clientapp-name': 'CWP',
            'x-clientapp-version': '1.0',
            'x-originator-type': 'web',
        },
        body: '',
    });
    return httpRequest(url, { method: 'GET', headers });
}

/**
 * Dados da última viagem (eco-coaching).
 * POST /v2/accounts/{uid}/vehicles/{vin}/ecocoaching/get-last-trip/
 */
async function getLastTrip(vin) {
    const url = `${CONFIG.urls.vehiclesBase}/v2/accounts/${session.userId}/vehicles/${vin}/ecocoaching/get-last-trip/`;
    const headers = signRequest({
        method: 'POST', url,
        headers: {
            accept: 'application/json, text/plain, */*',
            clientrequestid: randomId(),
            'content-type': 'application/json',
            locale: 'br_pt',
            'x-api-key': CONFIG.vehiclesApiKey,
            'x-clientapp-name': 'CWP',
            'x-clientapp-version': '1.0',
            'x-originator-type': 'web',
        },
        body: '{}',
    });
    return httpRequest(url, { method: 'POST', headers, body: '{}' });
}

/**
 * Lista de viagens (eco-coaching).
 * POST /v2/accounts/{uid}/vehicles/{vin}/ecocoaching/get-trips/
 */
async function getTrips(vin) {
    const url = `${CONFIG.urls.vehiclesBase}/v2/accounts/${session.userId}/vehicles/${vin}/ecocoaching/get-trips/`;
    const headers = signRequest({
        method: 'POST', url,
        headers: {
            accept: 'application/json, text/plain, */*',
            clientrequestid: randomId(),
            'content-type': 'application/json',
            locale: 'br_pt',
            'x-api-key': CONFIG.vehiclesApiKey,
            'x-clientapp-name': 'CWP',
            'x-clientapp-version': '1.0',
            'x-originator-type': 'web',
        },
        body: '{}',
    });
    return httpRequest(url, { method: 'POST', headers, body: '{}' });
}

/**
 * Status do sistema anti-furto (SVLA).
 * GET /v1/accounts/{uid}/vehicles/{vin}/svla/status/
 */
async function getStolenVehicleStatus(vin) {
    const url = `${CONFIG.urls.vehiclesBase}/v1/accounts/${session.userId}/vehicles/${vin}/svla/status/`;
    const headers = signRequest({
        method: 'GET', url,
        headers: {
            accept: 'application/json, text/plain, */*',
            clientrequestid: randomId(),
            'content-type': 'application/json',
            locale: 'br_pt',
            'x-api-key': CONFIG.vehiclesApiKey,
            'x-clientapp-name': 'CWP',
            'x-clientapp-version': '1.0',
            'x-originator-type': 'web',
        },
        body: '',
    });
    return httpRequest(url, { method: 'GET', headers });
}

/**
 * Status da assinatura do veículo.
 * GET /v1/accounts/{uid}/vehicles/{vin}/subscription/
 */
async function getVehicleSubscription(vin) {
    const url = `${CONFIG.urls.vehiclesBase}/v1/accounts/${session.userId}/vehicles/${vin}/subscription/`;
    const headers = signRequest({
        method: 'GET', url,
        headers: {
            accept: 'application/json, text/plain, */*',
            clientrequestid: randomId(),
            'content-type': 'application/json',
            locale: 'br_pt',
            'x-api-key': CONFIG.vehiclesApiKey,
            'x-clientapp-name': 'CWP',
            'x-clientapp-version': '1.0',
            'x-originator-type': 'web',
        },
        body: '',
    });
    return httpRequest(url, { method: 'GET', headers });
}

/**
 * Envia comando de atualização de localização GPS (VF).
 * Retorna correlationId — use getCommandStatus() para aguardar,
 * depois chame getVehicleLocation() para obter a posição atualizada.
 */
async function sendLocationUpdate(vin, pin) {
    return sendCommand(vin, pin, 'VF', { apiVersion: 'v1', url: 'location' });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
/**
 * @param {object}  [opts]
 * @param {boolean} [opts.silent=false]   — suprime logs de banner quando chamado como módulo
 * @param {boolean} [opts.saveFile=true]  — salva o resultado em disco como JSON
 * @returns {Promise<{timestamp,userId,vehicles,status}>}
 */
async function main(opts = {}) {
    const { silent = false, saveFile = true } = opts;

    if (!silent) {
        console.log('╔═══════════════════════════════════════════╗');
        console.log('║        Uconnect Jeep API Script           ║');
        console.log('╚═══════════════════════════════════════════╝\n');
    }

    await step0_bootstrap();
    await step1_login();
    await step2_getJWT();
    await step3_cognitoToken();
    await step4_awsCredentials();

    const vehicles     = await step5_getVehicles();
    const statusMap     = {};
    const maintenanceMap = {};

    for (const v of vehicles) {
        statusMap[v.vin]      = await step6_getVehicleStatus(v.vin);
        maintenanceMap[v.vin] = await step7_getMaintenanceHistory(v.vin);
    }

    const output = {
        timestamp: new Date().toISOString(),
        userId:    session.userId,
        vehicles,
        status:      statusMap,
        maintenance: maintenanceMap,
    };

    if (saveFile) {
        const filename = `uconnect-result-${Date.now()}.json`;
        fs.writeFileSync(filename, JSON.stringify(output, null, 2));
        if (!silent) {
            console.log('\n╔═══════════════════════════════════════════╗');
            console.log('║   ✅  Concluído com sucesso!              ║');
            console.log(`║   💾  Dados salvos em: ${filename.padEnd(19)}║`);
            console.log('╚═══════════════════════════════════════════╝\n');
        }
    }

    return output;
}

if (require.main === module) {
    main().catch(err => {
        console.error('\n❌ Erro:', err.message);
        if (err.body) console.error('   Detalhes:', JSON.stringify(err.body, null, 2));
        process.exit(1);
    });
}

module.exports = {
    main, session, CONFIG,
    // Autenticação e comandos
    pinAuthenticate, sendCommand, getCommandStatus, getNotificationsStatus,
    // Dados do veículo
    getVehicleLocation, getVehicleRemoteStatus, getVehicleHealthReport,
    getLastTrip, getTrips, getStolenVehicleStatus, getVehicleSubscription,
    sendLocationUpdate,
};
