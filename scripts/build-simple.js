#!/usr/bin/env node

/**
 * Build simples - copia apenas arquivos necessários para distribuição
 */

const fs = require('fs');
const path = require('path');
const { rimrafSync } = require('rimraf');
const mkdirp = require('mkdirp');

const distDir = path.join(process.cwd(), 'dist');

// Arquivos e pastas para ignorar
const IGNORE_PATTERNS = [
    'node_modules',
    'package-lock.json',
    'yarn.lock',
    '.git',
    '.github',
    '.vscode',
    '.idea',
    'tests',
    'coverage',
    '*.test.js',
    '*.spec.js',
    '*.log',
    '.env',
    '.env.local',
    '.DS_Store',
    '*.tgz',
    'docs',
    '*.md',
    '!README.md'
];

function shouldIgnore(filePath, fileName) {
    if (filePath.includes('node_modules')) return true;
    
    for (const pattern of IGNORE_PATTERNS) {
        if (pattern.startsWith('!')) {
            const includePattern = pattern.slice(1);
            if (fileName === includePattern) return false;
        } else if (fileName === pattern) {
            return true;
        } else if (pattern.includes('*')) {
            const regex = new RegExp(pattern.replace('*', '.*'));
            if (regex.test(fileName)) return true;
        }
    }
    return false;
}

function copyDir(src, dest) {
    if (!fs.existsSync(src)) return;
    
    const files = fs.readdirSync(src);
    mkdirp.sync(dest);
    
    for (const file of files) {
        const srcPath = path.join(src, file);
        const destPath = path.join(dest, file);
        const stat = fs.statSync(srcPath);
        
        if (shouldIgnore(srcPath, file)) {
            console.log(`   ⏭️  Ignorado: ${path.relative(process.cwd(), srcPath)}`);
            continue;
        }
        
        if (stat.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
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

// Copia src (ignorando node_modules e outros)
console.log('📁 Copiando src/...');
copyDir('src', path.join(distDir, 'src'));

// Copia bin
console.log('📁 Copiando bin/...');
copyDir('bin', path.join(distDir, 'bin'));

// Copia arquivos da raiz
console.log('📄 Copiando arquivos da raiz...');
const rootFiles = ['package.json', 'README.md', 'LICENSE'];
for (const file of rootFiles) {
    const srcPath = path.join(process.cwd(), file);
    const destPath = path.join(distDir, file);
    if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`   ✅ Copiado: ${file}`);
    }
}

// Atualiza package.json - MANTENDO AS DEPENDÊNCIAS
console.log('\n📝 Atualizando package.json...');
const packageJsonPath = path.join(distDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

// Remove scripts de desenvolvimento APENAS
delete pkg.scripts.test;
delete pkg.scripts.lint;
delete pkg.scripts.dev;
delete pkg.scripts.prepack;
delete pkg.scripts.prepublishOnly;
delete pkg.scripts.verify;
delete pkg.scripts['test:watch'];
delete pkg.scripts['test:coverage'];

// Mantém scripts essenciais
pkg.scripts = {
    start: "node bin/aws-local-simulator.js start"
};

// Remove devDependencies APENAS (mantém dependencies)
delete pkg.devDependencies;

// MANTÉM as dependencies - NÃO REMOVER!
// As dependencies devem permanecer para que o usuário as instale

// Adiciona metadados
pkg.buildDate = new Date().toISOString();
pkg.published = true;

// Garante que apenas os arquivos necessários serão publicados
pkg.files = [
    "src/",
    "bin/",
    "README.md",
    "LICENSE"
];

fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2));
console.log('   ✅ package.json atualizado (dependencies mantidas)');

// Verifica se as dependencies estão presentes
if (!pkg.dependencies || Object.keys(pkg.dependencies).length === 0) {
    console.log('   ⚠️  AVISO: Nenhuma dependência encontrada!');
    console.log('   O pacote pode não funcionar corretamente.');
} else {
    console.log(`   ✅ Dependencies mantidas: ${Object.keys(pkg.dependencies).length} pacotes`);
}

// Cria .npmignore no dist
const npmignorePath = path.join(distDir, '.npmignore');
const npmignoreContent = `# Ignorar apenas arquivos de desenvolvimento
node_modules/
package-lock.json
yarn.lock
*.test.js
*.spec.js
__tests__/
*.map
*.ts
*.tsbuildinfo
.DS_Store
`;
fs.writeFileSync(npmignorePath, npmignoreContent);
console.log('   ✅ .npmignore criado');

// Conta arquivos
function countFiles(dir) {
    let count = 0;
    if (!fs.existsSync(dir)) return count;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            count += countFiles(filePath);
        } else {
            count++;
        }
    }
    return count;
}

function getSize(dir) {
    let size = 0;
    if (!fs.existsSync(dir)) return size;
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
}

const fileCount = countFiles(distDir);
const sizeInMB = (getSize(distDir) / (1024 * 1024)).toFixed(2);

console.log('\n✅ Build concluído!');
console.log(`📦 Pacote preparado em: ${distDir}`);
console.log(`📊 Tamanho total: ${sizeInMB} MB`);
console.log(`📄 Total de arquivos: ${fileCount}`);
console.log('\n📋 Para publicar, execute:');
console.log('   cd dist');
console.log('   npm publish --access public');