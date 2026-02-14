// Resource reference - DID+CID pair
export interface ResourceRef {
  did: string;
  cid: string;
}

// Traffic rule for weighted routing
export interface TrafficRule {
  deploy: ResourceRef;
  weight: number; // basis points, 0-10000
}

// Field schema types
export interface FieldSchema {
  type:
    | "string"
    | "integer"
    | "boolean"
    | "float"
    | "datetime"
    | "bytes"
    | "array"
    | "object"
    | "unknown";
  description?: string;
  items?: FieldSchema;
  properties?: NamedFieldSchema[];
}

export interface NamedFieldSchema {
  name: string;
  schema: FieldSchema;
  required?: boolean;
}

export interface OutputField {
  name: string;
  alias?: string;
  schema: FieldSchema;
}

// Dependency injection
export interface Dependency {
  name: string;
  kind:
    | "computed"
    | "function"
    | "searchIndex"
    | "subscription"
    | "collection";
  ref?: ResourceRef;
  collection?: string; // NSID
}

// Query DSL types
export interface FieldRef {
  type: "fieldRef";
  source: string;
  field: string;
}

export interface Literal {
  type: "literal";
  stringValue?: string;
  integerValue?: number;
  booleanValue?: boolean;
}

export interface Comparison {
  type: "comparison";
  op:
    | "eq"
    | "neq"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "like"
    | "in"
    | "isNull"
    | "isNotNull"
    | "between"
    | "notIn";
  left: Expression;
  right?: Expression;
}

export interface LogicalOp {
  type: "logicalOp";
  op: "and" | "or" | "not";
  operands: Expression[];
}

export interface ArithmeticOp {
  type: "arithmeticOp";
  op: "add" | "subtract" | "multiply" | "divide" | "modulo";
  left: Expression;
  right: Expression;
}

export interface BuiltinCall {
  type: "builtinCall";
  name: string;
  args: Expression[];
}

export interface FunctionCall {
  type: "functionCall";
  ref: ResourceRef;
  args: Expression[];
}

export interface CaseBranch {
  when: Expression;
  then: Expression;
}

export interface CaseExpression {
  type: "caseExpression";
  branches: CaseBranch[];
  elseValue?: Expression;
}

export type Expression =
  | FieldRef
  | Literal
  | Comparison
  | LogicalOp
  | ArithmeticOp
  | BuiltinCall
  | FunctionCall
  | CaseExpression;

// Source and query types
export interface Source {
  alias: string;
  collection: string; // NSID
  did?: string;
}

export interface SelectField {
  alias: string;
  value: Expression;
}

export interface JoinClause {
  joinType: "inner" | "left" | "right" | "cross";
  source: Source;
  on: Expression;
}

export interface OrderByClause {
  value: Expression;
  direction: "asc" | "desc";
  nulls?: "first" | "last";
}

export interface Query {
  select: SelectField[];
  from: Source;
  joins?: JoinClause[];
  where?: Expression;
  groupBy?: Expression[];
  having?: Expression;
  orderBy?: OrderByClause[];
  limit?: number;
  offset?: number;
  distinct?: boolean;
}

export interface QueryParameter {
  name: string;
  type: "string" | "integer" | "boolean" | "float";
  required?: boolean;
  defaultValue?: string;
}

// Record types
export interface ComputedRecord {
  name: string;
  description?: string;
  query: Query;
  outputSchema: OutputField[];
  parameters?: QueryParameter[];
  cacheTtl?: number;
  createdAt: string;
}

export interface RuntimeConfig {
  timeoutMs?: number;
  memoryMb?: number;
}

export interface FunctionRecord {
  name: string;
  description?: string;
  code: { ref: { $link: string }; mimeType: string; size: number }; // blob ref
  mode: "read" | "write";
  inputSchema: NamedFieldSchema[];
  outputSchema: NamedFieldSchema[];
  dependencies?: Dependency[];
  runtime?: RuntimeConfig;
  createdAt: string;
}

export interface IndexedField {
  name: string;
  path: string;
  indexType: "fulltext" | "keyword" | "numeric" | "datetime" | "geo";
  analyzer?: "standard" | "simple" | "whitespace" | "language";
  language?: string;
  weight?: number;
}

export interface SearchParameter {
  name: string;
  type: "query" | "filter" | "sort" | "facet";
  field?: string;
  required?: boolean;
}

export interface SearchIndexRecord {
  name: string;
  description?: string;
  source: Source;
  fields: IndexedField[];
  parameters?: SearchParameter[];
  outputSchema: OutputField[];
  createdAt: string;
}

export interface SubscriptionRecord {
  name: string;
  description?: string;
  source: Source;
  filter?: Expression;
  fields: SelectField[];
  parameters?: QueryParameter[];
  outputSchema: OutputField[];
  createdAt: string;
}

export interface DeployedEndpoint {
  name: string;
  kind: "computed" | "function" | "searchIndex" | "subscription";
  ref: ResourceRef;
}

export interface DeployRecord {
  version?: string;
  description?: string;
  endpoints: DeployedEndpoint[];
  createdAt: string;
}

export interface AppViewRecord {
  name: string;
  description?: string;
  hostname?: string;
  trafficRules: TrafficRule[];
  status: "active" | "paused" | "draining";
  createdAt: string;
  updatedAt: string;
}
