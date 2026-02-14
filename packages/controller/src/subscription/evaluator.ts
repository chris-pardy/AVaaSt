import { createLogger } from "@avaast/shared";
import type { Expression, SelectField } from "@avaast/shared";

type Row = Record<string, unknown>;

// Reuses expression evaluation logic - in production would share with query engine
export class FilterEvaluator {
  private logger = createLogger("filter-evaluator");

  evaluate(
    expression: Expression,
    record: Row,
    params: Record<string, string>,
  ): boolean {
    const result = this.evaluateExpression(expression, record, params);
    return Boolean(result);
  }

  projectFields(
    fields: SelectField[],
    record: Row,
    params: Record<string, string>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const field of fields) {
      result[field.alias] = this.evaluateExpression(
        field.value,
        record,
        params,
      );
    }
    return result;
  }

  private evaluateExpression(
    expr: Expression,
    row: Row,
    params: Record<string, string>,
  ): unknown {
    switch (expr.type) {
      case "fieldRef": {
        if (expr.source === "$params") return params[expr.field];
        return this.getNestedValue(row, expr.field);
      }
      case "literal":
        return expr.stringValue ?? expr.integerValue ?? expr.booleanValue ?? null;
      case "comparison":
        return this.evaluateComparison(expr, row, params);
      case "logicalOp":
        return this.evaluateLogical(expr, row, params);
      case "arithmeticOp": {
        const left = this.evaluateExpression(expr.left, row, params) as number;
        const right = this.evaluateExpression(
          expr.right,
          row,
          params,
        ) as number;
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
            return 0;
        }
      }
      case "builtinCall": {
        const args = expr.args.map((a) =>
          this.evaluateExpression(a, row, params),
        );
        switch (expr.name) {
          case "lower":
            return String(args[0] ?? "").toLowerCase();
          case "upper":
            return String(args[0] ?? "").toUpperCase();
          case "coalesce":
            return (
              args.find((a) => a !== null && a !== undefined) ?? null
            );
          default:
            return null;
        }
      }
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
        return null;
    }
  }

  private evaluateComparison(
    expr: Expression & { type: "comparison" },
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
      case "isNull":
        return left === null || left === undefined;
      case "isNotNull":
        return left !== null && left !== undefined;
      default:
        return false;
    }
  }

  private evaluateLogical(
    expr: Expression & { type: "logicalOp" },
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
        return false;
    }
  }

  private getNestedValue(obj: Row, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
}
