/**
 * Configuração avançada do obfuscator
 */

module.exports = {
    // Nível de ofuscação
    level: 'high', // low, medium, high, extreme
    
    // Arquivos a serem preservados (não ofuscar)
    preserveFiles: [
        'src/templates/**/*',
        'src/config/default-config.js',
        'bin/aws-local-simulator.js'
    ],
    
    // Configurações específicas por ambiente
    env: {
        development: {
            compact: false,
            controlFlowFlattening: false,
            deadCodeInjection: false,
            selfDefending: false,
            stringArray: false
        },
        production: {
            compact: true,
            controlFlowFlattening: false,
            controlFlowFlatteningThreshold: 0.75,
            deadCodeInjection: false,
            deadCodeInjectionThreshold: 0.4,
            selfDefending: false,
            stringArray: true,
            stringArrayEncoding: ['rc4'],
            stringArrayThreshold: 0.75
        }
    },
    
    // Nomes reservados (não renomear)
    reservedNames: [
        'handler',
        'exports',
        'module',
        'require',
        '__dirname',
        '__filename',
        'process',
        'Buffer',
        'console',
        'setTimeout',
        'setInterval',
        'clearTimeout',
        'clearInterval',
        'Promise',
        'Buffer',
        'URL',
        'URLSearchParams'
    ],
    
    // Strings reservadas (não ofuscar)
    reservedStrings: [
        'http://localhost',
        'AWS Local Simulator',
        'DynamoDB',
        'S3',
        'SQS',
        'Lambda',
        'Cognito',
        'API Gateway',
        'ECS'
    ]
};