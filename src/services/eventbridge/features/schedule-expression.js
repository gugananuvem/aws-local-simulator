/**
 * @fileoverview Parser de ScheduleExpression para EventBridge Scheduler e
 * regras legadas. Suporta rate(...), at(...) e cron(...) no formato AWS.
 *
 * O cron da AWS tem 6 campos: minutos, horas, dia do mês, mês, dia da semana
 * e ano. Além dos curingas `*` e `?`, aceita listas, intervalos, passos,
 * `L`, `nW`, `n#k` e nomes de meses/dias.
 */

'use strict';

const MONTH_NAMES = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

const DOW_NAMES = {
  SUN: 1, MON: 2, TUE: 3, WED: 4, THU: 5, FRI: 6, SAT: 7,
};

const RATE_UNITS = {
  minute: 60 * 1000,
  minutes: 60 * 1000,
  hour: 60 * 60 * 1000,
  hours: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
};

/** Erro de expressão inválida (vira ValidationException na borda). */
class ScheduleExpressionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScheduleExpressionError';
    this.code = 'ValidationException';
  }
}

function fail(message) {
  throw new ScheduleExpressionError(message);
}

/**
 * Converte um valor textual (número ou nome) em inteiro.
 * @param {string} raw
 * @param {Object} names
 * @returns {number}
 */
function toNumber(raw, names) {
  const upper = String(raw).toUpperCase();
  if (names && names[upper] !== undefined) return names[upper];
  if (!/^\d+$/.test(upper)) fail(`Valor inválido na expressão: ${raw}`);
  return Number(upper);
}

/**
 * Compila um campo do cron em uma lista de tokens.
 * @param {string} raw
 * @param {Object} options
 * @returns {{raw: string, tokens: Array, wildcard: boolean, question: boolean}}
 */
function parseField(raw, options) {
  if (!raw) fail(`Campo do cron vazio em ${options.name}`);
  const upper = String(raw).toUpperCase();
  const tokens = [];
  let wildcard = false;
  let question = false;

  for (const part of upper.split(',')) {
    if (!part) fail(`Campo inválido em ${options.name}: ${raw}`);

    if (part === '?' || part === '*') {
      if (part === '?' && !options.allowQuestion) fail(`"?" não é permitido em ${options.name}`);
      if (part === '?') question = true;
      wildcard = true;
      tokens.push({ type: 'any' });
      continue;
    }

    // n#k (apenas dia da semana)
    if (options.allowHash && part.includes('#')) {
      const [dowRaw, nthRaw] = part.split('#');
      const dow = toNumber(dowRaw, DOW_NAMES);
      const nth = Number(nthRaw);
      if (dow < 1 || dow > 7) fail(`Dia da semana inválido: ${dowRaw}`);
      if (!Number.isInteger(nth) || nth < 1 || nth > 5) fail(`Ocorrência inválida: ${nthRaw}`);
      tokens.push({ type: 'nthDow', dow, nth });
      continue;
    }

    // L, L-n, LW e nW (apenas dia do mês)
    if (options.allowLast) {
      if (part === 'L') {
        tokens.push({ type: 'lastDay', offset: 0 });
        continue;
      }
      if (part === 'LW') {
        tokens.push({ type: 'lastWeekday' });
        continue;
      }
      const lastMatch = part.match(/^L-(\d+)$/);
      if (lastMatch) {
        tokens.push({ type: 'lastDay', offset: Number(lastMatch[1]) });
        continue;
      }
      const weekdayMatch = part.match(/^(\d+)W$/);
      if (weekdayMatch) {
        tokens.push({ type: 'nearestWeekday', day: Number(weekdayMatch[1]) });
        continue;
      }
    }

    // dowL (ex.: 3L = última quarta-feira)
    if (options.allowLastDow) {
      const lastDowMatch = part.match(/^(\d+)L$/);
      if (lastDowMatch) {
        tokens.push({ type: 'lastDow', dow: Number(lastDowMatch[1]) });
        continue;
      }
    }

    // passos: */n, a/n, a-b/n
    const stepSplit = part.split('/');
    if (stepSplit.length > 2) fail(`Passo inválido em ${options.name}: ${part}`);
    const step = stepSplit[1] !== undefined ? Number(stepSplit[1]) : 1;
    if (!Number.isInteger(step) || step < 1) fail(`Passo inválido em ${options.name}: ${part}`);
    const base = stepSplit[0];

    if (base === '*' || base === '?') {
      tokens.push({ type: 'range', start: options.min, end: options.max, step });
      continue;
    }

    if (base.includes('-')) {
      const [startRaw, endRaw] = base.split('-');
      const start = toNumber(startRaw, options.names);
      const end = toNumber(endRaw, options.names);
      if (start < options.min || end > options.max || start > end) {
        fail(`Intervalo inválido em ${options.name}: ${base}`);
      }
      tokens.push({ type: 'range', start, end, step });
      continue;
    }

    const value = toNumber(base, options.names);
    if (value < options.min || value > options.max) {
      fail(`Valor fora do intervalo em ${options.name}: ${base}`);
    }
    tokens.push({ type: stepSplit.length > 1 ? 'range' : 'value', start: value, end: options.max, step, value });
  }

  return { raw: upper, tokens, wildcard, question };
}

