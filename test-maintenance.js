'use strict';

const https  = require('https');
const crypto = require('crypto');
const { URL } = require('url');

// ─── Reutiliza a lógica de autenticação do uconnect-api.js ───────────────────
const { main: runApi, session, CONFIG } = require('./uconnect-api.js');

function sha256Hex(data)    { return crypto.createHash('sha256').update(data).digest('hex'); }
function hmac(key, data)    { return crypto.createHmac('sha256', key).update(data).digest(); }
function hmacHex(key, data) { return crypto.createHmac('sha256', key).update(data).digest('hex'); }

function signRequest({ method, url, headers = {}, body = '' }) {
    const aws    = session.aws;
    const parsed = new URL(url);
    const now    = new Date();
    const datestamp = now.toISOString().slice(0, 10).replace(/-/g, '');
    const amzdate   = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

    const allHeaders = {
        ...headers,
        host:                   parsed.hostname,
        'x-amz-date':           amzdate,
        'x-amz-security-token': aws.sessionToken,
    };

    const sortedKeys       = Object.keys(allHeaders).map(k => k.toLowerCase()).sort();
    const canonicalHeaders  = sortedKeys.map(k => `${k}:${allHeaders[k].trim()}`).join('\n') + '\n';
    const signedHeadersStr  = sortedKeys.join(';');
    const payloadHash       = sha256Hex(body);
    const canonicalUri      = encodeURI(parsed.pathname) || '/';
    const canonicalQuery    = parsed.search
        ? parsed.search.slice(1).split('&').map(p => p.split('=').map(encodeURIComponent).join('=')).sort().join('&')
        : '';

    const canonicalRequest = [method.toUpperCase(), canonicalUri, canonicalQuery,
                               canonicalHeaders, signedHeadersStr, payloadHash].join('\n');
    const service          = 'execute-api';
    const credentialScope  = `${datestamp}/${aws.region}/${service}/aws4_request`;
    const stringToSign     = ['AWS4-HMAC-SHA256', amzdate, credentialScope, sha256Hex(canonicalRequest)].join('\n');

    const kDate    = hmac(`AWS4${aws.secretAccessKey}`, datestamp);
    const kRegion  = hmac(kDate,   aws.region);
    const kService = hmac(kRegion, service);
    const kSigning = hmac(kService,'aws4_request');
    const signature = hmacHex(kSigning, stringToSign);

    const authorization = `AWS4-HMAC-SHA256 Credential=${aws.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`;
    return { ...allHeaders, authorization };
}

function randomId() { return crypto.randomBytes(8).toString('hex'); }

function httpGet(urlStr, headers) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(urlStr);
        const req = https.request({
            hostname: parsed.hostname,
            path:     parsed.pathname + parsed.search,
            method:   'GET',
            headers,
        }, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString();
                console.log('Status HTTP:', res.statusCode);
                try {
                    const data = JSON.parse(raw);
                    if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
                    else { const e = new Error('HTTP ' + res.statusCode); e.body = data; reject(e); }
                } catch {
                    console.log('Raw response:', raw.substring(0, 500));
                    reject(new Error('Resposta não é JSON'));
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

async function testMaintenance() {
    console.log('Autenticando...');
    const result = await runApi({ silent: true, saveFile: false });
    const vin    = result.vehicles[0].vin;

    console.log('userId:', result.userId);
    console.log('VIN:', vin);
    console.log('\nTestando endpoint de manutenção...');

    const url = `https://channels.sdpr-02.fcagcv.com/v1/accounts/${result.userId}/vehicles/${vin}/maintenance/history/`;
    console.log('URL:', url);

    const headers = signRequest({
        method: 'GET',
        url,
        headers: {
            accept:                'application/json, text/plain, */*',
            'accept-language':     'en-US,en;q=0.9',
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

    const data = await httpGet(url, headers);
    console.log('\nResposta:');
    console.log(JSON.stringify(data, null, 2));
}

testMaintenance().catch(err => {
    console.error('\nErro:', err.message);
    if (err.body) console.error('Body:', JSON.stringify(err.body, null, 2));
    process.exit(1);
});
