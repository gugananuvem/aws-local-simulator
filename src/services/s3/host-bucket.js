/**
 * Regra de virtual-hosted style do S3: o primeiro rotulo do Host e o bucket
 * (ex.: Host "bucket.localhost:4700"). Usada pelo servidor S3 (reescrita do caminho)
 * e pela autorizacao (IAM), para que as duas leiam o mesmo bucket.
 *
 * Mesmo comportamento que o servidor S3 tinha antes: Host sem ponto, ou que comeca com
 * localhost/127.0.0.1, nao tem bucket. Nenhuma exclusao extra (ex.: s3.amazonaws.com) e
 * aplicada aqui; ver pontos em aberto do plano.
 *
 * @returns {string|null} nome do bucket, ou null quando o Host nao e virtual-hosted.
 */
function bucketFromHost(hostHeader) {
  const host = String(hostHeader || '');
  if (!host.includes('.')) return null;
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) return null;
  const parts = host.split('.');
  if (parts.length < 2) return null;
  const bucket = parts[0];
  if (!bucket || bucket === 'localhost') return null;
  return bucket;
}

module.exports = { bucketFromHost };
