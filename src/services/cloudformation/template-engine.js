"use strict";

/**
 * CloudFormation template engine
 *
 *  - Pseudo-parâmetros (AWS::Region, AWS::AccountId, AWS::StackName, ...)
 *  - Conditions / Fn::If / Fn::And / Fn::Or / Fn::Not / Fn::Equals
 *  - Mappings / Fn::FindInMap
 *  - Ref (parâmetros e recursos), Fn::GetAtt, Fn::Join, Fn::Sub, Fn::Select, Fn::Split,
 *    Fn::Base64, Fn::Cidr, Fn::ImportValue, Fn::Length, Fn::ToJsonString
 *  - Grafo de dependências (DependsOn + referências implícitas) e ordenação topológica
 */

const NO_VALUE = Symbol("AWS::NoValue");

class TemplateError extends Error {
  constructor(message, code = "ValidationError") {
    super(message);
    this.code = code;
    this.statusCode = 400;
  }
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ─── Fn::Cidr (IPv4) ─────────────────────────────────────────────────────────

function ipToInt(ip) {
  return ip.split(".").reduce((acc, o) => acc * 256 + Number(o), 0);
}
function intToIp(n) {
  return [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");
}
function cidr(ipBlock, count, cidrBits) {
  const [base, prefixStr] = String(ipBlock).split("/");
  const prefix = Number(prefixStr);
  const hostBits = Number(cidrBits);
  const newPrefix = 32 - hostBits;
  if (!base || Number.isNaN(prefix) || newPrefix < prefix || newPrefix > 32) {
    throw new TemplateError(`Fn::Cidr: invalid arguments (${ipBlock}, ${count}, ${cidrBits})`);
  }
  const size = 2 ** hostBits;
  const start = Math.floor(ipToInt(base) / 2 ** (32 - prefix)) * 2 ** (32 - prefix);
  if (Number(count) * size > 2 ** (32 - prefix)) {
    throw new TemplateError(`Fn::Cidr: cannot allocate ${count} blocks of /${newPrefix} from ${ipBlock}`);
  }
  return Array.from({ length: Number(count) }, (_, i) => `${intToIp(start + i * size)}/${newPrefix}`);
}

// ─── Contexto de avaliação ───────────────────────────────────────────────────

class TemplateContext {
  /**
   * @param {Object} o
   * @param {Object} o.template
   * @param {string} o.stackName
   * @param {string} o.stackId
   * @param {string} o.region
   * @param {string} o.account
   * @param {Array<{ParameterKey,ParameterValue}>} o.parameters
   * @param {Map<string,string>} [o.exports]  nome → valor (ImportValue)
   * @param {Object} [o.handlers]  registry type → handler (para saber se o tipo é provisionado)
   */
  constructor({ template, stackName, stackId, region, account, parameters = [], exports = new Map(), handlers = {} }) {
    this.template = template || {};
    this.stackName = stackName;
    this.stackId = stackId;
    this.region = region;
    this.account = account;
    this.exports = exports;
    this.handlers = handlers;

    this.parameters = {};
    for (const p of parameters) {
      const def = this.template.Parameters?.[p.ParameterKey] || {};
      const type = String(def.Type || "String");
      const raw = p.ParameterValue ?? "";
      this.parameters[p.ParameterKey] =
        type.startsWith("List<") || type === "CommaDelimitedList"
          ? String(raw)
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s !== "")
          : raw;
    }

    /** logicalId → { physicalId, ref, attrs, type } */
    this.resources = new Map();
    this.conditions = {};
    this._evaluating = new Set();
  }

  pseudo(name) {
    switch (name) {
      case "AWS::Region": return this.region;
      case "AWS::AccountId": return this.account;
      case "AWS::StackName": return this.stackName;
      case "AWS::StackId": return this.stackId;
      case "AWS::Partition": return "aws";
      case "AWS::URLSuffix": return "amazonaws.com";
      case "AWS::NotificationARNs": return [];
      case "AWS::NoValue": return NO_VALUE;
      default: return undefined;
    }
  }

  register(logicalId, entry) {
    this.resources.set(logicalId, entry);
  }

  // ─── Conditions ────────────────────────────────────────────────

  evaluateConditions() {
    const defs = this.template.Conditions || {};
    for (const name of Object.keys(defs)) this.condition(name);
    return this.conditions;
  }

  condition(name) {
    if (name in this.conditions) return this.conditions[name];
    const def = this.template.Conditions?.[name];
    if (def === undefined) throw new TemplateError(`Template format error: Unresolved condition dependency [${name}] in Resource/Output`);
    if (this._evaluating.has(name)) throw new TemplateError(`Template format error: Circular dependency between conditions: [${name}]`);
    this._evaluating.add(name);
    const result = Boolean(this.resolve(def, { allowConditionRef: true }));
    this._evaluating.delete(name);
    this.conditions[name] = result;
    return result;
  }

  // ─── Resolução de intrínsecas ──────────────────────────────────

  resolve(value, opts = {}) {
    if (Array.isArray(value)) {
      return value.map((v) => this.resolve(v, opts)).filter((v) => v !== NO_VALUE);
    }
    if (!isPlainObject(value)) return value;

    const keys = Object.keys(value);
    if (keys.length === 1) {
      const key = keys[0];
      const arg = value[key];
      if (key === "Ref") return this._ref(arg);
      if (key === "Condition" && opts.allowConditionRef) return this.condition(arg);
      if (key.startsWith("Fn::")) return this._fn(key, arg, opts);
    }

    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const r = this.resolve(v, opts);
      if (r !== NO_VALUE) out[k] = r;
    }
    return out;
  }

