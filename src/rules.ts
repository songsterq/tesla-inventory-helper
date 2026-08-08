export const OPS = ['==', '!=', '<', '<=', '>', '>='] as const;
export type Op = (typeof OPS)[number];

// `in` is supported only for chars conditions and requires a non-empty
// string[] value. It tests whether the slice at `pos` (length = value[i].length)
// matches any of the listed strings — useful for "starts with one of these WMIs"
// without having to author N separate rules.
export type CharsCondition =
  | { type: 'chars'; pos: number; op: Op; value: string }
  | { type: 'chars'; pos: number; op: 'in'; value: string[] };

export type NumberCondition = {
  type: 'number';
  from: number;
  to?: number;
  op: Op;
  value: number;
};

export type Condition = CharsCondition | NumberCondition;

export type Rule = {
  name: string;
  conditions: Condition[];
};

export type Rules = Rule[];

export type ParseResult =
  | { ok: true; rules: Rules }
  | { ok: false; error: string };

export function parseRules(input: unknown): ParseResult {
  if (!Array.isArray(input)) {
    return { ok: false, error: 'Top level must be an array of rules.' };
  }
  const rules: Rules = [];
  for (let i = 0; i < input.length; i++) {
    const r = input[i];
    const where = `rule #${i + 1}`;
    if (!isObject(r)) return { ok: false, error: `${where}: must be an object.` };
    if (typeof r.name !== 'string' || r.name.length === 0) {
      return { ok: false, error: `${where}: "name" must be a non-empty string.` };
    }
    if (!Array.isArray(r.conditions) || r.conditions.length === 0) {
      return { ok: false, error: `${where}: "conditions" must be a non-empty array.` };
    }
    const conditions: Condition[] = [];
    for (let j = 0; j < r.conditions.length; j++) {
      const parsed = parseCondition(r.conditions[j], `${where} condition #${j + 1}`);
      if (!parsed.ok) return parsed;
      conditions.push(parsed.condition);
    }
    rules.push({ name: r.name, conditions });
  }
  return { ok: true, rules };
}

function parseCondition(
  c: unknown,
  where: string,
): { ok: true; condition: Condition } | { ok: false; error: string } {
  if (!isObject(c)) return { ok: false, error: `${where}: must be an object.` };
  if (c.type === 'chars') {
    if (!isPositiveInt(c.pos)) {
      return { ok: false, error: `${where}: "pos" must be a positive integer (1-indexed).` };
    }
    if (c.op === 'in') {
      if (!Array.isArray(c.value) || c.value.length === 0) {
        return { ok: false, error: `${where}: "value" must be a non-empty array of strings when op is "in".` };
      }
      const len = (c.value[0] as unknown as string)?.length;
      if (typeof len !== 'number' || len === 0) {
        return { ok: false, error: `${where}: "value" array entries must be non-empty strings.` };
      }
      for (const v of c.value) {
        if (typeof v !== 'string' || v.length !== len) {
          return { ok: false, error: `${where}: "value" entries must be non-empty strings of equal length.` };
        }
      }
      return { ok: true, condition: { type: 'chars', pos: c.pos, op: 'in', value: c.value as string[] } };
    }
    if (!isOp(c.op)) {
      return { ok: false, error: `${where}: "op" must be one of ${OPS.join(', ')}, in.` };
    }
    if (typeof c.value !== 'string' || c.value.length === 0) {
      return { ok: false, error: `${where}: "value" must be a non-empty string.` };
    }
    return { ok: true, condition: { type: 'chars', pos: c.pos, op: c.op, value: c.value } };
  }
  if (c.type === 'number') {
    if (!isPositiveInt(c.from)) {
      return { ok: false, error: `${where}: "from" must be a positive integer (1-indexed).` };
    }
    if (c.to !== undefined && !isPositiveInt(c.to)) {
      return { ok: false, error: `${where}: "to" must be a positive integer if provided.` };
    }
    if (c.to !== undefined && (c.to as number) < (c.from as number)) {
      return { ok: false, error: `${where}: "to" must be >= "from".` };
    }
    if (!isOp(c.op)) {
      return { ok: false, error: `${where}: "op" must be one of ${OPS.join(', ')}.` };
    }
    if (typeof c.value !== 'number' || !Number.isFinite(c.value)) {
      return { ok: false, error: `${where}: "value" must be a finite number.` };
    }
    const cond: NumberCondition = { type: 'number', from: c.from, op: c.op, value: c.value };
    if (c.to !== undefined) cond.to = c.to as number;
    return { ok: true, condition: cond };
  }
  return { ok: false, error: `${where}: "type" must be "chars" or "number".` };
}

