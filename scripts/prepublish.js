#!/usr/bin/env node

/**
 * Script de pré-publicação
 * Verifica tudo antes de publicar
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    reset: '\x1b[0m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkNodeVersion() {
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    
    if (majorVersion < 14) {
        log(`❌ Node.js versão ${nodeVersion} é muito antiga. Necessário >= 14`, 'red');
        process.exit(1);
    }
    
    log(`✅ Node.js versão: ${nodeVersion}`, 'green');
}

function checkNpmLogin() {
    try {
        const username = execSync('npm whoami', { encoding: 'utf8' }).trim();
        log(`✅ Autenticado no NPM como: ${username}`, 'green');
    } catch (error) {
        log('❌ Não autenticado no NPM. Execute "npm login" primeiro.', 'red');
        process.exit(1);
    }
}

function checkGitStatus() {
    try {
        const status = execSync('git status --porcelain', { encoding: 'utf8' });
        if (status.trim()) {
            log('\n⚠️  Há mudanças não commitadas:', 'yellow');
            console.log(status);
            
            const answer = require('readline').createInterface({
                input: process.stdin,
                output: process.stdout
            });
            
            return new Promise((resolve) => {
                answer.question(`${colors.yellow}Continuar mesmo assim? (y/N)${colors.reset} `, (response) => {
                    answer.close();
                    resolve(response.toLowerCase() === 'y');
                });
            });
        }
        return true;
    } catch (error) {
        // Ignora se não for repositório git
        return true;
    }
}

function checkDependencies() {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
    };
    
    let hasIssues = false;
    for (const [dep, version] of Object.entries(allDeps)) {
        if (version.startsWith('file:')) {
            log(`⚠️  Dependência local encontrada: ${dep} -> ${version}`, 'yellow');
            hasIssues = true;
        }
        if (version.startsWith('git:')) {
            log(`⚠️  Dependência git encontrada: ${dep} -> ${version}`, 'yellow');
            hasIssues = true;
        }
    }
    
    if (hasIssues) {
        log('\n⚠️  Recomendado substituir dependências locais/git por versões publicadas', 'yellow');
        const answer = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        return new Promise((resolve) => {
            answer.question(`${colors.yellow}Continuar mesmo assim? (y/N)${colors.reset} `, (response) => {
                answer.close();
                resolve(response.toLowerCase() === 'y');
            });
        });
    }
    
    log('✅ Dependências OK', 'green');
    return true;
}

async function main() {
    log('\n🔍 Verificando pré-publicação...\n', 'cyan');
    
    // Verifica Node.js
    checkNodeVersion();
    
    // Verifica autenticação NPM
    checkNpmLogin();
    
    // Verifica status do git
    const gitOk = await checkGitStatus();
    if (!gitOk) {
        log('Publicação cancelada', 'red');
        process.exit(1);
    }
    
    // Verifica dependências
    const depsOk = await checkDependencies();
    if (!depsOk) {
        log('Publicação cancelada', 'red');
        process.exit(1);
    }
    
    // Executa testes
    log('\n🧪 Executando testes...', 'cyan');
    try {
        execSync('npm test', { stdio: 'inherit' });
        log('✅ Testes passaram', 'green');
    } catch (error) {
        log('❌ Testes falharam', 'red');
        process.exit(1);
    }
    
    // Executa lint
    log('\n🔍 Executando lint...', 'cyan');
    try {
        execSync('npm run lint', { stdio: 'inherit' });
        log('✅ Lint passou', 'green');
    } catch (error) {
        log('⚠️  Lint falhou, mas continuando...', 'yellow');
    }
    
    log('\n✅ Verificações pré-publicação concluídas!\n', 'green');
}

main().catch((error) => {
    log(`\n❌ Erro: ${error.message}`, 'red');
    process.exit(1);
});