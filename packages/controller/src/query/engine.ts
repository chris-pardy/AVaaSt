import { createLogger } from "@avaast/shared";
import type {
  Query,
  Expression,
  Comparison,
  LogicalOp,
  ArithmeticOp,
  BuiltinCall,
} from "@avaast/shared";
import { QueryPlanner, type QueryPlan, type PipelineStep } from "./planner.js";
import { QueryCache } from "./cache.js";
import type { DataSourceAdapter } from "./sources.js";

type Row = Record<string, unknown>;

export interface QueryEngineOptions {
  dataSource: DataSourceAdapter;
  defaultDid?: string;
}

export class QueryEngine {
  private logger = createLogger("query-engine");
  private planner = new QueryPlanner();
  private cache = new QueryCache();
  private dataSource: DataSourceAdapter;
  private defaultDid?: string;

  constructor(options: QueryEngineOptions) {
    this.dataSource = options.dataSource;
    this.defaultDid = options.defaultDid;
  }

  async execute(
    query: Query,
    params: Record<string, string> = {},
    options?: { cacheTtl?: number; version?: string },
  ): Promise<{ results: unknown[]; cached: boolean }> {
    const cacheKey = this.buildCacheKey(query, params);
    const version = options?.version ?? "default";

    if (options?.cacheTtl) {
      const cached = this.cache.get<unknown[]>(cacheKey, version);
      if (cached) {
        return { results: cached, cached: true };
      }
    }

    const plan = this.planner.plan(query);
    const results = await this.executePlan(plan, params);

    if (options?.cacheTtl) {
      this.cache.set(cacheKey, results, options.cacheTtl, version);
    }

    return { results, cached: false };
  }

  invalidateCache(prefix?: string): void {
    if (prefix) {
      this.cache.invalidateByPrefix(prefix);
    } else {
      this.cache.invalidateAll();
    }
  }

  private async executePlan(
    plan: QueryPlan,
    params: Record<string, string>,
  ): Promise<unknown[]> {
    const datasets = new Map<string, Row[]>();
    let rows: Row[] = [];

    for (const step of plan.pipeline) {
      switch (step.type) {
        case "fetch": {
          const sourcePlan = plan.sources.find((s) => s.alias === step.alias);
          if (!sourcePlan) throw new Error(`Unknown source: ${step.alias}`);
          const records = await this.dataSource.fetchRecords(
            sourcePlan.source,
            this.defaultDid,
          );
          const aliasedRows = records.map((r) =>
            this.aliasRow(step.alias, r as Row),
          );
          datasets.set(step.alias, aliasedRows);
          rows = aliasedRows;
          break;
        }

        case "join": {
          const sourcePlan = plan.sources.find((s) => s.alias === step.alias);
          if (!sourcePlan) throw new Error(`Unknown source: ${step.alias}`);
          const rightRecords = await this.dataSource.fetchRecords(
            sourcePlan.source,
            this.defaultDid,
          );
          const rightRows = rightRecords.map((r) =>
            this.aliasRow(step.alias, r as Row),
          );
          datasets.set(step.alias, rightRows);
          rows = this.performJoin(
            rows,
            rightRows,
            step.joinType,
            step.on,
            params,
          );
          break;
        }

        case "filter":
          rows = rows.filter((row) =>
            this.evaluateExpression(step.expression, row, params),
          );
          break;

        case "group":
          rows = this.performGroupBy(rows, step.expressions, params);
          break;

        case "having":
          rows = rows.filter((row) =>
            this.evaluateExpression(step.expression, row, params),
          );
          break;

        case "select":
          rows = rows.map((row) => {
            const result: Row = {};
            for (const field of step.fields) {
              result[field.alias] = this.evaluateExpression(
                field.value,
                row,
                params,
              );
            }
            return result;
          });
          break;

        case "distinct":
          rows = this.performDistinct(rows);
          break;

        case "orderBy":
          rows = this.performOrderBy(rows, step.clauses, params);
          break;

        case "limit":
          rows = rows.slice(
            step.offset ?? 0,
            (step.offset ?? 0) + step.limit,
          );
          break;
      }
    }

    return rows;
  }

  private aliasRow(alias: string, row: Row): Row {
    const result: Row = {};
    for (const [key, value] of Object.entries(row)) {
      result[`${alias}.${key}`] = value;
    }
    return result;
  }

