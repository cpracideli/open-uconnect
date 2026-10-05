/**
 * auth.js — Login por PIN com sessão em cookie e bloqueio progressivo por IP
 *
 * - PIN de 4 dígitos definido em APP_PIN no .env (padrão: 1234)
 * - A cada 4 tentativas inválidas o IP é bloqueado; o tempo de bloqueio
 *   aumenta a cada novo bloqueio (1 min → 5 min → 15 min → 1 h → 6 h → 24 h)
 * - Um login correto zera o histórico do IP
 * - Sessões ficam em memória (reiniciar o servidor pede o PIN de novo)
 */

'use strict';

const crypto = require('crypto');

const MAX_ATTEMPTS   = 4;
const LOCK_STEPS_MS  = [1, 5, 15, 60, 360, 1440].map(min => min * 60 * 1000);
const LEVEL_RESET_MS = 24 * 60 * 60 * 1000;      // sem erros por 24h → volta ao 1º nível
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const COOKIE_NAME    = 'uc_session';

// ─── PIN ──────────────────────────────────────────────────────────────────────
const APP_PIN = (process.env.APP_PIN || '').trim() || '1234';
if (!/^\d{4}$/.test(APP_PIN)) {
    console.error('❌ APP_PIN no .env deve ter exatamente 4 dígitos (ou ficar em branco para usar 1234).');
    process.exit(1);
}
const PIN_IS_DEFAULT = APP_PIN === '1234';

function pinMatches(pin) {
    // Compara hashes de tamanho fixo em tempo constante
    const a = crypto.createHash('sha256').update(String(pin)).digest();
    const b = crypto.createHash('sha256').update(APP_PIN).digest();
    return crypto.timingSafeEqual(a, b);
}

// ─── IP do cliente ────────────────────────────────────────────────────────────
// Atrás de proxy (Coolify/Traefik, Railway) o IP real vem no X-Forwarded-For.
// Usa a ÚLTIMA entrada, que é a adicionada pelo proxy — as anteriores podem
// ser forjadas pelo cliente para tentar escapar do bloqueio.
const TRUST_PROXY = process.env.TRUST_PROXY
    ? process.env.TRUST_PROXY === 'true'
    : process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_PROJECT_ID;

function clientIp(req) {
    if (TRUST_PROXY) {
        const xff = String(req.headers['x-forwarded-for'] || '')
            .split(',').map(s => s.trim()).filter(Boolean);
        if (xff.length) return xff[xff.length - 1];
    }
    return req.socket.remoteAddress || 'desconhecido';
}

// ─── Bloqueio por IP ──────────────────────────────────────────────────────────
// ip → { failures, level, lockedUntil, lastFailure }
const attempts = new Map();

// Segundos restantes de bloqueio, ou null se o IP está liberado
function lockStatus(ip) {
    const a = attempts.get(ip);
    if (!a || !a.lockedUntil) return null;
    const remaining = a.lockedUntil - Date.now();
    return remaining > 0 ? Math.ceil(remaining / 1000) : null;
}

function registerFailure(ip) {
    const now = Date.now();
    let a = attempts.get(ip);
    // Conta as 24h a partir do fim do último bloqueio (não do último erro),
    // senão um bloqueio de 24h zeraria o nível sozinho
    if (!a || now - Math.max(a.lastFailure, a.lockedUntil) > LEVEL_RESET_MS) {
        a = { failures: 0, level: 0, lockedUntil: 0, lastFailure: 0 };
    }
    a.failures++;
    a.lastFailure = now;

    let lockedFor = 0;
    if (a.failures >= MAX_ATTEMPTS) {
        lockedFor = LOCK_STEPS_MS[Math.min(a.level, LOCK_STEPS_MS.length - 1)];
        a.lockedUntil = now + lockedFor;
        a.level++;
        a.failures = 0;
        console.warn(`[auth] IP ${ip} bloqueado por ${lockedFor / 60000} min (bloqueio nº ${a.level})`);
    }
    attempts.set(ip, a);
    return {
        remaining: lockedFor ? 0 : MAX_ATTEMPTS - a.failures,
        retryAfter: lockedFor ? Math.ceil(lockedFor / 1000) : 0,
    };
}

function clearFailures(ip) {
    attempts.delete(ip);
}

// ─── Sessões ──────────────────────────────────────────────────────────────────
const sessions = new Map(); // token → expiresAt

function parseCookies(req) {
    const out = {};
    for (const part of String(req.headers.cookie || '').split(';')) {
        const i = part.indexOf('=');
        if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
}

function isHttps(req) {
    return !!req.socket.encrypted ||
        (TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
}

function hasSession(req) {
    const token = parseCookies(req)[COOKIE_NAME];
    if (!token) return false;
    const exp = sessions.get(token);
    if (!exp) return false;
    if (exp < Date.now()) { sessions.delete(token); return false; }
    return true;
}

function sessionCookie(req, token, maxAgeSec) {
    return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}` +
        (isHttps(req) ? '; Secure' : '');
}

// Cria a sessão e devolve o valor do header Set-Cookie
function createSession(req) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    return sessionCookie(req, token, Math.floor(SESSION_TTL_MS / 1000));
}

// Encerra a sessão e devolve o Set-Cookie que apaga o cookie
function destroySession(req) {
    const token = parseCookies(req)[COOKIE_NAME];
    if (token) sessions.delete(token);
    return sessionCookie(req, '', 0);
}

// Limpeza periódica de sessões vencidas e históricos antigos
setInterval(() => {
    const now = Date.now();
    for (const [t, exp] of sessions) if (exp < now) sessions.delete(t);
    for (const [ip, a] of attempts) {
        if (now - Math.max(a.lastFailure, a.lockedUntil) > LEVEL_RESET_MS) attempts.delete(ip);
    }
}, 10 * 60 * 1000).unref();

module.exports = {
    PIN_IS_DEFAULT,
    MAX_ATTEMPTS,
    clientIp,
    pinMatches,
    lockStatus,
    registerFailure,
    clearFailures,
    hasSession,
    createSession,
    destroySession,
};
