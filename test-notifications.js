'use strict';
/**
 * test-notifications.js
 * Testa o endpoint de notificações para ver a estrutura real da resposta.
 * Uso: node test-notifications.js [correlationId]
 */

const api = require('./uconnect-api.js');
const fs  = require('fs');

async function run() {
    const correlationId = process.argv[2] || null;

    console.log('\n🔐 Autenticando...');
    await api.main({ silent: true, saveFile: false });

    const vin = api.session.userId ? null : null;

    // Pega o VIN do resultado
    const result = await api.main({ silent: true, saveFile: false });
    const vinActual = result.vehicles[0].vin;

    console.log(`\n📬 Buscando notificações para VIN ${vinActual}...`);
    const url = `https://channels.sdpr-02.fcagcv.com/v1/accounts/${api.session.userId}/vehicles/${vinActual}/notifications?limit=30`;

    const { default: https } = await import('https');

    // Usa a função interna via módulo
    const notifResult = await api.getNotificationsStatus(vinActual, correlationId || 'DUMMY');

    // Vamos também inspecionar a resposta bruta salvando em arquivo
    // Acessa diretamente via o httpRequest interno não exportado
    // → Em vez disso, re-usa main() que já fez auth e salva as notificações

    // Hack: chama o endpoint diretamente reusando a sessão
    const crypto = require('crypto');
    const { URL } = require('url');

    function sha256Hex(d) { return crypto.createHash('sha256').update(d).digest('hex'); }
    function hmac(key, data) { return crypto.createHmac('sha256', key).update(data).digest(); }
    function hmacHex(key, data) { return crypto.createHmac('sha256', key).update(data).digest('hex'); }

    function sign(method, urlStr, extraHeaders = {}) {
        const aws    = api.session.aws;
        const parsed = new URL(urlStr);
        const now    = new Date();
        const datestamp = now.toISOString().slice(0,10).replace(/-/g,'');
        const amzdate   = now.toISOString().replace(/[-:]/g,'').replace(/\.\d+/,'');

        const allH = {
            ...extraHeaders,
            host:                   parsed.hostname,
            'x-amz-date':           amzdate,
            'x-amz-security-token': aws.sessionToken,
        };

        const sortedKeys      = Object.keys(allH).map(k=>k.toLowerCase()).sort();
        const canonicalHeaders = sortedKeys.map(k=>`${k}:${allH[k].trim()}`).join('\n')+'\n';
        const signedHeadersStr = sortedKeys.join(';');
        const payloadHash      = sha256Hex('');
        const canonicalUri     = encodeURI(parsed.pathname)||'/';
        const canonicalQuery   = parsed.search
            ? parsed.search.slice(1).split('&').map(p=>p.split('=').map(encodeURIComponent).join('=')).sort().join('&')
            : '';

        const canonicalRequest = [method,'GET'===method?canonicalUri:canonicalUri,canonicalQuery,canonicalHeaders,signedHeadersStr,payloadHash].join('\n');
        const credentialScope = `${datestamp}/${aws.region}/execute-api/aws4_request`;
        const stringToSign = ['AWS4-HMAC-SHA256',amzdate,credentialScope,sha256Hex(canonicalRequest)].join('\n');
        const kDate    = hmac(`AWS4${aws.secretAccessKey}`, datestamp);
        const kRegion  = hmac(kDate, aws.region);
        const kService = hmac(kRegion, 'execute-api');
        const kSigning = hmac(kService, 'aws4_request');
        const signature = hmacHex(kSigning, stringToSign);
        const authorization = `AWS4-HMAC-SHA256 Credential=${aws.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`;
        return { ...allH, authorization };
    }

    const notifUrl = `https://channels.sdpr-02.fcagcv.com/v1/accounts/${api.session.userId}/vehicles/${vinActual}/notifications?limit=30`;
    const headers  = sign('GET', notifUrl, {
        accept:                'application/json, text/plain, */*',
        clientrequestid:       crypto.randomBytes(8).toString('hex'),
        'content-type':        'application/json',
        locale:                'br_pt',
        'x-api-key':           api.CONFIG.vehiclesApiKey,
        'x-clientapp-name':    'CWP',
        'x-clientapp-version': '1.0',
        'x-originator-type':   'web',
    });

    const rawData = await new Promise((resolve, reject) => {
        const { URL: URL2 } = require('url');
        const https2 = require('https');
        const parsed2 = new URL2(notifUrl);
        const req = https2.request({
            hostname: parsed2.hostname,
            path:     parsed2.pathname + parsed2.search,
            method:   'GET',
            headers,
        }, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                console.log(`HTTP ${res.statusCode}`);
                try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
                catch { resolve(Buffer.concat(chunks).toString()); }
            });
        });
        req.on('error', reject);
        req.end();
    });

    const outFile = `notifications-raw-${Date.now()}.json`;
    fs.writeFileSync(outFile, JSON.stringify(rawData, null, 2));
    console.log(`\n📄 Resposta bruta salva em: ${outFile}`);

    const items = rawData?.notifications?.items || [];
    console.log(`\n📊 Total de notificações: ${items.length}`);
    items.slice(0,5).forEach((item, i) => {
        console.log(`\n  [${i+1}] correlationId: ${item.correlationId}`);
        console.log(`       notification.data: ${JSON.stringify(item?.notification?.data)}`);
    });

    if (correlationId) {
        const match = items.find(x => x.correlationId === correlationId);
        if (match) {
            console.log(`\n✅ Encontrou correlationId ${correlationId}:`);
            console.log(JSON.stringify(match, null, 2));
        } else {
            console.log(`\n❌ correlationId ${correlationId} não encontrado nas notificações`);
        }
    }
}

run().catch(err => {
    console.error('Erro:', err.message);
    if (err.body) console.error('Body:', JSON.stringify(err.body, null, 2));
    process.exit(1);
});
