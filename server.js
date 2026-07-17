/**
 * server.js — Servidor local do Uconnect Dashboard
 *
 * Uso: node server.js
 *
 * - Serve dashboard.html em http://localhost:3000
 * - Busca dados frescos da API a cada requisição em /api/data
 * - Abre o browser automaticamente
 */

'use strict';

const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { execSync } = require('child_process');

// ─── Carregar .env antes de tudo ──────────────────────────────────────────────
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

const PORT = parseInt(process.env.PORT || '3000', 10);
const IS_PROD = process.env.NODE_ENV === 'production' ||
                process.env.RAILWAY_ENVIRONMENT === 'production' ||
                !!process.env.RAILWAY_PROJECT_ID;

// ─── Basic Auth ──────────────────────────────────────────────────────────────
// Rotas da API exigem: Authorization: Basic base64(API_USER:API_PASSWORD)
// O dashboard HTML (/) fica público para uso via browser local.
const API_USER     = process.env.API_USER     || '';
const API_PASSWORD = process.env.API_PASSWORD || '';

function checkAuth(req, res) {
    // Se não configurou usuário/senha, auth desabilitada (modo local sem .env completo)
    if (!API_USER || !API_PASSWORD) return true;

    const authHeader = req.headers['authorization'] || '';
    if (!authHeader.startsWith('Basic ')) {
        res.writeHead(401, {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Basic realm="Uconnect API"',
        });
        res.end(JSON.stringify({ error: 'Autenticação necessária' }));
        return false;
    }

    const b64     = authHeader.slice(6);
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    const colon   = decoded.indexOf(':');
    const user    = decoded.slice(0, colon);
    const pass    = decoded.slice(colon + 1);

    // Comparação de tempo constante (evita timing attacks)
    const userOk = user.length === API_USER.length &&
        crypto.timingSafeEqual(Buffer.from(user), Buffer.from(API_USER));
    const passOk = pass.length === API_PASSWORD.length &&
        crypto.timingSafeEqual(Buffer.from(pass), Buffer.from(API_PASSWORD));

    if (!userOk || !passOk) {
        res.writeHead(401, {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Basic realm="Uconnect API"',
        });
        res.end(JSON.stringify({ error: 'Usuário ou senha inválidos' }));
        return false;
    }
    return true;
}

// ─── Reutiliza toda a lógica do uconnect-api.js ───────────────────────────────
const api = require('./uconnect-api.js');

// ─── Cache em memória (evita chamar a API em cada F5) ────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
let cache = { data: null, ts: 0 };

async function fetchFreshData() {
    const age = Date.now() - cache.ts;
    if (cache.data && age < CACHE_TTL_MS) {
        console.log(`[cache] Dados com ${Math.round(age / 1000)}s — reutilizando (TTL: ${CACHE_TTL_MS / 1000}s)`);
        return cache.data;
    }

    console.log('\n[api] Buscando dados frescos da Uconnect API...');

    // Chama o pipeline completo (importado do uconnect-api.js)
    const result = await api.main({ silent: false });

    cache = { data: result, ts: Date.now() };
    return result;
}

// ─── Helper: lê body de uma request POST ─────────────────────────────────────
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString()));
        req.on('error', reject);
    });
}

