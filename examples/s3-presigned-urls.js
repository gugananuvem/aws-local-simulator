/**
 * S3 Presigned URLs Examples
 * 
 * Exemplos de uso de presigned URLs com o AWS Local Simulator
 * Presigned URLs permitem acesso temporário a objetos S3 sem compartilhar credenciais
 */

const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const fetch = require("node-fetch");
const fs = require("fs");

// ─── Configuração ──────────────────────────────────────────────────────────

const s3Client = new S3Client({
  endpoint: "http://localhost:4566",
  region: "us-east-1",
  credentials: {
    accessKeyId: "testing",
    secretAccessKey: "testing"
  }
});

const adminBaseUrl = "http://localhost:4566/__admin/presigned-urls";

// ─── Exemplo 1: Gerar Presigned URL para Download via Admin API ────────────

async function example1_AdminGetUrl() {
  console.log("\n📥 Exemplo 1: Gerar Presigned URL para Download (Admin API)");
  console.log("━".repeat(70));

  try {
    const response = await fetch(`${adminBaseUrl}/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket: "my-bucket",
        key: "documents/report.pdf",
        expiresIn: 3600 // 1 hora
      })
    });

    const result = await response.json();
    console.log("✅ Presigned URL gerada:");
    console.log("   URL:", result.presignedUrl.substring(0, 80) + "...");
    console.log("   Expira em:", result.expiresAt);
    console.log("   Tempo de expiração:", result.expiresIn, "segundos");

    return result.presignedUrl;
  } catch (error) {
    console.error("❌ Erro:", error.message);
  }
}

// ─── Exemplo 2: Gerar Presigned URL para Upload via Admin API ──────────────

async function example2_AdminPutUrl() {
  console.log("\n📤 Exemplo 2: Gerar Presigned URL para Upload (Admin API)");
  console.log("━".repeat(70));

  try {
    const response = await fetch(`${adminBaseUrl}/put`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket: "my-bucket",
        key: "uploads/user-avatar.jpg",
        contentType: "image/jpeg",
        expiresIn: 1800 // 30 minutos
      })
    });

    const result = await response.json();
    console.log("✅ Presigned URL para upload gerada:");
    console.log("   URL:", result.presignedUrl.substring(0, 80) + "...");
    console.log("   Content-Type:", "image/jpeg");
    console.log("   Expira em:", result.expiresAt);

    return result.presignedUrl;
  } catch (error) {
    console.error("❌ Erro:", error.message);
  }
}

// ─── Exemplo 3: Upload usando Presigned URL ────────────────────────────────

async function example3_UploadWithPresignedUrl(presignedUrl) {
  console.log("\n📤 Exemplo 3: Fazer Upload com Presigned URL");
  console.log("━".repeat(70));

  try {
    // Simular arquivo (em produção seria um arquivo real)
    const fileContent = Buffer.from("Este é um arquivo de teste para upload com presigned URL");

    const response = await fetch(presignedUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": fileContent.length
      },
      body: fileContent
    });

    if (response.ok) {
      console.log("✅ Arquivo enviado com sucesso!");
      console.log("   Status:", response.status);
    } else {
      console.log("❌ Erro no upload:", response.status, response.statusText);
    }
  } catch (error) {
    console.error("❌ Erro:", error.message);
  }
}

// ─── Exemplo 4: Gerar Presigned URL para Deletar ────────────────────────────

async function example4_AdminDeleteUrl() {
  console.log("\n🗑️ Exemplo 4: Gerar Presigned URL para Deletar (Admin API)");
  console.log("━".repeat(70));

  try {
    const response = await fetch(`${adminBaseUrl}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket: "my-bucket",
        key: "temp/old-file.txt",
        expiresIn: 300 // 5 minutos
      })
    });

    const result = await response.json();
    console.log("✅ Presigned URL para deletar gerada:");
    console.log("   URL:", result.presignedUrl.substring(0, 80) + "...");
    console.log("   Expira em:", result.expiresAt);
    console.log("   ⚠️  Cuidado: qualquer pessoa com essa URL pode deletar o arquivo!");

    return result.presignedUrl;
  } catch (error) {
    console.error("❌ Erro:", error.message);
  }
}

// ─── Exemplo 5: Usar AWS SDK para Gerar Presigned URL ──────────────────────

async function example5_SDKGetUrl() {
  console.log("\n📥 Exemplo 5: Gerar Presigned URL com AWS SDK (GET)");
  console.log("━".repeat(70));

  try {
    const command = new GetObjectCommand({
      Bucket: "my-bucket",
      Key: "documents/report.pdf"
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600
    });

    console.log("✅ Presigned URL gerada com SDK:");
    console.log("   URL:", presignedUrl.substring(0, 80) + "...");
    console.log("   Método:", "GET");
    console.log("   Tempo de expiração: 3600 segundos");

    return presignedUrl;
  } catch (error) {
    console.error("❌ Erro:", error.message);
  }
}