  _ref(name) {
    if (typeof name !== "string") throw new TemplateError("Template format error: Ref must be a string");
    if (name.startsWith("AWS::")) {
      const p = this.pseudo(name);
      if (p === undefined) throw new TemplateError(`Template format error: Unrecognized pseudo parameter ${name}`);
      return p;
    }
    if (name in this.parameters) return this.parameters[name];
    const res = this.resources.get(name);
    if (res) return res.ref ?? res.physicalId;
    throw new TemplateError(`Template format error: Unresolved resource dependencies [${name}] in the Resources block of the template`);
  }

  _getAtt(logicalId, attr) {
    const res = this.resources.get(logicalId);
    if (!res) throw new TemplateError(`Template format error: Unresolved resource dependencies [${logicalId}] in the Resources block of the template`);
    if (res.attrs && attr in res.attrs) return res.attrs[attr];
    if (!this.handlers[res.type]) {
      // Tipo não provisionado localmente: devolve placeholder determinístico
      return `${res.physicalId}`;
    }
    throw new TemplateError(`Template error: resource ${logicalId} does not support attribute type ${attr} in Fn::GetAtt`);
  }

  _fn(name, arg, opts) {
    const r = (v) => this.resolve(v, opts);
    switch (name) {
      case "Fn::GetAtt": {
        let logical, attr;
        if (typeof arg === "string") {
          const idx = arg.indexOf(".");
          logical = arg.slice(0, idx);
          attr = arg.slice(idx + 1);
        } else {
          const resolved = r(arg);
          logical = resolved[0];
          attr = Array.isArray(resolved[1]) ? resolved[1].join(".") : resolved.slice(1).join(".");
        }
        return this._getAtt(logical, attr);
      }
      case "Fn::Join": {
        const [sep, list] = r(arg);
        return (Array.isArray(list) ? list : []).join(sep);
      }
      case "Fn::Select": {
        const [idx, list] = r(arg);
        const item = list?.[Number(idx)];
        if (item === undefined) throw new TemplateError("Template error: Fn::Select index out of range");
        return item;
      }
      case "Fn::Split": {
        const [sep, str] = r(arg);
        return String(str).split(sep);
      }
      case "Fn::Base64": return Buffer.from(String(r(arg))).toString("base64");
      case "Fn::Length": return (r(arg) || []).length;
      case "Fn::ToJsonString": return JSON.stringify(r(arg));
      case "Fn::Cidr": {
        const [block, count, bits] = r(arg);
        return cidr(block, count, bits);
      }
      case "Fn::FindInMap": {
        const [map, k1, k2] = r(arg);
        const v = this.template.Mappings?.[map]?.[k1]?.[k2];
        if (v === undefined) throw new TemplateError(`Template error: Unable to get mapping for ${map}::${k1}::${k2}`);
        return v;
      }
      case "Fn::ImportValue": {
        const exportName = r(arg);
        if (!this.exports.has(exportName)) {
          throw new TemplateError(`No export named ${exportName} found. Rollback requested by user.`);
        }
        return this.exports.get(exportName);
      }
      case "Fn::If": {
        const [cond, a, b] = arg;
        return r(this.condition(cond) ? a : b);
      }
      case "Fn::Equals": {
        const [a, b] = r(arg);
        return deepEqual(a, b);
      }
      case "Fn::And": return arg.every((c) => Boolean(r(c)));
      case "Fn::Or": return arg.some((c) => Boolean(r(c)));
      case "Fn::Not": return !r(arg[0]);
      case "Fn::Sub": return this._sub(arg, opts);
      case "Fn::Transform": return {};
      default:
        throw new TemplateError(`Template format error: Unrecognized function ${name}`);
    }
  }

