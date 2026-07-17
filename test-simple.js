/**
 * Script simples de teste para Uconnect API
 * Versão simplificada do script principal
 */

const https = require('https');

// Configurações básicas
const config = {
    email: 'cpracideli@gmail.com',
    password: 'Beatriz2025!',
    apiKey: '3_5qxvrevRPG7--nEXe6huWdVvF5kV7bmmJcyLdaTJ8A45XUYpaR398QNeHkd7EB1X'
};

// Função para fazer requisições HTTP
function makeRequest(url, options, body = null) {
    return new Promise((resolve, reject) => {
        console.log(`📤 Enviando request para: ${url}`);
        
        const req = https.request(url, options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                console.log(`📥 Response status: ${res.statusCode}`);
                
                try {
                    const jsonData = JSON.parse(data);
                    resolve({
                        success: res.statusCode === 200,
                        status: res.statusCode,
                        data: jsonData
                    });
                } catch (e) {
                    resolve({
                        success: false,
                        status: res.statusCode,
                        data: data
                    });
                }
            });
        });
        
        req.on('error', (error) => {
            console.error(`❌ Erro: ${error.message}`);
            reject(error);
        });
        
        if (body) {
            req.write(body);
        }
        
        req.end();
    });
}

// Request 1: Autenticação
async function fazerLogin() {
    console.log('\n=== REQUEST 1: AUTENTICAÇÃO ===');
    
    // Body exatamente como no request original (URL-encoded)
    const loginData = [
        `loginID=${encodeURIComponent(config.email)}`,
        `password=${encodeURIComponent(config.password)}`,
        `sessionExpiration=86400`,
        `targetEnv=jssdk`,
        `include=profile%2Cdata`,
        `includeUserInfo=true`,
        `lang=en`,
        `APIKey=${config.apiKey}`,
        `sdk=js_latest`,
        `authMode=cookie`,
        `pageURL=${encodeURIComponent('https://myuconnect.jeep.com/br/pt/login')}`,
        `sdkBuild=2135`,
        `format=json`
    ].join('&');
    
    const options = {
        method: 'POST',
        headers: {
            'accept': '*/*',
            'accept-language': 'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7,es;q=0.6',
            'content-type': 'application/x-www-form-urlencoded',
            'sec-ch-ua': '"Microsoft Edge";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'priority': 'u=1, i',
            'referer': 'https://myuconnect.jeep.com/',
            'origin': 'https://myuconnect.jeep.com'
        }
    };
    
    try {
        const result = await makeRequest(
            'https://login-us.jeep.com/accounts.login',
            options,
            loginData
        );
        
        if (result.success && result.data.errorCode === 0) {
            console.log('✅ Login realizado com sucesso!');
            console.log(`User ID: ${result.data.UID}`);
            console.log(`Nome: ${result.data.profile?.firstName} ${result.data.profile?.lastName}`);
            
            return {
                userId: result.data.UID,
                loginToken: result.data.sessionInfo?.login_token
            };
        } else {
            console.log('❌ Falha no login:', result.data);
            return null;
        }
    } catch (error) {
        console.error('❌ Erro no login:', error.message);
        return null;
    }
}

// Request 4: Lista de veículos (versão simulada)
async function getVehiclesSimulado(userId) {
    console.log('\n=== REQUEST 4: LISTA DE VEÍCULOS (SIMULADO) ===');
    
    // Em um cenário real, aqui viria a requisição com headers AWS
    // Para este exemplo, vamos mostrar a estrutura esperada
    
    console.log(`URL que seria usada: https://channels.sdpr-02.fcagcv.com/v4/accounts/${userId}/vehicles?stage=ALL&sdp=ALL`);
    console.log('\nHeaders necessários:');
    console.log('- authorization: AWS4-HMAC-SHA256 Credential=...');
    console.log('- x-amz-date: 20260624T005329Z');
    console.log('- x-amz-security-token: IQoJb3JpZ2luX2VjEGEaCXVzLWVhc3QtMSJGMEQC...');
    console.log('- x-api-key: OgNqp2eAv84oZvMrXPIzP8mR8a6d9bVm1aaH9LqU');
    
    // Dados de exemplo baseados no request1.md
    const exemploVeiculos = {
        userid: userId,
        version: 1778578991408,
        vehicles: [
            {
                color: "CINZA GRANITE CRYSTAL BICOLOR",
                year: 2022,
                vin: "98867516TNKL53814",
                company: "FCA",
                model: "675",
                make: "Jeep",
                modelDescription: "COMPASS",
                fuelType: "G"
            }
        ]
    };
    
    console.log('\n✅ Dados de exemplo (baseados no arquivo request1.md):');
    console.log(JSON.stringify(exemploVeiculos, null, 2));
    
    return exemploVeiculos.vehicles;
}

