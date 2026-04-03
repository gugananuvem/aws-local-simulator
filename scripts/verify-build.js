#!/usr/bin/env node

/**
 * Verifica se o build está correto
 */

const fs = require('fs');
const path = require('path');

const distDir = path.join(process.cwd(), 'dist');

console.log('🔍 Verificando build...\n');

// Verifica arquivos essenciais
const essentialFiles = [
    'package.json',
    'bin/aws-local-simulator.js',
    'src/index.js',
    'src/server.js',
    'src/utils/logger.js'
];

let missing = [];
for (const file of essentialFiles) {
    const filePath = path.join(distDir, file);
    if (!fs.existsSync(filePath)) {
        missing.push(file);
        console.log(`❌ Faltando: ${file}`);
    } else {
        console.log(`✅ Encontrado: ${file}`);
    }
}

if (missing.length > 0) {
    console.log(`\n❌ ERRO: ${missing.length} arquivos faltando!`);
    process.exit(1);
}

// Verifica package.json
const pkg = JSON.parse(fs.readFileSync(path.join(distDir, 'package.json'), 'utf8'));
console.log(`\n📦 Package: ${pkg.name}@${pkg.version}`);
console.log(`   Dependencies: ${Object.keys(pkg.dependencies || {}).length}`);
console.log(`   Obfuscated: ${pkg.obfuscated || false}`);

// Conta arquivos JS
function countJsFiles(dir) {
    let count = 0;
    if (!fs.existsSync(dir)) return count;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            count += countJsFiles(filePath);
        } else if (file.endsWith('.js')) {
            count++;
        }
    }
    return count;
}

const jsCount = countJsFiles(distDir);
console.log(`\n📄 Arquivos JS: ${jsCount}`);

console.log('\n✅ Build verificado com sucesso!');