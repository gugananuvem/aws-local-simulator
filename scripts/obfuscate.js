#!/usr/bin/env node

/**
 * Script de Obfuscação para AWS Local Simulator
 * Ofusca o código fonte antes da publicação
 */

const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');
const { rimrafSync } = require('rimraf');
const mkdirp = require('mkdirp');

// Configuração do obfuscator - REMOVENDO optionsPreset
const obfuscatorConfig = {
    compact: true,
    controlFlowFlattening: false, // Desabilitado para evitar problemas
    deadCodeInjection: false,
    debugProtection: false,
    debugProtectionInterval: false,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'hexadecimal',
    identifiersPrefix: '',
    inputFileName: '',
    log: false,
    numbersToExpressions: false,
    renameGlobals: false,
    renameProperties: false,
    renamePropertiesMode: 'safe',
    reservedNames: [],
    reservedStrings: [],
    seed: 0,
    selfDefending: false, // Desabilitado para evitar problemas
    simplify: true,
    sourceMap: false,
    sourceMapBaseUrl: '',
    sourceMapFileName: '',
    sourceMapMode: 'separate',
    splitStrings: false,
    stringArray: true,
    stringArrayCallsTransform: false,
    stringArrayCallsTransformThreshold: 0.5,
    stringArrayEncoding: [],
    stringArrayIndexesType: ['hexadecimal-number'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 1,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersParametersMaxCount: 2,
    stringArrayWrappersType: 'function',
    stringArrayThreshold: 0.75,
    target: 'node',
    transformObjectKeys: false,
    unicodeEscapeSequence: false
};

// Diretórios para ofuscar
const dirsToObfuscate = [
    'src',
    'bin'
];

// Arquivos para preservar (não ofuscar)
const preserveFiles = [
    'src/templates/aws-config-template.js',
    'src/templates/aws-config-template.mjs',
    'src/templates/config-template.json'
];

// Extensões para ofuscar
const extensionsToObfuscate = ['.js', '.mjs', '.cjs'];

class Obfuscator {
    constructor() {
        this.buildDir = path.join(process.cwd(), 'dist');
        this.srcDir = path.join(process.cwd(), 'src');
        this.binDir = path.join(process.cwd(), 'bin');
    }

    async obfuscate() {
        console.log('🔒 Iniciando processo de ofuscação...\n');

        // Limpa diretório de build
        await this.cleanBuildDir();
        
        // Cria diretório de build
        await this.createBuildDir();
        
        // Copia arquivos de configuração e templates
        await this.copyConfigFiles();
        
        // Ofusca os diretórios
        for (const dir of dirsToObfuscate) {
            await this.obfuscateDirectory(dir);
        }
        
        // Copia package.json e README
        await this.copyRootFiles();
        
        console.log('\n✅ Obfuscação concluída com sucesso!');
        console.log(`📦 Arquivos ofuscados em: ${this.buildDir}`);
    }

    async cleanBuildDir() {
        if (fs.existsSync(this.buildDir)) {
            console.log('🧹 Limpando diretório de build...');
            rimrafSync(this.buildDir);
        }
    }

    async createBuildDir() {
        console.log('📁 Criando diretório de build...');
        mkdirp.sync(this.buildDir);
        mkdirp.sync(path.join(this.buildDir, 'src'));
        mkdirp.sync(path.join(this.buildDir, 'bin'));
        mkdirp.sync(path.join(this.buildDir, 'src/templates'));
    }

    async copyConfigFiles() {
        console.log('📋 Copiando arquivos de configuração...');
        
        // Copia templates
        const templatesDir = path.join(process.cwd(), 'src', 'templates');
        const templatesDestDir = path.join(this.buildDir, 'src', 'templates');
        
        if (fs.existsSync(templatesDir)) {
            mkdirp.sync(templatesDestDir);
            const files = fs.readdirSync(templatesDir);
            for (const file of files) {
                const srcPath = path.join(templatesDir, file);
                const destPath = path.join(templatesDestDir, file);
                fs.copyFileSync(srcPath, destPath);
                console.log(`   ✅ Copiado: src/templates/${file}`);
            }
        }
        
        // Copia arquivos que devem ser preservados
        for (const file of preserveFiles) {
            const srcPath = path.join(process.cwd(), file);
            const destPath = path.join(this.buildDir, file);
            if (fs.existsSync(srcPath)) {
                const destDir = path.dirname(destPath);
                mkdirp.sync(destDir);
                fs.copyFileSync(srcPath, destPath);
                console.log(`   ✅ Preservado: ${file}`);
            }
        }
    }

    async obfuscateDirectory(dirName) {
        const sourceDir = path.join(process.cwd(), dirName);
        const targetDir = path.join(this.buildDir, dirName);
        
        if (!fs.existsSync(sourceDir)) {
            console.log(`⚠️ Diretório não encontrado: ${sourceDir}`);
            return;
        }
        
        console.log(`\n🔧 Ofuscando diretório: ${dirName}/`);
        
        const files = this.getAllFiles(sourceDir);
        
        for (const file of files) {
            const relativePath = path.relative(sourceDir, file);
            const targetPath = path.join(targetDir, relativePath);
            
            // Verifica se deve preservar este arquivo
            const fullRelativePath = path.join(dirName, relativePath);
            if (preserveFiles.includes(fullRelativePath)) {
                console.log(`   ⏭️  Pulando (preservado): ${relativePath}`);
                continue;
            }
            
            const ext = path.extname(file);
            if (extensionsToObfuscate.includes(ext)) {
                await this.obfuscateFile(file, targetPath);
            } else {
                // Copia arquivos não-JS
                mkdirp.sync(path.dirname(targetPath));
                fs.copyFileSync(file, targetPath);
                console.log(`   📄 Copiado: ${relativePath}`);
            }
        }
    }

    async obfuscateFile(inputPath, outputPath) {
        try {
            const code = fs.readFileSync(inputPath, 'utf8');
            
            // Configuração simplificada para evitar erros
            const config = {
                ...obfuscatorConfig,
                ...(inputPath.includes('bin/') && {
                    disableConsoleOutput: false,
                    selfDefending: false
                })
            };
            
            // Aplica obfuscation
            const obfuscated = JavaScriptObfuscator.obfuscate(code, config);
            
            // Cria diretório de destino
            mkdirp.sync(path.dirname(outputPath));
            
            // Salva arquivo ofuscado
            fs.writeFileSync(outputPath, obfuscated.getObfuscatedCode(), 'utf8');
            
            const relativePath = path.relative(this.buildDir, outputPath);
            console.log(`   ✅ Ofuscado: ${relativePath}`);
            
        } catch (error) {
            console.error(`   ❌ Erro ao ofuscar ${path.basename(inputPath)}: ${error.message}`);
            // Em caso de erro, copia o arquivo original
            mkdirp.sync(path.dirname(outputPath));
            fs.copyFileSync(inputPath, outputPath);
            console.log(`   📄 Copiado original: ${path.relative(this.buildDir, outputPath)}`);
        }
    }

    getAllFiles(dir, fileList = []) {
        const files = fs.readdirSync(dir);
        
        for (const file of files) {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            
            if (stat.isDirectory()) {
                // Pula diretório templates para não ofuscar
                if (file === 'templates') {
                    continue;
                }
                this.getAllFiles(filePath, fileList);
            } else {
                fileList.push(filePath);
            }
        }
        
        return fileList;
    }

    async copyRootFiles() {
        console.log('\n📋 Copiando arquivos da raiz...');
        
        const rootFiles = [
            'package.json',
            'README.md',
            'LICENSE',
            'CHANGELOG.md'
        ];
        
        for (const file of rootFiles) {
            const srcPath = path.join(process.cwd(), file);
            const destPath = path.join(this.buildDir, file);
            if (fs.existsSync(srcPath)) {
                fs.copyFileSync(srcPath, destPath);
                console.log(`   ✅ Copiado: ${file}`);
            }
        }
        
        // Atualiza o package.json para apontar para os arquivos ofuscados
        await this.updatePackageJson();
    }

    async updatePackageJson() {
        const packageJsonPath = path.join(this.buildDir, 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        
        // Atualiza paths para apontar para os arquivos ofuscados
        packageJson.main = 'src/index.js';
        if (packageJson.bin) {
            packageJson.bin = {
                'aws-local-simulator': 'bin/aws-local-simulator.js'
            };
        }
        
        // Remove scripts de desenvolvimento
        delete packageJson.scripts;
        
        // Adiciona script básico
        packageJson.scripts = {
            "start": "node bin/aws-local-simulator.js start"
        };
        
        // Remove devDependencies
        delete packageJson.devDependencies;
        
        // Adiciona metadados sobre ofuscação
        packageJson.obfuscated = true;
        packageJson.obfuscatedAt = new Date().toISOString();
        
        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
        console.log('   ✅ Package.json atualizado');
    }
}

// Executa obfuscation
const obfuscator = new Obfuscator();
obfuscator.obfuscate().catch(console.error);