// Request 5: Status do veículo (versão simulada)
async function getVehicleStatusSimulado(userId, vin) {
    console.log('\n=== REQUEST 5: STATUS DO VEÍCULO (SIMULADO) ===');
    
    console.log(`URL que seria usada: https://channels.sdpr-02.fcagcv.com/v2/accounts/${userId}/vehicles/${vin}/status`);
    
    // Dados de exemplo baseados no request1.md
    const exemploStatus = {
        vehicleInfo: {
            distanceUnit: "km",
            odometer: {
                odometer: {
                    value: "57416",
                    unit: "km"
                }
            },
            fuel: {
                fuelAmountLevel: 93,
                isFuelLevelLow: false,
                distanceToEmpty: {
                    value: "435",
                    unit: "km"
                },
                fuelAmount: {
                    value: "49.0",
                    unit: "l"
                }
            },
            tyrePressure: [
                {
                    warning: false,
                    pressure: { value: "230.57", unit: "kPa" },
                    type: "FL",
                    status: "NORMAL"
                },
                {
                    warning: false,
                    pressure: { value: "233.32", unit: "kPa" },
                    type: "FR",
                    status: "NORMAL"
                },
                {
                    warning: true,
                    pressure: { value: "189.40", unit: "kPa" },
                    type: "RL",
                    status: "SIGNIFICANTLY_LOW"
                },
                {
                    warning: false,
                    pressure: { value: "211.36", unit: "kPa" },
                    type: "RR",
                    status: "NORMAL"
                }
            ],
            batteryInfo: {
                batteryVoltage: {
                    value: "14.5",
                    unit: "volts"
                }
            }
        }
    };
    
    console.log('\n✅ Status do veículo (dados de exemplo):');
    console.log(JSON.stringify(exemploStatus, null, 2));
    
    return exemploStatus;
}

// Função principal
async function main() {
    console.log('🚀 Script de Teste Uconnect API\n');
    
    // 1. Fazer login
    const session = await fazerLogin();
    if (!session) {
        console.log('\n❌ Não foi possível autenticar. Encerrando...');
        return;
    }
    
    // 2. Buscar veículos (simulado)
    const vehicles = await getVehiclesSimulado(session.userId);
    if (vehicles && vehicles.length > 0) {
        console.log(`\n📋 Total de veículos: ${vehicles.length}`);
        
        // 3. Buscar status do primeiro veículo (simulado)
        const primeiroVeiculo = vehicles[0];
        if (primeiroVeiculo.vin) {
            await getVehicleStatusSimulado(session.userId, primeiroVeiculo.vin);
            
            // Resumo
            console.log('\n📊 RESUMO:');
            console.log(`Veículo: ${primeiroVeiculo.make} ${primeiroVeiculo.modelDescription} ${primeiroVeiculo.year}`);
            console.log(`Cor: ${primeiroVeiculo.color}`);
            console.log(`VIN: ${primeiroVeiculo.vin}`);
        }
    }
    
    console.log('\n✅ Script concluído!');
    console.log('\n💡 Para a versão completa com requests reais, execute:');
    console.log('   node uconnect-api.js');
}

// Executar
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Erro:', error);
    });
}

module.exports = {
    fazerLogin,
    getVehiclesSimulado,
    getVehicleStatusSimulado
};