  _sub(arg, opts) {
    let str, vars = {};
    if (typeof arg === "string") str = arg;
    else {
      str = arg[0];
      for (const [k, v] of Object.entries(arg[1] || {})) vars[k] = this.resolve(v, opts);
    }
    return String(str).replace(/\$\{([^}]*)\}/g, (_, expr) => {
      if (expr.startsWith("!")) return `\${${expr.slice(1)}}`;
      if (expr in vars) return String(vars[expr]);
      if (expr.includes(".") && !expr.startsWith("AWS::")) {
        const idx = expr.indexOf(".");
        return String(this._getAtt(expr.slice(0, idx), expr.slice(idx + 1)));
      }
      const v = this._ref(expr);
      return Array.isArray(v) ? v.join(",") : String(v);
    });
  }
}

// ─── Dependências ────────────────────────────────────────────────────────────

/** Coleta ids lógicos referenciados (Ref, GetAtt, Sub, DependsOn) em um valor. */
function collectReferences(value, out = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((v) => collectReferences(v, out));
  } else if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k === "Ref" && typeof v === "string") out.add(v);
      else if (k === "Fn::GetAtt") {
        const first = typeof v === "string" ? v.split(".")[0] : Array.isArray(v) ? v[0] : null;
        if (typeof first === "string") out.add(first);
      } else if (k === "Fn::Sub") {
        const str = typeof v === "string" ? v : Array.isArray(v) ? v[0] : "";
        const localVars = Array.isArray(v) ? Object.keys(v[1] || {}) : [];
        for (const m of String(str).matchAll(/\$\{([^}!][^}]*)\}/g)) {
          const id = m[1].split(".")[0];
          if (!localVars.includes(id)) out.add(id);
        }
        if (Array.isArray(v)) collectReferences(v[1], out);
      } else collectReferences(v, out);
    }
  }
  return out;
}

/**
 * Ordena os recursos (ids) por dependência. Lança em caso de ciclo.
 * @param {Object<string,Object>} resources  logicalId → definição
 * @returns {{order: string[], deps: Map<string,Set<string>>}}
 */
function sortResources(resources) {
  const ids = Object.keys(resources);
  const idSet = new Set(ids);
  const deps = new Map();
  for (const id of ids) {
    const refs = collectReferences(resources[id].Properties);
    collectReferences(resources[id].Metadata, refs);
    const dependsOn = resources[id].DependsOn;
    for (const d of Array.isArray(dependsOn) ? dependsOn : dependsOn ? [dependsOn] : []) refs.add(d);
    refs.delete(id);
    for (const ref of [...refs]) if (!idSet.has(ref)) refs.delete(ref);
    deps.set(id, refs);
  }

  const order = [];
  const state = new Map(); // 1 = visitando, 2 = pronto
  const visit = (id, trail) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      const cycle = [...trail.slice(trail.indexOf(id)), id];
      throw new TemplateError(`Circular dependency between resources: [${cycle.join(", ")}]`);
    }
    state.set(id, 1);
    for (const d of deps.get(id)) visit(d, [...trail, id]);
    state.set(id, 2);
    order.push(id);
  };
  ids.forEach((id) => visit(id, []));
  return { order, deps };
}

/**
 * Validação estática (pré-voo) como o CreateStack real: referências a
 * recursos/parâmetros/pseudo-parâmetros inexistentes viram ValidationError.
 */
function validateReferences(template) {
  const resources = template.Resources || {};
  const known = new Set([...Object.keys(resources), ...Object.keys(template.Parameters || {})]);
  const unresolved = new Set();
  const check = (value) => {
    for (const ref of collectReferences(value)) {
      if (!ref.startsWith("AWS::") && !known.has(ref)) unresolved.add(ref);
    }
  };
  for (const def of Object.values(resources)) check(def.Properties);
  for (const def of Object.values(template.Outputs || {})) check(def.Value);
  if (unresolved.size) {
    throw new TemplateError(`Template format error: Unresolved resource dependencies [${[...unresolved].join(", ")}] in the Resources block of the template`);
  }
  for (const [id, def] of Object.entries(resources)) {
    for (const d of Array.isArray(def.DependsOn) ? def.DependsOn : def.DependsOn ? [def.DependsOn] : []) {
      if (!(d in resources)) throw new TemplateError(`Template format error: Unresolved resource dependencies [${d}] in the Resources block of the template`);
    }
    if (def.Condition && !(def.Condition in (template.Conditions || {}))) {
      throw new TemplateError(`Template format error: Unresolved condition dependency [${def.Condition}] in Resource [${id}]`);
    }
    if (!def.Type) throw new TemplateError(`Template format error: [/Resources/${id}] Every Resources object must contain a Type member.`);
  }
}

module.exports = { TemplateContext, TemplateError, NO_VALUE, sortResources, collectReferences, deepEqual, validateReferences };
