/**
 * Barrel export para todos os serviços
 */

const DynamoDBService = require('./dynamodb');
const DAXService = require('./dax');
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
const { AuroraService } = require('./aurora');
const IAMService = require('./iam');
const EC2Service = require('./ec2');
const ALBService = require('./alb');
const ASGService = require('./asg');
const OpenSearchService = require('./opensearch');
const KinesisDataStreamsService = require('./kinesis-data-streams');
const KinesisFirehoseService = require('./kinesis-firehose');
const KinesisAnalyticsService = require('./kinesis-analytics');
const OrganizationsService = require('./organizations');
const CloudFrontService = require('./cloudfront');
const Route53Service = require('./route53');
const ACMService = require('./acm');

module.exports = {
  DynamoDBService,
  DAXService,
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
  AuroraService,
  IAMService,
  EC2Service,
  ALBService,
  ASGService,
  OpenSearchService,
  KinesisDataStreamsService,
  KinesisFirehoseService,
  KinesisAnalyticsService,
  OrganizationsService,
  CloudFrontService,
  Route53Service,
  ACMService,
};
