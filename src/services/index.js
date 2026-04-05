/**
 * Barrel export para todos os serviços
 */

const DynamoDBService = require('./dynamodb');
const S3Service = require('./s3');
const SQSService = require('./sqs');
const LambdaService = require('./lambda');
const CognitoService = require('./cognito');
const APIGatewayService = require('./apigateway');
const ECSService = require('./ecs');
const STSService = require('./sts');
const { SNSService } = require('./sns');
const { EventBridgeService } = require('./eventbridge');
const { CloudWatchService } = require('./cloudwatch');
const CloudTrailService = require('./cloudtrail');
const { KMSService } = require('./kms');
const CloudFormationService = require('./cloudformation');
const { XRayService } = require('./xray');
const { SecretManagerService } = require('./secret-manager');
const { ParameterStoreService } = require('./parameter-store');
const { ConfigService } = require('./config');
const { AthenaService } = require('./athena');

module.exports = {
  DynamoDBService,
  S3Service,
  SQSService,
  LambdaService,
  CognitoService,
  APIGatewayService,
  ECSService,
  STSService,
  SNSService,
  EventBridgeService,
  CloudWatchService,
  CloudTrailService,
  KMSService,
  CloudFormationService,
  XRayService,
  SecretManagerService,
  ParameterStoreService,
  ConfigService,
  AthenaService,
};
