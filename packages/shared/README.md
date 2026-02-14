# @avaast/shared

Shared types, utilities, and protocol interfaces for the AVaaSt platform.

## Purpose

This package is the single source of truth for all TypeScript types across the monorepo.
It defines the Query DSL, record types, deploy lifecycle states, internal API contracts,
configuration schema, and common utilities. Every other AVaaSt package depends on it.

## Exports

### Types

| Export | Module | Description |
|--------|--------|-------------|
| `Query`, `Expression`, `Source`, ... | `types/lexicon` | Full Query DSL type hierarchy |
| `ComputedRecord`, `FunctionRecord`, `SearchIndexRecord`, `SubscriptionRecord` | `types/lexicon` | AT Protocol record types |
| `DeployRecord`, `AppViewRecord` | `types/lexicon` | Deploy and service records |
| `FieldSchema`, `NamedFieldSchema`, `OutputField` | `types/lexicon` | Schema definitions |
| `ResourceRef`, `TrafficRule` | `types/lexicon` | Core reference and routing types |
| `Config` | `types/config` | Configuration interface |
| `DeployState`, `DeployStatus`, `DeployManifest` | `types/deploy` | Deploy lifecycle types |
| `FunctionInput`, `FunctionOutput`, `DependencyHandle` | `types/function` | Function execution types |
| `QueryRequest`, `QueryResponse`, `FunctionCallRequest`, ... | `protocol/internal-api` | Controller API contracts |

### Values

| Export | Module | Description |
|--------|--------|-------------|
| `configSchema` | `types/config` | Zod schema for validating configuration |
| `parseConfig(raw)` | `types/config` | Validate and parse a config object |
| `createLogger(component)` | `utils/logger` | Create a component-scoped logger |
| `setLogLevel(level)` | `utils/logger` | Set minimum log level (`debug`, `info`, `warn`, `error`) |
| `retry(fn, options?)` | `utils/retry` | Retry with exponential backoff |

## Query DSL Type Hierarchy

The `Expression` union type is the core of the Query DSL:

```
Expression
├── FieldRef          { source, field }
├── Literal           { stringValue?, integerValue?, booleanValue? }
├── Comparison        { op, left, right }     — eq, neq, gt, lt, like, in, between, ...
├── LogicalOp         { op, operands }        — and, or, not
├── ArithmeticOp      { op, left, right }     — add, subtract, multiply, divide, modulo
├── BuiltinCall       { name, args }          — count, sum, avg, lower, coalesce, ...
├── FunctionCall      { name, args }          — user-defined function invocation
└── CaseExpression    { branches, elseValue } — conditional branching
```

A `Query` composes these expressions into a full query:

```
Query
├── select: SelectField[]        — output projection
├── from: Source                  — primary collection + alias
├── joins?: JoinClause[]         — inner, left, right, cross
├── where?: Expression           — filter
├── groupBy?: Expression[]       — grouping
├── having?: Expression          — post-group filter
├── orderBy?: OrderByClause[]    — sorting with direction and null placement
├── limit?, offset?              — pagination
└── distinct?                    — deduplication
```

## Deploy State Machine

```
PENDING → FETCHING → RESOLVING → BUILDING → ACTIVATING → ACTIVE → DRAINING → RETIRED
                                                                                  ↗
Any state ────────────────────────────────────────────────────────────→ FAILED
```
