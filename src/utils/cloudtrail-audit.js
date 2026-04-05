'use strict';

/**
 * CloudTrail Audit Helper
 *
 * Utilitário para registrar eventos de API nos simuladores.
 * Cada simulador recebe uma instância via injectDependencies.
 *
 * Uso:
 *   this.audit = new CloudTrailAudit('s3.amazonaws.com');
 *   // após injeção:
 *   this.audit.setTrail(cloudtrailSimulator);
 *   // ao executar operação:
 *   this.audit.record({ eventName: 'PutObject', readOnly: false, ... });
 */

class CloudTrailAudit {
  /**
   * @param {string} eventSource - ex: 's3.amazonaws.com'
   */
  constructor(eventSource) {
    this.eventSource = eventSource;
    this.trail = null;
  }

  /** @param {Object|null} cloudtrailSimulator */
  setTrail(cloudtrailSimulator) {
    this.trail = cloudtrailSimulator || null;
  }

  /**
   * Registra um evento se o CloudTrail estiver ativo e o tipo de evento
   * estiver habilitado nos event selectors do trail.
   *
   * @param {Object} params
   * @param {string}  params.eventName
   * @param {boolean} [params.readOnly=false]
   * @param {Array}   [params.resources=[]]
   * @param {Object}  [params.requestParameters=null]
   * @param {Object}  [params.responseElements=null]
   * @param {string}  [params.username='local-user']
   * @param {string}  [params.sourceIPAddress='127.0.0.1']
   */
  record(params = {}) {
    if (!this.trail) return;

    try {
      // Verifica se há algum trail com logging ativo
      const hasActiveTrail = this._hasActiveTrail();
      if (!hasActiveTrail) return;

      // Verifica se o evento deve ser gravado (management vs data event)
      if (!this._shouldRecord(params)) return;

      this.trail.recordEvent({
        eventSource: this.eventSource,
        eventName: params.eventName,
        readOnly: params.readOnly !== undefined ? params.readOnly : false,
        resources: params.resources || [],
        requestParameters: params.requestParameters || null,
        responseElements: params.responseElements || null,
        username: params.username || 'local-user',
        sourceIPAddress: params.sourceIPAddress || '127.0.0.1',
      });
    } catch (_) {
      // Nunca deixa o audit quebrar o fluxo principal
    }
  }

  _hasActiveTrail() {
    if (!this.trail || !this.trail.trailStatus) return false;
    for (const status of this.trail.trailStatus.values()) {
      if (status.isLogging) return true;
    }
    return false;
  }

  /**
   * Verifica event selectors para decidir se o evento deve ser gravado.
   * Management events são sempre gravados quando logging está ativo.
   * Data events só são gravados se houver um selector configurado para o recurso.
   */
  _shouldRecord(params) {
    if (!this.trail || !this.trail.eventSelectors) return true;

    const isDataEvent = params.isDataEvent === true;

    // Management events: gravados por padrão
    if (!isDataEvent) return true;

    // Data events: verifica se algum trail tem selector para este eventSource
    for (const [trailName, selectors] of this.trail.eventSelectors.entries()) {
      const status = this.trail.trailStatus.get(trailName);
      if (!status || !status.isLogging) continue;

      for (const selector of selectors) {
        const dataResources = selector.DataResources || [];
        for (const dr of dataResources) {
          if (this._matchesDataResource(dr)) return true;
        }
      }
    }

    return false;
  }

  _matchesDataResource(dataResource) {
    const typeMap = {
      's3.amazonaws.com': 'AWS::S3::Object',
      'dynamodb.amazonaws.com': 'AWS::DynamoDB::Table',
      'kms.amazonaws.com': 'AWS::KMS::Key',
      'secretsmanager.amazonaws.com': 'AWS::SecretsManager::Secret',
      'ssm.amazonaws.com': 'AWS::SSM::Parameter',
      'cognito-idp.amazonaws.com': 'AWS::Cognito::UserPool',
      'execute-api.amazonaws.com': 'AWS::APIGateway::Stage',
    };

    const expectedType = typeMap[this.eventSource];
    if (!expectedType) return false;

    if (dataResource.Type !== expectedType) return false;

    // Values: wildcard ou ARN específico
    const values = dataResource.Values || [];
    return values.some((v) => v.endsWith('*') || v === expectedType);
  }
}

module.exports = { CloudTrailAudit };
