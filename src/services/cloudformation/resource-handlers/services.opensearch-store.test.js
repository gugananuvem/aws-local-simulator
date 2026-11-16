const fs = require('fs');
const os = require('os');
const path = require('path');
const LocalStore = require('../../../utils/local-store');
const { OpenSearchDomains } = require('../../opensearch/domains');
const domain = require('./services')['AWS::OpenSearchService::Domain'];

const env = { region: 'us-east-1', account: '000000000000', partition: 'aws' };

describe('AWS::OpenSearchService::Domain grava no store de domínios', () => {
  let dir;
  let sims;

  const loadStores = () => {
    const domains = new OpenSearchDomains(new LocalStore(dir));
    domains.load();
    return { opensearch: { domains } };
  };

  const createCfn = (props = {}, simsArg = sims) => domain.create({
    logicalId: 'Dom',
    stackName: 'st',
    props: { DomainName: 'dom-a', ...props },
    env,
    sims: simsArg,
  });

  const deleteCfn = (physicalId, simsArg = sims) => domain.delete({ physicalId, sims: simsArg });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfn-os-store-'));
    sims = loadStores();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('CloudFormation grava o domínio no store e persiste em disco', async () => {
    const result = await createCfn();

    const status = sims.opensearch.domains.describeDomain('dom-a');
    expect(result.physicalId).toBe('dom-a');
    expect(result.attrs.Arn).toBe(status.ARN);
    expect(result.attrs.DomainArn).toBe(status.ARN);
    expect(result.attrs.DomainName).toBe('dom-a');

    const reloaded = loadStores();
    expect(reloaded.opensearch.domains.describeDomain('dom-a').ARN).toBe(status.ARN);
  });

  test('lista o domínio e lê as tags gravadas pelo CloudFormation', async () => {
    const result = await createCfn({ Tags: [{ Key: 'env', Value: 'test' }] });

    expect(sims.opensearch.domains.listDomainNames()).toEqual([{ DomainName: 'dom-a', EngineType: 'OpenSearch' }]);
    expect(sims.opensearch.domains.listTags(result.attrs.Arn)).toEqual([{ Key: 'env', Value: 'test' }]);
  });

  test('excluir o recurso remove o domínio e as tags do store', async () => {
    const result = await createCfn({ Tags: [{ Key: 'env', Value: 'test' }] });

    await deleteCfn('dom-a');

    let caught;
    try {
      sims.opensearch.domains.describeDomain('dom-a');
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({ code: 'ResourceNotFoundException' });
    expect(loadStores().opensearch.domains.tags.has(result.attrs.Arn)).toBe(false);
  });

  test('excluir um domínio ausente lança erro "not found" para o provisioner tratar', async () => {
    await expect(deleteCfn('missing')).rejects.toThrow(/not found/);
  });

  test('convive com um domínio criado por CreateDomain', async () => {
    sims.opensearch.domains.createDomain({ DomainName: 'cli-dom' });
    const cliBefore = sims.opensearch.domains.describeDomain('cli-dom');

    await createCfn({ DomainName: 'cfn-dom' });
    expect(sims.opensearch.domains.listDomainNames().map((d) => d.DomainName).sort()).toEqual(['cfn-dom', 'cli-dom']);

    await expect(createCfn({ DomainName: 'cli-dom' })).rejects.toMatchObject({ code: 'ResourceAlreadyExistsException' });
    expect(sims.opensearch.domains.describeDomain('cli-dom')).toEqual(cliBefore);

    await deleteCfn('cfn-dom');
    expect(sims.opensearch.domains.describeDomain('cli-dom')).toEqual(cliBefore);
  });

  test('sem serviço OpenSearch nas sims, mantém o resultado sem gravar', async () => {
    const result = await createCfn({}, {});

    expect(result.attrs.DomainName).toBe('dom-a');
    await expect(deleteCfn('dom-a', {})).resolves.toBeUndefined();
  });

  test('Value numérico ou booleano do template vira string na tag', async () => {
    const result = await createCfn({ Tags: [{ Key: 'a', Value: 1 }, { Key: 'b', Value: true }] });

    expect(sims.opensearch.domains.listTags(result.attrs.Arn)).toEqual([
      { Key: 'a', Value: '1' },
      { Key: 'b', Value: 'true' },
    ]);
  });

  test('tag sem Key faz create falhar e não deixa domínio órfão no store', async () => {
    await expect(createCfn({ Tags: [{ Value: 'x' }] })).rejects.toThrow(/Key and a string Value/);

    expect(sims.opensearch.domains.listDomainNames()).toEqual([]);
  });
});