/**
 * Verifica se um valor casa com o campo compilado.
 * @param {Object} field
 * @param {number} value
 * @param {Object} ctx
 * @returns {boolean}
 */
function fieldMatches(field, value, ctx) {
  for (const token of field.tokens) {
    if (token.type === 'any') return true;
    if (token.type === 'value' && token.value === value) return true;
    if (token.type === 'range') {
      if (value >= token.start && value <= token.end && (value - token.start) % token.step === 0) {
        return true;
      }
    }
    if (token.type === 'lastDay' && value === ctx.lastDay - token.offset) return true;
    if (token.type === 'lastWeekday') {
      const target = ctx.lastWeekday;
      if (value === target) return true;
    }
    if (token.type === 'nearestWeekday' && value === nearestWeekday(ctx.year, ctx.month, token.day)) {
      return true;
    }
    if (token.type === 'lastDow' && value === ctx.dow && ctx.isLastDow) return true;
    if (token.type === 'nthDow' && value === ctx.dow && ctx.nthOfMonth === token.nth) return true;
  }
  return false;
}

/** Último dia do mês (1-based). */
function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Dia útil (seg-sex) mais próximo do dia informado. */
function nearestWeekday(year, month, day) {
  const last = lastDayOfMonth(year, month);
  const clamped = Math.min(Math.max(day, 1), last);
  const date = new Date(Date.UTC(year, month - 1, clamped));
  const dow = date.getUTCDay();
  if (dow === 6) {
    return clamped - 1 >= 1 ? clamped - 1 : clamped + 2;
  }
  if (dow === 0) {
    return clamped + 1 <= last ? clamped + 1 : clamped - 2;
  }
  return clamped;
}

/** Converte Date.getUTCDay() (0-6, domingo=0) para o padrão AWS (1-7). */
function awsDow(date) {
  return date.getUTCDay() + 1;
}

/** Retorna o último dia útil do mês. */
function lastWeekdayOfMonth(year, month) {
  let day = lastDayOfMonth(year, month);
  for (let i = 0; i < 7; i += 1) {
    const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (dow !== 0 && dow !== 6) return day;
    day -= 1;
  }
  return day;
}

/**
 * Faz o parse de uma expressão de agendamento.
 * @param {string} expression
 * @returns {{type: string, expression: string, intervalMs?: number, at?: Date, cron?: Object}}
 */
