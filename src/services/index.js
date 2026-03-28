/**
 * Barrel export para todos os serviços
 */

const DynamoDBService = require('./dynamodb');
const S3Service = require('./s3');
const SQSService = require('./sqs');
const LambdaService = require('./lambda');
const SNSService = require('./sns');
const EventBridgeService = require('./eventbridge');

module.exports = {
  DynamoDBService,
  S3Service,
  SQSService,
  LambdaService,
  SNSService,
  EventBridgeService
};  