  evaluateExpression(
    expr: Expression,
    row: Row,
    params: Record<string, string>,
  ): unknown {
    switch (expr.type) {
      case "fieldRef": {
        if (expr.source === "$params") {
          return params[expr.field];
        }
        const key = `${expr.source}.${expr.field}`;
        return this.getNestedValue(row, key);
      }

      case "literal":
        return expr.stringValue ?? expr.integerValue ?? expr.booleanValue ?? null;

      case "comparison":
        return this.evaluateComparison(expr, row, params);

      case "logicalOp":
        return this.evaluateLogical(expr, row, params);

      case "arithmeticOp":
        return this.evaluateArithmetic(expr, row, params);

      case "builtinCall":
        return this.evaluateBuiltin(expr, row, params);

      case "functionCall":
        // Function calls are async - would need special handling in a real impl
        throw new Error(
          "Function calls in expressions not yet supported in sync evaluation",
        );

      case "caseExpression": {
        for (const branch of expr.branches) {
          if (this.evaluateExpression(branch.when, row, params)) {
            return this.evaluateExpression(branch.then, row, params);
          }
        }
        return expr.elseValue
          ? this.evaluateExpression(expr.elseValue, row, params)
          : null;
      }

      default:
        throw new Error(
          `Unknown expression type: ${(expr as { type: string }).type}`,
        );
    }
  }

  private evaluateComparison(
    expr: Comparison,
    row: Row,
    params: Record<string, string>,
  ): boolean {
    const left = this.evaluateExpression(expr.left, row, params);
    const right = expr.right
      ? this.evaluateExpression(expr.right, row, params)
      : null;

    switch (expr.op) {
      case "eq":
        return left === right;
      case "neq":
        return left !== right;
      case "gt":
        return (left as number) > (right as number);
      case "gte":
        return (left as number) >= (right as number);
      case "lt":
        return (left as number) < (right as number);
      case "lte":
        return (left as number) <= (right as number);
      case "like":
        return (
          typeof left === "string" &&
          typeof right === "string" &&
          new RegExp(
            "^" + right.replace(/%/g, ".*").replace(/_/g, ".") + "$",
          ).test(left)
        );
      case "in":
        return Array.isArray(right) && right.includes(left);
      case "notIn":
        return Array.isArray(right) && !right.includes(left);
      case "isNull":
        return left === null || left === undefined;
      case "isNotNull":
        return left !== null && left !== undefined;
      case "between":
        return (
          Array.isArray(right) &&
          (left as number) >= (right[0] as number) &&
          (left as number) <= (right[1] as number)
        );
      default:
        throw new Error(`Unknown comparison op: ${expr.op}`);
    }
  }

  private evaluateLogical(
    expr: LogicalOp,
    row: Row,
    params: Record<string, string>,
  ): boolean {
    switch (expr.op) {
      case "and":
        return expr.operands.every((op) =>
          this.evaluateExpression(op, row, params),
        );
      case "or":
        return expr.operands.some((op) =>
          this.evaluateExpression(op, row, params),
        );
      case "not":
        return !this.evaluateExpression(expr.operands[0]!, row, params);
      default:
        throw new Error(`Unknown logical op: ${expr.op}`);
    }
  }

  private evaluateArithmetic(
    expr: ArithmeticOp,
    row: Row,
    params: Record<string, string>,
  ): number {
    const left = this.evaluateExpression(expr.left, row, params) as number;
    const right = this.evaluateExpression(expr.right, row, params) as number;

    switch (expr.op) {
      case "add":
        return left + right;
      case "subtract":
        return left - right;
      case "multiply":
        return left * right;
      case "divide":
        return right === 0 ? 0 : left / right;
      case "modulo":
        return right === 0 ? 0 : left % right;
      default:
        throw new Error(`Unknown arithmetic op: ${expr.op}`);
    }
  }

  private evaluateBuiltin(
    expr: BuiltinCall,
    row: Row,
    params: Record<string, string>,
  ): unknown {
    const AGGREGATES = ["count", "sum", "avg", "min", "max"];
    const group = row._group as Row[] | undefined;

    // When operating on a grouped row, collect values from all group members
    if (group && AGGREGATES.includes(expr.name)) {
      const values = group.map((r) =>
        this.evaluateExpression(expr.args[0]!, r, params),
      );

      switch (expr.name) {
        case "count":
          return values.filter((v) => v !== null && v !== undefined).length;
        case "sum":
          return (values as number[]).reduce((a, b) => a + (Number(b) || 0), 0);
        case "avg": {
          const nums = values.filter((v) => v !== null && v !== undefined) as number[];
          return nums.length === 0 ? null : nums.reduce((a, b) => a + Number(b), 0) / nums.length;
        }
        case "min": {
          const nums = values.filter((v) => v !== null && v !== undefined) as number[];
          return nums.length === 0 ? null : Math.min(...nums.map(Number));
        }
        case "max": {
          const nums = values.filter((v) => v !== null && v !== undefined) as number[];
          return nums.length === 0 ? null : Math.max(...nums.map(Number));
        }
      }
    }

    const args = expr.args.map((a) => this.evaluateExpression(a, row, params));

    switch (expr.name) {
      case "count":
        return Array.isArray(args[0]) ? args[0].length : 1;
      case "sum":
        return Array.isArray(args[0])
          ? (args[0] as number[]).reduce((a, b) => a + b, 0)
          : args[0];
      case "avg":
        return Array.isArray(args[0])
          ? (args[0] as number[]).reduce((a, b) => a + b, 0) /
            (args[0] as number[]).length
          : args[0];
      case "min":
        return Array.isArray(args[0])
          ? Math.min(...(args[0] as number[]))
          : args[0];
      case "max":
        return Array.isArray(args[0])
          ? Math.max(...(args[0] as number[]))
          : args[0];
      case "concat":
        return args.map(String).join("");
      case "lower":
        return String(args[0] ?? "").toLowerCase();
      case "upper":
        return String(args[0] ?? "").toUpperCase();
      case "trim":
        return String(args[0] ?? "").trim();
      case "length":
        return String(args[0] ?? "").length;
      case "coalesce":
        return args.find((a) => a !== null && a !== undefined) ?? null;
      case "now":
        return new Date().toISOString();
      case "substring":
        return String(args[0] ?? "").substring(
          Number(args[1]) || 0,
          args[2] !== undefined ? Number(args[2]) : undefined,
        );
      case "abs":
        return Math.abs(Number(args[0]));
      case "round":
        return Math.round(Number(args[0]));
      case "floor":
        return Math.floor(Number(args[0]));
      case "ceil":
        return Math.ceil(Number(args[0]));
      default:
        throw new Error(`Unknown builtin: ${expr.name}`);
    }
  }