function parseScheduleExpression(expression) {
  if (!expression || typeof expression !== 'string') {
    fail('ScheduleExpression é obrigatória');
  }
  const raw = expression.trim();

  const rateMatch = raw.match(/^rate\((.+)\)$/i);
  if (rateMatch) {
    const valueMatch = rateMatch[1].trim().match(/^(\d+)\s+([A-Za-z]+)$/);
    if (!valueMatch) fail(`Expressão rate inválida: ${raw}`);
    const value = Number(valueMatch[1]);
    const unit = valueMatch[2].toLowerCase();
    if (!RATE_UNITS[unit]) fail(`Unidade de rate inválida: ${valueMatch[2]}`);
    if (value < 1) fail('O valor de rate deve ser maior que zero');
    if ((unit === 'minute' || unit === 'minutes') && value > 1440) {
      fail('rate em minutos deve ser menor ou igual a 1440');
    }
    return {
      type: 'rate',
      expression: raw,
      value,
      unit,
      intervalMs: value * RATE_UNITS[unit],
    };
  }

  const atMatch = raw.match(/^at\((.+)\)$/i);
  if (atMatch) {
    const value = atMatch[1].trim();
    const normalized = /(Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
    const at = new Date(normalized);
    if (Number.isNaN(at.getTime())) fail(`Expressão at inválida: ${raw}`);
    return { type: 'at', expression: raw, at };
  }

  const cronMatch = raw.match(/^cron\((.+)\)$/i);
  if (cronMatch) {
    const fields = cronMatch[1].trim().split(/\s+/);
    if (fields.length !== 6) {
      fail('A expressão cron deve ter 6 campos: minutos horas dia-mês mês dia-semana ano');
    }
    const [minuteRaw, hourRaw, domRaw, monthRaw, dowRaw, yearRaw] = fields;

    return {
      type: 'cron',
      expression: raw,
      cron: {
        minute: parseField(minuteRaw, { name: 'minutos', min: 0, max: 59 }),
        hour: parseField(hourRaw, { name: 'horas', min: 0, max: 23 }),
        dayOfMonth: parseField(domRaw, {
          name: 'dia do mês', min: 1, max: 31, allowQuestion: true, allowLast: true,
        }),
        month: parseField(monthRaw, { name: 'mês', min: 1, max: 12, names: MONTH_NAMES }),
        dayOfWeek: parseField(dowRaw, {
          name: 'dia da semana', min: 1, max: 7, names: DOW_NAMES,
          allowQuestion: true, allowHash: true, allowLastDow: true,
        }),
        year: parseField(yearRaw, { name: 'ano', min: 1970, max: 2199 }),
      },
    };
  }

  fail(`ScheduleExpression inválida: ${raw}. Use rate(...), at(...) ou cron(...)`);
  return null;
}

/**
 * Calcula a próxima ocorrência de uma expressão depois de `after`.
 * @param {string|Object} expression - string ou resultado de parseScheduleExpression
 * @param {Date} [after]
 * @returns {Date|null}
 */
function nextOccurrence(expression, after = new Date()) {
  const parsed = typeof expression === 'string' ? parseScheduleExpression(expression) : expression;
  if (!parsed) return null;

  if (parsed.type === 'rate') {
    return new Date(after.getTime() + parsed.intervalMs);
  }

  if (parsed.type === 'at') {
    return parsed.at.getTime() > after.getTime() ? new Date(parsed.at.getTime()) : null;
  }

  const cron = parsed.cron;
  const start = new Date(Math.floor(after.getTime() / 60000) * 60000 + 60000);
  const limitYears = 5;
  const limit = new Date(after.getTime());
  limit.setUTCFullYear(limit.getUTCFullYear() + limitYears);

  const bothDayFields =
    !cron.dayOfMonth.wildcard && !cron.dayOfMonth.question &&
    !cron.dayOfWeek.wildcard && !cron.dayOfWeek.question;

  const current = new Date(start.getTime());
  while (current <= limit) {
    const year = current.getUTCFullYear();
    const month = current.getUTCMonth() + 1;
    const day = current.getUTCDate();
    const dow = awsDow(current);
    const lastDay = lastDayOfMonth(year, month);
    const isLastDow = day + 7 > lastDay;
    const ctx = {
      year,
      month,
      day,
      dow,
      lastDay,
      lastWeekday: lastWeekdayOfMonth(year, month),
      isLastDow,
      nthOfMonth: Math.ceil(day / 7),
    };

    const yearOk = fieldMatches(cron.year, year, ctx);
    const monthOk = fieldMatches(cron.month, month, ctx);
    const domOk = fieldMatches(cron.dayOfMonth, day, ctx);
    const dowOk = fieldMatches(cron.dayOfWeek, dow, ctx);
    const dayOk = bothDayFields ? (domOk || dowOk) : (domOk && dowOk);
    const hourOk = fieldMatches(cron.hour, current.getUTCHours(), ctx);
    const minuteOk = fieldMatches(cron.minute, current.getUTCMinutes(), ctx);

    if (yearOk && monthOk && dayOk && hourOk && minuteOk) {
      return new Date(current.getTime());
    }

    current.setUTCMinutes(current.getUTCMinutes() + 1);
  }

  return null;
}

/**
 * Valida a expressão e devolve a próxima execução (usado nas APIs).
 * @param {string} expression
 * @param {Date} [after]
 * @returns {Date|null}
 */
function validateScheduleExpression(expression, after = new Date()) {
  const parsed = parseScheduleExpression(expression);
  if (parsed.type === 'cron') {
    const next = nextOccurrence(parsed, after);
    if (!next) fail(`A expressão ${expression} não produz nenhuma execução futura`);
    return next;
  }
  return nextOccurrence(parsed, after);
}

module.exports = {
  ScheduleExpressionError,
  parseScheduleExpression,
  nextOccurrence,
  validateScheduleExpression,
};
