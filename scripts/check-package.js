#!/usr/bin/env node

/**
 * Verifica se o pacote está correto antes de publicar
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const distDir = path.join(process.cwd(), 'dist');

console.log('🔍 Verificando pacote antes da publicação...\n');

// Verifica se diretório dist existe
if (!fs.existsSync(distDir)) {
    console.log('❌ Diretório dist não encontrado. Execute: npm run build');
    process.exit(1);
}

// Verifica se tem node_modules
const nodeModulesPath = path.join(distDir, 'node_modules');
if (fs.existsSync(nodeModulesPath)) {
    console.log('❌ ERRO: node_modules encontrado no pacote!');
    console.log('   Isso não deve acontecer. Verifique o .npmignore');
    process.exit(1);
} else {
    console.log('✅ Nenhum node_modules encontrado');
}

// Verifica package.json
const packageJsonPath = path.join(distDir, 'package.json');
if (!fs.existsSync(packageJsonPath)) {
    console.log('❌ package.json não encontrado');
    process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
console.log(`✅ package.json: ${pkg.name}@${pkg.version}`);

// Verifica se tem devDependencies
if (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0) {
    console.log('⚠️  Aviso: devDependencies encontradas no package.json');
    console.log('   Elas serão ignoradas na publicação, mas é melhor removê-las');
}

// Verifica arquivos essenciais
const essentialFiles = [
    'src/index.js',
    'bin/aws-local-simulator.js'
];

let missingFiles = [];
for (const file of essentialFiles) {
    const filePath = path.join(distDir, file);
    if (!fs.existsSync(filePath)) {
        missingFiles.push(file);
    }
}

if (missingFiles.length > 0) {
    console.log(`❌ Arquivos faltando: ${missingFiles.join(', ')}`);
    process.exit(1);
} else {
    console.log('✅ Arquivos essenciais presentes');
}

// Simula publicação para ver o que seria incluído
console.log('\n📦 Simulando publicação (npm pack --dry-run)...');
try {
    const result = execSync('cd dist && npm pack --dry-run 2>&1', { encoding: 'utf8' });
    console.log(result);
} catch (error) {
    console.log('⚠️  Não foi possível simular publicação');
}

console.log('\n✅ Pacote parece correto!');
console.log('\nPara publicar:');
console.log('   cd dist && npm publish --access public');