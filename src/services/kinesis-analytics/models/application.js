/**
 * Kinesis Data Analytics - Application Model
 * Representa uma aplicação de analytics
 */

const { v4: uuidv4 } = require('uuid');

class Application {
  constructor(applicationName, config = {}) {
    this.applicationName = applicationName;
    this.applicationArn = `arn:aws:kinesisanalytics:us-east-1:123456789012:application/${applicationName}`;
    this.applicationStatus = 'READY';
    this.applicationVersionId = 1;
    this.creationTimestamp = new Date().toISOString();

    // Runtime Environment (SQL ou JAVA_FLINK)
    this.runtimeEnvironment = config.runtimeEnvironment || 'SQL_1_0';
    this.serviceExecutionRole = config.serviceExecutionRole || 'arn:aws:iam::123456789012:role/kinesis-analytics-role';

    // Application description
    this.applicationDescription = config.applicationDescription || '';
    this.lastUpdateTimestamp = new Date().toISOString();

    // Inputs - input streams
    this.inputs = new Map();
    this.inputCount = 0;

    // Outputs - saídas da query
    this.outputs = new Map();
    this.outputCount = 0;

    // Reference Data Sources
    this.referenceDataSources = new Map();

    // SQL Code
    this.sqlCode = '';

    // Application Configuration
    this.applicationConfiguration = {
      sqlApplicationConfiguration: {
        inputs: [],
        outputs: [],
        referenceDataSources: []
      },
      environmentProperties: {
        propertyGroups: []
      }
    };

    // Metrics
    this.inputRecordsCount = 0;
    this.processedRecordsCount = 0;
    this.outputRecordsCount = 0;
    this.processedBytes = 0;
    this.errors = [];

    // Tags
    this.tags = config.tags || {};
  }

  /**
   * Adiciona input (input stream)
   */
  addInput(inputName, config = {}) {
    const input = new Input(inputName, config);
    this.inputs.set(inputName, input);
    this.inputCount++;
    this.lastUpdateTimestamp = new Date().toISOString();
    return input;
  }

  /**
   * Obtém input
   */
  getInput(inputName) {
    return this.inputs.get(inputName);
  }

  /**
   * Remove input
   */
  removeInput(inputName) {
    if (this.inputs.delete(inputName)) {
      this.inputCount--;
      this.lastUpdateTimestamp = new Date().toISOString();
      return true;
    }
    return false;
  }

  /**
   * Adiciona output
   */
  addOutput(outputName, config = {}) {
    const output = new Output(outputName, config);
    this.outputs.set(outputName, output);
    this.outputCount++;
    this.lastUpdateTimestamp = new Date().toISOString();
    return output;
  }

  /**
   * Obtém output
   */
  getOutput(outputName) {
    return this.outputs.get(outputName);
  }

  /**
   * Remove output
   */
  removeOutput(outputName) {
    if (this.outputs.delete(outputName)) {
      this.outputCount--;
      this.lastUpdateTimestamp = new Date().toISOString();
      return true;
    }
    return false;
  }

  /**
   * Define SQL code
   */
  setSqlCode(sqlCode) {
    this.sqlCode = sqlCode;
    this.lastUpdateTimestamp = new Date().toISOString();
  }

  /**
   * Obtém SQL code
   */
  getSqlCode() {
    return this.sqlCode;
  }

  /**
   * Registra um record de input
   */
  recordInputData(inputName, recordData) {
    const input = this.inputs.get(inputName);
    if (input) {
      input.recordCount++;
      input.recordsTimestamp.push(Date.now());
      this.inputRecordsCount++;
      this.lastUpdateTimestamp = new Date().toISOString();
      return true;
    }
    return false;
  }

  /**
   * Registra um record de output
   */
  recordOutputData(outputName, recordData) {
    const output = this.outputs.get(outputName);
    if (output) {
      output.recordCount++;
      output.recordsTimestamp.push(Date.now());
      this.outputRecordsCount++;
      this.lastUpdateTimestamp = new Date().toISOString();
      return true;
    }
    return false;
  }

