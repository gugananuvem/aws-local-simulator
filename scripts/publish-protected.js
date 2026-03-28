#!/usr/bin/env node

/**
 * Script de publicação com ofuscação
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    reset: '\x1b[0m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

async function confirm(message) {
    return new Promise((resolve) => {
        rl.question(`${colors.yellow}${message} (y/N)${colors.reset} `, (answer) => {
            resolve(answer.toLowerCase() === 'y');
        });
    });
}

async function publish() {
    log('\n🔒 Publicação Protegida do AWS Local Simulator', 'cyan');
    log('============================================\n', 'cyan');

    // Verifica se está logado no NPM
    try {
        execSync('npm whoami', { stdio: 'pipe' });
        log('✅ Autenticado no NPM', 'green');
    } catch (error) {
        log('❌ Não autenticado no NPM. Execute "npm login" primeiro.', 'red');
        process.exit(1);
    }

    // Verifica versão
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    log(`\n📦 Versão atual: ${packageJson.version}`, 'yellow');

    const versionType = await new Promise((resolve) => {
        rl.question('\nTipo de versão:\n1) patch (bug fixes)\n2) minor (new features)\n3) major (breaking changes)\n4) manter versão\nEscolha (1-4): ', (answer) => {
            resolve(answer);
        });
    });

    if (versionType !== '4') {
        let newVersion;
        const [major, minor, patch] = packageJson.version.split('.').map(Number);
        
        switch (versionType) {
            case '1':
                newVersion = `${major}.${minor}.${patch + 1}`;
                break;
            case '2':
                newVersion = `${major}.${minor + 1}.0`;
                break;
            case '3':
                newVersion = `${major + 1}.0.0`;
                break;
            default:
                newVersion = packageJson.version;
        }
        
        log(`\n📝 Nova versão: ${newVersion}`, 'yellow');
        
        const confirmed = await confirm('Confirmar atualização de versão?');
        if (!confirmed) {
            log('Publicação cancelada', 'red');
            process.exit(0);
        }
        
        // Atualiza package.json
        packageJson.version = newVersion;
        fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2));
        log('✅ Versão atualizada', 'green');
    }

    // Verifica se há mudanças no git
    try {
        const status = execSync('git status --porcelain', { encoding: 'utf8' });
        if (status.trim()) {
            log('\n⚠️  Há mudanças não commitadas:', 'yellow');
            console.log(status);
            
            const confirmed = await confirm('\nContinuar mesmo assim?');
            if (!confirmed) {
                log('Publicação cancelada', 'red');
                process.exit(0);
            }
        }
    } catch (error) {
        // Ignora se não for um repositório git
    }

    // Confirma publicação
    log('\n⚠️  AVISO: O código será ofuscado antes da publicação!', 'yellow');
    log('   Isso torna o código mais difícil de ler/entender.', 'yellow');
    log('   Os templates e configurações permanecem legíveis.\n', 'yellow');
    
    const confirmed = await confirm('Confirmar publicação?');
    if (!confirmed) {
        log('Publicação cancelada', 'red');
        process.exit(0);
    }

    // Executa build (ofuscação)
    log('\n🔧 Executando build com ofuscação...', 'cyan');
    try {
        execSync('npm run build', { stdio: 'inherit' });
        log('✅ Build concluído', 'green');
    } catch (error) {
        log('❌ Erro durante o build', 'red');
        process.exit(1);
    }

    // Publica
    log('\n📤 Publicando no NPM...', 'cyan');
    try {
        execSync('npm publish dist/ --access public', { stdio: 'inherit' });
        log('\n✅ Publicado com sucesso!', 'green');
        log(`📦 Versão: ${packageJson.version}`, 'green');
        log(`🔒 Código ofuscado: Sim`, 'green');
    } catch (error) {
        log('❌ Erro durante a publicação', 'red');
        process.exit(1);
    }

    // Cria tag no git
    try {
        const tag = `v${packageJson.version}`;
        execSync(`git tag ${tag}`, { stdio: 'pipe' });
        execSync(`git push origin ${tag}`, { stdio: 'pipe' });
        log(`✅ Tag criada: ${tag}`, 'green');
    } catch (error) {
        // Ignora erros de git
    }

    rl.close();
}

// Executa publicação
publish().catch((error) => {
    log(`\n❌ Erro: ${error.message}`, 'red');
    process.exit(1);
});