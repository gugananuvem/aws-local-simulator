/**
 * Regra de virtual-hosted style do S3: o primeiro rotulo do Host e o bucket
 * (ex.: Host "bucket.localhost:4700"). Usada pelo servidor S3 (reescrita do caminho)
 * e pela autorizacao (IAM), para que as duas leiam o mesmo bucket.
 *
 * Host sem ponto, que comeca com localhost/127.0.0.1, ou que e um IPv4 literal
 * (ex.: 192.168.0.10:4700) nao tem bucket. Nenhuma exclusao extra (ex.: s3.amazonaws.com)
 * e aplicada aqui; ver pontos em aberto do plano.
 */
const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * @returns {string|null} rotulo do Host usado como bucket, ou null quando o Host nao e virtual-hosted.
 */
function bucketFromHost(hostHeader) {
  const host = String(hostHeader || '');
  if (!host.includes('.')) return null;
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) return null;
  const hostname = host.replace(/:\d+$/, '');
  if (IPV4_LITERAL.test(hostname)) return null;
  const parts = host.split('.');
  if (parts.length < 2) return null;
  const bucket = parts[0];
  if (!bucket || bucket === 'localhost') return null;
  return bucket;
}

/**
 * Bucket de virtual-hosted, somente quando o rotulo do Host e um bucket existente.
 * Assim um Host que nao e bucket (ex.: IP) nunca desvia requisicoes path-style.
 *
 * @param {string} hostHeader
 * @param {(name: string) => boolean} bucketExists
 * @returns {string|null}
 */
function virtualHostBucket(hostHeader, bucketExists = () => false) {
  const bucket = bucketFromHost(hostHeader);
  if (!bucket) return null;
  return bucketExists(bucket) ? bucket : null;
}

module.exports = { bucketFromHost, virtualHostBucket };
