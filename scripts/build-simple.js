#!/usr/bin/env node

/**
 * Build simples - apenas copia os arquivos para distribuição
 */

const fs = require('fs');
const path = require('path');
const { rimrafSync } = require('rimraf');
const mkdirp = require('mkdirp');

const distDir = path.join(process.cwd(), 'dist');

// Função para copiar diretório recursivamente
function copyDir(src, dest, filter = null) {
    if (!fs.existsSync(src)) return;
    
    const files = fs.readdirSync(src);
    mkdirp.sync(dest);
    
    for (const file of files) {
        const srcPath = path.join(src, file);
        const destPath = path.join(dest, file);
        const stat = fs.statSync(srcPath);
        
        if (stat.isDirectory()) {
            copyDir(srcPath, destPath, filter);
        } else {
            if (filter && !filter(file)) continue;
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

console.log('📦 Preparando pacote para publicação...\n');

// Limpa diretório dist
if (fs.existsSync(distDir)) {
    console.log('🧹 Limpando diretório dist...');
    rimrafSync(distDir);
}

// Cria diretório dist
mkdirp.sync(distDir);

// Copia src
console.log('📁 Copiando src/...');
copyDir('src', path.join(distDir, 'src'));

// Copia bin
console.log('📁 Copiando bin/...');
copyDir('bin', path.join(distDir, 'bin'));

// Copia arquivos da raiz
console.log('📄 Copiando arquivos da raiz...');
const rootFiles = ['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md'];
for (const file of rootFiles) {
    const srcPath = path.join(process.cwd(), file);
    const destPath = path.join(distDir, file);
    if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`   ✅ Copiado: ${file}`);
    }
}

// Atualiza package.json para remover scripts de desenvolvimento
console.log('\n📝 Atualizando package.json...');
const packageJsonPath = path.join(distDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

// Remove scripts de desenvolvimento
delete pkg.scripts.test;
delete pkg.scripts.lint;
delete pkg.scripts.dev;
delete pkg.scripts.prepack;
delete pkg.scripts.prepublishOnly;
delete pkg.scripts.verify;
delete pkg.scripts['test:watch'];
delete pkg.scripts['test:coverage'];

// Mantém apenas scripts essenciais
pkg.scripts = {
    start: "node bin/aws-local-simulator.js start"
};

// Remove devDependencies
delete pkg.devDependencies;

// Adiciona metadados
pkg.buildDate = new Date().toISOString();
pkg.published = true;

fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2));
console.log('   ✅ package.json atualizado');

// Calcula tamanho
const getSize = (dir) => {
    let size = 0;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            size += getSize(filePath);
        } else {
            size += stat.size;
        }
    }
    return size;
};

const sizeInMB = (getSize(distDir) / (1024 * 1024)).toFixed(2);

console.log('\n✅ Build concluído!');
console.log(`📦 Pacote preparado em: ${distDir}`);
console.log(`📊 Tamanho total: ${sizeInMB} MB`);
console.log('\n📋 Para publicar, execute:');
console.log('   cd dist');
console.log('   npm publish --access public');