// ─── Exemplo 6: Usar AWS SDK para Gerar Presigned URL de Upload ────────────

async function example6_SDKPutUrl() {
  console.log("\n📤 Exemplo 6: Gerar Presigned URL com AWS SDK (PUT)");
  console.log("━".repeat(70));

  try {
    const command = new PutObjectCommand({
      Bucket: "my-bucket",
      Key: "uploads/direct-upload.bin",
      ContentType: "application/octet-stream"
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 1800
    });

    console.log("✅ Presigned URL para upload gerada com SDK:");
    console.log("   URL:", presignedUrl.substring(0, 80) + "...");
    console.log("   Método:", "PUT");
    console.log("   Content-Type: application/octet-stream");
    console.log("   Tempo de expiração: 1800 segundos");

    return presignedUrl;
  } catch (error) {
    console.error("❌ Erro:", error.message);
  }
}

// ─── Exemplo 7: Usar AWS SDK para Gerar Presigned URL de Delete ────────────

async function example7_SDKDeleteUrl() {
  console.log("\n🗑️  Exemplo 7: Gerar Presigned URL com AWS SDK (DELETE)");
  console.log("━".repeat(70));

  try {
    const command = new DeleteObjectCommand({
      Bucket: "my-bucket",
      Key: "temp/file-to-delete.txt"
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 300
    });

    console.log("✅ Presigned URL para delete gerada com SDK:");
    console.log("   URL:", presignedUrl.substring(0, 80) + "...");
    console.log("   Método:", "DELETE");
    console.log("   Tempo de expiração: 300 segundos");

    return presignedUrl;
  } catch (error) {
    console.error("❌ Erro:", error.message);
  }
}

// ─── Exemplo 8: Gerar Presigned POST Policy para Upload via Formulário ─────

async function example8_PostPolicy() {
  console.log("\n📋 Exemplo 8: Gerar Presigned POST Policy (Upload via Formulário)");
  console.log("━".repeat(70));

  try {
    const response = await fetch(`${adminBaseUrl}/post-policy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket: "my-bucket",
        key: "form-uploads/user-data-${date}.json",
        expiresIn: 3600,
        conditions: [
          ["content-length-range", 0, 10485760], // 0 a 10 MB
          ["starts-with", "$Content-Type", "application/"]
        ]
      })
    });

    const result = await response.json();
    console.log("✅ POST Policy gerada:");
    console.log("   Policy (base64):", result.policy.substring(0, 50) + "...");
    console.log("   Signature:", result.signature.substring(0, 50) + "...");
    console.log("   Algorithm:", result.amzAlgorithm);
    console.log("   Date:", result.amzDate);
    console.log("   Credential:", result.amzCredential.substring(0, 50) + "...");
    console.log("\n   ℹ️  Use esses dados em um formulário HTML para upload direto");

    return result;
  } catch (error) {
    console.error("❌ Erro:", error.message);
  }
}

// ─── Exemplo 9: Validar Presigned URL ──────────────────────────────────────

async function example9_ValidateUrl(presignedUrl) {
  console.log("\n✅ Exemplo 9: Validar Presigned URL");
  console.log("━".repeat(70));

  try {
    const response = await fetch(`${adminBaseUrl}/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: presignedUrl,
        method: "GET"
      })
    });

    const result = await response.json();
    console.log("✅ Validação concluída:");
    console.log("   Válida:", result.valid);
    if (result.valid) {
      console.log("   Expira em:", result.expiresAt);
      console.log("   Tempo restante:", result.remainingSeconds, "segundos");
    } else {
      console.log("   Motivo:", result.message);
    }

    return result;
  } catch (error) {
    console.error("❌ Erro:", error.message);
  }
}

// ─── Exemplo 10: Usar Presigned URL para Download ───────────────────────────

async function example10_DownloadWithPresignedUrl(presignedUrl) {
  console.log("\n📥 Exemplo 10: Fazer Download com Presigned URL");
  console.log("━".repeat(70));

  try {
    const response = await fetch(presignedUrl);

    if (response.ok) {
      const content = await response.buffer();
      console.log("✅ Arquivo baixado com sucesso!");
      console.log("   Tamanho:", content.length, "bytes");
      console.log("   Content-Type:", response.headers.get("content-type"));
      console.log("   ETag:", response.headers.get("etag"));
    } else {
      console.log("❌ Erro no download:", response.status, response.statusText);
    }
  } catch (error) {
    console.error("❌ Erro:", error.message);
  }
}

// ─── Exemplo 11: Presigned URL com Expiração Curta (para segurança) ────────