  private getNestedValue(obj: Row, path: string): unknown {
    const parts = path.split(".");

    // Try progressively longer prefix keys to handle aliased rows.
    // e.g. for "aye.avast.uri", try obj["aye.avast"] then drill into ["uri"]
    for (let i = parts.length; i >= 1; i--) {
      const prefix = parts.slice(0, i).join(".");
      const val = (obj as Record<string, unknown>)[prefix];
      if (val !== undefined) {
        // Drill into remaining parts
        let current: unknown = val;
        for (let j = i; j < parts.length; j++) {
          if (current === null || current === undefined) return undefined;
          current = (current as Record<string, unknown>)[parts[j]!];
        }
        return current;
      }
    }

    return undefined;
  }

  private performJoin(
    left: Row[],
    right: Row[],
    joinType: string,
    on: Expression,
    params: Record<string, string>,
  ): Row[] {
    const results: Row[] = [];

    if (joinType === "cross") {
      for (const l of left) {
        for (const r of right) {
          results.push({ ...l, ...r });
        }
      }
      return results;
    }

    const rightUsed = new Set<number>();

    for (let li = 0; li < left.length; li++) {
      let matched = false;
      for (let ri = 0; ri < right.length; ri++) {
        const merged = { ...left[li], ...right[ri] };
        if (this.evaluateExpression(on, merged, params)) {
          results.push(merged);
          rightUsed.add(ri);
          matched = true;
        }
      }
      if (!matched && joinType === "left") {
        results.push({ ...left[li]! });
      }
    }

    if (joinType === "right") {
      for (let ri = 0; ri < right.length; ri++) {
        if (!rightUsed.has(ri)) {
          results.push({ ...right[ri]! });
        }
      }
    }

    return results;
  }

  private performGroupBy(
    rows: Row[],
    expressions: Expression[],
    params: Record<string, string>,
  ): Row[] {
    const groups = new Map<string, Row[]>();

    for (const row of rows) {
      const key = expressions
        .map((e) => JSON.stringify(this.evaluateExpression(e, row, params)))
        .join("|||");
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }

    // Return the first row from each group with group data attached
    return Array.from(groups.values()).map((group) => {
      const row = { ...group[0]! };
      row._group = group;
      return row;
    });
  }

  private performDistinct(rows: Row[]): Row[] {
    const seen = new Set<string>();
    return rows.filter((row) => {
      const key = JSON.stringify(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private performOrderBy(
    rows: Row[],
    clauses: Array<{
      value: Expression;
      direction: string;
      nulls?: string;
    }>,
    params: Record<string, string>,
  ): Row[] {
    return [...rows].sort((a, b) => {
      for (const clause of clauses) {
        const aVal = this.evaluateExpression(clause.value, a, params);
        const bVal = this.evaluateExpression(clause.value, b, params);

        // Handle nulls
        if (aVal === null || aVal === undefined) {
          if (bVal === null || bVal === undefined) continue;
          return clause.nulls === "first" ? -1 : 1;
        }
        if (bVal === null || bVal === undefined) {
          return clause.nulls === "first" ? 1 : -1;
        }

        let cmp: number;
        if (typeof aVal === "string" && typeof bVal === "string") {
          cmp = aVal.localeCompare(bVal);
        } else {
          cmp = (aVal as number) - (bVal as number);
        }

        if (cmp !== 0) {
          return clause.direction === "desc" ? -cmp : cmp;
        }
      }
      return 0;
    });
  }

  private buildCacheKey(
    query: Query,
    params: Record<string, string>,
  ): string {
    return `query:${JSON.stringify(query)}:${JSON.stringify(params)}`;
  }
}