  /**
   * Retorna descrição da aplicação
   */
  describe() {
    return {
      ApplicationDetail: {
        ApplicationName: this.applicationName,
        ApplicationArn: this.applicationArn,
        ApplicationStatus: this.applicationStatus,
        ApplicationVersionId: this.applicationVersionId,
        CreationTimestamp: this.creationTimestamp,
        LastUpdateTimestamp: this.lastUpdateTimestamp,
        ApplicationDescription: this.applicationDescription,
        RuntimeEnvironment: this.runtimeEnvironment,
        ServiceExecutionRole: this.serviceExecutionRole,
        ApplicationConfiguration: this.applicationConfiguration,
        CloudWatchLoggingOptionDescriptions: []
      }
    };
  }

  toJSON() {
    return {
      applicationName: this.applicationName,
      applicationArn: this.applicationArn,
      applicationStatus: this.applicationStatus,
      applicationVersionId: this.applicationVersionId,
      creationTimestamp: this.creationTimestamp,
      lastUpdateTimestamp: this.lastUpdateTimestamp,
      inputCount: this.inputCount,
      outputCount: this.outputCount,
      inputRecordsCount: this.inputRecordsCount,
      processedRecordsCount: this.processedRecordsCount,
      outputRecordsCount: this.outputRecordsCount,
      runtimeEnvironment: this.runtimeEnvironment
    };
  }
}

/**
 * Input Model - Entrada de dados (stream)
 */
class Input {
  constructor(inputName, config = {}) {
    this.inputName = inputName;
    this.inputId = uuidv4();
    this.sourceStreamArn = config.sourceStreamArn || null;
    this.inputStartingPositionConfiguration = config.inputStartingPositionConfiguration || {
      inputStartingPosition: 'NOW'
    };
    this.recordCount = 0;
    this.recordsTimestamp = [];
    this.createdAt = new Date().toISOString();
    this.schema = config.schema || {
      RecordColumns: [],
      RecordFormat: {
        RecordFormatType: 'JSON'
      }
    };
  }

  toJSON() {
    return {
      inputName: this.inputName,
      inputId: this.inputId,
      sourceStreamArn: this.sourceStreamArn,
      recordCount: this.recordCount,
      createdAt: this.createdAt,
      schema: this.schema
    };
  }
}

/**
 * Output Model - Saída de dados (destino)
 */
class Output {
  constructor(outputName, config = {}) {
    this.outputName = outputName;
    this.outputId = uuidv4();
    this.destinationSchema = config.destinationSchema || {
      RecordFormatType: 'JSON'
    };
    this.destination = config.destination || {
      DestinationType: 'KINESIS_STREAMS',
      KinesisStreamsOutput: {
        ResourceArn: config.resourceArn || null,
        RoleArn: config.roleArn || null
      }
    };
    this.recordCount = 0;
    this.recordsTimestamp = [];
    this.createdAt = new Date().toISOString();
  }

  toJSON() {
    return {
      outputName: this.outputName,
      outputId: this.outputId,
      destination: this.destination,
      recordCount: this.recordCount,
      createdAt: this.createdAt
    };
  }
}

/**
 * Query Model - Consulta SQL
 */
class Query {
  constructor(queryName, config = {}) {
    this.queryName = queryName;
    this.queryId = uuidv4();
    this.sqlQuery = config.sqlQuery || '';
    this.status = 'READY';
    this.createdAt = new Date().toISOString();
    this.lastModifiedAt = new Date().toISOString();
    this.executedCount = 0;
    this.results = [];
  }

  /**
   * Executa query e retorna resultados
   */
  execute(data) {
    this.executedCount++;
    this.lastModifiedAt = new Date().toISOString();

    // Simulação básica de query execution
    const result = {
      queryId: this.queryId,
      executedAt: new Date().toISOString(),
      rowsProcessed: Array.isArray(data) ? data.length : 1,
      status: 'SUCCEEDED',
      data: data
    };

    this.results.push(result);
    return result;
  }

  toJSON() {
    return {
      queryName: this.queryName,
      queryId: this.queryId,
      sqlQuery: this.sqlQuery,
      status: this.status,
      createdAt: this.createdAt,
      lastModifiedAt: this.lastModifiedAt,
      executedCount: this.executedCount
    };
  }
}

module.exports = {
  Application,
  Input,
  Output,
  Query
};