// ─── Servidor HTTP ────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // CORS — em produção só permite a própria origin; localmente libera tudo
    const allowedOrigin = IS_PROD
        ? (process.env.ALLOWED_ORIGIN || '*')
        : '*';
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // ── Rotas públicas (sem auth) ──────────────────────────────────────────────
    const publicRoutes = ['/', '/index.html', '/api/health-check'];
    const isPublic = publicRoutes.includes(url.pathname) || url.pathname.startsWith('/public/');

    // Aplica Basic Auth em todas as rotas /api/* exceto as públicas
    if (url.pathname.startsWith('/api') && !isPublic) {
        if (!checkAuth(req, res)) return;
    }

    // ── GET /api/health-check — Railway healthcheck (sem auth) ────────────────
    if (url.pathname === '/api/health-check') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, uptime: process.uptime(), env: IS_PROD ? 'production' : 'development' }));
        return;
    }

    // ── GET /api/data ──────────────────────────────────────────────────────────
    if (url.pathname === '/api/data') {
        try {
            const data = await fetchFreshData();
            const body = JSON.stringify(data);
            res.writeHead(200, {
                'Content-Type':  'application/json; charset=utf-8',
                'Cache-Control': 'no-store',
            });
            res.end(body);
        } catch (err) {
            console.error('[api] Erro:', err.message);
            const body = JSON.stringify({ error: err.message, detail: err.body || null });
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(body);
        }
        return;
    }

    // ── GET /api/refresh — força atualização ignorando cache ──────────────────
    if (url.pathname === '/api/refresh') {
        cache = { data: null, ts: 0 };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Cache limpo. Próxima requisição buscará dados frescos.' }));
        return;
    }

    // ── POST /api/command — envia um comando remoto ao veículo ───────────────
    // Body JSON: { vin, pin, command, apiVersion?, cmdUrl? }
    // Comandos: REON, REOFF, RDU, RDL, HBLF
    if (url.pathname === '/api/command' && req.method === 'POST') {
        try {
            const body = await readBody(req);
            const { vin, pin, command, apiVersion, cmdUrl } = JSON.parse(body);

            if (!vin || !pin || !command) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Campos obrigatórios: vin, pin, command' }));
                return;
            }

            // Garante que a sessão está ativa
            if (!api.session.aws.accessKeyId) {
                console.log('[cmd] Sessão inativa — autenticando...');
                await fetchFreshData();
            }

            console.log(`[cmd] Enviando comando ${command} para ${vin}...`);

            let correlationId;
            try {
                correlationId = await api.sendCommand(vin, pin, command, {
                    apiVersion: apiVersion || 'v1',
                    url: cmdUrl || 'remote',
                });
            } catch (err) {
                // 403 no PIN auth pode significar sessão expirada — tenta reautenticar e reenviar
                if (err.status === 403) {
                    console.log('[cmd] 403 no PIN auth — reautenticando sessão e reenviando...');
                    await fetchFreshData();
                    correlationId = await api.sendCommand(vin, pin, command, {
                        apiVersion: apiVersion || 'v1',
                        url: cmdUrl || 'remote',
                    });
                } else {
                    throw err;
                }
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, correlationId, command, vin }));
        } catch (err) {
            console.error('[cmd] Erro final:', err.message);
            // 403 após retry = PIN realmente errado
            const isPinError = err.status === 403 ||
                (err.message || '').toLowerCase().includes('pin') ||
                (err.message || '').toLowerCase().includes('unauthorized');
            const httpStatus = isPinError ? 403 : 500;
            const userMsg    = isPinError
                ? 'PIN incorreto. Verifique o PIN de 4 dígitos do app Uconnect.'
                : err.message;
            res.writeHead(httpStatus, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: userMsg, detail: err.body || null }));
        }
        return;
    }

    // ── GET /api/command/status?vin=...&correlationId=... ─────────────────────
    if (url.pathname === '/api/command/status') {
        try {
            const vin           = url.searchParams.get('vin');
            const correlationId = url.searchParams.get('correlationId');

            if (!vin || !correlationId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Parâmetros obrigatórios: vin, correlationId' }));
                return;
            }

            if (!api.session.aws.accessKeyId) {
                res.writeHead(409, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Sessão inativa — envie o comando primeiro' }));
                return;
            }

            try {
                const data = await api.getCommandStatus(vin, correlationId);
                console.log(`[cmd-status] ${correlationId} → ${JSON.stringify(data.status || data.responseStatus)}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(data));
            } catch (err) {
                // 404 é comum na região BR — retorna pending para o cliente continuar polling
                if (err.status === 404) {
                    console.log(`[cmd-status] ${correlationId} → 404 (normal BR) — retornando pending`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ responseStatus: 'pending', _source: 'status-404' }));
                } else {
                    throw err;
                }
            }
        } catch (err) {
            console.error('[cmd-status] Erro:', err.message);
            res.writeHead(err.status || 500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message, detail: err.body || null }));
        }
        return;
    }

    // ── GET /api/command/notifications?vin=...&correlationId=... ─────────────
    // Fallback: busca status via lista de notificações do veículo
    if (url.pathname === '/api/command/notifications') {
        try {
            const vin           = url.searchParams.get('vin');
            const correlationId = url.searchParams.get('correlationId');

            if (!vin || !correlationId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Parâmetros obrigatórios: vin, correlationId' }));
                return;
            }

            if (!api.session.aws.accessKeyId) {
                res.writeHead(409, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Sessão inativa' }));
                return;
            }

            const notifStatus = await api.getNotificationsStatus(vin, correlationId);
            console.log(`[cmd-notif] ${correlationId} → ${notifStatus || 'not found yet'}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ notifStatus }));
        } catch (err) {
            console.error('[cmd-notif] Erro:', err.message);
            res.writeHead(err.status || 500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // ── GET /api/location?vin=... — última localização GPS ───────────────────
    if (url.pathname === '/api/location') {
        try {
            const vin = url.searchParams.get('vin');
            if (!vin) { res.writeHead(400); res.end(JSON.stringify({ error: 'vin obrigatório' })); return; }
            if (!api.session.aws.accessKeyId) { await fetchFreshData(); }
            const data = await api.getVehicleLocation(vin);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } catch (err) {
            res.writeHead(err.status || 500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // ── GET /api/doors?vin=... — status portas/janelas/ignição ───────────────
    if (url.pathname === '/api/doors') {
        try {
            const vin = url.searchParams.get('vin');
            if (!vin) { res.writeHead(400); res.end(JSON.stringify({ error: 'vin obrigatório' })); return; }
            if (!api.session.aws.accessKeyId) { await fetchFreshData(); }
            const data = await api.getVehicleRemoteStatus(vin);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } catch (err) {
            res.writeHead(err.status || 500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // ── GET /api/distance-to-service?vin=... — km restantes para revisão ────
    if (url.pathname === '/api/distance-to-service') {
        try {
            const vin = url.searchParams.get('vin');
            if (!vin) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'vin obrigatório' }));
                return;
            }
            const data = await fetchFreshData();
            const vehicleInfo = data?.status?.[vin]?.vehicleInfo;
            if (!vehicleInfo) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `VIN ${vin} não encontrado` }));
                return;
            }
            const dts = vehicleInfo.distanceToService?.distanceToService;
            const value = dts?.value != null ? parseFloat(dts.value) : null;
            const unit  = dts?.unit || 'km';
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ vin, value, unit }));
        } catch (err) {
            res.writeHead(err.status || 500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // ── GET /api/health?vin=... — relatório de saúde (VHR) ───────────────────
    if (url.pathname === '/api/health') {
        try {
            const vin = url.searchParams.get('vin');
            if (!vin) { res.writeHead(400); res.end(JSON.stringify({ error: 'vin obrigatório' })); return; }
            if (!api.session.aws.accessKeyId) { await fetchFreshData(); }
            const data = await api.getVehicleHealthReport(vin);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } catch (err) {
            res.writeHead(err.status || 500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // ── GET /api/lasttrip?vin=... — dados da última viagem ───────────────────
    if (url.pathname === '/api/lasttrip') {
        try {
            const vin = url.searchParams.get('vin');
            if (!vin) { res.writeHead(400); res.end(JSON.stringify({ error: 'vin obrigatório' })); return; }
            if (!api.session.aws.accessKeyId) { await fetchFreshData(); }
            const data = await api.getLastTrip(vin);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } catch (err) {
            res.writeHead(err.status || 500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // ── GET /api/trips?vin=... — lista de viagens ─────────────────────────────
    if (url.pathname === '/api/trips') {
        try {
            const vin = url.searchParams.get('vin');
            if (!vin) { res.writeHead(400); res.end(JSON.stringify({ error: 'vin obrigatório' })); return; }
            if (!api.session.aws.accessKeyId) { await fetchFreshData(); }
            const data = await api.getTrips(vin);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } catch (err) {
            res.writeHead(err.status || 500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // ── POST /api/location/update — força atualização GPS (cmd VF) ───────────
    if (url.pathname === '/api/location/update' && req.method === 'POST') {
        try {
            const body = await readBody(req);
            const { vin, pin } = JSON.parse(body);
            if (!vin || !pin) { res.writeHead(400); res.end(JSON.stringify({ error: 'vin e pin obrigatórios' })); return; }
            if (!api.session.aws.accessKeyId) { await fetchFreshData(); }
            const correlationId = await api.sendLocationUpdate(vin, pin);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, correlationId }));
        } catch (err) {
            const isPinError = err.status === 403;
            if (isPinError) {
                await fetchFreshData();
                try {
                    const body2 = '{}'; // já leu o body
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'PIN incorreto ou sessão expirada' }));
                } catch {}
            } else {
                res.writeHead(err.status || 500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        }
        return;
    }

    // ── Servir dashboard.html em / ─────────────────────────────────────────────
    if (url.pathname === '/' || url.pathname === '/index.html') {
        const htmlPath = path.join(__dirname, 'dashboard.html');
        if (!fs.existsSync(htmlPath)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('dashboard.html não encontrado');
            return;
        }
        let html = fs.readFileSync(htmlPath, 'utf8');

        // Injeta meta tag com Basic Auth para que o dashboard saiba se autenticar
        // Só injeta se auth estiver configurado — caso contrário não expõe nada
        if (API_USER && API_PASSWORD) {
            const b64 = Buffer.from(`${API_USER}:${API_PASSWORD}`).toString('base64');
            const metaTag = `<meta name="api-auth" content="Basic ${b64}">`;
            html = html.replace('<head>', `<head>\n    ${metaTag}`);
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
    }

    // ── Servir arquivos estáticos de /public/ ───────────────────────────────
    if (url.pathname.startsWith('/public/')) {
        const filePath = path.join(__dirname, url.pathname);
        if (!fs.existsSync(filePath)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Não encontrado');
            return;
        }
        const ext   = path.extname(filePath).toLowerCase();
        const mimes = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
                        '.gif':'image/gif', '.svg':'image/svg+xml', '.webp':'image/webp' };
        res.writeHead(200, { 'Content-Type': mimes[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
        return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`Não encontrado: ${url.pathname}`);
});

// ─── Inicialização ────────────────────────────────────────────────────────────
const HOST = IS_PROD ? '0.0.0.0' : '127.0.0.1';
server.listen(PORT, HOST, () => {
    const dashUrl = IS_PROD ? `https://seu-app.up.railway.app` : `http://localhost:${PORT}`;
    console.log('╔══════════════════════════════════════════════╗');
    console.log(`║  Uconnect — ${IS_PROD ? 'PRODUÇÃO (Railway)    ' : 'Servidor Local        '}        ║`);
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  Porta:    ${String(PORT).padEnd(34)}║`);
    console.log(`║  API:      ${('/api/data').padEnd(34)}║`);
    console.log(`║  Auth:     ${(API_USER ? 'Basic Auth ativo' : 'DESABILITADO (sem API_USER)').padEnd(34)}║`);
    console.log(`║  Cache:    ${String(CACHE_TTL_MS / 60000 + ' min TTL').padEnd(34)}║`);
    console.log('╠══════════════════════════════════════════════╣');
    console.log('║  Para parar o servidor: Ctrl+C               ║');
    console.log('╚══════════════════════════════════════════════╝\n');

    // Abre o browser automaticamente apenas em modo local
    if (!IS_PROD) {
        try {
            const localUrl = `http://localhost:${PORT}`;
            const cmd = process.platform === 'win32'  ? `start ${localUrl}`
                      : process.platform === 'darwin' ? `open ${localUrl}`
                      : `xdg-open ${localUrl}`;
            execSync(cmd, { stdio: 'ignore' });
            console.log(`🌐 Browser aberto em ${localUrl}\n`);
        } catch {
            console.log(`👆 Abra manualmente: http://localhost:${PORT}\n`);
        }
    }
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ Porta ${PORT} já em uso.`);
        console.error(`   Feche o servidor anterior ou use: node server.js`);
    } else {
        console.error('Erro no servidor:', err);
    }
    process.exit(1);
});
