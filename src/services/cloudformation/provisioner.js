"use strict";

/**
 * Orquestra o provisionamento de uma stack: resolve Conditions, ordena por
 * dependência (DependsOn + Ref/GetAtt/Sub), resolve intrínsecas nas Properties
 * e chama os handlers de recurso (create/update/delete).
 *
 * Também produz os Outputs resolvidos e a lista de StackResources no formato
 * usado pelo simulador (LogicalResourceId, PhysicalResourceId, ResourceType...).
 */

const { TemplateContext, TemplateError, NO_VALUE, sortResources, validateReferences } = require("./template-engine");

function changedKeys(a, b) {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

/** Em DELETE, recurso já inexistente conta como sucesso (como no CFN real). */
const isNotFound = (err) => /not found|does not exist|NotFound|NoSuch/i.test(`${err?.code || ""} ${err?.message || ""}`);

function now() {
  return new Date().toISOString();
}

/**
 * @param {Object} o
 * @param {Object} o.template          template já parseado
 * @param {string} o.stackName
 * @param {string} o.stackId
 * @param {Object} o.env               { region, account, partition }
 * @param {Array}  o.parameters         [{ParameterKey,ParameterValue}]
 * @param {Map}    o.exports            nome de export -> valor (Fn::ImportValue entre stacks)
 * @param {Object} o.handlers           registry type -> handler
 * @param {Object} o.sims               simuladores injetados (por nome lógico usado pelos handlers)
 * @param {Array}  [o.previousResources] stack resources existentes (para UPDATE), formato interno `_meta`
 */
async function provisionStack({ template, stackName, stackId, env, parameters, exports, handlers, sims, previousResources = [], onEvent = () => {} }) {
  validateReferences(template);
  const ctx = new TemplateContext({ template, stackName, stackId, region: env.region, account: env.account, parameters, exports, handlers });
  ctx.evaluateConditions();

  const resourceDefs = template.Resources || {};
  const previousById = new Map(previousResources.map((r) => [r.LogicalResourceId, r]));

  // Recursos cuja Condition é falsa não são criados (comportamento real do CFN)
  const activeIds = Object.keys(resourceDefs).filter((id) => {
    const cond = resourceDefs[id].Condition;
    return cond === undefined || ctx.condition(cond);
  });
  const skippedIds = Object.keys(resourceDefs).filter((id) => !activeIds.includes(id));

  const activeResources = {};
  for (const id of activeIds) activeResources[id] = resourceDefs[id];
  const { order } = sortResources(activeResources);

  const results = [];
  const errors = [];

  for (const logicalId of order) {
    const def = resourceDefs[logicalId];
    const type = def.Type;
    const handler = handlers[type];
    const prevMeta = previousById.get(logicalId);

    // Eventos de recurso (DescribeStackEvents): IN_PROGRESS só quando há trabalho real
    let eventStarted = false;
    const emit = (status, reason, physicalId) => onEvent({ logicalId, physicalId: physicalId ?? prevMeta?.PhysicalResourceId ?? "", type, status, reason });
    const started = () => {
      if (eventStarted) return;
      eventStarted = true;
      emit(prevMeta ? "UPDATE_IN_PROGRESS" : "CREATE_IN_PROGRESS");
    };

    try {
      // Properties resolvidas (Ref/GetAtt já apontam para recursos já processados, na ordem topológica)
      const props = ctx.resolve(def.Properties || {});
      for (const k of Object.keys(props)) if (props[k] === NO_VALUE) delete props[k];

      if (!handler) {
        // Tipo não suportado localmente: registra como "criado" sem efeito real, para não travar a stack
        const physicalId = prevMeta?.PhysicalResourceId || `${stackName}-${logicalId}-${type.replace(/::/g, "-")}`;
        if (!prevMeta) {
          started();
          emit("CREATE_COMPLETE", undefined, physicalId);
        }
        ctx.register(logicalId, { physicalId, attrs: prevMeta?._meta?.attrs || {}, type });
        results.push({
          LogicalResourceId: logicalId,
          PhysicalResourceId: physicalId,
          ResourceType: type,
          ResourceStatus: "CREATE_COMPLETE",
          Timestamp: now(),
          DriftInformation: { StackResourceDriftStatus: "NOT_CHECKED" },
          _meta: { props, attrs: prevMeta?._meta?.attrs || {}, unsupported: true, deletionPolicy: def.DeletionPolicy },
        });
        continue;
      }

      const missing = (handler.requires || []).filter((k) => !sims[k]);
      if (missing.length) {
        throw new TemplateError(`Required simulators not available for ${type}: ${missing.join(", ")}`, "InternalError");
      }

      let outcome;
      const baseCtx = { logicalId, stackName, props, sims, env, type };

      if (!prevMeta) {
        started();
        outcome = await handler.create(baseCtx);
      } else {
        const previousProps = prevMeta._meta?.props || {};
        const changed = changedKeys(previousProps, props);
        const keep = { physicalId: prevMeta.PhysicalResourceId, ref: prevMeta._meta?.ref, attrs: prevMeta._meta?.attrs };
        // Se o handler declara `inPlace`, qualquer outra propriedade alterada exige substitui��o
        const onlyInPlace = handler.inPlace ? changed.every((k) => handler.inPlace.includes(k)) : true;

        if (!prevMeta._meta || !changed.length) {
          outcome = keep;
        } else if (onlyInPlace && handler.update) {
          started();
          outcome = await handler.update({ ...baseCtx, physicalId: prevMeta.PhysicalResourceId, previous: { props: previousProps, attrs: prevMeta._meta?.attrs || {}, ref: prevMeta._meta?.ref } });
        } else if (onlyInPlace && handler.inPlace) {
          outcome = keep;
        } else {
          // Replacement (delete + create), como o CFN faz ao alterar propriedades imutáveis
          started();
          try {
            await handler.delete({ ...baseCtx, props: prevMeta._meta?.props || {}, attrs: prevMeta._meta?.attrs || {}, ref: prevMeta._meta?.ref, physicalId: prevMeta.PhysicalResourceId });
          } catch (_) {}
          outcome = await handler.create(baseCtx);
        }
      }
      if (eventStarted) emit(prevMeta ? "UPDATE_COMPLETE" : "CREATE_COMPLETE", undefined, outcome.physicalId);
      ctx.register(logicalId, { physicalId: outcome.physicalId, ref: outcome.ref, attrs: outcome.attrs || {}, type });
      results.push({
        LogicalResourceId: logicalId,
        PhysicalResourceId: outcome.physicalId,
        ResourceType: type,
        ResourceStatus: prevMeta ? "UPDATE_COMPLETE" : "CREATE_COMPLETE",
        Timestamp: now(),
        DriftInformation: { StackResourceDriftStatus: "NOT_CHECKED" },
        _meta: { props, attrs: outcome.attrs || {}, ref: outcome.ref, deletionPolicy: def.DeletionPolicy },
      });
    } catch (err) {
      started();
      emit(prevMeta ? "UPDATE_FAILED" : "CREATE_FAILED", err.message);
      errors.push({ logicalId, type, message: err.message, code: err.code || "ResourceCreationFailed" });
      ctx.register(logicalId, { physicalId: prevMeta?.PhysicalResourceId || logicalId, attrs: prevMeta?._meta?.attrs || {}, type });
      results.push({
        LogicalResourceId: logicalId,
        PhysicalResourceId: prevMeta?.PhysicalResourceId || "",
        ResourceType: type,
        ResourceStatus: "CREATE_FAILED",
        ResourceStatusReason: err.message,
        Timestamp: now(),
        DriftInformation: { StackResourceDriftStatus: "NOT_CHECKED" },
        _meta: { props: {}, attrs: {} },
      });
    }
  }

  // Recursos cuja Condition ficou falsa: remove dos resultados e desprovisiona se existiam antes
  const toRemove = [];
  for (const id of skippedIds) {
    const prevMeta = previousById.get(id);
    if (prevMeta) toRemove.push(prevMeta);
  }

  // Recursos que existiam antes e não existem mais no template novo (removidos do template)
  const currentIds = new Set(Object.keys(resourceDefs));
  for (const [id, prevMeta] of previousById) {
    if (!currentIds.has(id)) toRemove.push(prevMeta);
  }

  // Remoções só ocorrem se todo o update foi bem-sucedido (como o cleanup do CFN)
  for (const prevMeta of errors.length ? [] : toRemove) {
    const handler = handlers[prevMeta.ResourceType];
    if (handler && prevMeta.PhysicalResourceId && prevMeta._meta?.deletionPolicy !== "Retain") {
      const evt = (status, reason) => onEvent({ logicalId: prevMeta.LogicalResourceId, physicalId: prevMeta.PhysicalResourceId, type: prevMeta.ResourceType, status, reason });
      evt("DELETE_IN_PROGRESS");
      try {
        await handler.delete({ logicalId: prevMeta.LogicalResourceId, stackName, physicalId: prevMeta.PhysicalResourceId, props: prevMeta._meta?.props || {}, attrs: prevMeta._meta?.attrs || {}, ref: prevMeta._meta?.ref, sims, env, type: prevMeta.ResourceType });
        evt("DELETE_COMPLETE");
      } catch (err) {
        if (isNotFound(err)) evt("DELETE_COMPLETE");
        else {
          evt("DELETE_FAILED", err.message);
          errors.push({ logicalId: prevMeta.LogicalResourceId, type: prevMeta.ResourceType, message: err.message, code: "ResourceDeletionFailed" });
        }
      }
    }
  }

  const outputs = [];
  for (const [key, def] of Object.entries(template.Outputs || {})) {
    if (def.Condition && !ctx.condition(def.Condition)) continue;
    try {
      outputs.push({
        OutputKey: key,
        OutputValue: ctx.resolve(def.Value),
        Description: def.Description || "",
        ExportName: def.Export?.Name ? ctx.resolve(def.Export.Name) : undefined,
      });
    } catch (err) {
      errors.push({ logicalId: `Output:${key}`, type: "Output", message: err.message, code: "OutputResolutionFailed" });
    }
  }

  return { resources: results, outputs, errors, conditions: ctx.conditions };
}

/** Desprovisiona todos os recursos de uma stack (DeleteStack), na ordem inversa da dependência. */
async function deprovisionStack({ resources, handlers, sims, env, stackName, onEvent = () => {} }) {
  const errors = [];
  for (const r of [...resources].reverse()) {
    const handler = handlers[r.ResourceType];
    if (!handler || !r.PhysicalResourceId || r._meta?.deletionPolicy === "Retain") continue;
    const evt = (status, reason) => onEvent({ logicalId: r.LogicalResourceId, physicalId: r.PhysicalResourceId, type: r.ResourceType, status, reason });
    evt("DELETE_IN_PROGRESS");
    try {
      await handler.delete({ logicalId: r.LogicalResourceId, stackName, physicalId: r.PhysicalResourceId, props: r._meta?.props || {}, attrs: r._meta?.attrs || {}, ref: r._meta?.ref, sims, env, type: r.ResourceType });
      evt("DELETE_COMPLETE");
    } catch (err) {
      if (isNotFound(err)) evt("DELETE_COMPLETE");
      else {
        evt("DELETE_FAILED", err.message);
        errors.push({ logicalId: r.LogicalResourceId, type: r.ResourceType, message: err.message, code: "ResourceDeletionFailed" });
      }
    }
  }
  return { errors };
}

module.exports = { provisionStack, deprovisionStack };
