'use strict';

const { successXml, errorXml, NS, NS_VERSION } = require('./query-response');

describe('respostas XML do protocolo query', () => {
  test('gera envelope de sucesso com namespace da versão informada', () => {
    const xml = successXml('DescribeDBClusters', {
      DBClusters: [{ DBClusterIdentifier: 'sqlsrv-demo', Port: 1433 }, { DBClusterIdentifier: 'sqlsrv-2' }],
      StorageEncrypted: false,
      Vazio: undefined,
    }, '2014-10-31');

    expect(xml).toContain('<DescribeDBClustersResponse');
    expect(xml).toContain('xmlns="http://rds.amazonaws.com/doc/2014-10-31/"');
    expect(xml).toContain('<DBClusterIdentifier>sqlsrv-demo</DBClusterIdentifier>');
    expect(xml).toContain('<DBClusters>');
    expect(xml).not.toContain('Vazio');
    expect(xml).toContain('<ResponseMetadata><RequestId>');
  });

  test('serializa objetos aninhados, arrays de escalares e valores nulos', () => {
    const xml = successXml('DescribeDBInstances', {
      Marker: null,
      DBInstances: ['a', 'b', null],
      Endpoint: { Address: 'localhost', Port: 1433 },
    });

    expect(xml).toContain('<DBInstance>a</DBInstance>');
    expect(xml).toContain('<DBInstance/>');
    expect(xml).toContain('<Address>localhost</Address>');
    expect(xml).not.toContain('Marker');
    expect(xml).not.toContain('undefined');
  });

  test('usa o namespace padrão quando a versão é vazia', () => {
    expect(successXml('DeleteDBCluster', {}, '')).toContain(`http://rds.amazonaws.com/doc/${NS_VERSION}/`);
    expect(NS).toBe(`http://rds.amazonaws.com/doc/${NS_VERSION}/`);
  });

  test('gera envelope de erro com código e mensagem padrão', () => {
    const xml = errorXml('DBClusterNotFoundFault', 'Cluster não encontrado');

    expect(xml).toContain('<Type>Sender</Type>');
    expect(xml).toContain('<Code>DBClusterNotFoundFault</Code>');
    expect(xml).toContain('<Message>Cluster não encontrado</Message>');
    expect(xml).toContain('<RequestId>');

    const fallback = errorXml();
    expect(fallback).toContain('<Code>BadRequestException</Code>');
    expect(fallback).toContain('<Message>Erro na requisição</Message>');
  });
});
