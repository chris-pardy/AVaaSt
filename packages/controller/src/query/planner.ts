import { createLogger } from "@avaast/shared";
import type { Query, Source, Expression } from "@avaast/shared";

export interface QueryPlan {
  sources: SourcePlan[];
  pipeline: PipelineStep[];
}

export interface SourcePlan {
  alias: string;
  source: Source;
  isJoined: boolean;
}

export type PipelineStep =
  | { type: "fetch"; alias: string }
  | { type: "join"; joinType: string; alias: string; on: Expression }
  | { type: "filter"; expression: Expression }
  | { type: "group"; expressions: Expression[] }
  | { type: "having"; expression: Expression }
  | {
      type: "select";
      fields: Array<{ alias: string; value: Expression }>;
    }
  | { type: "distinct" }
  | {
      type: "orderBy";
      clauses: Array<{
        value: Expression;
        direction: string;
        nulls?: string;
      }>;
    }
  | { type: "limit"; limit: number; offset?: number };

export class QueryPlanner {
  private logger = createLogger("query-planner");

  plan(query: Query): QueryPlan {
    const sources: SourcePlan[] = [];
    const pipeline: PipelineStep[] = [];

    // Primary source
    sources.push({
      alias: query.from.alias,
      source: query.from,
      isJoined: false,
    });
    pipeline.push({ type: "fetch", alias: query.from.alias });

    // Joins
    if (query.joins) {
      for (const join of query.joins) {
        sources.push({
          alias: join.source.alias,
          source: join.source,
          isJoined: true,
        });
        pipeline.push({
          type: "join",
          joinType: join.joinType,
          alias: join.source.alias,
          on: join.on,
        });
      }
    }

    // WHERE
    if (query.where) {
      pipeline.push({ type: "filter", expression: query.where });
    }

    // GROUP BY
    if (query.groupBy?.length) {
      pipeline.push({ type: "group", expressions: query.groupBy });
    }

    // HAVING
    if (query.having) {
      pipeline.push({ type: "having", expression: query.having });
    }

    // SELECT
    pipeline.push({
      type: "select",
      fields: query.select.map((f) => ({ alias: f.alias, value: f.value })),
    });

    // DISTINCT
    if (query.distinct) {
      pipeline.push({ type: "distinct" });
    }

    // ORDER BY
    if (query.orderBy?.length) {
      pipeline.push({
        type: "orderBy",
        clauses: query.orderBy.map((o) => ({
          value: o.value,
          direction: o.direction,
          nulls: o.nulls,
        })),
      });
    }

    // LIMIT + OFFSET
    if (query.limit) {
      pipeline.push({
        type: "limit",
        limit: query.limit,
        offset: query.offset,
      });
    }

    this.logger.debug(
      `Query plan: ${pipeline.length} steps, ${sources.length} sources`,
    );
    return { sources, pipeline };
  }
}
