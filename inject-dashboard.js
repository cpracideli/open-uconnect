/**
 * inject-dashboard.js
 *
 * Lê o JSON mais recente gerado pelo uconnect-api.js e
 * injeta os dados diretamente no dashboard.html,
 * gerando um arquivo dashboard-live.html que funciona
 * sem servidor (abertura direta via file://).
 *
 * Uso:
 *   node inject-dashboard.js
 *   node inject-dashboard.js --run   (executa o script de API antes de injetar)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args   = process.argv.slice(2);
const runApi = args.includes('--run');

// ─── 1. Executar o script de API se pedido ────────────────────────────────────
if (runApi) {
    console.log('🚀 Executando uconnect-api.js para buscar dados frescos...\n');
    try {
        execSync('node uconnect-api.js', { stdio: 'inherit' });
    } catch (e) {
        console.error('❌ Falha ao executar uconnect-api.js');
        process.exit(1);
    }
    console.log('');
}

// ─── 2. Encontrar o JSON mais recente ────────────────────────────────────────
const files = fs.readdirSync('.')
    .filter(f => f.startsWith('uconnect-result-') && f.endsWith('.json'))
    .sort()
    .reverse();

if (files.length === 0) {
    console.error('❌ Nenhum arquivo uconnect-result-*.json encontrado.');
    console.error('   Execute primeiro: node uconnect-api.js');
    process.exit(1);
}

const jsonFile = files[0];
console.log(`📄 Usando dados de: ${jsonFile}`);

const jsonData = fs.readFileSync(jsonFile, 'utf8');

// Escapar para injetar dentro de um template literal JS
const escaped = jsonData.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

// ─── 3. Ler o template do dashboard ──────────────────────────────────────────
const templatePath = path.join(__dirname, 'dashboard.html');
if (!fs.existsSync(templatePath)) {
    console.error('❌ dashboard.html não encontrado.');
    process.exit(1);
}

let html = fs.readFileSync(templatePath, 'utf8');

// ─── 4. Injetar os dados ──────────────────────────────────────────────────────
if (!html.includes('__EMBEDDED_JSON__')) {
    console.error('❌ Marcador __EMBEDDED_JSON__ não encontrado no dashboard.html.');
    process.exit(1);
}

html = html.replace('__EMBEDDED_JSON__', escaped);

// Atualizar o título com a data
const ts = new Date().toLocaleString('pt-BR');
html = html.replace(
    '<title>Uconnect Dashboard</title>',
    `<title>Uconnect Dashboard — ${ts}</title>`
);

// ─── 5. Salvar o dashboard final ──────────────────────────────────────────────
const outFile = 'dashboard-live.html';
fs.writeFileSync(outFile, html, 'utf8');

const size = (fs.statSync(outFile).size / 1024).toFixed(1);
console.log(`\n✅ Dashboard gerado: ${outFile} (${size} KB)`);
console.log(`   Dados de: ${new Date(JSON.parse(jsonData).timestamp).toLocaleString('pt-BR')}`);
console.log(`\n💡 Abra o arquivo no navegador:`);
console.log(`   start ${outFile}`);