async function example11_ShortExpirationUrl() {
  console.log("\n⏰ Exemplo 11: Presigned URL com Expiração Curta (Segurança)");
  console.log("━".repeat(70));

  try {
    const response = await fetch(`${adminBaseUrl}/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket: "my-bucket",
        key: "sensitive/confidential-data.txt",
        expiresIn: 60 // Apenas 1 minuto!
      })
    });

    const result = await response.json();
    console.log("✅ Presigned URL com expiração curta gerada:");
    console.log("   URL:", result.presignedUrl.substring(0, 80) + "...");
    console.log("   ⏰ Tempo de expiração: 60 segundos (1 minuto)");
    console.log("   🔒 Ideal para links sensíveis que não devem ser reutilizados");
    console.log("   Expira em:", result.expiresAt);

    return result.presignedUrl;
  } catch (error) {
    console.error("❌ Erro:", error.message);
  }
}

// ─── Exemplo 12: Caso de Uso Real - Frontend Upload ────────────────────────

async function example12_RealWorldFrontendUpload() {
  console.log("\n🌐 Exemplo 12: Caso de Uso Real - Frontend Upload");
  console.log("━".repeat(70));

  try {
    // Passo 1: Backend gera presigned URL
    console.log("\n  [1] Backend gera presigned URL para o frontend");
    const response = await fetch(`${adminBaseUrl}/put`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket: "my-bucket",
        key: `user-uploads/${Date.now()}-document.pdf`,
        contentType: "application/pdf",
        expiresIn: 900 // 15 minutos
      })
    });

    const urlResult = await response.json();
    console.log("     ✅ URL gerada (compartilhada com frontend)");

    // Passo 2: Frontend recebe URL e faz upload
    console.log("\n  [2] Frontend recebe URL e faz upload do arquivo");
    console.log("     📝 JavaScript no navegador:");
    console.log(`
    const fileInput = document.getElementById('file');
    const presignedUrl = '${urlResult.presignedUrl.substring(0, 60)}...';
    
    const file = fileInput.files[0];
    const response = await fetch(presignedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: file
    });
    
    if (response.ok) {
      console.log('✅ Arquivo enviado ao S3 diretamente!');
    }
    `);

    console.log("     ℹ️  Não precisa passar pelo seu servidor!");
    console.log("     🔒 Seguro: credenciais não são expostas no frontend");
    console.log("     ⚡ Rápido: upload direto para S3");

  } catch (error) {
    console.error("❌ Erro:", error.message);
  }
}

// ─── Executar Todos os Exemplos ────────────────────────────────────────────

async function runAllExamples() {
  console.log("\n" + "═".repeat(70));
  console.log("  🚀 S3 PRESIGNED URLS - EXEMPLOS COMPLETOS");
  console.log("═".repeat(70));

  try {
    // Admin API Examples
    const getUrl = await example1_AdminGetUrl();
    const putUrl = await example2_AdminPutUrl();
    await example3_UploadWithPresignedUrl(putUrl);
    const deleteUrl = await example4_AdminDeleteUrl();

    // SDK Examples
    const sdkGetUrl = await example5_SDKGetUrl();
    const sdkPutUrl = await example6_SDKPutUrl();
    const sdkDeleteUrl = await example7_SDKDeleteUrl();

    // POST Policy Example
    await example8_PostPolicy();

    // Validation Example
    if (getUrl) {
      await example9_ValidateUrl(getUrl);
    }

    // Download Example
    if (getUrl) {
      await example10_DownloadWithPresignedUrl(getUrl);
    }

    // Security Example
    await example11_ShortExpirationUrl();

    // Real-world Example
    await example12_RealWorldFrontendUpload();

    console.log("\n" + "═".repeat(70));
    console.log("  ✅ TODOS OS EXEMPLOS CONCLUÍDOS COM SUCESSO!");
    console.log("═".repeat(70));
    console.log("\n📚 Próximos passos:");
    console.log("   1. Integre presigned URLs em sua aplicação");
    console.log("   2. Use expiração apropriada para segurança");
    console.log("   3. Monitore uploads via CloudWatch/CloudTrail");
    console.log("   4. Implemente validação no backend para segurança extra\n");

  } catch (error) {
    console.error("❌ Erro ao executar exemplos:", error);
  }
}

// ─── Exportar para uso como módulo ─────────────────────────────────────────

module.exports = {
  example1_AdminGetUrl,
  example2_AdminPutUrl,
  example3_UploadWithPresignedUrl,
  example4_AdminDeleteUrl,
  example5_SDKGetUrl,
  example6_SDKPutUrl,
  example7_SDKDeleteUrl,
  example8_PostPolicy,
  example9_ValidateUrl,
  example10_DownloadWithPresignedUrl,
  example11_ShortExpirationUrl,
  example12_RealWorldFrontendUpload,
  runAllExamples
};

// ─── Executar se chamado diretamente ───────────────────────────────────────

if (require.main === module) {
  runAllExamples().catch(console.error);
}