// Structural equality, used to tell "this user saved an untouched copy of the
// defaults" from "this user has real customizations". Deliberately not a
// JSON.stringify comparison: that is sensitive to key order, and stored rules
// have been through parseRules while the constants they're compared against
// are hand-written literals.
export function rulesEqual(a: Rules, b: Rules): boolean {
  if (a.length !== b.length) return false;
  return a.every((rule, i) => {
    const other = b[i];
    if (other === undefined) return false;
    if (rule.name !== other.name) return false;
    if (rule.conditions.length !== other.conditions.length) return false;
    return rule.conditions.every((c, j) => {
      const otherCondition = other.conditions[j];
      return otherCondition !== undefined && conditionsEqual(c, otherCondition);
    });
  });
}

function conditionsEqual(a: Condition, b: Condition): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'chars') {
    const other = b as CharsCondition;
    if (a.pos !== other.pos || a.op !== other.op) return false;
    if (Array.isArray(a.value) !== Array.isArray(other.value)) return false;
    if (Array.isArray(a.value) && Array.isArray(other.value)) {
      return (
        a.value.length === other.value.length && a.value.every((v, i) => v === other.value[i])
      );
    }
    return a.value === other.value;
  }
  const other = b as NumberCondition;
  return (
    a.from === other.from && a.to === other.to && a.op === other.op && a.value === other.value
  );
}

export function evalRules(vin: string, rules: Rules): Rule | null {
  for (const rule of rules) {
    if (rule.conditions.every((c) => evalCondition(vin, c))) return rule;
  }
  return null;
}

function evalCondition(vin: string, c: Condition): boolean {
  if (c.type === 'chars') {
    if (c.op === 'in') {
      for (const v of c.value) {
        const start = c.pos - 1;
        const end = start + v.length;
        if (start < 0 || end > vin.length) continue;
        if (vin.slice(start, end) === v) return true;
      }
      return false;
    }
    const start = c.pos - 1;
    const end = start + c.value.length;
    if (start < 0 || end > vin.length) return false;
    const slice = vin.slice(start, end);
    return cmp(slice, c.value, c.op);
  }
  const start = c.from - 1;
  const end = c.to !== undefined ? c.to : vin.length;
  if (start < 0 || start >= end || end > vin.length) return false;
  const slice = vin.slice(start, end);
  if (slice.length === 0) return false;
  if (!/^\d+$/.test(slice)) return false;
  const n = parseInt(slice, 10);
  if (!Number.isFinite(n)) return false;
  return cmpNum(n, c.value, c.op);
}

function cmp(a: string, b: string, op: Op): boolean {
  switch (op) {
    case '==': return a === b;
    case '!=': return a !== b;
    case '<':  return a <  b;
    case '<=': return a <= b;
    case '>':  return a >  b;
    case '>=': return a >= b;
  }
}

function cmpNum(a: number, b: number, op: Op): boolean {
  switch (op) {
    case '==': return a === b;
    case '!=': return a !== b;
    case '<':  return a <  b;
    case '<=': return a <= b;
    case '>':  return a >  b;
    case '>=': return a >= b;
  }
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isPositiveInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x > 0;
}

function isOp(x: unknown): x is Op {
  return typeof x === 'string' && (OPS as readonly string[]).includes(x);
}
