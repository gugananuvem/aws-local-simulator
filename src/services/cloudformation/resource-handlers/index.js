"use strict";

/**
 * Registry de handlers de recursos CloudFormation: type -> handler.
 * Cada módulo exporta um objeto { "AWS::Servico::Tipo": handler }.
 */

const modules = ["./core", "./ec2", "./iam", "./organizations", "./messaging", "./platform", "./compute", "./apigateway", "./services"];

const handlers = {};
for (const mod of modules) {
  Object.assign(handlers, require(mod));
}

module.exports = handlers;
