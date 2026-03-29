#!/usr/bin/env node

/**
 * Verifica se todas as dependências estão corretamente declaradas
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Verificando dependências...\n');

// Lê package.json
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

// Encontra todos os requires nos arquivos fonte
function findRequires(dir, requires = new Set()) {
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
            if (file !== 'node_modules' && file !== 'dist' && file !== 'tests') {
                findRequires(filePath, requires);
            }
        } else if (file.endsWith('.js')) {
            const content = fs.readFileSync(filePath, 'utf8');
            const regex = /require\(['"]([^'"]+)['"]\)/g;
            let match;
            while ((match = regex.exec(content)) !== null) {
                const moduleName = match[1];
                // Ignora módulos internos do Node e paths relativos
                if (!moduleName.startsWith('.') && !moduleName.startsWith('/') && !moduleName.startsWith('@')) {
                    requires.add(moduleName);
                }
            }
        }
    }
    
    return requires;
}

const requiredModules = findRequires('src');

console.log('📦 Módulos requeridos em tempo de execução:');
for (const mod of Array.from(requiredModules).sort()) {
    console.log(`   - ${mod}`);
}

console.log('\n📦 Dependências declaradas:');
for (const dep of Object.keys(pkg.dependencies || {})) {
    console.log(`   - ${dep}`);
}

console.log('\n📦 Dependências de desenvolvimento:');
for (const dep of Object.keys(pkg.devDependencies || {})) {
    console.log(`   - ${dep}`);
}

// Verifica módulos faltando
const missingModules = [];
for (const mod of requiredModules) {
    if (!pkg.dependencies[mod] && !pkg.devDependencies[mod]) {
        missingModules.push(mod);
    }
}

if (missingModules.length > 0) {
    console.log('\n❌ Módulos faltando nas dependências:');
    for (const mod of missingModules) {
        console.log(`   - ${mod}`);
    }
    console.log('\n⚠️  Adicione-os ao package.json!');
} else {
    console.log('\n✅ Todos os módulos estão declarados!');
}

// Verifica módulos que estão em devDependencies mas deveriam estar em dependencies
const wrongDevDeps = [];
for (const dep of Object.keys(pkg.devDependencies || {})) {
    if (requiredModules.has(dep)) {
        wrongDevDeps.push(dep);
    }
}

if (wrongDevDeps.length > 0) {
    console.log('\n⚠️  Módulos em devDependencies que são usados em runtime:');
    for (const dep of wrongDevDeps) {
        console.log(`   - ${dep} (deve estar em dependencies)`);
    }
}