"use strict";

/**
 * Handlers CloudFormation: API Gateway (REST e HTTP/V2).
 * sims.apigateway -> APIGatewaySimulator
 */

const { generateName, tagsToObject, toBool, toNumber } = require("./helpers");

const methodId = (p) => `${p.RestApiId}-${p.ResourceId}-${p.HttpMethod}`;

module.exports = {
  "AWS::ApiGateway::RestApi": {
    requires: ["apigateway"],
    inPlace: ["Description", "Tags"],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.Name || generateName(stackName, logicalId, { max: 128 });
      const api = sims.apigateway.createRestApi({
        name,
        description: props.Description,
        version: props.Version,
        apiKeySource: props.ApiKeySourceType,
        endpointConfiguration: props.EndpointConfiguration ? { types: props.EndpointConfiguration.Types || ["REGIONAL"] } : undefined,
        tags: tagsToObject(props.Tags),
      });
      const rootResourceId = sims.apigateway.apis.get(api.id)?.rootResourceId;
      return { physicalId: api.id, attrs: { RestApiId: api.id, RootResourceId: rootResourceId } };
    },
    async delete({ physicalId, sims }) {
      sims.apigateway.deleteRestApi({ restApiId: physicalId });
    },
  },

  "AWS::ApiGateway::Resource": {
    requires: ["apigateway"],
    inPlace: [],
    async create({ props, sims }) {
      const r = sims.apigateway.createResource({ restApiId: props.RestApiId, parentId: props.ParentId, pathPart: props.PathPart });
      return { physicalId: r.id, attrs: { ResourceId: r.id } };
    },
    async delete({ physicalId, props, sims }) {
      sims.apigateway.deleteResource({ restApiId: props.RestApiId, resourceId: physicalId });
    },
  },

  "AWS::ApiGateway::Method": {
    requires: ["apigateway"],
    inPlace: [],
    async create({ props, sims }) {
      const common = { restApiId: props.RestApiId, resourceId: props.ResourceId, httpMethod: props.HttpMethod };
      sims.apigateway.putMethod({
        ...common,
        authorizationType: props.AuthorizationType || "NONE",
        apiKeyRequired: toBool(props.ApiKeyRequired, false),
        requestParameters: props.RequestParameters,
        requestModels: props.RequestModels,
        authorizerId: props.AuthorizerId,
        requestValidatorId: props.RequestValidatorId,
      });
      const integ = props.Integration;
      if (integ) {
        sims.apigateway.putIntegration({
          ...common,
          type: integ.Type,
          integrationHttpMethod: integ.IntegrationHttpMethod,
          uri: integ.Uri,
          credentials: integ.Credentials,
          requestParameters: integ.RequestParameters,
          requestTemplates: integ.RequestTemplates,
          passthroughBehavior: integ.PassthroughBehavior,
          timeoutInMillis: integ.TimeoutInMillis !== undefined ? Number(integ.TimeoutInMillis) : undefined,
          cacheNamespace: integ.CacheNamespace,
          cacheKeyParameters: integ.CacheKeyParameters,
          contentHandling: integ.ContentHandling,
        });
        for (const resp of integ.IntegrationResponses || []) {
          sims.apigateway.putIntegrationResponse({
            ...common,
            statusCode: String(resp.StatusCode),
            selectionPattern: resp.SelectionPattern,
            responseParameters: resp.ResponseParameters,
            responseTemplates: resp.ResponseTemplates,
          });
        }
      }
      return { physicalId: methodId(props), attrs: {} };
    },
    async delete({ props, sims }) {
      try {
        sims.apigateway.deleteMethod({ restApiId: props.RestApiId, resourceId: props.ResourceId, httpMethod: props.HttpMethod });
      } catch (_) {}
    },
  },

  "AWS::ApiGateway::Deployment": {
    requires: ["apigateway"],
    inPlace: [],
    async create({ props, sims }) {
      const d = sims.apigateway.createDeployment({
        restApiId: props.RestApiId,
        stageName: props.StageName,
        stageDescription: props.StageDescription?.Description,
        description: props.Description,
        variables: props.StageDescription?.Variables,
      });
      return { physicalId: d.id, attrs: { DeploymentId: d.id } };
    },
    async delete({ physicalId, props, sims }) {
      const api = sims.apigateway.apis.get(props?.RestApiId);
      if (api) {
        api.deployments.delete(physicalId);
        sims.apigateway.persistDeployments(props.RestApiId);
      }
    },
  },

  "AWS::ApiGateway::Stage": {
    requires: ["apigateway"],
    inPlace: ["Description", "Variables", "TracingEnabled", "MethodSettings"],
    async create({ props, sims }) {
      sims.apigateway.createStage({
        restApiId: props.RestApiId,
        stageName: props.StageName,
        description: props.Description,
        variables: props.Variables,
        deploymentId: props.DeploymentId,
        cacheClusterEnabled: toBool(props.CacheClusterEnabled, false),
        cacheClusterSize: props.CacheClusterSize,
        tracingEnabled: toBool(props.TracingEnabled, false),
      });
      return { physicalId: props.StageName, attrs: {} };
    },
    async update({ physicalId, props, sims, previous }) {
      const stage = sims.apigateway.apis.get(props.RestApiId)?.stages.get(physicalId);
      if (stage) {
        stage.description = props.Description || "";
        stage.variables = props.Variables || {};
        stage.tracingEnabled = toBool(props.TracingEnabled, false);
        sims.apigateway.persistStages(props.RestApiId);
      }
      return { physicalId, attrs: previous.attrs };
    },
    async delete({ physicalId, props, sims }) {
      sims.apigateway.deleteStage({ restApiId: props.RestApiId, stageName: physicalId });
    },
  },

  "AWS::ApiGateway::ApiKey": {
    requires: ["apigateway"],
    inPlace: ["Description", "Enabled"],
    async create({ logicalId, stackName, props, sims }) {
      const key = sims.apigateway.createApiKey({
        name: props.Name || generateName(stackName, logicalId, { max: 128 }),
        description: props.Description,
        enabled: toBool(props.Enabled, true),
        customerId: props.CustomerId,
      });
      return { physicalId: key.id, attrs: { APIKeyId: key.id } };
    },
    async delete({ physicalId, sims }) {
      sims.apigateway.apiKeys.delete(physicalId);
      sims.apigateway.persistApiKeys();
    },
  },

  "AWS::ApiGateway::UsagePlan": {
    requires: ["apigateway"],
    inPlace: ["Description", "Throttle", "Quota"],
    async create({ logicalId, stackName, props, sims }) {
      const plan = sims.apigateway.createUsagePlan({
        name: props.UsagePlanName || generateName(stackName, logicalId, { max: 128 }),
        description: props.Description,
        apiStages: (props.ApiStages || []).map((s) => ({ apiId: s.ApiId, stage: s.Stage })),
        throttle: props.Throttle ? { burstLimit: toNumber(props.Throttle.BurstLimit), rateLimit: toNumber(props.Throttle.RateLimit) } : undefined,
        quota: props.Quota ? { limit: toNumber(props.Quota.Limit), period: props.Quota.Period, offset: toNumber(props.Quota.Offset, 0) } : undefined,
      });
      return { physicalId: plan.id, attrs: { Id: plan.id } };
    },
    async delete({ physicalId, sims }) {
      sims.apigateway.usagePlans.delete(physicalId);
      sims.apigateway.persistUsagePlans();
    },
  },

  // ─── HTTP API (API Gateway V2) ──────────────────────────────────────────
  "AWS::ApiGatewayV2::Api": {
    requires: ["apigateway"],
    inPlace: ["Description", "CorsConfiguration", "Tags"],
    async create({ logicalId, stackName, props, sims }) {
      const api = sims.apigateway.createHttpApi({
        name: props.Name || generateName(stackName, logicalId, { max: 128 }),
        description: props.Description,
        protocolType: props.ProtocolType || "HTTP",
        routeSelectionExpression: props.RouteSelectionExpression,
        corsConfiguration: props.CorsConfiguration
          ? {
              allowOrigins: props.CorsConfiguration.AllowOrigins,
              allowMethods: props.CorsConfiguration.AllowMethods,
              allowHeaders: props.CorsConfiguration.AllowHeaders,
              maxAge: props.CorsConfiguration.MaxAge,
            }
          : undefined,
      });
      return { physicalId: api.ApiId, attrs: { ApiId: api.ApiId, ApiEndpoint: `http://localhost:${sims.apigateway.config?.ports?.apigateway || 4567}/${api.ApiId}` } };
    },
    async delete({ physicalId, sims }) {
      sims.apigateway.apis.delete(physicalId);
      sims.apigateway.persistAPIs();
    },
  },

  "AWS::ApiGatewayV2::Route": {
    requires: ["apigateway"],
    inPlace: [],
    async create({ props, sims }) {
      sims.apigateway.createRoute({
        apiId: props.ApiId,
        routeKey: props.RouteKey,
        authorizationType: props.AuthorizationType || "NONE",
        target: props.Target,
      });
      return { physicalId: `${props.ApiId}-${props.RouteKey}`, attrs: { RouteId: props.RouteKey } };
    },
    async delete({ props, sims }) {
      const api = sims.apigateway.apis.get(props?.ApiId);
      if (api?.routes) {
        api.routes.delete(props.RouteKey);
        sims.apigateway.persistAPIs();
      }
    },
  },

  "AWS::ApiGatewayV2::Integration": {
    inPlace: ["IntegrationUri", "PayloadFormatVersion"],
    async create({ props, logicalId, stackName }) {
      const id = `${stackName}-${logicalId}`;
      return { physicalId: id, attrs: { IntegrationId: id } };
    },
    async delete() {},
  },

  "AWS::ApiGatewayV2::Stage": {
    inPlace: ["AutoDeploy", "Description"],
    async create({ props }) {
      return { physicalId: props.StageName, attrs: {} };
    },
    async delete() {},
  },
};
