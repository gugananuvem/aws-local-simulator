#!/usr/bin/env node

/**
 * Verifica se a ofuscação foi aplicada corretamente
 */

const fs = require('fs');
const path = require('path');

const distDir = path.join(process.cwd(), 'dist');

function checkObfuscation(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Verifica características de código ofuscado
    const hasHexStrings = /0x[0-9a-f]+/.test(content);
    const hasStringArray = /var _0x[a-f0-9]+/.test(content);
    const hasControlFlow = /function\(\)\{return _0x/.test(content);
    const isMinified = content.includes('\n') === false;
    
    return {
        hasHexStrings,
        hasStringArray,
        hasControlFlow,
        isMinified
    };
}

function verify() {
    console.log('🔍 Verificando ofuscação...\n');
    
    const files = getAllFiles(distDir);
    let obfuscatedCount = 0;
    let totalCount = 0;
    
    for (const file of files) {
        const ext = path.extname(file);
        if (['.js', '.mjs', '.cjs'].includes(ext)) {
            totalCount++;
            const result = checkObfuscation(file);
            const isObfuscated = result.hasHexStrings || result.hasStringArray;
            
            if (isObfuscated) {
                obfuscatedCount++;
                console.log(`✅ ${path.relative(distDir, file)} - Ofuscado`);
            } else {
                console.log(`⚠️  ${path.relative(distDir, file)} - NÃO ofuscado`);
            }
        }
    }
    
    console.log(`\n📊 Estatísticas:`);
    console.log(`   Total de arquivos JS: ${totalCount}`);
    console.log(`   Arquivos ofuscados: ${obfuscatedCount}`);
    console.log(`   Taxa de ofuscação: ${((obfuscatedCount / totalCount) * 100).toFixed(2)}%`);
    
    if (obfuscatedCount === totalCount) {
        console.log('\n✅ Todos os arquivos foram ofuscados corretamente!');
    } else {
        console.log('\n⚠️  Alguns arquivos não foram ofuscados!');
    }
}

function getAllFiles(dir, fileList = []) {
    if (!fs.existsSync(dir)) return fileList;
    
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
            getAllFiles(filePath, fileList);
        } else {
            fileList.push(filePath);
        }
    }
    
    return fileList;
}

verify();