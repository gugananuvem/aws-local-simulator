const { toFunctionConfiguration, paginateFunctions } = require('./list-functions');

const entry = (name, extra = {}) => ({
  name,
  runtime: 'nodejs18.x',
  handlerName: 'index.handler',
  timeout: 3,
  memorySize: 128,
  codeSize: 10,
  registeredAt: '2025-01-01T00:00:00.000Z',
  ...extra,
});

const configs = (...names) => names.map((n) => toFunctionConfiguration(entry(n)));

describe('toFunctionConfiguration', () => {
  test('mapeia campos do registro para FunctionConfiguration', () => {
    expect(toFunctionConfiguration(entry('fn-a'))).toEqual({
      FunctionName: 'fn-a',
      FunctionArn: 'arn:aws:lambda:local:000000000000:function:fn-a',
      Runtime: 'nodejs18.x',
      Handler: 'index.handler',
      CodeSize: 10,
      Timeout: 3,
      MemorySize: 128,
      LastModified: '2025-01-01T00:00:00.000Z',
      Version: '$LATEST',
    });
  });

  test('campo ausente no registro é omitido, sem valor inventado', () => {
    const cfg = toFunctionConfiguration({ name: 'fn-b' });
    expect(cfg).not.toHaveProperty('Runtime');
    expect(cfg).not.toHaveProperty('Timeout');
    expect(cfg).toHaveProperty('FunctionName', 'fn-b');
    expect(cfg).toHaveProperty('Version', '$LATEST');
  });
});

describe('paginateFunctions', () => {
  const all = configs('a', 'b', 'c', 'd', 'e');

  test('sem Marker começa do início, com limite padrão de 50', () => {
    const page = paginateFunctions(all);
    expect(page.Functions.map((f) => f.FunctionName)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(page).not.toHaveProperty('NextMarker');
  });

  test('MaxItems limita a página e devolve NextMarker com o último nome', () => {
    const page = paginateFunctions(all, { MaxItems: '2' });
    expect(page.Functions.map((f) => f.FunctionName)).toEqual(['a', 'b']);
    expect(page.NextMarker).toBe('b');
  });

  test('Marker devolve a página seguinte e NextMarker some na última página', () => {
    const second = paginateFunctions(all, { MaxItems: '2', Marker: 'b' });
    expect(second.Functions.map((f) => f.FunctionName)).toEqual(['c', 'd']);
    expect(second.NextMarker).toBe('d');
    const last = paginateFunctions(all, { MaxItems: '2', Marker: 'd' });
    expect(last.Functions.map((f) => f.FunctionName)).toEqual(['e']);
    expect(last).not.toHaveProperty('NextMarker');
  });

  test('Marker desconhecido não é erro: começa no primeiro nome maior', () => {
    const page = paginateFunctions(all, { Marker: 'bb' });
    expect(page.Functions.map((f) => f.FunctionName)).toEqual(['c', 'd', 'e']);
  });

  test('Marker depois do último nome devolve lista vazia', () => {
    expect(paginateFunctions(all, { Marker: 'z' })).toEqual({ Functions: [] });
  });

  test.each([
    ['0', 0],
    ['10001', 10001],
    ['abc', 'abc'],
    ['1.5', '1.5'],
  ])('MaxItems inválido (%s) lança erro 400', (_label, value) => {
    let error;
    try {
      paginateFunctions(all, { MaxItems: value });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.statusCode).toBe(400);
  });
});
