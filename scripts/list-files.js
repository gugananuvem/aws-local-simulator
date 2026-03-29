#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function listFiles(dir, prefix = '') {
    if (!fs.existsSync(dir)) return;
    
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            listFiles(filePath, `${prefix}${file}/`);
        } else {
            console.log(`   ${prefix}${file}`);
        }
    }
}

console.log('📦 Arquivos no pacote:\n');

// Lista arquivos que serão incluídos
listFiles('src');
listFiles('bin');

console.log('\n📄 Arquivos na raiz:');
const rootFiles = ['package.json', 'README.md', 'LICENSE'];
for (const file of rootFiles) {
    if (fs.existsSync(file)) {
        console.log(`   ${file}`);
    }
}