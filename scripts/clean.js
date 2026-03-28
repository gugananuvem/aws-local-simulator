#!/usr/bin/env node

/**
 * Script de limpeza
 */

const { rimrafSync } = require('rimraf');
const fs = require('fs');
const path = require('path');

const dirsToClean = [
    'dist',
    '.aws-local-simulator-data',
    'coverage',
    '.nyc_output'
];

const filesToClean = [
    'package-lock.json',
    'yarn.lock'
];

console.log('🧹 Limpando arquivos...\n');

// Limpa diretórios
for (const dir of dirsToClean) {
    if (fs.existsSync(dir)) {
        rimrafSync(dir);
        console.log(`✅ Removido: ${dir}/`);
    }
}

// Limpa arquivos
for (const file of filesToClean) {
    if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        console.log(`✅ Removido: ${file}`);
    }
}

console.log('\n✅ Limpeza concluída!');