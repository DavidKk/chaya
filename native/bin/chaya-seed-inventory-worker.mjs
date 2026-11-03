import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);
var __defProp = Object.defineProperty;
var __export = (target2, all) => {
  for (var name2 in all)
    __defProp(target2, name2, { get: all[name2], enumerable: true });
};

// services/translate/scheduler/seed-inventory-worker.ts
import fs20 from "node:fs";
import os2 from "node:os";
import path15 from "node:path";
import { parentPort as parentPort2, workerData } from "node:worker_threads";

// services/translate/shared-cache/index.ts
import fs11 from "node:fs";
import path9 from "node:path";

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/entity.js
var entityKind = /* @__PURE__ */ Symbol.for("drizzle:entityKind");
function is(value, type) {
  if (!value || typeof value !== "object") return false;
  if (value instanceof type) return true;
  if (!Object.prototype.hasOwnProperty.call(type, entityKind)) throw new Error(`Class "${type.name ?? "<unknown>"}" doesn't look like a Drizzle entity. If this is incorrect and the class is provided by Drizzle, please report this as a bug.`);
  let cls = Object.getPrototypeOf(value)?.constructor;
  if (cls) while (cls) {
    if (entityKind in cls && cls[entityKind] === type[entityKind]) return true;
    cls = Object.getPrototypeOf(cls);
  }
  return false;
}

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/query-promise.js
var QueryPromise = class {
  static [entityKind] = "QueryPromise";
  [Symbol.toStringTag] = "QueryPromise";
  catch(onRejected) {
    return this.then(void 0, onRejected);
  }
  finally(onFinally) {
    return this.then((value) => {
      onFinally?.();
      return value;
    }, (reason) => {
      onFinally?.();
      throw reason;
    });
  }
  then(onFulfilled, onRejected) {
    return this.execute().then(onFulfilled, onRejected);
  }
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/column-common.js
var OriginalColumn = /* @__PURE__ */ Symbol.for("drizzle:OriginalColumn");

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/column.js
var noop = (v) => v;
noop.isNoop = true;
var Column = class {
  static [entityKind] = "Column";
  /** @internal */
  codec;
  name;
  keyAsName;
  primary;
  notNull;
  default;
  defaultFn;
  onUpdateFn;
  hasDefault;
  isUnique;
  uniqueName;
  uniqueType;
  dataType;
  columnType;
  enumValues = void 0;
  generated = void 0;
  generatedIdentity = void 0;
  length;
  isLengthExact;
  isAlias;
  /** @internal */
  config;
  /** @internal */
  table;
  /** @internal */
  onInit() {
  }
  constructor(table, config) {
    this.config = config;
    this.onInit();
    this.table = table;
    this.name = config.name;
    this.isAlias = false;
    this.keyAsName = config.keyAsName;
    this.notNull = config.notNull;
    this.default = config.default;
    this.defaultFn = config.defaultFn;
    this.onUpdateFn = config.onUpdateFn;
    this.hasDefault = config.hasDefault;
    this.primary = config.primaryKey;
    this.isUnique = config.isUnique;
    this.uniqueName = config.uniqueName;
    this.uniqueType = config.uniqueType;
    this.dataType = config.dataType;
    this.columnType = config.columnType;
    this.generated = config.generated;
    this.generatedIdentity = config.generatedIdentity;
    this.length = config["length"];
    this.isLengthExact = config["isLengthExact"];
  }
  mapFromDriverValue = noop;
  mapToDriverValue = noop;
  /** @internal */
  postBuild() {
    return this;
  }
  /** @internal */
  shouldDisableInsert() {
    return this.config.generated !== void 0 && this.config.generated.type !== "byDefault";
  }
  /** @internal */
  [OriginalColumn]() {
    return this;
  }
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/table.utils.js
var TableName = /* @__PURE__ */ Symbol.for("drizzle:Name");

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/table.js
var TableSchema = /* @__PURE__ */ Symbol.for("drizzle:Schema");
var TableColumns = /* @__PURE__ */ Symbol.for("drizzle:Columns");
var ExtraConfigColumns = /* @__PURE__ */ Symbol.for("drizzle:ExtraConfigColumns");
var OriginalName = /* @__PURE__ */ Symbol.for("drizzle:OriginalName");
var BaseName = /* @__PURE__ */ Symbol.for("drizzle:BaseName");
var IsAlias = /* @__PURE__ */ Symbol.for("drizzle:IsAlias");
var ExtraConfigBuilder = /* @__PURE__ */ Symbol.for("drizzle:ExtraConfigBuilder");
var IsDrizzleTable = /* @__PURE__ */ Symbol.for("drizzle:IsDrizzleTable");
var Table = class {
  static [entityKind] = "Table";
  /** @internal */
  static Symbol = {
    Name: TableName,
    Schema: TableSchema,
    OriginalName,
    Columns: TableColumns,
    ExtraConfigColumns,
    BaseName,
    IsAlias,
    ExtraConfigBuilder
  };
  /**
  * @internal
  * Can be changed if the table is aliased.
  */
  [TableName];
  /**
  * @internal
  * Used to store the original name of the table, before any aliasing.
  */
  [OriginalName];
  /** @internal */
  [TableSchema];
  /** @internal */
  [TableColumns];
  /** @internal */
  [ExtraConfigColumns];
  /**
  *  @internal
  * Used to store the table name before the transformation via the `tableCreator` functions.
  */
  [BaseName];
  /** @internal */
  [IsAlias] = false;
  /** @internal */
  [IsDrizzleTable] = true;
  /** @internal */
  [ExtraConfigBuilder] = void 0;
  constructor(name2, schema, baseName) {
    this[TableName] = this[OriginalName] = name2;
    this[TableSchema] = schema;
    this[BaseName] = baseName;
  }
};
function getTableName(table) {
  return table[TableName];
}

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/subquery.js
var Subquery = class {
  static [entityKind] = "Subquery";
  constructor(sql2, fields2, alias, isWith = false, usedTables = []) {
    this._ = {
      brand: "Subquery",
      sql: sql2,
      selectedFields: fields2,
      alias,
      isWith,
      usedTables
    };
  }
};
var WithSubquery = class extends Subquery {
  static [entityKind] = "WithSubquery";
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/tracing.js
var tracer = { startActiveSpan(name2, fn) {
  return fn();
} };

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/view-common.js
var ViewBaseConfig = /* @__PURE__ */ Symbol.for("drizzle:ViewBaseConfig");

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sql/sql.js
var FakePrimitiveParam = class {
  static [entityKind] = "FakePrimitiveParam";
};
function isSQLWrapper(value) {
  return value !== null && value !== void 0 && typeof value.getSQL === "function";
}
function mergeQueries(queries) {
  const result = {
    sql: "",
    params: []
  };
  for (const query of queries) {
    result.sql += query.sql;
    result.params.push(...query.params);
  }
  return result;
}
function _mergeQueries(queries) {
  const result = {
    sql: "",
    params: []
  };
  const sqls = [];
  for (const query of queries) {
    sqls.push(query.sql);
    result.params.push(...query.params);
  }
  result._sql = Object.assign(sqls, { raw: sqls });
  return result;
}
var StringChunk = class {
  static [entityKind] = "StringChunk";
  value;
  constructor(value) {
    this.value = Array.isArray(value) ? value : [value];
  }
  getSQL() {
    return new SQL([this]);
  }
};
var SQL = class SQL2 {
  static [entityKind] = "SQL";
  /** @internal */
  decoder = noopDecoder;
  /** @internal */
  shouldInlineParams = false;
  /** @internal */
  usedTables = [];
  constructor(queryChunks) {
    this.queryChunks = queryChunks;
    for (const chunk of queryChunks) if (is(chunk, Table)) {
      const schemaName = chunk[Table.Symbol.Schema];
      this.usedTables.push(schemaName === void 0 ? chunk[Table.Symbol.Name] : schemaName + "." + chunk[Table.Symbol.Name]);
    }
  }
  append(query) {
    this.queryChunks.push(...query.queryChunks);
    return this;
  }
  toQuery(config) {
    return tracer.startActiveSpan("drizzle.buildSQL", (span) => {
      const query = this.buildQueryFromSourceParams(this.queryChunks, config);
      span?.setAttributes({
        "drizzle.query.text": query.sql,
        "drizzle.query.params": JSON.stringify(query.params)
      });
      return query;
    });
  }
  buildQueryFromSourceParams(chunks, _config) {
    const config = Object.assign({}, _config, {
      inlineParams: _config.inlineParams || this.shouldInlineParams,
      paramStartIndex: _config.paramStartIndex || { value: 0 }
    });
    const { escapeName, escapeParam, codecs, inlineParams, paramStartIndex, invokeSource } = config;
    const mappedChunks = chunks.map((chunk) => {
      if (is(chunk, StringChunk)) return {
        sql: chunk.value.join(""),
        params: []
      };
      if (is(chunk, Name)) return {
        sql: escapeName(chunk.value),
        params: []
      };
      if (chunk === void 0) return {
        sql: "",
        params: []
      };
      if (Array.isArray(chunk)) {
        const result = [new StringChunk("(")];
        for (const [i, p] of chunk.entries()) {
          result.push(p);
          if (i < chunk.length - 1) result.push(new StringChunk(", "));
        }
        result.push(new StringChunk(")"));
        return this.buildQueryFromSourceParams(result, config);
      }
      if (is(chunk, SQL2)) return this.buildQueryFromSourceParams(chunk.queryChunks, {
        ...config,
        inlineParams: inlineParams || chunk.shouldInlineParams
      });
      if (is(chunk, Table)) {
        const schemaName = chunk[Table.Symbol.Schema];
        const tableName = chunk[Table.Symbol.Name];
        if (invokeSource === "mssql-view-with-schemabinding") return {
          sql: (schemaName === void 0 ? escapeName("dbo") : escapeName(schemaName)) + "." + escapeName(tableName),
          params: []
        };
        return {
          sql: schemaName === void 0 || chunk[IsAlias] ? escapeName(tableName) : escapeName(schemaName) + "." + escapeName(tableName),
          params: []
        };
      }
      if (is(chunk, Column)) {
        const columnName = chunk.name;
        if (_config.invokeSource === "indexes") return {
          sql: escapeName(columnName),
          params: []
        };
        const schemaName = invokeSource === "mssql-check" ? void 0 : chunk.table[Table.Symbol.Schema];
        return {
          sql: chunk.isAlias ? escapeName(chunk.name) : chunk.table[IsAlias] || schemaName === void 0 ? escapeName(chunk.table[Table.Symbol.Name]) + "." + escapeName(columnName) : escapeName(schemaName) + "." + escapeName(chunk.table[Table.Symbol.Name]) + "." + escapeName(columnName),
          params: []
        };
      }
      if (is(chunk, View)) {
        const schemaName = chunk[ViewBaseConfig].schema;
        const viewName = chunk[ViewBaseConfig].name;
        return {
          sql: schemaName === void 0 || chunk[ViewBaseConfig].isAlias ? escapeName(viewName) : escapeName(schemaName) + "." + escapeName(viewName),
          params: []
        };
      }
      if (is(chunk, Param)) {
        if (is(chunk.value, SQL2)) return this.buildQueryFromSourceParams([chunk.value], config);
        const useCodecs = codecs && is(chunk.encoder, Column);
        if (is(chunk.value, Placeholder)) {
          const escaped2 = escapeParam(paramStartIndex.value++, chunk);
          chunk.codec = useCodecs ? (value) => codecs.apply(chunk.encoder, "normalizeParam", value) : void 0;
          return {
            sql: useCodecs ? codecs.apply(chunk.encoder, "castParam", escaped2) : escaped2,
            params: [chunk]
          };
        }
        let mappedValue;
        if (chunk.value === null) mappedValue = chunk.value;
        else {
          mappedValue = chunk.encoder.mapToDriverValue.isNoop ? chunk.value : chunk.encoder.mapToDriverValue(chunk.value);
          if (is(mappedValue, SQL2)) return this.buildQueryFromSourceParams([mappedValue], config);
          if (useCodecs) mappedValue = codecs.apply(chunk.encoder, "normalizeParam", mappedValue);
        }
        if (inlineParams) return {
          sql: this.mapInlineParam(mappedValue, config),
          params: []
        };
        const escaped = escapeParam(paramStartIndex.value++, mappedValue);
        return {
          sql: useCodecs ? codecs.apply(chunk.encoder, "castParam", escaped) : escaped,
          params: [mappedValue]
        };
      }
      if (is(chunk, Placeholder)) return {
        sql: escapeParam(paramStartIndex.value++, chunk),
        params: [chunk]
      };
      if (is(chunk, SQL2.Aliased) && chunk.fieldAlias !== void 0) return {
        sql: (chunk.origin !== void 0 ? escapeName(chunk.origin) + "." : "") + escapeName(chunk.fieldAlias),
        params: []
      };
      if (is(chunk, Subquery)) {
        if (chunk._.isWith) return {
          sql: escapeName(chunk._.alias),
          params: []
        };
        return this.buildQueryFromSourceParams([
          new StringChunk("("),
          chunk._.sql,
          new StringChunk(") "),
          new Name(chunk._.alias)
        ], config);
      }
      if (typeof chunk === "function" && "enumName" in chunk) {
        if ("schema" in chunk && chunk.schema) return {
          sql: escapeName(chunk.schema) + "." + escapeName(chunk.enumName),
          params: []
        };
        return {
          sql: escapeName(chunk.enumName),
          params: []
        };
      }
      if (isSQLWrapper(chunk)) {
        if (chunk.shouldOmitSQLParens?.()) return this.buildQueryFromSourceParams([chunk.getSQL()], config);
        return this.buildQueryFromSourceParams([
          new StringChunk("("),
          chunk.getSQL(),
          new StringChunk(")")
        ], config);
      }
      if (inlineParams) return {
        sql: this.mapInlineParam(chunk, config),
        params: []
      };
      return {
        sql: escapeParam(paramStartIndex.value++, chunk),
        params: [chunk]
      };
    });
    if (_config.tagged) return _mergeQueries(mappedChunks);
    return mergeQueries(mappedChunks);
  }
  mapInlineParam(chunk, { escapeString }) {
    if (chunk === null) return "null";
    if (typeof chunk === "number" || typeof chunk === "boolean" || typeof chunk === "bigint") return chunk.toString();
    if (typeof chunk === "string") return escapeString(chunk);
    if (typeof chunk === "object") {
      const mappedValueAsString = chunk.toString();
      if (mappedValueAsString === "[object Object]") return escapeString(JSON.stringify(chunk));
      return escapeString(mappedValueAsString);
    }
    throw new Error("Unexpected param value: " + chunk);
  }
  getSQL() {
    return this;
  }
  as(alias) {
    if (alias === void 0) return this;
    return new SQL2.Aliased(this, alias);
  }
  mapWith(decoder) {
    this.decoder = typeof decoder === "function" ? { mapFromDriverValue: decoder } : decoder;
    return this;
  }
  nullable() {
    return this;
  }
  inlineParams() {
    this.shouldInlineParams = true;
    return this;
  }
  /**
  * This method is used to conditionally include a part of the query.
  *
  * @param condition - Condition to check
  * @returns itself if the condition is `true`, otherwise `undefined`
  */
  if(condition) {
    return condition ? this : void 0;
  }
};
var Name = class {
  static [entityKind] = "Name";
  brand;
  constructor(value) {
    this.value = value;
  }
  getSQL() {
    return new SQL([this]);
  }
};
function isDriverValueEncoder(value) {
  return typeof value === "object" && value !== null && "mapToDriverValue" in value && typeof value.mapToDriverValue === "function";
}
var noopDecoder = { mapFromDriverValue: (value) => value };
noopDecoder.mapFromDriverValue.isNoop = true;
var noopEncoder = { mapToDriverValue: (value) => value };
noopEncoder.mapToDriverValue.isNoop = true;
var noopMapper = {
  ...noopDecoder,
  ...noopEncoder
};
var Param = class {
  static [entityKind] = "Param";
  brand;
  /**
  * @param value - Parameter value
  * @param encoder - Encoder to convert the value to a driver parameter
  */
  constructor(value, encoder = noopEncoder, codec) {
    this.value = value;
    this.encoder = encoder;
    this.codec = codec;
  }
  getSQL() {
    return new SQL([this]);
  }
};
function sql(strings2, ...params) {
  const queryChunks = [];
  if (params.length > 0 || strings2.length > 0 && strings2[0] !== "") queryChunks.push(new StringChunk(strings2[0]));
  for (const [paramIndex, param2] of params.entries()) queryChunks.push(param2, new StringChunk(strings2[paramIndex + 1]));
  return new SQL(queryChunks);
}
(function(_sql) {
  function empty() {
    return new SQL([]);
  }
  _sql.empty = empty;
  function fromList(list) {
    return new SQL(list);
  }
  _sql.fromList = fromList;
  function raw(str) {
    return new SQL([new StringChunk(str)]);
  }
  _sql.raw = raw;
  function join2(chunks, separator) {
    const result = [];
    for (const [i, chunk] of chunks.entries()) {
      if (i > 0 && separator !== void 0) result.push(separator);
      result.push(chunk);
    }
    return new SQL(result);
  }
  _sql.join = join2;
  function identifier(value) {
    return new Name(value);
  }
  _sql.identifier = identifier;
  function placeholder2(name2) {
    return new Placeholder(name2);
  }
  _sql.placeholder = placeholder2;
  function param2(value, encoder) {
    return new Param(value, encoder);
  }
  _sql.param = param2;
  function comment(input) {
    const encoded = sqlCommenter(input);
    if (!encoded.length) return void 0;
    return sql.raw(encoded);
  }
  _sql.comment = comment;
})(sql || (sql = {}));
function sqlCommenter(input) {
  const encoded = sqlCommenter.encodeInput(input);
  if (!encoded.length) return "";
  return `/*${encoded}*/`;
}
(function(_sqlCommenter) {
  function merge(input1, input2) {
    let encoded;
    if (typeof input1 === "object" && typeof input2 === "object") encoded = encodeInput({
      ...input1,
      ...input2
    });
    else if (input1 && input2) encoded = [encodeInput(input1), encodeInput(input2)].filter((i) => i.length).join(",");
    else if (input2) encoded = encodeInput(input2);
    else if (input1) encoded = encodeInput(input1);
    else return "";
    if (!encoded.length) return "";
    return `/*${encoded}*/`;
  }
  _sqlCommenter.merge = merge;
  function encodeInput(input) {
    if (typeof input === "string") {
      if (!input.length) return input;
      return sanitizeStringInput(input);
    }
    const parts = [];
    for (const [key2, value] of Object.entries(input)) {
      if (value === null || value === void 0 || value === "") continue;
      const encodedKey = sanitizeObjectElement(key2);
      const encodedValue = sanitizeObjectElement(String(value));
      parts.push(`${encodedKey}='${encodedValue}'`);
    }
    if (!parts.length) return "";
    return parts.sort().join(",");
  }
  _sqlCommenter.encodeInput = encodeInput;
  function sanitizeObjectElement(key2) {
    return encodeURIComponent(key2).replace(/'/g, `\\'`);
  }
  _sqlCommenter.sanitizeObjectElement = sanitizeObjectElement;
  function sanitizeStringInput(input) {
    return input.replace(/\/\*/g, "/ *").replace(/\*\//g, "* /");
  }
  _sqlCommenter.sanitizeStringInput = sanitizeStringInput;
})(sqlCommenter || (sqlCommenter = {}));
(function(_SQL) {
  class Aliased {
    static [entityKind] = "SQL.Aliased";
    /** @internal */
    isSelectionField = false;
    /** @internal */
    origin;
    constructor(sql2, fieldAlias) {
      this.sql = sql2;
      this.fieldAlias = fieldAlias;
    }
    getSQL() {
      return this.sql;
    }
    /** @internal */
    clone() {
      return new Aliased(this.sql, this.fieldAlias);
    }
  }
  _SQL.Aliased = Aliased;
})(SQL || (SQL = {}));
var Placeholder = class {
  static [entityKind] = "Placeholder";
  constructor(name2) {
    this.name = name2;
  }
  getSQL() {
    return new SQL([this]);
  }
};
function fillPlaceholders(params, values) {
  return params.map((p) => {
    if (is(p, Placeholder)) {
      if (!(p.name in values)) throw new Error(`No value for placeholder "${p.name}" was provided`);
      return values[p.name];
    }
    if (is(p, Param) && is(p.value, Placeholder)) {
      if (!(p.value.name in values)) throw new Error(`No value for placeholder "${p.value.name}" was provided`);
      const value = values[p.value.name];
      if (value === null) return value;
      const mapped = p.encoder.mapToDriverValue.isNoop ? value : p.encoder.mapToDriverValue(value);
      return p.codec ? p.codec(mapped) : mapped;
    }
    return p;
  });
}
var IsDrizzleView = /* @__PURE__ */ Symbol.for("drizzle:IsDrizzleView");
var View = class {
  static [entityKind] = "View";
  /** @internal */
  [ViewBaseConfig];
  /** @internal */
  [IsDrizzleView] = true;
  /** @internal */
  get [TableName]() {
    return this[ViewBaseConfig].name;
  }
  /** @internal */
  get [TableSchema]() {
    return this[ViewBaseConfig].schema;
  }
  /** @internal */
  get [IsAlias]() {
    return this[ViewBaseConfig].isAlias;
  }
  /** @internal */
  get [OriginalName]() {
    return this[ViewBaseConfig].originalName;
  }
  /** @internal */
  get [TableColumns]() {
    return this[ViewBaseConfig].selectedFields;
  }
  constructor({ name: name2, schema, selectedFields, query }) {
    this[ViewBaseConfig] = {
      name: name2,
      originalName: name2,
      schema,
      selectedFields,
      query,
      isExisting: !query,
      isAlias: false
    };
  }
};
Column.prototype.getSQL = function() {
  return new SQL([this]);
};
Subquery.prototype.getSQL = function() {
  return new SQL([this]);
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/errors.js
var DrizzleError = class extends Error {
  static [entityKind] = "DrizzleError";
  constructor({ message, cause }) {
    super(message);
    this.name = "DrizzleError";
    this.cause = cause;
  }
};
var DrizzleQueryError = class DrizzleQueryError2 extends Error {
  static [entityKind] = "DrizzleQueryError";
  constructor(query, params, cause) {
    super(`Failed query: ${query}
params: ${params}`);
    this.query = query;
    this.params = params;
    this.cause = cause;
    this.name = "DrizzleQueryError";
    Error.captureStackTrace(this, DrizzleQueryError2);
    if (cause) this.cause = cause;
  }
};
var TransactionRollbackError = class extends DrizzleError {
  static [entityKind] = "TransactionRollbackError";
  constructor() {
    super({ message: "Rollback" });
    this.name = "TransactionRollbackError";
  }
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sql/expressions/conditions.js
function bindIfParam(value, column) {
  if (isDriverValueEncoder(column) && !isSQLWrapper(value) && !is(value, Param) && !is(value, Placeholder) && !is(value, Column) && !is(value, Table) && !is(value, View)) return new Param(value, column);
  return value;
}
var eq = (left, right) => {
  return sql`${left} = ${bindIfParam(right, left)}`;
};
var ne = (left, right) => {
  return sql`${left} <> ${bindIfParam(right, left)}`;
};
function and(...unfilteredConditions) {
  const conditions = unfilteredConditions.filter((c) => c !== void 0);
  if (conditions.length === 0) return;
  if (conditions.length === 1) return new SQL(conditions);
  return new SQL([
    new StringChunk("("),
    sql.join(conditions.map((c) => sql`(${c})`), new StringChunk(" and ")),
    new StringChunk(")")
  ]);
}
function or(...unfilteredConditions) {
  const conditions = unfilteredConditions.filter((c) => c !== void 0);
  if (conditions.length === 0) return;
  if (conditions.length === 1) return new SQL(conditions);
  return new SQL([
    new StringChunk("("),
    sql.join(conditions.map((c) => sql`(${c})`), new StringChunk(" or ")),
    new StringChunk(")")
  ]);
}
function not(condition) {
  return is(condition, SQL) ? sql`not (${condition})` : sql`not ${condition}`;
}
var gt = (left, right) => {
  return sql`${left} > ${bindIfParam(right, left)}`;
};
var gte = (left, right) => {
  return sql`${left} >= ${bindIfParam(right, left)}`;
};
var lt = (left, right) => {
  return sql`${left} < ${bindIfParam(right, left)}`;
};
var lte = (left, right) => {
  return sql`${left} <= ${bindIfParam(right, left)}`;
};
function inArray(column, values) {
  if (Array.isArray(values)) {
    if (values.length === 0) return sql`false`;
    return sql`${column} in ${values.map((v) => bindIfParam(v, column))}`;
  }
  return sql`${column} in ${bindIfParam(values, column)}`;
}
function notInArray(column, values) {
  if (Array.isArray(values)) {
    if (values.length === 0) return sql`true`;
    return sql`${column} not in ${values.map((v) => bindIfParam(v, column))}`;
  }
  return sql`${column} not in ${bindIfParam(values, column)}`;
}
function isNull(value) {
  return sql`(${value} is null)`;
}
function isNotNull(value) {
  return sql`(${value} is not null)`;
}
function exists(subquery) {
  return sql`exists ${subquery}`;
}
function notExists(subquery) {
  return sql`not exists ${subquery}`;
}
function between(column, min2, max2) {
  return sql`${column} between ${bindIfParam(min2, column)} and ${bindIfParam(max2, column)}`;
}
function notBetween(column, min2, max2) {
  return sql`${column} not between ${bindIfParam(min2, column)} and ${bindIfParam(max2, column)}`;
}
function like(column, value) {
  return sql`${column} like ${value}`;
}
function notLike(column, value) {
  return sql`${column} not like ${value}`;
}
function ilike(column, value) {
  return sql`${column} ilike ${value}`;
}
function notIlike(column, value) {
  return sql`${column} not ilike ${value}`;
}
function arrayContains(column, values) {
  if (Array.isArray(values)) {
    if (values.length === 0) throw new Error("arrayContains requires at least one value");
    const par = bindIfParam(values, column);
    return sql`${column} @> ${sql`${Array.isArray(par) ? new Param(par) : par}`}`;
  }
  return sql`${column} @> ${bindIfParam(values, column)}`;
}
function arrayContained(column, values) {
  if (Array.isArray(values)) {
    if (values.length === 0) throw new Error("arrayContained requires at least one value");
    const par = bindIfParam(values, column);
    return sql`${column} <@ ${sql`${Array.isArray(par) ? new Param(par) : par}`}`;
  }
  return sql`${column} <@ ${bindIfParam(values, column)}`;
}
function arrayOverlaps(column, values) {
  if (Array.isArray(values)) {
    if (values.length === 0) throw new Error("arrayOverlaps requires at least one value");
    const par = bindIfParam(values, column);
    return sql`${column} && ${sql`${Array.isArray(par) ? new Param(par) : par}`}`;
  }
  return sql`${column} && ${bindIfParam(values, column)}`;
}

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sql/expressions/select.js
function asc(column) {
  return sql`${column} asc`;
}
function desc(column) {
  return sql`${column} desc`;
}

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/alias.js
var ColumnTableAliasProxyHandler = class {
  static [entityKind] = "ColumnTableAliasProxyHandler";
  constructor(table, ignoreColumnAlias) {
    this.table = table;
    this.ignoreColumnAlias = ignoreColumnAlias;
  }
  get(columnObj, prop) {
    if (prop === "table") return this.table;
    if (prop === "isAlias" && this.ignoreColumnAlias) return false;
    return columnObj[prop];
  }
};
var ViewSelectionAliasProxyHandler = class {
  static [entityKind] = "ViewSelectionAliasProxyHandler";
  constructor(view, selection, ignoreColumnAlias) {
    this.view = view;
    this.selection = selection;
    this.ignoreColumnAlias = ignoreColumnAlias;
  }
  get(selection, prop) {
    const value = selection[prop];
    if (is(value, Column)) return new Proxy(value, new ColumnTableAliasProxyHandler(this.view, this.ignoreColumnAlias));
    if (is(value, Subquery) || is(value, SQL) || is(value, SQL.Aliased) || isSQLWrapper(value) || typeof value !== "object" || value === null) return value;
    return new Proxy(value, this);
  }
};
var TableAliasProxyHandler = class {
  static [entityKind] = "TableAliasProxyHandler";
  constructor(alias, replaceOriginalName, ignoreColumnAlias) {
    this.alias = alias;
    this.replaceOriginalName = replaceOriginalName;
    this.ignoreColumnAlias = ignoreColumnAlias;
  }
  get(target2, prop) {
    if (prop === Table.Symbol.IsAlias) return true;
    if (prop === Table.Symbol.Name) return this.alias;
    if (this.replaceOriginalName && prop === Table.Symbol.OriginalName) return this.alias;
    if (prop === ViewBaseConfig) return {
      ...target2[ViewBaseConfig],
      name: this.alias,
      isAlias: true,
      selectedFields: new Proxy(target2[ViewBaseConfig].selectedFields, new ViewSelectionAliasProxyHandler(new Proxy(target2, this), target2[ViewBaseConfig].selectedFields, this.ignoreColumnAlias))
    };
    if (prop === Table.Symbol.Columns) {
      const columns = target2[Table.Symbol.Columns];
      if (!columns) return columns;
      if (is(target2, View)) return new Proxy(target2[Table.Symbol.Columns], new ViewSelectionAliasProxyHandler(new Proxy(target2, this), target2[Table.Symbol.Columns], this.ignoreColumnAlias));
      const proxiedColumns = {};
      Object.keys(columns).map((key2) => {
        proxiedColumns[key2] = new Proxy(columns[key2], new ColumnTableAliasProxyHandler(new Proxy(target2, this), this.ignoreColumnAlias));
      });
      return proxiedColumns;
    }
    const value = target2[prop];
    if (is(value, Column)) return new Proxy(value, new ColumnTableAliasProxyHandler(new Proxy(target2, this), this.ignoreColumnAlias));
    return value;
  }
};
var ColumnAliasProxyHandler = class {
  static [entityKind] = "ColumnAliasProxyHandler";
  constructor(alias) {
    this.alias = alias;
  }
  get(target2, prop) {
    if (prop === "isAlias") return true;
    if (prop === "name") return this.alias;
    if (prop === "keyAsName") return false;
    if (prop === OriginalColumn) return () => target2;
    return target2[prop];
  }
};
var RelationTableAliasProxyHandler = class {
  static [entityKind] = "RelationTableAliasProxyHandler";
  constructor(alias) {
    this.alias = alias;
  }
  get(target2, prop) {
    if (prop === "sourceTable") return aliasedTable(target2.sourceTable, this.alias);
    return target2[prop];
  }
};
function aliasedTable(table, tableAlias) {
  return new Proxy(table, new TableAliasProxyHandler(tableAlias, false, false));
}
function aliasedColumn(column, alias) {
  return new Proxy(column, new ColumnAliasProxyHandler(alias));
}
Column.prototype.as = function(alias) {
  return aliasedColumn(this, alias);
};
function getOriginalColumnFromAlias(column) {
  return column[OriginalColumn]();
}

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/utils.js
var FnConstructor = Object.getPrototypeOf(() => null).constructor;
function makeJitQueryMapperInner(columns, joinsNotNullableMap = {}) {
  const preFn = [];
  const fn = [];
  fn.push(`const [ ${columns.map((_, i) => `c${i}`).join(", ")} ] = rows[i];`);
  const nullifyMap = {};
  const objectIds = {};
  const decodes = Array.from({ length: columns.length });
  for (let idx = 0; idx < columns.length; ++idx) {
    const { field, path: path16, codec, arrayDimensions } = columns[idx];
    let decoder;
    let decoderStr;
    let decoderFieldDestructure;
    let isColumn = false;
    if (is(field, Column)) {
      isColumn = true;
      decoder = field;
      decoderFieldDestructure = `field: decoder${idx}`;
    } else if (is(field, SQL)) {
      decoder = field.decoder;
      decoderFieldDestructure = `field: { decoder: decoder${idx} }`;
    } else if (is(field, Subquery)) {
      decoder = field._.sql.decoder;
      decoderFieldDestructure = `field: { _: { sql: { decoder: decoder${idx} } } }`;
    } else {
      decoder = field.sql.decoder;
      decoderFieldDestructure = `field: { sql: { decoder: decoder${idx} } }`;
    }
    decoderStr = `decoder${idx}.mapFromDriverValue`;
    if (decoder.mapFromDriverValue.isNoop) decoderStr = "";
    if (decoderStr) preFn.push(`const { ${decoderFieldDestructure}${codec ? `, codec: codec${idx}` : ""} } = columns[${idx}];`);
    else if (codec) preFn.push(`const { codec: codec${idx} } = columns[${idx}];`);
    const colStr = `c${idx}`;
    let decodedValue = colStr;
    if (codec) decodedValue = `codec${idx}(${decodedValue}, ${arrayDimensions})`;
    if (decoderStr) decodedValue = `${decoderStr}(${decodedValue})`;
    decodes[idx] = colStr === decodedValue ? `${colStr}` : `${colStr} === null ? ${colStr} : ${decodedValue}`;
    if (path16.length !== 2 || !isColumn) continue;
    if (objectIds[path16[0]] === void 0) objectIds[path16[0]] = [`c${idx}`];
    else objectIds[path16[0]]?.push(`c${idx}`);
    const [objectName] = path16;
    const tableName = getTableName(field.table);
    nullifyMap[objectName] = joinsNotNullableMap[tableName] ? false : typeof nullifyMap[objectName] === "string" ? nullifyMap[objectName] === tableName ? tableName : false : tableName;
  }
  fn.push(`mapped[i] = {`);
  let currentObjectPath = [];
  for (let idx = 0; idx < columns.length; ++idx) {
    const { path: path16 } = columns[idx];
    const jsonPath = path16.map((e) => JSON.stringify(e));
    const decodedValue = decodes[idx];
    const objectPath = path16.slice(0, -1);
    let commonLen = 0;
    while (commonLen < currentObjectPath.length && commonLen < objectPath.length && currentObjectPath[commonLen] === objectPath[commonLen]) commonLen++;
    for (let d = currentObjectPath.length - 1; d >= commonLen; --d) fn.push(`${"	".repeat(d + 1)}},`);
    for (let d = commonLen; d < objectPath.length; ++d) fn.push(`${"	".repeat(d + 1)}${jsonPath[d]}: ${d === 0 && objectPath.length === 1 && typeof nullifyMap[path16[0]] === "string" ? `${objectIds[path16[0]]?.map((c) => `${c} === null`).join(" && ")} ? null : {` : "{"}`);
    currentObjectPath = objectPath;
    fn.push(`${"	".repeat(path16.length)}${jsonPath[path16.length - 1]}: ${decodedValue},`);
  }
  for (let d = currentObjectPath.length - 1; d >= 0; --d) fn.push(`${"	".repeat(d + 1)}},`);
  fn.push(`};`);
  return `${preFn.length ? `${preFn.join("\n	")}
	` : ""}for (let i = 0; i < length; ++i) {
		${fn.join("\n		")}
	}`;
}
function makeJitQueryMapper(columns, joinsNotNullableMap) {
  const internals = `	"use strict";
	const { columns } = this;
	const { length } = rows;
	const mapped = Array.from({ length });
	${makeJitQueryMapperInner(columns, joinsNotNullableMap)}
	return mapped;
	//# sourceURL=drizzle:jit-query-mapper`;
  return Object.assign(new FnConstructor("rows", internals).bind({ columns }), { body: `function jitQueryMapper (rows) {
${internals}
}` });
}
function jitCompatCheck(isEnabled) {
  if (!isEnabled) return false;
  try {
    const res = new FnConstructor("input", '"use strict"; return input;')(true);
    if (res !== true) {
      console.warn("Unable to use jit mappers due to incompatibility: corrupted jit function output.\nFalling back to premade mappers.\nError details:");
      console.error(`Expected to receive \`true\`, got: ${res}`);
    }
    return true;
  } catch (e) {
    console.warn("Unable to use jit mappers due to incompatibility.\nFalling back to premade mappers.\nError details:");
    console.error(e);
    return false;
  }
}
function makeDefaultQueryMapper(columns, joinsNotNullableMap) {
  const interpretedData = columns.map(({ field, codec, arrayDimensions, path: path16 }) => {
    let processNullifyMap;
    let decoderSrc;
    if (is(field, Column)) {
      decoderSrc = field;
      if (joinsNotNullableMap && path16.length === 2) {
        const objectName = path16[0];
        processNullifyMap = (nullifyMap, value) => {
          if (!(objectName in nullifyMap)) nullifyMap[objectName] = value === null ? getTableName(field.table) : false;
          else if (typeof nullifyMap[objectName] === "string" && nullifyMap[objectName] !== getTableName(field.table)) nullifyMap[objectName] = false;
        };
      }
    } else if (is(field, SQL)) decoderSrc = field.decoder;
    else if (is(field, Subquery)) decoderSrc = field._.sql.decoder;
    else decoderSrc = field.sql.decoder;
    let decoder;
    if (decoderSrc.mapFromDriverValue.isNoop) decoder = codec ? (v) => codec(v, arrayDimensions) : void 0;
    else decoder = codec ? (v) => decoderSrc.mapFromDriverValue(codec(v, arrayDimensions)) : (v) => decoderSrc.mapFromDriverValue(v);
    return [decoder, processNullifyMap];
  });
  return ((rows) => rows.map((row) => {
    const nullifyMap = {};
    const result = columns.reduce((result2, { path: path16 }, columnIndex) => {
      let node = result2;
      for (const [pathChunkIndex, pathChunk] of path16.entries()) if (pathChunkIndex < path16.length - 1) {
        if (!(pathChunk in node)) node[pathChunk] = {};
        node = node[pathChunk];
      } else {
        const [decoder, processNullifyMap] = interpretedData[columnIndex];
        const rawValue = row[columnIndex];
        const value = node[pathChunk] = rawValue === null ? null : decoder ? decoder(rawValue) : rawValue;
        processNullifyMap?.(nullifyMap, value);
      }
      return result2;
    }, {});
    if (joinsNotNullableMap && Object.keys(nullifyMap).length > 0) {
      for (const [objectName, tableName] of Object.entries(nullifyMap)) if (typeof tableName === "string" && !joinsNotNullableMap[tableName]) result[objectName] = null;
    }
    return result;
  }));
}
function orderSelectedFields(fields2, pathPrefix, codecs) {
  return Object.entries(fields2).reduce((result, [name2, field]) => {
    if (typeof name2 !== "string") return result;
    const newPath = pathPrefix ? [...pathPrefix, name2] : [name2];
    if (is(field, Column)) result.push({
      path: newPath,
      field,
      codec: codecs?.get(field, "normalize"),
      arrayDimensions: field.dimensions,
      column: field
    });
    else if (is(field, SQL) || is(field, SQL.Aliased)) {
      const col = getColumnFromDecoder(field);
      result.push(col ? {
        path: newPath,
        field,
        codec: codecs?.get(col, "normalize"),
        arrayDimensions: col.dimensions,
        column: col
      } : {
        path: newPath,
        field
      });
    } else if (is(field, Subquery)) {
      let column;
      const entry = Object.values(field._.selectedFields)[0];
      let fieldDecoder;
      if (is(entry, Column)) {
        column = entry;
        fieldDecoder = entry;
      } else if (is(entry, SQL)) {
        column = getColumnFromDecoder(entry);
        fieldDecoder = entry.decoder;
      } else {
        column = getColumnFromDecoder(entry);
        fieldDecoder = entry.sql.decoder;
      }
      if (fieldDecoder) field._.sql.decoder = fieldDecoder;
      result.push(column ? {
        path: newPath,
        field,
        codec: codecs?.get(column, "normalize"),
        arrayDimensions: column.dimensions,
        column
      } : {
        path: newPath,
        field
      });
    } else if (is(field, Table)) result.push(...orderSelectedFields(field[Table.Symbol.Columns], newPath, codecs));
    else result.push(...orderSelectedFields(field, newPath, codecs));
    return result;
  }, []);
}
function getColumnFromDecoder(source) {
  const query = source.getSQL();
  if (is(query.decoder, Column)) return query.decoder;
}
function haveSameKeys(left, right) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const [index2, key2] of leftKeys.entries()) if (key2 !== rightKeys[index2]) return false;
  return true;
}
function mapUpdateSet(table, values) {
  const entries = Object.entries(values).filter(([, value]) => value !== void 0).map(([key2, value]) => {
    if (is(value, SQL) || is(value, Column)) return [key2, value];
    else return [key2, new Param(value, table[Table.Symbol.Columns][key2])];
  });
  if (entries.length === 0) throw new Error("No values to set");
  return Object.fromEntries(entries);
}
function applyMixins(baseClass, extendedClasses) {
  for (const extendedClass of extendedClasses) for (const name2 of Object.getOwnPropertyNames(extendedClass.prototype)) {
    if (name2 === "constructor") continue;
    Object.defineProperty(baseClass.prototype, name2, Object.getOwnPropertyDescriptor(extendedClass.prototype, name2) || /* @__PURE__ */ Object.create(null));
  }
}
function getTableColumns(table) {
  return table[Table.Symbol.Columns];
}
function getTableLikeName(table) {
  return is(table, Subquery) ? table._.alias : is(table, View) ? table[ViewBaseConfig].name : is(table, SQL) ? void 0 : table[Table.Symbol.IsAlias] ? table[Table.Symbol.Name] : table[Table.Symbol.BaseName];
}
function getColumnNameAndConfig(a, b) {
  return {
    name: typeof a === "string" && a.length > 0 ? a : "",
    config: typeof a === "object" ? a : b
  };
}
var textDecoder = typeof TextDecoder === "undefined" ? null : new TextDecoder();
function assertUnreachable(_x) {
  throw new Error("Didn't expect to get here");
}

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/relations.js
var Relation = class {
  static [entityKind] = "RelationV2";
  fieldName;
  sourceColumns;
  targetColumns;
  alias;
  where;
  sourceTable;
  targetTable;
  through;
  throughTable;
  isReversed;
  /** @internal */
  sourceColumnTableNames = [];
  /** @internal */
  targetColumnTableNames = [];
  constructor(targetTable, targetTableName) {
    this.targetTableName = targetTableName;
    this.targetTable = targetTable;
  }
};
var One = class extends Relation {
  static [entityKind] = "OneV2";
  relationType = "one";
  optional;
  constructor(tables, targetTable, targetTableName, config) {
    super(targetTable, targetTableName);
    this.alias = config?.alias;
    this.where = config?.where;
    if (config?.from) this.sourceColumns = (Array.isArray(config.from) ? config.from : [config.from]).map((it) => {
      this.throughTable ??= it._.through ? tables[it._.through._.tableName] : void 0;
      this.sourceColumnTableNames.push(it._.tableName);
      return it._.column;
    });
    if (config?.to) this.targetColumns = (Array.isArray(config.to) ? config.to : [config.to]).map((it) => {
      this.throughTable ??= it._.through ? tables[it._.through._.tableName] : void 0;
      this.targetColumnTableNames.push(it._.tableName);
      return it._.column;
    });
    if (this.throughTable) this.through = {
      source: (Array.isArray(config?.from) ? config.from : config?.from ? [config.from] : []).map((c) => c._.through),
      target: (Array.isArray(config?.to) ? config.to : config?.to ? [config.to] : []).map((c) => c._.through)
    };
    this.optional = config?.optional ?? true;
  }
};
var Many = class extends Relation {
  static [entityKind] = "ManyV2";
  relationType = "many";
  constructor(tables, targetTable, targetTableName, config) {
    super(targetTable, targetTableName);
    this.config = config;
    this.alias = config?.alias;
    this.where = config?.where;
    if (config?.from) this.sourceColumns = (Array.isArray(config.from) ? config.from : [config.from]).map((it) => {
      this.throughTable ??= it._.through ? tables[it._.through._.tableName] : void 0;
      this.sourceColumnTableNames.push(it._.tableName);
      return it._.column;
    });
    if (config?.to) this.targetColumns = (Array.isArray(config.to) ? config.to : [config.to]).map((it) => {
      this.throughTable ??= it._.through ? tables[it._.through._.tableName] : void 0;
      this.targetColumnTableNames.push(it._.tableName);
      return it._.column;
    });
    if (this.throughTable) this.through = {
      source: (Array.isArray(config?.from) ? config.from : config?.from ? [config.from] : []).map((c) => c._.through),
      target: (Array.isArray(config?.to) ? config.to : config?.to ? [config.to] : []).map((c) => c._.through)
    };
  }
};
var AggregatedField = class {
  static [entityKind] = "AggregatedField";
  table;
  onTable(table) {
    this.table = table;
    return this;
  }
};
var Count = class extends AggregatedField {
  static [entityKind] = "AggregatedFieldCount";
  query;
  getSQL() {
    if (!this.query) {
      if (!this.table) throw new Error("Table must be set before building aggregate field");
      this.query = sql`select count(*) as ${sql.identifier("r")} from ${getTableAsAliasSQL(this.table)}`.mapWith(Number);
    }
    return this.query;
  }
};
var operators = {
  and,
  between,
  eq,
  exists,
  gt,
  gte,
  ilike,
  inArray,
  arrayContains,
  arrayContained,
  arrayOverlaps,
  isNull,
  isNotNull,
  like,
  lt,
  lte,
  ne,
  not,
  notBetween,
  notExists,
  notLike,
  notIlike,
  notInArray,
  or,
  sql
};
var orderByOperators = {
  sql,
  asc,
  desc
};
function mapRelationalRow(rows, isOne, buildQueryResultSelection, parseJson = false, parseJsonIfString = false, useJsonMappers = true) {
  const maxIdx = isOne ? 1 : rows.length;
  const decoders = buildQueryResultSelection.map(({ field, codec, arrayDimensions }) => {
    let decoder;
    if (is(field, Column)) decoder = field;
    else if (is(field, SQL)) decoder = field.decoder;
    else if (is(field, SQL.Aliased)) decoder = field.sql.decoder;
    else if (is(field, Table) || is(field, View)) decoder = noopDecoder;
    else decoder = field.getSQL().decoder;
    if (useJsonMappers && field.mapFromJsonValue) return (v) => field.mapFromJsonValue(v);
    return decoder.mapFromDriverValue.isNoop ? codec ? (value) => codec(value, arrayDimensions) : void 0 : codec ? (value) => decoder.mapFromDriverValue(codec(value, arrayDimensions)) : (value) => decoder.mapFromDriverValue(value);
  });
  for (let i = 0; i < maxIdx; ++i) {
    const row = isOne ? rows : rows[i];
    for (let selectionItemIdx = 0; selectionItemIdx < buildQueryResultSelection.length; ++selectionItemIdx) {
      const selectionItem = buildQueryResultSelection[selectionItemIdx];
      if (selectionItem.selection) {
        if (row[selectionItem.key] === null) continue;
        if (parseJson) {
          row[selectionItem.key] = JSON.parse(row[selectionItem.key]);
          if (row[selectionItem.key] === null) continue;
        } else if (parseJsonIfString && typeof row[selectionItem.key] === "string") row[selectionItem.key] = JSON.parse(row[selectionItem.key]);
        if (selectionItem.isArray) {
          mapRelationalRow(row[selectionItem.key], false, selectionItem.selection, false, parseJsonIfString);
          continue;
        }
        mapRelationalRow(row[selectionItem.key], true, selectionItem.selection, false, parseJsonIfString);
        continue;
      }
      if (row[selectionItem.key] === null) continue;
      const decoder = decoders[selectionItemIdx];
      if (!decoder) continue;
      row[selectionItem.key] = decoder(row[selectionItem.key]);
    }
  }
  return rows;
}
function mapRelationalRowFromArrays(rows, isOne, buildQueryResultSelection, parseJson = false, parseJsonIfString = false) {
  const maxIdx = isOne ? 1 : rows.length;
  const decoders = buildQueryResultSelection.map(({ field, codec, arrayDimensions }) => {
    let decoder;
    if (is(field, Column)) decoder = field;
    else if (is(field, SQL)) decoder = field.decoder;
    else if (is(field, SQL.Aliased)) decoder = field.sql.decoder;
    else if (is(field, Table) || is(field, View)) decoder = noopDecoder;
    else decoder = field.getSQL().decoder;
    return decoder.mapFromDriverValue.isNoop ? codec ? (value) => codec(value, arrayDimensions) : void 0 : codec ? (value) => decoder.mapFromDriverValue(codec(value, arrayDimensions)) : (value) => decoder.mapFromDriverValue(value);
  });
  const results = Array.from({ length: maxIdx });
  for (let i = 0; i < maxIdx; ++i) {
    const row = isOne ? rows : rows[i];
    const result = {};
    for (let selectionItemIdx = 0; selectionItemIdx < buildQueryResultSelection.length; ++selectionItemIdx) {
      const selectionItem = buildQueryResultSelection[selectionItemIdx];
      let value = row[selectionItemIdx];
      if (selectionItem.selection) {
        if (value === null) {
          result[selectionItem.key] = null;
          continue;
        }
        if (parseJson) {
          value = JSON.parse(value);
          if (value === null) {
            result[selectionItem.key] = null;
            continue;
          }
        } else if (parseJsonIfString && typeof value === "string") value = JSON.parse(value);
        if (selectionItem.isArray) mapRelationalRow(value, false, selectionItem.selection, false, parseJsonIfString);
        else mapRelationalRow(value, true, selectionItem.selection, false, parseJsonIfString);
        result[selectionItem.key] = value;
        continue;
      }
      if (value === null) {
        result[selectionItem.key] = null;
        continue;
      }
      const decoder = decoders[selectionItemIdx];
      result[selectionItem.key] = decoder ? decoder(value) : value;
    }
    results[i] = result;
  }
  return isOne ? results[0] : results;
}
function makeDefaultRqbMapper({ selection, isFirst, parseJson, parseJsonIfString, rootJsonMappers, arrayModeRoot }) {
  return ((rows) => {
    if (isFirst && !rows[0]) return rows[0];
    return arrayModeRoot ? mapRelationalRowFromArrays(isFirst ? rows[0] : rows, isFirst, selection, parseJson, parseJsonIfString) : mapRelationalRow(isFirst ? rows[0] : rows, isFirst, selection, parseJson, parseJsonIfString, rootJsonMappers);
  });
}
function makeJitRqbMapperInner(selection, rowExpr, selectionVar, parseJson, parseJsonIfString, useJsonMappers, preFn, counter, accessByIdx) {
  const bodyStmts = [];
  const literalEntries = [];
  let hasWork = false;
  const fieldVars = selection.map(() => `c${counter.n++}`);
  const destructurePieces = selection.map((item, idx) => accessByIdx ? fieldVars[idx] : `${JSON.stringify(item.key)}: ${fieldVars[idx]}`);
  bodyStmts.push(accessByIdx ? `let [ ${destructurePieces.join(", ")} ] = ${rowExpr};` : `let { ${destructurePieces.join(", ")} } = ${rowExpr};`);
  for (const [idx, { field, key: key2, codec, isArray, selection: innerSelection, arrayDimensions }] of selection.entries()) {
    const sel = `${selectionVar}[${idx}]`;
    const keyStr = JSON.stringify(key2);
    const slot = fieldVars[idx];
    if (innerSelection) {
      if (parseJson) {
        bodyStmts.push(`if (${slot} !== null) ${slot} = JSON.parse(${slot});`);
        hasWork = true;
      } else if (parseJsonIfString) {
        bodyStmts.push(`if (typeof ${slot} === 'string') ${slot} = JSON.parse(${slot});`);
        hasWork = true;
      }
      const nestedSelVar = `s${counter.n++}`;
      const savedPreFnLen = preFn.length;
      preFn.push(`const { selection: ${nestedSelVar} } = ${sel};`);
      if (isArray) {
        const j = `j${counter.n++}`;
        const inner = makeJitRqbMapperInner(innerSelection, `${slot}[${j}]`, nestedSelVar, false, parseJsonIfString, true, preFn, counter, false);
        if (inner.hasWork) {
          hasWork = true;
          bodyStmts.push(`if (${slot} !== null) {`);
          bodyStmts.push(`	for (let ${j} = 0; ${j} < ${slot}.length; ++${j}) {`);
          for (const s of inner.bodyStmts) bodyStmts.push(`		${s}`);
          bodyStmts.push(`		${slot}[${j}] = ${inner.literal};`);
          bodyStmts.push(`	}`);
          bodyStmts.push(`}`);
        } else preFn.splice(savedPreFnLen, 1);
      } else {
        const inner = makeJitRqbMapperInner(innerSelection, slot, nestedSelVar, false, parseJsonIfString, true, preFn, counter, false);
        if (inner.hasWork) {
          hasWork = true;
          bodyStmts.push(`if (${slot} !== null) {`);
          for (const s of inner.bodyStmts) bodyStmts.push(`	${s}`);
          bodyStmts.push(`	${slot} = ${inner.literal};`);
          bodyStmts.push(`}`);
        } else preFn.splice(savedPreFnLen, 1);
      }
      literalEntries.push(`${keyStr}: ${slot}`);
      continue;
    }
    let decoderExpr = "";
    let destructure = "";
    let bypassCodecs = false;
    if (is(field, Column)) {
      if (useJsonMappers && field.mapFromJsonValue) {
        bypassCodecs = true;
        const id = counter.n++;
        destructure = `field: dec${id}`;
        decoderExpr = `dec${id}.mapFromJsonValue`;
      } else if (!field.mapFromDriverValue.isNoop) {
        const id = counter.n++;
        destructure = `field: dec${id}`;
        decoderExpr = `dec${id}.mapFromDriverValue`;
      }
    } else if (is(field, SQL)) {
      if (useJsonMappers && field.decoder.mapFromJsonValue) {
        bypassCodecs = true;
        const id = counter.n++;
        destructure = `field: { decoder: dec${id} }`;
        decoderExpr = `dec${id}.mapFromJsonValue`;
      } else if (!field.decoder.mapFromDriverValue.isNoop) {
        const id = counter.n++;
        destructure = `field: { decoder: dec${id} }`;
        decoderExpr = `dec${id}.mapFromDriverValue`;
      }
    } else if (is(field, SQL.Aliased)) {
      if (useJsonMappers && field.sql.decoder.mapFromJsonValue) {
        bypassCodecs = true;
        const id = counter.n++;
        destructure = `field: { sql: { decoder: dec${id} } }`;
        decoderExpr = `dec${id}.mapFromJsonValue`;
      } else if (!field.sql.decoder.mapFromDriverValue.isNoop) {
        const id = counter.n++;
        destructure = `field: { sql: { decoder: dec${id} } }`;
        decoderExpr = `dec${id}.mapFromDriverValue`;
      }
    } else if (is(field, Table) || is(field, View)) {
    } else {
      const sqlExpr = field.getSQL();
      if (useJsonMappers && sqlExpr.decoder.mapFromJsonValue) {
        bypassCodecs = true;
        const id = counter.n++;
        preFn.push(`const dec${id} = ${sel}.field.getSQL().decoder;`);
        decoderExpr = `dec${id}.mapFromJsonValue`;
      } else if (!sqlExpr.decoder.mapFromDriverValue.isNoop) {
        const id = counter.n++;
        preFn.push(`const dec${id} = ${sel}.field.getSQL().decoder;`);
        decoderExpr = `dec${id}.mapFromDriverValue`;
      }
    }
    let codecVar = "";
    if (!bypassCodecs && codec) codecVar = `codec${counter.n++}`;
    if (destructure || codecVar) {
      const parts = [];
      if (destructure) parts.push(destructure);
      if (codecVar) parts.push(`codec: ${codecVar}`);
      preFn.push(`const { ${parts.join(", ")} } = ${sel};`);
    }
    if (decoderExpr || codecVar) {
      hasWork = true;
      let decoded = slot;
      if (codecVar) decoded = `${codecVar}(${decoded}, ${arrayDimensions})`;
      if (decoderExpr) decoded = `${decoderExpr}(${decoded})`;
      literalEntries.push(`${keyStr}: ${slot} === null ? null : ${decoded}`);
    } else literalEntries.push(`${keyStr}: ${slot}`);
  }
  return {
    bodyStmts,
    literal: `{ ${literalEntries.join(", ")} }`,
    hasWork
  };
}
function makeJitRqbMapper({ selection, isFirst, parseJson, parseJsonIfString, rootJsonMappers, arrayModeRoot }) {
  const preFn = [];
  const inner = makeJitRqbMapperInner(selection, "row", "selection", parseJson, parseJsonIfString, arrayModeRoot ? false : rootJsonMappers, preFn, { n: 0 }, !!arrayModeRoot);
  const lines = [];
  lines.push(`	"use strict";
	const { selection } = this;`);
  for (const p of preFn) lines.push(`	${p}`);
  if (arrayModeRoot) if (isFirst) {
    lines.push(`	const row = rows[0];`);
    lines.push(`	if (!row) return undefined;`);
    for (const s of inner.bodyStmts) lines.push(`	${s}`);
    lines.push(`	return ${inner.literal};`);
  } else {
    lines.push(`	const { length } = rows;`);
    lines.push(`	const mapped = Array.from({ length });`);
    lines.push(`	for (let i = 0; i < length; ++i) {`);
    lines.push(`		const row = rows[i];`);
    for (const s of inner.bodyStmts) lines.push(`		${s}`);
    lines.push(`		mapped[i] = ${inner.literal};`);
    lines.push(`	}`);
    lines.push(`	return mapped;`);
  }
  else if (!inner.hasWork) lines.push(isFirst ? `	return rows[0];` : `	return rows;`);
  else if (isFirst) {
    lines.push(`	const row = rows[0];`);
    lines.push(`	if (!row) return undefined;`);
    for (const s of inner.bodyStmts) lines.push(`	${s}`);
    lines.push(`	rows[0] = ${inner.literal};`);
    lines.push(`	return rows[0];`);
  } else {
    lines.push(`	for (let i = 0; i < rows.length; ++i) {`);
    lines.push(`		const row = rows[i];`);
    for (const s of inner.bodyStmts) lines.push(`		${s}`);
    lines.push(`		rows[i] = ${inner.literal};`);
    lines.push(`	}`);
    lines.push(`	return rows;`);
  }
  lines.push("	//# sourceURL=drizzle:jit-relational-query-mapper");
  const compiled = lines.join("\n");
  return Object.assign(new FnConstructor("rows", compiled).bind({ selection }), { body: `function jitRqbMapper (rows) {
${compiled}
}` });
}
var RelationsBuilderTable = class {
  static [entityKind] = "RelationsBuilderTable";
  _;
  constructor(table, name2) {
    this._ = {
      name: name2,
      table
    };
  }
};
var RelationsBuilderColumn = class {
  static [entityKind] = "RelationsBuilderColumn";
  _;
  constructor(column, tableName, key2) {
    this._ = {
      tableName,
      column,
      key: key2
    };
  }
  through(column) {
    return new RelationsBuilderJunctionColumn(this._.column, this._.tableName, this._.key, column);
  }
};
var RelationsBuilderJunctionColumn = class {
  static [entityKind] = "RelationsBuilderColumn";
  _;
  constructor(column, tableName, key2, through) {
    this._ = {
      tableName,
      column,
      through,
      key: key2
    };
  }
};
var RelationsHelperStatic = class {
  static [entityKind] = "RelationsHelperStatic";
  _;
  constructor(tables) {
    this._ = { tables };
    const one = {};
    const many = {};
    for (const [tableName, table] of Object.entries(tables)) {
      one[tableName] = (config) => {
        return new One(tables, table, tableName, config);
      };
      many[tableName] = (config) => {
        return new Many(tables, table, tableName, config);
      };
    }
    this.one = one;
    this.many = many;
  }
  one;
  many;
  /** @internal - to be reworked */
  aggs = { count() {
    return new Count();
  } };
};
function fieldSelectionToSQL(table, target2) {
  const field = table[TableColumns][target2];
  return field ? is(field, Column) ? field : is(field, SQL.Aliased) ? sql`${table}.${sql.identifier(field.fieldAlias)}` : sql`${table}.${sql.identifier(target2)}` : sql`${table}.${sql.identifier(target2)}`;
}
function relationsFieldFilterToSQL(column, filter2) {
  if (typeof filter2 !== "object" || is(filter2, Placeholder)) return eq(column, filter2);
  const entries = Object.entries(filter2);
  if (!entries.length) return void 0;
  const parts = [];
  for (const [target2, value] of entries) {
    if (value === void 0) continue;
    switch (target2) {
      case "NOT": {
        const res = relationsFieldFilterToSQL(column, value);
        if (!res) continue;
        parts.push(not(res));
        continue;
      }
      case "OR":
        if (!value.length) continue;
        parts.push(or(...value.map((subFilter) => relationsFieldFilterToSQL(column, subFilter))));
        continue;
      case "AND":
        if (!value.length) continue;
        parts.push(and(...value.map((subFilter) => relationsFieldFilterToSQL(column, subFilter))));
        continue;
      case "isNotNull":
      case "isNull":
        if (!value) continue;
        parts.push(operators[target2](column));
        continue;
      case "in":
        parts.push(operators.inArray(column, value));
        continue;
      case "notIn":
        parts.push(operators.notInArray(column, value));
        continue;
      default:
        parts.push(operators[target2](column, value));
        continue;
    }
  }
  if (!parts.length) return void 0;
  return and(...parts);
}
function relationsFilterToSQL(table, filter2, tableRelations = {}, tablesRelations = {}, depth = 0) {
  const entries = Object.entries(filter2);
  if (!entries.length) return void 0;
  const parts = [];
  for (const [target2, value] of entries) {
    if (value === void 0) continue;
    switch (target2) {
      case "RAW": {
        const processed = typeof value === "function" ? value(table, operators) : value.getSQL();
        parts.push(processed);
        continue;
      }
      case "OR":
        if (!value?.length) continue;
        parts.push(or(...value.map((subFilter) => relationsFilterToSQL(table, subFilter, tableRelations, tablesRelations, depth))));
        continue;
      case "AND":
        if (!value?.length) continue;
        parts.push(and(...value.map((subFilter) => relationsFilterToSQL(table, subFilter, tableRelations, tablesRelations, depth))));
        continue;
      case "NOT": {
        if (value === void 0) continue;
        const built = relationsFilterToSQL(table, value, tableRelations, tablesRelations, depth);
        if (!built) continue;
        parts.push(not(built));
        continue;
      }
      default: {
        if (table[TableColumns][target2]) {
          const colFilter = relationsFieldFilterToSQL(fieldSelectionToSQL(table, target2), value);
          if (colFilter) parts.push(colFilter);
          continue;
        }
        const relation = tableRelations[target2];
        if (!relation) throw new DrizzleError({ message: `Unknown relational filter field: "${target2}"` });
        const targetTable = aliasedTable(relation.targetTable, `f${depth}`);
        const throughTable = relation.throughTable ? aliasedTable(relation.throughTable, `ft${depth}`) : void 0;
        const targetConfig = tablesRelations[relation.targetTableName];
        const { filter: relationFilter, joinCondition } = relationToSQL(relation, table, targetTable, throughTable);
        const filter3 = and(relationFilter, typeof value === "boolean" ? void 0 : relationsFilterToSQL(targetTable, value, targetConfig.relations, tablesRelations, depth + 1));
        const subquery = throughTable ? sql`(select * from ${getTableAsAliasSQL(targetTable)} inner join ${getTableAsAliasSQL(throughTable)} on ${joinCondition}${sql` where ${filter3}`.if(filter3)} limit 1)` : sql`(select * from ${getTableAsAliasSQL(targetTable)}${sql` where ${filter3}`.if(filter3)} limit 1)`;
        if (filter3) parts.push((value ? exists : notExists)(subquery));
      }
    }
  }
  return and(...parts);
}
function relationsOrderToSQL(table, orders) {
  if (typeof orders === "function") {
    const data = orders(table, orderByOperators);
    return is(data, SQL) ? data : Array.isArray(data) ? data.length ? sql.join(data.map((o) => is(o, SQL) ? o : asc(o)), sql`, `) : void 0 : is(data, Column) ? asc(data) : void 0;
  }
  const entries = Object.entries(orders).filter(([_, value]) => value);
  if (!entries.length) return void 0;
  return sql.join(entries.map(([target2, value]) => (value === "asc" ? asc : desc)(fieldSelectionToSQL(table, target2))), sql`, `);
}
function relationExtrasToSQL(table, extras, codecs, inJson) {
  const subqueries = [];
  const selection = [];
  for (const [key2, field] of Object.entries(extras)) {
    if (!field) continue;
    const subq = (typeof field === "function" ? field(table, { sql: operators.sql }) : field).getSQL();
    const column = codecs ? getColumnFromDecoder(subq) : void 0;
    const query = column && (!inJson || !column.jsonSelectIdentifier) ? sql`${codecs.apply(column, inJson ? "castInJson" : "cast", sql`(${subq})`)} as ${sql.identifier(key2)}` : sql`(${subq}) as ${sql.identifier(key2)}`;
    query.decoder = subq.decoder;
    subqueries.push(query);
    selection.push(column && (!inJson || !column.mapFromJsonValue) ? {
      key: key2,
      field: query,
      codec: codecs.get(column, inJson ? "normalizeInJson" : "normalize"),
      arrayDimensions: column.dimensions
    } : {
      key: key2,
      field: query
    });
  }
  return {
    sql: subqueries.length ? sql.join(subqueries, sql`, `) : void 0,
    selection
  };
}
function relationToSQL(relation, sourceTable, targetTable, throughTable) {
  if (relation.through) {
    const outerColumnWhere = relation.sourceColumns.map((s, i) => {
      const t = relation.through.source[i];
      return eq(sql`${sourceTable}.${sql.identifier(s.name)}`, sql`${throughTable}.${sql.identifier(is(t._.column, Column) ? t._.column.name : t._.key)}`);
    });
    const innerColumnWhere = relation.targetColumns.map((s, i) => {
      const t = relation.through.target[i];
      return eq(sql`${throughTable}.${sql.identifier(is(t._.column, Column) ? t._.column.name : t._.key)}`, sql`${targetTable}.${sql.identifier(s.name)}`);
    });
    return {
      filter: and(relation.where ? relationsFilterToSQL(relation.isReversed ? sourceTable : targetTable, relation.where) : void 0, ...outerColumnWhere),
      joinCondition: and(...innerColumnWhere)
    };
  }
  return { filter: and(...relation.sourceColumns.map((s, i) => {
    const t = relation.targetColumns[i];
    return eq(sql`${sourceTable}.${sql.identifier(s.name)}`, sql`${targetTable}.${sql.identifier(t.name)}`);
  }), relation.where ? relationsFilterToSQL(relation.isReversed ? sourceTable : targetTable, relation.where) : void 0) };
}
function getTableAsAliasSQL(table) {
  return sql`${table[IsAlias] ? sql`${sql`${sql.identifier(table[TableSchema] ?? "")}.`.if(table[TableSchema])}${sql.identifier(table[OriginalName])} as ${table}` : table}`;
}

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/column-builder.js
var ColumnBuilder = class {
  static [entityKind] = "ColumnBuilder";
  /** @internal */
  config;
  constructor(name2, dataType, columnType) {
    this.config = {
      name: name2,
      keyAsName: name2 === "",
      notNull: false,
      default: void 0,
      hasDefault: false,
      primaryKey: false,
      isUnique: false,
      uniqueName: void 0,
      uniqueType: void 0,
      dataType,
      columnType,
      generated: void 0
    };
  }
  /**
  * Changes the data type of the column. Commonly used with `json` columns. Also, useful for branded types.
  *
  * @example
  * ```ts
  * const users = pgTable('users', {
  * 	id: integer('id').$type<UserId>().primaryKey(),
  * 	details: json('details').$type<UserDetails>().notNull(),
  * });
  * ```
  */
  $type() {
    return this;
  }
  /**
  * Adds a `not null` clause to the column definition.
  *
  * Affects the `select` model of the table - columns *without* `not null` will be nullable on select.
  */
  notNull() {
    this.config.notNull = true;
    return this;
  }
  /**
  * Adds a `default <value>` clause to the column definition.
  *
  * Affects the `insert` model of the table - columns *with* `default` are optional on insert.
  *
  * If you need to set a dynamic default value, use {@link $defaultFn} instead.
  */
  default(value) {
    this.config.default = value;
    this.config.hasDefault = true;
    return this;
  }
  /**
  * Adds a dynamic default value to the column.
  * The function will be called when the row is inserted, and the returned value will be used as the column value.
  *
  * **Note:** This value does not affect the `drizzle-kit` behavior, it is only used at runtime in `drizzle-orm`.
  */
  $defaultFn(fn) {
    this.config.defaultFn = fn;
    this.config.hasDefault = true;
    return this;
  }
  /**
  * Alias for {@link $defaultFn}.
  */
  $default = this.$defaultFn;
  /**
  * Adds a dynamic update value to the column.
  * The function will be called when the row is updated, and the returned value will be used as the column value if none is provided.
  * If no `default` (or `$defaultFn`) value is provided, the function will be called when the row is inserted as well, and the returned value will be used as the column value.
  *
  * **Note:** This value does not affect the `drizzle-kit` behavior, it is only used at runtime in `drizzle-orm`.
  */
  $onUpdateFn(fn) {
    this.config.onUpdateFn = fn;
    this.config.hasDefault = true;
    return this;
  }
  /**
  * Alias for {@link $onUpdateFn}.
  */
  $onUpdate = this.$onUpdateFn;
  /**
  * Adds a `primary key` clause to the column definition. This implicitly makes the column `not null`.
  *
  * In SQLite, `integer primary key` implicitly makes the column auto-incrementing.
  */
  primaryKey() {
    this.config.primaryKey = true;
    this.config.notNull = true;
    return this;
  }
  /** @internal Sets the name of the column to the key within the table definition if a name was not given. */
  setName(name2, casingFn) {
    if (this.config.name !== "") return;
    this.config.name = casingFn(name2);
  }
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/logger.js
var ConsoleLogWriter = class {
  static [entityKind] = "ConsoleLogWriter";
  write(message) {
    console.log(message);
  }
};
var DefaultLogger = class {
  static [entityKind] = "DefaultLogger";
  writer;
  constructor(config) {
    this.writer = config?.writer ?? new ConsoleLogWriter();
  }
  logQuery(query, params) {
    const stringifiedParams = params.map((p) => {
      try {
        return JSON.stringify(p);
      } catch {
        return String(p);
      }
    });
    const paramsStr = stringifiedParams.length ? ` -- params: [${stringifiedParams.join(", ")}]` : "";
    this.writer.write(`Query: ${query}${paramsStr}`);
  }
};
var NoopLogger = class {
  static [entityKind] = "NoopLogger";
  logQuery() {
  }
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sql/functions/aggregate.js
function count(expression) {
  return sql`count(${expression || sql.raw("*")})`.mapWith(Number);
}

// lib/translate/cache-engine-kind.ts
var CACHE_ENGINE_KINDS = ["import", "agent", "google", "bing", "apple", "bergamot"];
function cacheEngineKind(engine) {
  const value = String(engine || "").trim();
  if (!value) return null;
  if (CACHE_ENGINE_KINDS.includes(value)) return value;
  if (/google/i.test(value)) return "google";
  if (/bing/i.test(value)) return "bing";
  if (/apple/i.test(value)) return "apple";
  if (/bergamot/i.test(value)) return "bergamot";
  if (/^import\b/i.test(value)) return "import";
  if (/agent|ollama/i.test(value)) return "agent";
  return null;
}
var CACHE_NSFW_FLAGS = ["nsfw", "safe"];
function parseCacheNsfwFlag(raw) {
  const value = String(raw || "").trim();
  if (value === "1" || value === "true") return "nsfw";
  return CACHE_NSFW_FLAGS.includes(value) ? value : "";
}
var CACHE_LIVE_FLAGS = ["live", "stored"];
function parseCacheLiveFlag(raw) {
  const value = String(raw || "").trim();
  return CACHE_LIVE_FLAGS.includes(value) ? value : "";
}

// lib/translate/dynamic-template.ts
var DYNAMIC_VARIABLE = /_(?:actor|aicon|class|name|icon|num|desc1|desc2)(?![A-Za-z0-9_])/g;
function isDynamicTemplate(text2) {
  return new RegExp(DYNAMIC_VARIABLE.source).test(text2);
}
function sortedTokens(text2, re) {
  return JSON.stringify((text2.match(re) || []).sort());
}
var CONTROLS = /\\[A-Za-z]+(?:\[[^\]]*\])?|\\[^A-Za-z\s]|_se\[[^\]]*\]/g;
function validDynamicTranslation(source, target2) {
  if (!isDynamicTemplate(source)) return true;
  const lines = source.split(/\\n|\r?\n/);
  const translated = target2.split(/\\n|\r?\n/);
  return lines.length === translated.length && lines.every(
    (line, i) => sortedTokens(line, /_[A-Za-z][A-Za-z0-9_]*/g) === sortedTokens(translated[i], /_[A-Za-z][A-Za-z0-9_]*/g) && sortedTokens(line, DYNAMIC_VARIABLE) === sortedTokens(translated[i], DYNAMIC_VARIABLE) && sortedTokens(line, CONTROLS) === sortedTokens(translated[i], CONTROLS)
  );
}
var numericLabelParts = (src) => src.match(/^([A-Za-z]{2,60} ?)(\d{1,6})$/);
function numericLabelFamily(src) {
  return numericLabelParts(src)?.[1] || null;
}
function createNumericLabelIndex(records2 = []) {
  const groups = /* @__PURE__ */ new Map();
  const parse = numericLabelParts;
  function note(record) {
    const match = parse(record.src);
    if (!match) return;
    const group = groups.get(match[1]) || /* @__PURE__ */ new Map();
    group.set(record.id || record.src, record);
    groups.set(match[1], group);
  }
  records2.forEach(note);
  return {
    note,
    resolve(src) {
      const query = parse(src);
      if (!query) return null;
      const group = groups.get(query[1]);
      if (!group) return null;
      const numbers = /* @__PURE__ */ new Set();
      const templates = /* @__PURE__ */ new Set();
      for (const record of group.values()) {
        const number = parse(record.src)[2];
        const target2 = record.zh.match(/^([^\d\r\n\\]*)(\d+)([^\d\r\n\\]*)$/);
        if (!target2 || target2[2] !== number || !/[\u3400-\u9FFF]/.test(target2[1] + target2[3])) return null;
        numbers.add(number);
        templates.add(JSON.stringify([target2[1], target2[3]]));
        if (templates.size > 1) return null;
      }
      if (numbers.size < 2 || templates.size !== 1) return null;
      const [prefix, suffix] = JSON.parse([...templates][0]);
      return prefix + query[2] + suffix;
    }
  };
}

// lib/translate/source-text.ts
var KANA = /[\u3041-\u3096\u30A1-\u30FA\u31F0-\u31FF\uFF66-\uFF9D]/;
var HAN = /[\u3400-\u9FFF]/;
var LATIN = /[A-Za-z]/;
var markupTags = ["br", "span", "div", "p", "b", "i", "img", "ruby", "rt"].map((tag) => [...tag].map((char) => `[${char}${char.toUpperCase()}]`).join("")).join("|");
var TEXT_MARKUP_RE = new RegExp(`<\\/?(?:${markupTags})(?:\\s[^<>]*?)?\\s*\\/?>`, "g");
function sourceTextBody(value) {
  return value.replace(TEXT_MARKUP_RE, " ").replace(/\\[A-Za-z]+(?:\[[^\]]*\])?|\\[^A-Za-z\s]|%\d+|%[sdif]|\{[A-Za-z0-9_]+\}/g, " ").replace(DYNAMIC_VARIABLE, " ").replace(/_[A-Z][A-Z0-9_]+/g, " ").trim();
}
function isSourceText(value, language = "all") {
  if (typeof value !== "string") return false;
  const text2 = value.trim();
  if (!text2 || /^(?:true|false|null|undefined|EV\d+|#[\da-f]{3,8})$/i.test(text2)) return false;
  if (/^(?:https?:\/\/|[a-z]:[\\/]|\/|(?:\.\.?[\\/])|(?:img|audio|movies|fonts|js|data|assets|images|sounds)[\\/])/i.test(text2)) return false;
  if (/\.(?:png|jpe?g|webp|gif|ogg|wav|mp3|m4a|mp4|webm|js|json|csv|txt|rpgmvp|rpgmvo)$/i.test(text2)) return false;
  if (/^[A-Za-z_]\w*\[\d+\]$/.test(text2)) return false;
  if (/^(?:HP|MP|TP|EXP|LV|FPS|ATK|DEF|MAT|MDF|AGI|LUK)\s*[:=]?\s*[\d.,/%+\s-]+$/i.test(text2)) return false;
  if (/^(?:(?:async\s+)?function\b|(?:if|for|while)\s*\(|(?:const|let|var)\s+[$\w]+\s*[=:;]|return\s+(?:['"`$({]|[A-Za-z_$][\w$]*[.(])|return\b[^\n]*;|\$[A-Za-z_]|\(?[\w,\s]*\)?\s*=>)/.test(
    text2
  ))
    return false;
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*(?:[+*/-]=|=(?!=)|\+\+|--)/.test(text2) || /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\s*\(/.test(text2)) return false;
  if (!isDynamicTemplate(text2) && /^\S*_\S*$/.test(text2)) return false;
  const body = sourceTextBody(text2);
  const kana = KANA.test(body);
  const han = HAN.test(body);
  const latin = LATIN.test(body);
  if (language === "ja") return kana || han;
  if (language === "zh") return han && !kana;
  if (language === "en") return latin && !kana && !han;
  return kana || han || latin;
}

// lib/translate/resource-types.ts
function canonicalResourceLanguage(value) {
  try {
    const [tag] = Intl.getCanonicalLocales(value);
    if (tag && tag.length <= 100) return tag;
  } catch {
  }
  throw new TypeError(`Invalid language identifier: ${value}`);
}

// lib/translate/cache-lang.ts
var CACHE_LANGS = ["ja", "en", "zh", "ko", "ru"];
var DEFAULT_CACHE_SRC_LANG = "ja";
var DEFAULT_CACHE_TGT_LANG = "zh";
var KANA2 = /[\u3041-\u3096\u30A1-\u30FA\u31F0-\u31FF\uFF66-\uFF9D]/;
var HAN2 = /[\u3400-\u9FFF]/;
var LATIN2 = /[A-Za-z]/;
var HANGUL = /[\uAC00-\uD7A3]/;
var CYRILLIC = /[\u0400-\u04FF]/;
function parseCacheLang(raw) {
  const value = String(raw || "").trim().toLowerCase();
  return CACHE_LANGS.includes(value) ? value : "";
}
function normalizeCacheLang(raw, fallback) {
  return parseCacheLang(raw) || fallback;
}
function detectCacheLang(text2, fallback = DEFAULT_CACHE_SRC_LANG) {
  const body = sourceTextBody(String(text2 || ""));
  if (!body) return fallback;
  if (CYRILLIC.test(body)) return "ru";
  if (HANGUL.test(body)) return "ko";
  if (KANA2.test(body)) return "ja";
  if (LATIN2.test(body) && !HAN2.test(body) && !KANA2.test(body)) return "en";
  if (HAN2.test(body)) return fallback;
  return fallback;
}
function resolveCacheLangPair(opts) {
  const from = opts?.from != null ? canonicalResourceLanguage(opts.from) : opts?.src != null ? detectCacheLang(opts.src) : DEFAULT_CACHE_SRC_LANG;
  const to = opts?.to != null ? canonicalResourceLanguage(opts.to) : DEFAULT_CACHE_TGT_LANG;
  return { from, to };
}

// lib/translate/cache-query.ts
function parseSharedCacheSortKey(raw, fallback = "updated") {
  return raw === "hits" || raw === "updated" ? raw : fallback;
}
function parseSharedCacheSortDir(raw, fallback = "desc") {
  return raw === "asc" || raw === "desc" ? raw : fallback;
}

// lib/translate/choice-meta.ts
function callEnd(text2, start) {
  const name2 = /^(?:if|en)\s*\(/i.exec(text2.slice(start));
  if (!name2) return null;
  let depth = 1;
  let quote = "";
  for (let i = start + name2[0].length; i < text2.length; i++) {
    const ch = text2[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i + 1;
  }
  return null;
}
function peelChoiceMetaTrail(text2) {
  let core = String(text2 ?? "");
  let trail = "";
  for (; ; ) {
    const end = core.trimEnd().length;
    let start = null;
    for (const match of core.matchAll(/(?:if|en)\s*\(/gi)) {
      const at = match.index;
      if (at > 0 && /[A-Za-z0-9_]/.test(core[at - 1])) continue;
      if (callEnd(core, at) === end) {
        start = at;
        break;
      }
    }
    if (start == null) break;
    start = core.slice(0, start).trimEnd().length;
    trail = core.slice(start) + trail;
    core = core.slice(0, start);
  }
  return { core, trail };
}
function peelChoiceMetaShell(text2) {
  const trailing = peelChoiceMetaTrail(text2);
  let core = trailing.core;
  const trail = trailing.trail;
  let lead = "";
  for (; ; ) {
    const start = core.length - core.trimStart().length;
    const end = callEnd(core, start);
    if (end == null) break;
    const next = end + (core.slice(end).match(/^\s*/)?.[0].length || 0);
    lead += core.slice(0, next);
    core = core.slice(next);
  }
  return { lead, core, trail };
}

// lib/translate/default-game-terms.json
var default_game_terms_default = {
  flame: {
    translations: {
      zh: "\u708E",
      en: "Flame",
      ja: "\u708E",
      ko: "\uD654\uC5FC"
    },
    aliases: {
      en: ["Fire"]
    }
  },
  lightning: {
    translations: {
      zh: "\u96F7",
      en: "Lightning",
      ja: "\u96F7",
      ko: "\uBC88\uAC1C"
    }
  },
  water: {
    translations: {
      zh: "\u6C34",
      en: "Water",
      ja: "\u6C34",
      ko: "\uBB3C"
    }
  },
  earth: {
    translations: {
      zh: "\u571F",
      en: "Earth",
      ja: "\u571F",
      ko: "\uB300\uC9C0"
    }
  },
  light: {
    translations: {
      zh: "\u5149",
      en: "Light",
      ja: "\u5149",
      ko: "\uBE5B"
    }
  },
  sword: {
    translations: {
      zh: "\u5251",
      en: "Sword",
      ja: "\u5263",
      ko: "\uAC80"
    }
  },
  axe: {
    translations: {
      zh: "\u65A7",
      en: "Axe",
      ja: "\u65A7",
      ko: "\uB3C4\uB07C"
    }
  },
  staff: {
    translations: {
      zh: "\u6756",
      en: "Staff",
      ja: "\u6756",
      ko: "\uC9C0\uD321\uC774"
    }
  },
  bow: {
    translations: {
      zh: "\u5F13",
      en: "Bow",
      ja: "\u5F13",
      ko: "\uD65C"
    }
  },
  gun: {
    translations: {
      zh: "\u67AA",
      en: "Gun",
      ja: "\u9283",
      ko: "\uCD1D"
    }
  },
  claw: {
    translations: {
      zh: "\u722A",
      en: "Claw",
      ja: "\u722A",
      ko: "\uBC1C\uD1B1"
    }
  },
  spear: {
    translations: {
      zh: "\u957F\u67AA",
      en: "Spear",
      ja: "\u69CD",
      ko: "\uCC3D"
    }
  },
  save: {
    translations: {
      zh: "\u4FDD\u5B58",
      en: "Save",
      ja: "\u30BB\u30FC\u30D6",
      ko: "\uC800\uC7A5"
    },
    aliases: {
      en: ["Save Game"],
      ja: ["\u30BB\u30FC\u30D6\u3059\u308B"]
    },
    badTranslations: {
      zh: ["\u8282\u7701", "\u62EF\u6551", "\u7701\u4E0B", "\u5B58\u76D8"]
    }
  },
  load: {
    translations: {
      zh: "\u8BFB\u53D6",
      en: "Load",
      ja: "\u30ED\u30FC\u30C9",
      ko: "\uBD88\uB7EC\uC624\uAE30"
    },
    aliases: {
      en: ["Load Game"],
      ja: ["\u30ED\u30FC\u30C9\u3059\u308B"]
    },
    badTranslations: {
      zh: ["\u8D1F\u8377", "\u4F9B\u7535\u91CF", "\u8D1F\u8F7D", "\u88C5\u8F7D", "\u52A0\u8F7D", "\u88C5\u5165"]
    }
  },
  new_game: {
    translations: {
      zh: "\u65B0\u6E38\u620F",
      en: "New Game",
      ja: "\u30CB\u30E5\u30FC\u30B2\u30FC\u30E0",
      ko: "\uC0C8 \uAC8C\uC784"
    },
    badTranslations: {
      zh: ["\u65B0\u7684\u6E38\u620F", "\u65B0\u6BD4\u8D5B"]
    }
  },
  continue: {
    translations: {
      zh: "\u7EE7\u7EED\u6E38\u620F",
      en: "Continue",
      ja: "\u30B3\u30F3\u30C6\u30A3\u30CB\u30E5\u30FC",
      ko: "\uC774\uC5B4\uD558\uAE30"
    },
    aliases: {
      ja: ["\u3064\u3065\u304D\u304B\u3089"]
    },
    badTranslations: {
      zh: ["\u7EE7\u7EED", "\u5EF6\u62D3"]
    }
  },
  options: {
    translations: {
      zh: "\u8BBE\u7F6E",
      en: "Options",
      ja: "\u8A2D\u5B9A",
      ko: "\uC124\uC815"
    },
    aliases: {
      en: ["Option", "Config", "Settings"],
      ja: ["\u30AA\u30D7\u30B7\u30E7\u30F3"]
    },
    badTranslations: {
      zh: ["\u9009\u9879", "\u671F\u6743"]
    }
  },
  item: {
    translations: {
      zh: "\u9053\u5177",
      en: "Item",
      ja: "\u30A2\u30A4\u30C6\u30E0",
      ko: "\uC544\uC774\uD15C"
    },
    aliases: {
      en: ["Items"]
    },
    badTranslations: {
      zh: ["\u9879\u76EE", "\u6761\u6B3E", "\u7269\u4EF6"]
    }
  },
  skill: {
    translations: {
      zh: "\u6280\u80FD",
      en: "Skill",
      ja: "\u30B9\u30AD\u30EB",
      ko: "\uC2A4\uD0AC"
    },
    aliases: {
      en: ["Skills"]
    },
    badTranslations: {
      zh: ["\u6280\u672F", "\u6280\u80FD\u6761"]
    }
  },
  equip: {
    translations: {
      zh: "\u88C5\u5907",
      en: "Equip",
      ja: "\u88C5\u5099",
      ko: "\uC7A5\uBE44"
    },
    aliases: {
      en: ["Equipment"]
    },
    badTranslations: {
      zh: ["\u914D\u5907", "\u88C5\u8BBE"]
    }
  },
  status: {
    translations: {
      zh: "\u72B6\u6001",
      en: "Status",
      ja: "\u30B9\u30C6\u30FC\u30BF\u30B9",
      ko: "\uC0C1\uD0DC"
    },
    badTranslations: {
      zh: ["\u5730\u4F4D", "\u8EAB\u5206", "\u72B6\u51B5"]
    }
  },
  quit: {
    translations: {
      zh: "\u9000\u51FA",
      en: "Quit",
      ja: "\u7D42\u4E86",
      ko: "\uC885\uB8CC"
    },
    aliases: {
      en: ["Exit", "Game Over"]
    },
    badTranslations: {
      zh: ["\u505C\u6B62", "\u653E\u5F03", "\u79BB\u5F00\u6E38\u620F"]
    }
  },
  gold: {
    translations: {
      zh: "\u91D1\u5E01",
      en: "Gold",
      ja: "\u6240\u6301\u91D1",
      ko: "\uC18C\uC9C0\uAE08"
    },
    aliases: {
      en: ["Money"]
    },
    badTranslations: {
      zh: ["\u9EC4\u91D1", "\u91D1\u8272"]
    }
  }
};

// lib/translate/rm-escape.ts
var RM_DIGIT_CODE_SRC = String.raw`\\[A-Za-z]+\[\d+\]`;
function rmDigitCodeRe() {
  return new RegExp(RM_DIGIT_CODE_SRC, "g");
}
var RM_ESCAPE_RE = /\\[A-Za-z]+(?:\[[^\]]*\])?/g;
function isSemanticPlaceholder(token) {
  if (!token) return false;
  if (/^\\[NPV]\[[^\]]*\]$/i.test(token) || /^\\[Gg]$/.test(token)) return true;
  if (/^%[0-9]+$/i.test(token) || /^%[sdifSc]$/.test(token)) return true;
  if (/^\{[0-9A-Za-z_]+\}$/.test(token)) return true;
  if (/^_(?:actor|aicon|class|name|icon|num|desc1|desc2)(?![A-Za-z0-9_])/i.test(token)) return true;
  if (/^[A-Za-z_][A-Za-z0-9_]*\[\d+\]$/.test(token)) return true;
  return false;
}
function hasRmDigitCodes(text2) {
  return rmDigitCodeRe().test(String(text2 ?? ""));
}
function extractRmDigitCodes(text2) {
  return [...String(text2 ?? "").matchAll(rmDigitCodeRe())].map((m) => m[0]);
}
function toRmDigitTemplate(text2) {
  const src = String(text2 ?? "");
  if (!hasRmDigitCodes(src)) return src;
  return src.replace(rmDigitCodeRe(), (m) => {
    const letter = m.match(/^\\([A-Za-z]+)/)?.[1] ?? "";
    return `\\${letter.toLowerCase()}[#]`;
  });
}
function applyRmDigitCodes(template, codes) {
  if (!codes.length) return String(template ?? "");
  let i = 0;
  return String(template ?? "").replace(/\\[A-Za-z]+\[#\]/g, (slot) => {
    const code = codes[i++];
    return code != null ? code : slot;
  });
}
function lookupWithRmDigitTemplate(get, text2) {
  const src = String(text2 ?? "");
  if (!src) return null;
  const direct = get(src);
  if (direct != null && direct !== "") return direct;
  const codes = extractRmDigitCodes(src);
  if (!codes.length) return null;
  const tpl = toRmDigitTemplate(src);
  if (tpl === src) return null;
  const hit = get(tpl);
  if (hit == null || hit === "") return null;
  return applyRmDigitCodes(hit, codes);
}

// lib/translate/segments.ts
var WRAPPERS = {
  "\u300C": "\u300D",
  "\u300E": "\u300F",
  "(": ")",
  "\uFF08": "\uFF09",
  "<": ">",
  "\uFF1C": "\uFF1E",
  "\u3010": "\u3011",
  "\u300A": "\u300B",
  "\u3008": "\u3009",
  "[": "]",
  "\uFF3B": "\uFF3D",
  "{": "}",
  "\uFF5B": "\uFF5D",
  "\u201C": "\u201D",
  "\u2018": "\u2019"
};
var SEPARATE_WRAPPERS = /* @__PURE__ */ new Set(["\u300C", "\u300E", "<", "\uFF1C"]);
var FRAGMENT_QUOTES = { "\u300C": "\u300D", "\u300E": "\u300F", "\u201C": "\u201D", "\u2018": "\u2019" };
function isOuterWrapper(text2) {
  if (text2.length < 2 || WRAPPERS[text2[0]] !== text2[text2.length - 1]) return false;
  if (/^\{[A-Za-z0-9_]+\}$/.test(text2) || /^<\/?(?:br|span|div|p|b|i|img|ruby|rt)(?:\s[^>]*)?\s*\/?>$/i.test(text2)) return false;
  const stack = [];
  const controls = new Map([...text2.matchAll(new RegExp(`${RM_ESCAPE_RE.source}|\\\\[^A-Za-z\\s]`, "g"))].map((match) => [match.index, match[0].length]));
  for (let i = 0; i < text2.length; i++) {
    const length = controls.get(i);
    if (length) {
      i += length - 1;
      continue;
    }
    if (WRAPPERS[text2[i]]) stack.push(WRAPPERS[text2[i]]);
    else if (stack[stack.length - 1] === text2[i]) {
      stack.pop();
      if (!stack.length) return i === text2.length - 1;
    }
  }
  return false;
}
function splitSegments(text2, splitOrphanQuotes) {
  if (isDynamicTemplate(text2)) return [text2];
  const choice = peelChoiceMetaShell(text2);
  if (choice.lead || choice.trail) {
    const parts2 = splitSegments(choice.core, splitOrphanQuotes);
    if (!parts2.length) return [choice.lead + choice.trail];
    parts2[0] = choice.lead + parts2[0];
    parts2[parts2.length - 1] += choice.trail;
    return parts2;
  }
  const controls = new Map([...text2.matchAll(new RegExp(`${RM_ESCAPE_RE.source}|\\\\[^A-Za-z\\s]`, "g"))].map((match) => [match.index, match[0].length]));
  const stack = [];
  const parts = [];
  let start = 0;
  for (let i = 0; i < text2.length; i++) {
    const controlLength = controls.get(i);
    if (controlLength) {
      i += controlLength - 1;
      continue;
    }
    const char = text2[i];
    if (/[.．,，]/.test(char) && /[0-9０-９]/.test(text2[i - 1] || "") && /[0-9０-９]/.test(text2[i + 1] || "")) continue;
    let closed = false;
    if (WRAPPERS[char]) {
      const separate = SEPARATE_WRAPPERS.has(char);
      if (separate && !stack.length && i > start && translationSegmentContent(text2.slice(start, i)).core.trim()) {
        parts.push(text2.slice(start, i));
        start = i;
      }
      stack.push({ close: WRAPPERS[char], separate });
    } else if (stack[stack.length - 1]?.close === char) {
      const wrapper = stack.pop();
      closed = stack.length === 0 && wrapper.separate;
    } else if (splitOrphanQuotes && !stack.length && /[」』]/.test(char)) {
      closed = true;
    }
    if (stack.length || !closed && !/[，,。．.!！?？]/.test(char)) continue;
    while (i + 1 < text2.length && /[，,。．.!！?？]/.test(text2[i + 1])) i++;
    parts.push(text2.slice(start, i + 1));
    start = i + 1;
  }
  if (start < text2.length) parts.push(text2.slice(start));
  return parts;
}
function translationSegments(text2) {
  return splitSegments(text2, false);
}
function segmentContent(text2, keepChoiceMeta) {
  if (isDynamicTemplate(text2)) return { lead: "", core: text2, trail: "" };
  const control = new RegExp(`${RM_ESCAPE_RE.source}|\\\\[^A-Za-z\\s]`, "g");
  const choice = peelChoiceMetaShell(text2);
  let core = choice.core;
  let lead = keepChoiceMeta ? choice.lead : "";
  let trail = keepChoiceMeta ? choice.trail : "";
  for (; ; ) {
    const before = core;
    const meta = peelChoiceMetaShell(core);
    if (keepChoiceMeta) {
      lead += meta.lead;
      trail = meta.trail + trail;
    }
    core = meta.core;
    const prefix = core.match(/^[\s、，,。．.!！?？…]+/)?.[0] || [...core.matchAll(control)].find((match) => match.index === 0 && !/^\\RB\[/i.test(match[0]) && !isSemanticPlaceholder(match[0]))?.[0];
    if (prefix) {
      lead += prefix;
      core = core.slice(prefix.length);
    }
    const suffix = core.match(/[\s、，,。．.!！?？…]+$/)?.[0] || [...core.matchAll(control)].find((match) => match.index + match[0].length === core.length && !/^\\RB\[/i.test(match[0]) && !isSemanticPlaceholder(match[0]))?.[0];
    if (suffix) {
      trail = suffix + trail;
      core = core.slice(0, -suffix.length);
    }
    if (isOuterWrapper(core)) {
      lead += core[0];
      trail = core[core.length - 1] + trail;
      core = core.slice(1, -1);
    } else {
      const close = FRAGMENT_QUOTES[core[0]];
      if (close && !core.includes(close)) {
        lead += core[0];
        core = core.slice(1);
      }
      const open = Object.keys(FRAGMENT_QUOTES).find((key2) => FRAGMENT_QUOTES[key2] === core[core.length - 1]);
      if (open && !core.includes(open)) {
        trail = core[core.length - 1] + trail;
        core = core.slice(0, -1);
      }
    }
    if (core === before) break;
  }
  return { lead, core, trail };
}
function translationSegmentContent(text2) {
  return segmentContent(text2, true);
}
function translationRubyChunks(text2) {
  if (isDynamicTemplate(text2)) return [{ text: text2, ruby: false }];
  const chunks = [];
  let start = 0;
  const controls = [...text2.matchAll(new RegExp(RM_ESCAPE_RE.source, "g"))];
  for (const match of text2.matchAll(/\\RB\[([^,\[\]\r\n]+),([^,\[\]\r\n]+)\]|\\ruby\[([^\[\]\r\n]+)\]\(([^)\r\n]+)\)/gi)) {
    const at = match.index;
    if (controls.some((control) => control.index < at && control.index + control[0].length > at)) continue;
    if (at > start) chunks.push({ text: text2.slice(start, at), ruby: false });
    const paren = match[3] != null;
    chunks.push({
      text: match[0],
      ruby: true,
      base: paren ? match[3] : match[1],
      reading: paren ? match[4] : match[2],
      prefix: match[0].slice(0, match[0].indexOf("[")),
      paren
    });
    start = at + match[0].length;
  }
  if (start < text2.length) chunks.push({ text: text2.slice(start), ruby: false });
  return chunks;
}
function matchingTranslationRubyPairs(source, target2) {
  const left = translationRubyChunks(source);
  const right = translationRubyChunks(target2);
  if (!left.some((chunk) => chunk.ruby) && !right.some((chunk) => chunk.ruby)) return null;
  if (left.length !== right.length || left.some((chunk, index2) => chunk.ruby !== right[index2].ruby)) return [];
  return left.flatMap((chunk, index2) => {
    const other = right[index2];
    if (chunk.ruby)
      return [
        { source: chunk.base, target: other.base },
        { source: chunk.reading, target: other.reading }
      ];
    if (!/[\p{L}\p{N}]/u.test(chunk.text) && !/[\p{L}\p{N}]/u.test(other.text)) return [];
    return [{ source: chunk.text, target: other.text }];
  });
}
function mapTranslationRubySegments(text2, translate) {
  const chunks = translationRubyChunks(text2);
  if (!chunks.some((part) => part.ruby)) return null;
  let result = "";
  let changed = false;
  for (const part of chunks) {
    if (!part.ruby) {
      const hit = translate(part.text);
      if (hit == null) {
        if (/[\p{L}]/u.test(translationSegmentContent(part.text).core)) return null;
        result += part.text;
        continue;
      }
      changed = true;
      result += hit;
      continue;
    }
    const base = translate(part.base);
    const reading = translate(part.reading);
    if (base == null || reading == null) {
      result += part.text;
      continue;
    }
    if (/[,\[\]\r\n]/.test(base + reading)) return null;
    changed = true;
    result += part.paren ? `${part.prefix}[${base}](${reading})` : `${part.prefix}[${base},${reading}]`;
  }
  return changed ? result : null;
}
function translationNumberedPrefixPair(source, target2) {
  const prefix = source.match(/^(?:[A-Za-z]+\d+_)+/)?.[0];
  if (!prefix || !target2.startsWith(prefix)) return null;
  const src = source.slice(prefix.length);
  const zh = target2.slice(prefix.length);
  if (/[_/\\]/.test(src) || /[_/\\]/.test(zh)) return null;
  if (!/[\p{L}\p{N}]/u.test(src) || !/[\p{L}\p{N}]/u.test(zh)) return null;
  return { source: src, target: zh };
}
function translationCacheLines(text2) {
  if (isDynamicTemplate(text2)) return [text2];
  const { lead, core, trail } = translationSegmentContent(text2);
  const controls = [...core.matchAll(RM_ESCAPE_RE)].filter((match) => match[0] !== "\\n");
  const lines = [];
  let start = 0;
  for (const match of core.matchAll(/\r\n|[\r\n]|\\n(?![A-Za-z]|\[)/g)) {
    const at = match.index;
    if (controls.some((control) => at >= control.index && at < control.index + control[0].length)) continue;
    const end = at + match[0].length;
    lines.push(core.slice(start, end));
    start = end;
  }
  if (!lines.length) return [text2];
  lines.push(core.slice(start));
  lines[0] = lead + lines[0];
  lines[lines.length - 1] += trail;
  return lines;
}
function translationDisplayChunks(text2) {
  if (isDynamicTemplate(text2)) return [{ text: text2, display: false }];
  const chunks = [];
  const controls = [...text2.matchAll(new RegExp(RM_ESCAPE_RE.source, "g"))];
  let start = 0;
  for (const match of text2.matchAll(/\\(?:RC\[(?:\d+|#[0-9a-f]+)\]|C\[(?:\d+|#[0-9a-f]+)\]|FS\[\d+\]|CL|FB|DF|G)(?![A-Za-z])/gi)) {
    const at = match.index;
    if (controls.some((control) => control.index < at && control.index + control[0].length > at)) continue;
    if (at > start) chunks.push({ text: text2.slice(start, at), display: false });
    chunks.push({ text: match[0], display: true });
    start = at + match[0].length;
  }
  if (start < text2.length) chunks.push({ text: text2.slice(start), display: false });
  return chunks;
}
function mapTranslationDisplaySegments(text2, translate) {
  const choice = peelChoiceMetaShell(text2);
  const chunks = translationDisplayChunks(choice.core);
  if (!chunks.some((chunk) => chunk.display)) return text2;
  return choice.lead + chunks.map((chunk) => chunk.display ? chunk.text : translate(chunk.text)).join("") + choice.trail;
}
function translationExportText(text2) {
  if (isDynamicTemplate(text2)) return text2;
  const { lead, core, trail } = translationSegmentContent(text2);
  const strip = (shell) => shell.replace(new RegExp(`${RM_ESCAPE_RE.source}|\\\\[^A-Za-z\\s]`, "g"), (code) => /^\\(?:[nbr]|C\[(?:\d+|#[0-9a-f]+)\]|FS\[\d+\]|[.!|><^{}$])$/i.test(code) ? "" : code);
  return strip(lead) + core + strip(trail);
}
function mapTranslationSegments(text2, translate) {
  return mapSegments(translationSegments(text2), translate);
}
function mapTranslationCacheLines(text2, translate) {
  return mapSegments(translationCacheLines(text2), translate);
}
function mapSegments(parts, translate) {
  return parts.map((part) => {
    const { lead, core, trail } = translationSegmentContent(part);
    return core ? lead + translate(core, part) + trail : part;
  }).join("");
}

// lib/translate/game-terms.ts
var GAME_TERM_LANGUAGES = ["zh", "en", "ja", "ko"];
var GAME_TERMS = default_game_terms_default;
function key(text2) {
  return text2.normalize("NFKC").toLowerCase();
}
var indexes = Object.fromEntries(GAME_TERM_LANGUAGES.map((language) => [language, /* @__PURE__ */ new Map()]));
for (const [id, entry] of Object.entries(GAME_TERMS)) {
  for (const language of GAME_TERM_LANGUAGES) {
    for (const source of [entry.translations[language], ...entry.aliases?.[language] || []]) {
      const normalized = key(source);
      const ids = indexes[language].get(normalized) || /* @__PURE__ */ new Set();
      ids.add(id);
      indexes[language].set(normalized, ids);
    }
  }
}

// lib/translate/cache-engine-rank.ts
function cacheEngineRank(engine) {
  if (engine === "manual") return 4;
  if (engine === "import" || engine?.startsWith("import:")) return 3;
  if (engine === "live:optimize" || engine?.startsWith("live:optimize:") || engine?.startsWith("live:agent")) return 2;
  if (engine === "manual:optimize") return 0;
  return 1;
}

// lib/translate/logic-text.ts
var TOKEN_RE = new RegExp(`${RM_ESCAPE_RE.source}|${TEXT_MARKUP_RE.source}|https?:\\/\\/[^\\s<>]+`, "g");
var INDENT = /[\t \u3000]/;
var WORD = /[A-Za-z0-9']/;
var SENTENCE_END = /[。．.!！?？;；]/;
var WORDISH = /[\p{L}\p{N}]/u;
function inferNewlineKind(text2, start, end) {
  const src = String(text2 ?? "");
  if (start < 0 || end <= start || end > src.length) return "unknown";
  let left = start - 1;
  while (left >= 0 && INDENT.test(src[left])) left -= 1;
  let right = end;
  while (right < src.length && INDENT.test(src[right])) right += 1;
  const L = left >= 0 ? src[left] : void 0;
  const R = right < src.length ? src[right] : void 0;
  if (L == null || R == null) return "unknown";
  if (SENTENCE_END.test(L) || SENTENCE_END.test(R)) return "hard";
  if (WORDISH.test(L) && WORDISH.test(R)) return "soft";
  return "unknown";
}
function newlineKindAt(start, end, annotations, text2) {
  if (annotations?.length) {
    for (const note of annotations) {
      if (note.start === start && note.end === end) return note.kind;
      if (note.start <= start && end <= note.end) return note.kind;
    }
  }
  return text2 != null ? inferNewlineKind(text2, start, end) : "unknown";
}
function usesSpacedSoftBreaks(srcLang, sample) {
  const lang = srcLang || detectCacheLang(sample, "en");
  return lang !== "ja" && lang !== "zh" && lang !== "ko";
}
function shouldInsertSpace(left, right, spaced) {
  if (!spaced || left == null || right == null) return false;
  if (/\s/.test(left) || /\s/.test(right) || INDENT.test(left) || INDENT.test(right)) return false;
  return WORD.test(left) && WORD.test(right);
}
function buildLogicText(original, opts) {
  const text2 = String(original ?? "");
  const spaced = usesSpacedSoftBreaks(opts?.srcLang, text2);
  const controls = new Map([...text2.matchAll(TOKEN_RE)].map((m) => [m.index, m[0]]));
  const logicToOriginal = [];
  const logicNewlines = [];
  let logic = "";
  for (let i = 0; i < text2.length; ) {
    const code = controls.get(i);
    if (code && !/^\\[nr]$/i.test(code)) {
      for (let k = 0; k < code.length; k++) {
        logic += code[k];
        logicToOriginal.push(i + k);
      }
      i += code.length;
      continue;
    }
    const c = text2[i];
    const literalLine = Boolean(code && /^\\[nr]$/i.test(code));
    if (c === "\n" || c === "\r" || literalLine) {
      const end = literalLine ? i + code.length : c === "\r" && text2[i + 1] === "\n" ? i + 2 : i + 1;
      const kind = newlineKindAt(i, end, opts?.newlines, text2);
      if (kind === "soft") {
        let j = end;
        while (j < text2.length && INDENT.test(text2[j])) j += 1;
        const left = logic.length ? logic[logic.length - 1] : void 0;
        const right = j < text2.length ? text2[j] : void 0;
        if (shouldInsertSpace(left, right, spaced)) {
          logic += " ";
          logicToOriginal.push(-1);
        }
        i = j;
        continue;
      }
      const logicStart = logic.length;
      for (let k = i; k < end; k++) {
        logic += text2[k];
        logicToOriginal.push(k);
      }
      logicNewlines.push({ start: logicStart, end: logic.length, kind });
      i = end;
      continue;
    }
    logic += c;
    logicToOriginal.push(i);
    i += 1;
  }
  return { original: text2, logic, logicToOriginal, logicNewlines };
}
function listNewlineSpans(text2) {
  const src = String(text2 ?? "");
  const controls = new Map([...src.matchAll(TOKEN_RE)].map((m) => [m.index, m[0]]));
  const spans = [];
  for (let i = 0; i < src.length; ) {
    const code = controls.get(i);
    if (code && !/^\\[nr]$/i.test(code)) {
      i += code.length;
      continue;
    }
    const c = src[i];
    const literalLine = Boolean(code && /^\\[nr]$/i.test(code));
    if (c === "\n" || c === "\r" || literalLine) {
      const end = literalLine ? i + code.length : c === "\r" && src[i + 1] === "\n" ? i + 2 : i + 1;
      spans.push({ start: i, end, kind: inferNewlineKind(src, i, end) });
      i = end;
      continue;
    }
    i += 1;
  }
  return spans;
}
function validateNewlineAnnotations(text2, annotations) {
  if (!annotations) return true;
  if (!Array.isArray(annotations) || annotations.length > 500) return false;
  const allowed = new Set(listNewlineSpans(text2).map((s) => `${s.start}:${s.end}`));
  for (const note of annotations) {
    if (!note || typeof note !== "object") return false;
    if (!["soft", "hard", "unknown"].includes(note.kind)) return false;
    if (!Number.isInteger(note.start) || !Number.isInteger(note.end) || note.end <= note.start) return false;
    if (!allowed.has(`${note.start}:${note.end}`)) return false;
  }
  return true;
}
function mapLogicRangeToOriginal(view, logicStart, logicEnd) {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  const lo = Math.max(0, logicStart);
  const hi = Math.min(view.logicToOriginal.length, logicEnd);
  for (let i = lo; i < hi; i++) {
    const o = view.logicToOriginal[i];
    if (o < 0) continue;
    if (o < start) start = o;
    if (o + 1 > end) end = o + 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { start: 0, end: 0 };
  return { start, end };
}

// lib/translate/structured-segments.ts
var STRUCTURE_MAX_UNITS = 200;
var CIRCLED = "\u2460\u2461\u2462\u2463\u2464\u2465\u2466\u2467\u2468\u2469\u246A\u246B\u246C\u246D\u246E\u246F\u2470\u2471\u2472\u2473";
var ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1e3 };
var TOKEN = /https?:\/\/[^\s<>]+|<[^>]*>|\\[A-Za-z]+(?:\[[^\]]*\])?|\\[^A-Za-z\s]|\{[A-Za-z0-9_]+\}|%\d+|__[A-Za-z]\d+__|\b\d+(?:[.．:/-]\d+)+\b/g;
var PAIRS = { "\u300C": "\u300D", "\u300E": "\u300F", "\u201C": "\u201D", "\u3010": "\u3011", "\u300A": "\u300B", "[": "]", "{": "}", "(": ")", "\uFF08": "\uFF09" };
function ordinal(raw) {
  const value = raw.normalize("NFKC");
  if (/^\d+$/.test(value)) return Number(value);
  if (!/^(?=[IVXLCDM]+$)M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/i.test(value)) return void 0;
  const chars = value.toUpperCase();
  let n = 0;
  for (let i = 0; i < chars.length; i++) n += ROMAN[chars[i]] * (ROMAN[chars[i]] < (ROMAN[chars[i + 1]] || 0) ? -1 : 1);
  return n || void 0;
}
function validStructureAnnotation(value) {
  return !!value && typeof value === "object" && ["accept", "disabled"].includes(value.mode);
}
function validRecordStructure(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value;
  return (r.source === void 0 || validStructureAnnotation(r.source)) && (r.target === void 0 || validStructureAnnotation(r.target));
}
function scanStructuredText(text2, annotation) {
  const result = { units: [], layout: text2 ? [{ kind: "literal", start: 0, end: text2.length }] : [], diagnostics: [] };
  if (!text2 || annotation?.mode === "disabled") return result;
  if (/\\(?:[A-Za-z]+\[|[^A-Za-z\s])/.test(text2) || /<[^>]*>/.test(text2)) {
    result.diagnostics.push({ code: "protected_token", start: 0, end: text2.length });
    return result;
  }
  const protectedAt = new Map([...text2.matchAll(TOKEN)].map((m) => [m.index, m[0].length]));
  let markers = [];
  const stack = [];
  for (let i = 0; i < text2.length; ) {
    const token = protectedAt.get(i);
    if (token) {
      i += token;
      continue;
    }
    const before = text2[i - 1] || "";
    const boundary = i === 0 || /[\s:：,，、;；]/.test(before) || /[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]/.test(text2[i]);
    let marker;
    const circled = CIRCLED.indexOf(text2[i]);
    if (!stack.length && circled >= 0) marker = { start: i, end: i + 1, family: "circled", ordinal: circled + 1 };
    if (!stack.length && /[·•]/.test(text2[i])) marker = { start: i, end: i + 1, family: "bullet" };
    if (!stack.length && boundary) {
      const match = text2.slice(i).match(
        /^(?:([（(])([0-9０-９]+|[ivxlcdmIVXLCDM]+|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]+)[）)]|([0-9０-９]+|[ivxlcdmIVXLCDM]+|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]+)([.．、):：]|(?=\s)|(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])))/u
      );
      if (match) {
        const raw = match[2] || match[3];
        const n = ordinal(raw);
        const suffix = match[4] || "";
        if (n !== void 0 && !(/[.．]/.test(suffix) && /[0-9０-９]/.test(text2[i + match[0].length] || ""))) {
          const family = /^\d+$/.test(raw.normalize("NFKC")) ? "arabic" : "roman";
          marker = {
            start: i,
            end: i + match[0].length,
            family: `${family}:${match[1] ? "paren" : suffix || "bare"}`,
            ordinal: n,
            weak: !match[1] && !suffix && !/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]/.test(raw)
          };
        }
      }
    }
    if (marker) {
      markers.push(marker);
      i = marker.end;
      continue;
    }
    if (PAIRS[text2[i]]) stack.push(PAIRS[text2[i]]);
    else if (stack.at(-1) === text2[i]) stack.pop();
    i++;
  }
  if (markers.some((m) => !m.weak)) markers = markers.filter((m) => !m.weak);
  if (markers.length >= 2 && markers.every((m) => m.family === "bullet") && !/^\s*$/.test(text2.slice(0, markers[0].start))) {
    const colon = text2.slice(0, markers[0].start).match(/[:：]/);
    if (colon && text2.slice(colon.index + 1, markers[0].start).trim()) markers.unshift({ start: colon.index + 1, end: colon.index + 1, family: "bullet" });
  }
  if (!markers.length) return result;
  if (markers.length > STRUCTURE_MAX_UNITS - 1) {
    result.diagnostics.push({ code: "candidate_limit", start: 0, end: text2.length });
    return result;
  }
  const prefix = text2.slice(0, markers[0].start);
  const labelMatch = prefix.match(/(?:^|\n)([^\n:：]+)[:：]\s*$/u);
  if (prefix.trim() && !labelMatch) return result;
  if (markers.length < 2) return result;
  const numbered = markers.filter((m) => m.ordinal !== void 0);
  const sameFamily = markers.every((m) => m.family === markers[0].family);
  const sequence = numbered.every((m, i) => !i || m.ordinal === numbered[i - 1].ordinal + 1);
  const bulletStrong = markers[0].family !== "bullet" || markers.every((m) => /^\s*$/.test(text2.slice(text2.lastIndexOf("\n", m.start - 1) + 1, m.start)));
  const strong = sameFamily && sequence && bulletStrong && markers.every((m) => !m.weak);
  const state = strong || annotation?.mode === "accept" ? "accepted" : "suggested";
  if (!sequence || !sameFamily) result.diagnostics.push({ code: "invalid_sequence", start: markers[0].start, end: text2.length });
  else if (!strong) result.diagnostics.push({ code: "ambiguous_marker", start: markers[0].start, end: text2.length });
  const add = (start, end, kind, n) => {
    const raw = text2.slice(start, end);
    const leading = raw.match(/^\s*/)?.[0].length || 0;
    const trailing = raw.match(/[\s,，、;；]*$/)?.[0].length || 0;
    start += leading;
    end -= trailing;
    if (end <= start) return false;
    result.units.push({ id: `${start}:${end}`, start, end, kind, state, ...n !== void 0 ? { ordinal: n } : {} });
    return true;
  };
  if (labelMatch) {
    const labelStart = prefix.lastIndexOf(labelMatch[1]);
    if (labelStart > 0) add(0, labelStart, "text");
    add(labelStart, labelStart + labelMatch[1].length, "label");
  }
  for (let i = 0; i < markers.length; i++) {
    if (!add(markers[i].end, markers[i + 1]?.start ?? text2.length, "item", markers[i].ordinal)) {
      result.units = [];
      return result;
    }
  }
  if (result.units.length > STRUCTURE_MAX_UNITS) {
    result.units = [];
    result.diagnostics.push({ code: "candidate_limit", start: 0, end: text2.length });
    return result;
  }
  result.layout = [];
  let cursor = 0;
  for (const unit of result.units) {
    if (cursor < unit.start) result.layout.push({ kind: "literal", start: cursor, end: unit.start });
    result.layout.push({ kind: "unit", unitId: unit.id, start: unit.start, end: unit.end });
    cursor = unit.end;
  }
  if (cursor < text2.length) result.layout.push({ kind: "literal", start: cursor, end: text2.length });
  return result;
}

// lib/translate/sentence-units.ts
var SENTENCE_TOKEN_SOURCE = `${RM_ESCAPE_RE.source}|${TEXT_MARKUP_RE.source}|https?:\\/\\/[^\\s<>]+`;
var SENTENCE_RULE_VERSION = 10;
var PAIRS2 = { "<": ">", "\u300C": "\u300D", "\u300E": "\u300F", "\u3010": "\u3011", "\u300A": "\u300B", "\u3008": "\u3009", "\uFF08": "\uFF09", "(": ")", "[": "]", "{": "}", "\u201C": "\u201D" };
var WIDTH = { "\uFF1F": "?", "\uFF01": "!", "\uFF0C": ",", "\u3002": ".", "\uFF0E": ".", "\uFF1B": ";" };
function punctuationKey(text2) {
  return text2.replace(/(?:…|[.．]{3,})+/g, "...").replace(/[？！，。．；]/g, (c) => WIDTH[c]).replace(/([!?])\1{2,}/g, "$1$1");
}
function controlSignature(text2) {
  return JSON.stringify(text2.match(new RegExp(`${SENTENCE_TOKEN_SOURCE}|%\\d+|\\{[A-Za-z0-9_]+\\}|__[A-Za-z]\\d+__`, "g")) || []);
}
function wholeSentenceKey(text2) {
  const normalized = text2.trim();
  const plainKey = (part) => punctuationKey(part.replace(/\r\n?/g, "\n").replace(/[\t \u3000]*\n[\t \u3000]*/g, "\n"));
  let out = "", at = 0;
  for (const match of normalized.matchAll(new RegExp(SENTENCE_TOKEN_SOURCE, "g"))) {
    out += plainKey(normalized.slice(at, match.index)) + match[0];
    at = match.index + match[0].length;
  }
  return out + plainKey(normalized.slice(at));
}
function sentenceBodyKey(text2) {
  let out = "", at = 0;
  for (const match of text2.matchAll(new RegExp(SENTENCE_TOKEN_SOURCE, "g"))) {
    out += punctuationKey(text2.slice(at, match.index).normalize("NFKC")) + match[0];
    at = match.index + match[0].length;
  }
  return out + punctuationKey(text2.slice(at).normalize("NFKC"));
}
function newlineKindOnLogic(start, end, annotations) {
  for (const note of annotations) {
    if (note.start === start && note.end === end) return note.kind;
    if (note.start <= start && end <= note.end) return note.kind;
  }
  return "unknown";
}
function ellipsisEndAt(text2, index2) {
  if (!/[.．…]/.test(text2[index2] || "")) return null;
  const match = text2.slice(index2).match(/^(?:…|[.．]{3,})+/);
  return match ? index2 + match[0].length : null;
}
function sentenceTail(text2) {
  const tail = text2.match(/[,.!?;，、。．！？；…\s]+$/u)?.[0] || "";
  let afterEllipsis = 0;
  for (const match of tail.matchAll(/(?:…|[.．]{3,})+/g)) afterEllipsis = match.index + match[0].length;
  return tail.slice(afterEllipsis);
}
function sentenceBoundaryAt(text2, index2) {
  const c = text2[index2];
  if (!/[,，、。．.!！?？;；]/.test(c || "")) return null;
  if (/[,.，．]/.test(c) && /[0-9０-９]/.test(text2[index2 - 1] || "") && /[0-9０-９]/.test(text2[index2 + 1] || "")) return null;
  if (/[.．]/.test(c) && (/[.．]/.test(text2[index2 - 1] || "") || /[.．]/.test(text2[index2 + 1] || ""))) return null;
  let end = index2 + 1;
  while (end < text2.length && /[,，、。．.!！?？;；]/.test(text2[end]) && !ellipsisEndAt(text2, end)) end++;
  return { end, boundary: /[,，、]/.test(c) ? "," : /[;；]/.test(c) ? ";" : "stop" };
}
function splitSentenceUnitsOn(text2, hardOrUnknown) {
  const units = [];
  const controls = new Map([...text2.matchAll(new RegExp(SENTENCE_TOKEN_SOURCE, "g"))].map((m) => [m.index, m[0]]));
  const stack = [];
  const opening = text2.match(/^\s*[「『“]/)?.[0];
  const openDialogueAt = opening && !text2.includes(PAIRS2[opening.at(-1)]) ? opening.length - 1 : -1;
  let start = 0;
  let block = 0;
  function push(end, boundary) {
    const raw = text2.slice(start, end);
    const tail = sentenceTail(raw);
    const body = raw.slice(0, raw.length - tail.length).trim();
    const marks = punctuationKey(tail.replace(/\s/g, ""));
    const tone = marks.match(/[!?]+/)?.[0] || (marks.includes(".") ? "." : "");
    if (body) units.push({ start: start + (raw.match(/^\s*/)?.[0].length || 0), end, key: sentenceBodyKey(body), tone, boundary, controls: controlSignature(raw), block });
    start = end;
  }
  for (let i = 0; i < text2.length; i++) {
    const code = controls.get(i);
    if (code && !/^\\[nr]$/i.test(code)) {
      i += code.length - 1;
      continue;
    }
    const c = text2[i];
    if (PAIRS2[c] && i !== openDialogueAt) stack.push(PAIRS2[c]);
    else if (stack.at(-1) === c) stack.pop();
    if (stack.length) continue;
    const literalLine = code && /^\\[nr]$/i.test(code);
    if (c === "\n" || c === "\r" || literalLine) {
      const end = i + (literalLine ? code.length : c === "\r" && text2[i + 1] === "\n" ? 2 : 1);
      const kind = newlineKindOnLogic(i, end, hardOrUnknown);
      if (kind === "hard") {
        push(end, "line");
        block++;
      }
      i = end - 1;
      continue;
    }
    const ellipsis = ellipsisEndAt(text2, i);
    if (ellipsis != null) {
      i = ellipsis - 1;
      continue;
    }
    const seam = sentenceBoundaryAt(text2, i);
    if (!seam) continue;
    push(seam.end, seam.boundary);
    i = seam.end - 1;
  }
  if (start < text2.length) push(text2.length, "end");
  return units;
}
function sentenceUnits(text2, opts) {
  if (opts?.structure?.mode === "disabled")
    return text2.trim() ? [{ start: 0, end: text2.length, key: sentenceBodyKey(text2), tone: "", boundary: "end", controls: controlSignature(text2), block: 0 }] : [];
  const opening = text2.match(/^(?:\s*[(（])+/)?.[0];
  if (opening && !/[)）]/.test(text2)) {
    const offset = opening.length;
    const innerOpts = { ...opts, newlines: opts?.newlines?.filter((n) => n.start >= offset).map((n) => ({ ...n, start: n.start - offset, end: n.end - offset })) };
    return sentenceUnits(text2.slice(offset), innerOpts).map((u) => ({ ...u, start: u.start + offset, end: u.end + offset }));
  }
  const structured = scanStructuredText(text2, opts?.structure);
  if (structured.units.length && structured.units.every((unit) => unit.state === "accepted")) {
    return structured.units.map((unit, block) => {
      const raw = text2.slice(unit.start, unit.end);
      const logic = buildLogicText(raw, {
        srcLang: opts?.srcLang,
        newlines: opts?.newlines?.filter((n) => n.start >= unit.start && n.end <= unit.end).map((n) => ({ ...n, start: n.start - unit.start, end: n.end - unit.start }))
      }).logic;
      const tail = sentenceTail(logic);
      const body = logic.slice(0, logic.length - tail.length).trim();
      const marks = punctuationKey(tail.replace(/\s/g, ""));
      return {
        start: unit.start,
        end: unit.end,
        key: sentenceBodyKey(body || logic),
        tone: marks.match(/[!?]+/)?.[0] || (marks.includes(".") ? "." : ""),
        boundary: "structure",
        controls: controlSignature(raw),
        block
      };
    });
  }
  const view = buildLogicText(text2, { newlines: opts?.newlines, srcLang: opts?.srcLang });
  const units = splitSentenceUnitsOn(view.logic, view.logicNewlines);
  if (view.logic === text2) return units;
  return units.map((unit) => {
    const span = mapLogicRangeToOriginal(view, unit.start, unit.end);
    return { ...unit, start: span.start, end: span.end };
  });
}
function sameSentence(a, b) {
  return a.key === b.key && a.tone === b.tone && a.controls === b.controls;
}
function sentenceOuterShell(text2) {
  const visible = text2.trim();
  const trimmed = visible.replace(/[,，。．.!！?？;；]+$/, "");
  const suffix = visible.slice(trimmed.length);
  if (!trimmed || PAIRS2[trimmed[0]] !== trimmed.at(-1)) return { lead: "", core: text2, trail: "" };
  const stack = [];
  for (let i = 0; i < trimmed.length; i++) {
    if (PAIRS2[trimmed[i]]) stack.push(PAIRS2[trimmed[i]]);
    else if (stack.at(-1) === trimmed[i]) {
      stack.pop();
      if (!stack.length && i !== trimmed.length - 1) return { lead: "", core: text2, trail: "" };
    }
  }
  const space = text2.indexOf(trimmed);
  return { lead: text2.slice(0, space) + trimmed[0], core: trimmed.slice(1, -1), trail: trimmed.at(-1) + suffix + text2.slice(space + visible.length) };
}

// lib/translate/sentence-aliases.ts
function sentenceAliases(src, zh) {
  const aliases = [];
  const a = peelChoiceMetaShell(src), b = peelChoiceMetaShell(zh);
  if ((a.lead || a.trail) && (!b.lead && !b.trail || a.lead === b.lead && a.trail === b.trail) && !/(?:如果|启用|禁用)\s*[(（]/.test(b.core))
    aliases.push({ src: a.core, zh: b.core });
  const sourceOpening = src.match(/^(?:\s*[(（])+/)?.[0];
  const targetOpening = zh.match(/^(?:\s*[(（])+/)?.[0];
  if (sourceOpening && targetOpening && sourceOpening.normalize("NFKC").trim() === targetOpening.normalize("NFKC").trim() && !/[)）]/.test(src) && !/[)）]/.test(zh))
    aliases.push({ src: src.slice(sourceOpening.length), zh: zh.slice(targetOpening.length) });
  const numbered = translationNumberedPrefixPair(src, zh);
  if (numbered) aliases.push({ src: numbered.source, zh: numbered.target });
  const source = sentenceOuterShell(src), target2 = sentenceOuterShell(zh);
  if (source.core !== src && target2.core !== zh && !/[!?！？]/.test(source.trail)) aliases.push({ src: source.core, zh: target2.core });
  for (const pair of matchingTranslationRubyPairs(src, zh) || []) aliases.push({ src: pair.source, zh: pair.target });
  return aliases.filter((pair) => pair.src && pair.zh);
}
function structuredSentenceAliases(src, zh, structure) {
  const source = scanStructuredText(src, structure?.source);
  const target2 = scanStructuredText(zh, structure?.target);
  if (source.diagnostics.length || target2.diagnostics.length || [...source.units, ...target2.units].some((unit) => unit.state !== "accepted")) return [];
  const a = source.units.filter((unit) => unit.kind === "item");
  const b = target2.units.filter((unit) => unit.kind === "item");
  if (a.length < 2 || a.length !== b.length || a.some((unit, i) => unit.ordinal === void 0 || unit.ordinal !== b[i].ordinal)) return [];
  const pairs = a.map((unit, i) => ({ source: unit, target: b[i] }));
  const label = source.units.find((unit) => unit.kind === "label");
  const translatedLabel = target2.units.find((unit) => unit.kind === "label");
  if (label && translatedLabel) pairs.unshift({ source: label, target: translatedLabel });
  const context2 = source.units.filter((unit) => unit.kind === "text").reduce((length, unit) => length + unit.end - unit.start, 0);
  return pairs.flatMap((pair) => {
    const from = src.slice(pair.source.start, pair.source.end);
    let to = zh.slice(pair.target.start, pair.target.end);
    if (/[①-⑳][\t ]*$/u.test(zh.slice(0, pair.target.start))) to = to.replace(/^[.．][\t ]*/u, "");
    return from && to ? [{ src: from, zh: to, context: context2 }] : [];
  });
}

// lib/translate/sentence-auto-alignment.ts
function completeSentences(text2, units) {
  if (!units.length || text2.slice(0, units[0].start).trim() || text2.slice(units.at(-1).end).trim()) return null;
  const out = [];
  let from = 0;
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    if (unit.boundary === "structure") return null;
    if (unit.boundary !== "stop") continue;
    const start = units[from].start, end = unit.end;
    out.push({ from, to: i + 1, start, end, tone: unit.tone, controls: JSON.stringify([controlSignature(text2.slice(start, end)), text2.slice(start, end).match(/%[sdif]/g) || []]) });
    from = i + 1;
  }
  return from === units.length && out.length >= 2 ? out : null;
}
function hasComplexControls(text2) {
  return [...text2.matchAll(new RegExp(SENTENCE_TOKEN_SOURCE, "g"))].some((match) => !/^\\(?:[VNP]\[\d+\]|G)$/i.test(match[0]));
}
function inferSentenceAlignment(record, units) {
  if (record.derived || record.alignments?.length || record.structure?.source?.mode === "disabled" || record.structure?.target?.mode === "disabled") return [];
  const structures = [
    scanStructuredText(record.src.replace(new RegExp(SENTENCE_TOKEN_SOURCE, "g"), " "), record.structure?.source),
    scanStructuredText(record.zh.replace(new RegExp(SENTENCE_TOKEN_SOURCE, "g"), " "), record.structure?.target)
  ];
  if (structures.some((s) => s.units.length || s.diagnostics.length)) return [];
  if (hasComplexControls(record.src) || hasComplexControls(record.zh)) return [];
  const targetUnits = sentenceUnits(record.zh, { structure: record.structure?.target });
  const source = completeSentences(record.src, units);
  const target2 = completeSentences(record.zh, targetUnits);
  const sentences = source && target2 && source.length === target2.length && source.every((s, i) => s.tone === target2[i].tone && s.controls === target2[i].controls) ? source.map((s, i) => ({ from: s.from, to: s.to, targetStart: target2[i].start, targetEnd: target2[i].end })) : [];
  return [...sentences, ...inferEllipsisClauses(record, units, targetUnits)];
}
function inferEllipsisClauses(record, source, target2) {
  if (source.length < 2 || source.length !== target2.length) return [];
  const signature = (text2, unit) => JSON.stringify([unit.controls, text2.slice(unit.start, unit.end).match(/%[sdif]/g) || []]);
  if (source.some(
    (unit, i) => unit.boundary !== target2[i].boundary || unit.tone !== target2[i].tone || unit.key.includes("...") !== target2[i].key.includes("...") || signature(record.src, unit) !== signature(record.zh, target2[i])
  ))
    return [];
  const clauses = source.flatMap(
    (unit, i) => unit.key.endsWith("...") && target2[i].key.endsWith("...") ? [{ from: i, to: i + 1, targetStart: target2[i].start, targetEnd: target2[i].end, kind: "ellipsis" }] : []
  );
  return clauses.length >= 2 ? clauses : [];
}
function inferredSentenceTarget(record, groups, from, to) {
  const group = groups.find((g) => g.from === from && g.to === to);
  return group ? record.zh.slice(group.targetStart, group.targetEnd) : null;
}

// lib/translate/sentence-query.ts
function sentenceQueryViews(src, opts) {
  const views = [{ text: src, offset: 0, opts }];
  if (opts?.structure?.mode === "disabled") return views;
  for (let depth = 0; depth < 8; depth++) {
    const view = views.at(-1);
    if (!/^\s*[「『“（(]/.test(view.text)) break;
    const shell = sentenceOuterShell(view.text);
    if (!shell.lead || !shell.core || shell.core === view.text || /[!?！？]/.test(shell.trail)) break;
    const offset = shell.lead.length;
    views.push({
      text: shell.core,
      offset: view.offset + offset,
      opts: {
        ...view.opts,
        newlines: view.opts?.newlines?.filter((n) => n.start >= offset && n.end <= offset + shell.core.length).map((n) => ({ ...n, start: n.start - offset, end: n.end - offset }))
      }
    });
  }
  return views;
}
function queryLines(src) {
  const breaks = listNewlineSpans(src);
  if (!breaks.length || breaks.length > 200) return [];
  let start = 0;
  return [...breaks, { start: src.length, end: src.length }].flatMap((br) => {
    const raw = src.slice(start, br.start);
    const at = start + (raw.match(/^\s*/)?.[0].length || 0);
    start = br.end;
    return raw.trim() ? [{ start: at, text: raw.trim() }] : [];
  });
}
function sentenceQueryViewUnits(src, opts) {
  const body = sentenceQueryViews(src, opts)[1];
  if (!body) return sentenceUnits(src, opts);
  const units = sentenceUnits(body.text, body.opts);
  if (units.length < 2) return sentenceUnits(src, opts);
  return units.map((unit, i) => ({
    ...unit,
    start: i === 0 ? 0 : unit.start + body.offset,
    end: i === units.length - 1 ? src.length : unit.end + body.offset,
    key: sentenceBodyKey((i === 0 ? src.slice(0, body.offset).trimStart() : "") + unit.key + (i === units.length - 1 ? src.slice(body.offset + body.text.length).trimEnd() : ""))
  }));
}
function sentenceQueryKeys(src, opts) {
  return [
    ...new Set(
      sentenceQueryViews(src, opts).flatMap((view) => [
        wholeSentenceKey(view.text),
        wholeSentenceKey(buildLogicText(view.text, view.opts).logic),
        ...sentenceQueryViewUnits(view.text, view.opts).map((unit) => wholeSentenceKey(view.text.slice(unit.start, unit.end))),
        ...queryLines(view.text).map((line) => wholeSentenceKey(line.text))
      ])
    )
  ];
}
function sentenceQueryUnits(src, opts) {
  return sentenceQueryViews(src, opts).flatMap(
    (view) => sentenceQueryViewUnits(view.text, view.opts).map((u) => ({ ...u, start: u.start + view.offset, end: u.end + view.offset }))
  );
}

// lib/translate/sentence-plan.ts
function recordUnitOpts(record) {
  return { newlines: record.newlines, structure: record.structure?.source };
}
function expandRecords(records2) {
  return records2.flatMap((record) => [
    record,
    ...sentenceAliases(record.src, record.zh).map((alias) => ({ ...record, ...alias, derived: true, alignments: void 0, newlines: void 0 })),
    ...structuredSentenceAliases(record.src, record.zh, record.structure).map(({ context: context2, ...alias }) => ({
      ...record,
      ...alias,
      derived: true,
      structuralAlias: true,
      structureContext: context2,
      alignments: void 0,
      newlines: void 0,
      structure: void 0
    }))
  ]);
}
function logicAuthorityKey(text2, opts) {
  return wholeSentenceKey(buildLogicText(text2, { newlines: opts?.newlines, srcLang: opts?.srcLang }).logic);
}
function target(record, units, from, to) {
  if (from === 0 && to === units.length && units[0]?.start === 0 && units.at(-1)?.end === record.src.length) return record.zh;
  const start = units[from].start;
  const end = units[to - 1].end;
  const groups = (record.alignments || []).filter((g) => g.evidence === "verified" && g.sourceStart >= start && g.sourceEnd <= end).sort((a, b) => a.sourceStart - b.sourceStart);
  if (!groups.length || groups[0].sourceStart !== start || groups.at(-1).sourceEnd !== end) return null;
  for (let i = 1; i < groups.length; i++) if (groups[i - 1].sourceEnd !== groups[i].sourceStart || groups[i - 1].targetEnd !== groups[i].targetStart) return null;
  return record.zh.slice(groups[0].targetStart, groups.at(-1).targetEnd);
}
function cutsSurrogate(text2, index2) {
  if (index2 <= 0 || index2 >= text2.length) return false;
  const c = text2.charCodeAt(index2);
  return c >= 56320 && c <= 57343;
}
function validateAlignments(record, groups) {
  if (!Array.isArray(groups) || groups.length > 1e3 || groups.some((g) => !g || typeof g !== "object" || !["verified", "structural"].includes(g.evidence))) return false;
  const src = sentenceUnits(record.src, { newlines: record.newlines, structure: record.structure?.source });
  const tgt = sentenceUnits(record.zh, { structure: record.structure?.target });
  const starts = new Set(src.map((s) => s.start)), ends = new Set(src.map((s) => s.end));
  const targetStarts = new Set(tgt.map((s) => s.start)), targetEnds = new Set(tgt.map((s) => s.end));
  let sourceEnd = 0, targetEnd = 0;
  for (const g of groups) {
    if (![g.sourceStart, g.sourceEnd, g.targetStart, g.targetEnd].every(Number.isInteger)) return false;
    if (g.sourceStart < sourceEnd || g.targetStart < targetEnd || g.sourceStart >= g.sourceEnd || g.targetStart >= g.targetEnd) return false;
    if (g.sourceStart < 0 || g.sourceEnd > record.src.length || g.targetStart < 0 || g.targetEnd > record.zh.length) return false;
    if (cutsSurrogate(record.src, g.sourceStart) || cutsSurrogate(record.src, g.sourceEnd)) return false;
    if (cutsSurrogate(record.zh, g.targetStart) || cutsSurrogate(record.zh, g.targetEnd)) return false;
    const onUnits = starts.has(g.sourceStart) && ends.has(g.sourceEnd) && targetStarts.has(g.targetStart) && targetEnds.has(g.targetEnd);
    if (!onUnits) {
      if (g.evidence !== "verified") return false;
      if (src.length !== 1 || src[0].start !== 0 || src[0].end !== record.src.length) return false;
      if (tgt.length !== 1 || tgt[0].start !== 0 || tgt[0].end !== record.zh.length) return false;
      sourceEnd = g.sourceEnd;
      targetEnd = g.targetEnd;
      continue;
    }
    const a = src.filter((s) => s.start >= g.sourceStart && s.end <= g.sourceEnd).map((s) => s.controls).filter((s) => s !== "[]").join("");
    const b = tgt.filter((s) => s.start >= g.targetStart && s.end <= g.targetEnd).map((s) => s.controls).filter((s) => s !== "[]").join("");
    if (a !== b) return false;
    sourceEnd = g.sourceEnd;
    targetEnd = g.targetEnd;
  }
  return true;
}
function candidates(src, records2, queryOpts, automaticOnly = false, budget) {
  const query = sentenceQueryViewUnits(src, queryOpts);
  const queryKey = logicAuthorityKey(src, queryOpts);
  const fragmentKeys = query.map((unit) => wholeSentenceKey(src.slice(unit.start, unit.end)));
  const out = [];
  let work = 0;
  for (const record of records2) {
    const unitOpts = recordUnitOpts(record);
    const units = sentenceUnits(record.src, unitOpts);
    const recordKey = logicAuthorityKey(record.src, unitOpts);
    const inferred = automaticOnly ? inferSentenceAlignment(record, units) : [];
    if (automaticOnly && !inferred.length) continue;
    if (!automaticOnly && queryKey === recordKey && query.length) {
      out.push({
        start: 0,
        end: src.length,
        from: 0,
        to: query.length,
        text: record.zh,
        record,
        sourceStart: 0,
        sourceEnd: record.src.length,
        kind: "whole",
        queryCoverage: 1,
        recordCoverage: 1
      });
      continue;
    }
    for (let q = 0; !automaticOnly && q < query.length; q++) {
      if (++work > 5e4 || budget && --budget.remaining < 0) return Object.assign([], { limited: true });
      const unit = query[q];
      if (fragmentKeys[q] === recordKey)
        out.push({
          start: unit.start,
          end: unit.end,
          from: q,
          to: q + 1,
          text: record.zh,
          record,
          sourceStart: 0,
          sourceEnd: record.src.length,
          kind: "single",
          queryCoverage: 1 / query.length,
          recordCoverage: 1
        });
    }
    for (let q = 0; q < query.length; q++) {
      for (let r = 0; r < units.length; r++) {
        if (++work > 5e4 || budget && --budget.remaining < 0) return Object.assign([], { limited: true });
        let length = 0;
        while (q + length < query.length && r + length < units.length && sameSentence(query[q + length], units[r + length])) {
          if (++work > 5e4 || budget && --budget.remaining < 0) return Object.assign([], { limited: true });
          if (length && (query[q + length].block !== query[q].block || units[r + length].block !== units[r].block || query[q + length - 1].boundary !== units[r + length - 1].boundary))
            break;
          length++;
          const ellipsis = automaticOnly && inferred.some((g) => g.kind === "ellipsis" && g.from === r && g.to === r + length);
          if (automaticOnly && !ellipsis && (q > 0 && query[q - 1].boundary !== "stop" || query[q + length - 1].boundary !== "stop")) continue;
          const text2 = automaticOnly ? inferredSentenceTarget(record, inferred, r, r + length) : target(record, units, r, r + length);
          if (text2 == null) continue;
          out.push({
            start: query[q].start,
            end: query[q + length - 1].end,
            from: q,
            to: q + length,
            text: text2,
            ...automaticOnly ? { alignment: "inferred" } : {},
            ...ellipsis ? { alignmentBasis: "ellipsis" } : {},
            queryCoverage: length / query.length,
            recordCoverage: length / units.length,
            record,
            sourceStart: units[r].start,
            sourceEnd: units[r + length - 1].end,
            kind: r === 0 && length === units.length && units[0].start === 0 && units.at(-1).end === record.src.length ? length === query.length ? "whole" : length === 1 ? "single" : "block" : "extracted"
          });
        }
      }
    }
  }
  return out;
}
function joinSentenceBlock(source, translated, trimCachedSeam = false) {
  const seam = source.match(/([,，、;；]\s*|\r?\n|\\n)$/)?.[0];
  if (!seam) return trimCachedSeam ? translated.replace(/[,，、;；]\s*$/u, "") : translated;
  return translated.replace(/[,，、;；\s]+$/u, "") + seam;
}
function renderSentencePlan(plan, gaps = /* @__PURE__ */ new Map()) {
  const pieces = [
    ...plan.matches.map((m) => ({
      start: m.start,
      end: m.end,
      text: m.text,
      restoreSeam: true,
      trimCachedSeam: /[,，、;；]\s*$/.test(m.record.src.slice(m.sourceStart, m.sourceEnd))
    })),
    ...plan.gaps.map((g) => ({ ...g, text: gaps.get(g.id) ?? g.text, restoreSeam: gaps.has(g.id), trimCachedSeam: false }))
  ].sort((a, b) => a.start - b.start);
  let at = 0, out = "";
  for (const part of pieces) {
    out += plan.src.slice(at, part.start) + (part.restoreSeam ? joinSentenceBlock(plan.src.slice(part.start, part.end), part.text, part.trimCachedSeam) : part.text);
    at = part.end;
  }
  return out + plan.src.slice(at);
}
function planSentenceTranslation(src, records2, opts) {
  return planSentenceTranslationView(src, records2, opts, true);
}
function planSentenceTranslationView(src, records2, opts, unwrap) {
  const units = sentenceQueryViewUnits(src, opts);
  const expanded = expandRecords(records2);
  const normal = candidates(src, expanded, opts);
  const initial = chooseSentencePlan(src, units, normal, normal.limited === true, opts?.category);
  if (initial.status === "full" || initial.limited || opts?.structure?.mode === "disabled") return initial;
  const views = unwrap ? sentenceQueryViews(src, opts) : [];
  if (views.length > 1 && !initial.ambiguous) {
    let best = initial;
    let covered = initial.matches.reduce((sum2, m) => sum2 + m.end - m.start, 0);
    for (const body of views.slice(1)) {
      const inner = planSentenceTranslationView(body.text, records2, body.opts, false);
      const shifted = {
        ...inner,
        src,
        matches: inner.matches.map((m) => ({ ...m, start: m.start + body.offset, end: m.end + body.offset })),
        gaps: inner.gaps.map((g) => ({ ...g, id: `${g.start + body.offset}:${g.end + body.offset}`, start: g.start + body.offset, end: g.end + body.offset })),
        zh: null
      };
      if (initial.matches.length) {
        const additions2 = remapSentenceMatches(
          shifted.matches.filter((m) => normal.every((hit) => m.end <= hit.start || m.start >= hit.end)),
          units,
          src,
          opts
        ).filter((m) => m.from >= 0 && m.to > m.from);
        const merged = chooseSentencePlan(src, units, [...initial.matches, ...additions2], !!shifted.limited, opts?.category);
        merged.ambiguous ||= shifted.ambiguous;
        if (merged.status === "full" || merged.limited || merged.ambiguous) return merged;
        const chars2 = merged.matches.reduce((sum2, m) => sum2 + m.end - m.start, 0);
        if (chars2 > covered) {
          best = merged;
          covered = chars2;
        }
        continue;
      }
      if (shifted.status === "full") {
        shifted.zh = renderSentencePlan(shifted);
        return shifted;
      }
      if (shifted.limited || shifted.ambiguous) return shifted;
      const chars = shifted.matches.reduce((sum2, m) => sum2 + m.end - m.start, 0);
      if (chars > covered) {
        best = shifted;
        covered = chars;
      }
    }
    return applyLineFallback(src, expanded, best, normal, opts);
  }
  const structure = scanStructuredText(src.replace(new RegExp(SENTENCE_TOKEN_SOURCE, "g"), " "), opts?.structure);
  const inferred = structure.units.length || structure.diagnostics.length ? [] : candidates(src, expanded, opts, true);
  if (inferred.limited) return { ...initial, limited: true };
  const additions = inferred.filter((m) => normal.every((hit) => m.end <= hit.start || m.start >= hit.end));
  const result = chooseSentencePlan(src, units, [...initial.matches, ...additions], false, opts?.category);
  result.ambiguous ||= initial.ambiguous;
  return applyLineFallback(src, expanded, result, normal, opts);
}
function remapSentenceMatches(matches, units, src, opts) {
  const bodies = sentenceQueryViews(src, opts).slice(1);
  return matches.map((m) => ({
    ...m,
    from: units.findIndex((u) => u.start === m.start || u.start === 0 && bodies.some((v) => m.start === v.offset)),
    to: units.findIndex((u) => u.end === m.end || u.end === src.length && bodies.some((v) => m.end === v.offset + v.text.length)) + 1
  }));
}
function applyLineFallback(src, records2, plan, normal, opts) {
  if (plan.status === "full" || plan.limited) return plan;
  const lines = queryLines(src);
  if (!lines.length) return plan;
  const keys = new Set(lines.map((line) => wholeSentenceKey(line.text)));
  const independent = records2.filter((r) => keys.has(logicAuthorityKey(r.src, recordUnitOpts(r))));
  if (!independent.length) return plan;
  const newlines = listNewlineSpans(src).map((br) => ({ ...br, kind: "hard" }));
  const lineOpts = { ...opts, newlines: [...opts?.newlines || [], ...newlines] };
  const units = sentenceQueryViewUnits(src, lineOpts);
  const previous = remapSentenceMatches(plan.matches, units, src, opts);
  if (previous.some((m) => m.from < 0 || m.to <= m.from)) return plan;
  const selected = candidates(src, independent, lineOpts);
  if (selected.limited) return { ...plan, limited: true };
  const additions = selected.filter(
    (m) => lines.some((line) => line.start === m.start && wholeSentenceKey(src.slice(m.start, m.end)) === wholeSentenceKey(line.text)) && normal.every((hit) => m.end <= hit.start || m.start >= hit.end) && plan.matches.every((hit) => m.end <= hit.start || m.start >= hit.end)
  );
  const result = chooseSentencePlan(src, units, [...previous, ...additions], false, opts?.category);
  result.ambiguous ||= plan.ambiguous;
  return result;
}
function chooseSentencePlan(src, units, possible, limited, category) {
  const locked = possible.filter((m) => m.alignment !== "inferred" && m.record.local && m.record.engine === "manual" && !m.record.derived);
  possible = possible.filter(
    (m) => locked.every((lock) => {
      if (m.end <= lock.start || m.start >= lock.end || m === lock) return true;
      return m.start === lock.start && m.end === lock.end && m.text === lock.text;
    })
  );
  let ambiguous = false;
  const ranges = /* @__PURE__ */ new Map();
  for (const m of possible) {
    const key2 = `${m.from}:${m.to}`;
    ranges.set(key2, [...ranges.get(key2) || [], m]);
  }
  possible = [];
  for (const group of ranges.values()) {
    const chosen = chooseAuthorityMatch(group, src, category);
    if (chosen.ambiguous) {
      ambiguous = true;
      continue;
    }
    possible.push(chosen.match);
  }
  const best = Array.from({ length: units.length + 1 }, () => ({ matches: [], covered: 0, chars: 0 }));
  for (let i2 = units.length - 1; i2 >= 0; i2--) {
    best[i2] = best[i2 + 1];
    for (const m of possible.filter((m2) => m2.from === i2)) {
      const rest = best[m.to];
      const next = { matches: [m, ...rest.matches], covered: m.to - m.from + rest.covered, chars: m.end - m.start + rest.chars };
      const old = best[i2];
      if (next.covered > old.covered || next.covered === old.covered && (next.chars > old.chars || next.chars === old.chars && next.matches.length < old.matches.length))
        best[i2] = next;
    }
  }
  const matches = best[0].matches;
  const gaps = [];
  let i = 0;
  while (i < units.length) {
    const hit = matches.find((m) => m.from === i);
    if (hit) {
      i = hit.to;
      continue;
    }
    const first = i++;
    while (i < units.length && units[i].block === units[first].block && !matches.some((m) => m.from === i)) i++;
    const start = units[first].start, end = units[i - 1].end;
    gaps.push({ id: `${start}:${end}`, start, end, text: src.slice(start, end) });
  }
  const status = matches.length ? gaps.length ? "partial" : "full" : "miss";
  const plan = { src, status, matches, gaps, zh: null, coverage: units.length ? best[0].covered / units.length : 0, ambiguous, limited };
  if (status === "full") plan.zh = renderSentencePlan(plan);
  return plan;
}
function chooseAuthorityMatch(group, src, category) {
  const output = (m) => joinSentenceBlock(src.slice(m.start, m.end), m.text, /[,，、;；]\s*$/.test(m.record.src.slice(m.sourceStart, m.sourceEnd)));
  const proven = group.filter((m) => m.alignment !== "inferred");
  let pool = proven.length ? proven : group;
  if (!proven.length && new Set(pool.map(output)).size > 1) return { ambiguous: true };
  const explicit = pool.filter((m) => !m.record.structuralAlias);
  if (explicit.length) pool = explicit;
  else {
    const context2 = Math.min(...pool.map((m) => m.record.structureContext || 0));
    pool = pool.filter((m) => (m.record.structureContext || 0) === context2);
  }
  const rank = Math.max(...pool.map((m) => cacheEngineRank(m.record.engine)));
  pool = pool.filter((m) => cacheEngineRank(m.record.engine) === rank);
  const exact = pool.filter((m) => !m.record.derived && m.record.src === src && m.start === 0 && m.end === src.length);
  if (exact.length) pool = exact;
  const want = String(category || "").trim();
  if (want) {
    const matched = pool.filter((m) => m.record.category === want);
    if (matched.length) pool = matched;
  }
  const local = pool.filter((m) => m.record.local);
  if (local.length) pool = local;
  if (new Set(pool.map(output)).size === 1) {
    const ordered = [...pool].sort(
      (a, b) => (a.record.local ? 0 : 1) - (b.record.local ? 0 : 1) || (a.kind === "extracted" ? 1 : 0) - (b.kind === "extracted" ? 1 : 0) || a.record.id.localeCompare(b.record.id)
    );
    return { match: ordered[0], ambiguous: false };
  }
  return { ambiguous: true };
}
function createSentenceResolver(records2) {
  const inverted = /* @__PURE__ */ new Map();
  const whole = /* @__PURE__ */ new Map();
  const key2 = (s) => JSON.stringify([s.key, s.tone, s.controls]);
  const addWhole = (k, record) => {
    whole.set(k, [...whole.get(k) || [], record]);
  };
  for (const record of expandRecords(records2)) {
    const unitOpts = recordUnitOpts(record);
    const raw = wholeSentenceKey(record.src);
    addWhole(raw, record);
    const logic = logicAuthorityKey(record.src, unitOpts);
    if (logic !== raw) addWhole(logic, record);
    for (const unit of sentenceUnits(record.src, unitOpts)) {
      const k = key2(unit), bucket = inverted.get(k) || /* @__PURE__ */ new Set();
      bucket.add(record);
      inverted.set(k, bucket);
    }
  }
  function select(src, opts) {
    const exact = whole.get(wholeSentenceKey(src)) || [];
    const selected = new Set(exact);
    let limited = false;
    for (const lookup of sentenceQueryKeys(src, opts)) {
      for (const record of whole.get(lookup) || []) {
        selected.add(record);
        if (selected.size > 500) return Object.assign([...exact], { limited: true });
      }
    }
    for (const unit of sentenceQueryUnits(src, opts)) {
      if (unit.boundary === "structure") for (const r of whole.get(wholeSentenceKey(src.slice(unit.start, unit.end))) || []) selected.add(r);
      if (selected.size > 500) return Object.assign([...exact], { limited: true });
      const bucket = inverted.get(key2(unit));
      if ((bucket?.size || 0) > 500) {
        limited = true;
        continue;
      }
      for (const record of bucket || []) {
        selected.add(record);
        if (selected.size > 500) return Object.assign([...exact], { limited: true });
      }
    }
    return Object.assign([...selected], { limited });
  }
  return {
    select,
    plan(src) {
      const selected = select(src);
      const plan = planSentenceTranslation(src, selected.limited ? [] : selected);
      return selected.limited ? { ...plan, limited: true } : plan;
    }
  };
}

// lib/translate/lookup.ts
function normalizeTranslateKey(text2) {
  let s = String(text2 ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  s = s.replace(/^"+/, "").replace(/("\);|"\))$/, "");
  try {
    s = s.normalize("NFKC");
  } catch {
  }
  return s;
}

// lib/translate/text-nature.ts
var TEXT_NATURES = ["dialogue", "story", "choice", "name", "desc", "system", "other"];
var NATURE_CATEGORIES = {
  dialogue: ["dialogue"],
  story: ["story"],
  choice: ["choice"],
  name: ["item", "weapon", "armor", "skill", "actor", "enemy", "state", "map"],
  desc: ["item_desc", "weapon_desc", "armor_desc", "skill_desc", "actor_profile", "actor_nickname"],
  system: ["system", "state_msg", "plugin", "resource"],
  other: ["other"]
};
var CATEGORY_TO_NATURE = /* @__PURE__ */ new Map();
for (const [nature, cats] of Object.entries(NATURE_CATEGORIES)) {
  for (const cat of cats) CATEGORY_TO_NATURE.set(cat, nature);
}
function parseTextNature(raw) {
  const value = String(raw || "").trim().toLowerCase();
  return TEXT_NATURES.includes(value) ? value : "";
}
function categoriesForNature(nature) {
  return NATURE_CATEGORIES[nature];
}
function normalizeCacheCategory(raw) {
  const value = String(raw || "").trim();
  return value;
}

// services/storage/client.ts
import { spawn } from "node:child_process";
import fs4 from "node:fs";
import os from "node:os";
import path4 from "node:path";
import { Worker } from "node:worker_threads";

// constants/paths.ts
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// constants/brand.ts
var PRODUCT_DISPLAY_NAME = "Chaya";
var PRODUCT_SLUG = "chaya";
var SHELL_BUNDLE_BASE = PRODUCT_DISPLAY_NAME;
var SHELL_APP_NAME = `${SHELL_BUNDLE_BASE}.app`;
var SHELL_WIN_DIR_NAME = SHELL_BUNDLE_BASE;
var LEGACY_SHELL_APP_NAMES = ["ShiruKit.app", "nwjs.app"];
var WIN_SHELL_EXE_NAMES = ["nw.exe", "Game.exe", `${PRODUCT_DISPLAY_NAME}.exe`];
var SHELL_LAUNCHER_WIN = `${PRODUCT_DISPLAY_NAME}\u542F\u52A8.bat`;
var SHELL_LAUNCHER_MAC = `${PRODUCT_DISPLAY_NAME}\u542F\u52A8.command`;
var SHELL_LAUNCHER_LINUX = `${PRODUCT_DISPLAY_NAME}\u542F\u52A8.sh`;
var CONFIG_FILE_NAME = `${PRODUCT_SLUG}.config.json`;
var LEGACY_CONFIG_FILE_NAMES = ["shiru-kit.config.json"];
var PLUGIN_RUNTIME_NAME = `${PRODUCT_DISPLAY_NAME}Log`;
var PLUGIN_ENV_NAME = `${PRODUCT_DISPLAY_NAME}Env`;
var PLUGIN_LOADER_NAME = `${PRODUCT_DISPLAY_NAME}Loader`;
var PLUGIN_TRANS_NAME = `${PRODUCT_DISPLAY_NAME}Trans`;
var PLUGIN_EDIT_NAME = `${PRODUCT_DISPLAY_NAME}Edit`;
var PLUGIN_BOOST_NAME = `${PRODUCT_DISPLAY_NAME}Boost`;
var PLUGIN_AGENT_NAME = `${PRODUCT_DISPLAY_NAME}Agent`;
var CONTENT_FILE_PREFIX = PRODUCT_SLUG;

// constants/path-names.ts
var DATA_DIR_NAME = "data";
var SHELL_DIR_NAME = "shell";
var SHELL_CACHE_DIR_NAME = "shell-cache";
var TRANSLATE_CACHE_DIR_NAME = "translate-cache";
var TRANSLATE_CACHE_DB_NAME = "shared.sqlite";
var TRANSLATE_JOBS_DIR_NAME = "translate-jobs";
var LOGS_DIR_NAME = "logs";
var PLUGIN_LOGS_DIR_NAME = "plugins";
var AGENT_ACTIVITY_LOGS_DIR_NAME = "agent-activity";
var GAME_ACTIVITY_LOGS_DIR_NAME = "game-activity";
var COMPANION_MEMORY_DIR_NAME = "companion-memory";
var COMPANION_MEMORY_DB_NAME = "companion.sqlite";
var GAME_AGENT_DIR_NAME = "game-agent";
var TRANSLATION_PACKS_DIR_NAME = "translation-packs";
var UPDATES_DIR_NAME = "updates";
var DOWNLOAD_JOBS_FILE_NAME = "download-jobs.json";
var PLUGINS_DIR_NAME = "plugins";
var NODE_MODULES_DIR_NAME = "node_modules";

// constants/paths.ts
function findRepoRoot(startDir) {
  let curr = startDir;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(join(curr, "package.json"))) return curr;
    const parent = dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return resolve(startDir, "..");
}
var ROOT_PATH = process.env.CHAYA_ROOT ? resolve(process.env.CHAYA_ROOT) : findRepoRoot(dirname(fileURLToPath(import.meta.url)));
function defaultDataDir() {
  if (process.env.CHAYA_DATA_DIR) return resolve(process.env.CHAYA_DATA_DIR);
  if (process.platform === "darwin" && process.env.HOME) {
    return join(process.env.HOME, "Library", "Application Support", "Chaya", "data");
  }
  return join(ROOT_PATH, DATA_DIR_NAME);
}
var DATA_DIR = defaultDataDir();
var CONFIG_FILE_PATH = process.env.CHAYA_DATA_DIR ? join(DATA_DIR, CONFIG_FILE_NAME) : join(ROOT_PATH, CONFIG_FILE_NAME);
var LEGACY_CONFIG_FILE_PATHS = [
  ...LEGACY_CONFIG_FILE_NAMES.map((name2) => join(ROOT_PATH, name2)),
  ...process.env.CHAYA_DATA_DIR ? [join(ROOT_PATH, CONFIG_FILE_NAME), ...LEGACY_CONFIG_FILE_NAMES.map((name2) => join(DATA_DIR, name2))] : []
];
var SHELL_DIR = join(DATA_DIR, SHELL_DIR_NAME);
var SHELL_CACHE_DIR = join(DATA_DIR, SHELL_CACHE_DIR_NAME);
var SHELL_APP_PATH = join(SHELL_DIR, SHELL_APP_NAME);
var SHELL_WIN_PATH = join(SHELL_DIR, SHELL_WIN_DIR_NAME);
var LEGACY_SHELL_AT_DATA_PATHS = LEGACY_SHELL_APP_NAMES.map((name2) => join(DATA_DIR, name2));
var LEGACY_SHELL_IN_SHELL_PATHS = LEGACY_SHELL_APP_NAMES.map((name2) => join(SHELL_DIR, name2));
var IS_WIN32 = process.platform === "win32";
var TRANSLATE_CACHE_DIR = join(DATA_DIR, TRANSLATE_CACHE_DIR_NAME);
var TRANSLATE_CACHE_DB_PATH = join(TRANSLATE_CACHE_DIR, TRANSLATE_CACHE_DB_NAME);
var TRANSLATE_JOBS_DIR = join(DATA_DIR, TRANSLATE_JOBS_DIR_NAME);
var CACHE_WORKER_PATH = join(ROOT_PATH, "native", "bin", "chaya-cache-worker.mjs");
var RGSS_EXTRACT_WORKER_PATH = join(ROOT_PATH, "native", "bin", "chaya-rgss-extract-worker.mjs");
var SEED_INVENTORY_WORKER_PATH = join(ROOT_PATH, "native", "bin", "chaya-seed-inventory-worker.mjs");
var SEED_JOB_WORKER_PATH = join(ROOT_PATH, "native", "bin", "chaya-seed-job-worker.mjs");
var TRANSLATION_PACKS_DIR = join(DATA_DIR, TRANSLATION_PACKS_DIR_NAME);
var DOWNLOAD_JOBS_PATH = join(DATA_DIR, DOWNLOAD_JOBS_FILE_NAME);
var UPDATES_DIR = join(DATA_DIR, UPDATES_DIR_NAME);
var GAME_AGENT_DIR = join(DATA_DIR, GAME_AGENT_DIR_NAME);
var LOGS_DIR = process.env.CHAYA_LOGS_DIR ? resolve(process.env.CHAYA_LOGS_DIR) : join(ROOT_PATH, LOGS_DIR_NAME);
var PLUGIN_LOGS_DIR = join(LOGS_DIR, PLUGIN_LOGS_DIR_NAME);
var AGENT_ACTIVITY_LOGS_DIR = join(LOGS_DIR, AGENT_ACTIVITY_LOGS_DIR_NAME);
var GAME_ACTIVITY_LOGS_DIR = join(LOGS_DIR, GAME_ACTIVITY_LOGS_DIR_NAME);
var COMPANION_MEMORY_DIR = join(DATA_DIR, COMPANION_MEMORY_DIR_NAME);
var COMPANION_MEMORY_DB_PATH = join(COMPANION_MEMORY_DIR, COMPANION_MEMORY_DB_NAME);
var PLUGINS_DIR = join(ROOT_PATH, PLUGINS_DIR_NAME);
var PLUGINS_MANIFEST_PATH = join(PLUGINS_DIR, "mv", "manifest.json");
var NODE_MODULES_DIR = join(ROOT_PATH, NODE_MODULES_DIR_NAME);
var KUROMIJI_DICT_PATH = join(NODE_MODULES_DIR, "kuromoji", "dict");

// lib/integration/mcp-port.ts
function joinPath(platform, ...parts) {
  const sep = platform === "win32" ? "\\" : "/";
  return parts.filter(Boolean).map((part, i) => i === 0 ? part.replace(/[\\/]+$/, "") : part.replace(/^[\\/]+|[\\/]+$/g, "")).join(sep);
}
function mcpPortConfigDir(env) {
  if (env.platform === "darwin") return joinPath(env.platform, env.home, "Library", "Application Support", "Chaya");
  if (env.platform === "win32") return joinPath(env.platform, env.appData || joinPath(env.platform, env.home, "AppData", "Roaming"), "Chaya");
  return joinPath(env.platform, env.xdgConfigHome || joinPath(env.platform, env.home, ".config"), "chaya");
}
function processMcpPortEnv(home) {
  const env = typeof process !== "undefined" ? process.env : {};
  return {
    platform: typeof process !== "undefined" ? process.platform : "linux",
    home: home || env.HOME || env.USERPROFILE || "",
    appData: env.APPDATA || void 0,
    xdgConfigHome: env.XDG_CONFIG_HOME || void 0
  };
}

// services/log/operation.ts
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID as randomUUID2 } from "node:crypto";
import { isMainThread, parentPort, threadId } from "node:worker_threads";

// services/log/bus.ts
import path2 from "node:path";

// lib/log/types.ts
var LOG_LEVELS = ["ok", "warn", "fail", "info", "debug"];
var LEVEL_SET = new Set(LOG_LEVELS);
function normalizeLogLevel(raw) {
  const v = String(raw || "info").toLowerCase();
  if (v === "error" || v === "fatal") return "fail";
  if (v === "success" || v === "done") return "ok";
  if (v === "trace" || v === "log") return "debug";
  if (LEVEL_SET.has(v)) return v;
  return "info";
}

// lib/log/entry.ts
var MAX_LOG_ENTRY_BYTES = 16 * 1024;
var IMPORTANT_KEYS = ["operationId", "parentId", "requestId", "id", "operation", "method", "path", "status", "elapsedMs", "state", "outcome", "phase", "startedAt", "finishedAt"];
function utf8Bytes(text2) {
  let bytes = 0;
  for (const character of text2) {
    const point = character.codePointAt(0);
    bytes += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
  }
  return bytes;
}
function compactMeta(value, depth = 0, budget = { nodes: 128, characters: 4e3 }) {
  if (--budget.nodes < 0) return "[omitted]";
  if (typeof value === "string") {
    const limit = Math.max(0, Math.min(1024, budget.characters));
    budget.characters -= Math.min(value.length, limit);
    return value.length > limit ? `${value.slice(0, limit)} [truncated]` : value;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "bigint") return String(value).slice(0, 128);
    return typeof value === "function" || typeof value === "symbol" ? void 0 : value;
  }
  if (depth >= 4) return "[omitted]";
  if (Array.isArray(value)) {
    const out2 = [];
    for (let i = 0; i < Math.min(value.length, 16) && budget.nodes > 0; i++) out2.push(compactMeta(value[i], depth + 1, budget));
    return out2;
  }
  const out = [];
  for (const key2 in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key2)) continue;
    if (out.length >= 24 || budget.nodes <= 0) {
      out.push(["truncated", true]);
      break;
    }
    out.push([key2.slice(0, 128), compactMeta(value[key2], depth + 1, budget)]);
  }
  return Object.fromEntries(out);
}
function serializeLogEntry(entry) {
  const meta = entry.meta;
  let reduced;
  const important = {};
  try {
    for (const key2 of IMPORTANT_KEYS) {
      const value = meta?.[key2];
      if (["string", "number", "boolean"].includes(typeof value)) important[key2] = typeof value === "string" ? value.slice(0, 128) : value;
    }
    reduced = compactMeta(meta);
  } catch {
    reduced = { truncated: true };
  }
  const compact = {
    id: String(entry.id).slice(0, 128),
    ts: Number.isFinite(entry.ts) ? entry.ts : Date.now(),
    level: entry.level,
    source: String(entry.source).slice(0, 64),
    message: String(entry.message).slice(0, 2e3),
    meta: reduced && typeof reduced === "object" && !Array.isArray(reduced) ? { ...reduced, ...important } : reduced
  };
  let line = `${JSON.stringify(compact)}
`;
  if (utf8Bytes(line) <= MAX_LOG_ENTRY_BYTES) return line;
  compact.meta = { truncated: true, ...important };
  line = `${JSON.stringify(compact)}
`;
  return utf8Bytes(line) <= MAX_LOG_ENTRY_BYTES ? line : `${JSON.stringify({ ...compact, message: compact.message.slice(0, 500) })}
`;
}
function compactLogEntry(entry) {
  return JSON.parse(serializeLogEntry(entry));
}
function logEntryBytes(entry) {
  return utf8Bytes(`${JSON.stringify(entry)}
`);
}

// lib/log/buffer.ts
var LogBuffer = class {
  constructor(capacity = 2e3, maxBytes = 8 * 1024 * 1024) {
    this.capacity = capacity;
    this.maxBytes = maxBytes;
    this.rows = [];
    this.sizes = [];
    this.bytes = 0;
    this.dropped = 0;
  }
  append(raw) {
    const entry = compactLogEntry(raw);
    const size = logEntryBytes(entry);
    this.rows.push(entry);
    this.sizes.push(size);
    this.bytes += size;
    while (this.rows.length > this.capacity || this.bytes > this.maxBytes) {
      this.rows.shift();
      this.bytes -= this.sizes.shift();
      this.dropped++;
    }
    return entry;
  }
  list() {
    return this.rows;
  }
  clear() {
    this.rows = [];
    this.sizes = [];
    this.bytes = 0;
    this.dropped = 0;
  }
  stats() {
    return { sizeBytes: this.bytes, maxBytes: this.maxBytes, maxEntryBytes: MAX_LOG_ENTRY_BYTES, droppedEntries: this.dropped };
  }
};

// lib/service-mode/target.ts
function parseBuildTarget(value) {
  const target2 = value?.trim().toLowerCase() || "server";
  if (target2 === "dev" || target2 === "cloud" || target2 === "server") return target2;
  throw new Error(`Invalid NEXT_PUBLIC_CHAYA_TARGET configuration: ${value}; supported values: dev, cloud, server`);
}
var BUILD_TARGET = parseBuildTarget(process.env.NEXT_PUBLIC_CHAYA_TARGET);
var DEV_TARGET_ENV = "CHAYA_DEV_TARGET";
function isDevTarget(value) {
  return value === "cloud" || value === "server";
}
function getDevTarget() {
  const raw = process.env[DEV_TARGET_ENV];
  const explicit = raw?.trim().toLowerCase();
  if (isDevTarget(explicit)) return explicit;
  if (explicit) throw new Error(`Invalid CHAYA_DEV_TARGET configuration: ${raw}; supported values: cloud, server`);
  return process.env.CHAYA_SERVICE?.trim().toLowerCase() === "remote" ? "cloud" : "server";
}

// lib/service-mode/mode.ts
function parseExplicitServiceMode() {
  const explicit = process.env.CHAYA_SERVICE?.trim().toLowerCase();
  if (!explicit) return void 0;
  if (explicit === "remote" || explicit === "app" || explicit === "local") return explicit;
  throw new Error(`Invalid CHAYA_SERVICE configuration: ${process.env.CHAYA_SERVICE}; supported values: local, app, remote`);
}
function getServiceMode() {
  const explicit = parseExplicitServiceMode();
  if (BUILD_TARGET === "cloud" || process.env.VERCEL === "1") return "remote";
  if (BUILD_TARGET === "dev") {
    if (getDevTarget() === "cloud") return "remote";
    return explicit === "app" ? "app" : "local";
  }
  return explicit ?? "local";
}
function canUseDisk(mode = getServiceMode()) {
  return mode !== "remote";
}

// services/log/file-store.ts
import { randomUUID } from "node:crypto";
import fs2 from "node:fs";
import path from "node:path";
var DEFAULT_RETENTION_DAYS = 14;
var DEFAULT_HYDRATE_LIMIT = 2e3;
var MAX_HYDRATE_BYTES = 4 * 1024 * 1024;
var READ_CHUNK_BYTES = 64 * 1024;
var FLUSH_INTERVAL_MS = 100;
var MAX_PENDING_BYTES = 64 * 1024;
var MAX_QUEUED_BYTES = 1024 * 1024;
var MAX_QUEUED_ENTRIES = 2e3;
var MAX_PENDING_FILES = 32;
var DAY_MS = 24 * 60 * 60 * 1e3;
var LOG_FILE_NAME = /^(\d{4}-\d{2}-\d{2})(?:\.\d{13}-[a-f0-9-]+)?\.ndjson$/;
var LEVEL_PRIORITY = { debug: 0, info: 1, ok: 1, warn: 2, fail: 3 };
var WRITER = /* @__PURE__ */ Symbol.for("chaya.log-file-writer");
var host = globalThis;
var writer = host[WRITER] ??= { pending: /* @__PURE__ */ new Map() };
var pendingClears = writer.clears ??= /* @__PURE__ */ new Set();
function pendingStats() {
  const batches = [...writer.pending.values()];
  return {
    sizeBytes: batches.reduce((sum2, batch) => sum2 + batch.bytes, 0),
    entries: batches.reduce((sum2, batch) => sum2 + batch.lines.length, 0),
    files: writer.pending.size,
    maxBytes: MAX_QUEUED_BYTES,
    maxEntries: MAX_QUEUED_ENTRIES,
    maxFiles: MAX_PENDING_FILES,
    droppedEntries: writer.droppedEntries ?? 0
  };
}
function trimPending() {
  let { sizeBytes, entries } = pendingStats();
  for (const [file, batch] of writer.pending) {
    while (batch.lines.length && (sizeBytes > MAX_QUEUED_BYTES || entries > MAX_QUEUED_ENTRIES || writer.pending.size > MAX_PENDING_FILES)) {
      const size = Buffer.byteLength(batch.lines.shift());
      batch.bytes -= size;
      sizeBytes -= size;
      entries--;
      writer.droppedEntries = (writer.droppedEntries ?? 0) + 1;
    }
    if (!batch.lines.length) writer.pending.delete(file);
    if (sizeBytes <= MAX_QUEUED_BYTES && entries <= MAX_QUEUED_ENTRIES && writer.pending.size <= MAX_PENDING_FILES) break;
  }
}
function diskLogLevel() {
  const level = normalizeLogLevel(process.env.CHAYA_LOG_LEVEL?.trim() || "info");
  return level === "debug" ? "info" : level;
}
function filePolicy(logDir) {
  const slow = path.basename(path.resolve(logDir)) === "slow-http";
  return {
    minimumLevel: diskLogLevel(),
    flushIntervalMs: FLUSH_INTERVAL_MS,
    maxEntryBytes: MAX_LOG_ENTRY_BYTES,
    maxPendingBytes: MAX_QUEUED_BYTES,
    maxPendingEntries: MAX_QUEUED_ENTRIES,
    maxPendingFiles: MAX_PENDING_FILES,
    maxFileBytes: (slow ? 4 : 32) * 1024 * 1024,
    maxTotalBytes: (slow ? 32 : 256) * 1024 * 1024,
    retentionDays: DEFAULT_RETENTION_DAYS,
    automaticCleanup: true,
    readWindowDays: DEFAULT_RETENTION_DAYS
  };
}
function logFiles(logDir) {
  if (!fs2.existsSync(logDir)) return [];
  return fs2.readdirSync(logDir).filter((name2) => LOG_FILE_NAME.test(name2)).sort().flatMap((name2) => {
    try {
      const file = path.join(logDir, name2);
      const stat = fs2.statSync(file);
      return stat.isFile() ? [{ name: name2, file, size: stat.size }] : [];
    } catch {
      return [];
    }
  });
}
function withDirectoryLock(logDir, run) {
  fs2.mkdirSync(logDir, { recursive: true });
  const lock = path.join(logDir, ".write-lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd;
    try {
      fd = fs2.openSync(lock, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const owner = Number(fs2.readFileSync(lock, "utf8"));
        let stale = !owner && Date.now() - fs2.statSync(lock).mtimeMs > 5e3;
        if (Number.isInteger(owner) && owner > 0) {
          try {
            process.kill(owner, 0);
          } catch (error2) {
            stale = error2.code === "ESRCH";
          }
        }
        if (!stale) return false;
        fs2.unlinkSync(lock);
      } catch {
      }
      continue;
    }
    try {
      fs2.writeFileSync(fd, String(process.pid));
      run();
      return true;
    } finally {
      fs2.closeSync(fd);
      fs2.unlinkSync(lock);
    }
  }
  return false;
}
function shrinkLegacyFile(file, maxBytes) {
  const fd = fs2.openSync(file, "r");
  let text2;
  try {
    const size = fs2.fstatSync(fd).size;
    const length = Math.min(size, maxBytes, MAX_HYDRATE_BYTES);
    const buffer2 = Buffer.alloc(length);
    const read = fs2.readSync(fd, buffer2, 0, length, size - length);
    const tail = buffer2.subarray(0, read);
    const boundary = size > length ? tail.indexOf(10) : -1;
    text2 = size > length ? boundary < 0 ? "" : tail.subarray(boundary + 1).toString("utf8") : tail.toString("utf8");
  } finally {
    fs2.closeSync(fd);
  }
  const retained = [];
  let bytes = 0;
  const lines = text2.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = parseLine(lines[i], file, i + 1);
    if (!entry || entry.level === "debug" || entry.ts < Date.now() - DEFAULT_RETENTION_DAYS * DAY_MS) continue;
    const line = serializeLogEntry(entry);
    bytes += Buffer.byteLength(line);
    if (bytes > maxBytes) break;
    retained.push(line);
  }
  const temporary = `${file}.compact.tmp`;
  try {
    fs2.writeFileSync(temporary, retained.reverse().join(""), "utf8");
    fs2.renameSync(temporary, file);
  } finally {
    if (fs2.existsSync(temporary)) fs2.unlinkSync(temporary);
  }
}
function pruneFiles(logDir) {
  const policy = filePolicy(logDir);
  const cutoff = dayKey(Date.now() - policy.retentionDays * DAY_MS);
  for (const file of logFiles(logDir)) {
    if (file.name.slice(0, 10) < cutoff) fs2.unlinkSync(file.file);
    else if (file.size > policy.maxFileBytes) shrinkLegacyFile(file.file, policy.maxFileBytes);
  }
  const files = logFiles(logDir);
  let total = files.reduce((sum2, file) => sum2 + file.size, 0);
  for (const file of files) {
    if (total <= policy.maxTotalBytes) break;
    fs2.unlinkSync(file.file);
    total -= file.size;
  }
}
function writeBatch(file, batch) {
  const logDir = path.dirname(file);
  return withDirectoryLock(logDir, () => {
    pruneFiles(logDir);
    const { maxFileBytes } = filePolicy(logDir);
    let size = fs2.existsSync(file) ? fs2.statSync(file).size : 0;
    let lines = [];
    let bytes = 0;
    const append = () => {
      if (!lines.length) return;
      if (size && size + bytes > maxFileBytes) {
        fs2.renameSync(file, path.join(logDir, `${path.basename(file, ".ndjson")}.${Date.now()}-${randomUUID()}.ndjson`));
        size = 0;
      }
      fs2.appendFileSync(file, lines.join(""), "utf8");
      size += bytes;
      lines = [];
      bytes = 0;
    };
    for (const line of batch.lines) {
      const length = Buffer.byteLength(line);
      if (bytes + length > maxFileBytes) append();
      lines.push(line);
      bytes += length;
    }
    append();
    pruneFiles(logDir);
  });
}
function scheduleFlush() {
  if (!writer.pending.size && !pendingClears.size || writer.timer) return;
  writer.timer = setTimeout(() => {
    writer.timer = void 0;
    flushLogFiles();
  }, FLUSH_INTERVAL_MS);
  writer.timer.unref?.();
}
function flushLogFiles(logDir) {
  for (const dir of pendingClears) {
    if (logDir && dir !== path.resolve(logDir)) continue;
    try {
      if (!withDirectoryLock(dir, () => {
        for (const name2 of fs2.readdirSync(dir)) {
          if (name2.endsWith(".ndjson")) fs2.unlinkSync(path.join(dir, name2));
        }
      }))
        continue;
    } catch {
    }
    pendingClears.delete(dir);
  }
  for (const [file, batch] of writer.pending) {
    if (logDir && path.dirname(file) !== path.resolve(logDir)) continue;
    if (pendingClears.has(path.dirname(file))) continue;
    try {
      if (!writeBatch(file, batch)) continue;
    } catch {
    }
    writer.pending.delete(file);
  }
  if (!writer.pending.size && !pendingClears.size && writer.timer) {
    clearTimeout(writer.timer);
    writer.timer = void 0;
  }
  scheduleFlush();
}
function resolvePluginLogDir() {
  const fromEnv = process.env.CHAYA_LOG_DIR;
  if (fromEnv && fromEnv.trim()) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(ROOT_PATH, fromEnv);
  }
  return PLUGIN_LOGS_DIR;
}
function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}
function dayFile(dir, day) {
  return path.join(dir, `${day}.ndjson`);
}
function appendLogToFile(entry, logDir = resolvePluginLogDir(), options = {}) {
  if (entry.level === "debug") return;
  if (!options.force && LEVEL_PRIORITY[entry.level] < LEVEL_PRIORITY[diskLogLevel()]) return;
  try {
    const file = path.resolve(dayFile(logDir, dayKey(entry.ts)));
    const line = serializeLogEntry(entry);
    const batch = writer.pending.get(file) ?? { lines: [], bytes: 0 };
    batch.lines.push(line);
    batch.bytes += Buffer.byteLength(line);
    writer.pending.set(file, batch);
    trimPending();
    if (!writer.exitRegistered) {
      process.once("exit", () => flushLogFiles());
      writer.exitRegistered = true;
    }
    if (batch.bytes >= MAX_PENDING_BYTES) flushLogFiles(logDir);
    scheduleFlush();
  } catch {
  }
}
function parseLine(line, file, lineNo) {
  const raw = line.trim();
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    const ts = typeof o.ts === "number" ? o.ts : o.createdAt ? Date.parse(o.createdAt) : Date.now();
    if (!o.source || o.message == null) return null;
    return {
      id: String(o.id || `${path.basename(file)}:${lineNo}`),
      ts: Number.isFinite(ts) ? ts : Date.now(),
      level: normalizeLogLevel(o.level),
      source: String(o.source).slice(0, 64),
      message: String(o.message).slice(0, 8e3),
      meta: o.meta
    };
  } catch {
    return null;
  }
}
function loadLogsFromFiles(opts) {
  const logDir = opts?.logDir ?? resolvePluginLogDir();
  const retentionDays = opts?.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const limit = opts?.limit ?? DEFAULT_HYDRATE_LIMIT;
  if (limit <= 0) return [];
  flushLogFiles(logDir);
  if (pendingClears.has(path.resolve(logDir))) return [];
  if (!fs2.existsSync(logDir)) return [];
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1e3;
  const files = fs2.readdirSync(logDir).filter((n) => LOG_FILE_NAME.test(n)).sort().reverse();
  const out = [];
  let remainingBytes = MAX_HYDRATE_BYTES;
  for (const name2 of files) {
    if (out.length >= limit || remainingBytes <= 0) break;
    const day = name2.slice(0, 10);
    const dayTs = Date.parse(`${day}T00:00:00.000Z`);
    if (Number.isFinite(dayTs) && dayTs < cutoff - 24 * 60 * 60 * 1e3) {
      continue;
    }
    const full = path.join(logDir, name2);
    let fd;
    try {
      fd = fs2.openSync(full, "r");
      let position = fs2.fstatSync(fd).size;
      let pending = Buffer.alloc(0);
      while (position > 0 && remainingBytes > 0 && out.length < limit) {
        const size = Math.min(READ_CHUNK_BYTES, position, remainingBytes);
        position -= size;
        remainingBytes -= size;
        const chunk = Buffer.allocUnsafe(size);
        const read = fs2.readSync(fd, chunk, 0, size, position);
        if (read !== size) break;
        const data = Buffer.concat([chunk, pending]);
        let end = data.length;
        for (let i = data.length - 1; i >= 0 && out.length < limit; i--) {
          if (data[i] !== 10) continue;
          const entry = parseLine(data.subarray(i + 1, end).toString("utf8"), full, `byte-${position + i + 1}`);
          if (entry && entry.ts >= cutoff) out.push(entry);
          end = i;
        }
        pending = data.subarray(0, end);
      }
      if (position === 0 && out.length < limit) {
        const entry = parseLine(pending.toString("utf8"), full, 1);
        if (entry && entry.ts >= cutoff) out.push(entry);
      }
    } catch {
    } finally {
      if (fd !== void 0) fs2.closeSync(fd);
    }
  }
  out.reverse().sort((a, b) => a.ts - b.ts);
  return out.length > limit ? out.slice(-limit) : out;
}
function pluginLogFileStats(logDir = resolvePluginLogDir()) {
  const policy = filePolicy(logDir);
  flushLogFiles(logDir);
  if (fs2.existsSync(logDir)) {
    try {
      withDirectoryLock(logDir, () => pruneFiles(logDir));
    } catch {
    }
  }
  if (!fs2.existsSync(logDir)) {
    return { dir: logDir, files: 0, sizeBytes: 0, policy, pending: pendingStats() };
  }
  let files = 0;
  let sizeBytes = 0;
  for (const name2 of fs2.readdirSync(logDir)) {
    if (!name2.endsWith(".ndjson")) continue;
    files += 1;
    try {
      sizeBytes += fs2.statSync(path.join(logDir, name2)).size;
    } catch {
    }
  }
  return { dir: logDir, files, sizeBytes, policy, pending: pendingStats() };
}

// services/log/bus.ts
var MAX = 2e3;
var buffer = new LogBuffer(MAX);
var listeners = /* @__PURE__ */ new Set();
var seq = 0;
var hydrated = false;
function nextId() {
  seq += 1;
  return `${Date.now().toString(36)}-${seq}`;
}
function hydrateOnce() {
  if (hydrated) return;
  hydrated = true;
  if (!canUseDisk()) return;
  try {
    const loaded = loadLogsFromFiles({ limit: MAX });
    for (const entry of loaded) buffer.append(entry);
    pluginLogFileStats();
    pluginLogFileStats(path2.join(resolvePluginLogDir(), "slow-http"));
    seq = buffer.list().length;
  } catch {
  }
}
function appendLog(partial) {
  hydrateOnce();
  const entry = buffer.append({
    id: nextId(),
    ts: partial.ts ?? Date.now(),
    level: normalizeLogLevel(partial.level),
    source: String(partial.source || "unknown").slice(0, 64),
    message: String(partial.message ?? "").slice(0, 8e3),
    meta: partial.meta
  });
  if (canUseDisk()) appendLogToFile(entry);
  for (const fn of listeners) {
    try {
      fn(entry);
    } catch {
    }
  }
  return entry;
}

// services/log/operation.ts
var context = new AsyncLocalStorage();
function runtimeEvent(level, source, message, meta, forward = false, ts = Date.now()) {
  try {
    const entry = { level, source, message, meta, ts };
    if (!isMainThread && parentPort && (forward || process.env.CHAYA_LOG_FORWARD_TO_PARENT === "1")) {
      parentPort.postMessage({ type: "translation-log", entry });
    } else appendLog(entry);
  } catch {
  }
}
function operationId(value) {
  return value && /^[a-zA-Z0-9:_-]{1,100}$/.test(value) ? value : randomUUID2();
}
function startOperation(source, operation, meta = {}, options = {}) {
  const id = operationId(options.operationId);
  const startedAt = Date.now();
  const started = performance.now();
  const base = { ...meta, operation, operationId: id, parentId: context.getStore()?.operationId, pid: process.pid, threadId, startedAt };
  let ended = false;
  const elapsedMs = () => Math.round((performance.now() - started) * 10) / 10;
  const mark = (stage, details = {}) => runtimeEvent("debug", source, `${operation}: ${stage}`, { ...base, ...details, stage, elapsedMs: elapsedMs() });
  if (options.start !== false) mark("started");
  return {
    id,
    startedAt,
    elapsedMs,
    mark,
    run(fn) {
      return context.run({ operationId: id }, fn);
    },
    end(outcome = "completed", details = {}) {
      if (ended) return;
      ended = true;
      const duration = elapsedMs();
      const slow = duration >= (options.slowMs ?? 1e3);
      runtimeEvent(outcome === "failed" ? "fail" : slow ? "warn" : options.level ?? "debug", source, `${operation}: ${outcome} (${duration}ms)`, {
        ...base,
        ...details,
        outcome,
        elapsedMs: duration,
        slow,
        finishedAt: Date.now()
      });
    },
    fail(error, details = {}) {
      const errorName = error && typeof error === "object" && "name" in error ? String(error.name) : "UnknownError";
      this.end(errorName === "AbortError" ? "cancelled" : "failed", {
        ...details,
        errorName,
        errorCode: error && typeof error === "object" && "code" in error ? String(error.code) : void 0
      });
    }
  };
}

// services/storage/daemon-lock.ts
import fs3 from "node:fs";
import path3 from "node:path";
import { DatabaseSync } from "node:sqlite";
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error.code;
    return code !== "ESRCH";
  }
}
function readMetaSafe(file) {
  try {
    if (!fs3.existsSync(file)) return null;
    const raw = JSON.parse(fs3.readFileSync(file, "utf8"));
    if (raw && Number.isInteger(raw.pid) && typeof raw.startedAt === "number" && typeof raw.port === "number" && typeof raw.authToken === "string" && typeof raw.dataDir === "string") {
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}
function readStorageDaemonMeta(dataDir) {
  const resolvedDir = typeof dataDir === "string" && dataDir ? dataDir : path3.join(process.cwd(), "data");
  const metaFile = path3.join(resolvedDir, "runtime", "storage-daemon.json");
  const lockFile = path3.join(resolvedDir, "runtime", "storage-daemon.lock");
  const meta = readMetaSafe(metaFile);
  const owner = readMetaSafe(lockFile);
  if (!meta || !owner || !meta.instanceId || meta.instanceId !== owner.instanceId) return null;
  if (!isPidAlive(meta.pid)) return null;
  return meta;
}

// services/storage/client.ts
function resolveNativeBin(name2) {
  const root = typeof ROOT_PATH === "string" && ROOT_PATH ? ROOT_PATH : process.cwd();
  const direct = path4.join(root, "native/bin", name2);
  if (fs4.existsSync(direct)) return direct;
  const cwdCandidate = path4.join(process.cwd(), "native/bin", name2);
  if (fs4.existsSync(cwdCandidate)) return cwdCandidate;
  return direct;
}
function resolveDataDir() {
  return typeof DATA_DIR === "string" && DATA_DIR ? DATA_DIR : path4.join(process.cwd(), "data");
}
var worker;
var responseBuffer;
var pause = new Int32Array(new SharedArrayBuffer(4));
var locatorPublished = false;
function publishLocator() {
  if (locatorPublished) return;
  if (process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID !== void 0) return;
  const dir = mcpPortConfigDir(processMcpPortEnv(os.homedir()));
  fs4.mkdirSync(dir, { recursive: true, mode: 448 });
  const file = path4.join(dir, "storage-runtime.json");
  const tmp = `${file}.${process.pid}.tmp`;
  const entry = resolveNativeBin("chaya-storage-daemon.mjs");
  const dataDir = resolveDataDir();
  const rootDir = typeof ROOT_PATH === "string" && ROOT_PATH ? ROOT_PATH : process.cwd();
  fs4.writeFileSync(tmp, JSON.stringify({ dataDir, entry, executable: process.execPath, root: rootDir }), {
    mode: 384
  });
  fs4.renameSync(tmp, file);
  locatorPublished = true;
}
function ensureStorageDaemon() {
  publishLocator();
  const dataDir = resolveDataDir();
  let meta = readStorageDaemonMeta(dataDir);
  if (meta?.port) return meta;
  const entry = resolveNativeBin("chaya-storage-daemon.mjs");
  if (!fs4.existsSync(entry)) throw new Error("Storage runtime is missing; run pnpm build:translate");
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      CHAYA_ROOT: typeof ROOT_PATH === "string" && ROOT_PATH && fs4.existsSync(path4.join(ROOT_PATH, "native/bin")) ? ROOT_PATH : process.cwd(),
      CHAYA_DATA_DIR: typeof DATA_DIR === "string" && DATA_DIR ? DATA_DIR : path4.join(process.cwd(), "data")
    }
  });
  let spawnError;
  child.once("error", (error) => {
    spawnError = error;
  });
  child.unref();
  const deadline = Date.now() + 15e3;
  while (Date.now() < deadline) {
    meta = readStorageDaemonMeta(dataDir);
    if (meta?.port) return meta;
    if (spawnError) throw spawnError;
    Atomics.wait(pause, 0, 0, 25);
  }
  throw new Error("Storage daemon did not become ready");
}
function storageCall(method, args = []) {
  const timing = startOperation("storage", "storage.roundtrip", { method }, { start: false });
  let readyMs = 0;
  let waitMs = 0;
  let decodeMs = 0;
  let waiting = 0;
  let remote;
  try {
    const meta = ensureStorageDaemon();
    if (!worker) {
      const entry = resolveNativeBin("chaya-storage-client.mjs");
      worker = Reflect.construct(Worker, [entry]);
      worker.on("error", () => {
        worker = void 0;
      });
      worker.unref();
    }
    const shared = responseBuffer ??= new SharedArrayBuffer(16 * 1024 * 1024);
    const signal = new Int32Array(shared, 0, 2);
    Atomics.store(signal, 0, 0);
    Atomics.store(signal, 1, 0);
    readyMs = timing.elapsedMs();
    waiting = performance.now();
    worker.postMessage({ port: meta.port, token: meta.authToken, body: { method, args, requestId: timing.id, sentAt: Date.now() }, shared });
    if (Atomics.wait(signal, 0, 0, 125e3) === "timed-out") {
      responseBuffer = void 0;
      throw new Error("Storage request timed out; retry with the same mutation key");
    }
    waitMs = Math.round((performance.now() - waiting) * 10) / 10;
    const decoding = performance.now();
    const result = JSON.parse(Buffer.from(shared, 8, Atomics.load(signal, 1)).toString("utf8"));
    remote = result.timing;
    decodeMs = Math.round((performance.now() - decoding) * 10) / 10;
    if (result.error) throw new Error(result.error);
    const value = result.value;
    const restored = value?.storageMap ? new Map(value.storageMap) : value;
    decodeMs = Math.round((performance.now() - decoding) * 10) / 10;
    timing.end("completed", { readyMs, waitMs, decodeMs, responseBytes: Atomics.load(signal, 1), ...result.timing });
    return restored;
  } catch (error) {
    if (waiting && !waitMs) waitMs = Math.round((performance.now() - waiting) * 10) / 10;
    timing.fail(error, { readyMs, waitMs, decodeMs, ...remote });
    throw error;
  }
}

// services/translate/game-cache-context.ts
import { createHash } from "node:crypto";
import fs7 from "node:fs";

// lib/translate/cache-row.ts
function parseCacheRow(value) {
  if (Array.isArray(value)) return typeof value[0] === "string" && (typeof value[1] === "string" || value[1] === null) ? { s: value[0], t: value[1] } : null;
  if (!value || typeof value !== "object") return null;
  const r = { ...value };
  if (typeof r.engine !== "string") r.engine = void 0;
  if (typeof r.event !== "string") r.event = void 0;
  if (typeof r.s !== "string" || typeof r.t !== "string" && r.t !== null) return null;
  if (r.origin && (typeof r.origin.id !== "string" || !Number.isInteger(r.origin.revision) || typeof r.origin.database !== "string")) return null;
  if (r.structure && !validRecordStructure(r.structure)) r.structure = void 0;
  if (r.alignments && (!r.t || !validateAlignments({ src: r.s, zh: r.t, newlines: r.newlines, structure: r.structure }, r.alignments)))
    return { ...r, alignments: void 0 };
  if (r.newlines && !validateNewlineAnnotations(r.s, r.newlines)) return { ...r, newlines: void 0 };
  return r;
}
function applyCacheRow(rows, row) {
  const previous = rows.get(row.s);
  if (row.t === null) {
    if (!row.origin || previous?.origin?.database === row.origin.database && previous.origin.id === row.origin.id) rows.delete(row.s);
  } else if (row.origin && previous && !previous.origin) {
    return;
  } else rows.set(row.s, row);
}

// services/translate/text-classify.ts
var JAPANESE = /[\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FD-\u30FF\u31F0-\u31FF\uFF66-\uFF9D]/;
var HAN3 = /[\u4e00-\u9fff]/;
function containsJapaneseText(text2) {
  return JAPANESE.test(String(text2 ?? ""));
}
function retainsJapaneseHanPhrase(src, zh) {
  if (!containsJapaneseText(src)) return false;
  const japaneseForms = /[応駅図広気帰転戦楽読売発変実対観関験険]/;
  return (src.match(/[\u4e00-\u9fff]{3,}/g) || []).some((phrase) => japaneseForms.test(phrase) && zh.includes(phrase));
}
var ENGINE_TOKEN = /\\[A-Za-z]+(?:\[[^\]]*\])?|\\\[[^\]]*\]|\\[^A-Za-z\s]|%[0-9]+|%[sdifSc]|\{[0-9A-Za-z_]+\}|[A-Za-z_][A-Za-z0-9_]*\[\d+\]|_(?:actor|aicon|class|name|icon|num|desc1|desc2)(?![A-Za-z0-9_])|_se\[[^\]]*\]|_[A-Z][A-Z0-9_]{1,}|[♡♥❤❥💕♪☆★✦✧※]{1,}|(?:\.{3}|…{1,}|・{2,}|･{2,})/g;
var PROTECT_TOKEN = new RegExp(`${TEXT_MARKUP_RE.source}|${ENGINE_TOKEN.source}`, "g");
function normCmp(s) {
  return s.normalize("NFKC").replace(/\s+/g, " ").trim();
}
var CONTROL_AFFIX = /^(?:\\[A-Za-z]+(?:\[[^\]]*\])?|\\\[[^\]]*\]|\\[^A-Za-z\s]|[A-Za-z_][A-Za-z0-9_]*\[\d+\])/;
function matchControlAffixAt(text2, atEnd) {
  if (!atEnd) {
    const m = text2.match(CONTROL_AFFIX);
    return m && !/^\\RB\[/i.test(m[0]) && !isSemanticPlaceholder(m[0]) ? m[0] : null;
  }
  const re = /\\[A-Za-z]+(?:\[[^\]]*\])?|\\\[[^\]]*\]|\\[^A-Za-z\s]|[A-Za-z_][A-Za-z0-9_]*\[\d+\]/g;
  let hit = null;
  for (const m of text2.matchAll(re)) {
    if (/^\\RB\[/i.test(m[0])) continue;
    if (isSemanticPlaceholder(m[0])) continue;
    const i = m.index ?? 0;
    if (i + m[0].length === text2.length) hit = m[0];
  }
  return hit;
}
function peelControlShell(text2) {
  let rest = String(text2 ?? "");
  let lead = "";
  let trail = "";
  for (; ; ) {
    const space = rest.match(/^[\s\u3000]+/);
    if (space) {
      lead += space[0];
      rest = rest.slice(space[0].length);
      continue;
    }
    const tok = matchControlAffixAt(rest, false);
    if (!tok) break;
    lead += tok;
    rest = rest.slice(tok.length);
  }
  for (; ; ) {
    const space = rest.match(/[\s\u3000]+$/);
    if (space) {
      trail = space[0] + trail;
      rest = rest.slice(0, -space[0].length);
      continue;
    }
    const tok = matchControlAffixAt(rest, true);
    if (!tok) break;
    trail = tok + trail;
    rest = rest.slice(0, -tok.length);
  }
  return { lead, core: rest, trail };
}
function stripControlNoise(text2) {
  return String(text2 ?? "").replace(PROTECT_TOKEN, " ").replace(/[\s\u3000]+/g, " ").trim();
}
function protectSentenceForTranslate(text2) {
  const choice = peelChoiceMetaShell(text2);
  const shell = peelControlShell(choice.core);
  const tokens = [];
  const plain = shell.core.replace(new RegExp(`${SENTENCE_TOKEN_SOURCE}|${PROTECT_TOKEN.source}`, "g"), (token) => {
    const id = tokens.length;
    tokens.push(token);
    return `__C${id}__`;
  });
  return { core: shell.core, lead: choice.lead + shell.lead, trail: shell.trail + choice.trail, plain, tokens };
}
function isIdenticalTranslation(src, zh) {
  return normCmp(src) === normCmp(zh);
}
function isStorableTranslation(src, zh, targetLang = "zh") {
  if (!validDynamicTranslation(src, zh)) return false;
  if (translationRubyChunks(zh).some((part) => part.ruby && JAPANESE.test(part.base + part.reading))) return false;
  if (!String(src ?? "").trim() || !String(zh ?? "").trim() || isIdenticalTranslation(src, zh)) return false;
  const sourceText = normCmp(stripControlNoise(src));
  const translatedText = normCmp(stripControlNoise(zh));
  if (!translatedText || sourceText && sourceText === translatedText) return false;
  if (JAPANESE.test(translatedText)) return false;
  if (retainsJapaneseHanPhrase(sourceText, translatedText)) return false;
  const isTargetZh = !targetLang || targetLang === "zh" || targetLang === "ch" || targetLang === "zh-CN" || targetLang === "zh-Hans" || targetLang === "zh-TW" || targetLang === "cht";
  if (isTargetZh) {
    return HAN3.test(translatedText);
  }
  return true;
}
function isReusableTranslation(src, zh) {
  if (isStorableTranslation(src, zh)) return true;
  if (!src.trim() || !zh.trim() || !isIdenticalTranslation(src, zh)) return false;
  const body = stripControlNoise(src);
  return !JAPANESE.test(body) && /[A-Za-z\u4e00-\u9fff]/.test(body);
}
function shouldTranslate(text2, sourceLang) {
  if (typeof sourceLang === "number") sourceLang = void 0;
  const core = stripControlNoise(text2);
  if (!core) return false;
  if (sourceLang && sourceLang !== "ja" && sourceLang !== "en") {
    const compact2 = core.replace(/[\s\u3000]+/g, "");
    return compact2.length > 0 && !/^[\p{P}\p{S}]+$/u.test(compact2);
  }
  if (!JAPANESE.test(core) && !isSourceText(core, sourceLang === "en" ? "en" : "all")) return false;
  const compact = core.replace(/[\s\u3000]+/g, "");
  return !(compact.length > 0 && /^[\p{P}\p{S}]+$/u.test(compact));
}
function charCount(text2) {
  return Array.from(String(text2 ?? "")).length;
}
function lineCount(text2) {
  const src = String(text2 ?? "");
  if (!src) return 0;
  return src.split(/\r\n|\n|\r/).length;
}

// services/translate/game-records.ts
import fs6 from "node:fs";

// lib/game/content-files.ts
import fs5 from "node:fs";
import path6 from "node:path";

// lib/game/content-paths.ts
var GAME_CONTENT_DIR = CONTENT_FILE_PREFIX;
var GAME_CONTENT_RELS = {
  seed: "translate/seed.json",
  cacheNdjson: "translate/cache.ndjson",
  switches: "translate/switches.json",
  translationPlay: "config/translation-play.json",
  translationPreview: "config/translation-preview.json",
  glossaryCache: "translate/glossary.cache.json",
  skippedNdjson: "translate/skipped.ndjson",
  merged: "translate/merged.json",
  extractStrings: "translate/extract.strings.json",
  extractCompare: "translate/extract.compare.json",
  /** Data signature + source keys for seed filter / list warm — see translation-mainthread-offload §3.3.5 */
  rgssSourcesIndex: "translate/rgss-sources.index.json",
  gameEdit: "config/game-edit.json",
  inputAssistance: "config/input-assistance.json",
  gameSaves: "config/game-saves.json",
  gameSavesIndex: "saves/index.json"
};
var LEGACY_FLAT_FILES = {
  seed: [`${CONTENT_FILE_PREFIX}-trans.seed.json`, "shiru-trans.seed.json", "translate-both.seed.json"],
  cacheNdjson: [`${CONTENT_FILE_PREFIX}-trans.cache.ndjson`, "shiru-trans.cache.ndjson", "translate-both.cache.ndjson"],
  switches: [`${CONTENT_FILE_PREFIX}-trans.switches.json`, "shiru-trans.switches.json", "translate-switches.json", "translate-both.switches.json"],
  translationPlay: [],
  translationPreview: [],
  glossaryCache: [`${CONTENT_FILE_PREFIX}-glossary.cache.json`, "translate-glossary.cache.json"],
  skippedNdjson: [`${CONTENT_FILE_PREFIX}-trans.skipped.ndjson`, "translate-both.skipped.ndjson"],
  merged: [`${CONTENT_FILE_PREFIX}-trans.merged.json`],
  extractStrings: [`${CONTENT_FILE_PREFIX}-extract.strings.json`, "extracted-strings.json"],
  extractCompare: [`${CONTENT_FILE_PREFIX}-extract.compare.json`, "extracted-compare.json"],
  rgssSourcesIndex: [],
  gameEdit: [`${CONTENT_FILE_PREFIX}-game-edit.json`],
  inputAssistance: [],
  gameSaves: [],
  gameSavesIndex: []
};
function gameContentRelPath(kind) {
  return `${GAME_CONTENT_DIR}/${GAME_CONTENT_RELS[kind]}`;
}

// services/storage/game-files.ts
import path5 from "node:path";
var ownerDirectories = /* @__PURE__ */ new Map();
var mountedDirectories = /* @__PURE__ */ new Map();
var ownerWriters = /* @__PURE__ */ new Map();
function appendPublicCacheFile(file, rows) {
  const writer2 = ownerWriters.get(file);
  if (!writer2) return false;
  writer2(rows);
  return true;
}
function publicGameFiles(contentRoot) {
  const key2 = path5.resolve(contentRoot);
  const local = ownerDirectories.get(key2) ?? mountedDirectories.get(key2);
  if (local) return local;
  if (process.env.CHAYA_STORAGE_OWNER === "1") {
    const mounted = ownerDirectories.get(key2);
    if (!mounted) throw new Error("Game storage must be mounted before accessing its read views");
    return mounted;
  }
  const remote = storageCall("game.mount", [contentRoot]);
  mountedDirectories.set(key2, remote);
  return remote;
}
function publicGameFile(contentRoot, kind) {
  return path5.join(publicGameFiles(contentRoot).directory, GAME_CONTENT_RELS[kind]);
}

// lib/game/content-files.ts
var STORAGE_DOCUMENT_KINDS = /* @__PURE__ */ new Set([
  "seed",
  "cacheNdjson",
  "switches",
  "translationPlay",
  "translationPreview",
  "gameEdit",
  "inputAssistance",
  "gameSaves"
]);
var registryCache = null;
function storageDirectoryRegistry() {
  if (typeof DATA_DIR !== "string" || !DATA_DIR) return null;
  const file = path6.join(DATA_DIR, "runtime", "game-directories.json");
  let mtimeMs = 0;
  try {
    mtimeMs = fs5.statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0;
  } catch {
    mtimeMs = 0;
  }
  if (!mtimeMs) {
    registryCache = null;
    return null;
  }
  if (registryCache && registryCache.file === file && registryCache.mtimeMs === mtimeMs) return registryCache;
  const byRoot = /* @__PURE__ */ new Map();
  try {
    const raw = JSON.parse(fs5.readFileSync(file, "utf8"));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [root, state] of Object.entries(raw)) {
        if (!state || typeof state !== "object") continue;
        const directory = state.directory;
        if (typeof directory === "string" && directory) byRoot.set(path6.resolve(root), path6.resolve(directory));
      }
    }
  } catch {
  }
  registryCache = { file, mtimeMs, byRoot };
  return registryCache;
}
function storageGameDirectory(contentRoot) {
  const registry = storageDirectoryRegistry();
  if (!registry) return null;
  const key2 = path6.resolve(contentRoot);
  const direct = registry.byRoot.get(key2);
  if (direct) return direct;
  try {
    const real2 = fs5.realpathSync(contentRoot);
    for (const [root, directory] of registry.byRoot) {
      try {
        if (fs5.realpathSync(root) === real2) return directory;
      } catch {
      }
    }
  } catch {
  }
  return null;
}
function gameContentPath(contentRoot, kind) {
  if (STORAGE_DOCUMENT_KINDS.has(kind)) return publicGameFile(contentRoot, kind);
  return path6.join(path6.resolve(contentRoot), gameContentRelPath(kind));
}
function gameContentCandidatePaths(contentRoot, kind, opts) {
  if (STORAGE_DOCUMENT_KINDS.has(kind)) return [publicGameFile(contentRoot, kind)];
  const root = path6.resolve(contentRoot);
  const dirs = opts?.alsoParent ? [root, path6.dirname(root)] : [root];
  const out = [];
  for (const dir of dirs) {
    out.push(path6.join(dir, gameContentRelPath(kind)));
    for (const name2 of LEGACY_FLAT_FILES[kind]) {
      out.push(path6.join(dir, name2));
    }
  }
  return out;
}
function gameContentReadPath(contentRoot, kind, opts) {
  return gameContentCandidatePaths(contentRoot, kind, opts).find((p) => fs5.existsSync(p)) ?? null;
}
function localGameContentFile(contentRoot, kind) {
  if (STORAGE_DOCUMENT_KINDS.has(kind)) {
    const directory = storageGameDirectory(contentRoot);
    if (directory) {
      const canonical = path6.join(directory, GAME_CONTENT_RELS[kind]);
      if (fs5.existsSync(canonical)) return canonical;
    }
  }
  const roots = [path6.resolve(contentRoot)];
  const parent = path6.dirname(roots[0]);
  if (parent !== roots[0]) roots.push(parent);
  for (const root of roots) {
    const primary = path6.join(root, GAME_CONTENT_DIR, GAME_CONTENT_RELS[kind]);
    if (fs5.existsSync(primary)) return primary;
    for (const name2 of LEGACY_FLAT_FILES[kind]) {
      const candidate = path6.join(root, name2);
      if (fs5.existsSync(candidate)) return candidate;
    }
  }
  return null;
}
function ensureGameContentDir(contentRoot, kind) {
  const file = gameContentPath(contentRoot, kind);
  fs5.mkdirSync(path6.dirname(file), { recursive: true });
  return file;
}

// services/translate/game-records.ts
var snapshots = /* @__PURE__ */ new Map();
function gameTranslationFiles(contentRoot, opts) {
  const seed = opts?.localOnly ? localGameContentFile(contentRoot, "seed") : gameContentReadPath(contentRoot, "seed", { alsoParent: true });
  const cache = opts?.localOnly ? localGameContentFile(contentRoot, "cacheNdjson") : gameContentReadPath(contentRoot, "cacheNdjson", { alsoParent: true });
  const stamp = JSON.stringify(
    [seed, cache, opts?.localOnly ? 1 : 0].map((file) => {
      if (typeof file === "number") return file;
      const stat = file ? fs6.statSync(file, { throwIfNoEntry: false }) : void 0;
      return [file, stat?.ino, stat?.mtimeMs, stat?.ctimeMs, stat?.size];
    })
  );
  return { seed, cache, stamp };
}
function loadGameTranslationRecords(contentRoot, current, opts) {
  const { seed, cache, stamp } = gameTranslationFiles(contentRoot, opts);
  let snapshot = snapshots.get(contentRoot);
  if (snapshot?.stamp !== stamp) {
    const rows = /* @__PURE__ */ new Map();
    if (seed) {
      let data;
      try {
        data = JSON.parse(fs6.readFileSync(seed, "utf8"));
      } catch {
        data = null;
      }
      if (data && typeof data === "object" && !Array.isArray(data)) {
        for (const [s, t] of Object.entries(data)) if (typeof t === "string" && t) rows.set(s, { s, t, engine: "seed" });
      }
    }
    if (cache)
      for (const line of fs6.readFileSync(cache, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const row = parseCacheRow(JSON.parse(line));
          if (row && row.engine !== "derived:sentence") applyCacheRow(rows, row);
        } catch {
        }
      }
    const entries = [...rows.values()].filter((r) => r.t && isReusableTranslation(r.s, r.t)).map((row) => ({
      row,
      record: {
        id: row.origin?.id || `local:${row.s}`,
        revision: row.origin?.revision || 0,
        src: row.s,
        zh: row.t,
        engine: row.engine || "legacy-local",
        alignments: row.alignments,
        structure: row.structure,
        newlines: row.newlines,
        local: !row.origin
      }
    }));
    snapshot = { stamp, entries };
    if (snapshots.size >= 8 && !snapshots.has(contentRoot)) snapshots.delete(snapshots.keys().next().value);
    snapshots.set(contentRoot, snapshot);
  }
  return snapshot.entries.filter(({ row }) => !row.origin || !current || current(row.origin)).map(({ record }) => record);
}

// services/translate/game-lookup.ts
function applyPair(lookup, src, zh) {
  if (src == null || zh == null) return;
  const k = String(src);
  const v = String(zh);
  if (!isReusableTranslation(k, v)) return;
  lookup[k] = v;
  const nk = normalizeTranslateKey(k);
  if (nk && nk !== k) lookup[nk] = v;
}
function createGameTranslateLookup(records2) {
  const lookup = /* @__PURE__ */ Object.create(null);
  try {
    for (const record of records2) applyPair(lookup, record.src, record.zh);
  } catch {
  }
  return lookup;
}

// services/translate/game-cache-context.ts
var contexts = /* @__PURE__ */ new Map();
function buildContext(contentRoot) {
  const records2 = loadGameTranslationRecords(contentRoot, () => false);
  const blocked = /* @__PURE__ */ new Set();
  const file = gameTranslationFiles(contentRoot).cache;
  if (file && fs7.existsSync(file))
    for (const line of fs7.readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = parseCacheRow(JSON.parse(line));
        if (!row?.origin) {
          if (row?.t === null) blocked.add(row.s);
          else if (row) blocked.delete(row.s);
        }
      } catch {
      }
    }
  const numeric2 = /* @__PURE__ */ new Map();
  for (const record of records2) {
    const family = numericLabelFamily(record.src);
    if (family) numeric2.set(family, [...numeric2.get(family) || [], record]);
  }
  const { seed } = gameTranslationFiles(contentRoot);
  const authorityVersion = createHash("sha256").update(JSON.stringify([seed, records2.filter((record) => record.local), [...blocked].sort()])).digest("hex");
  return {
    records: records2,
    blocked: (src) => blocked.has(src),
    resolver: createSentenceResolver(records2),
    lookup: createGameTranslateLookup(records2),
    numericRecords: (src) => numeric2.get(numericLabelFamily(src) || "") || [],
    authorityVersion
  };
}
function getGameCacheContext(contentRoot) {
  const { stamp } = gameTranslationFiles(contentRoot);
  let context2 = contexts.get(contentRoot);
  if (context2?.stamp !== stamp) {
    context2 = { ...buildContext(contentRoot), stamp };
    if (contexts.size >= 8 && !contexts.has(contentRoot)) contexts.delete(contexts.keys().next().value);
    contexts.set(contentRoot, context2);
  }
  return context2;
}
function noteGameSharedBackfill(contentRoot, previousStamp) {
  const context2 = contexts.get(contentRoot);
  if (!context2) return true;
  if (context2?.stamp !== previousStamp) return false;
  const stamp = gameTranslationFiles(contentRoot).stamp;
  const before = JSON.parse(previousStamp);
  const after = JSON.parse(stamp);
  if (JSON.stringify(before[0]) !== JSON.stringify(after[0])) return false;
  if (before[1][0] != null && before[1][0] !== after[1][0]) return false;
  context2.stamp = stamp;
  return true;
}

// services/translate/cache-lookup.ts
function lookupCandidates(src) {
  const choice = peelChoiceMetaShell(src);
  const key2 = choice.core || src;
  const guard = protectSentenceForTranslate(src);
  const display = translationExportText(key2);
  const shell = sentenceOuterShell(key2);
  const displayShell = translationSegmentContent(key2);
  const leadSpace = key2.match(/^\s*/)?.[0] ?? "";
  const trailSpace = key2.match(/\s*$/)?.[0] ?? "";
  const trimmed = key2.slice(leadSpace.length, key2.length - trailSpace.length);
  const description = key2.match(/^<SG説明:/);
  return [
    { key: key2, lead: choice.lead, trail: choice.trail },
    { key: normalizeTranslateKey(key2), lead: choice.lead, trail: choice.trail },
    ...trimmed && trimmed !== key2 ? [{ key: trimmed, lead: choice.lead + leadSpace, trail: trailSpace + choice.trail }] : [],
    ...description ? [{ key: key2.slice(description[0].length), lead: choice.lead + description[0], trail: choice.trail }] : [],
    ...display === key2 ? [] : [display, normalizeTranslateKey(display)].map((candidate) => ({
      key: candidate,
      lead: choice.lead + displayShell.lead,
      trail: displayShell.trail + choice.trail,
      displayOnly: true
    })),
    ...shell.core !== key2 && !/[!?！？]/.test(shell.trail) ? [{ key: shell.core, lead: choice.lead + shell.lead, trail: shell.trail + choice.trail, bodyOnly: true }] : [],
    { key: guard.core, lead: guard.lead, trail: guard.trail },
    { key: normalizeTranslateKey(guard.core), lead: guard.lead, trail: guard.trail }
  ];
}
function lookupWholeTranslation(get, src) {
  for (const { key: key2, lead, trail, bodyOnly, displayOnly } of lookupCandidates(src)) {
    if (!key2) continue;
    const hit = lookupWithRmDigitTemplate((k) => {
      const value = get(k);
      return value && isReusableTranslation(k, value) ? value : null;
    }, key2);
    if (hit != null) {
      const restored = lead + (displayOnly ? translationSegmentContent(hit).core : bodyOnly ? sentenceOuterShell(hit).core : hit) + trail;
      if (isReusableTranslation(src, restored)) return restored;
    }
  }
  return null;
}
function lookupCachedTranslation(get, src) {
  const whole = lookupWholeTranslation(get, src);
  if (whole != null) return whole;
  if (/\\(?:RB\[|ruby\[)/i.test(src)) return lookupDisplayParts(get, src) ?? mapTranslationRubySegments(src, (part) => lookupCachedTranslation(get, part));
  return lookupDisplayParts(get, src) ?? mapTranslationRubySegments(src, (part) => lookupCachedTranslation(get, part)) ?? lookupParts(get, src, mapTranslationSegments) ?? lookupParts(get, src, mapTranslationCacheLines);
}
function lookupDisplayParts(get, src) {
  let complete = true;
  let resolved = false;
  const result = mapTranslationDisplaySegments(src, (part) => {
    const hit = lookupCachedTranslation(get, part);
    if (hit != null) {
      resolved = true;
      return hit;
    }
    if (/\\(?:RB\[|ruby\[)/i.test(part) || /[\p{L}]/u.test(translationSegmentContent(part).core)) complete = false;
    return part;
  });
  return complete && resolved ? result : null;
}
function lookupParts(get, src, map) {
  let complete = true;
  let changed = false;
  const result = map(src, (part, original) => {
    const legacy = lookupWholeTranslation(get, original);
    const semantic = /[!?！？。．.]/.test(translationSegmentContent(original).trail);
    const hit = (semantic ? null : lookupWholeTranslation(get, part)) ?? (legacy == null ? null : translationSegmentContent(legacy).core);
    if (hit != null) {
      changed = true;
      return hit;
    }
    if (shouldTranslate(part)) complete = false;
    return part;
  });
  return complete && changed ? result : null;
}

// services/translate/game-cache-plan.ts
function planGameCache(src, pair, index2, context2) {
  if (context2.blocked(src)) return { plan: { ...createSentenceResolver([]).plan(src), corpusVersion: index2.version() }, records: [] };
  let records2 = [];
  let plan = index2.plan(src, pair, context2.resolver.select(src));
  if (!plan.limited && plan.status !== "full") {
    let hit = null;
    if (numericLabelFamily(src)) {
      const rows = index2.numericRecords(pair, src);
      if (!rows.limited) {
        const examples = [...rows, ...context2.numericRecords(src)];
        hit = createNumericLabelIndex(examples).resolve(src);
        if (hit != null) {
          const distinct = new Map(examples.map((record) => [record.src.match(/[0-9]+$/)?.[0], record]));
          records2 = [...distinct.values()].slice(0, 2).filter((record) => !record.local);
        }
      }
    }
    if (hit == null) {
      const used = /* @__PURE__ */ new Map();
      hit = lookupCachedTranslation((key2) => {
        if (context2.lookup[key2] != null) return context2.lookup[key2];
        const record = index2.authority(key2, pair);
        if (!record || record.src !== key2 && record.engine !== "manual") return null;
        used.set(record.id, record);
        return record.zh;
      }, src);
      if (hit != null) records2 = [...used.values()];
    }
    if (hit != null) plan = { ...plan, status: "full", zh: hit, gaps: [] };
  }
  if (!records2.length)
    records2 = plan.matches.filter((match) => !match.record.local).map((match) => index2.record(match.record.src, pair)).filter((record) => record != null);
  return { plan, records: records2 };
}

// node_modules/.pnpm/wordguard@0.1.1/node_modules/wordguard/dist/normalize.js
var MASK_CHAR = "\0";
var SMALL_KANA = {
  \u3041: "\u3042",
  \u3043: "\u3044",
  \u3045: "\u3046",
  \u3047: "\u3048",
  \u3049: "\u304A",
  \u3063: "\u3064",
  \u3083: "\u3084",
  \u3085: "\u3086",
  \u3087: "\u3088",
  \u308E: "\u308F",
  "\u3095": "\u304B",
  "\u3096": "\u3051"
};
var LEET = {
  "@": "a",
  "4": "a",
  "8": "b",
  "(": "c",
  "3": "e",
  "6": "g",
  "1": "i",
  "!": "i",
  "|": "i",
  "0": "o",
  "5": "s",
  "$": "s",
  "7": "t",
  "+": "t",
  "2": "z",
  "9": "g"
};
var HALFWIDTH_VOICED = /([ｦ-ﾝ])([ﾞﾟ])/g;
var PROLONGED = /[\p{Lm}〜～]/u;
function preNormalize(input, mode) {
  const src = input.replace(HALFWIDTH_VOICED, (m) => m.normalize("NFKC"));
  const drift = input.length - src.length;
  const chars = [...src];
  const out = [];
  const map = [];
  for (let i = 0; i < chars.length; i++) {
    const origIndex = Math.min(i + (i > 0 ? drift : 0), Math.max(input.length - 1, 0));
    let c = chars[i].normalize("NFKC").toLowerCase();
    if (mode === "en") {
      if (LEET[c] && hasAdjacentLetter(chars, i))
        c = LEET[c];
    } else {
      c = c.replace(/[ァ-ヶ]/g, (k) => String.fromCharCode(k.charCodeAt(0) - 96));
      c = SMALL_KANA[c] ?? c;
    }
    for (const ch of c) {
      if (/\s/u.test(ch)) {
        if (mode === "ja")
          continue;
        if (out.length === 0 || out[out.length - 1] === " ")
          continue;
        out.push(" ");
        map.push(origIndex);
        continue;
      }
      if (!PROLONGED.test(ch) && /[\p{P}\p{S}\p{C}]/u.test(ch))
        continue;
      out.push(ch);
      map.push(origIndex);
    }
  }
  return { text: out.join(""), map };
}
function collapse(text2, map) {
  const kept = [];
  const keptMap = [];
  for (let i = 0; i < text2.length; i++) {
    if (PROLONGED.test(text2[i]))
      continue;
    kept.push(text2[i]);
    keptMap.push(map[i]);
  }
  const out = [];
  const outMap = [];
  for (let i = 0; i < kept.length; ) {
    let j = i;
    while (j < kept.length && kept[j] === kept[i])
      j++;
    const keep = kept[i] !== MASK_CHAR && j - i >= 3 ? 1 : j - i;
    for (let k = 0; k < keep; k++) {
      out.push(kept[i]);
      outMap.push(keptMap[i + k]);
    }
    i = j;
  }
  return { text: out.join(""), map: outMap };
}
function hasAdjacentLetter(chars, i) {
  for (let d = -1; d <= 1; d += 2) {
    const c = chars[i + d];
    if (c && new RegExp("\\p{L}", "u").test(c))
      return true;
  }
  return false;
}
function normalizeWithMap(text2, options = {}) {
  const { mode = "ja", stage = "full" } = typeof options === "string" ? { mode: options } : options;
  const pre = preNormalize(text2, mode);
  if (stage === "pre")
    return pre;
  const full = collapse(pre.text, pre.map);
  return { text: full.text.trim(), map: full.map };
}
function detectMode(word) {
  return /^[\x20-\x7e]+$/.test(word) ? "en" : "ja";
}

// node_modules/.pnpm/wordguard@0.1.1/node_modules/wordguard/dist/filter.js
function createFilter({ lists, allowlist = [] }) {
  const jaEntries = [];
  const enTokens = /* @__PURE__ */ new Map();
  const enPhrases = [];
  const seen = /* @__PURE__ */ new Set();
  for (const list of lists) {
    const { name: name2, words } = Array.isArray(list) ? { name: "custom", words: list } : list;
    for (const word of words) {
      const mode = detectMode(word);
      const norm = normalizeWithMap(word, mode).text;
      if (!norm)
        continue;
      const key2 = `${mode}:${norm}`;
      if (seen.has(key2))
        continue;
      seen.add(key2);
      const entry = { norm, word, list: name2 };
      if (mode === "ja")
        jaEntries.push(entry);
      else if (norm.includes(" "))
        enPhrases.push(entry);
      else
        enTokens.set(norm, entry);
    }
  }
  const jaMasks = [];
  const enMasks = [];
  for (const word of allowlist) {
    const mode = detectMode(word);
    const norm = normalizeWithMap(word, { mode, stage: "pre" }).text;
    if (!norm)
      continue;
    (mode === "ja" ? jaMasks : enMasks).push(norm);
  }
  const byLengthDesc = (a, b) => b.length - a.length;
  jaMasks.sort(byLengthDesc);
  enMasks.sort(byLengthDesc);
  const prepare = (text2, mode, masks) => {
    const pre = normalizeWithMap(text2, { mode, stage: "pre" });
    let masked = pre.text;
    for (const m of masks) {
      if (masked.includes(m))
        masked = masked.split(m).join(MASK_CHAR.repeat(m.length));
    }
    return collapse(masked, pre.map);
  };
  const scan = (text2, stopAtFirst) => {
    const found = [];
    const at = (map, i) => map[i] ?? 0;
    if (jaEntries.length > 0) {
      const ja2 = prepare(text2, "ja", jaMasks);
      for (const e of jaEntries) {
        const i = ja2.text.indexOf(e.norm);
        if (i === -1)
          continue;
        found.push({
          word: e.word,
          list: e.list,
          start: at(ja2.map, i),
          end: at(ja2.map, i + e.norm.length - 1) + 1
        });
        if (stopAtFirst)
          return found;
      }
    }
    if (enTokens.size > 0 || enPhrases.length > 0) {
      const en2 = prepare(text2, "en", enMasks);
      const t = en2.text;
      if (enTokens.size > 0) {
        let i = 0;
        while (i < t.length) {
          if (t[i] === " ") {
            i++;
            continue;
          }
          let j = i;
          while (j < t.length && t[j] !== " ")
            j++;
          const hit = enTokens.get(t.slice(i, j));
          if (hit) {
            found.push({
              word: hit.word,
              list: hit.list,
              start: at(en2.map, i),
              end: at(en2.map, j - 1) + 1
            });
            if (stopAtFirst)
              return found;
          }
          i = j;
        }
      }
      for (const e of enPhrases) {
        for (let from = 0; ; ) {
          const i = t.indexOf(e.norm, from);
          if (i === -1)
            break;
          const endAt = i + e.norm.length;
          const bounded = (i === 0 || t[i - 1] === " ") && (endAt === t.length || t[endAt] === " ");
          if (bounded) {
            found.push({
              word: e.word,
              list: e.list,
              start: at(en2.map, i),
              end: at(en2.map, endAt - 1) + 1
            });
            if (stopAtFirst)
              return found;
          }
          from = i + 1;
        }
      }
    }
    return found.sort((a, b) => a.start - b.start);
  };
  return {
    size: jaEntries.length + enTokens.size + enPhrases.length,
    test: (text2) => scan(text2, true).length > 0,
    match: (text2) => scan(text2, true)[0] ?? null,
    matchAll: (text2) => scan(text2, false),
    clean(text2, replacement = "*") {
      const hits = scan(text2, false);
      if (hits.length === 0)
        return text2;
      const chars = [...text2];
      for (const h of hits) {
        for (let i = h.start; i < h.end && i < chars.length; i++)
          chars[i] = replacement;
      }
      return chars.join("");
    }
  };
}

// node_modules/.pnpm/wordguard@0.1.1/node_modules/wordguard/dist/generated/data.js
var data_exports = {};
__export(data_exports, {
  en: () => en,
  ja: () => ja,
  languages: () => languages
});
var en = {
  abuse: { name: "en/abuse", words: ["a**hole", "ape shit", "apeshit", "arsehole", "asshat", "asshole", "b*tch", "bastard", "bellend", "better off dead", "bitch", "bitches", "brain dead", "braindead", "brainless", "bull shit", "bullshit", "c*nt", "cluster fuck", "clusterfuck", "cocksucker", "cunt", "cunts", "d*ck", "dingleberries", "dingleberry", "dipshit", "dog shit", "dogshit", "douchebag", "drop dead", "dumb ass", "dumbass", "dumbfuck", "dumbshit", "eat shit", "everybody hates you", "everyone hates you", "f**k", "f*ck", "f*cking", "fu*k", "fuck", "fuck off", "fuck you", "fucken", "fucker", "fuckers", "fuckface", "fuckhead", "fuckheads", "fuckin", "fucking", "fucks", "fucktard", "fucktards", "fuckwad", "fuckwads", "fuckwhit", "fuckwit", "fuckwits", "go die", "go kill yourself", "hope you die", "horse shit", "horseshit", "human garbage", "human trash", "i hope you die", "just die", "kill ur self", "kill urself", "kill yourself", "kunt", "kunts", "kys", "kyss", "lowlife", "mf*er", "motherfucker", "mouth breather", "neck yourself", "no one likes you", "nobody cares about you", "nobody likes you", "off yourself", "p*ssy", "piece of garbage", "piece of shit", "piece of trash", "pieces of shit", "piss off", "pissed off", "pussy", "rope yourself", "screw you", "scumbag", "sh**", "sh*t", "shit", "shit head", "shitbag", "shitface", "shithead", "shitty", "shouldnt have been born", "shut the fuck up", "sod off", "son of a bitch", "sonofabitch", "stfu", "tosser", "twat", "unalive yourself", "waste of air", "waste of life", "waste of oxygen", "waste of space", "whore", "you are a mistake", "you should die"] },
  aggressive: { name: "en/aggressive", words: ["a s s", "a s shole", "abbo", "abeed", "abuse", "africoon", "alligator bait", "alligatorbait", "amcik", "analannie", "analprobe", "analsex", "andskota", "arabush", "arabushs", "areola", "areole", "argie", "armo", "armos", "arschloch", "aryan", "ash0le", "asholes", "ass monkey", "assbagger", "assbang", "assbanged", "assbangs", "assblaster", "asscowboy", "assfuck", "assh0lez", "assho1e", "assholz", "asshore", "assjockey", "asskiss", "asskisser", "assklown", "asslover", "assman", "assmaster", "assnigger", "asspacker", "asspuppies", "assrammer", "assranger", "assshit", "asswhore", "asswipes", "ayir", "azazel", "azz", "azzhole", "b a s t a r d", "b i t c h", "b o o b", "b00bies", "b00biez", "b00bz", "babes", "backdoorman", "badfuck", "balllicker", "bangbro", "barelylegal", "barface", "barfface", "bassterd", "bassterds", "bastards", "bastardz", "basterds", "basterdz", "bazongas", "bazooms", "beaney", "beaneys", "beardedclam", "beastality", "beatch", "beatoff", "beatyourmeat", "beef curtains", "beeyotch", "beotch", "bi curious", "bicurious", "bigass", "bigbastard", "bigbreasts", "bigbutt", "bigtits", "bimbo", "bint", "bitchass", "bitched", "bitchez", "bitchslap", "bitchtit", "bitchy", "biteme", "bitties", "blackcock", "blackman", "blacks", "blonde on blonde", "bloodclaat", "blow j", "blow your l", "bluegum", "bluegums", "bo ob", "bo obs", "boang", "boche", "boches", "boffing", "bogan", "bohunk", "boink", "bollick", "bombers", "bomd", "boned", "boners", "bong", "boong", "boonga", "boongas", "boongs", "boonie", "boonies", "bootee", "bootlip", "bootlips", "boozer", "bosch", "bosche", "bosches", "boschs", "bosomy", "bounty bar", "bounty bars", "bountybar", "brea5t", "breastjob", "breastlover", "breastman", "buddhaheads", "buffies", "buggered", "buggery", "bukake", "bullcrap", "bulldike", "bullshits", "bullshitted", "bullturds", "bumblefuck", "bumfuck", "bung", "bunga", "bungas", "burr head", "burr heads", "burrhead", "burrheads", "butchbabes", "butchdike", "butchdyke", "butt plug", "buttbang", "buttface", "buttfuck", "buttfucker", "buttfuckers", "butthead", "buttman", "buttmuch", "buttmuncher", "buttstain", "buttwipe", "byatch", "c u n t", "c-0-c-k", "cabron", "caca", "cacker", "cahone", "camel jockeys", "cameltoe", "carruth", "cawks", "cazzo", "chav", "cheese eating surrender monkies", "cheeseeating surrender monkies", "cheesehead", "cheeseheads", "cherrypopper", "chickslick", "china swede", "china swedes", "chinaswede", "chinaswedes", "chincs", "ching chongs", "chinga", "chingchongs", "chodes", "chonkies", "chonky", "chonkys", "chraa", "christ killer", "christ killers", "chug", "chugs", "chuj", "chunger", "chungers", "chunkies", "chunkys", "clamdigger", "clamdiver", "clamps", "clansman", "clansmen", "clanswoman", "clanswomen", "clitfuck", "clitorus", "clitty", "clogwog", "cnts", "cntz", "cocain", "cocaine", "cockblock", "cockblocker", "cockcowboy", "cockfight", "cockfucker", "cockholster", "cockknob", "cockknocker", "cocklicker", "cocklover", "cocknob", "cockqueen", "cockrider", "cocksman", "cocksucer", "cocktease", "cocky", "cohee", "coital", "coitus", "condom", "coolie", "coolies", "cooly", "coon ass", "coon asses", "coonass", "coonasses", "coondog", "copulate", "corksucker", "cra5h", "crackcocain", "crackpipe", "crackwhore", "crapola", "crapper", "crappy", "crotchjockey", "crotchmonkey", "crotchrot", "cuck", "cum face", "cum licker", "cumfest", "cuming", "cumlickr", "cumm", "cummin", "cumquat", "cumqueen", "cumstain", "cumsucker", "cunn", "cunntt", "cunny", "cunteyed", "cuntfuck", "cuntfucker", "cunthunter", "cuntslut", "cuntsucker", "cuntz", "curry munchers", "currymunchers", "cushi", "cushis", "cybersex", "cyberslimer", "dago", "dagos", "dahmer", "damm", "damnit", "darkeys", "datnigga", "dawgie style", "dawgie-style", "daygo", "deapthroat", "deep throating", "deepaction", "deepthroating", "defecate", "deggo", "dego", "degos", "destroyyourpussy", "deth", "diaper daddy", "diaper head", "diaper heads", "diaperdaddy", "diaperhead", "diaperheads", "dick pic", "dickbeaters", "dickbrain", "dickdipper", "dickflipper", "dickforbrains", "dickfuck", "dickheads", "dickish", "dickless", "dicklick", "dicklicker", "dickman", "dickpic", "dickripper", "dicks", "dicksipper", "dickslicker", "dickwhipper", "dickzipper", "diddle", "dilf", "diligaf", "dilld0", "dilld0s", "dillweed", "dimwit", "dingle", "dipship", "dipstick", "dix", "dixiedike", "dixiedyke", "doggie", "dominatricks", "dominatrics", "dong", "donkeypunch", "doodoo", "doofus", "dot head", "dot heads", "dothead", "dotheads", "doubledong", "doublepenetration", "douche bag", "douche-fag", "douchebags", "douchewaffle", "douchey", "dpaction", "dragqueen", "dragqween", "dripdick", "dryhump", "dudette", "dumass", "dumbasses", "dumbbitch", "dune coons", "dupa", "dyefly", "dykes", "dziwka", "earotics", "easyslut", "eat my", "eatadick", "eatballs", "eathairpie", "eatme", "eatmyass", "eatpussy", "ejackulate", "ekrem", "ekto", "enculer", "enema", "erection", "ero", "esqua", "essohbee", "ethical slut", "evl", "excrement", "exkwew", "extacy", "extasy", "f u c k e", "f u k", "facefucker", "fack", "faeces", "faen", "faget", "fagfucker", "fagged", "faggotcock", "fagit", "fagt", "fagz", "faig", "faigs", "faigt", "fanculo", "fannybandit", "fartknocker", "fastfuck", "fatah", "fatfuck", "fatfucker", "fatso", "fckcum", "fckd", "feg", "felcher", "feltcher", "feltching", "femalesquirtin", "femalesquirting", "fetish", "ficken", "fingerfood", "fister", "fisty", "fitt", "flasher", "flikker", "flipping the bird", "flogthelog", "floo", "floozy", "flydie", "flydye", "foad", "fok", "fondle", "foobar", "footaction", "footfetish", "footfuck", "footfucker", "footlicker", "footstar", "foreskin", "forni", "fornicate", "fotze", "foursome", "fourtwenty", "freakfuck", "freakyfucker", "freefuck", "freex", "frigg", "frigga", "frigger", "fucck", "fuckable", "fuckass", "fuckbag", "fuckbitch", "fuckbook", "fuckboy", "fuckbrain", "fuckbuddy", "fuckbutt", "fuckd", "fuckedup", "fuckersucker", "fuckfest", "fuckfreak", "fuckfriend", "fuckher", "fuckhole", "fuckina", "fuckingbitch", "fuckinnuts", "fuckinright", "fuckit", "fuckknob", "fuckmeat", "fuckmehard", "fuckmonkey", "fuckn", "fucknugget", "fucknut", "fucknuts", "fucknutt", "fucknutz", "fuckoff", "fuckpig", "fuckpuppet", "fuckr", "fuckstick", "fucktoy", "fucktrophy", "fuckup", "fuckwhore", "fuckwitt", "fuckyomama", "fuckyou", "fugly", "fukah", "fuken", "fukin", "fuking", "fukk", "fukkah", "fukken", "fukking", "fuktard", "fuktards", "funfuck", "futanary", "futkretzn", "fuuck", "fvck", "fvk", "fxck", "gae", "gai", "gangbanger", "ganja", "gassyass", "gator bait", "gatorbait", "gayboy", "gaygirl", "gaymuthafuckinwhore", "gays", "gayz", "geezer", "geni", "genital", "getiton", "gey", "gfy", "ghay", "ghey", "gigolo", "ginzo", "ginzos", "gipp", "gippo", "gippos", "gipps", "givehead", "glans", "glazeddonut", "god dammit", "god damnit", "godam", "godammit", "godamn", "godamnit", "goddamit", "goddamm", "goddammit", "goddamnes", "goddamnit", "goddamnmuthafucker", "godsdamn", "goldenshower", "golliwogs", "gonad", "gonads", "gonorrehea", "gonzagas", "gook eye", "gook eyes", "gookeyes", "gookies", "gora", "goras", "gotohell", "goy", "goyim", "greaseballs", "groe", "groid", "groids", "grostulation", "gstring", "gtfo", "gub", "gubba", "gubbas", "gubs", "guiena", "guineas", "guizi", "gummer", "gwailo", "gwailos", "gweilo", "gweilos", "gyopo", "gyopos", "gyp", "gyped", "gypo", "gypos", "gypp", "gypped", "gyppie", "gyppies", "gyppo", "gyppos", "gyppy", "gyppys", "gypsys", "h e l l", "h o m", "h0ar", "h0r", "h4x0r", "hadjis", "hairyback", "hairybacks", "hajis", "hajjis", "half breed", "half caste", "halfbreed", "halfcaste", "hamas", "hamflap", "haole", "haoles", "hapa", "hardon", "he11", "headfuck", "hebe", "hebes", "heebs", "hells", "helvete", "heroin", "herp", "herpes", "herpy", "hijacking", "hillbillies", "hillbilly", "hindoo", "hiscock", "hitler", "hitlerism", "hitlerist", "hobag", "hodgie", "hoes", "holestuffer", "homobangers", "homodumbshit", "homoey", "honger", "honkers", "honkie", "hooch", "hookers", "hoor", "hoore", "hootch", "hooter", "hooters", "hori", "horis", "hork", "horndawg", "horndog", "horney", "hosejob", "hoser", "hotcarl", "hotdamn", "hotpussy", "hottotrot", "howtokill", "howtomurdep", "huevon", "hugefat", "hui", "hummer", "humped", "humper", "humpher", "humphim", "humpin", "hussy", "hustler", "hymen", "hymies", "iblowu", "ike", "ikes", "ikey", "ikeymo", "ikeymos", "ikwe", "illegals", "indon", "indons", "injun", "injuns", "insest", "intheass", "inthebuff", "israels", "jackhole", "jackshit", "jacktheripper", "japcrap", "japie", "japies", "japs", "jebus", "jerked", "jerries", "jerry", "jewboy", "jewed", "jewess", "jiga", "jigaboos", "jigarooni", "jigaroonis", "jigg", "jigga", "jiggabo", "jiggabos", "jiggas", "jigger", "jiggers", "jiggs", "jiggy", "jigs", "jihad", "jijjiboo", "jijjiboos", "jimfish", "jisim", "jiss", "jizim", "jizin", "jizjuice", "jizn", "jizzd", "jizzed", "jizzim", "jizzin", "jizzn", "jizzum", "jugg", "jungle bunnies", "junkie", "junky", "kacap", "kacapas", "kacaps", "kaffer", "kaffir", "kaffre", "kafir", "kanake", "kanker", "katsap", "katsaps", "khokhol", "khokhols", "kigger", "kikes", "kimchis", "kink", "kinkyjesus", "kissass", "kkk", "klan", "klansman", "klansmen", "klanswoman", "klanswomen", "klootzak", "knobz", "knockers", "knulle", "kooches", "koon", "krap", "krappy", "kuffar", "kuk", "kuksuger", "kumbubble", "kumbullbe", "kunnilingus", "kuntz", "kurac", "kurwa", "kushi", "kushis", "kusi", "kwa", "kwai lo", "kwai los", "kwif", "kykes", "kyopo", "kyopos", "kyrpa", "lapdance", "leather straight", "leatherrestraint", "lebos", "lech", "leper", "lesbain", "lesbayn", "lesbin", "lesbos", "lez", "lezbe", "lezbefriends", "lezbian", "lezbians", "lezbo", "lezbos", "lezz", "lezzian", "lezzo", "lezzy", "libido", "licker", "licking", "lickme", "lilniglet", "limey", "limpdick", "limy", "lingerie", "lipshits", "lipshitz", "loadedgun", "lovebone", "lovegoo", "lovegun", "lovejuice", "lovemuscle", "lovepistol", "loverocket", "lsd", "lubejob", "lubra", "lucifer", "luckycammeltoe", "lugan", "lugans", "lusty", "lynch", "m-fucking", "mabuno", "mabunos", "macaca", "macacas", "mafugly", "magicwand", "mahbuno", "mahbunos", "makemecome", "makemecum", "mamhoon", "mams", "manhater", "manpaste", "maricon", "maric\xF3n", "marijuana", "masokist", "massa", "massterbait", "masstrbait", "masstrbate", "mastabate", "mastabater", "masterbaiter", "masterbates", "masterbating", "masterblaster", "mastrabator", "masturbat", "mattressprincess", "mau mau", "mau maus", "maumau", "maumaus", "mcfagget", "meatbeatter", "meatrack", "menage", "merd", "mgger", "mggor", "mibun", "mick", "mickeyfinn", "mideast", "mierda", "mindfuck", "minger", "mockey", "mockie", "mocky", "moky", "molest", "molestation", "molester", "molestor", "moneyshot", "monkleigh", "moolie", "moon cricket", "moon crickets", "mooncricket", "mooncrickets", "moron", "moskal", "moskals", "moslem", "mosshead", "motha fucker", "motha fuker", "motha fukkah", "motha fukker", "mother fukah", "mother fuker", "mother fukkah", "mother fukker", "motherfucka", "motherfvcker", "motherlovebone", "mothrfucker", "mouliewop", "moundofvenus", "mtherfucker", "mthrfuck", "mthrfucker", "mthrfucking", "mtrfck", "mtrfuck", "mtrfucker", "muffdive", "muffindiver", "mufflikcer", "muffpuff", "muie", "mulatto", "mulkku", "muncher", "munging", "munt", "munter", "muschi", "mutha fucker", "mutha fukah", "mutha fuker", "mutha fukkah", "mutha fukker", "muthafuckaz", "muthafucker", "mutherfucking", "muthrfucking", "mzungu", "mzungus", "nads", "naked", "nastt", "nastybitch", "nastyho", "nastyslut", "nastywhore", "nazis", "nazism", "necro", "needthedick", "negres", "negress", "negroes", "negroid", "negros", "nepesaurio", "nig", "niga", "nigar", "nigars", "nigas", "nigers", "nigette", "nigettes", "nigg", "niggahs", "niggar", "niggaracci", "niggard", "niggarded", "niggarding", "niggardliness", "niggardly", "niggards", "niggars", "niggerhead", "niggerhole", "niggle", "niggled", "niggles", "nigglings", "niggor", "niggress", "niggresses", "nigguh", "nigguhs", "niggur", "niggurs", "nigor", "nigors", "nigr", "nigra", "nigras", "nigre", "nigres", "nigress", "nigs", "nigur", "niiger", "niigr", "nimrod", "ninny", "nipplering", "nips", "nittit", "nlgger", "nlggor", "nofuckingway", "nog", "nookey", "nookie", "nooky", "noonan", "nooner", "nudger", "nudie", "nudies", "nut sack", "nutbutter", "nutfucker", "o c k", "one guy", "one jar", "ontherag", "orafis", "orga", "orgasum", "orgies", "oriface", "orifiss", "orospu", "osama", "ovum", "ovums", "p e n i s", "p i s", "p u s s y", "packi", "packie", "packy", "paddy", "pakie", "pakis", "paky", "palesimian", "pancake face", "pancake faces", "pansies", "panti", "pantie", "paska", "payo", "pcp", "pearlnecklace", "peckerwood", "pedo", "pedophiliac", "penus", "peehole", "peenus", "peepee", "peepshow", "peepshpw", "peinus", "penas", "pendejo", "pendy", "penetrate", "penetration", "penial", "penile", "penis-breath", "penises", "penisland", "penislick", "penislicker", "penispuffer", "penthouse", "penuus", "perse", "perv", "perversion", "peyote", "phalli", "phallic", "phuc", "phuker", "phukker", "phungky", "pi55", "picaninny", "piccaninny", "picka", "pickaninnies", "pickaninny", "pieceofshit", "piefke", "piefkes", "pierdol", "piker", "piky", "pillowbiter", "pillu", "pimmel", "pimp", "pimped", "pimper", "pimpjuic", "pimpjuice", "pimpsimp", "pindick", "pinko", "pisshead", "pizda", "playgirl", "pleasurechest", "pocha", "pochas", "pocho", "pochos", "pocketpool", "pohm", "pohms", "polac", "polack", "polacks", "polak", "pollocks", "pommie grant", "pommie grants", "pommy", "poontsee", "pooper", "pooperscooper", "pooping", "poorwhitetrash", "popimp", "porch monkey", "porch monkies", "porchmonkey", "pornflick", "pornking", "pornprincess", "pound town", "poundtown", "pplicker", "pr1k", "prairie nigger", "prairie niggers", "preteen", "pric", "prickhead", "prig", "prostitute", "pubic", "pubiclice", "pubis", "pudboy", "pudd", "puddboy", "pula", "punkass", "punky", "puntang", "purinapricness", "puss", "pussee", "pussie", "pussycat", "pussydestroyer", "pussyeater", "pussyfart", "pussyfuck", "pussyfucker", "pussylicker", "pussylips", "pussylover", "pussypalace", "pussypounder", "puta", "puuke", "puuker", "qahbeh", "quashie", "queero", "queers", "queerz", "quickie", "quicky", "quiff", "qweers", "qweerz", "qweir", "r5e", "ra8s", "raped", "raper", "rautenberg", "rearend", "rearentry", "recktum", "rectal", "rectus", "redleg", "redlegs", "redlight", "redskin", "redskins", "reefer", "reestie", "reetard", "reich", "rentafuck", "rere", "retards", "retardz", "reversecowgirl", "ritard", "rosebuds", "rosypalm", "rosypalmandher5sisters", "rosypalmandherefivesisters", "round eyes", "roundeye", "rtard", "rtards", "rumprammer", "russki", "russkie", "rustytrombone", "s h i t", "s-h-1-t", "sadis", "sadom", "sambo", "sambos", "samckdaddy", "sanchez", "sand niggers", "sandm", "sausagequeen", "scag", "scallywag", "scank", "scantily", "schaffer", "scheiss", "schizo", "schlampe", "schmuck", "schvartse", "schvartsen", "schwartze", "schwartzen", "screwyou", "scrog", "scrud", "seduce", "seppo", "seppos", "septics", "sexed", "sexfarm", "sexhound", "sexhouse", "sexi", "sexing", "sexkitten", "sexpot", "sexslave", "sextogo", "sextoy", "sextoys", "sexwhore", "sexx", "sexxi", "sexxy", "sexymoma", "sexyslim", "sh1ter", "shamedame", "sharmuta", "sharmute", "shat", "shav", "shavedbeaver", "shavedpussy", "shawtypimp", "sheeney", "shhit", "shibary", "shinola", "shipal", "shit ass", "shitcan", "shiteater", "shitforbrains", "shitfucker", "shithapens", "shithappens", "shitlist", "shitola", "shitoutofluck", "shitt", "shitz", "shortfuck", "shylock", "shylocks", "shyt", "shyte", "shytty", "shyty", "simp", "sixsixsix", "sixtynine", "sixtyniner", "skag", "skanck", "skankbitch", "skankee", "skankey", "skankfuck", "skanks", "skankwhore", "skanky", "skankybitch", "skankywhore", "skinflute", "skribz", "skullfuck", "skum", "skumbag", "skurwysyn", "skwa", "skwe", "slag", "slanty", "slapper", "sleezeball", "slideitin", "slimeball", "slimebucket", "slopehead", "slopeheads", "sloper", "slopers", "slopey", "slopeys", "slopies", "slopy", "slutbucket", "slutdumper", "slutkiss", "slutt", "slutting", "slutty", "slutwear", "slutwhore", "slutz", "smackthemonkey", "smutty", "snatchpatch", "sniggered", "sniggering", "sniggers", "snowback", "snownigger", "snuff", "socksucker", "sodom", "sodomite", "son of a whore", "son-of-a-whore", "sonofbitch", "sooties", "souse", "soused", "soyboy", "spaghettibender", "spaghettinigger", "spank", "spankthemonkey", "spearchuckers", "sperm", "spermacide", "spermbag", "spermhearder", "spermherder", "sphencter", "spierdalaj", "spig", "spigotty", "spik", "spiks", "splittail", "spludge", "spreadeagle", "spunky", "sqeh", "squa", "squarehead", "squareheads", "squaw", "squinty", "squirting", "stagg", "stiffy", "stoned", "stoner", "stripclub", "stroking", "stuinties", "stupidfuck", "stupidfucker", "suckdick", "sucked", "sucking", "suckme", "suckmyass", "suckmydick", "suckmytit", "suckoff", "suicide girl", "suicidegirl", "suicidegirls", "suka", "sultrywoman", "sultrywomen", "sumofabiatch", "swallower", "swalow", "swamp guineas", "syphilis", "t i t", "t i ts", "tacohead", "tacoheads", "taff", "take off your", "tar babies", "tar baby", "tarbaby", "tastemy", "tawdry", "teat", "terd", "teste", "testee", "testes", "testicles", "testis", "thicklip", "thicklips", "thirdeye", "thirdleg", "threeway", "tig ol bitties", "tig old bitties", "timber niggers", "titbitnipply", "titfucker", "titfuckin", "titi", "titjob", "titlicker", "titlover", "tittie", "tittis", "tittyfucker", "tittys", "tity", "to murder", "tongethruster", "tongueina", "tonguethrust", "tonguetramp", "toots", "tortur", "torture", "towel heads", "trailertrash", "transvestite", "trisexual", "trois", "troon", "troons", "trots", "tuckahoe", "tunneloflove", "turd burgler", "turnon", "tush", "twats", "twatwaffle", "twobitwhore", "udge packer", "ukrop", "unclefucker", "unfuckable", "uptheass", "upthebutt", "urethraplay", "usama", "ussys", "uzi", "v a g i n a", "v4gra", "va1jina", "vagiina", "vajina", "valium", "vgra", "vibr", "vibrater", "virginbreaker", "vittu", "vixen", "vullva", "wab", "wanking", "waysted", "weenie", "weewee", "weiner", "welcher", "wench", "wetb", "wetbacks", "wetdream", "wetspot", "wh00r", "whacker", "whash", "whiggers", "whiskeydick", "whiskydick", "whit", "white trash", "whitenigger", "whitetrash", "whitey", "whiteys", "whities", "whop", "whoralicious", "whorealicious", "whorebag", "whored", "whoreface", "whorefucker", "whorehopper", "whorehouse", "whores", "whoring", "wichser", "wiggas", "wiggers", "willie", "williewanker", "wop", "wtf", "wuss", "wuzzie", "x-rated2g1c", "xkwe", "xtc", "yank", "yarpie", "yarpies", "yed", "yellowman", "yellowshowers", "yid", "yids", "yobbo", "yourboobs", "yourpenis", "yourtits", "yury", "zabourah", "zigabo", "zigabos", "zipperheads"] },
  allowlist: { name: "en/allowlist", words: ["abasement", "abasements", "accumulate", "acock", "advertisement", "advertisements", "advisement", "advisements", "alchymies", "allenby", "allspice", "allspices", "amusement", "amusements", "anaclitic", "analog", "analogue", "analogy", "analyse", "analysis", "analysis analyse analyze analytical analog analogue analogy canal banal", "analytical", "analyze", "and", "appeasement", "appeasements", "appraisement", "appraisements", "arrondissement", "arrondissements", "arsen", "aruspices", "asenby", "aspic", "aspics", "assassin", "assassin assassinate assess assessment assign assignment assist associate assume", "assassinate", "assess", "assessment", "assign", "assignment", "assist", "associate", "assume", "assumption", "assumption assure class classic classroom pass passage password passenger mass", "assure", "attitude", "auspicate", "auspicated", "auspicates", "auspicating", "auspice", "auspices", "auspicious", "auspiciously", "auspiciousness", "babcock", "banal", "bangkok", "bangkok bangladesh bangle", "bangladesh", "bangle", "barracoon", "basemen", "basement", "basementless", "basements", "bass", "bawcock", "bawcocks", "beaneries", "beanery", "bejesus", "bellenden", "bemusement", "bemusements", "benedick", "bibcock", "bibcocks", "biconcave", "biconcavities", "biconcavity", "biconvex", "biconvexities", "biconvexity", "billycock", "billycocks", "blackcock", "blackcocks", "blesbok", "blesboks", "boobird", "booboo", "bouleversement", "bouleversements", "brass", "breaststroke", "brookenby", "bumble", "bumblebee", "bumper", "bumper bumble bumblebee bumpy", "bumpy", "bunglesome", "bushtits", "butter", "butterfly", "button", "buttons", "buttress", "buttress button butter butterfly buttons", "bypass", "caenby", "cajaput", "cajaputs", "canal", "casement", "casements", "catharse", "chastisement", "chastisements", "chinkapin", "chinkapins", "chinked", "chinkier", "chinkiest", "chinking", "christen", "christian", "christie", "christy", "chucklesome", "circumference", "circumstance", "class", "classic", "classroom", "clitella", "clitellum", "clitheroe", "clitic", "cliticize", "cliticized", "cliticizes", "cliticizing", "clitics", "coarse", "coccoon", "coccooned", "cockade", "cockaded", "cockades", "cockalorum", "cockalorums", "cockamamie", "cockamamy", "cockapoo", "cockapoos", "cockateel", "cockateels", "cockatiel", "cockatiels", "cockatoo", "cockatoos", "cockatrice", "cockatrices", "cockbill", "cockbilled", "cockbilling", "cockbills", "cockboat", "cockboats", "cockburn", "cockchafer", "cockchafers", "cockcrow", "cockcrows", "cocked", "cocker", "cockered", "cockerel", "cockerels", "cockering", "cockers", "cockeye", "cockeyed", "cockeyedly", "cockeyedness", "cockeyednesses", "cockeyes", "cockfosters", "cockhorse", "cockhorses", "cockier", "cockiest", "cockily", "cockiness", "cockinesses", "cocking", "cockish", "cockle", "cocklebur", "cockleburs", "cockled", "cockles", "cockleshell", "cockleshells", "cocklike", "cockling", "cockloft", "cocklofts", "cockney", "cockneyfied", "cockneyfies", "cockneyfy", "cockneyfying", "cockneyish", "cockneyism", "cockneyisms", "cockneys", "cockpit", "cockpits", "cockroach", "cockroaches", "cockscomb", "cockscombs", "cocksfoot", "cocksfoots", "cockshies", "cockshut", "cockshuts", "cockshy", "cockspur", "cockspurs", "cocksuckers", "cocksure", "cocksurely", "cocksureness", "cocksurenesses", "cockswain", "cockswains", "cocktail", "cocktailed", "cocktailing", "cocktails", "cockup", "cockups", "cocky", "coldcock", "coldcocked", "coldcocking", "coldcocks", "compass", "competitive", "conspicuities", "conspicuity", "conspicuous", "conspicuously", "conspicuousness", "constitution", "coon can", "coon hound", "coon skin", "cooncan", "coonhound", "coonskin", "coontie", "cradlesong", "cradlesongs", "crampoon", "crampoons", "crape", "craping", "crapshoot", "crapulent", "crapulous", "cucumber", "cucumber incumbent circumference", "cuddlesome", "cumulative", "cumulative cumulus circumstance document documents documentation accumulate", "cumulus", "cutwater", "cyclitol", "cyclitols", "debasement", "debasements", "debugger", "defensemen", "denby", "despicable", "despicableness", "despicably", "despisement", "despisements", "dessertspoon", "dessertspoonful", "dessertspoons", "diathermies", "dickcissel", "dicken", "dickens", "dickens dictionary dictate dickinson dickies", "dicker", "dickies", "dickinson", "dictate", "dictionary", "dike", "dike dikes van dyke dykstra", "dikes", "disbursement", "disbursements", "disguisement", "disguisements", "divertissement", "divertissements", "document", "documentation", "documents", "dolesome", "drape", "drapes", "dykstra", "easement", "easements", "echelle", "eclaircissement", "embarrass", "empressement", "empressements", "encasement", "encasements", "enclitic", "enclitics", "endorsement", "endorsements", "endothermies", "enfranchisement", "entity", "essex", "excisemen", "frozenbyte", "gamecock", "gamecocks", "gatenby", "glass", "gobbledegook", "gobbledegooks", "gobbledygook", "gobbledygooks", "gorcock", "gorcocks", "grape", "grapes", "grass", "hancock", "harass", "harpoon", "harpooned", "harpooner", "harpooners", "harpooning", "harpoons", "haruspication", "haruspications", "haruspices", "haycock", "haycocks", "hearse", "hellcat", "helled", "hellen", "hellenic", "heller", "hellfire", "hellion", "hellish", "hellkite", "hellman", "hello", "hello shell shelter hellenic michelle othello hellman shelley", "heteroclite", "heteroclites", "hoarse", "hoary", "hoedown", "holdenby", "homage", "homeostasis", "homeothermies", "homo", "homogeneous", "homogenous", "homonym", "homophone", "homosapiens", "homosapiens homo sapiens homogeneous homogenous homophone homonym homage homeostasis", "hornswoggle", "hornswoggled", "hornswoggles", "hornswoggling", "horsemen", "hospice", "hospices", "housemen", "humbugger", "inauspicious", "inauspiciously", "inconspicuous", "inconspicuously", "incumbent", "indorsement", "indorsements", "institute", "janus", "japan", "japanize", "japanized", "japanizes", "japanizing", "japanned", "japanner", "japanners", "japanning", "japans", "jape", "japed", "japer", "japeries", "japers", "japery", "japes", "japing", "japingly", "japonaiserie", "japonaiseries", "japonica", "japonicas", "jipijapa", "jipijapas", "katharse", "knobble", "knobbly", "knobbly knobble", "lackenby", "lampoon", "lampooned", "lampooner", "lampooneries", "lampooners", "lampoonery", "lampooning", "lampoons", "lazenby", "leafage", "leafages", "lesbos", "lightwater", "manus", "manuscript", "manuscript uranus tetanus pandanus janus", "manuscripts", "marseilles", "mass", "massachusetts", "massive", "massive massachusetts grass glass brass bass compass embarrass harass potassium", "matsushita", "meddlesome", "meddlesomeness", "medick", "meltwater", "mettlesome", "michelle", "middlesex", "mishit", "mispickel", "mispickels", "molasses", "molasses surpass bypass", "montenegro", "montenegro negroni", "moorcock", "moorcocks", "multitude", "multitude petition quantity", "navenby", "negroni", "nettlesome", "niggle", "niggle niggling", "niggling", "othello", "ottenby", "outwatch", "overspice", "overspiced", "overspices", "overspicing", "oversuspicious", "pachinko", "pachinkos", "paclitaxel", "paclitaxels", "pakihi", "pandanus", "pandanuses", "parse", "pass", "passage", "passementerie", "passementeries", "passenger", "password", "pastits", "peacock", "peacock woodcock woodpecker cocktail cocktails cockpit cockroach cockney shuttlecock", "peacocked", "peacockier", "peacockiest", "peacocking", "peacockish", "peacocks", "peacocky", "penistone", "perspicacious", "perspicaciously", "perspicacities", "perspicacity", "perspicuities", "perspicuity", "perspicuous", "perspicuously", "perspicuousness", "petcock", "petcocks", "petition", "phell", "pinchcock", "pinchcocks", "polliwog", "polliwogs", "pollywog", "pollywogs", "poofs", "pooftah", "pooftahs", "poofter", "poofters", "poofy", "poopdeck", "poopdeck sternpost", "poppycock", "poppycocks", "potassium", "prickle", "prickly", "prickly prickle", "princock", "princocks", "pringshymieella", "proclitic", "proclitics", "puccoon", "pussycat", "pussycat pussyfoot pussy willow", "pussyfoot", "quantity", "raccoon", "rapeseed", "rapid", "rapier", "rapport", "rapport rapture rapier", "rapture", "recock", "recocked", "recocking", "recocks", "reimbursement", "reimbursements", "renbygda", "rousement", "rousements", "saltwater", "sapiens", "sarsen", "sauerkraut", "sauerkrauts", "scathing", "scatter", "scatter scattered scathing", "scattered", "scrap", "scrap scrape scrapbook scrapyard", "scrapbook", "scrape", "scrapyard", "scunthorpe", "scunthorpe penistone clitheroe lightwater cockburn cockfosters hancock babcock", "seacock", "seacocks", "serfage", "serfages", "sexagenarian", "sextant", "sextet", "sexton", "shell", "shelley", "shelter", "shiitake", "shiitake matsushita", "shitake", "shittah", "shittim", "shoe", "shoe shoes hoedown tahoe hoary hoarse", "shoes", "shuttlecock", "shuttlecocked", "shuttlecocking", "shuttlecocks", "soupspoon", "soupspoons", "span", "spica", "spicae", "spicas", "spicate", "spicated", "spiccato", "spiccatos", "spice", "spicebush", "spicebushes", "spiced", "spiceless", "spicer", "spiceries", "spicers", "spicery", "spices", "spicey", "spicier", "spiciest", "spicily", "spiciness", "spicinesses", "spicing", "spick and span spic and span", "spicula", "spiculae", "spicular", "spiculate", "spiculation", "spiculations", "spicule", "spicules", "spiculum", "spicy", "spoof", "spoofed", "spoofer", "spooferies", "spoofers", "spoofery", "spoofing", "spoofs", "spoofy", "spoon", "spoonbill", "spoonbills", "spooned", "spoonerism", "spoonerisms", "spooney", "spooneys", "spoonful", "spoonfuls", "spoonier", "spoonies", "spooniest", "spoonily", "spooning", "spoons", "spoonsful", "spoony", "sternpost", "stopcock", "stopcocks", "subbasement", "subbasements", "surpass", "suspicion", "suspicioned", "suspicioning", "suspicions", "suspicious", "suspiciously", "suspiciousness", "sussex", "sussex essex middlesex sexton sextant sextet sexagenarian unisex", "swank", "tablespoon", "tablespoonful", "tablespoonfuls", "tablespoons", "tablespoonsful", "tahoe", "teaspoon", "teaspoonful", "teaspoonfuls", "teaspoons", "teaspoonsful", "tenby", "tetanus", "tetanuses", "therapies", "therapist", "therapist therapists therapy therapies grape grapes drape drapes rapeseed rapid", "therapists", "therapy", "thymier", "thymiest", "titan", "titanic", "titanium", "title", "title titles titan titanic attitude competitive constitution entity institute", "titles", "titmouse", "titmouse titter titanium", "titter", "tomtits", "toppenish", "transpicuous", "troublesome", "troublesomely", "troublesomeness", "twank", "twinkies", "twinkle", "twinkled", "twinkler", "twinklers", "twinkles", "twinkling", "twinklings", "twinkly", "tycoon", "uncock", "uncocked", "uncocking", "uncocks", "unisex", "unsuspicious", "unwholesome", "unwholesomely", "uranus", "van", "vandyke", "vandyked", "vandykes", "versemen", "warehousemen", "warrenby", "weathercock", "weathercock stopcock cockatoo cockle", "weathercocks", "wharfage", "wharfages", "whenby", "wholesome", "wholesomely", "wholesomeness", "wholesomenesses", "wholesomer", "wholesomest", "william", "william williams willingly willow", "williams", "willingly", "willow", "woodcock", "woodcocks", "woodpecker", "wristwatch", "zaddick", "van dyke", "dyke bridge", "spick and span", "spic and span"] },
  ambiguous: { name: "en/ambiguous", words: ["anal", "anus", "balls", "bareback", "bloody", "bollock", "bollocks", "bondage", "boob", "boobs", "breasts", "bugger", "bum", "butt", "christ", "clitoris", "crap", "damn", "dick", "dike", "domination", "dumb", "ejaculate", "erotic", "erotism", "escort", "eunuch", "fanny", "fecal", "fingered", "fingering", "fool", "genitals", "god damn", "god damned", "goddamn", "goddamned", "grope", "guido", "hadji", "hell", "ho", "hoe", "homo", "hooker", "horny", "incest", "intercourse", "jerk", "jesus", "jesus christ", "kinky", "knob", "labia", "lust", "masochist", "muff", "nazi", "negro", "nipple", "nipples", "nude", "orgasm", "orgy", "pansy", "panties", "panty", "pegging", "penis", "piss", "playboy", "poof", "poop", "prick", "pubes", "rag head", "rag heads", "ragheads", "rectum", "sadism", "sadist", "scat", "scissoring", "screwing", "scrotum", "semen", "sex", "sexual", "sexuality", "sexually", "sexy", "shag", "smut", "snatch", "sodding", "spunk", "suck", "sucker", "sucks", "swastika", "swinger", "testicle", "threesome", "tit", "tits", "topless", "vag", "vagina", "voyeur", "vulva", "wanker", "willies", "willy"] },
  selfharm: { name: "en/selfharm", words: ["better off without me", "cut myself", "cutting myself", "end it all", "end my life", "hang myself", "i wanna die", "i want to die", "kill myself", "killing myself", "kms", "no reason to live", "nobody would miss me", "not worth living", "overdose", "self harm", "selfharm", "suicidal", "suicide", "wanna die", "want to die"] },
  sexual: { name: "en/sexual", words: ["1 man 1 jar", "1m1j", "1man1jar", "2 girls 1 cup", "2g1c", "2girls1cup", "a55", "acrotomophile", "acrotomophilia", "alabama hot pocket", "alabama tuna melt", "alaskan pipeline", "algophile", "algophilia", "anilingus", "apotemnophile", "apotemnophilia", "arrse", "arse", "ass", "assbag", "assbandit", "assbanger", "assbite", "assclown", "asscock", "asscracker", "asses", "assface", "assfucker", "assfukka", "assgoblin", "asshead", "assholes", "asshopper", "assjacker", "asslick", "asslicker", "assmonkey", "assmunch", "assmuncher", "asspirate", "asssucker", "asswad", "asswhole", "asswipe", "auto erotic", "autoerotic", "babeland", "baby batter", "baby gravy", "baby juice", "ball batter", "ball gag", "ball gravy", "ball kicking", "ball licking", "ball sack", "ball sucking", "ball-kicking", "ball-licking", "ball-sucking", "ballbag", "ballcuzi", "ballgag", "ballsack", "bampot", "bang bros", "bang bus", "bangbros", "bangbus", "barely legal", "barenaked", "bastardo", "bastinado", "bbw", "bdsm", "beastial", "beastiality", "beastility", "beaver cleaver", "beaver lips", "beestiality", "bellesa", "bestial", "bestiality", "biatch", "big black", "big boobs", "big breasts", "big cock", "big knockers", "big tits", "bimbos", "birdlock", "bitcher", "bitchers", "bitchin", "bitching", "black cock", "blonde action", "blonde on blonde action", "blow job", "blow your load", "blowjob", "blowjobs", "blue waffle", "bluewaffle", "blumpkin", "boiolas", "bollok", "bollox", "boner", "boobie", "booty call", "boston george", "brown shower", "brown showers", "brunette action", "buceta", "bukkake", "bullet vibe", "bullet vibrator", "bung hole", "bunghole", "bunny fucker", "busty", "buttcheeks", "butthole", "buttmunch", "buttplug", "camel toe", "camgirl", "camslut", "camwhore", "canadian porch swing", "cawk", "chinc", "choad", "chocolate rosebud", "chocolate rosebuds", "chode", "cholerophile", "cholerophilia", "cialis", "cipa", "circlejerk", "claustrophile", "claustrophilia", "cleveland accordion", "cleveland hot waffle", "cleveland steamer", "clit", "clitface", "clits", "clover clamp", "clover clamps", "clunge", "cnut", "cock", "cockbite", "cockburger", "cockface", "cockhead", "cockjockey", "cockknoker", "cockmaster", "cockmongler", "cockmongruel", "cockmonkey", "cockmunch", "cockmuncher", "cocknose", "cocknugget", "cocks", "cockshit", "cocksmith", "cocksmoker", "cocksuck", "cocksucked", "cocksucking", "cocksucks", "cocksuka", "cocksukka", "coimetrophile", "coimetrophilia", "cok", "cokmuncher", "coksucka", "collaring", "coochie", "coochy", "coprolagnia", "coprophile", "coprophilia", "cornhole", "creampie", "cum", "cum shot", "cum shots", "cumbubble", "cumdumpster", "cumguzzler", "cumjockey", "cummer", "cumming", "cums", "cumshot", "cumshots", "cumslut", "cumtart", "cunilingus", "cunillingus", "cunnie", "cunnilingus", "cuntface", "cunthole", "cuntlick", "cuntlicker", "cuntlicking", "cuntrag", "cyalis", "cyberfuc", "cyberfuck", "cyberfucked", "cyberfucker", "cyberfuckers", "cyberfucking", "dammit", "date rape", "daterape", "ddlg", "deep throat", "deepthroat", "dendrophilia", "dickbag", "dickbeater", "dickface", "dickhead", "dickhole", "dickjuice", "dickmilk", "dickmonger", "dickslap", "dicksucker", "dickwad", "dickweasel", "dickweed", "dickwod", "dildo", "dildos", "dinks", "dipsea", "dirsa", "dirty pillows", "dirty sanchez", "dishabiliophile", "dishabiliophilia", "dlck", "dog style", "dog-fucker", "doggie style", "doggiestyle", "doggin", "dogging", "doggy style", "doggystyle", "dolcett", "dominatrix", "domme", "dommes", "donkey punch", "donkeyribber", "doochbag", "dookie", "doosh", "double dong", "double penetration", "douche", "dp action", "dry hump", "duche", "dumshit", "dutch rudder", "dvda", "dystychiphile", "dystychiphilia", "eat my ass", "ecchi", "edge play", "edgeplay", "ejaculated", "ejaculates", "ejaculating", "ejaculatings", "ejaculation", "ejakulate", "electroplay", "emetophile", "emetophilia", "eskimo trebuchet", "f u c k", "f u c k e r", "fagbag", "fagg", "faggit", "faggitt", "faggs", "fagots", "fags", "fagtard", "fannyflaps", "fannyfucker", "fanyy", "fart", "farted", "farting", "farty", "fatass", "fcuk", "fcuker", "fcuking", "fecker", "felatio", "felch", "felching", "fellate", "fellating", "fellatio", "feltch", "female squirting", "femdom", "figging", "finger bang", "fingerbang", "fingerbanging", "fingerfuck", "fingerfucked", "fingerfucker", "fingerfuckers", "fingerfucking", "fingerfucks", "fisted", "fistfuck", "fistfucked", "fistfucker", "fistfuckers", "fistfucking", "fistfuckings", "fistfucks", "fisting", "flamer", "fook", "fooker", "foot fetish", "foot job", "footjob", "french rudder", "frolic me", "frolicme", "frottage", "frotting", "fuck buttons", "fucka", "fucked", "fuckings", "fuckingshitmotherfucker", "fuckme", "fuker", "fukker", "fukkin", "fuks", "fukwhit", "fukwit", "fux", "fux0r", "g-spot", "gang bang", "gangbang", "gangbanged", "gangbangs", "gay sex", "gayass", "gaybob", "gaydo", "gaylord", "gaysex", "gaytard", "gaywad", "genitorture", "gerontophile", "gerontophilia", "giant cock", "girl on", "girl on top", "girls gone wild", "go-kun", "goatcx", "goatse", "god-dam", "gokkun", "golden shower", "golden showers", "goo girl", "gooch", "goodpoop", "goregasm", "group sex", "guro", "hand job", "handjob", "hard core", "hardcore", "hardcoresex", "heeb", "hentai", "heshe", "hickory switch", "hippophilia", "hoare", "hoer", "homoerotic", "hore", "horniest", "hot carl", "hot chick", "hot richard", "hotsex", "how to kill", "how to murder", "huge cock", "huge fat", "humping", "impact play", "impact-play", "jack off", "jackass", "jackoff", "jail bait", "jailbait", "jelly donut", "jerk mate", "jerk off", "jerk-off", "jerkmate", "jiggaboo", "jism", "jiz", "jizm", "jizz", "juggs", "kawk", "kennebunkport surprise", "kentucky klondike", "kentucky tractor puller", "kinbaku", "kinkster", "kiunt", "knobbing", "knobead", "knobed", "knobend", "knobhead", "knobjocky", "knobjokey", "kock", "kondum", "kondums", "kooch", "kootch", "kum", "kumer", "kummer", "kumming", "kums", "kunilingus", "kyke", "kynophile", "kynophilia", "l3i+ch", "leather restraint", "leather straight jacket", "lemon party", "lemonparty", "leningrad steamer", "literotica", "livesex", "lmfao", "lolita", "lovemaking", "lusting", "ma5terb8", "make me come", "male squirting", "male-squirting", "massive cock", "masterbat*", "masterbate", "masterbation", "masterbations", "masturb8", "masturbate", "masturbating", "masturbation", "mdlb", "meat spin", "meatspin", "menage a trois", "menage-a-trois", "menages a trois", "menages-a-trois", "menophile", "menophilia", "mexican pancake", "milf", "milwaukee blizzard", "minge", "missionary position", "mississippi birdbath", "mofo", "mothafuck", "mothafucka", "mothafuckas", "mothafuckaz", "mothafucked", "mothafucker", "mothafuckers", "mothafuckin", "mothafucking", "mothafuckings", "mothafucks", "mother fucker", "motherfuck", "motherfucked", "motherfuckers", "motherfuckin", "motherfucking", "motherfuckings", "motherfuckka", "motherfucks", "mound of venus", "mr hands", "mrhands", "muff diving", "muffdiving", "mutha", "muthafecker", "muthafuckker", "muther", "mutherfucker", "mvtube", "nambla", "nawashi", "necrophile", "necrophilia", "nigerian hurricane", "nimpho", "nimphomania", "nimphomaniac", "nipple clamp", "nipple clamps", "nob jokey", "nobhead", "nobjocky", "nobjokey", "nsfw", "nsfw images", "nudity", "numbnuts", "nutsack", "nutten", "nympho", "nymphomania", "nymphomaniac", "octopussy", "omorashi", "one cup two girls", "one guy one jar", "one jar one man", "one man one jar", "only fans", "onlyfans", "orgasim", "orgasims", "orgasmic", "orgasms", "paedo bear", "paedobear", "paedophile", "paedophilia", "pain slut", "painslut", "panamanian petting zoo", "panooch", "parthenophile", "parthenophilia", "pecker", "peckerhead", "pedo bear", "pedobear", "pedophile", "pedophilia", "penisfucker", "phagophile", "phagophilia", "phone sex", "phonesex", "phuck", "phuk", "phuked", "phuking", "phukked", "phukking", "phuks", "phuq", "pigfucker", "pimpis", "pis", "pises", "pisin", "pising", "pisof", "pissed", "pisser", "pissers", "pisses", "pissflap", "pissflaps", "pissin", "pissing", "pissoff", "pleasure chest", "pnigerophile", "pnigerophilia", "pnigophile", "pnigophilia", "poinephile", "poinephilia", "pole smoker", "polesmoker", "pony boy", "pony girl", "ponyboy", "ponygirl", "ponyplay", "poo", "poonani", "poonany", "poontang", "poop chute", "poopchute", "porn", "porn hub", "pornhub", "porno", "pornographic", "pornography", "pornos", "pricks", "prince albert piercing", "proctophile", "proctophilia", "pron", "pthc", "pube", "punani", "punanny", "punany", "pusies", "pusse", "pussi", "pussies", "pussylicking", "pussys", "pusy", "puto", "queaf", "queef", "queerbait", "queerhole", "quim", "raging boner", "ramen yarmulke", "rape", "raping", "rapist", "renob", "reverse cowgirl", "rhabdophile", "rhabdophilia", "rhypophile", "rhypophilia", "rimjaw", "rimjob", "rimming", "rosy palm", "rosy palm and her 5 sisters", "ruski", "rusty trombone", "s hit", "s&m", "s.o.b.", "santorum", "scatophile", "scatophilia", "schlong", "scroat", "scrote", "seplophile", "seplophilia", "sexcam", "sexo", "sh!+", "shagger", "shaggin", "shagging", "shaved beaver", "shaved pussy", "shibari", "shitass", "shitbagger", "shitblimp", "shitbrain", "shitbreath", "shitcunt", "shitdick", "shite", "shiteating", "shited", "shitey", "shitfaced", "shitfit", "shitfuck", "shitfull", "shitheel", "shithole", "shithouse", "shiting", "shitings", "shitload", "shitpot", "shits", "shitspitter", "shitstain", "shitted", "shitter", "shitters", "shittiest", "shitting", "shittings", "shity", "shiz", "shiznit", "shlong", "shota", "shrimping", "skank", "skittle harvest", "skittles harvest", "slut", "slutbag", "sluts", "smeg", "smegma", "snowballing", "sodomise", "sodomist", "sodomize", "sodomy", "spac", "spicy gringo", "splooge", "splooge moose", "spooge", "spread legs", "strap on", "strapon", "strappado", "strip club", "style doggy", "suicide girls", "sultry women", "tainted love", "taphephile", "taphephilia", "tard", "taste my", "tea bagged", "tea bagging", "tea-bagged", "tea-bagging", "teets", "teez", "testical", "thanatophile", "thanatophilia", "throating", "throbbing boner", "throbbing cock", "thumbzilla", "thundercunt", "tied up", "tight white", "titfuck", "titt", "tittiefucker", "titties", "titty", "tittyfuck", "tittywank", "titwank", "tongue in a", "traumatophile", "traumatophilia", "tribadism", "tribbing", "tub girl", "tubgirl", "turd", "tushy", "twathead", "twatlips", "twatty", "twinkie", "two girls one cup", "twunt", "twunter", "undressing", "upskirt", "urethra play", "urophile", "urophilia", "v1gra", "va-j-j", "venus mound", "viagra", "vibrator", "violet wand", "vjayjay", "vorarephile", "vorarephilia", "voyeurweb", "voyuer", "w00se", "wank", "wanky", "wax play", "wax-play", "wet dream", "whoar", "wiitwd", "wolfbagging", "worldsex", "wrapping men", "wrinkled starfish", "xhamster", "xnxx", "xrated", "xtube", "xvideos", "xx", "xyrophile", "xyrophilia", "yaoi", "yellow shower", "yellow showers", "yiffy", "zippo cat", "zippocat", "zoophile", "zoophilia"] },
  slur: { name: "en/slur", words: ["anal assassin", "anal astronaut", "arse bandit", "ass bandit", "batty boi", "batty boy", "battyboi", "battyboy", "bean flicker", "bean queen", "beaner", "beaners", "beanflicker", "bone smuggler", "bonesmuggler", "booty buffer", "booty-buffer", "brown piper", "brownie king", "brownie queen", "brownpiper", "buddha head", "buddhahead", "bufter", "bufty", "bulldyke", "bum boy", "bum chum", "bum driller", "bum pilot", "bum pirate", "bum rider", "bum robber", "bum rustler", "bum-pirate", "bumboy", "bumchum", "bumdriller", "bumhole engineer", "bumrider", "bumrobber", "butt boy", "butt pilot", "butt pirate", "butt rider", "butt robber", "butt rustler", "butt-pirate", "buttboy", "butthole engineer", "buttrider", "buttrobber", "camel jockey", "camel jockies", "cameljockey", "cameljockies", "carpet muncher", "carpetmuncher", "cheese eating surrender monkey", "cheese-eating surrender monkey", "chi chi man", "chi-chi man", "chicken queen", "china man", "china men", "chinaman", "chinamen", "ching chong", "ching-chong", "chink", "chinks", "chinky", "cissie", "cissy", "cockpipe cosmonaut", "cockstruction worker", "coon", "coons", "crafty butcher", "cunt boy", "cuntboy", "curry muncher", "currymuncher", "darkey", "darkie", "darkies", "darky", "dick girl", "dickgirl", "donut muncher", "donut puncher", "doon coon", "dooncoon", "dune coon", "dune-coon", "dyke", "eyetie", "fag", "fag bomb", "fagbomb", "faggot", "finocchio", "finoccio", "frog eater", "frogeater", "fudge packer", "fudgepacker", "futanari", "gaysian", "gin jockey", "gin jocky", "golliwog", "gollywog", "gook", "gook-eye", "gookie", "gooks", "gooky", "gray queen", "greaseball", "grey queen", "gringo", "gym bunny", "gymbunny", "haji", "hajji", "heimie", "hermie", "honkey", "honkeys", "honkies", "honky", "hymie", "jap", "jigaboo", "jiggerboo", "jungle bunny", "junglebunny", "kike", "kitty puncher", "kittypuncher", "kraut", "krauts", "lady boy", "ladyboy", "lesbo", "leso", "lezzie", "lezzies", "light in the fedora", "light in the loafers", "light in the pants", "limp wristed", "limp-wristed", "mayonnaise monkey", "mayonnaise monkies", "meat masseuse", "muff diver", "muffdiver", "muscle mary", "neo nazi", "neonazi", "nig nog", "nigga", "niggah", "niggas", "niggaz", "nigger", "niggers", "niggs", "niglet", "nignog", "oklahomo", "paki", "peter puffer", "peterpuffer", "petrol sniffer", "petrolsniffer", "pikey", "pikeys", "piss pig", "pisspig", "potato queen", "pussy puncher", "pussypuncher", "raghead", "retard", "retarded", "rice queen", "ring raider", "ringraider", "sand nigger", "sandnigger", "she male", "sheep shagger", "sheepshagger", "shemale", "sissy", "slant eye", "slanteye", "spastic", "spearchucker", "spic", "spick", "spicks", "spics", "suastika", "svastika", "swamp guinea", "swamp-guinea", "switch hitter", "tgirl", "timber nigger", "timbernigger", "towel head", "towelhead", "trannie", "tranny", "transbian", "twink", "wagon burner", "wagon-burner", "wet back", "wetback", "whigger", "white power", "whitepower", "wigga", "wigger", "wog", "wogs", "zipper head", "zipperhead"] }
};
var ja = {
  abuse: { name: "ja/abuse", words: ["\u3042\u305F\u307E\u60AA\u3059\u304E", "\u3046\u3056", "\u3046\u305B\u308D", "\u3046\u305C", "\u304D\u3057\u3087\u3044", "\u304D\u3057\u3087\u3059\u304E", "\u304D\u3082\u3044", "\u304D\u3082\u3059\u304E", "\u304D\u3082\u3063", "\u304F\u3055\u3059\u304E", "\u304F\u305F\u3070\u3063\u3066", "\u304F\u305F\u3070\u308C", "\u3053\u308D\u3057\u3066\u3084\u308B", "\u3060\u307E\u308C", "\u3067\u3066\u3051", "\u3072\u3063\u3053\u3081", "\u3076\u3061\u3053\u308D", "\u3076\u3063\u3053\u308D", "\u3076\u3063\u6BBA", "\u3076\u3063\u9803", "\u3080\u304B\u3064\u304F", "\u3084\u3081\u3061\u307E\u3048", "\u3084\u3081\u3066\u3057\u307E\u3048", "\u30A2\u30DB\u3059\u304E", "\u30AD\u30E2\u30AA\u30BF", "\u30AF\u30D3\u306B\u3057\u308D", "\u30B7\u30AB\u30C8", "\u30BF\u30D2\u306D", "\u30C7\u30D6\u3059\u304E", "\u30CF\u30D6\u308B", "\u30D0\u30AB\u3058\u3083\u306A\u3044\u306E", "\u30D0\u30AB\u3059\u304E", "\u30D0\u30AB\u306A\u306E", "\u30D0\u30AB\u306B\u3057\u3066\u308B", "\u30D6\u30B5\u30A4\u30AF", "\u30D6\u30B5\u30E1\u30F3", "\u30D6\u30B9\u3059\u304E", "\u30E0\u30AB\u3064\u3044", "\u4E0D\u7D30\u5DE5", "\u4E8C\u5EA6\u3068\u6765\u308B\u306A", "\u4EBA\u9593\u306E\u30AF\u30BA", "\u4F4E\u80FD", "\u4F4E\u8133", "\u5148\u751F\u5931\u683C", "\u51FA\u3066\u3044\u3051", "\u51FA\u3066\u3051", "\u534A\u6BBA\u3057", "\u5931\u305B\u308D", "\u5B58\u5728\u4FA1\u5024\u306A\u3044", "\u5E02\u306D", "\u5E30\u308C\u3088", "\u5F15\u3063\u8FBC\u3081", "\u5F79\u7ACB\u305F\u305A", "\u6559\u5E2B\u5931\u683C", "\u6765\u3093\u306A", "\u6B7B\u306D", "\u6B7B\u306D\u3070", "\u6B7B\u3093\u3058\u307E\u3048", "\u6B7B\u3093\u3058\u3083\u3048", "\u6B7B\u3093\u3067\u304F\u308C", "\u6B7B\u3093\u3067\u307B\u3057\u3044", "\u6BBA\u3057\u3066\u3084\u308B", "\u6BBA\u3059", "\u6BBA\u305B", "\u6C0F\u306D", "\u6D88\u3048\u308D", "\u7121\u80FD", "\u7121\u8133", "\u751F\u304D\u3066\u308B\u4FA1\u5024", "\u751F\u304D\u308B\u4FA1\u5024", "\u751F\u307E\u308C\u3066\u3053\u306A\u3051\u308C\u3070", "\u7523\u307E\u308C\u3066\u3053\u306A\u3051\u308C\u3070", "\u7523\u3080\u306A", "\u793E\u4F1A\u306E\u30B4\u30DF", "\u7A0E\u91D1\u6CE5\u68D2", "\u8133\u306A\u3057", "\u8133\u307F\u305D\u8DB3\u308A\u306A\u3044", "\u81ED\u3059\u304E", "\u89AA\u306E\u9854\u304C\u898B\u305F\u3044", "\u901D\u3063\u3066", "\u901D\u306D", "\u9670\u30AD\u30E3", "\u982D\u60AA\u3059\u304E", "\u99AC\u9E7F\u3059\u304E", "\u9ED9\u308C"] },
  allowlist: { name: "ja/allowlist", words: ["\u304A\u91DC", "\u304F\u305A\u3082\u3061", "\u304F\u305A\u7C89", "\u304F\u305A\u91CE\u83DC", "\u3061\u3093\u3061\u3093\u96FB\u8ECA", "\u306F\u3052\u5C71", "\u30A2\u30C9\u30EC\u30B9\u30D0\u30FC", "\u30A2\u30DB\u30A6\u30C9\u30EA", "\u30A2\u30DB\u30ED\u30FC\u30C8\u30EB", "\u30A2\u30DB\u6BDB", "\u30A4\u30AF\u30E1\u30F3", "\u30A4\u30AF\u30E9", "\u30A8\u30BF\u30CE\u30FC\u30EB", "\u30A8\u30BF\u30F3", "\u30AB\u30B9\u30B1\u30FC\u30C9", "\u30AB\u30B9\u30BF\u30CD\u30C3\u30C8", "\u30AB\u30B9\u30BF\u30DE\u30A4\u30BA", "\u30AB\u30B9\u30BF\u30DE\u30FC", "\u30AB\u30B9\u30BF\u30E0", "\u30AB\u30B9\u30C6\u30E9", "\u30AB\u30B9\u30D1\u30FC", "\u30AB\u30B9\u30D4\u6D77", "\u30B4\u30DF\u51E6\u7406", "\u30B4\u30DF\u554F\u984C", "\u30B4\u30DF\u62FE\u3044", "\u30B4\u30DF\u6368\u3066", "\u30B4\u30DF\u7BB1", "\u30B4\u30DF\u888B", "\u30B7\u30CD\u30B3\u30F3", "\u30B7\u30CD\u30DE", "\u30B7\u30CD\u30DE\u30C6\u30A3\u30C3\u30AF", "\u30B7\u30CD\u30E9\u30DE", "\u30B9\u30DA\u30FC\u30B9\u30C7\u30D6\u30EA", "\u30C7\u30D6\u30EA", "\u30CF\u30B2\u30BF\u30AB", "\u30CF\u30B2\u30EF\u30B7", "\u30D0\u30AB\u30AC\u30A4", "\u30D0\u30AB\u30E9", "\u30D0\u30AB\u30ED\u30EC\u30A2", "\u30D0\u30AB\u30F3\u30B9", "\u30D0\u30AB\u5857", "\u30D4\u30F3\u30DC\u30B1", "\u30D6\u30B9\u30B1", "\u30D6\u30FC\u30B9\u30BF\u30FC", "\u30D6\u30FC\u30B9\u30C8", "\u30DB\u30E2\u30B5\u30D4\u30A8\u30F3\u30B9", "\u30DB\u30E2\u30B8\u30CA\u30A4\u30BA", "\u30DB\u30E2\u63A5\u5408", "\u30DB\u30E2\u725B\u4E73", "\u30DC\u30B1\u30C3\u30C8", "\u30DC\u30B1\u9632\u6B62", "\u30EA\u30D5\u30EC\u30A4\u30F3", "\u30EA\u30D5\u30EC\u30AF\u30B7\u30E7\u30F3", "\u30EA\u30D5\u30EC\u30AF\u30BF\u30FC", "\u30EA\u30D5\u30EC\u30C3\u30B7\u30E5", "\u30EC\u30BA\u30D3\u30A2\u30F3", "\u4E09\u56FD\u540C\u76DF", "\u4E09\u56FD\u5FD7", "\u4E09\u56FD\u6642\u4EE3", "\u4E0D\u5177\u5408", "\u4E21\u6027", "\u4E21\u751F\u985E", "\u4EBA\u7A2E\u5DEE\u5225", "\u51E6\u5973\u4F5C", "\u51E6\u5973\u822A\u6D77", "\u5206\u88C2", "\u540C\u548C\u5BFE\u7B56", "\u540C\u548C\u6559\u80B2", "\u5516\u7136", "\u56DB\u3064\u8449", "\u56DB\u3064\u89D2", "\u56DB\u3064\u8FBB", "\u571F\u4EBA\u5F62", "\u571F\u4EBA\u5F62\u5E2B", "\u571F\u65B9\u6B73\u4E09", "\u5974\u96B7\u5236", "\u5B87\u5B99\u30B4\u30DF", "\u5B87\u5B99\u30C7\u30D6\u30EA", "\u5BDD\u307C\u3051", "\u5E0C\u5C11", "\u5E30\u7701", "\u6642\u5DEE\u30DC\u30B1", "\u6838\u5206\u88C2", "\u6BBA\u4EBA\u4E8B\u4EF6", "\u6C17\u8C61", "\u6C17\u8C61\u5E81", "\u71C3\u3048\u308B\u30B4\u30DF", "\u7247\u7AEF\u304B\u3089", "\u72C2\u4EBA\u65E5\u8A18", "\u751F\u30B4\u30DF", "\u767E\u59D3\u4E00\u63C6", "\u76F2\u5C0E\u72AC", "\u76F2\u70B9", "\u76F2\u76EE\u7684", "\u76F2\u8178", "\u77F3\u91DC", "\u79BF\u3052\u5C71", "\u79BF\u5C71", "\u7CD6\u8CEA\u5236\u9650", "\u7D30\u80DE\u5206\u88C2", "\u807E\u5B66\u6821", "\u809D\u714E\u308A", "\u81EA\u6BBA\u4E88\u9632", "\u8272\u899A", "\u845B\u6839\u6E6F", "\u845B\u7C89", "\u845B\u9905", "\u8A18\u7AE0", "\u8D77\u5E8A", "\u907F\u598A", "\u90E8\u843D\u89E3\u653E", "\u91D1\u5C5E\u304F\u305A", "\u91DC\u98EF", "\u96C6\u843D", "\u99AC\u9E7F\u8C9D", "\u671D\u9BAE\u4EBA", "\u671D\u9BAE\u534A\u5CF6", "\u5317\u671D\u9BAE", "\u3061\u3087\u3093\u307E\u3052", "\u4E01\u9AF7", "\u30C1\u30E7\u30F3\u30DC", "\u65B0\u9BAE", "\u751F\u9BAE", "\u9BAE\u660E", "\u9BAE\u3084\u304B", "\u30D6\u30FC\u30B9"] },
  ambiguous: { name: "ja/ambiguous", words: ["\u3057\u306D", "\u3057\u306D\u3088", "\u304D\u3057\u3087", "\u304D\u3082", "\u30AB\u30B9", "\u30AF\u30BA", "\u30B4\u30DF", "\u30DC\u30B1", "\u30A4\u30AF", "\u5E30\u308C", "\u304B\u3048\u308C", "\u307C\u3063\u3061", "\u304A\u3057", "\u30A8\u30BF", "\u30D2\u30CB\u30F3", "\u3061\u3093\u3061\u3093", "\u7CD6\u8CEA", "\u571F\u65B9", "\u767D\u75F4", "\u755C\u751F", "\u975E\u56FD\u6C11", "\u30AF\u30B9\u30B3", "\u30CF\u30FC\u30EC\u30E0", "\u30EA\u30D5\u30EC", "\u50AC\u7720", "\u4E73\u9996", "\u4E73\u623F", "\u6027\u6B32", "\u767A\u60C5", "\u6027\u611F", "\u4F53\u4F4D", "\u5EA7\u4F4D", "\u51E6\u5973", "\u7A2E\u4ED8\u3051", "\u611B\u4EBA", "\u30CA\u30F3\u30D1", "\u7D71\u5931", "\u5947\u5F62", "\u90E8\u843D", "\u540C\u548C", "\u767E\u59D3", "\u5C60\u6BBA", "\u75F4\u5446", "\u30DC\u30B1\u8001\u4EBA", "\u7CBE\u795E\u969C\u5BB3", "\u969C\u5BB3\u8005", "\u5728\u65E5", "\u30DB\u30E2", "\u30AA\u30AB\u30DE", "\u30AA\u30CA\u30D9", "\u30EC\u30BA", "\u4E0D\u5177", "\u7247\u7AEF", "\u56DB\u3064\u8DB3", "\u5973\u4E2D", "\u7528\u52D9\u54E1", "\u8272\u76F2", "\u76F2", "\u807E", "\u5C3B\u8EFD", "\u3064\u307E\u3089\u306A\u3044", "\u4F7F\u3048\u306A\u3044", "\u5ACC\u3044", "\u6C17\u6301\u3061\u60AA\u3044", "\u81ED\u3044", "\u3044\u3058\u3081", "\u3044\u3084\u3089\u3057\u3044", "\u3080\u3089\u3080\u3089", "\u30C0\u30D6\u30EB\u30D4\u30FC\u30B9", "\u6210\u4EBA\u5411\u3051", "\u500B\u4EBA\u64AE\u5F71", "\u9ED2\u30AE\u30E3\u30EB", "\u304A\u307C\u3053", "\u719F\u5973", "\u3067\u3079\u305D", "\u4EBA\u592B", "\u975E\u4EBA"] },
  selfharm: { name: "ja/selfharm", words: ["\u30AA\u30C9\u3057\u305F\u3044", "\u30AA\u30FC\u30D0\u30FC\u30C9\u30FC\u30BA", "\u30EA\u30B9\u30AB", "\u30EA\u30B9\u30C8\u30AB\u30C3\u30C8", "\u6B7B\u306B\u305F\u3044", "\u6B7B\u306B\u305F\u304F\u306A\u308B", "\u6B7B\u306B\u3066\u3048", "\u6D88\u3048\u305F\u3044", "\u751F\u304D\u308B\u306E\u304C\u3064\u3089\u3044", "\u751F\u304D\u308B\u306E\u3064\u3089\u3044", "\u81EA\u6BBA", "\u81EA\u6BBA\u3057\u305F\u3044", "\u98DB\u3073\u964D\u308A\u305F\u3044", "\u9996\u3064\u308A", "\u9996\u3092\u540A", "\u9996\u540A\u308A"] },
  sexual: { name: "ja/sexual", words: ["AV\u5973\u512A", "G\u30B9\u30DD\u30C3\u30C8", "NTR", "T\u30D0\u30C3\u30AF", "\u3048\u3063\u3061", "\u304A\u3061\u3093\u3061\u3093", "\u304A\u3063\u03C0", "\u304A\u3063\u3071\u3044", "\u304A\u306A\u306B\u30FC", "\u304A\u306D\u30B7\u30E7\u30BF", "\u304A\u307E\u3093\u3053", "\u304A\u3081\u3053", "\u304A\u6383\u9664\u30D5\u30A7\u30E9", "\u304D\u3093\u305F\u307E", "\u3055\u304B\u3055\u690B\u9CE5", "\u3057\u307C\u308A\u8299\u84C9", "\u3059\u3051\u3079", "\u305B\u304D\u308C\u3044\u672C\u624B", "\u305B\u3063\u304F\u3059", "\u3060\u3044\u3057\u3085\u304D\u30DB\u30FC\u30EB\u30C9", "\u3061\u3093\u3053", "\u3061\u3093\u307D", "\u3072\u3068\u308A\u3048\u3063\u3061", "\u3075\u305F\u306A\u308A", "\u307E\u3093\u3050\u308A\u8FD4\u3057", "\u307E\u3093\u3053", "\u307E\u3093\u307E\u3093", "\u30A2\u30AF\u30E1", "\u30A2\u30B2\u30DE\u30F3", "\u30A2\u30C0\u30EB\u30C8\u30D3\u30C7\u30AA", "\u30A2\u30CA\u30CB\u30FC", "\u30A2\u30CA\u30EB", "\u30A2\u30CA\u30EB\u30BB\u30C3\u30AF\u30B9", "\u30A2\u30CA\u30EB\u30D3\u30FC\u30BA", "\u30A2\u30CA\u30EB\u30D7\u30E9\u30B0", "\u30A2\u30CA\u30EB\u62E1\u5F35", "\u30A2\u30CA\u30EB\u958B\u767A", "\u30A2\u30CA\u30EB\uFF33\uFF25\uFF38", "\u30A2\u30D8\u9854", "\u30A4\u30C1\u30E2\u30C4", "\u30A4\u30C1\u30E3\u30A4\u30C1\u30E3\u30BB\u30C3\u30AF\u30B9", "\u30A4\u30C1\u30E3\u30E9\u30D6\u30BB\u30C3\u30AF\u30B9", "\u30A4\u30E1\u30AF\u30E9", "\u30A4\u30E1\u30FC\u30B8\u30D3\u30C7\u30AA", "\u30A4\u30E9\u30DE\u30C1\u30AA", "\u30A4\u30F3\u30DD", "\u30A4\u30F3\u30DD\u30C6\u30F3\u30C4", "\u30A8\u30AF\u30B9\u30BF\u30B7\u30FC", "\u30A8\u30ED", "\u30A8\u30ED\u3044", "\u30A8\u30ED\u540C\u4EBA", "\u30A8\u30ED\u540C\u4EBA\u8A8C", "\u30A8\u30ED\u672C", "\u30AA\u30CA\u30DA", "\u30AA\u30CA\u30DA\u30C3\u30C8", "\u30AA\u30CA\u30DB", "\u30AA\u30CA\u30DB\u30FC\u30EB", "\u30AA\u30FC\u30AC\u30BA\u30E0", "\u30AB\u30A6\u30D1\u30FC", "\u30AB\u30F3\u30C8\u30F3\u5305\u830E", "\u30AE\u30E3\u30B0\u30DC\u30FC\u30EB", "\u30AF\u30EA\u30C8\u30EA\u30B9", "\u30AF\u30F3\u30CB", "\u30AF\u30F3\u30CB\u30EA\u30F3\u30B0\u30B9", "\u30B1\u30C4\u30DE\u30F3\u30B3", "\u30B3\u30F3\u30C9\u30FC\u30E0", "\u30B5\u30B2\u30DE\u30F3", "\u30B6\u30FC\u30E1\u30F3", "\u30B7\u30C3\u30AF\u30B9\u30CA\u30A4\u30F3", "\u30B7\u30E7\u30BF\u304A\u306D", "\u30B9\u30AB\u30C8\u30ED", "\u30B9\u30B1\u30D9\u6905\u5B50", "\u30B9\u30DA\u30EB\u30DE", "\u30B9\u30EF\u30C3\u30D4\u30F3\u30B0", "\u30BB\u30D5\u30EC", "\u30BB\u30F3\u30BA\u30EA", "\u30BD\u30D5\u30C8\u30FB\u30AA\u30F3\u30FB\u30C7\u30DE\u30F3\u30C9", "\u30BD\u30FC\u30D7\u30E9\u30F3\u30C9", "\u30BD\u30FC\u30D7\u5B22", "\u30C0\u30C3\u30C1\u30EF\u30A4\u30D5", "\u30C7\u30A3\u30EB\u30C9", "\u30C7\u30A3\u30FC\u30D7\u30B9\u30ED\u30FC\u30C8", "\u30C7\u30AB\u30C1\u30F3", "\u30C7\u30EA\u30D0\u30EA\u30FC\u30D8\u30EB\u30B9", "\u30C7\u30EA\u30D8\u30EB", "\u30C8\u30ED\u9854", "\u30CE\u30FC\u30D1\u30F3", "\u30CF\u30E1\u64AE\u308A", "\u30D0\u30A4\u30A2\u30B0\u30E9", "\u30D0\u30AD\u30E5\u30FC\u30E0\u30D5\u30A7\u30E9", "\u30D1\u30A4\u30BA\u30EA", "\u30D1\u30A4\u30D1\u30F3", "\u30D1\u30D1\u6D3B", "\u30D1\u30F3\u30C1\u30E9", "\u30D3\u30C3\u30C1", "\u30D5\u30A3\u30B9\u30C8\u30D5\u30A1\u30C3\u30AF", "\u30D5\u30A7\u30E9", "\u30D5\u30A7\u30E9\u30C1\u30AA", "\u30D5\u30A7\u30E9\u629C\u304D", "\u30D6\u30EB\u30BB\u30E9", "\u30DA\u30C3\u30C6\u30A3\u30F3\u30B0", "\u30DA\u30CB\u30D0\u30F3", "\u30DB\u5225", "\u30DC\u30C6\u8179", "\u30DD\u30B3\u30C1\u30F3", "\u30DD\u30EB\u30C1\u30AA", "\u30DE\u30B9\u30BF\u30FC\u30D9\u30FC\u30B7\u30E7\u30F3", "\u30E4\u30EA\u30C1\u30F3", "\u30E4\u30EA\u30DE\u30F3", "\u30E9\u30D6\u30C9\u30FC\u30EB", "\u30E9\u30D6\u30DB", "\u30E9\u30D6\u30DB\u30C6\u30EB", "\u30EC\u30A4\u30D7", "\u30ED\u30EA\u30B3\u30F3", "\u4E00\u4EBA\uFF28", "\u4E2D\u51FA\u3057", "\u4E59\u03C0", "\u4E71\u308C\u7261\u4E39", "\u4E71\u4EA4", "\u4E80\u7532\u7E1B\u308A", "\u4E80\u982D", "\u4E8C\u7A74", "\u4E8C\u7A74\u540C\u6642", "\u4EEE\u6027\u5305\u830E", "\u515C\u5408\u308F\u305B", "\u5165\u8239\u672C\u624B", "\u5186\u5149", "\u5305\u830E", "\u53E3\u5185\u5C04\u7CBE", "\u53E3\u5185\u767A\u5C04", "\u5510\u8349\u5C45\u8336\u81FC", "\u5598\u304E\u58F0", "\u56DB\u5341\u516B\u624B", "\u592A\u3082\u3082\u30B3\u30AD", "\u59EB\u59CB\u3081", "\u5A9A\u85AC", "\u5B55\u307E\u305B", "\u5BDD\u53D6\u3089\u308C", "\u5BDD\u53D6\u308A", "\u5BFF\u672C\u624B", "\u5C04\u7CBE", "\u5C4D\u59E6", "\u5DE8\u4E73", "\u5DE8\u5C3B", "\u5DE8\u6839", "\u5E06\u304B\u3051\u8336\u81FC", "\u5F37\u59E6", "\u5F8C\u80CC\u4F4D", "\u5FAE\u4E73", "\u5FCD\u3073\u5C45\u8336\u81FC", "\u5FEB\u697D\u5815\u3061", "\u6027\u4EA4", "\u6027\u51E6\u7406", "\u6027\u5974\u96B7", "\u6027\u611F\u30DE\u30C3\u30B5\u30FC\u30B8", "\u6027\u611F\u5E2F", "\u6027\u884C\u70BA", "\u611B\u64AB", "\u611B\u6DB2", "\u6211\u6162\u6C41", "\u624B\u30B3\u30AD", "\u624B\u30DE\u30F3", "\u624B\u6DEB", "\u62B1\u304D\u5730\u8535", "\u63DA\u7FBD\u672C\u624B", "\u63F4\u4EA4", "\u63F4\u52A9\u4EA4\u969B", "\u653E\u5C3F", "\u653E\u7F6E\u30D7\u30EC\u30A4", "\u65E9\u6F0F", "\u6642\u96E8\u8336\u81FC", "\u6708\u898B\u8336\u81FC", "\u671D\u52C3\u3061", "\u671D\u8D77\u3061", "\u677E\u8449\u5D29\u3057", "\u6A5F\u7E54\u8336\u81FC", "\u6B63\u5E38\u4F4D", "\u6C41\u7537\u512A", "\u6CE1\u59EB", "\u6D1E\u5165\u308A\u672C\u624B", "\u6DEB\u4E71", "\u6DEB\u884C", "\u6DEB\u8A9E", "\u6DEB\u9761", "\u7206\u4E73", "\u7363\u59E6", "\u7389\u8210\u3081", "\u751F\u30CF\u30E1", "\u7537\u5A3C", "\u75F4\u5973", "\u771F\u6027\u5305\u830E", "\u7761\u59E6", "\u777E\u4E38", "\u7A2E\u4ED8\u3051\u30D7\u30EC\u30B9", "\u7A74\u5144\u5F1F", "\u7ACB\u3061\u3093\u307C", "\u7AE5\u8C9E", "\u7B20\u821F\u672C\u624B", "\u7B46\u304A\u308D\u3057", "\u7B4F\u672C\u624B", "\u7C97\u30C1\u30F3", "\u7D20\u80A1", "\u7D76\u502B", "\u7DB2\u4EE3\u672C\u624B", "\u7DCA\u7E1B", "\u8089\u4FBF\u5668", "\u80F8\u30C1\u30E9", "\u8107\u30B3\u30AD", "\u81EA\u6170", "\u83CA\u9580", "\u87FB\u306E\u6238\u6E21\u308A", "\u88CF\u7B4B", "\u8C9D\u5408\u308F\u305B", "\u8CA7\u4E73", "\u8DB3\u30B3\u30AD", "\u8F2A\u59E6", "\u8FD1\u89AA\u76F8\u59E6", "\u9006\u30A2\u30CA\u30EB", "\u9006\u30EC\u30A4\u30D7", "\u9045\u6F0F", "\u91D1\u7389", "\u9670\u5507", "\u9670\u56A2", "\u9670\u6838", "\u9670\u6BDB", "\u9670\u830E", "\u9670\u90E8", "\u9675\u8FB1", "\u96C1\u304C\u9996", "\u96FB\u30DE", "\u9752\u59E6", "\u9854\u5C04", "\u98DF\u7CDE", "\u98F2\u5C3F", "\u9996\u5F15\u304D\u604B\u6155", "\u9A0E\u4E57\u4F4D", "\u9DAF\u306E\u8C37\u6E21\u308A", "\u9EC4\u91D1\u6C34", "\uFF33\uFF2D\u30D7\u30EC\u30A4"] },
  slur: { name: "ja/slur", words: ["\u3044\u3056\u308A", "\u304B\u305F\u308F", "\u304D\u3061\u304C\u3044", "\u304E\u3063\u3061\u3087", "\u305B\u3080\u3057", "\u3061\u3093\u3070", "\u3064\u3093\u307C", "\u3064\u3093\u307C\u685F\u6577", "\u3069\u3082\u308A", "\u3073\u3063\u3053", "\u3081\u304F\u3089", "\u3081\u304F\u3089\u5224", "\u3081\u304F\u3089\u6EC5\u6CD5", "\u3081\u3063\u304B\u3061", "\u3089\u3044\u75C5", "\u30A2\u30B9\u30DA", "\u30A2\u30DB", "\u30AC\u30A4\u30B8", "\u30AD\u30E0\u30C1\u91CE\u90CE", "\u30AF\u30BD", "\u30AF\u30BD\u304F\u3089\u3048", "\u30AF\u30BD\u30A2\u30DE", "\u30AF\u30BD\u30AC\u30AD", "\u30AF\u30BD\u30B4\u30DF", "\u30B8\u30B8\u30A4", "\u30B8\u30E3\u30C3\u30D7", "\u30B9\u30C6\u30CF\u30B2", "\u30C1\u30E7\u30F3", "\u30C1\u30E7\u30F3\u30B3", "\u30C7\u30D6", "\u30CA\u30DE\u30DD", "\u30CB\u30B0\u30ED", "\u30CD\u30C8\u30A6\u30E8", "\u30CF\u30B2", "\u30D0\u30AB", "\u30D0\u30AB\u30E4\u30ED\u30A6", "\u30D0\u30AB\u30E4\u30ED\u30FC", "\u30D0\u30D0\u30A2", "\u30D1\u30E8\u30AF", "\u30D4\u30CD\u30AC\u30AD", "\u30D6\u30B9", "\u30DD\u30EA\u516C", "\u30DE\u30CC\u30B1", "\u4E09\u56FD\u4EBA", "\u4E0D\u5177\u8005", "\u4F4E\u80FD\u5150", "\u4F4E\u8133\u5150", "\u50B4\u50C2", "\u5206\u88C2\u75C5", "\u534A\u5CF6\u4EBA", "\u5516", "\u571F\u4EBA", "\u5947\u5F62\u5150", "\u5C0F\u4F7F\u3044", "\u5EC3\u75BE", "\u652F\u90A3", "\u652F\u90A3\u4EBA", "\u696D\u75C5", "\u6BDB\u5510", "\u6C17\u72C2\u3044", "\u6C17\u9055\u3044", "\u6C17\u9055\u3044\u306B\u5203\u7269", "\u6C60\u6CBC", "\u6C96\u4EF2\u4ED5", "\u7279\u6B8A\u90E8\u843D", "\u72C2\u4EBA", "\u7669\u75C5", "\u77E5\u6075\u9045\u308C", "\u7A62\u591A", "\u7CBE\u795E\u5206\u88C2\u75C5", "\u7CBE\u8584", "\u7CDE\u304F\u3089\u3048", "\u7CDE\u98DF\u3089\u3048", "\u8499\u53E4\u75C7", "\u8C5A\u91CE\u90CE", "\u90E8\u843D\u6C11", "\u9732\u52A9", "\u99AC\u9E7F\u91CE\u90CE", "\u9BAE\u4EBA", "\u9ED2\u3093\u307C"] }
};
var languages = ["en", "ja"];

// node_modules/.pnpm/wordguard@0.1.1/node_modules/wordguard/dist/wordguard.js
var DEFAULT_CATEGORIES = ["sexual", "slur", "abuse"];
function pick(languages2, categories) {
  const lists = [];
  for (const lang of languages2) {
    const bundle = data_exports[lang];
    for (const category of categories) {
      const list = bundle[category];
      if (list)
        lists.push(list);
    }
  }
  return lists;
}
function allowlistFor(languages2) {
  return languages2.flatMap((lang) => {
    const bundle = data_exports[lang];
    return bundle.allowlist?.words ?? [];
  });
}
function wordguard(options = {}) {
  const languages2 = options.languages ?? [...languages];
  const categories = options.categories ?? DEFAULT_CATEGORIES;
  const lists = pick(languages2, categories);
  if (options.words?.length)
    lists.push({ name: "custom", words: options.words });
  return createFilter({
    lists,
    allowlist: [
      ...options.builtinAllowlist === false ? [] : allowlistFor(languages2),
      ...options.allowlist ?? []
    ]
  });
}

// services/translate/sensitive-text.ts
var EXTRA_WORDS = [
  /* Japanese game-specific terms. */
  "\u30EC\u30A4\u30D7",
  "\u5F37\u59E6",
  "\u51CC\u8FB1",
  "\u8F2A\u59E6",
  "\u75F4\u6F22",
  "\u633F\u5165",
  "\u5C04\u7CBE",
  "\u4E2D\u51FA\u3057",
  "\u9854\u5C04",
  "\u53E3\u5185\u5C04\u7CBE",
  "\u81A3\u5185",
  "\u30A2\u30CA\u30EB",
  "\u30DA\u30CB\u30B9",
  "\u30C1\u30F3\u30DD",
  "\u3061\u3093\u307D",
  "\u307E\u3093\u3053",
  "\u304A\u3063\u3071\u3044",
  "\u4E73\u9996",
  "\u30AF\u30EA\u30C8\u30EA\u30B9",
  "\u30D5\u30A7\u30E9",
  "\u30BB\u30C3\u30AF\u30B9",
  "\u30A8\u30ED\u3044",
  "\u6DEB\u4E71",
  "\u7D76\u9802",
  "\u5598\u304E",
  "\u8ABF\u6559",
  "\u8089\u4FBF\u5668",
  "\u7CBE\u6DB2",
  "\u611B\u6DB2",
  "\u6F6E\u5439",
  "\u30AA\u30CA\u30CB",
  "\u81EA\u6170",
  "\u5168\u88F8",
  /* Mixed Chinese text and cache writes. */
  "\u5F3A\u5978",
  "\u51CC\u8FB1",
  "\u8F6E\u5978",
  "\u75F4\u6C49",
  "\u5F3A\u5236\u7231",
  "\u63D2\u5165",
  "\u5C04\u7CBE",
  "\u4E2D\u51FA",
  "\u989C\u5C04",
  "\u9634\u9053",
  "\u809B\u95E8",
  "\u9634\u830E",
  "\u4E73\u623F",
  "\u5976\u5B50",
  "\u53E3\u4EA4",
  "\u6027\u7231",
  "\u6DEB\u4E71",
  "\u9AD8\u6F6E",
  "\u7CBE\u6DB2",
  "\u7231\u6DB2",
  "\u6F6E\u5439",
  "\u81EA\u6170",
  "\u88F8\u4F53",
  "\u8131\u5149",
  "\u8C03\u6559",
  "\u8089\u4FBF\u5668"
];
var filter = wordguard({
  languages: ["ja"],
  categories: ["sexual"],
  words: EXTRA_WORDS
});
var DECO_SIGNAL = /[♡♥❤💕]|はぁ+|あっ+|んっ+|ぅぅ+|ァ+|ッ+/g;
function inspectSensitiveText(text2) {
  const raw = String(text2 ?? "");
  if (!raw.trim()) return { sensitive: false, score: 0, reasons: [] };
  const core = stripControlNoise(raw);
  let score = 0;
  const reasons = [];
  if (core) {
    const matches = filter.matchAll(core);
    if (matches.length) {
      score += Math.min(4, matches.length * 2);
      const labels = [...new Set(matches.map((m) => m.word))].slice(0, 4);
      reasons.push(`wg:${labels.join("|")}`);
    }
  }
  const deco = raw.match(DECO_SIGNAL);
  if (deco && deco.length >= 2 && score > 0) {
    score += 1;
    reasons.push("deco");
  } else if (deco && deco.length >= 4 && /[♡♥❤]/.test(raw) && raw.length <= 40) {
    score += 1;
    reasons.push("deco-heavy");
  }
  return { sensitive: score >= 2, score, reasons };
}
function isSensitiveForCloud(text2) {
  return inspectSensitiveText(text2).sensitive;
}
function isNsfwTaggedEngine(engine) {
  const e = String(engine || "");
  if (!e) return false;
  return e.includes(":nsfw") || e === "skip:sensitive" || e.endsWith(":sensitive");
}
function isNsfwCacheRow(src, engine) {
  return isNsfwTaggedEngine(engine) || isSensitiveForCloud(src);
}

// services/translate/shared-cache/backfill.ts
import fs8 from "node:fs";

// lib/translate/cache-file-lock.ts
function lockCacheFile(fs21, file) {
  const name2 = `${file}.lock`;
  let fd;
  try {
    fd = fs21.openSync(name2, "wx");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let stale = false;
    try {
      const pid = Number(fs21.readFileSync(name2, "utf8"));
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
        } catch (e) {
          stale = e.code === "ESRCH";
        }
      } else stale = Date.now() - fs21.statSync(name2).mtimeMs > 3e4;
    } catch {
    }
    if (!stale) throw new Error("Translation cache is being written, please try again later");
    fs21.unlinkSync(name2);
    fd = fs21.openSync(name2, "wx");
  }
  try {
    fs21.writeFileSync(fd, String(process.pid));
  } catch (e) {
    fs21.closeSync(fd);
    fs21.unlinkSync(name2);
    throw e;
  }
  return () => {
    fs21.closeSync(fd);
    fs21.unlinkSync(name2);
  };
}
function appendCacheLines(fs21, file, lines) {
  if (!lines.length) return;
  let text2 = "";
  try {
    text2 = fs21.readFileSync(file, "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (text2 && !text2.endsWith("\n")) {
    const end = text2.lastIndexOf("\n") + 1;
    try {
      JSON.parse(text2.slice(end));
      fs21.appendFileSync(file, "\n");
    } catch {
      fs21.truncateSync(file, Buffer.byteLength(text2.slice(0, end)));
    }
  }
  fs21.appendFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  const fd = fs21.openSync(file, "r+");
  try {
    fs21.fsyncSync(fd);
  } finally {
    fs21.closeSync(fd);
  }
}

// services/translate/shared-cache/game-projections.ts
import { createHash as createHash2 } from "node:crypto";
function createGameProjections(client, index2, database) {
  client.exec(`CREATE TABLE IF NOT EXISTS game_projections (
    root TEXT NOT NULL, src TEXT NOT NULL, src_lang TEXT NOT NULL, tgt_lang TEXT NOT NULL,
    signature TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(root,src,src_lang,tgt_lang))`);
  const originDatabase = `${database}:game-projection`;
  function signature(root) {
    return JSON.stringify([SENTENCE_RULE_VERSION, index2.version(), getGameCacheContext(root).authorityVersion]);
  }
  return {
    queue(root, sources) {
      const insert = client.prepare(`INSERT INTO game_projections(root,src,src_lang,tgt_lang) VALUES(?,?,?,?)
        ON CONFLICT(root,src,src_lang,tgt_lang) DO UPDATE SET signature=''`);
      for (const { src, pair } of sources) {
        if (!src || pair.to !== "zh") continue;
        insert.run(root, src, pair.from, pair.to);
      }
    },
    pending(root) {
      if (!client.prepare("SELECT 1 FROM game_projections WHERE root=? LIMIT 1").get(root)) return false;
      return Boolean(client.prepare("SELECT 1 FROM game_projections WHERE root=? AND signature<>? LIMIT 1").get(root, signature(root)));
    },
    collect(root, rows, budgetMs = Infinity) {
      const started = performance.now();
      const context2 = getGameCacheContext(root);
      const nextSignature = signature(root);
      const pending = client.prepare("SELECT * FROM game_projections WHERE root=? AND signature<>? ORDER BY revision,src,src_lang,tgt_lang").all(root, nextSignature);
      const updateProjection = client.prepare("UPDATE game_projections SET signature=?,revision=? WHERE root=? AND src=? AND src_lang=? AND tgt_lang=?");
      const events = [];
      const acknowledge = [];
      for (const entry of pending) {
        if (acknowledge.length && performance.now() - started >= budgetMs) break;
        const pair = { from: entry.src_lang, to: entry.tgt_lang };
        const exact = !context2.blocked(entry.src) && context2.lookup[entry.src] == null ? index2.record(entry.src, pair) : null;
        const plan = exact ? { limited: false, status: "full", zh: exact.zh } : planGameCache(entry.src, pair, index2, context2).plan;
        const zh = !plan.limited && plan.status === "full" ? plan.zh : null;
        const old = rows.get(entry.src);
        const id = createHash2("sha256").update(JSON.stringify([entry.src, pair])).digest("hex");
        const owned = old?.origin?.database === originDatabase && old.origin.id === id;
        const revision = entry.revision + 1;
        if ((!old || old.origin) && (zh != null ? old?.t !== zh : owned)) {
          events.push({
            s: entry.src,
            t: zh,
            engine: "derived:sentence",
            origin: { database: originDatabase, id, revision },
            event: `${originDatabase}:${id}:${revision}`
          });
        }
        acknowledge.push(() => {
          updateProjection.run(nextSignature, revision, root, entry.src, entry.src_lang, entry.tgt_lang);
        });
      }
      return { events, acknowledge, pending: acknowledge.length < pending.length };
    }
  };
}

// services/translate/shared-cache/backfill.ts
var fileSnapshots = /* @__PURE__ */ new Map();
function fileStamp(file) {
  const stat = fs8.statSync(file, { throwIfNoEntry: false });
  return JSON.stringify([stat?.ino, stat?.size, stat?.mtimeMs, stat?.ctimeMs]);
}
function readBackfillSnapshot(file) {
  const stamp = fileStamp(file);
  const rows = /* @__PURE__ */ new Map(), seen = /* @__PURE__ */ new Set();
  for (const line of (fs8.existsSync(file) ? fs8.readFileSync(file, "utf8") : "").split("\n")) {
    try {
      const row = parseCacheRow(JSON.parse(line));
      if (row) {
        applyCacheRow(rows, row);
        if (row.event) seen.add(row.event);
      }
    } catch {
    }
  }
  return { stamp, rows, seen };
}
function backfillSnapshot(file) {
  const stamp = fileStamp(file);
  const previous = fileSnapshots.get(file);
  if (previous?.stamp === stamp) return previous;
  const snapshot = readBackfillSnapshot(file);
  if (fileSnapshots.size >= 4 && !fileSnapshots.has(file)) fileSnapshots.delete(fileSnapshots.keys().next().value);
  fileSnapshots.set(file, snapshot);
  return snapshot;
}
function ownedSharedAppend(file, before, events) {
  if (!events.length) return false;
  const after = readBackfillSnapshot(file);
  const expected = new Map(events.map((event) => [event.s, event]));
  const changed = /* @__PURE__ */ new Set();
  for (const src of /* @__PURE__ */ new Set([...before.rows.keys(), ...after.rows.keys()])) {
    if (JSON.stringify(before.rows.get(src)) !== JSON.stringify(after.rows.get(src))) changed.add(src);
  }
  if (changed.size !== expected.size || [...expected.keys()].some((src) => !changed.has(src))) return false;
  for (const [src, event] of expected) {
    if (!changed.has(src)) return false;
    const row = after.rows.get(src);
    if (!row || row.s !== event.s || row.t !== event.t || row.engine !== event.engine || row.event !== event.event || row.origin?.id !== event.origin?.id || row.origin?.revision !== event.origin?.revision || row.origin?.database !== event.origin?.database)
      return false;
  }
  const expectedEvents = new Set(events.map((event) => event.event));
  for (const event of after.seen) if (!before.seen.has(event) && !expectedEvents.has(event)) return false;
  fileSnapshots.set(file, after);
  return true;
}
function appendCacheEvents(file, events) {
  if (appendPublicCacheFile(file, events)) return;
  appendCacheLines(fs8, file, events);
}
function createGameBackfill(client, index2, database) {
  const projections = createGameProjections(client, index2, database);
  client.exec(`CREATE TABLE IF NOT EXISTS game_backfills (root TEXT NOT NULL,src TEXT NOT NULL,record_id INTEGER NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(root,src));
    CREATE TABLE IF NOT EXISTS game_backfill_tasks(id INTEGER PRIMARY KEY AUTOINCREMENT,root TEXT NOT NULL,src TEXT NOT NULL,record_id INTEGER NOT NULL,revision INTEGER NOT NULL);`);
  function selected(src, recordId) {
    const pair = client.prepare("SELECT src_lang,tgt_lang FROM translation_records WHERE id=?").get(recordId);
    return index2.record(src, pair ? { from: pair.src_lang, to: pair.tgt_lang } : resolveCacheLangPair({ src, to: "zh" }));
  }
  const staleLink = `NOT EXISTS (
    SELECT 1 FROM translation_records r JOIN selected_translations t ON t.id=r.translation_id
    WHERE r.id=b.record_id AND r.revision=b.revision
  )`;
  function meta(record) {
    return { alignments: record.alignments, newlines: record.newlines, structure: record.structure };
  }
  return {
    roots() {
      return client.prepare("SELECT root FROM game_projections UNION SELECT root FROM game_backfills").all().map((row) => row.root);
    },
    queueProjections: projections.queue,
    queue(root, records2) {
      if (!records2.length) return;
      client.exec("BEGIN IMMEDIATE");
      try {
        for (const r of records2) {
          client.prepare(
            `INSERT INTO game_backfill_tasks(root,src,record_id,revision)
               SELECT ?,?,?,? WHERE NOT EXISTS (
                 SELECT 1 FROM game_backfill_tasks WHERE root=? AND src=? AND record_id=? AND revision=?
               ) AND NOT EXISTS (
                 SELECT 1 FROM game_backfills WHERE root=? AND src=? AND record_id=? AND revision=?
               ) AND NOT EXISTS (
                 SELECT 1 FROM translation_outbox WHERE record_id=? AND revision=?
               )`
          ).run(root, r.src, r.id, r.revision, root, r.src, r.id, r.revision, root, r.src, r.id, r.revision, r.id, r.revision);
        }
        client.exec("COMMIT");
      } catch (e) {
        client.exec("ROLLBACK");
        throw e;
      }
    },
    flush(root, opts) {
      const pending = client.prepare("SELECT 1 FROM game_backfill_tasks WHERE root=? LIMIT 1").get(root);
      const stale = client.prepare(`SELECT 1 FROM game_backfills b WHERE b.root=? AND ${staleLink} LIMIT 1`).get(root);
      if (!pending && !stale && !projections.pending(root)) return { sharedOnly: false };
      const file = ensureGameContentDir(root, "cacheNdjson");
      const release = lockCacheFile(fs8, file);
      try {
        const filesBefore = gameTranslationFiles(root);
        const previousStamp = filesBefore.stamp;
        const snapshot = backfillSnapshot(file);
        const context2 = getGameCacheContext(root);
        const rows = new Map(snapshot.rows), seen = new Set(snapshot.seen);
        const events = [];
        const acknowledgements = [];
        const tasks = client.prepare("SELECT * FROM game_backfill_tasks WHERE root=? ORDER BY id").all(root);
        for (const task of tasks) {
          const record = selected(task.src, task.record_id);
          const event = record ? `${database}:fill:${record.id}:${record.revision}` : "";
          if (record && !context2.blocked(task.src) && context2.lookup[task.src] == null && !seen.has(event)) {
            const value = {
              s: task.src,
              t: record.zh,
              engine: record.engine ?? void 0,
              origin: { id: record.id, revision: record.revision, database },
              event,
              ...meta(record)
            };
            const old = rows.get(task.src);
            if (!old || old.origin) {
              events.push(value);
              applyCacheRow(rows, value);
              seen.add(event);
            }
          }
          acknowledgements.push(() => {
            if (record) client.prepare("INSERT OR REPLACE INTO game_backfills VALUES(?,?,?,?)").run(root, task.src, record.id, record.revision);
            client.prepare("DELETE FROM game_backfill_tasks WHERE id=?").run(task.id);
          });
        }
        const links = client.prepare(`SELECT b.* FROM game_backfills b WHERE b.root=? AND ${staleLink}`).all(root);
        for (const link of links) {
          const old = rows.get(link.src);
          if (!old?.origin || old.origin.database !== database || old.origin.id !== String(link.record_id)) {
            acknowledgements.push(() => {
              client.prepare("DELETE FROM game_backfills WHERE root=? AND src=? AND record_id=?").run(root, link.src, link.record_id);
            });
            continue;
          }
          const record = selected(link.src, link.record_id);
          if (record?.id === old.origin.id && record.revision === old.origin.revision) continue;
          const revision = record?.revision || link.revision + 1;
          const value = {
            s: link.src,
            t: record?.zh ?? null,
            engine: record?.engine ?? void 0,
            origin: { id: record?.id || String(link.record_id), revision, database },
            event: `${database}:refresh:${link.record_id}:${link.revision}:${record?.id || "deleted"}:${revision}`,
            ...record ? meta(record) : {}
          };
          if (!seen.has(value.event)) {
            events.push(value);
            applyCacheRow(rows, value);
            seen.add(value.event);
          }
          acknowledgements.push(() => {
            if (record) client.prepare("INSERT OR REPLACE INTO game_backfills VALUES(?,?,?,?)").run(root, link.src, record.id, record.revision);
            else client.prepare("DELETE FROM game_backfills WHERE root=? AND src=? AND record_id=?").run(root, link.src, link.record_id);
          });
        }
        const projected = projections.collect(root, rows, opts?.projectionBudgetMs);
        events.push(...projected.events);
        acknowledgements.push(...projected.acknowledge);
        for (let offset = 0; offset < events.length; offset += 500) appendCacheEvents(file, events.slice(offset, offset + 500));
        client.exec("BEGIN IMMEDIATE");
        try {
          for (const acknowledge of acknowledgements) acknowledge();
          client.exec(
            "DELETE FROM translation_outbox WHERE NOT EXISTS (SELECT 1 FROM game_backfills l WHERE l.record_id=translation_outbox.record_id AND l.revision<translation_outbox.revision)"
          );
          client.exec("COMMIT");
        } catch (error) {
          client.exec("ROLLBACK");
          throw error;
        }
        const filesAfter = gameTranslationFiles(root);
        const sameSeedAndFallback = JSON.stringify(filesBefore.seed) === JSON.stringify(filesAfter.seed) && (filesBefore.cache == null || filesBefore.cache === filesAfter.cache);
        const sharedOnly = sameSeedAndFallback && ownedSharedAppend(file, snapshot, events) && noteGameSharedBackfill(root, previousStamp);
        return { sharedOnly, pending: projected.pending };
      } finally {
        release();
      }
    }
  };
}

// services/translate/shared-cache/confirm-segments.ts
function uniqueSpan(text2, fragment, newlines, structure) {
  const units = sentenceUnits(text2, { newlines, structure });
  const parts = sentenceUnits(fragment);
  if (!parts.length) return null;
  const hits = [];
  for (let i = 0; i + parts.length <= units.length; i++) {
    if (parts.every((part, j) => sameSentence(part, units[i + j]) && (j === parts.length - 1 || part.boundary === units[i + j].boundary)) && units[i].block === units[i + parts.length - 1].block)
      hits.push({ start: units[i].start, end: units[i + parts.length - 1].end });
  }
  return hits.length === 1 ? hits[0] : null;
}
function confirmRecordSegments(index2, parent, pairs, pair, opts) {
  const record = opts?.candidateId ? index2.inserted(opts.candidateId) : index2.record(parent.src, pair);
  const diagnostics = [];
  const stats = {
    inserted: 0,
    identical: 0,
    conflict: 0,
    skipped: 0,
    total: pairs.length + (opts?.groups?.length || 0),
    localOnly: [],
    stale: false,
    dryRun: Boolean(opts?.dryRun),
    diagnostics
  };
  if (!record || record.src !== parent.src || record.from !== pair.from || record.to !== pair.to || record.zh !== parent.zh) return { ...stats, stale: true };
  if (opts?.expectedRevision !== void 0 && record.revision !== opts.expectedRevision) return { ...stats, stale: true };
  if (opts?.newlines && !validateNewlineAnnotations(record.src, opts.newlines) || opts?.structure && !validRecordStructure(opts.structure)) {
    return {
      ...stats,
      conflict: Math.max(1, stats.total),
      diagnostics: [{ index: -1, src: "", zh: "", ok: false, reason: "validate" }]
    };
  }
  const newlines = opts?.newlines ?? record.newlines;
  const structure = opts?.structure ?? record.structure;
  const draft = { ...record, newlines, structure };
  let groups = opts?.replaceGroups ? [] : [...record.alignments || []];
  const tryAdd = (group, index3, src, zh) => {
    const dup = groups.some(
      (g) => g.sourceStart === group.sourceStart && g.sourceEnd === group.sourceEnd && g.targetStart === group.targetStart && g.targetEnd === group.targetEnd && g.evidence === group.evidence
    );
    if (dup) {
      stats.identical++;
      diagnostics.push({ index: index3, src, zh, ok: true });
      return;
    }
    const next = [...groups, group].sort((a, b) => a.sourceStart - b.sourceStart);
    if (!validateAlignments(draft, next)) {
      stats.conflict++;
      diagnostics.push({ index: index3, src, zh, ok: false, reason: "validate" });
      return;
    }
    groups = next;
    stats.inserted++;
    diagnostics.push({ index: index3, src, zh, ok: true });
  };
  if (opts?.groups?.length) {
    for (let i = 0; i < opts.groups.length; i++) {
      const group = opts.groups[i];
      tryAdd(group, i, record.src.slice(group.sourceStart, group.sourceEnd), record.zh.slice(group.targetStart, group.targetEnd));
    }
  }
  for (let i = 0; i < pairs.length; i++) {
    const [src, zh] = pairs[i];
    if (!src.trim() || !zh.trim()) {
      stats.skipped++;
      diagnostics.push({ index: i, src, zh, ok: false, reason: "empty" });
      continue;
    }
    const source = uniqueSpan(record.src, src, newlines, structure?.source);
    const target2 = uniqueSpan(record.zh, zh, void 0, structure?.target);
    if (!source || !target2) {
      stats.conflict++;
      diagnostics.push({ index: i, src, zh, ok: false, reason: "span" });
      continue;
    }
    tryAdd({ sourceStart: source.start, sourceEnd: source.end, targetStart: target2.start, targetEnd: target2.end, evidence: "verified" }, i, src, zh);
  }
  if (opts?.dryRun) return stats;
  if (stats.conflict > 0 || stats.skipped > 0) return { ...stats, inserted: 0 };
  if (!stats.inserted && !opts?.newlines && !opts?.structure) return stats;
  const ok = index2.setAlignment(record.src, pair, groups, record.revision, { newlines: opts?.newlines, structure: opts?.structure, candidateId: record.candidateId });
  if (!ok) return { ...stats, inserted: 0, stale: true };
  return stats;
}

// services/translate/shared-cache/db.ts
import fs10 from "node:fs";
import path8 from "node:path";
import { DatabaseSync as DatabaseSync4 } from "node:sqlite";

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/query-builders/count.js
var SQLiteCountBuilder = class SQLiteCountBuilder2 extends SQL {
  static [entityKind] = "SQLiteCountBuilder";
  dialect;
  session;
  static buildCount(source, filters, parens) {
    const query = sql`select count(*) from ${source}${sql` where ${filters}`.if(filters)}`;
    return parens ? sql`(${query})` : query;
  }
  constructor(countConfig) {
    super(SQLiteCountBuilder2.buildCount(countConfig.source, countConfig.filters, true).queryChunks);
    this.countConfig = countConfig;
    this.dialect = countConfig.dialect;
    this.session = countConfig.session;
    this.mapWith((e) => {
      if (typeof e === "number") return e;
      return Number(e ?? 0);
    });
  }
  executableSql;
  build() {
    if (!this.executableSql) {
      const { source, filters } = this.countConfig;
      this.executableSql = SQLiteCountBuilder2.buildCount(source, filters);
    }
    return this.dialect.sqlToQuery(this.executableSql);
  }
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/async/count.js
var SQLiteAsyncCountBuilder = class extends SQLiteCountBuilder {
  static [entityKind] = "SQLiteAsyncCountBuilder";
  constructor(countConfig) {
    super(countConfig);
  }
  /** @internal */
  executeRaw(placeholderValues) {
    return this.session.prepareQuery(this.build(), "arrays", false, "all", (rows) => {
      const v = rows[0]?.[0];
      if (typeof v === "number") return v;
      return v ? Number(v) : 0;
    }).execute(placeholderValues);
  }
  async execute(placeholderValues) {
    return await this.executeRaw(placeholderValues);
  }
};
applyMixins(SQLiteAsyncCountBuilder, [QueryPromise]);
var SQLiteSyncCountBuilder = class extends SQLiteAsyncCountBuilder {
  static [entityKind] = "SQLiteSyncCountBuilder";
  sync(placeholderValues) {
    return this.executeRaw(placeholderValues).sync();
  }
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/query-builders/query.js
var RelationalQueryBuilder = class {
  static [entityKind] = "SQLiteRelationalQueryBuilderV2";
  constructor(mode, schema, table, tableConfig, dialect, session, forbidJsonb, builder = SQLiteRelationalQuery) {
    this.mode = mode;
    this.schema = schema;
    this.table = table;
    this.tableConfig = tableConfig;
    this.dialect = dialect;
    this.session = session;
    this.forbidJsonb = forbidJsonb;
    this.builder = builder;
  }
  findMany(config) {
    return new this.builder(this.mode, this.schema, this.table, this.tableConfig, this.dialect, this.session, config ?? true, "many", this.forbidJsonb);
  }
  findFirst(config) {
    return new this.builder(this.mode, this.schema, this.table, this.tableConfig, this.dialect, this.session, config ?? true, "first", this.forbidJsonb);
  }
};
var SQLiteRelationalQuery = class {
  static [entityKind] = "SQLiteRelationalQueryV2";
  /** @internal */
  mode;
  /** @internal */
  table;
  /** @internal */
  resultKind;
  constructor(resultKind, schema, table, tableConfig, dialect, session, config, mode, forbidJsonb) {
    this.schema = schema;
    this.tableConfig = tableConfig;
    this.dialect = dialect;
    this.session = session;
    this.config = config;
    this.forbidJsonb = forbidJsonb;
    this.resultKind = resultKind;
    this.mode = mode;
    this.table = table;
  }
  getSQL() {
    return this._getQuery().sql;
  }
  _getQuery() {
    const jsonb = this.forbidJsonb ? sql`json` : sql`jsonb`;
    return this.dialect.buildRelationalQuery({
      schema: this.schema,
      table: this.table,
      tableConfig: this.tableConfig,
      queryConfig: this.config,
      mode: this.mode,
      jsonb
    });
  }
  _toSQL() {
    const query = this._getQuery();
    return {
      query,
      builtQuery: this.dialect.sqlToQuery(query.sql)
    };
  }
  toSQL() {
    return this._toSQL().builtQuery;
  }
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/async/query.js
var SQLiteAsyncRelationalQuery = class extends SQLiteRelationalQuery {
  static [entityKind] = "SQLiteAsyncRelationalQueryV2";
  /** @internal */
  _prepare(prepare = false) {
    const { query, builtQuery } = this._toSQL();
    const mapper = this.dialect.mapperGenerators.relationalRows({
      isFirst: this.mode === "first",
      parseJson: true,
      parseJsonIfString: false,
      rootJsonMappers: false,
      selection: query.selection,
      arrayModeRoot: true
    });
    return this.session.prepareQuery(builtQuery, "arrays", prepare, "all", mapper);
  }
  prepare() {
    return this._prepare(true);
  }
  async execute(placeholderValues) {
    return this._prepare().execute(placeholderValues);
  }
};
var SQLiteSyncRelationalQuery = class extends SQLiteAsyncRelationalQuery {
  static [entityKind] = "SQLiteSyncRelationalQueryV2";
  sync(placeholderValues) {
    return this._prepare().execute(placeholderValues).sync();
  }
};
applyMixins(SQLiteAsyncRelationalQuery, [QueryPromise]);

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/selection-proxy.js
var SelectionProxyHandler = class SelectionProxyHandler2 {
  static [entityKind] = "SelectionProxyHandler";
  config;
  constructor(config) {
    this.config = { ...config };
  }
  get(subquery, prop) {
    if (prop === "_") return {
      ...subquery["_"],
      selectedFields: new Proxy(subquery._.selectedFields, this)
    };
    if (prop === ViewBaseConfig) return {
      ...subquery[ViewBaseConfig],
      selectedFields: new Proxy(subquery[ViewBaseConfig].selectedFields, this)
    };
    if (typeof prop === "symbol") return subquery[prop];
    const value = (is(subquery, Subquery) ? subquery._.selectedFields : is(subquery, View) ? subquery[ViewBaseConfig].selectedFields : subquery)[prop];
    if (is(value, SQL.Aliased)) {
      if (this.config.sqlAliasedBehavior === "sql" && !value.isSelectionField) return value.sql;
      const newValue = value.clone();
      newValue.isSelectionField = true;
      newValue.origin = this.config.alias;
      return newValue;
    }
    if (is(value, SQL)) {
      if (this.config.sqlBehavior === "sql") return value;
      throw new Error(`You tried to reference "${prop}" field from a subquery, which is a raw SQL field, but it doesn't have an alias declared. Please add an alias to the field using ".as('alias')" method.`);
    }
    if (is(value, Column)) {
      if (this.config.alias) return new Proxy(value, new ColumnTableAliasProxyHandler(new Proxy(value.table, new TableAliasProxyHandler(this.config.alias, this.config.replaceOriginalName ?? false, true)), true));
      return value;
    }
    if (typeof value !== "object" || value === null) return value;
    return new Proxy(value, new SelectionProxyHandler2(this.config));
  }
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/foreign-keys.js
var ForeignKeyBuilder = class {
  static [entityKind] = "SQLiteForeignKeyBuilder";
  /** @internal */
  reference;
  /** @internal */
  _onUpdate;
  /** @internal */
  _onDelete;
  constructor(config, actions) {
    this.reference = () => {
      const { name: name2, columns, foreignColumns } = config();
      return {
        name: name2,
        columns,
        foreignTable: foreignColumns[0].table,
        foreignColumns
      };
    };
    if (actions) {
      this._onUpdate = actions.onUpdate;
      this._onDelete = actions.onDelete;
    }
  }
  onUpdate(action) {
    this._onUpdate = action;
    return this;
  }
  onDelete(action) {
    this._onDelete = action;
    return this;
  }
  /** @internal */
  build(table) {
    return new ForeignKey(table, this);
  }
};
var ForeignKey = class {
  static [entityKind] = "SQLiteForeignKey";
  reference;
  onUpdate;
  onDelete;
  constructor(table, builder) {
    this.table = table;
    this.reference = builder.reference;
    this.onUpdate = builder._onUpdate;
    this.onDelete = builder._onDelete;
  }
  getName() {
    const { name: name2, columns, foreignColumns } = this.reference();
    const columnNames = columns.map((column) => column.name);
    const foreignColumnNames = foreignColumns.map((column) => column.name);
    const chunks = [
      this.table[TableName],
      ...columnNames,
      foreignColumns[0].table[TableName],
      ...foreignColumnNames
    ];
    return name2 ?? `${chunks.join("_")}_fk`;
  }
  isNameExplicit() {
    return !!this.reference().name;
  }
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/columns/common.js
var SQLiteColumnBuilder = class extends ColumnBuilder {
  static [entityKind] = "SQLiteColumnBuilder";
  foreignKeyConfigs = [];
  references(ref, actions = {}) {
    this.foreignKeyConfigs.push({
      ref,
      actions
    });
    return this;
  }
  unique(name2) {
    this.config.isUnique = true;
    this.config.uniqueName = name2;
    return this;
  }
  generatedAlwaysAs(as, config) {
    this.config.generated = {
      as,
      type: "always",
      mode: config?.mode ?? "virtual"
    };
    return this;
  }
  /** @internal */
  buildForeignKeys(column, table) {
    return this.foreignKeyConfigs.map(({ ref, actions }) => {
      return ((ref2, actions2) => {
        const builder = new ForeignKeyBuilder(() => {
          const foreignColumn = ref2();
          return {
            columns: [column],
            foreignColumns: [foreignColumn]
          };
        });
        if (actions2.onUpdate) builder.onUpdate(actions2.onUpdate);
        if (actions2.onDelete) builder.onDelete(actions2.onDelete);
        return builder.build(table);
      })(ref, actions);
    });
  }
};
var SQLiteColumn = class extends Column {
  static [entityKind] = "SQLiteColumn";
  /** @internal */
  table;
  constructor(table, config) {
    super(table, config);
    this.table = table;
  }
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/columns/blob.js
function hexToText(hexString) {
  let result = "";
  for (let i = 0; i < hexString.length; i += 2) {
    const hexPair = hexString.slice(i, i + 2);
    const decimalValue = Number.parseInt(hexPair, 16);
    result += String.fromCodePoint(decimalValue);
  }
  return result;
}
var SQLiteBigIntBuilder = class extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteBigIntBuilder";
  constructor(name2) {
    super(name2, "bigint int64", "SQLiteBigInt");
  }
  /** @internal */
  build(table) {
    return new SQLiteBigInt(table, this.config);
  }
};
var SQLiteBigInt = class extends SQLiteColumn {
  static [entityKind] = "SQLiteBigInt";
  getSQLType() {
    return "blob";
  }
  mapFromDriverValue = (value) => {
    if (typeof value === "string") return BigInt(hexToText(value));
    if (typeof Buffer !== "undefined" && Buffer.from) {
      const buf = Buffer.isBuffer(value) ? value : value instanceof ArrayBuffer ? Buffer.from(value) : value.buffer ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : Buffer.from(value);
      return BigInt(buf.toString("utf8"));
    }
    return BigInt(textDecoder.decode(value));
  };
  mapToDriverValue = (value) => {
    return Buffer.from(value.toString());
  };
};
var SQLiteBlobJsonBuilder = class extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteBlobJsonBuilder";
  constructor(name2) {
    super(name2, "object json", "SQLiteBlobJson");
  }
  /** @internal */
  build(table) {
    return new SQLiteBlobJson(table, this.config);
  }
};
var SQLiteBlobJson = class extends SQLiteColumn {
  static [entityKind] = "SQLiteBlobJson";
  getSQLType() {
    return "blob";
  }
  mapFromDriverValue = (value) => {
    if (typeof value === "string") return JSON.parse(hexToText(value));
    if (typeof Buffer !== "undefined" && Buffer.from) {
      const buf = Buffer.isBuffer(value) ? value : value instanceof ArrayBuffer ? Buffer.from(value) : value.buffer ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : Buffer.from(value);
      return JSON.parse(buf.toString("utf8"));
    }
    return JSON.parse(textDecoder.decode(value));
  };
  mapToDriverValue = (value) => {
    return Buffer.from(JSON.stringify(value));
  };
};
var SQLiteBlobBufferBuilder = class extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteBlobBufferBuilder";
  constructor(name2) {
    super(name2, "object buffer", "SQLiteBlobBuffer");
  }
  /** @internal */
  build(table) {
    return new SQLiteBlobBuffer(table, this.config);
  }
};
var SQLiteBlobBuffer = class extends SQLiteColumn {
  static [entityKind] = "SQLiteBlobBuffer";
  mapFromDriverValue = (value) => {
    if (Buffer.isBuffer(value)) return value;
    if (typeof value === "string") return Buffer.from(value, "hex");
    return Buffer.from(value);
  };
  getSQLType() {
    return "blob";
  }
};
function blob(a, b) {
  const { name: name2, config } = getColumnNameAndConfig(a, b);
  if (config?.mode === "bigint") return new SQLiteBigIntBuilder(name2);
  if (config?.mode === "buffer") return new SQLiteBlobBufferBuilder(name2);
  return new SQLiteBlobJsonBuilder(name2);
}

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/columns/custom.js
var SQLiteCustomColumnBuilder = class extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteCustomColumnBuilder";
  constructor(name2, fieldConfig, customTypeParams) {
    super(name2, "custom", "SQLiteCustomColumn");
    this.config.fieldConfig = fieldConfig;
    this.config.customTypeParams = customTypeParams;
  }
  /** @internal */
  build(table) {
    return new SQLiteCustomColumn(table, this.config);
  }
};
var SQLiteCustomColumn = class extends SQLiteColumn {
  static [entityKind] = "SQLiteCustomColumn";
  sqlName;
  mapTo;
  mapFrom;
  mapJson;
  forJsonSelect;
  constructor(table, config) {
    super(table, config);
    this.sqlName = config.customTypeParams.dataType(config.fieldConfig);
    this.mapTo = config.customTypeParams.toDriver;
    this.mapFrom = config.customTypeParams.fromDriver;
    this.mapJson = config.customTypeParams.fromJson;
    this.forJsonSelect = config.customTypeParams.forJsonSelect;
  }
  getSQLType() {
    return this.sqlName;
  }
  mapFromDriverValue = (value) => {
    return typeof this.mapFrom === "function" ? this.mapFrom(value) : value;
  };
  mapFromJsonValue(value) {
    return typeof this.mapJson === "function" ? this.mapJson(value) : this.mapFromDriverValue(value);
  }
  jsonSelectIdentifier(identifier, sql2) {
    if (typeof this.forJsonSelect === "function") return this.forJsonSelect(identifier, sql2);
    const rawType = this.getSQLType().toLowerCase();
    const parenPos = rawType.indexOf("(");
    switch (parenPos + 1 ? rawType.slice(0, parenPos) : rawType) {
      case "numeric":
      case "decimal":
      case "bigint":
        return sql2`cast(${identifier} as text)`;
      case "blob":
        return sql2`hex(${identifier})`;
      default:
        return identifier;
    }
  }
  mapToDriverValue = (value) => {
    return typeof this.mapTo === "function" ? this.mapTo(value) : value;
  };
};
function customType(customTypeParams) {
  return (a, b) => {
    const { name: name2, config } = getColumnNameAndConfig(a, b);
    return new SQLiteCustomColumnBuilder(name2, config, customTypeParams);
  };
}

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/columns/integer.js
var SQLiteBaseIntegerBuilder = class extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteBaseIntegerBuilder";
  constructor(name2, dataType, columnType) {
    super(name2, dataType, columnType);
    this.config.autoIncrement = false;
  }
  primaryKey(config) {
    if (config?.autoIncrement) this.config.autoIncrement = true;
    this.config.hasDefault = true;
    return super.primaryKey();
  }
};
var SQLiteBaseInteger = class extends SQLiteColumn {
  static [entityKind] = "SQLiteBaseInteger";
  autoIncrement = this.config.autoIncrement;
  getSQLType() {
    return "integer";
  }
};
var SQLiteIntegerBuilder = class extends SQLiteBaseIntegerBuilder {
  static [entityKind] = "SQLiteIntegerBuilder";
  constructor(name2) {
    super(name2, "number int53", "SQLiteInteger");
  }
  build(table) {
    return new SQLiteInteger(table, this.config);
  }
};
var SQLiteInteger = class extends SQLiteBaseInteger {
  static [entityKind] = "SQLiteInteger";
};
var SQLiteTimestampBuilder = class extends SQLiteBaseIntegerBuilder {
  static [entityKind] = "SQLiteTimestampBuilder";
  constructor(name2, mode) {
    super(name2, "object date", "SQLiteTimestamp");
    this.config.mode = mode;
  }
  /**
  * @deprecated Use `default()` with your own expression instead.
  *
  * Adds `DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer))` to the column, which is the current epoch timestamp in milliseconds.
  */
  defaultNow() {
    return this.default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`);
  }
  build(table) {
    return new SQLiteTimestamp(table, this.config);
  }
};
var SQLiteTimestamp = class extends SQLiteBaseInteger {
  static [entityKind] = "SQLiteTimestamp";
  mode = this.config.mode;
  mapFromDriverValue = (value) => {
    if (typeof value === "string") return new Date(value.replaceAll('"', ""));
    if (this.config.mode === "timestamp") return /* @__PURE__ */ new Date(value * 1e3);
    return new Date(value);
  };
  mapToDriverValue = (value) => {
    if (typeof value === "number") return value;
    const unix = value.getTime();
    if (this.config.mode === "timestamp") return Math.floor(unix / 1e3);
    return unix;
  };
};
var SQLiteBooleanBuilder = class extends SQLiteBaseIntegerBuilder {
  static [entityKind] = "SQLiteBooleanBuilder";
  constructor(name2, mode) {
    super(name2, "boolean", "SQLiteBoolean");
    this.config.mode = mode;
  }
  build(table) {
    return new SQLiteBoolean(table, this.config);
  }
};
var SQLiteBoolean = class extends SQLiteBaseInteger {
  static [entityKind] = "SQLiteBoolean";
  mode = this.config.mode;
  mapFromDriverValue = (value) => {
    return Number(value) === 1;
  };
  mapToDriverValue = (value) => {
    return value ? 1 : 0;
  };
};
function integer(a, b) {
  const { name: name2, config } = getColumnNameAndConfig(a, b);
  if (config?.mode === "timestamp" || config?.mode === "timestamp_ms") return new SQLiteTimestampBuilder(name2, config.mode);
  if (config?.mode === "boolean") return new SQLiteBooleanBuilder(name2, config.mode);
  return new SQLiteIntegerBuilder(name2);
}

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/columns/numeric.js
var SQLiteNumericBuilder = class extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteNumericBuilder";
  constructor(name2) {
    super(name2, "string numeric", "SQLiteNumeric");
  }
  /** @internal */
  build(table) {
    return new SQLiteNumeric(table, this.config);
  }
};
var SQLiteNumeric = class extends SQLiteColumn {
  static [entityKind] = "SQLiteNumeric";
  mapFromDriverValue = (value) => {
    if (typeof value === "string") return value;
    return String(value);
  };
  getSQLType() {
    return "numeric";
  }
};
var SQLiteNumericNumberBuilder = class extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteNumericNumberBuilder";
  constructor(name2) {
    super(name2, "number", "SQLiteNumericNumber");
  }
  /** @internal */
  build(table) {
    return new SQLiteNumericNumber(table, this.config);
  }
};
var SQLiteNumericNumber = class extends SQLiteColumn {
  static [entityKind] = "SQLiteNumericNumber";
  mapFromDriverValue = (value) => {
    if (typeof value === "number") return value;
    return Number(value);
  };
  mapToDriverValue = String;
  getSQLType() {
    return "numeric";
  }
};
var SQLiteNumericBigIntBuilder = class extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteNumericBigIntBuilder";
  constructor(name2) {
    super(name2, "bigint int64", "SQLiteNumericBigInt");
  }
  /** @internal */
  build(table) {
    return new SQLiteNumericBigInt(table, this.config);
  }
};
var SQLiteNumericBigInt = class extends SQLiteColumn {
  static [entityKind] = "SQLiteNumericBigInt";
  mapFromDriverValue = BigInt;
  mapToDriverValue = String;
  getSQLType() {
    return "numeric";
  }
};
function numeric(a, b) {
  const { name: name2, config } = getColumnNameAndConfig(a, b);
  const mode = config?.mode;
  return mode === "number" ? new SQLiteNumericNumberBuilder(name2) : mode === "bigint" ? new SQLiteNumericBigIntBuilder(name2) : new SQLiteNumericBuilder(name2);
}

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/columns/real.js
var SQLiteRealBuilder = class extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteRealBuilder";
  constructor(name2) {
    super(name2, "number double", "SQLiteReal");
  }
  /** @internal */
  build(table) {
    return new SQLiteReal(table, this.config);
  }
};
var SQLiteReal = class extends SQLiteColumn {
  static [entityKind] = "SQLiteReal";
  getSQLType() {
    return "real";
  }
};
function real(name2) {
  return new SQLiteRealBuilder(name2 ?? "");
}

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/columns/text.js
var SQLiteTextBuilder = class extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteTextBuilder";
  constructor(name2, config) {
    super(name2, config.enum?.length ? "string enum" : "string", "SQLiteText");
    this.config.enumValues = config.enum;
    this.config.length = config.length;
  }
  /** @internal */
  build(table) {
    return new SQLiteText(table, this.config);
  }
};
var SQLiteText = class extends SQLiteColumn {
  static [entityKind] = "SQLiteText";
  enumValues = this.config.enumValues;
  constructor(table, config) {
    super(table, config);
  }
  getSQLType() {
    return `text${this.config.length ? `(${this.config.length})` : ""}`;
  }
};
var SQLiteTextJsonBuilder = class extends SQLiteColumnBuilder {
  static [entityKind] = "SQLiteTextJsonBuilder";
  constructor(name2) {
    super(name2, "object json", "SQLiteTextJson");
  }
  /** @internal */
  build(table) {
    return new SQLiteTextJson(table, this.config);
  }
};
var SQLiteTextJson = class extends SQLiteColumn {
  static [entityKind] = "SQLiteTextJson";
  getSQLType() {
    return "text";
  }
  mapFromDriverValue = (value) => {
    return JSON.parse(value);
  };
  mapToDriverValue = (value) => {
    return JSON.stringify(value);
  };
};
function text(a, b = {}) {
  const { name: name2, config } = getColumnNameAndConfig(a, b);
  if (config.mode === "json") return new SQLiteTextJsonBuilder(name2);
  return new SQLiteTextBuilder(name2, config);
}

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/columns/all.js
function getSQLiteColumnBuilders() {
  return {
    blob,
    customType,
    integer,
    numeric,
    real,
    text
  };
}

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/casing.js
function toSnakeCase(input) {
  return (input.replace(/['\u2019]/g, "").match(/[\da-z]+|[A-Z]+(?![a-z])|[A-Z][\da-z]+/g) ?? []).map((word) => word.toLowerCase()).join("_");
}
function toCamelCase(input) {
  return (input.replace(/['\u2019]/g, "").match(/[\da-z]+|[A-Z]+(?![a-z])|[A-Z][\da-z]+/g) ?? []).reduce((acc, word, i) => {
    return acc + (i === 0 ? word.toLowerCase() : `${word[0].toUpperCase()}${word.slice(1)}`);
  }, "");
}
function getCasingFn(casing) {
  if (casing === "snake_case") return toSnakeCase;
  if (casing === "camelCase") return toCamelCase;
  return (name2) => name2;
}

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/table.js
var InlineForeignKeys = /* @__PURE__ */ Symbol.for("drizzle:SQLiteInlineForeignKeys");
var SQLiteTable = class extends Table {
  static [entityKind] = "SQLiteTable";
  /** @internal */
  static Symbol = Object.assign({}, Table.Symbol, { InlineForeignKeys });
  /** @internal */
  [Table.Symbol.Columns];
  /** @internal */
  [InlineForeignKeys] = [];
  /** @internal */
  [Table.Symbol.ExtraConfigBuilder] = void 0;
};
function sqliteTableBase(name2, columns, extraConfig, schema, casing, baseName = name2) {
  const casingFn = getCasingFn(casing);
  const rawTable = new SQLiteTable(name2, schema, baseName);
  const parsedColumns = typeof columns === "function" ? columns(getSQLiteColumnBuilders()) : columns;
  const builtColumns = Object.fromEntries(Object.entries(parsedColumns).map(([name3, colBuilderBase]) => {
    const colBuilder = colBuilderBase;
    colBuilder.setName(name3, casingFn);
    const column = colBuilder.build(rawTable).postBuild();
    rawTable[InlineForeignKeys].push(...colBuilder.buildForeignKeys(column, rawTable));
    return [name3, column];
  }));
  const table = Object.assign(rawTable, builtColumns);
  table[Table.Symbol.Columns] = builtColumns;
  table[Table.Symbol.ExtraConfigColumns] = builtColumns;
  if (extraConfig) table[SQLiteTable.Symbol.ExtraConfigBuilder] = extraConfig;
  return table;
}
function sqliteTableWithCasing(casing) {
  return (name2, columns, extraConfig) => sqliteTableBase(name2, columns, extraConfig, void 0, casing);
}
var sqliteTable = sqliteTableWithCasing(void 0);

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/indexes.js
var IndexBuilderOn = class {
  static [entityKind] = "SQLiteIndexBuilderOn";
  constructor(name2, unique) {
    this.name = name2;
    this.unique = unique;
  }
  on(...columns) {
    return new IndexBuilder(this.name, columns, this.unique);
  }
};
var IndexBuilder = class {
  static [entityKind] = "SQLiteIndexBuilder";
  /** @internal */
  config;
  constructor(name2, columns, unique) {
    this.config = {
      name: name2,
      columns,
      unique,
      where: void 0
    };
  }
  /**
  * Condition for partial index.
  */
  where(condition) {
    this.config.where = condition;
    return this;
  }
  /** @internal */
  build(table) {
    return new Index(this.config, table);
  }
};
var Index = class {
  static [entityKind] = "SQLiteIndex";
  config;
  isNameExplicit;
  constructor(config, table) {
    this.config = {
      ...config,
      table
    };
    this.isNameExplicit = !!config.name;
  }
};
function index(name2) {
  return new IndexBuilderOn(name2, false);
}

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/primary-keys.js
function primaryKey(...config) {
  if (config[0].columns) return new PrimaryKeyBuilder(config[0].columns, config[0].name);
  return new PrimaryKeyBuilder(config);
}
var PrimaryKeyBuilder = class {
  static [entityKind] = "SQLitePrimaryKeyBuilder";
  /** @internal */
  columns;
  /** @internal */
  name;
  constructor(columns, name2) {
    this.columns = columns;
    this.name = name2;
  }
  /** @internal */
  build(table) {
    return new PrimaryKey(table, this.columns, this.name);
  }
};
var PrimaryKey = class {
  static [entityKind] = "SQLitePrimaryKey";
  columns;
  name;
  isNameExplicit;
  constructor(table, columns, name2) {
    this.table = table;
    this.columns = columns;
    this.name = name2;
    this.isNameExplicit = !!name2;
  }
  getName() {
    return this.name ?? `${this.table[SQLiteTable.Symbol.Name]}_${this.columns.map((column) => column.name).join("_")}_pk`;
  }
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/utils.js
function extractUsedTable(table) {
  if (is(table, SQLiteTable)) return [`${table[Table.Symbol.BaseName]}`];
  if (is(table, Subquery)) return table._.usedTables ?? [];
  if (is(table, SQL)) return table.usedTables ?? [];
  return [];
}

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/query-builders/delete.js
var SQLiteDeleteBase = class {
  static [entityKind] = "SQLiteDelete";
  /** @internal */
  config;
  constructor(table, session, dialect, withList) {
    this.table = table;
    this.session = session;
    this.dialect = dialect;
    this.config = {
      table,
      withList
    };
  }
  /**
  * Adds a `where` clause to the query.
  *
  * Calling this method will delete only those rows that fulfill a specified condition.
  *
  * See docs: {@link https://orm.drizzle.team/docs/delete}
  *
  * @param where the `where` clause.
  *
  * @example
  * You can use conditional operators and `sql function` to filter the rows to be deleted.
  *
  * ```ts
  * // Delete all cars with green color
  * db.delete(cars).where(eq(cars.color, 'green'));
  * // or
  * db.delete(cars).where(sql`${cars.color} = 'green'`)
  * ```
  *
  * You can logically combine conditional operators with `and()` and `or()` operators:
  *
  * ```ts
  * // Delete all BMW cars with a green color
  * db.delete(cars).where(and(eq(cars.color, 'green'), eq(cars.brand, 'BMW')));
  *
  * // Delete all cars with the green or blue color
  * db.delete(cars).where(or(eq(cars.color, 'green'), eq(cars.color, 'blue')));
  * ```
  */
  where(where) {
    this.config.where = where;
    return this;
  }
  orderBy(...columns) {
    if (typeof columns[0] === "function") {
      const orderBy = columns[0](new Proxy(this.config.table[Table.Symbol.Columns], new SelectionProxyHandler({
        sqlAliasedBehavior: "alias",
        sqlBehavior: "sql"
      })));
      const orderByArray = Array.isArray(orderBy) ? orderBy : [orderBy];
      this.config.orderBy = orderByArray;
    } else {
      const orderByArray = columns;
      this.config.orderBy = orderByArray;
    }
    return this;
  }
  limit(limit) {
    this.config.limit = limit;
    return this;
  }
  returning(fields2 = this.table[SQLiteTable.Symbol.Columns]) {
    this.config.returning = orderSelectedFields(fields2);
    return this;
  }
  getSQL() {
    return this.dialect.buildDeleteQuery(this.config);
  }
  toSQL() {
    return this.dialect.sqlToQuery(this.getSQL());
  }
  $dynamic() {
    return this;
  }
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/async/delete.js
var SQLiteAsyncDeleteBase = class extends SQLiteDeleteBase {
  static [entityKind] = "SQLiteAsyncDelete";
  /** @internal */
  _prepare(prepare = false) {
    return this.session.prepareQuery(this.dialect.sqlToQuery(this.getSQL()), "arrays", prepare, this.config.returning ? "all" : "run", this.config.returning ? this.dialect.mapperGenerators.rows(this.config.returning, void 0) : void 0, {
      type: "delete",
      tables: extractUsedTable(this.config.table)
    });
  }
  prepare() {
    return this._prepare(true);
  }
  run = (placeholderValues) => {
    return this._prepare().run(placeholderValues);
  };
  all = (placeholderValues) => {
    return this._prepare().all(placeholderValues);
  };
  get = (placeholderValues) => {
    return this._prepare().get(placeholderValues);
  };
  values = (placeholderValues) => {
    return this._prepare().values(placeholderValues);
  };
  async execute(placeholderValues) {
    return this._prepare().execute(placeholderValues);
  }
};
applyMixins(SQLiteAsyncDeleteBase, [QueryPromise]);

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/view-base.js
var SQLiteViewBase = class extends View {
  static [entityKind] = "SQLiteViewBase";
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/query-builders/query-builder.js
var TypedQueryBuilder = class {
  static [entityKind] = "TypedQueryBuilder";
  /** @internal */
  getSelectedFields() {
    return this._.selectedFields;
  }
  /** @internal */
  withoutSelectionCastCodecs() {
    return this;
  }
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/query-builders/select.js
var SQLiteSelectBuilder = class {
  static [entityKind] = "SQLiteSelectBuilder";
  fields;
  session;
  dialect;
  withList;
  distinct;
  constructor(config, builder = SQLiteSelectBase) {
    this.builder = builder;
    this.fields = config.fields;
    this.session = config.session;
    this.dialect = config.dialect;
    this.withList = config.withList;
    this.distinct = config.distinct;
  }
  from(source) {
    const isPartialSelect = !!this.fields;
    let fields2;
    if (this.fields) fields2 = this.fields;
    else if (is(source, Subquery)) fields2 = Object.fromEntries(Object.keys(source._.selectedFields).map((key2) => [key2, source[key2]]));
    else if (is(source, SQLiteViewBase)) fields2 = source[ViewBaseConfig].selectedFields;
    else if (is(source, SQL)) fields2 = {};
    else fields2 = getTableColumns(source);
    return new this.builder({
      table: source,
      fields: fields2,
      isPartialSelect,
      session: this.session,
      dialect: this.dialect,
      withList: this.withList ?? [],
      distinct: this.distinct
    });
  }
};
var SQLiteSelectBase = class extends TypedQueryBuilder {
  static [entityKind] = "SQLiteSelectQueryBuilder";
  _;
  /** @internal */
  config;
  joinsNotNullableMap;
  tableName;
  isPartialSelect;
  session;
  dialect;
  cacheConfig = void 0;
  usedTables = /* @__PURE__ */ new Set();
  constructor({ table, fields: fields2, isPartialSelect, session, dialect, withList, distinct }) {
    super();
    this.config = {
      withList,
      table,
      fields: { ...fields2 },
      distinct,
      setOperators: []
    };
    this.isPartialSelect = isPartialSelect;
    this.session = session;
    this.dialect = dialect;
    this._ = {
      selectedFields: fields2,
      config: this.config
    };
    this.tableName = getTableLikeName(table);
    this.joinsNotNullableMap = typeof this.tableName === "string" ? { [this.tableName]: true } : {};
    for (const item of extractUsedTable(table)) this.usedTables.add(item);
  }
  /** @internal */
  getUsedTables() {
    return [...this.usedTables];
  }
  createJoin(joinType) {
    return (table, on) => {
      const baseTableName = this.tableName;
      const tableName = getTableLikeName(table);
      for (const item of extractUsedTable(table)) this.usedTables.add(item);
      if (typeof tableName === "string" && this.config.joins?.some((join2) => join2.alias === tableName)) throw new Error(`Alias "${tableName}" is already used in this query`);
      if (!this.isPartialSelect) {
        if (Object.keys(this.joinsNotNullableMap).length === 1 && typeof baseTableName === "string") this.config.fields = { [baseTableName]: this.config.fields };
        if (typeof tableName === "string" && !is(table, SQL)) {
          const selection = is(table, Subquery) ? table._.selectedFields : is(table, View) ? table[ViewBaseConfig].selectedFields : table[Table.Symbol.Columns];
          this.config.fields[tableName] = selection;
        }
      }
      if (typeof on === "function") on = on(new Proxy(this.config.fields, new SelectionProxyHandler({
        sqlAliasedBehavior: "sql",
        sqlBehavior: "sql"
      })));
      if (!this.config.joins) this.config.joins = [];
      this.config.joins.push({
        on,
        table,
        joinType,
        alias: tableName
      });
      if (typeof tableName === "string") switch (joinType) {
        case "left":
          this.joinsNotNullableMap[tableName] = false;
          break;
        case "right":
          this.joinsNotNullableMap = Object.fromEntries(Object.entries(this.joinsNotNullableMap).map(([key2]) => [key2, false]));
          this.joinsNotNullableMap[tableName] = true;
          break;
        case "cross":
        case "inner":
          this.joinsNotNullableMap[tableName] = true;
          break;
        case "full":
          this.joinsNotNullableMap = Object.fromEntries(Object.entries(this.joinsNotNullableMap).map(([key2]) => [key2, false]));
          this.joinsNotNullableMap[tableName] = false;
          break;
      }
      return this;
    };
  }
  /**
  * Executes a `left join` operation by adding another table to the current query.
  *
  * Calling this method associates each row of the table with the corresponding row from the joined table, if a match is found. If no matching row exists, it sets all columns of the joined table to null.
  *
  * See docs: {@link https://orm.drizzle.team/docs/joins#left-join}
  *
  * @param table the table to join.
  * @param on the `on` clause.
  *
  * @example
  *
  * ```ts
  * // Select all users and their pets
  * const usersWithPets: { user: User; pets: Pet | null; }[] = await db.select()
  *   .from(users)
  *   .leftJoin(pets, eq(users.id, pets.ownerId))
  *
  * // Select userId and petId
  * const usersIdsAndPetIds: { userId: number; petId: number | null; }[] = await db.select({
  *   userId: users.id,
  *   petId: pets.id,
  * })
  *   .from(users)
  *   .leftJoin(pets, eq(users.id, pets.ownerId))
  * ```
  */
  leftJoin = this.createJoin("left");
  /**
  * Executes a `right join` operation by adding another table to the current query.
  *
  * Calling this method associates each row of the joined table with the corresponding row from the main table, if a match is found. If no matching row exists, it sets all columns of the main table to null.
  *
  * See docs: {@link https://orm.drizzle.team/docs/joins#right-join}
  *
  * @param table the table to join.
  * @param on the `on` clause.
  *
  * @example
  *
  * ```ts
  * // Select all users and their pets
  * const usersWithPets: { user: User | null; pets: Pet; }[] = await db.select()
  *   .from(users)
  *   .rightJoin(pets, eq(users.id, pets.ownerId))
  *
  * // Select userId and petId
  * const usersIdsAndPetIds: { userId: number | null; petId: number; }[] = await db.select({
  *   userId: users.id,
  *   petId: pets.id,
  * })
  *   .from(users)
  *   .rightJoin(pets, eq(users.id, pets.ownerId))
  * ```
  */
  rightJoin = this.createJoin("right");
  /**
  * Executes an `inner join` operation, creating a new table by combining rows from two tables that have matching values.
  *
  * Calling this method retrieves rows that have corresponding entries in both joined tables. Rows without matching entries in either table are excluded, resulting in a table that includes only matching pairs.
  *
  * See docs: {@link https://orm.drizzle.team/docs/joins#inner-join}
  *
  * @param table the table to join.
  * @param on the `on` clause.
  *
  * @example
  *
  * ```ts
  * // Select all users and their pets
  * const usersWithPets: { user: User; pets: Pet; }[] = await db.select()
  *   .from(users)
  *   .innerJoin(pets, eq(users.id, pets.ownerId))
  *
  * // Select userId and petId
  * const usersIdsAndPetIds: { userId: number; petId: number; }[] = await db.select({
  *   userId: users.id,
  *   petId: pets.id,
  * })
  *   .from(users)
  *   .innerJoin(pets, eq(users.id, pets.ownerId))
  * ```
  */
  innerJoin = this.createJoin("inner");
  /**
  * Executes a `full join` operation by combining rows from two tables into a new table.
  *
  * Calling this method retrieves all rows from both main and joined tables, merging rows with matching values and filling in `null` for non-matching columns.
  *
  * See docs: {@link https://orm.drizzle.team/docs/joins#full-join}
  *
  * @param table the table to join.
  * @param on the `on` clause.
  *
  * @example
  *
  * ```ts
  * // Select all users and their pets
  * const usersWithPets: { user: User | null; pets: Pet | null; }[] = await db.select()
  *   .from(users)
  *   .fullJoin(pets, eq(users.id, pets.ownerId))
  *
  * // Select userId and petId
  * const usersIdsAndPetIds: { userId: number | null; petId: number | null; }[] = await db.select({
  *   userId: users.id,
  *   petId: pets.id,
  * })
  *   .from(users)
  *   .fullJoin(pets, eq(users.id, pets.ownerId))
  * ```
  */
  fullJoin = this.createJoin("full");
  /**
  * Executes a `cross join` operation by combining rows from two tables into a new table.
  *
  * Calling this method retrieves all rows from both main and joined tables, merging all rows from each table.
  *
  * See docs: {@link https://orm.drizzle.team/docs/joins#cross-join}
  *
  * @param table the table to join.
  *
  * @example
  *
  * ```ts
  * // Select all users, each user with every pet
  * const usersWithPets: { user: User; pets: Pet; }[] = await db.select()
  *   .from(users)
  *   .crossJoin(pets)
  *
  * // Select userId and petId
  * const usersIdsAndPetIds: { userId: number; petId: number; }[] = await db.select({
  *   userId: users.id,
  *   petId: pets.id,
  * })
  *   .from(users)
  *   .crossJoin(pets)
  * ```
  */
  crossJoin = this.createJoin("cross");
  createSetOperator(type, isAll) {
    return (rightSelection) => {
      const rightSelect = typeof rightSelection === "function" ? rightSelection(getSQLiteSetOperators()) : rightSelection;
      if (!haveSameKeys(this.getSelectedFields(), rightSelect.getSelectedFields())) throw new Error("Set operator error (union / intersect / except): selected fields are not the same or are in a different order");
      this.config.setOperators.push({
        type,
        isAll,
        rightSelect
      });
      return this;
    };
  }
  /**
  * Adds `union` set operator to the query.
  *
  * Calling this method will combine the result sets of the `select` statements and remove any duplicate rows that appear across them.
  *
  * See docs: {@link https://orm.drizzle.team/docs/set-operations#union}
  *
  * @example
  *
  * ```ts
  * // Select all unique names from customers and users tables
  * await db.select({ name: users.name })
  *   .from(users)
  *   .union(
  *     db.select({ name: customers.name }).from(customers)
  *   );
  * // or
  * import { union } from 'drizzle-orm/sqlite-core'
  *
  * await union(
  *   db.select({ name: users.name }).from(users),
  *   db.select({ name: customers.name }).from(customers)
  * );
  * ```
  */
  union = this.createSetOperator("union", false);
  /**
  * Adds `union all` set operator to the query.
  *
  * Calling this method will combine the result-set of the `select` statements and keep all duplicate rows that appear across them.
  *
  * See docs: {@link https://orm.drizzle.team/docs/set-operations#union-all}
  *
  * @example
  *
  * ```ts
  * // Select all transaction ids from both online and in-store sales
  * await db.select({ transaction: onlineSales.transactionId })
  *   .from(onlineSales)
  *   .unionAll(
  *     db.select({ transaction: inStoreSales.transactionId }).from(inStoreSales)
  *   );
  * // or
  * import { unionAll } from 'drizzle-orm/sqlite-core'
  *
  * await unionAll(
  *   db.select({ transaction: onlineSales.transactionId }).from(onlineSales),
  *   db.select({ transaction: inStoreSales.transactionId }).from(inStoreSales)
  * );
  * ```
  */
  unionAll = this.createSetOperator("union", true);
  /**
  * Adds `intersect` set operator to the query.
  *
  * Calling this method will retain only the rows that are present in both result sets and eliminate duplicates.
  *
  * See docs: {@link https://orm.drizzle.team/docs/set-operations#intersect}
  *
  * @example
  *
  * ```ts
  * // Select course names that are offered in both departments A and B
  * await db.select({ courseName: depA.courseName })
  *   .from(depA)
  *   .intersect(
  *     db.select({ courseName: depB.courseName }).from(depB)
  *   );
  * // or
  * import { intersect } from 'drizzle-orm/sqlite-core'
  *
  * await intersect(
  *   db.select({ courseName: depA.courseName }).from(depA),
  *   db.select({ courseName: depB.courseName }).from(depB)
  * );
  * ```
  */
  intersect = this.createSetOperator("intersect", false);
  /**
  * Adds `except` set operator to the query.
  *
  * Calling this method will retrieve all unique rows from the left query, except for the rows that are present in the result set of the right query.
  *
  * See docs: {@link https://orm.drizzle.team/docs/set-operations#except}
  *
  * @example
  *
  * ```ts
  * // Select all courses offered in department A but not in department B
  * await db.select({ courseName: depA.courseName })
  *   .from(depA)
  *   .except(
  *     db.select({ courseName: depB.courseName }).from(depB)
  *   );
  * // or
  * import { except } from 'drizzle-orm/sqlite-core'
  *
  * await except(
  *   db.select({ courseName: depA.courseName }).from(depA),
  *   db.select({ courseName: depB.courseName }).from(depB)
  * );
  * ```
  */
  except = this.createSetOperator("except", false);
  /** @internal */
  addSetOperators(setOperators) {
    this.config.setOperators.push(...setOperators);
    return this;
  }
  /**
  * Adds a `where` clause to the query.
  *
  * Calling this method will select only those rows that fulfill a specified condition.
  *
  * See docs: {@link https://orm.drizzle.team/docs/select#filtering}
  *
  * @param where the `where` clause.
  *
  * @example
  * You can use conditional operators and `sql function` to filter the rows to be selected.
  *
  * ```ts
  * // Select all cars with green color
  * await db.select().from(cars).where(eq(cars.color, 'green'));
  * // or
  * await db.select().from(cars).where(sql`${cars.color} = 'green'`)
  * ```
  *
  * You can logically combine conditional operators with `and()` and `or()` operators:
  *
  * ```ts
  * // Select all BMW cars with a green color
  * await db.select().from(cars).where(and(eq(cars.color, 'green'), eq(cars.brand, 'BMW')));
  *
  * // Select all cars with the green or blue color
  * await db.select().from(cars).where(or(eq(cars.color, 'green'), eq(cars.color, 'blue')));
  * ```
  */
  where(where) {
    if (typeof where === "function") where = where(new Proxy(this.config.fields, new SelectionProxyHandler({
      sqlAliasedBehavior: "sql",
      sqlBehavior: "sql"
    })));
    this.config.where = where;
    return this;
  }
  /**
  * Adds a `having` clause to the query.
  *
  * Calling this method will select only those rows that fulfill a specified condition. It is typically used with aggregate functions to filter the aggregated data based on a specified condition.
  *
  * See docs: {@link https://orm.drizzle.team/docs/select#aggregations}
  *
  * @param having the `having` clause.
  *
  * @example
  *
  * ```ts
  * // Select all brands with more than one car
  * await db.select({
  * 	brand: cars.brand,
  * 	count: sql<number>`cast(count(${cars.id}) as int)`,
  * })
  *   .from(cars)
  *   .groupBy(cars.brand)
  *   .having(({ count }) => gt(count, 1));
  * ```
  */
  having(having) {
    if (typeof having === "function") having = having(new Proxy(this.config.fields, new SelectionProxyHandler({
      sqlAliasedBehavior: "sql",
      sqlBehavior: "sql"
    })));
    this.config.having = having;
    return this;
  }
  groupBy(...columns) {
    if (typeof columns[0] === "function") {
      const groupBy = columns[0](new Proxy(this.config.fields, new SelectionProxyHandler({
        sqlAliasedBehavior: "alias",
        sqlBehavior: "sql"
      })));
      this.config.groupBy = Array.isArray(groupBy) ? groupBy : [groupBy];
    } else this.config.groupBy = columns;
    return this;
  }
  orderBy(...columns) {
    if (typeof columns[0] === "function") {
      const orderBy = columns[0](new Proxy(this.config.fields, new SelectionProxyHandler({
        sqlAliasedBehavior: "alias",
        sqlBehavior: "sql"
      })));
      const orderByArray = Array.isArray(orderBy) ? orderBy : [orderBy];
      if (this.config.setOperators.length > 0) this.config.setOperators.at(-1).orderBy = orderByArray;
      else this.config.orderBy = orderByArray;
    } else {
      const orderByArray = columns;
      if (this.config.setOperators.length > 0) this.config.setOperators.at(-1).orderBy = orderByArray;
      else this.config.orderBy = orderByArray;
    }
    return this;
  }
  /**
  * Adds a `limit` clause to the query.
  *
  * Calling this method will set the maximum number of rows that will be returned by this query.
  *
  * See docs: {@link https://orm.drizzle.team/docs/select#limit--offset}
  *
  * @param limit the `limit` clause.
  *
  * @example
  *
  * ```ts
  * // Get the first 10 people from this query.
  * await db.select().from(people).limit(10);
  * ```
  */
  limit(limit) {
    if (this.config.setOperators.length > 0) this.config.setOperators.at(-1).limit = limit;
    else this.config.limit = limit;
    return this;
  }
  /**
  * Adds an `offset` clause to the query.
  *
  * Calling this method will skip a number of rows when returning results from this query.
  *
  * See docs: {@link https://orm.drizzle.team/docs/select#limit--offset}
  *
  * @param offset the `offset` clause.
  *
  * @example
  *
  * ```ts
  * // Get the 10th-20th people from this query.
  * await db.select().from(people).offset(10).limit(10);
  * ```
  */
  offset(offset) {
    if (this.config.setOperators.length > 0) this.config.setOperators.at(-1).offset = offset;
    else this.config.offset = offset;
    return this;
  }
  $withCache(config) {
    this.cacheConfig = config === void 0 ? {
      config: {},
      enabled: true,
      autoInvalidate: true
    } : config === false ? { enabled: false } : {
      enabled: true,
      autoInvalidate: true,
      ...config
    };
    return this;
  }
  getSQL() {
    this.config.fieldsFlat = orderSelectedFields(this.config.fields);
    return this.dialect.buildSelectQuery(this.config);
  }
  toSQL() {
    return this.dialect.sqlToQuery(this.getSQL());
  }
  as(alias) {
    const usedTables = [];
    usedTables.push(...extractUsedTable(this.config.table));
    if (this.config.joins) for (const it of this.config.joins) usedTables.push(...extractUsedTable(it.table));
    return new Proxy(new Subquery(this.getSQL(), this.config.fields, alias, false, [...new Set(usedTables)]), new SelectionProxyHandler({
      alias,
      sqlAliasedBehavior: "alias",
      sqlBehavior: "error"
    }));
  }
  /** @internal */
  getSelectedFields() {
    return new Proxy(this.config.fields, new SelectionProxyHandler({
      alias: this.tableName,
      sqlAliasedBehavior: "alias",
      sqlBehavior: "error"
    }));
  }
  /** @internal */
  withoutSelectionCastCodecs() {
    return this;
  }
  $dynamic() {
    return this;
  }
};
function createSetOperator(type, isAll) {
  return (leftSelect, rightSelect, ...restSelects) => {
    const setOperators = [rightSelect, ...restSelects].map((select) => ({
      type,
      isAll,
      rightSelect: select
    }));
    for (const setOperator of setOperators) if (!haveSameKeys(leftSelect.getSelectedFields(), setOperator.rightSelect.getSelectedFields())) throw new Error("Set operator error (union / intersect / except): selected fields are not the same or are in a different order");
    return leftSelect.addSetOperators(setOperators);
  };
}
var getSQLiteSetOperators = () => ({
  union,
  unionAll,
  intersect,
  except
});
var union = createSetOperator("union", false);
var unionAll = createSetOperator("union", true);
var intersect = createSetOperator("intersect", false);
var except = createSetOperator("except", false);

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/dialect.js
var SQLiteDialect = class {
  static [entityKind] = "SQLiteDialect";
  mapperGenerators;
  constructor(config) {
    this.mapperGenerators = config?.useJitMappers ? {
      rows: makeJitQueryMapper,
      relationalRows: makeJitRqbMapper
    } : {
      rows: makeDefaultQueryMapper,
      relationalRows: makeDefaultRqbMapper
    };
  }
  escapeName(name2) {
    return `"${name2.replace(/"/g, '""')}"`;
  }
  escapeParam(_num) {
    return "?";
  }
  escapeString(str) {
    return `'${str.replace(/'/g, "''")}'`;
  }
  buildWithCTE(queries) {
    if (!queries?.length) return void 0;
    const withSqlChunks = [sql`with `];
    for (const [i, w] of queries.entries()) {
      withSqlChunks.push(sql`${sql.identifier(w._.alias)} as (${w._.sql})`);
      if (i < queries.length - 1) withSqlChunks.push(sql`, `);
    }
    withSqlChunks.push(sql` `);
    return sql.join(withSqlChunks);
  }
  buildDeleteQuery({ table, where, returning, withList, limit, orderBy }) {
    const withSql = this.buildWithCTE(withList);
    const returningSql = returning ? sql` returning ${this.buildSelection(returning, { isSingleTable: true })}` : void 0;
    return sql`${withSql}delete from ${table}${where ? sql` where ${where}` : void 0}${returningSql}${this.buildOrderBy(orderBy)}${this.buildLimit(limit)}`;
  }
  buildUpdateSet(table, set) {
    const tableColumns2 = table[Table.Symbol.Columns];
    const columnNames = Object.keys(tableColumns2).filter((colName) => set[colName] !== void 0 || tableColumns2[colName]?.onUpdateFn !== void 0);
    const setLength = columnNames.length;
    return sql.join(columnNames.flatMap((colName, i) => {
      const col = tableColumns2[colName];
      const onUpdateFnResult = col.onUpdateFn?.();
      const value = set[colName] ?? (is(onUpdateFnResult, SQL) ? onUpdateFnResult : sql.param(onUpdateFnResult, col));
      const res = sql`${sql.identifier(col.name)} = ${value}`;
      if (i < setLength - 1) return [res, sql.raw(", ")];
      return [res];
    }));
  }
  buildUpdateQuery({ table, set, where, returning, withList, joins, from, limit, orderBy }) {
    const withSql = this.buildWithCTE(withList);
    const setSql = this.buildUpdateSet(table, set);
    const fromSql = from && sql.join([sql.raw(" from "), this.buildFromTable(from)]);
    const joinsSql = this.buildJoins(joins);
    const returningSql = returning ? sql` returning ${this.buildSelection(returning, { isSingleTable: true })}` : void 0;
    return sql`${withSql}update ${table} set ${setSql}${fromSql}${joinsSql}${where ? sql` where ${where}` : void 0}${returningSql}${this.buildOrderBy(orderBy)}${this.buildLimit(limit)}`;
  }
  /**
  * Builds selection SQL with provided fields/expressions
  *
  * Examples:
  *
  * `select <selection> from`
  *
  * `insert ... returning <selection>`
  *
  * If `isSingleTable` is true, then columns won't be prefixed with table name
  */
  buildSelection(fields2, { isSingleTable = false } = {}) {
    const columnsLen = fields2.length;
    const chunks = fields2.flatMap(({ field }, i) => {
      const chunk = [];
      if (is(field, SQL.Aliased)) if (field.isSelectionField) {
        if (!isSingleTable && field.origin !== void 0) chunk.push(sql.identifier(field.origin), sql.raw("."));
        chunk.push(sql.identifier(field.fieldAlias));
      } else {
        const query = field.sql;
        if (isSingleTable) {
          const newSql = new SQL(query.queryChunks.map((c) => {
            if (is(c, Column)) return sql.identifier(c.name);
            return c;
          }));
          chunk.push(query.shouldInlineParams ? newSql.inlineParams() : newSql);
        } else chunk.push(query);
        chunk.push(sql` as ${sql.identifier(field.fieldAlias)}`);
      }
      else if (is(field, SQL)) {
        const query = field;
        if (isSingleTable) {
          const newSql = new SQL(query.queryChunks.map((c) => {
            if (is(c, Column)) return sql.identifier(c.name);
            return c;
          }));
          chunk.push(query.shouldInlineParams ? newSql.inlineParams() : newSql);
        } else chunk.push(query);
      } else if (is(field, Column)) if (field.columnType === "SQLiteNumericBigInt" || field.columnType === "SQLiteNumeric") if (isSingleTable) chunk.push(field.isAlias ? sql`cast(${sql.identifier(getOriginalColumnFromAlias(field).name)} as text) as ${field}` : sql`cast(${sql.identifier(field.name)} as text)`);
      else chunk.push(field.isAlias ? sql`cast(${getOriginalColumnFromAlias(field)} as text) as ${field}` : sql`cast(${field} as text)`);
      else if (isSingleTable) chunk.push(field.isAlias ? sql`${sql.identifier(getOriginalColumnFromAlias(field).name)} as ${field}` : sql.identifier(field.name));
      else chunk.push(field.isAlias ? sql`${getOriginalColumnFromAlias(field)} as ${field}` : field);
      else if (is(field, Subquery)) if (!field._.isWith) chunk.push(sql`(${field._.sql}) ${sql.identifier(field._.alias)}`);
      else chunk.push(field);
      if (i < columnsLen - 1) chunk.push(sql`, `);
      return chunk;
    });
    return sql.join(chunks);
  }
  buildJoins(joins) {
    if (!joins || joins.length === 0) return;
    const joinsArray = [];
    if (joins) for (const [index2, joinMeta] of joins.entries()) {
      if (index2 === 0) joinsArray.push(sql` `);
      const table = joinMeta.table;
      const onSql = joinMeta.on ? sql` on ${joinMeta.on}` : void 0;
      if (is(table, SQLiteTable)) {
        const tableName = table[SQLiteTable.Symbol.Name];
        const tableSchema = table[SQLiteTable.Symbol.Schema];
        const origTableName = table[SQLiteTable.Symbol.OriginalName];
        const alias = tableName === origTableName ? void 0 : joinMeta.alias;
        joinsArray.push(sql`${sql.raw(joinMeta.joinType)} join ${tableSchema ? sql`${sql.identifier(tableSchema)}.` : void 0}${sql.identifier(origTableName)}${alias && sql` ${sql.identifier(alias)}`}${onSql}`);
      } else joinsArray.push(sql`${sql.raw(joinMeta.joinType)} join ${table}${onSql}`);
      if (index2 < joins.length - 1) joinsArray.push(sql` `);
    }
    return sql.join(joinsArray);
  }
  buildLimit(limit) {
    return typeof limit === "object" || typeof limit === "number" && limit >= 0 ? sql` limit ${limit}` : void 0;
  }
  buildOrderBy(orderBy) {
    const orderByList = [];
    if (orderBy) for (const [index2, orderByValue] of orderBy.entries()) {
      orderByList.push(orderByValue);
      if (index2 < orderBy.length - 1) orderByList.push(sql`, `);
    }
    return orderByList.length > 0 ? sql` order by ${sql.join(orderByList)}` : void 0;
  }
  buildFromTable(table) {
    if (is(table, Table) && table[Table.Symbol.IsAlias]) return sql`${sql`${sql.identifier(table[Table.Symbol.Schema] ?? "")}.`.if(table[Table.Symbol.Schema])}${sql.identifier(table[Table.Symbol.OriginalName])} ${sql.identifier(table[Table.Symbol.Name])}`;
    if (is(table, View) && table[ViewBaseConfig].isAlias) {
      let fullName = sql`${sql.identifier(table[ViewBaseConfig].originalName)}`;
      if (table[ViewBaseConfig].schema) fullName = sql`${sql.identifier(table[ViewBaseConfig].schema)}.${fullName}`;
      return sql`${fullName} ${sql.identifier(table[ViewBaseConfig].name)}`;
    }
    return table;
  }
  buildSelectQuery({ withList, fields: fields2, fieldsFlat, where, having, table, joins, orderBy, groupBy, limit, offset, distinct, setOperators }) {
    const fieldsList = fieldsFlat ?? orderSelectedFields(fields2);
    for (const f of fieldsList) if (is(f.field, Column) && getTableName(f.field.table) !== (is(table, Subquery) ? table._.alias : is(table, SQLiteViewBase) ? table[ViewBaseConfig].name : is(table, SQL) ? void 0 : getTableName(table)) && !((table2) => joins?.some(({ alias }) => alias === (table2[Table.Symbol.IsAlias] ? getTableName(table2) : table2[Table.Symbol.BaseName])))(f.field.table)) {
      const tableName = getTableName(f.field.table);
      throw new Error(`Your "${f.path.join("->")}" field references a column "${tableName}"."${f.field.name}", but the table "${tableName}" is not part of the query! Did you forget to join it?`);
    }
    const isSingleTable = !joins || joins.length === 0;
    const withSql = this.buildWithCTE(withList);
    const distinctSql = distinct ? sql` distinct` : void 0;
    const selection = this.buildSelection(fieldsList, { isSingleTable });
    const tableSql = this.buildFromTable(table);
    const joinsSql = this.buildJoins(joins);
    const whereSql = where ? sql` where ${where}` : void 0;
    const havingSql = having ? sql` having ${having}` : void 0;
    const groupByList = [];
    if (groupBy) for (const [index2, groupByValue] of groupBy.entries()) {
      groupByList.push(groupByValue);
      if (index2 < groupBy.length - 1) groupByList.push(sql`, `);
    }
    const finalQuery = sql`${withSql}select${distinctSql} ${selection} from ${tableSql}${joinsSql}${whereSql}${groupByList.length > 0 ? sql` group by ${sql.join(groupByList)}` : void 0}${havingSql}${this.buildOrderBy(orderBy)}${this.buildLimit(limit)}${offset ? sql` offset ${offset}` : void 0}`;
    if (setOperators.length > 0) return this.buildSetOperations(finalQuery, setOperators);
    return finalQuery;
  }
  buildSetOperations(leftSelect, setOperators) {
    const [setOperator, ...rest] = setOperators;
    if (!setOperator) throw new Error("Cannot pass undefined values to any set operator");
    if (rest.length === 0) return this.buildSetOperationQuery({
      leftSelect,
      setOperator
    });
    return this.buildSetOperations(this.buildSetOperationQuery({
      leftSelect,
      setOperator
    }), rest);
  }
  buildSetOperationQuery({ leftSelect, setOperator: { type, isAll, rightSelect, limit, orderBy, offset } }) {
    const leftChunk = sql`${leftSelect.getSQL()} `;
    const rightChunk = sql`${rightSelect.getSQL()}`;
    let orderBySql;
    if (orderBy && orderBy.length > 0) {
      const orderByValues = [];
      for (const singleOrderBy of orderBy) if (is(singleOrderBy, SQLiteColumn)) orderByValues.push(sql.identifier(singleOrderBy.name));
      else if (is(singleOrderBy, SQL)) {
        for (let i = 0; i < singleOrderBy.queryChunks.length; i++) {
          const chunk = singleOrderBy.queryChunks[i];
          if (is(chunk, SQLiteColumn)) singleOrderBy.queryChunks[i] = sql.identifier(chunk.name);
        }
        orderByValues.push(sql`${singleOrderBy}`);
      } else orderByValues.push(sql`${singleOrderBy}`);
      orderBySql = sql` order by ${sql.join(orderByValues, sql`, `)}`;
    }
    const limitSql = typeof limit === "object" || typeof limit === "number" && limit >= 0 ? sql` limit ${limit}` : void 0;
    const operatorChunk = sql.raw(`${type} ${isAll ? "all " : ""}`);
    const offsetSql = offset ? sql` offset ${offset}` : void 0;
    return sql`${leftChunk}${operatorChunk}${rightChunk}${orderBySql}${limitSql}${offsetSql}`;
  }
  buildInsertQuery({ table, values: valuesOrSelect, onConflict, returning, withList, select }) {
    const valuesSqlList = [];
    const columns = table[Table.Symbol.Columns];
    const colEntries = Object.entries(columns);
    const colEntriesFiltered = select && !is(valuesOrSelect, SQL) ? Object.keys(valuesOrSelect.getSelectedFields()).map((key2) => [key2, columns[key2]]) : colEntries.filter(([_, col]) => !col.shouldDisableInsert());
    const insertOrder = colEntriesFiltered.map(([, column]) => sql.identifier(column.name));
    if (select) {
      const select2 = valuesOrSelect;
      if (is(select2, SQL)) valuesSqlList.push(select2);
      else valuesSqlList.push(select2.getSQL());
    } else {
      const values = valuesOrSelect;
      valuesSqlList.push(sql.raw("values "));
      for (const [valueIndex, value] of values.entries()) {
        const valueList = [];
        for (const [fieldName, col] of colEntriesFiltered) {
          const colValue = value[fieldName];
          if (colValue === void 0 || is(colValue, Param) && colValue.value === void 0) {
            let defaultValue;
            if (col.default !== null && col.default !== void 0) defaultValue = is(col.default, SQL) ? col.default : sql.param(col.default, col);
            else if (col.defaultFn !== void 0) {
              const defaultFnResult = col.defaultFn();
              defaultValue = is(defaultFnResult, SQL) ? defaultFnResult : sql.param(defaultFnResult, col);
            } else if (!col.default && col.onUpdateFn !== void 0) {
              const onUpdateFnResult = col.onUpdateFn();
              defaultValue = is(onUpdateFnResult, SQL) ? onUpdateFnResult : sql.param(onUpdateFnResult, col);
            } else defaultValue = sql`null`;
            valueList.push(defaultValue);
          } else valueList.push(colValue);
        }
        valuesSqlList.push(valueList);
        if (valueIndex < values.length - 1) valuesSqlList.push(sql`, `);
      }
    }
    const withSql = this.buildWithCTE(withList);
    const valuesSql = sql.join(valuesSqlList);
    const returningSql = returning ? sql` returning ${this.buildSelection(returning, { isSingleTable: true })}` : void 0;
    return sql`${withSql}insert into ${table} ${insertOrder} ${valuesSql}${onConflict?.length ? sql.join(onConflict) : void 0}${returningSql}`;
  }
  sqlToQuery(sql2, invokeSource) {
    return sql2.toQuery({
      escapeName: this.escapeName,
      escapeParam: this.escapeParam,
      escapeString: this.escapeString,
      invokeSource
    });
  }
  nestedSelectionerror() {
    throw new DrizzleError({ message: `Views with nested selections are not supported by the relational query builder` });
  }
  buildRqbColumn(table, column, key2, inJson) {
    if (is(column, Column)) {
      const name2 = sql`${table}.${sql.identifier(column.name)}`;
      switch (column.columnType) {
        case "SQLiteBigInt":
        case "SQLiteBlobJson":
        case "SQLiteBlobBuffer":
          if (!inJson) return sql`${name2} as ${sql.identifier(key2)}`;
          return sql`hex(${name2}) as ${sql.identifier(key2)}`;
        case "SQLiteNumeric":
        case "SQLiteNumericNumber":
        case "SQLiteNumericBigInt":
          return sql`cast(${name2} as text) as ${sql.identifier(key2)}`;
        case "SQLiteCustomColumn":
          if (!inJson) return sql`${name2} as ${sql.identifier(key2)}`;
          return sql`${column.jsonSelectIdentifier(name2, sql)} as ${sql.identifier(key2)}`;
        default:
          return sql`${name2} as ${sql.identifier(key2)}`;
      }
    }
    return sql`${table}.${is(column, SQL.Aliased) ? sql.identifier(column.fieldAlias) : isSQLWrapper(column) ? sql.identifier(key2) : this.nestedSelectionerror()} as ${sql.identifier(key2)}`;
  }
  unwrapAllColumns = (table, selection, inJson) => {
    return sql.join(Object.entries(table[TableColumns]).map(([k, v]) => {
      selection.push({
        key: k,
        field: v
      });
      return this.buildRqbColumn(table, v, k, inJson);
    }), sql`, `);
  };
  getSelectedTableColumns = (table, columns) => {
    const selectedColumns = [];
    const columnContainer = table[TableColumns];
    const entries = Object.entries(columns);
    let colSelectionMode;
    for (const [k, v] of entries) {
      if (v === void 0) continue;
      colSelectionMode = colSelectionMode || v;
      if (v) {
        const column = columnContainer[k];
        selectedColumns.push({
          column,
          tsName: k
        });
      }
    }
    if (colSelectionMode === false) for (const [k, v] of Object.entries(columnContainer)) {
      if (columns[k] === false) continue;
      selectedColumns.push({
        column: v,
        tsName: k
      });
    }
    return selectedColumns;
  };
  buildColumns = (table, selection, inJson, params) => params?.columns ? (() => {
    const columnIdentifiers = [];
    const selectedColumns = this.getSelectedTableColumns(table, params?.columns);
    for (const { column, tsName } of selectedColumns) {
      columnIdentifiers.push(this.buildRqbColumn(table, column, tsName, inJson));
      selection.push({
        key: tsName,
        field: column
      });
    }
    return columnIdentifiers.length ? sql.join(columnIdentifiers, sql`, `) : void 0;
  })() : this.unwrapAllColumns(table, selection, inJson);
  buildRelationalQuery({ schema, table, tableConfig, queryConfig: config, relationWhere, mode, isNested, errorPath, depth, throughJoin, jsonb }) {
    const selection = [];
    const isSingle = mode === "first";
    const params = config === true ? void 0 : config;
    const currentPath = errorPath ?? "";
    const currentDepth = depth ?? 0;
    if (!currentDepth) table = aliasedTable(table, `d${currentDepth}`);
    const limit = isSingle ? 1 : params?.limit;
    const offset = params?.offset;
    const columns = this.buildColumns(table, selection, !!isNested, params);
    const where = params?.where && relationWhere ? and(relationsFilterToSQL(table, params.where, tableConfig.relations, schema), relationWhere) : params?.where ? relationsFilterToSQL(table, params.where, tableConfig.relations, schema) : relationWhere;
    const order = params?.orderBy ? relationsOrderToSQL(table, params.orderBy) : void 0;
    const extras = params?.extras ? relationExtrasToSQL(table, params.extras) : void 0;
    if (extras) selection.push(...extras.selection);
    const joins = params ? (() => {
      const { with: joins2 } = params;
      if (!joins2) return;
      const withEntries = Object.entries(joins2).filter(([_, v]) => v);
      if (!withEntries.length) return;
      return sql.join(withEntries.map(([k, join2]) => {
        const relation = tableConfig.relations[k];
        const isSingle2 = is(relation, One);
        const targetTable = aliasedTable(relation.targetTable, `d${currentDepth + 1}`);
        const throughTable = relation.throughTable ? aliasedTable(relation.throughTable, `tr${currentDepth}`) : void 0;
        const { filter: filter2, joinCondition } = relationToSQL(relation, table, targetTable, throughTable);
        const throughJoin2 = throughTable ? sql` inner join ${getTableAsAliasSQL(throughTable)} on ${joinCondition}` : void 0;
        const innerQuery = this.buildRelationalQuery({
          table: targetTable,
          mode: isSingle2 ? "first" : "many",
          schema,
          queryConfig: join2,
          tableConfig: schema[relation.targetTableName],
          relationWhere: filter2,
          isNested: true,
          errorPath: `${currentPath.length ? `${currentPath}.` : ""}${k}`,
          depth: currentDepth + 1,
          throughJoin: throughJoin2,
          jsonb
        });
        selection.push({
          field: targetTable,
          key: k,
          selection: innerQuery.selection,
          isArray: !isSingle2,
          isOptional: (relation.optional ?? false) || join2 !== true && !!join2.where
        });
        const jsonColumns = sql.join(innerQuery.selection.map((s) => {
          return sql`${sql.raw(this.escapeString(s.key))}, ${s.selection ? sql`${jsonb}(${sql.identifier(s.key)})` : sql.identifier(s.key)}`;
        }), sql`, `);
        const json = isNested ? jsonb : sql`json`;
        return isSingle2 ? sql`(select ${json}_object(${jsonColumns}) as ${sql.identifier("r")} from (${innerQuery.sql}) as ${sql.identifier("t")}) as ${sql.identifier(k)}` : sql`coalesce((select ${json}_group_array(json_object(${jsonColumns})) as ${sql.identifier("r")} from (${innerQuery.sql}) as ${sql.identifier("t")}), ${jsonb}_array()) as ${sql.identifier(k)}`;
      }), sql`, `);
    })() : void 0;
    const selectionArr = [
      columns,
      extras?.sql,
      joins
    ].filter((e) => e !== void 0);
    if (!selectionArr.length) throw new DrizzleError({ message: `No fields selected for table "${tableConfig.name}"${currentPath ? ` ("${currentPath}")` : ""}` });
    return {
      sql: sql`select ${sql.join(selectionArr, sql`, `)} from ${getTableAsAliasSQL(table)}${throughJoin}${sql` where ${where}`.if(where)}${sql` order by ${order}`.if(order)}${sql` limit ${limit}`.if(limit !== void 0)}${sql` offset ${offset}`.if(offset !== void 0)}`,
      selection
    };
  }
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/query-builders/query-builder.js
var QueryBuilder = class {
  static [entityKind] = "SQLiteQueryBuilder";
  dialect;
  dialectConfig;
  constructor(dialect) {
    this.dialect = is(dialect, SQLiteDialect) ? dialect : void 0;
    this.dialectConfig = is(dialect, SQLiteDialect) ? void 0 : dialect;
  }
  $with = (alias, selection) => {
    const queryBuilder = this;
    const as = (qb) => {
      if (typeof qb === "function") qb = qb(queryBuilder);
      return new Proxy(new WithSubquery(qb.getSQL(), selection ?? ("getSelectedFields" in qb ? qb.getSelectedFields() ?? {} : {}), alias, true), new SelectionProxyHandler({
        alias,
        sqlAliasedBehavior: "alias",
        sqlBehavior: "error"
      }));
    };
    return { as };
  };
  with(...queries) {
    const self = this;
    function select(fields2) {
      return new SQLiteSelectBuilder({
        fields: fields2 ?? void 0,
        session: void 0,
        dialect: self.getDialect(),
        withList: queries
      });
    }
    function selectDistinct(fields2) {
      return new SQLiteSelectBuilder({
        fields: fields2 ?? void 0,
        session: void 0,
        dialect: self.getDialect(),
        withList: queries,
        distinct: true
      });
    }
    return {
      select,
      selectDistinct
    };
  }
  select(fields2) {
    return new SQLiteSelectBuilder({
      fields: fields2 ?? void 0,
      session: void 0,
      dialect: this.getDialect()
    });
  }
  selectDistinct(fields2) {
    return new SQLiteSelectBuilder({
      fields: fields2 ?? void 0,
      session: void 0,
      dialect: this.getDialect(),
      distinct: true
    });
  }
  getDialect() {
    if (!this.dialect) this.dialect = new SQLiteDialect(this.dialectConfig);
    return this.dialect;
  }
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/query-builders/insert.js
var SQLiteInsertBuilder = class {
  static [entityKind] = "SQLiteInsertBuilder";
  constructor(table, session, dialect, withList, builder = SQLiteInsertBase) {
    this.table = table;
    this.session = session;
    this.dialect = dialect;
    this.withList = withList;
    this.builder = builder;
  }
  values(values) {
    values = Array.isArray(values) ? values : [values];
    if (values.length === 0) throw new Error("values() must be called with at least one value");
    const mappedValues = values.map((entry) => {
      const result = {};
      const cols = this.table[Table.Symbol.Columns];
      for (const colKey of Object.keys(entry)) {
        const colValue = entry[colKey];
        result[colKey] = is(colValue, SQL) ? colValue : new Param(colValue, cols[colKey]);
      }
      return result;
    });
    return new this.builder(this.table, mappedValues, this.session, this.dialect, this.withList);
  }
  select(selectQuery) {
    const select = typeof selectQuery === "function" ? selectQuery(new QueryBuilder()) : selectQuery;
    if (!is(select, SQL)) {
      const insertCols = Object.keys(this.table[Table.Symbol.Columns]);
      const selected = Object.keys(select._.selectedFields);
      for (const col of selected) if (!insertCols.includes(col)) throw new Error(`Insert select error: column "${col}" does not exist in table "${this.table[Table.Symbol.Name]}"`);
    }
    return new this.builder(this.table, select, this.session, this.dialect, this.withList, true);
  }
};
var SQLiteInsertBase = class {
  static [entityKind] = "SQLiteInsert";
  /** @internal */
  config;
  constructor(table, values, session, dialect, withList, select) {
    this.session = session;
    this.dialect = dialect;
    this.config = {
      table,
      values,
      withList,
      select
    };
  }
  returning(fields2 = this.config.table[SQLiteTable.Symbol.Columns]) {
    this.config.returning = orderSelectedFields(fields2);
    return this;
  }
  /**
  * Adds an `on conflict do nothing` clause to the query.
  *
  * Calling this method simply avoids inserting a row as its alternative action.
  *
  * See docs: {@link https://orm.drizzle.team/docs/insert#on-conflict-do-nothing}
  *
  * @param config The `target` and `where` clauses.
  *
  * @example
  * ```ts
  * // Insert one row and cancel the insert if there's a conflict
  * await db.insert(cars)
  *   .values({ id: 1, brand: 'BMW' })
  *   .onConflictDoNothing();
  *
  * // Explicitly specify conflict target
  * await db.insert(cars)
  *   .values({ id: 1, brand: 'BMW' })
  *   .onConflictDoNothing({ target: cars.id });
  * ```
  */
  onConflictDoNothing(config = {}) {
    if (!this.config.onConflict) this.config.onConflict = [];
    if (config.target === void 0) this.config.onConflict.push(sql` on conflict do nothing`);
    else {
      const targetSql = Array.isArray(config.target) ? sql`${config.target}` : sql`${[config.target]}`;
      const whereSql = config.where ? sql` where ${config.where}` : sql``;
      this.config.onConflict.push(sql` on conflict ${targetSql} do nothing${whereSql}`);
    }
    return this;
  }
  /**
  * Adds an `on conflict do update` clause to the query.
  *
  * Calling this method will update the existing row that conflicts with the row proposed for insertion as its alternative action.
  *
  * See docs: {@link https://orm.drizzle.team/docs/insert#upserts-and-conflicts}
  *
  * @param config The `target`, `set` and `where` clauses.
  *
  * @example
  * ```ts
  * // Update the row if there's a conflict
  * await db.insert(cars)
  *   .values({ id: 1, brand: 'BMW' })
  *   .onConflictDoUpdate({
  *     target: cars.id,
  *     set: { brand: 'Porsche' }
  *   });
  *
  * // Upsert with 'where' clause
  * await db.insert(cars)
  *   .values({ id: 1, brand: 'BMW' })
  *   .onConflictDoUpdate({
  *     target: cars.id,
  *     set: { brand: 'newBMW' },
  *     where: sql`${cars.createdAt} > '2023-01-01'::date`,
  *   });
  * ```
  */
  onConflictDoUpdate(config) {
    if (config.where && (config.targetWhere || config.setWhere)) throw new Error('You cannot use both "where" and "targetWhere"/"setWhere" at the same time - "where" is deprecated, use "targetWhere" or "setWhere" instead.');
    if (!this.config.onConflict) this.config.onConflict = [];
    const whereSql = config.where ? sql` where ${config.where}` : void 0;
    const targetWhereSql = config.targetWhere ? sql` where ${config.targetWhere}` : void 0;
    const setWhereSql = config.setWhere ? sql` where ${config.setWhere}` : void 0;
    const targetSql = Array.isArray(config.target) ? sql`${config.target}` : sql`${[config.target]}`;
    const setSql = this.dialect.buildUpdateSet(this.config.table, mapUpdateSet(this.config.table, config.set));
    this.config.onConflict.push(sql` on conflict ${targetSql}${targetWhereSql} do update set ${setSql}${whereSql}${setWhereSql}`);
    return this;
  }
  getSQL() {
    return this.dialect.buildInsertQuery(this.config);
  }
  toSQL() {
    return this.dialect.sqlToQuery(this.getSQL());
  }
  $dynamic() {
    return this;
  }
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/async/insert.js
var SQLiteAsyncInsertBase = class extends SQLiteInsertBase {
  static [entityKind] = "SQLiteAsyncInsert";
  /** @internal */
  _prepare(prepare = false) {
    return this.session.prepareQuery(this.dialect.sqlToQuery(this.getSQL()), "arrays", prepare, this.config.returning ? "all" : "run", this.config.returning ? this.dialect.mapperGenerators.rows(this.config.returning, void 0) : void 0, {
      type: "insert",
      tables: extractUsedTable(this.config.table)
    });
  }
  prepare() {
    return this._prepare(true);
  }
  run = (placeholderValues) => {
    return this._prepare().run(placeholderValues);
  };
  all = (placeholderValues) => {
    return this._prepare().all(placeholderValues);
  };
  get = (placeholderValues) => {
    return this._prepare().get(placeholderValues);
  };
  values = (placeholderValues) => {
    return this._prepare().values(placeholderValues);
  };
  async execute() {
    return this._prepare().execute();
  }
};
applyMixins(SQLiteAsyncInsertBase, [QueryPromise]);

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/query-builders/raw.js
var SQLiteRaw = class {
  static [entityKind] = "SQLiteRaw";
  constructor(prepared, sql2, query) {
    this.prepared = prepared;
    this.sql = sql2;
    this.query = query;
  }
  getSQL() {
    return this.sql;
  }
  getQuery() {
    return this.query;
  }
  _prepare() {
    return this.prepared;
  }
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/async/raw.js
var SQLiteAsyncRaw = class extends SQLiteRaw {
  static [entityKind] = "SQLiteAsyncRaw";
  constructor(prepared, sql2, query) {
    super(prepared, sql2, query);
  }
  execute(placeholderValues) {
    return this.prepared.execute(placeholderValues);
  }
};
applyMixins(SQLiteAsyncRaw, [QueryPromise]);

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/async/select.js
var SQLiteAsyncSelectBase = class extends SQLiteSelectBase {
  static [entityKind] = "SQLiteAsyncSelect";
  /** @internal */
  _prepare(prepare = false) {
    const query = this.dialect.sqlToQuery(this.getSQL());
    const fieldsList = this.config.fieldsFlat;
    const mapper = this.dialect.mapperGenerators.rows(fieldsList, this.joinsNotNullableMap);
    return this.session.prepareQuery(query, "arrays", prepare, "all", mapper, {
      type: "select",
      tables: [...this.usedTables]
    }, this.cacheConfig);
  }
  prepare() {
    return this._prepare(true);
  }
  run = (placeholderValues) => {
    return this._prepare().run(placeholderValues);
  };
  all = (placeholderValues) => {
    return this._prepare().all(placeholderValues);
  };
  get = (placeholderValues) => {
    return this._prepare().get(placeholderValues);
  };
  values = (placeholderValues) => {
    return this._prepare().values(placeholderValues);
  };
  async execute() {
    return this._prepare().execute();
  }
};
applyMixins(SQLiteAsyncSelectBase, [QueryPromise]);

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/query-builders/update.js
var SQLiteUpdateBuilder = class {
  static [entityKind] = "SQLiteUpdateBuilder";
  constructor(table, session, dialect, withList, builder = SQLiteUpdateBase) {
    this.table = table;
    this.session = session;
    this.dialect = dialect;
    this.withList = withList;
    this.builder = builder;
  }
  set(values) {
    return new this.builder(this.table, mapUpdateSet(this.table, values), this.session, this.dialect, this.withList);
  }
};
var SQLiteUpdateBase = class {
  static [entityKind] = "SQLiteUpdate";
  /** @internal */
  config;
  constructor(table, set, session, dialect, withList) {
    this.session = session;
    this.dialect = dialect;
    this.config = {
      set,
      table,
      withList,
      joins: []
    };
  }
  from(source) {
    this.config.from = source;
    return this;
  }
  createJoin(joinType) {
    return ((table, on) => {
      const tableName = getTableLikeName(table);
      if (typeof tableName === "string" && this.config.joins.some((join2) => join2.alias === tableName)) throw new Error(`Alias "${tableName}" is already used in this query`);
      if (typeof on === "function") {
        const from = this.config.from ? is(table, SQLiteTable) ? table[Table.Symbol.Columns] : is(table, Subquery) ? table._.selectedFields : is(table, SQLiteViewBase) ? table[ViewBaseConfig].selectedFields : void 0 : void 0;
        on = on(new Proxy(this.config.table[Table.Symbol.Columns], new SelectionProxyHandler({
          sqlAliasedBehavior: "sql",
          sqlBehavior: "sql"
        })), from && new Proxy(from, new SelectionProxyHandler({
          sqlAliasedBehavior: "sql",
          sqlBehavior: "sql"
        })));
      }
      this.config.joins.push({
        on,
        table,
        joinType,
        alias: tableName
      });
      return this;
    });
  }
  leftJoin = this.createJoin("left");
  rightJoin = this.createJoin("right");
  innerJoin = this.createJoin("inner");
  fullJoin = this.createJoin("full");
  /**
  * Adds a 'where' clause to the query.
  *
  * Calling this method will update only those rows that fulfill a specified condition.
  *
  * See docs: {@link https://orm.drizzle.team/docs/update}
  *
  * @param where the 'where' clause.
  *
  * @example
  * You can use conditional operators and `sql function` to filter the rows to be updated.
  *
  * ```ts
  * // Update all cars with green color
  * db.update(cars).set({ color: 'red' })
  *   .where(eq(cars.color, 'green'));
  * // or
  * db.update(cars).set({ color: 'red' })
  *   .where(sql`${cars.color} = 'green'`)
  * ```
  *
  * You can logically combine conditional operators with `and()` and `or()` operators:
  *
  * ```ts
  * // Update all BMW cars with a green color
  * db.update(cars).set({ color: 'red' })
  *   .where(and(eq(cars.color, 'green'), eq(cars.brand, 'BMW')));
  *
  * // Update all cars with the green or blue color
  * db.update(cars).set({ color: 'red' })
  *   .where(or(eq(cars.color, 'green'), eq(cars.color, 'blue')));
  * ```
  */
  where(where) {
    this.config.where = where;
    return this;
  }
  orderBy(...columns) {
    if (typeof columns[0] === "function") {
      const orderBy = columns[0](new Proxy(this.config.table[Table.Symbol.Columns], new SelectionProxyHandler({
        sqlAliasedBehavior: "alias",
        sqlBehavior: "sql"
      })));
      const orderByArray = Array.isArray(orderBy) ? orderBy : [orderBy];
      this.config.orderBy = orderByArray;
    } else {
      const orderByArray = columns;
      this.config.orderBy = orderByArray;
    }
    return this;
  }
  limit(limit) {
    this.config.limit = limit;
    return this;
  }
  returning(fields2 = this.config.table[SQLiteTable.Symbol.Columns]) {
    this.config.returning = orderSelectedFields(fields2);
    return this;
  }
  getSQL() {
    return this.dialect.buildUpdateQuery(this.config);
  }
  toSQL() {
    return this.dialect.sqlToQuery(this.getSQL());
  }
  $dynamic() {
    return this;
  }
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/async/update.js
var SQLiteAsyncUpdateBase = class extends SQLiteUpdateBase {
  static [entityKind] = "SQLiteAsyncUpdate";
  /** @internal */
  _prepare(prepare = false) {
    return this.session.prepareQuery(this.dialect.sqlToQuery(this.getSQL()), "arrays", prepare, this.config.returning ? "all" : "run", this.config.returning ? this.dialect.mapperGenerators.rows(this.config.returning, void 0) : void 0, {
      type: "update",
      tables: extractUsedTable(this.config.table)
    });
  }
  prepare() {
    return this._prepare(true);
  }
  run = (placeholderValues) => {
    return this._prepare().run(placeholderValues);
  };
  all = (placeholderValues) => {
    return this._prepare().all(placeholderValues);
  };
  get = (placeholderValues) => {
    return this._prepare().get(placeholderValues);
  };
  values = (placeholderValues) => {
    return this._prepare().values(placeholderValues);
  };
  async execute() {
    return this.config.returning ? this.all() : this.run();
  }
};
applyMixins(SQLiteAsyncUpdateBase, [QueryPromise]);

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/async/db.js
var SQLiteAsyncDatabase = class {
  static [entityKind] = "BaseSQLiteDatabase";
  query;
  constructor(resultKind, dialect, session, relations, forbidJsonb) {
    this.resultKind = resultKind;
    this.dialect = dialect;
    this.session = session;
    this.forbidJsonb = forbidJsonb;
    this._ = {
      relations,
      session,
      resultKind
    };
    this.query = {};
    for (const [tableName, relation] of Object.entries(relations)) this.query[tableName] = new RelationalQueryBuilder(resultKind, relations, relations[relation.name].table, relation, dialect, session, forbidJsonb, resultKind === "sync" ? SQLiteSyncRelationalQuery : SQLiteAsyncRelationalQuery);
    this.$cache = { invalidate: async (_params) => {
    } };
  }
  /**
  * Creates a subquery that defines a temporary named result set as a CTE.
  *
  * It is useful for breaking down complex queries into simpler parts and for reusing the result set in subsequent parts of the query.
  *
  * See docs: {@link https://orm.drizzle.team/docs/select#with-clause}
  *
  * @param alias The alias for the subquery.
  *
  * Failure to provide an alias will result in a DrizzleTypeError, preventing the subquery from being referenced in other queries.
  *
  * @example
  *
  * ```ts
  * // Create a subquery with alias 'sq' and use it in the select query
  * const sq = db.$with('sq').as(db.select().from(users).where(eq(users.id, 42)));
  *
  * const result = await db.with(sq).select().from(sq);
  * ```
  *
  * To select arbitrary SQL values as fields in a CTE and reference them in other CTEs or in the main query, you need to add aliases to them:
  *
  * ```ts
  * // Select an arbitrary SQL value as a field in a CTE and reference it in the main query
  * const sq = db.$with('sq').as(db.select({
  *   name: sql<string>`upper(${users.name})`.as('name'),
  * })
  * .from(users));
  *
  * const result = await db.with(sq).select({ name: sq.name }).from(sq);
  * ```
  */
  $with = (alias, selection) => {
    const self = this;
    const as = (qb) => {
      if (typeof qb === "function") qb = qb(new QueryBuilder(self.dialect));
      return new Proxy(new WithSubquery(qb.getSQL(), selection ?? ("getSelectedFields" in qb ? qb.getSelectedFields() ?? {} : {}), alias, true), new SelectionProxyHandler({
        alias,
        sqlAliasedBehavior: "alias",
        sqlBehavior: "error"
      }));
    };
    return { as };
  };
  $count(source, filters) {
    return this.resultKind === "async" ? new SQLiteAsyncCountBuilder({
      source,
      filters,
      session: this.session,
      dialect: this.dialect
    }) : new SQLiteSyncCountBuilder({
      source,
      filters,
      session: this.session,
      dialect: this.dialect
    });
  }
  /**
  * Incorporates a previously defined CTE (using `$with`) into the main query.
  *
  * This method allows the main query to reference a temporary named result set.
  *
  * See docs: {@link https://orm.drizzle.team/docs/select#with-clause}
  *
  * @param queries The CTEs to incorporate into the main query.
  *
  * @example
  *
  * ```ts
  * // Define a subquery 'sq' as a CTE using $with
  * const sq = db.$with('sq').as(db.select().from(users).where(eq(users.id, 42)));
  *
  * // Incorporate the CTE 'sq' into the main query and select from it
  * const result = await db.with(sq).select().from(sq);
  * ```
  */
  with(...queries) {
    const self = this;
    function select(fields2) {
      return new SQLiteSelectBuilder({
        fields: fields2 ?? void 0,
        session: self.session,
        dialect: self.dialect,
        withList: queries
      }, SQLiteAsyncSelectBase);
    }
    function selectDistinct(fields2) {
      return new SQLiteSelectBuilder({
        fields: fields2 ?? void 0,
        session: self.session,
        dialect: self.dialect,
        withList: queries,
        distinct: true
      }, SQLiteAsyncSelectBase);
    }
    function update(table) {
      return new SQLiteUpdateBuilder(table, self.session, self.dialect, queries, SQLiteAsyncUpdateBase);
    }
    function insert(into) {
      return new SQLiteInsertBuilder(into, self.session, self.dialect, queries, SQLiteAsyncInsertBase);
    }
    function delete_(from) {
      return new SQLiteAsyncDeleteBase(from, self.session, self.dialect, queries);
    }
    return {
      select,
      selectDistinct,
      update,
      insert,
      delete: delete_
    };
  }
  select(fields2) {
    return new SQLiteSelectBuilder({
      fields: fields2 ?? void 0,
      session: this.session,
      dialect: this.dialect
    }, SQLiteAsyncSelectBase);
  }
  selectDistinct(fields2) {
    return new SQLiteSelectBuilder({
      fields: fields2 ?? void 0,
      session: this.session,
      dialect: this.dialect,
      distinct: true
    }, SQLiteAsyncSelectBase);
  }
  /**
  * Creates an update query.
  *
  * Calling this method without `.where()` clause will update all rows in a table. The `.where()` clause specifies which rows should be updated.
  *
  * Use `.set()` method to specify which values to update.
  *
  * See docs: {@link https://orm.drizzle.team/docs/update}
  *
  * @param table The table to update.
  *
  * @example
  *
  * ```ts
  * // Update all rows in the 'cars' table
  * await db.update(cars).set({ color: 'red' });
  *
  * // Update rows with filters and conditions
  * await db.update(cars).set({ color: 'red' }).where(eq(cars.brand, 'BMW'));
  *
  * // Update with returning clause
  * const updatedCar: Car[] = await db.update(cars)
  *   .set({ color: 'red' })
  *   .where(eq(cars.id, 1))
  *   .returning();
  * ```
  */
  update(table) {
    return new SQLiteUpdateBuilder(table, this.session, this.dialect, void 0, SQLiteAsyncUpdateBase);
  }
  $cache;
  /**
  * Creates an insert query.
  *
  * Calling this method will create new rows in a table. Use `.values()` method to specify which values to insert.
  *
  * See docs: {@link https://orm.drizzle.team/docs/insert}
  *
  * @param table The table to insert into.
  *
  * @example
  *
  * ```ts
  * // Insert one row
  * await db.insert(cars).values({ brand: 'BMW' });
  *
  * // Insert multiple rows
  * await db.insert(cars).values([{ brand: 'BMW' }, { brand: 'Porsche' }]);
  *
  * // Insert with returning clause
  * const insertedCar: Car[] = await db.insert(cars)
  *   .values({ brand: 'BMW' })
  *   .returning();
  * ```
  */
  insert(into) {
    return new SQLiteInsertBuilder(into, this.session, this.dialect, void 0, SQLiteAsyncInsertBase);
  }
  /**
  * Creates a delete query.
  *
  * Calling this method without `.where()` clause will delete all rows in a table. The `.where()` clause specifies which rows should be deleted.
  *
  * See docs: {@link https://orm.drizzle.team/docs/delete}
  *
  * @param table The table to delete from.
  *
  * @example
  *
  * ```ts
  * // Delete all rows in the 'cars' table
  * await db.delete(cars);
  *
  * // Delete rows with filters and conditions
  * await db.delete(cars).where(eq(cars.color, 'green'));
  *
  * // Delete with returning clause
  * const deletedCar: Car[] = await db.delete(cars)
  *   .where(eq(cars.id, 1))
  *   .returning();
  * ```
  */
  delete(from) {
    return new SQLiteAsyncDeleteBase(from, this.session, this.dialect);
  }
  run(query) {
    const sequel = typeof query === "string" ? sql.raw(query) : query.getSQL();
    const builtQuery = this.dialect.sqlToQuery(sequel);
    const prepared = this.session.prepareQuery(builtQuery, "raw", false, "run");
    if (this.resultKind === "async") return new SQLiteAsyncRaw(prepared, sequel, builtQuery);
    return this.session.run(sequel);
  }
  all(query) {
    const sequel = typeof query === "string" ? sql.raw(query) : query.getSQL();
    const builtQuery = this.dialect.sqlToQuery(sequel);
    const prepared = this.session.prepareQuery(builtQuery, "objects", false, "all");
    if (this.resultKind === "async") return new SQLiteAsyncRaw(prepared, sequel, builtQuery);
    return this.session.objects(sequel);
  }
  get(query) {
    const sequel = typeof query === "string" ? sql.raw(query) : query.getSQL();
    const builtQuery = this.dialect.sqlToQuery(sequel);
    const prepared = this.session.prepareQuery(builtQuery, "objects", false, "get");
    if (this.resultKind === "async") return new SQLiteAsyncRaw(prepared, sequel, builtQuery);
    return this.session.object(sequel);
  }
  values(query) {
    const sequel = typeof query === "string" ? sql.raw(query) : query.getSQL();
    const builtQuery = this.dialect.sqlToQuery(sequel);
    const prepared = this.session.prepareQuery(builtQuery, "objects", false, "values");
    if (this.resultKind === "async") return new SQLiteAsyncRaw(prepared, sequel, builtQuery);
    return this.session.arrays(sequel);
  }
  transaction(transaction, config) {
    return this.session.transaction(transaction, config);
  }
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/cache/core/cache.js
var Cache = class {
  static [entityKind] = "Cache";
};
var NoopCache = class extends Cache {
  static [entityKind] = "NoopCache";
  strategy() {
    return "all";
  }
  async get(_key) {
  }
  async put(_hashedQuery, _response, _tables, _config) {
  }
  async onMutate(_params) {
  }
};
var strategyFor = async (query, params, queryMetadata, withCacheConfig) => {
  if (!queryMetadata) return { type: "skip" };
  const { type, tables } = queryMetadata;
  if ((type === "insert" || type === "update" || type === "delete") && tables.length > 0) return {
    type: "invalidate",
    tables
  };
  if (!withCacheConfig) return { type: "skip" };
  if (!withCacheConfig.enabled) return { type: "skip" };
  if (type === "select") return {
    type: "try",
    key: withCacheConfig.tag ?? await hashQuery(query, params),
    isTag: typeof withCacheConfig.tag !== "undefined",
    autoInvalidate: withCacheConfig.autoInvalidate,
    tables: queryMetadata.tables,
    config: withCacheConfig.config
  };
  return { type: "skip" };
};
async function hashQuery(sql2, params) {
  const dataToHash = `${sql2}-${JSON.stringify(params, (_, v) => typeof v === "bigint" ? `${v}n` : v)}`;
  const data = new TextEncoder().encode(dataToHash);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/session.js
var SQLitePreparedQuery = class {
  static [entityKind] = "SQLiteBasePreparedQuery";
  /** @internal */
  mapper;
  /** @internal */
  executeMethod;
  constructor(executeMethod, query, mapper, mode) {
    this.query = query;
    this.mode = mode;
    this.mapper = mapper;
    this.executeMethod = executeMethod;
  }
  getQuery() {
    return this.query;
  }
};
var SQLiteSession = class {
  static [entityKind] = "SQLiteSession";
  constructor(dialect) {
    this.dialect = dialect;
  }
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/sqlite-core/async/session.js
var ExecuteResultSync = class extends QueryPromise {
  static [entityKind] = "ExecuteResultSync";
  constructor(resultCb) {
    super();
    this.resultCb = resultCb;
  }
  async execute() {
    return this.resultCb();
  }
  sync() {
    return this.resultCb();
  }
};
var SQLiteAsyncPreparedQuery = class extends SQLitePreparedQuery {
  static [entityKind] = "SQLiteAsyncPreparedQuery";
  fastPath;
  constructor(resultKind, executeMethod = "all", executors, query, mapper, mode, logger, cache, queryMetadata, cacheConfig) {
    super(executeMethod, query, mapper, mode);
    this.resultKind = resultKind;
    this.executors = executors;
    this.logger = logger;
    this.cache = cache;
    this.queryMetadata = queryMetadata;
    this.cacheConfig = cacheConfig;
    if (cache && cache.strategy() === "all" && cacheConfig === void 0) this.cacheConfig = {
      enabled: true,
      autoInvalidate: true
    };
    if (!this.cacheConfig?.enabled) this.cacheConfig = void 0;
    this.fastPath = cacheConfig === void 0 && (cache === void 0 || is(cache, NoopCache));
  }
  /** @internal */
  async queryWithCache(queryString, params, executeMethod, query) {
    const cacheStrat = this.cache !== void 0 && !is(this.cache, NoopCache) ? await strategyFor(queryString, params, this.queryMetadata, this.cacheConfig) : { type: "skip" };
    if (cacheStrat.type === "skip") return query().catch((e) => {
      throw new DrizzleQueryError(queryString, params, e);
    });
    const cache = this.cache;
    if (cacheStrat.type === "invalidate") return Promise.all([query(), cache.onMutate({ tables: cacheStrat.tables })]).then((res) => res[0]).catch((e) => {
      throw new DrizzleQueryError(queryString, params, e);
    });
    if (cacheStrat.type === "try") {
      const { tables, key: _key, isTag, autoInvalidate, config } = cacheStrat;
      const key2 = `${executeMethod}_${_key}`;
      const fromCache = await cache.get(key2, tables, isTag, autoInvalidate);
      if (fromCache === void 0) {
        const result = await query().catch((e) => {
          throw new DrizzleQueryError(queryString, params, e);
        });
        await cache.put(key2, result, autoInvalidate ? tables : [], isTag, config);
        return result;
      }
      return fromCache;
    }
    assertUnreachable(cacheStrat);
  }
  run(placeholderValues = {}) {
    const { query, logger, executors, fastPath, resultKind } = this;
    const sql2 = query._sql ? query._sql.join(" ") : query.sql;
    const params = query.params.length === 0 ? query.params : fillPlaceholders(query.params, placeholderValues);
    logger.logQuery(sql2, params);
    if (resultKind === "sync") try {
      return executors.run(params);
    } catch (e) {
      throw new DrizzleQueryError(sql2, params, e);
    }
    return fastPath ? executors.run(params).catch((e) => {
      throw new DrizzleQueryError(sql2, params, e);
    }) : this.queryWithCache(sql2, params, "run", () => executors.run(params));
  }
  all(placeholderValues = {}) {
    const { query, logger, executors, mapper, fastPath, resultKind } = this;
    const sql2 = query._sql ? query._sql.join(" ") : query.sql;
    const params = query.params.length === 0 ? query.params : fillPlaceholders(query.params, placeholderValues);
    logger.logQuery(sql2, params);
    if (resultKind === "sync") {
      let res2;
      try {
        res2 = executors.all(params);
      } catch (e) {
        throw new DrizzleQueryError(sql2, params, e);
      }
      if (!mapper) return res2;
      return mapper(res2);
    }
    const res = fastPath ? executors.all(params).catch((e) => {
      throw new DrizzleQueryError(sql2, params, e);
    }) : this.queryWithCache(sql2, params, "all", () => executors.all(params));
    if (!mapper) return res;
    return res.then((rows) => mapper(rows));
  }
  get(placeholderValues = {}) {
    const { query, logger, executors, mapper, fastPath, resultKind } = this;
    const sql2 = query._sql ? query._sql.join(" ") : query.sql;
    const params = query.params.length === 0 ? query.params : fillPlaceholders(query.params, placeholderValues);
    logger.logQuery(sql2, params);
    if (resultKind === "sync") {
      let res2;
      try {
        res2 = executors.get(params);
      } catch (e) {
        throw new DrizzleQueryError(sql2, params, e);
      }
      if (!res2) return void 0;
      if (!mapper) return res2;
      return mapper([res2])[0];
    }
    const res = fastPath ? executors.get(params).catch((e) => {
      throw new DrizzleQueryError(sql2, params, e);
    }) : this.queryWithCache(sql2, params, "get", () => executors.get(params));
    if (!mapper) return res.then((row) => row ? row : void 0);
    return res.then((row) => row ? mapper([row])[0] : void 0);
  }
  values(placeholderValues = {}) {
    const { query, logger, executors, fastPath, resultKind } = this;
    const sql2 = query._sql ? query._sql.join(" ") : query.sql;
    const params = query.params.length === 0 ? query.params : fillPlaceholders(query.params, placeholderValues);
    logger.logQuery(sql2, params);
    if (resultKind === "sync") try {
      return executors.values(params);
    } catch (e) {
      throw new DrizzleQueryError(sql2, params, e);
    }
    return fastPath ? executors.values(params).catch((e) => {
      throw new DrizzleQueryError(sql2, params, e);
    }) : this.queryWithCache(sql2, params, "values", () => executors.values(params));
  }
  execute(placeholderValues) {
    if (this.resultKind === "async") return this[this.executeMethod](placeholderValues);
    return new ExecuteResultSync(() => this[this.executeMethod](placeholderValues));
  }
};
var SQLiteAsyncSession = class extends SQLiteSession {
  static [entityKind] = "SQLiteAsyncSession";
  constructor(dialect, resultKind) {
    super(dialect);
    this.resultKind = resultKind;
  }
  run(query) {
    return this.prepareQuery(this.dialect.sqlToQuery(query), "raw", false).run();
  }
  objects(query) {
    return this.prepareQuery(this.dialect.sqlToQuery(query), "objects", false).all();
  }
  object(query) {
    return this.prepareQuery(this.dialect.sqlToQuery(query), "objects", false).get();
  }
  arrays(query) {
    return this.prepareQuery(this.dialect.sqlToQuery(query), "arrays", false).all();
  }
  array(query) {
    return this.prepareQuery(this.dialect.sqlToQuery(query), "arrays", false).get();
  }
};
var SQLiteAsyncTransaction = class extends SQLiteAsyncDatabase {
  static [entityKind] = "SQLiteAsyncTransaction";
  constructor(resultType, dialect, session, relations, nestedIndex = 0, forbidJsonb) {
    super(resultType, dialect, session, relations, forbidJsonb);
    this.nestedIndex = nestedIndex;
  }
  rollback() {
    throw new TransactionRollbackError();
  }
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/node-sqlite/session.js
var NodeSQLiteSession = class extends SQLiteAsyncSession {
  static [entityKind] = "SQLJsSession";
  logger;
  constructor(client, dialect, relations, options = {}) {
    super(dialect, "sync");
    this.client = client;
    this.relations = relations;
    this.options = options;
    this.logger = options.logger ?? new NoopLogger();
  }
  prepareQuery(query, mode, _prepare, executeMethod, mapper, queryMetadata) {
    let stmt;
    try {
      stmt = this.client.prepare(query.sql);
    } catch (e) {
      throw new DrizzleQueryError(query.sql, query.params, e);
    }
    return new SQLiteAsyncPreparedQuery("sync", executeMethod, {
      all: (params) => {
        stmt.setReturnArrays(mode === "arrays");
        const res = stmt.all(...params);
        if (mode === "objects") return res.map((row) => ({ ...row }));
        return res;
      },
      get: (params) => {
        stmt.setReturnArrays(mode === "arrays");
        const res = stmt.get(...params);
        if (res && mode === "objects") return { ...res };
        return res;
      },
      run: (params) => {
        stmt.setReturnArrays(false);
        return stmt.run(...params);
      },
      values: (params) => {
        stmt.setReturnArrays(true);
        return stmt.all(...params);
      }
    }, query, mapper, mode, this.logger, void 0, queryMetadata, void 0);
  }
  transaction(transaction, config = {}) {
    const tx = new NodeSQLiteTransaction("sync", this.dialect, this, this.relations);
    this.run(sql.raw(`begin${config.behavior ? ` ${config.behavior}` : ""}`));
    try {
      const result = transaction(tx);
      this.run(sql`commit`);
      return result;
    } catch (err) {
      this.run(sql`rollback`);
      throw err;
    }
  }
};
var NodeSQLiteTransaction = class NodeSQLiteTransaction2 extends SQLiteAsyncTransaction {
  static [entityKind] = "SQLJsTransaction";
  transaction(transaction) {
    const savepointName = `sp${this.nestedIndex + 1}`;
    const tx = new NodeSQLiteTransaction2("sync", this.dialect, this.session, this._.relations, this.nestedIndex + 1);
    tx.run(sql.raw(`savepoint ${savepointName}`));
    try {
      const result = transaction(tx);
      tx.run(sql.raw(`release savepoint ${savepointName}`));
      return result;
    } catch (err) {
      tx.run(sql.raw(`rollback to savepoint ${savepointName}`));
      throw err;
    }
  }
};

// node_modules/.pnpm/drizzle-orm@1.0.0-rc.4_@sinclair+typebox@0.34.52_zod@3.25.76/node_modules/drizzle-orm/node-sqlite/driver.js
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";
var NodeSQLiteDatabase = class extends SQLiteAsyncDatabase {
  static [entityKind] = "NodeSQLiteDatabase";
};
function construct(client, config = {}) {
  const dialect = new SQLiteDialect({ useJitMappers: jitCompatCheck(config.jit) });
  let logger;
  if (config.logger === true) logger = new DefaultLogger();
  else if (config.logger !== false) logger = config.logger;
  const relations = config.relations ?? {};
  const db = new NodeSQLiteDatabase("sync", dialect, new NodeSQLiteSession(client, dialect, relations, { logger }), relations);
  db.$client = client;
  return db;
}
function drizzle(...params) {
  if (params[0] === void 0 || typeof params[0] === "string") return construct(params[0] === void 0 ? new DatabaseSync2(":memory:") : new DatabaseSync2(params[0]), params[1]);
  const { connection, client, ...config } = params[0];
  if (client) return construct(client, config);
  if (typeof connection === "object") {
    const { path: path16, ...options } = connection;
    return construct(new DatabaseSync2(path16 ?? ":memory:", options), config);
  }
  return construct(new DatabaseSync2(connection ?? ":memory:"), config);
}
(function(_drizzle) {
  function mock(config) {
    return construct({}, config);
  }
  _drizzle.mock = mock;
})(drizzle || (drizzle = {}));

// services/translate/shared-cache/candidate-schema.ts
function ensureCandidateSchema(client) {
  const columns = client.prepare("PRAGMA table_info(translations)").all();
  if (!columns.some((column) => column.name === "id")) {
    client.exec("BEGIN IMMEDIATE");
    try {
      client.exec(`
        DROP TRIGGER IF EXISTS translation_match_insert;
        DROP TRIGGER IF EXISTS translation_match_update;
        DROP TRIGGER IF EXISTS translation_match_delete;
        DROP TRIGGER IF EXISTS match_record_insert;
        DROP TRIGGER IF EXISTS match_record_update;
        DROP TRIGGER IF EXISTS match_record_delete;
        CREATE TABLE translation_candidates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          src TEXT NOT NULL, zh TEXT NOT NULL,
          src_lang TEXT NOT NULL DEFAULT 'ja', tgt_lang TEXT NOT NULL DEFAULT 'zh',
          engine TEXT, category TEXT, updated_at INTEGER NOT NULL,
          hit_count INTEGER NOT NULL DEFAULT 0, nsfw INTEGER NOT NULL DEFAULT 0,
          engine_rank INTEGER NOT NULL DEFAULT 1
        );
        INSERT INTO translation_candidates
          SELECT rowid,src,zh,src_lang,tgt_lang,engine,category,updated_at,hit_count,nsfw,
            CASE
              WHEN engine='manual' THEN 4
              WHEN engine='import' OR engine LIKE 'import:%' THEN 3
              WHEN engine='live:optimize' OR engine LIKE 'live:optimize:%' OR engine LIKE 'live:agent%' THEN 2
              WHEN engine='manual:optimize' THEN 0
              ELSE 1
            END
          FROM translations;
      `);
      const records2 = client.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='translation_records'").get();
      if (records2) {
        const sequence = client.prepare("SELECT seq FROM sqlite_sequence WHERE name='translation_records'").get();
        client.exec(`
          CREATE TABLE candidate_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT, src TEXT NOT NULL,
            src_lang TEXT NOT NULL, tgt_lang TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
            translation_id INTEGER NOT NULL UNIQUE
          );
          INSERT INTO candidate_records
            SELECT r.id,r.src,r.src_lang,r.tgt_lang,r.revision,t.id
            FROM translation_records r JOIN translation_candidates t
              ON t.src=r.src AND t.src_lang=r.src_lang AND t.tgt_lang=r.tgt_lang;
          DROP TABLE translation_records;
          ALTER TABLE candidate_records RENAME TO translation_records;
        `);
        if (sequence) client.prepare("UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='translation_records'").run(sequence.seq);
      }
      client.exec(`
        DROP TABLE translations;
        ALTER TABLE translation_candidates RENAME TO translations;
        INSERT OR REPLACE INTO cache_meta(key,value) VALUES('translation_candidates_v1','1');
      `);
      client.exec("COMMIT");
    } catch (error) {
      client.exec("ROLLBACK");
      throw error;
    }
  }
  client.exec(`
    CREATE INDEX IF NOT EXISTS idx_translation_selection
      ON translations(src,src_lang,tgt_lang,engine_rank DESC,updated_at DESC,id DESC);
    CREATE VIEW IF NOT EXISTS selected_translations AS
      SELECT t.* FROM translations t
      WHERE t.id=(
        SELECT candidate.id FROM translations candidate
        WHERE candidate.src=t.src AND candidate.src_lang=t.src_lang AND candidate.tgt_lang=t.tgt_lang
        ORDER BY candidate.engine_rank DESC,candidate.updated_at DESC,candidate.id DESC LIMIT 1
      );
  `);
}

// services/translate/shared-cache/match-index.ts
var toRecord = (r) => ({
  id: String(r.id),
  candidateId: r.translation_id,
  revision: r.revision,
  src: r.src,
  zh: r.zh,
  engine: r.engine,
  category: r.category || null,
  from: r.src_lang,
  to: r.tgt_lang
});
function migrateMatchKeysKindColumn(client) {
  const cols = client.prepare("PRAGMA table_info(match_keys)").all();
  if (!cols.length || cols.some((c) => c.name === "kind")) return;
  client.exec("BEGIN IMMEDIATE");
  try {
    client.exec(`
      DROP TRIGGER IF EXISTS match_record_insert;
      DROP TRIGGER IF EXISTS match_record_update;
      DROP TRIGGER IF EXISTS match_record_delete;
      CREATE TABLE match_keys_kind (
        record_id INTEGER NOT NULL, match_key TEXT NOT NULL, src_lang TEXT NOT NULL, tgt_lang TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'canonical', PRIMARY KEY(record_id,match_key,kind)
      );
      INSERT OR IGNORE INTO match_keys_kind(record_id,match_key,src_lang,tgt_lang,kind)
        SELECT record_id, match_key, src_lang, tgt_lang, 'canonical' FROM match_keys;
      DROP TABLE match_keys;
      ALTER TABLE match_keys_kind RENAME TO match_keys;
      CREATE INDEX IF NOT EXISTS idx_match_key ON match_keys(src_lang,tgt_lang,match_key);
      DELETE FROM cache_meta WHERE key='sentence_index_v10_exact_keys';
    `);
    client.exec("COMMIT");
  } catch (e) {
    client.exec("ROLLBACK");
    throw e;
  }
}
function ensureMatchIndex(client) {
  client.function("chaya_alias_keys", (src, zh) => JSON.stringify(sentenceAliases(String(src), String(zh)).map((p) => wholeSentenceKey(p.src))));
  client.function("chaya_numeric_family", (src) => numericLabelFamily(String(src)) || "");
  client.function("chaya_sentence_key", (src) => wholeSentenceKey(String(src)));
  client.function("chaya_logic_key", (src) => wholeSentenceKey(buildLogicText(String(src)).logic));
  client.function("chaya_sentence_units", (src) => JSON.stringify(sentenceUnits(String(src))));
  client.exec(`
    CREATE TABLE IF NOT EXISTS translation_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT, src TEXT NOT NULL,
      src_lang TEXT NOT NULL, tgt_lang TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      translation_id INTEGER NOT NULL UNIQUE
    );
    CREATE INDEX IF NOT EXISTS idx_translation_record_source ON translation_records(src,src_lang,tgt_lang);
    CREATE TABLE IF NOT EXISTS match_keys (
      record_id INTEGER NOT NULL, match_key TEXT NOT NULL, src_lang TEXT NOT NULL, tgt_lang TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'canonical', PRIMARY KEY(record_id,match_key,kind)
    );
    CREATE TABLE IF NOT EXISTS cache_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);
  migrateMatchKeysKindColumn(client);
  client.exec(`
    CREATE TABLE IF NOT EXISTS translation_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT, src TEXT NOT NULL,
      src_lang TEXT NOT NULL, tgt_lang TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      translation_id INTEGER NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS match_keys (
      record_id INTEGER NOT NULL, match_key TEXT NOT NULL, src_lang TEXT NOT NULL, tgt_lang TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'canonical', PRIMARY KEY(record_id,match_key,kind)
    );
    CREATE INDEX IF NOT EXISTS idx_match_key ON match_keys(src_lang,tgt_lang,match_key);
    CREATE TABLE IF NOT EXISTS sentence_positions (
      record_id INTEGER NOT NULL, position INTEGER NOT NULL, body_key TEXT NOT NULL, tone TEXT NOT NULL,
      src_lang TEXT NOT NULL, tgt_lang TEXT NOT NULL, PRIMARY KEY(record_id,position)
    );
    CREATE INDEX IF NOT EXISTS idx_sentence_key ON sentence_positions(src_lang,tgt_lang,body_key,tone);
    CREATE TABLE IF NOT EXISTS numeric_label_keys (
      record_id INTEGER PRIMARY KEY, family TEXT NOT NULL, src_lang TEXT NOT NULL, tgt_lang TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_numeric_family ON numeric_label_keys(src_lang,tgt_lang,family);
    CREATE TABLE IF NOT EXISTS alignment_groups (
      record_id INTEGER NOT NULL, revision INTEGER NOT NULL, groups_json TEXT NOT NULL, PRIMARY KEY(record_id)
    );
    CREATE TABLE IF NOT EXISTS structure_annotations (
      record_id INTEGER NOT NULL, revision INTEGER NOT NULL, annotations_json TEXT NOT NULL, PRIMARY KEY(record_id)
    );
    CREATE TABLE IF NOT EXISTS newline_annotations (
      record_id INTEGER NOT NULL, revision INTEGER NOT NULL, annotations_json TEXT NOT NULL, PRIMARY KEY(record_id)
    );
    CREATE TABLE IF NOT EXISTS translation_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT, record_id INTEGER NOT NULL, revision INTEGER NOT NULL, kind TEXT NOT NULL
    );
    INSERT OR IGNORE INTO cache_meta(key,value) VALUES ('sentence_version','0');
    DROP TRIGGER IF EXISTS match_record_insert;
    DROP TRIGGER IF EXISTS match_record_update;
    CREATE TRIGGER match_record_insert AFTER INSERT ON translation_records BEGIN
      INSERT INTO numeric_label_keys SELECT NEW.id,chaya_numeric_family(NEW.src),NEW.src_lang,NEW.tgt_lang WHERE chaya_numeric_family(NEW.src)<>'';
      INSERT INTO match_keys VALUES (NEW.id,chaya_sentence_key(NEW.src),NEW.src_lang,NEW.tgt_lang,'canonical');
      INSERT OR IGNORE INTO match_keys VALUES (NEW.id,chaya_logic_key(NEW.src),NEW.src_lang,NEW.tgt_lang,'logic');
      INSERT OR IGNORE INTO match_keys SELECT NEW.id,j.value,NEW.src_lang,NEW.tgt_lang,'alias' FROM json_each(chaya_alias_keys(NEW.src,(SELECT zh FROM translations WHERE id=NEW.translation_id))) j;
      INSERT INTO sentence_positions SELECT NEW.id,CAST(j.key AS INTEGER),json_extract(j.value,'$.key'),json_extract(j.value,'$.tone'),NEW.src_lang,NEW.tgt_lang FROM json_each(chaya_sentence_units(NEW.src)) AS j;
      UPDATE cache_meta SET value=CAST(value AS INTEGER)+1 WHERE key='sentence_version';
    END;
    CREATE TRIGGER match_record_update AFTER UPDATE ON translation_records BEGIN
      DELETE FROM alignment_groups WHERE record_id=NEW.id;
      DELETE FROM newline_annotations WHERE record_id=NEW.id;
      DELETE FROM structure_annotations WHERE record_id=NEW.id;
      DELETE FROM match_keys WHERE record_id=NEW.id AND kind IN ('alias','logic');
      DELETE FROM sentence_positions WHERE record_id=NEW.id;
      INSERT OR IGNORE INTO match_keys VALUES (NEW.id,chaya_logic_key(NEW.src),NEW.src_lang,NEW.tgt_lang,'logic');
      INSERT OR IGNORE INTO match_keys SELECT NEW.id,j.value,NEW.src_lang,NEW.tgt_lang,'alias' FROM json_each(chaya_alias_keys(NEW.src,(SELECT zh FROM translations WHERE id=NEW.translation_id))) j;
      INSERT INTO sentence_positions SELECT NEW.id,CAST(j.key AS INTEGER),json_extract(j.value,'$.key'),json_extract(j.value,'$.tone'),NEW.src_lang,NEW.tgt_lang FROM json_each(chaya_sentence_units(NEW.src)) AS j;
      INSERT INTO translation_outbox(record_id,revision,kind) VALUES (NEW.id,NEW.revision,'update');
      UPDATE cache_meta SET value=CAST(value AS INTEGER)+1 WHERE key='sentence_version';
    END;
    DROP TRIGGER IF EXISTS match_record_delete;
    CREATE TRIGGER match_record_delete AFTER DELETE ON translation_records BEGIN
      DELETE FROM numeric_label_keys WHERE record_id=OLD.id;
      DELETE FROM match_keys WHERE record_id=OLD.id;
      DELETE FROM sentence_positions WHERE record_id=OLD.id;
      DELETE FROM alignment_groups WHERE record_id=OLD.id;
      DELETE FROM newline_annotations WHERE record_id=OLD.id;
      DELETE FROM structure_annotations WHERE record_id=OLD.id;
      INSERT INTO translation_outbox(record_id,revision,kind) VALUES (OLD.id,OLD.revision+1,'delete');
      UPDATE cache_meta SET value=CAST(value AS INTEGER)+1 WHERE key='sentence_version';
    END;
    CREATE TRIGGER IF NOT EXISTS translation_match_insert AFTER INSERT ON translations BEGIN
      INSERT INTO translation_records(src,src_lang,tgt_lang,translation_id) VALUES(NEW.src,NEW.src_lang,NEW.tgt_lang,NEW.id);
    END;
    CREATE TRIGGER IF NOT EXISTS translation_match_update AFTER UPDATE OF zh,engine ON translations
      WHEN OLD.zh IS NOT NEW.zh OR OLD.engine IS NOT NEW.engine BEGIN
      UPDATE translation_records SET revision=revision+1 WHERE translation_id=NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS translation_match_delete AFTER DELETE ON translations BEGIN
      DELETE FROM translation_records WHERE translation_id=OLD.id;
    END;
  `);
  if (!client.prepare("SELECT value FROM cache_meta WHERE key='sentence_index_v1'").get()) {
    client.exec("BEGIN IMMEDIATE");
    try {
      client.exec(`INSERT OR IGNORE INTO translation_records(src,src_lang,tgt_lang,translation_id) SELECT src,src_lang,tgt_lang,id FROM translations;
        INSERT OR REPLACE INTO cache_meta(key,value) VALUES('sentence_index_v1','1');`);
      client.exec("COMMIT");
    } catch (e) {
      client.exec("ROLLBACK");
      throw e;
    }
  }
}
function ensureMatchIndexSchema(client) {
  ensureMatchIndex(client);
}
function needsSentenceIndexV10(client) {
  return !client.prepare("SELECT value FROM cache_meta WHERE key='sentence_index_v10_exact_keys'").get();
}
function rebuildSentenceIndexV10Rows(client, rows) {
  client.exec(
    "DELETE FROM numeric_label_keys; INSERT INTO numeric_label_keys SELECT id,chaya_numeric_family(src),src_lang,tgt_lang FROM translation_records WHERE chaya_numeric_family(src)<>'';"
  );
  const delPos = client.prepare("DELETE FROM sentence_positions WHERE record_id=?");
  const delKeys = client.prepare("DELETE FROM match_keys WHERE record_id=?");
  const insKey = client.prepare("INSERT OR IGNORE INTO match_keys VALUES (?,?,?,?,?)");
  const insPos = client.prepare("INSERT INTO sentence_positions VALUES (?,?,?,?,?,?)");
  const zhOf = client.prepare("SELECT zh FROM translations WHERE id=?");
  const structureOf = client.prepare("SELECT annotations_json FROM structure_annotations WHERE record_id=? AND revision=?");
  const nlOf = client.prepare("SELECT annotations_json FROM newline_annotations WHERE record_id=? AND revision=?");
  for (const row of rows) {
    const nlRow = nlOf.get(row.id, row.revision);
    const newlines = nlRow ? JSON.parse(nlRow.annotations_json) : void 0;
    const st = structureOf.get(row.id, row.revision);
    const structure = st ? JSON.parse(st.annotations_json) : void 0;
    const unitOpts = { newlines, structure: structure?.source, srcLang: row.src_lang };
    delPos.run(row.id);
    delKeys.run(row.id);
    const logicKey = wholeSentenceKey(buildLogicText(row.src, unitOpts).logic);
    const canon = wholeSentenceKey(row.src);
    insKey.run(row.id, canon, row.src_lang, row.tgt_lang, "canonical");
    if (logicKey !== canon) insKey.run(row.id, logicKey, row.src_lang, row.tgt_lang, "logic");
    const zh = zhOf.get(row.translation_id)?.zh ?? "";
    for (const alias of sentenceAliases(row.src, zh)) {
      insKey.run(row.id, wholeSentenceKey(alias.src), row.src_lang, row.tgt_lang, "alias");
    }
    sentenceUnits(row.src, unitOpts).forEach((unit, position) => insPos.run(row.id, position, unit.key, unit.tone, row.src_lang, row.tgt_lang));
  }
}
function rebuildSentenceIndexV10(client) {
  if (!needsSentenceIndexV10(client)) return;
  client.exec("BEGIN IMMEDIATE");
  try {
    const rows = client.prepare("SELECT id, translation_id, src, src_lang, tgt_lang, revision FROM translation_records").all();
    rebuildSentenceIndexV10Rows(client, rows);
    client.prepare("INSERT OR REPLACE INTO cache_meta(key,value) VALUES('sentence_index_v10_exact_keys','1')").run();
    client.exec("COMMIT");
  } catch (e) {
    client.exec("ROLLBACK");
    throw e;
  }
}
async function rebuildSentenceIndexV10Async(client, yieldEvery = 80) {
  if (!needsSentenceIndexV10(client)) return;
  const rows = client.prepare("SELECT id, translation_id, src, src_lang, tgt_lang, revision FROM translation_records").all();
  client.exec("BEGIN IMMEDIATE");
  try {
    client.exec(
      "DELETE FROM numeric_label_keys; INSERT INTO numeric_label_keys SELECT id,chaya_numeric_family(src),src_lang,tgt_lang FROM translation_records WHERE chaya_numeric_family(src)<>'';"
    );
    const delPos = client.prepare("DELETE FROM sentence_positions WHERE record_id=?");
    const delKeys = client.prepare("DELETE FROM match_keys WHERE record_id=?");
    const insKey = client.prepare("INSERT OR IGNORE INTO match_keys VALUES (?,?,?,?,?)");
    const insPos = client.prepare("INSERT INTO sentence_positions VALUES (?,?,?,?,?,?)");
    const zhOf = client.prepare("SELECT zh FROM translations WHERE id=?");
    const structureOf = client.prepare("SELECT annotations_json FROM structure_annotations WHERE record_id=? AND revision=?");
    const nlOf = client.prepare("SELECT annotations_json FROM newline_annotations WHERE record_id=? AND revision=?");
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const nlRow = nlOf.get(row.id, row.revision);
      const newlines = nlRow ? JSON.parse(nlRow.annotations_json) : void 0;
      const st = structureOf.get(row.id, row.revision);
      const structure = st ? JSON.parse(st.annotations_json) : void 0;
      const unitOpts = { newlines, structure: structure?.source, srcLang: row.src_lang };
      delPos.run(row.id);
      delKeys.run(row.id);
      const logicKey = wholeSentenceKey(buildLogicText(row.src, unitOpts).logic);
      const canon = wholeSentenceKey(row.src);
      insKey.run(row.id, canon, row.src_lang, row.tgt_lang, "canonical");
      if (logicKey !== canon) insKey.run(row.id, logicKey, row.src_lang, row.tgt_lang, "logic");
      const zh = zhOf.get(row.translation_id)?.zh ?? "";
      for (const alias of sentenceAliases(row.src, zh)) {
        insKey.run(row.id, wholeSentenceKey(alias.src), row.src_lang, row.tgt_lang, "alias");
      }
      sentenceUnits(row.src, unitOpts).forEach((unit, position) => insPos.run(row.id, position, unit.key, unit.tone, row.src_lang, row.tgt_lang));
      if (i > 0 && i % yieldEvery === 0) {
        client.exec("COMMIT");
        await new Promise((r) => setTimeout(r, 0));
        client.exec("BEGIN IMMEDIATE");
      }
    }
    client.prepare("INSERT OR REPLACE INTO cache_meta(key,value) VALUES('sentence_index_v10_exact_keys','1')").run();
    client.exec("COMMIT");
  } catch (e) {
    try {
      client.exec("ROLLBACK");
    } catch {
    }
    throw e;
  }
}
function createMatchIndex(client) {
  const statements = /* @__PURE__ */ new Map();
  function prepare(sql2) {
    let statement = statements.get(sql2);
    if (!statement) {
      statement = client.prepare(sql2);
      statements.set(sql2, statement);
    }
    return statement;
  }
  const rawJoined = "SELECT DISTINCT r.*,t.zh,t.engine,t.category FROM translation_records r JOIN translations t ON t.id=r.translation_id";
  const joined = rawJoined.replace("JOIN translations t", "JOIN selected_translations t");
  function reindexWithNewlines(row, newlines, structure) {
    const unitOpts = { newlines, structure: structure?.source, srcLang: row.src_lang };
    prepare("DELETE FROM sentence_positions WHERE record_id=?").run(row.id);
    prepare("DELETE FROM match_keys WHERE record_id=? AND kind IN ('alias','logic')").run(row.id);
    const logicKey = wholeSentenceKey(buildLogicText(row.src, unitOpts).logic);
    const canon = wholeSentenceKey(row.src);
    if (logicKey !== canon) {
      prepare("INSERT OR IGNORE INTO match_keys VALUES (?,?,?,?,?)").run(row.id, logicKey, row.src_lang, row.tgt_lang, "logic");
    }
    for (const alias of sentenceAliases(row.src, row.zh)) {
      prepare("INSERT OR IGNORE INTO match_keys VALUES (?,?,?,?,?)").run(row.id, wholeSentenceKey(alias.src), row.src_lang, row.tgt_lang, "alias");
    }
    const units = sentenceUnits(row.src, unitOpts);
    const insertPos = prepare("INSERT INTO sentence_positions VALUES (?,?,?,?,?,?)");
    units.forEach((unit, position) => insertPos.run(row.id, position, unit.key, unit.tone, row.src_lang, row.tgt_lang));
  }
  function attach(row) {
    const record2 = toRecord(row);
    const alignment = prepare("SELECT groups_json FROM alignment_groups WHERE record_id=? AND revision=?").get(row.id, row.revision);
    if (alignment) record2.alignments = JSON.parse(alignment.groups_json);
    const newlines = prepare("SELECT annotations_json FROM newline_annotations WHERE record_id=? AND revision=?").get(row.id, row.revision);
    if (newlines) record2.newlines = JSON.parse(newlines.annotations_json);
    const structure = prepare("SELECT annotations_json FROM structure_annotations WHERE record_id=? AND revision=?").get(row.id, row.revision);
    if (structure) record2.structure = JSON.parse(structure.annotations_json);
    return record2;
  }
  function inserted(translationId) {
    const row = prepare(rawJoined + " WHERE t.id=?").get(translationId);
    return row ? attach(row) : null;
  }
  function record(src, pair) {
    const r = prepare(joined + " WHERE r.src=? AND r.src_lang=? AND r.tgt_lang=?").get(src, pair.from, pair.to);
    return r ? attach(r) : null;
  }
  function equivalent(src, pair) {
    const key2 = wholeSentenceKey(src);
    return prepare(joined + " JOIN match_keys k ON k.record_id=r.id WHERE k.match_key=? AND k.src_lang=? AND k.tgt_lang=? AND k.kind='canonical' LIMIT 501").all(
      key2,
      pair.from,
      pair.to
    ).map(attach);
  }
  function candidates2(src, pair, opts) {
    const found = /* @__PURE__ */ new Map();
    const keyQuery = prepare(joined + " JOIN match_keys k ON k.record_id=r.id WHERE k.match_key=? AND k.src_lang=? AND k.tgt_lang=? LIMIT 501");
    const lookupKeys = sentenceQueryKeys(src, opts);
    for (const key2 of lookupKeys) {
      for (const row of keyQuery.all(key2, pair.from, pair.to)) {
        if (!found.has(String(row.id))) found.set(String(row.id), attach(row));
        if (found.size > 500) return { records: [], limited: true };
      }
    }
    const whole = [...found.values()];
    for (const unit of sentenceQueryUnits(src, opts)) {
      if (unit.boundary === "structure") {
        const exactItems = keyQuery.all(wholeSentenceKey(src.slice(unit.start, unit.end)), pair.from, pair.to);
        if (exactItems.length > 500) return { records: whole.length > 500 ? [] : whole, limited: true };
        for (const row of exactItems) {
          if (!found.has(String(row.id))) found.set(String(row.id), attach(row));
          if (found.size > 500) return { records: [], limited: true };
        }
      }
      const rows = prepare(joined + " JOIN sentence_positions p ON p.record_id=r.id WHERE p.body_key=? AND p.tone=? AND p.src_lang=? AND p.tgt_lang=? LIMIT 501").all(
        unit.key,
        unit.tone,
        pair.from,
        pair.to
      );
      if (new Set(rows.map((r) => r.id)).size > 500 || found.size > 500) return { records: whole.length > 500 ? [] : whole, limited: true };
      for (const row of rows) {
        if (!found.has(String(row.id))) found.set(String(row.id), attach(row));
        if (found.size > 500) return { records: [], limited: true };
      }
    }
    return found.size > 500 ? { records: [], limited: true } : { records: [...found.values()], limited: false };
  }
  return {
    record,
    inserted,
    equivalent,
    candidates: candidates2,
    numericRecords(pair, src) {
      const family = numericLabelFamily(src);
      const rows = family ? prepare(joined + " JOIN numeric_label_keys n ON n.record_id=r.id WHERE n.src_lang=? AND n.tgt_lang=? AND n.family=? LIMIT 501").all(
        pair.from,
        pair.to,
        family
      ) : [];
      return Object.assign(rows.map(attach), { limited: rows.length > 500 });
    },
    version: () => String(prepare("SELECT value FROM cache_meta WHERE key='sentence_version'").get().value),
    current(records2) {
      return records2.every((r) => Number(prepare(joined + " WHERE r.id=?").get(r.id)?.revision) === r.revision);
    },
    plan(src, pair, local = [], opts) {
      client.exec("BEGIN");
      try {
        const selected = candidates2(src, pair, opts);
        const limited = selected.limited || local.limited === true;
        const resolved = planSentenceTranslation(src, limited ? [] : [...local, ...selected.records].filter((r) => pair.to !== "zh" || isReusableTranslation(r.src, r.zh)), opts);
        const plan = {
          ...resolved,
          limited: limited || resolved.limited,
          ruleVersion: SENTENCE_RULE_VERSION,
          corpusVersion: String(prepare("SELECT value FROM cache_meta WHERE key='sentence_version'").get().value)
        };
        client.exec("COMMIT");
        return plan;
      } catch (e) {
        client.exec("ROLLBACK");
        throw e;
      }
    },
    setAlignment(src, pair, groups, expectedRevision, opts) {
      const r = opts?.candidateId ? inserted(opts.candidateId) : record(src, pair);
      if (r && (r.src !== src || r.from !== pair.from || r.to !== pair.to)) return false;
      if (!r || expectedRevision !== void 0 && r.revision !== expectedRevision || groups.length > 1e3) return false;
      const structure = opts?.structure ?? r.structure;
      if (structure && !validRecordStructure(structure)) return false;
      const nextNewlines = opts?.newlines !== void 0 ? opts.newlines : r.newlines;
      if (nextNewlines && !validateNewlineAnnotations(src, nextNewlines)) return false;
      const draft = { ...r, newlines: nextNewlines, structure };
      if (!validateAlignments(draft, groups)) return false;
      client.exec("BEGIN IMMEDIATE");
      try {
        if (!prepare("UPDATE translation_records SET revision=revision+1 WHERE id=? AND revision=?").run(r.id, r.revision).changes) {
          client.exec("ROLLBACK");
          return false;
        }
        const nextRevision = r.revision + 1;
        prepare("INSERT OR REPLACE INTO alignment_groups VALUES(?,?,?)").run(r.id, nextRevision, JSON.stringify(groups));
        if (nextNewlines?.length) {
          prepare("INSERT OR REPLACE INTO newline_annotations VALUES(?,?,?)").run(r.id, nextRevision, JSON.stringify(nextNewlines));
        }
        const row = prepare(rawJoined + " WHERE r.id=?").get(r.id);
        if (structure) prepare("INSERT OR REPLACE INTO structure_annotations VALUES(?,?,?)").run(r.id, nextRevision, JSON.stringify(structure));
        reindexWithNewlines(row, nextNewlines, structure);
        client.exec("COMMIT");
        return true;
      } catch (e) {
        client.exec("ROLLBACK");
        throw e;
      }
    },
    authority(src, pair, opts) {
      const want = String(opts?.category || "").trim();
      const records2 = prepare(
        rawJoined + ` JOIN match_keys k ON k.record_id=r.id
        WHERE k.match_key=? AND k.src_lang=? AND k.tgt_lang=? AND k.kind='canonical'
          AND t.id=(SELECT c.id FROM translations c
            WHERE c.src=t.src AND c.src_lang=t.src_lang AND c.tgt_lang=t.tgt_lang
            ORDER BY c.engine_rank DESC,CASE WHEN c.category=? THEN 1 ELSE 0 END DESC,c.updated_at DESC,c.id DESC LIMIT 1)
        ORDER BY t.updated_at DESC,t.id DESC LIMIT 501`
      ).all(wholeSentenceKey(src), pair.from, pair.to, want).map(attach);
      if (!records2.length || records2.length > 500) return null;
      const rank = Math.max(...records2.map((r) => cacheEngineRank(r.engine)));
      let top = records2.filter((r) => cacheEngineRank(r.engine) === rank);
      if (want) {
        const matched = top.filter((r) => r.category === want);
        if (matched.length) top = matched;
      }
      if (new Set(top.map((r) => r.zh)).size !== 1) return top.find((r) => r.src === src) || null;
      return top[0];
    }
  };
}

// services/translate/shared-cache/migrate-bg.ts
import fs9 from "node:fs";
import path7 from "node:path";
import { DatabaseSync as DatabaseSync3 } from "node:sqlite";

// services/jobs/single-flight.ts
function singleFlight(flights2, key2, run) {
  const existing = flights2.get(key2);
  if (existing) return existing;
  const pending = run().finally(() => {
    if (flights2.get(key2) === pending) flights2.delete(key2);
  });
  flights2.set(key2, pending);
  return pending;
}
function yieldEventLoop() {
  return new Promise((resolve2) => {
    setImmediate(resolve2);
  });
}

// services/translate/shared-cache/migrate-bg.ts
var flights = /* @__PURE__ */ new Map();
var migrating = /* @__PURE__ */ new Set();
function isSharedIdenticalPair(src, tgt) {
  if (isIdenticalTranslation(src, tgt)) return true;
  const a = normalizeTranslateKey(src);
  const b = normalizeTranslateKey(tgt);
  return Boolean(a) && isIdenticalTranslation(a, b);
}
function runSharedCacheHeavyMigrateSync(dbPath) {
  const resolved = path7.resolve(dbPath);
  if (!fs9.existsSync(resolved)) return;
  const client = new DatabaseSync3(resolved);
  try {
    client.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000");
    ensureMatchIndex(client);
    if (needsSentenceIndexV10(client)) rebuildSentenceIndexV10(client);
    const flagged = client.prepare("SELECT value FROM cache_meta WHERE key='scrub_identical_v1'").get();
    if (!flagged) {
      scrubIdenticalSync(client);
      client.prepare("INSERT OR REPLACE INTO cache_meta(key,value) VALUES('scrub_identical_v1','1')").run();
    }
  } finally {
    client.close();
  }
}
function scheduleSharedCacheHeavyMigrate(dbPath) {
  const resolved = path7.resolve(dbPath);
  if (!fs9.existsSync(resolved)) return;
  if (process.env.JEST_WORKER_ID) {
    runSharedCacheHeavyMigrateSync(resolved);
    return;
  }
  void singleFlight(flights, `shared-migrate:${resolved}`, async () => {
    migrating.add(resolved);
    try {
      await yieldEventLoop();
      const client = new DatabaseSync3(resolved);
      try {
        client.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000");
        ensureMatchIndex(client);
        if (needsSentenceIndexV10(client)) {
          await rebuildSentenceIndexV10Async(client);
          await yieldEventLoop();
        }
        const flagged = client.prepare("SELECT value FROM cache_meta WHERE key='scrub_identical_v1'").get();
        if (!flagged) {
          await scrubIdenticalChunked(client);
          client.prepare("INSERT OR REPLACE INTO cache_meta(key,value) VALUES('scrub_identical_v1','1')").run();
        }
      } finally {
        client.close();
      }
    } finally {
      migrating.delete(resolved);
    }
  }).catch(() => {
  });
}
function scrubIdenticalSync(client) {
  const rows = client.prepare("SELECT id, src, zh, src_lang, tgt_lang, engine FROM translations").all();
  const del = client.prepare("DELETE FROM translations WHERE id=?");
  client.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      const engine = row.engine == null ? null : String(row.engine);
      if (engine === "skip:control" || engine === "skip:sensitive" || isSharedIdenticalPair(String(row.src), String(row.zh))) {
        del.run(row.id);
      }
    }
    client.exec("COMMIT");
  } catch (e) {
    try {
      client.exec("ROLLBACK");
    } catch {
    }
    throw e;
  }
}
async function scrubIdenticalChunked(client) {
  const rows = client.prepare("SELECT id, src, zh, src_lang, tgt_lang, engine FROM translations").all();
  const del = client.prepare("DELETE FROM translations WHERE id=?");
  client.exec("BEGIN IMMEDIATE");
  try {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const engine = row.engine == null ? null : String(row.engine);
      if (engine === "skip:control" || engine === "skip:sensitive" || isSharedIdenticalPair(String(row.src), String(row.zh))) {
        del.run(row.id);
      }
      if (i % 200 === 199) {
        client.exec("COMMIT");
        await yieldEventLoop();
        client.exec("BEGIN IMMEDIATE");
      }
    }
    client.exec("COMMIT");
  } catch (e) {
    try {
      client.exec("ROLLBACK");
    } catch {
    }
    throw e;
  }
}

// services/translate/shared-cache/schema.ts
var translations = sqliteTable("translations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  src: text("src").notNull(),
  zh: text("zh").notNull(),
  /** Source language of `src` (ja / en / zh / ko). */
  srcLang: text("src_lang").notNull().default("ja"),
  /** Target language of `zh` (ja / en / zh / ko). */
  tgtLang: text("tgt_lang").notNull().default("zh"),
  engine: text("engine"),
  /** Optional extract/live text category (dialogue, item, …); imports may leave null. */
  category: text("category"),
  updatedAt: integer("updated_at").notNull(),
  hitCount: integer("hit_count").notNull().default(0),
  nsfw: integer("nsfw").notNull().default(0),
  engineRank: integer("engine_rank").notNull().default(1)
});
var cacheMeta = sqliteTable("cache_meta", {
  key: text("key").primaryKey().notNull(),
  value: text("value").notNull()
});
var gameTranslations = sqliteTable(
  "game_translations",
  {
    gameId: text("game_id").notNull(),
    src: text("src").notNull(),
    srcLang: text("src_lang").notNull().default("ja"),
    tgtLang: text("tgt_lang").notNull().default("zh"),
    zh: text("zh"),
    engine: text("engine").notNull().default("manual"),
    category: text("category"),
    isDeleted: integer("is_deleted").notNull().default(0),
    recordJson: text("record_json"),
    hitCount: integer("hit_count").notNull().default(0),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.src, table.srcLang, table.tgtLang] }),
    index("idx_game_trans_lookup").on(table.gameId, table.srcLang, table.tgtLang, table.isDeleted),
    index("idx_game_trans_updated").on(table.gameId, table.updatedAt)
  ]
);
var gameIdentities = sqliteTable("game_identities", {
  gameId: text("game_id").primaryKey().notNull(),
  engine: text("engine").notNull(),
  title: text("title").notNull(),
  signatureBaseline: text("signature_baseline").notNull(),
  signatureVersion: integer("signature_version").notNull().default(1),
  boundPath: text("bound_path").notNull(),
  firstBoundAt: integer("first_bound_at").notNull(),
  lastVerifiedAt: integer("last_verified_at").notNull()
});
var mutationLog = sqliteTable("mutation_log", {
  idempotencyKey: text("idempotency_key").primaryKey().notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  requestHash: text("request_hash").notNull().default(""),
  resultJson: text("result_json").notNull().default("{}"),
  createdAt: integer("created_at").notNull()
});

// services/translate/shared-cache/db.ts
function defaultSharedDbPath() {
  return TRANSLATE_CACHE_DB_PATH;
}
function tableColumns(client) {
  return client.prepare("PRAGMA table_info(translations)").all();
}
function rowPair(src, srcLang, tgtLang) {
  return and(eq(translations.src, src), eq(translations.srcLang, srcLang), eq(translations.tgtLang, tgtLang));
}
function migrateLangPairTable(db, client) {
  const cols = tableColumns(client);
  if (!cols.length) return;
  if (cols.some((c) => c.name === "src_lang") && cols.some((c) => c.name === "tgt_lang")) return;
  if (!cols.some((c) => c.name === "nsfw")) {
    db.run(sql`ALTER TABLE translations ADD COLUMN nsfw INTEGER NOT NULL DEFAULT 0`);
  }
  db.run(sql`
    CREATE TABLE translations_lang_pair (
      src TEXT NOT NULL,
      zh TEXT NOT NULL,
      src_lang TEXT NOT NULL DEFAULT 'ja',
      tgt_lang TEXT NOT NULL DEFAULT 'zh',
      engine TEXT,
      updated_at INTEGER NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0,
      nsfw INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (src, src_lang, tgt_lang)
    )
  `);
  const legacy = client.prepare("SELECT src, zh, engine, updated_at, hit_count, nsfw FROM translations").all();
  const insert = client.prepare(
    `INSERT OR REPLACE INTO translations_lang_pair
      (src, zh, src_lang, tgt_lang, engine, updated_at, hit_count, nsfw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  client.exec("BEGIN");
  try {
    for (const row of legacy) {
      const src = String(row.src);
      const zh = String(row.zh);
      insert.run(src, zh, detectCacheLang(src), DEFAULT_CACHE_TGT_LANG, row.engine, Number(row.updated_at) || 0, Number(row.hit_count) || 0, Number(row.nsfw) || 0);
    }
    client.exec("COMMIT");
  } catch (error) {
    client.exec("ROLLBACK");
    throw error;
  }
  db.run(sql`DROP TABLE translations`);
  db.run(sql`ALTER TABLE translations_lang_pair RENAME TO translations`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_translations_updated ON translations(updated_at)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_translations_nsfw ON translations(nsfw)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_translations_langs ON translations(src_lang, tgt_lang)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_translations_zh ON translations(zh)`);
}
function repairLegacyTargetLang(db, client) {
  const meta = db.select().from(cacheMeta).where(eq(cacheMeta.key, "lang_pair_tgt_zh")).get();
  if (meta?.value === "1") return;
  client.exec(`
    DELETE FROM translations
    WHERE tgt_lang = src_lang
      AND tgt_lang != 'zh'
      AND EXISTS (
        SELECT 1 FROM translations AS other
        WHERE other.src = translations.src
          AND other.src_lang = translations.src_lang
          AND other.tgt_lang = 'zh'
      );
    UPDATE translations
    SET tgt_lang = 'zh'
    WHERE tgt_lang = src_lang AND tgt_lang != 'zh';
  `);
  db.insert(cacheMeta).values({ key: "lang_pair_tgt_zh", value: "1" }).onConflictDoUpdate({ target: cacheMeta.key, set: { value: "1" } }).run();
}
function ensureSchema(db, client) {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS translations (
      src TEXT NOT NULL,
      zh TEXT NOT NULL,
      src_lang TEXT NOT NULL DEFAULT 'ja',
      tgt_lang TEXT NOT NULL DEFAULT 'zh',
      engine TEXT,
      category TEXT,
      updated_at INTEGER NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0,
      nsfw INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (src, src_lang, tgt_lang)
    )
  `);
  db.run(sql`
    CREATE TABLE IF NOT EXISTS cache_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    )
  `);
  db.run(sql`
    CREATE TABLE IF NOT EXISTS game_translations (
      game_id TEXT NOT NULL,
      src TEXT NOT NULL,
      src_lang TEXT NOT NULL DEFAULT 'ja',
      tgt_lang TEXT NOT NULL DEFAULT 'zh',
      zh TEXT,
      engine TEXT NOT NULL DEFAULT 'manual',
      category TEXT,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      record_json TEXT,
      hit_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (game_id, src, src_lang, tgt_lang)
    )
  `);
  const gameCols = client.prepare("PRAGMA table_info(game_translations)").all();
  if (!gameCols.some((c) => c.name === "record_json")) client.exec("ALTER TABLE game_translations ADD COLUMN record_json TEXT");
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_game_trans_lookup ON game_translations(game_id, src_lang, tgt_lang, is_deleted)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_game_trans_updated ON game_translations(game_id, updated_at)`);
  db.run(sql`
    CREATE TABLE IF NOT EXISTS game_identities (
      game_id TEXT PRIMARY KEY NOT NULL,
      engine TEXT NOT NULL,
      title TEXT NOT NULL,
      signature_baseline TEXT NOT NULL,
      signature_version INTEGER NOT NULL DEFAULT 1,
      bound_path TEXT NOT NULL,
      first_bound_at INTEGER NOT NULL,
      last_verified_at INTEGER NOT NULL
    )
  `);
  db.run(sql`
    CREATE TABLE IF NOT EXISTS mutation_log (
      idempotency_key TEXT PRIMARY KEY NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      request_hash TEXT NOT NULL DEFAULT '',
      result_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    )
  `);
  const mutationCols = client.prepare("PRAGMA table_info(mutation_log)").all();
  if (!mutationCols.some((c) => c.name === "request_hash")) client.exec("ALTER TABLE mutation_log ADD COLUMN request_hash TEXT NOT NULL DEFAULT ''");
  if (!mutationCols.some((c) => c.name === "result_json")) client.exec("ALTER TABLE mutation_log ADD COLUMN result_json TEXT NOT NULL DEFAULT '{}'");
  migrateLangPairTable(db, client);
  repairLegacyTargetLang(db, client);
  const cols = tableColumns(client);
  if (!cols.some((c) => c.name === "nsfw")) {
    db.run(sql`ALTER TABLE translations ADD COLUMN nsfw INTEGER NOT NULL DEFAULT 0`);
  }
  if (!cols.some((c) => c.name === "category")) {
    db.run(sql`ALTER TABLE translations ADD COLUMN category TEXT`);
  }
  ensureCandidateSchema(client);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_translations_updated ON translations(updated_at)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_translations_nsfw ON translations(nsfw)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_translations_langs ON translations(src_lang, tgt_lang)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_translations_zh ON translations(zh)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_translations_category ON translations(category)`);
  const meta = db.select().from(cacheMeta).where(eq(cacheMeta.key, "nsfw_backfill")).get();
  if (meta?.value === "1") return;
  const rows = db.select({ src: translations.src, srcLang: translations.srcLang, tgtLang: translations.tgtLang, engine: translations.engine }).from(translations).all();
  if (rows.length) {
    db.transaction((tx) => {
      for (const r of rows) {
        tx.update(translations).set({ nsfw: isNsfwCacheRow(String(r.src), r.engine) ? 1 : 0 }).where(rowPair(String(r.src), String(r.srcLang), String(r.tgtLang))).run();
      }
    });
  }
  db.insert(cacheMeta).values({ key: "nsfw_backfill", value: "1" }).onConflictDoUpdate({ target: cacheMeta.key, set: { value: "1" } }).run();
}
function openSharedCacheDb(dbPath = defaultSharedDbPath()) {
  const resolved = path8.resolve(dbPath);
  fs10.mkdirSync(path8.dirname(resolved), { recursive: true });
  const client = new DatabaseSync4(resolved);
  client.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON");
  const db = drizzle({ client });
  ensureSchema(db, client);
  ensureMatchIndexSchema(client);
  scheduleSharedCacheHeavyMigrate(resolved);
  return { db, path: resolved };
}

// services/translate/shared-cache/write-pairs.ts
function writeCachePairs(client, index2, pairs, engine, opts, valid, nsfw) {
  const result = { accepted: [], records: [], rejected: [] };
  if (!pairs.length) return result;
  const category = normalizeCacheCategory(opts?.category) || null;
  const insert = client.prepare(
    `INSERT INTO translations(src,zh,src_lang,tgt_lang,engine,category,updated_at,hit_count,nsfw,engine_rank)
      VALUES(?,?,?,?,?,?,?,0,?,?) RETURNING id`
  );
  client.exec("BEGIN IMMEDIATE");
  try {
    for (const [src, zh] of pairs) {
      const pair = { from: parseCacheLang(opts?.from) || detectCacheLang(src), to: parseCacheLang(opts?.to) || "zh" };
      if (!src || !zh || !valid(src, zh, engine, pair.to)) {
        result.rejected.push({ src, reason: "invalid" });
        continue;
      }
      const inserted = insert.get(src, zh, pair.from, pair.to, engine, category, Date.now(), nsfw(src, engine), cacheEngineRank(engine));
      result.accepted.push([src, zh]);
      const record = index2.inserted(inserted.id);
      if (record) result.records.push(record);
    }
    client.exec("COMMIT");
  } catch (e) {
    client.exec("ROLLBACK");
    throw e;
  }
  return result;
}

// services/translate/shared-cache/index.ts
var PROJECTION_CANDIDATE_RE = /[\s\d０-９,，、。．.!！?？;；\n\r…~～\\<%{]/;
var scrubbedDbPaths = /* @__PURE__ */ new Set();
function nsfwBit(src, engine) {
  return isNsfwCacheRow(src, engine) ? 1 : 0;
}
function escapeLike(q) {
  return String(q).replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
function engineKindSql(kind) {
  if (kind === "google") return sql`${translations.engine} LIKE '%google%' ESCAPE '\\'`;
  if (kind === "bing") return sql`${translations.engine} LIKE '%bing%' ESCAPE '\\'`;
  if (kind === "apple") return sql`${translations.engine} LIKE '%apple%' ESCAPE '\\'`;
  if (kind === "bergamot") return sql`${translations.engine} LIKE '%bergamot%' ESCAPE '\\'`;
  if (kind === "import") return sql`${translations.engine} LIKE 'import%' ESCAPE '\\'`;
  return sql`((${translations.engine} LIKE '%agent%' ESCAPE '\\' OR ${translations.engine} LIKE '%ollama%' ESCAPE '\\') AND ${translations.engine} NOT LIKE '%google%' ESCAPE '\\' AND ${translations.engine} NOT LIKE '%bing%' ESCAPE '\\' AND ${translations.engine} NOT LIKE '%bergamot%' ESCAPE '\\')`;
}
function nsfwFlagSql(flag) {
  return eq(translations.nsfw, flag === "nsfw" ? 1 : 0);
}
function liveFlagSql(flag) {
  if (flag === "live") return sql`${translations.engine} LIKE 'live:%' ESCAPE '\\'`;
  return sql`(${translations.engine} IS NULL OR ${translations.engine} NOT LIKE 'live:%' ESCAPE '\\')`;
}
function rowWhere(src, from, to) {
  return and(eq(translations.src, src), eq(translations.srcLang, from), eq(translations.tgtLang, to));
}
function listFilter(opts) {
  const parts = [];
  const q = String(opts.q || "").trim();
  const engine = String(opts.engine || "").trim();
  if (q) {
    const like2 = `%${escapeLike(q)}%`;
    parts.push(sql`(${translations.src} LIKE ${like2} ESCAPE '\\' OR ${translations.zh} LIKE ${like2} ESCAPE '\\')`);
  }
  const kind = cacheEngineKind(engine);
  if (kind && CACHE_ENGINE_KINDS.includes(engine)) parts.push(engineKindSql(kind));
  else if (engine) parts.push(eq(translations.engine, engine));
  if (opts.nsfwFlag) parts.push(nsfwFlagSql(opts.nsfwFlag));
  if (opts.live) parts.push(liveFlagSql(opts.live));
  if (opts.from && opts.to) {
    parts.push(
      sql`((${translations.srcLang} = ${opts.from} AND ${translations.tgtLang} = ${opts.to}) OR (${translations.srcLang} = ${opts.to} AND ${translations.tgtLang} = ${opts.from}))`
    );
  } else if (opts.from) {
    parts.push(eq(translations.srcLang, opts.from));
  } else if (opts.to) {
    parts.push(eq(translations.tgtLang, opts.to));
  }
  const category = normalizeCacheCategory(opts.category);
  const nature = parseTextNature(opts.nature);
  if (category) {
    parts.push(eq(translations.category, category));
  } else if (nature) {
    parts.push(inArray(translations.category, [...categoriesForNature(nature)]));
  }
  return parts.length ? and(...parts) : void 0;
}
function defaultPair(opts) {
  return {
    from: normalizeCacheLang(opts?.from, DEFAULT_CACHE_SRC_LANG),
    to: normalizeCacheLang(opts?.to, DEFAULT_CACHE_TGT_LANG)
  };
}
function isSharedIdenticalPair2(src, tgt) {
  if (isIdenticalTranslation(src, tgt)) return true;
  const a = normalizeTranslateKey(src);
  const b = normalizeTranslateKey(tgt);
  return Boolean(a) && isIdenticalTranslation(a, b);
}
function canStorePair(src, tgt, _engine, to) {
  if (isSharedIdenticalPair2(src, tgt)) return false;
  if (to === "zh") return isStorableTranslation(src, tgt);
  return Boolean(String(src).trim() && String(tgt).trim());
}
function rowUsable(src, tgt, to) {
  if (to === "zh") return isReusableTranslation(src, tgt);
  return Boolean(String(src).trim() && String(tgt).trim());
}
function openOwnedSharedCache(dbPath = defaultSharedDbPath()) {
  const { db, path: resolved } = openSharedCacheDb(dbPath);
  const index2 = createMatchIndex(db.$client);
  const backfill = createGameBackfill(db.$client, index2, resolved);
  const cache = {
    path: resolved,
    plan: index2.plan,
    numericRecords: index2.numericRecords,
    queueBackfill: backfill.queue,
    queueGameProjections: backfill.queueProjections,
    gameCacheRoots: backfill.roots,
    flushBackfill: backfill.flush,
    /** Explicit preparation/launch repair, including entries already counted as complete. No engines. */
    syncGameCache(root) {
      const key2 = `game-projection-sync:${root}`;
      const signature = () => JSON.stringify([SENTENCE_RULE_VERSION, index2.version(), gameTranslationFiles(root).stamp]);
      const startedWith = signature();
      const previous = db.select().from(cacheMeta).where(eq(cacheMeta.key, key2)).get()?.value;
      if (previous === startedWith) return backfill.flush(root);
      const file = gameTranslationFiles(root).seed;
      const seed = file ? JSON.parse(fs11.readFileSync(file, "utf8")) : {};
      if (!seed || typeof seed !== "object" || Array.isArray(seed)) throw new Error("Seed must be an object mapping source text to translation");
      const context2 = getGameCacheContext(root);
      const records2 = [];
      const sources = [];
      for (const src of Object.keys(seed)) {
        if (!src.trim() || context2.blocked(src) || context2.lookup[src] != null) continue;
        const pair = resolveCacheLangPair({ src, to: "zh" });
        const exact = index2.record(src, pair);
        if (exact) records2.push(exact);
        else if (PROJECTION_CANDIDATE_RE.test(src)) {
          const { plan } = planGameCache(src, pair, index2, context2);
          if (!plan.limited && plan.status === "full") sources.push({ src, pair });
        }
      }
      backfill.queue(root, records2);
      backfill.queueProjections(root, sources);
      const result = backfill.flush(root);
      const value = signature();
      if (value === startedWith || result.sharedOnly) db.insert(cacheMeta).values({ key: key2, value }).onConflictDoUpdate({ target: cacheMeta.key, set: { value } }).run();
      return result;
    },
    record: index2.record,
    candidateRecord: index2.inserted,
    current: index2.current,
    authority: index2.authority,
    version: index2.version,
    setAlignment: index2.setAlignment,
    confirmSegments(parent, pairs, pair, opts) {
      return confirmRecordSegments(index2, parent, pairs, pair, opts);
    },
    writeMany(pairs, engine = "pipeline", pairOpts) {
      return writeCachePairs(db.$client, index2, pairs, engine, pairOpts, canStorePair, nsfwBit);
    },
    loadAll(pairOpts) {
      const pair = defaultPair(pairOpts);
      const out = /* @__PURE__ */ Object.create(null);
      const rows = db.$client.prepare("SELECT src,zh FROM selected_translations WHERE src_lang=? AND tgt_lang=?").all(pair.from, pair.to);
      for (const row of rows) {
        if (rowUsable(row.src, row.zh, pair.to)) out[row.src] = row.zh;
      }
      return out;
    },
    get(src, pairOpts) {
      const pair = defaultPair(pairOpts);
      const row = index2.authority(src, pair, { category: pairOpts?.category });
      return row && rowUsable(src, row.zh, pair.to) && (row.src === src || row.engine === "manual") ? row.zh : null;
    },
    getMany(keys, pairOpts) {
      const out = /* @__PURE__ */ new Map();
      for (const key2 of new Set(keys)) {
        const hit = cache.get(key2, pairOpts);
        if (hit != null) out.set(key2, hit);
      }
      return out;
    },
    listPage(opts = {}) {
      const pageSize = Math.min(200, Math.max(1, Number(opts.pageSize) || 50));
      const requestedPage = Math.max(1, Math.floor(Number(opts.page) || 1));
      const q = String(opts.q || "").trim();
      const engine = String(opts.engine || "").trim();
      const nsfwFlag = parseCacheNsfwFlag(opts.nsfwFlag) || (opts.nsfw ? "nsfw" : "");
      const live = parseCacheLiveFlag(opts.live);
      const from = parseCacheLang(opts.from);
      const to = parseCacheLang(opts.to);
      const nature = String(opts.nature || "").trim();
      const category = String(opts.category || "").trim();
      const sort = parseSharedCacheSortKey(opts.sort);
      const order = parseSharedCacheSortDir(opts.order);
      const where = listFilter({ q, engine, nsfwFlag, live, from, to, nature, category });
      const present = /* @__PURE__ */ new Set();
      for (const row of db.selectDistinct({ engine: translations.engine }).from(translations).where(and(isNotNull(translations.engine), ne(translations.engine, ""))).all()) {
        const kind = cacheEngineKind(row.engine);
        if (kind) present.add(kind);
      }
      const engines = CACHE_ENGINE_KINDS.filter((kind) => present.has(kind));
      const totalRow = where ? db.select({ n: count() }).from(translations).where(where).get() : db.select({ n: count() }).from(translations).get();
      const total = Number(totalRow?.n || 0);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(requestedPage, totalPages);
      const offset = (page - 1) * pageSize;
      const orderBy = sort === "hits" ? order === "asc" ? asc(translations.hitCount) : desc(translations.hitCount) : order === "asc" ? asc(translations.updatedAt) : desc(translations.updatedAt);
      const rowSelect = {
        id: sql`rowid`.mapWith(Number),
        src: translations.src,
        zh: translations.zh,
        srcLang: translations.srcLang,
        tgtLang: translations.tgtLang,
        engine: translations.engine,
        category: translations.category,
        updatedAt: translations.updatedAt,
        hitCount: translations.hitCount,
        nsfw: translations.nsfw
      };
      const base = db.select(rowSelect).from(translations);
      const filtered = where ? base.where(where) : base;
      const rows = filtered.orderBy(orderBy, asc(translations.src), desc(translations.id)).limit(pageSize).offset(offset).all();
      return {
        page,
        pageSize,
        total,
        totalPages,
        q,
        engine,
        nsfw: nsfwFlag === "nsfw",
        nsfwFlag,
        live,
        from,
        to,
        nature,
        category,
        sort,
        order,
        engines,
        items: rows.map((r) => ({
          id: Number(r.id) || 0,
          src: String(r.src),
          zh: String(r.zh),
          from: normalizeCacheLang(r.srcLang, DEFAULT_CACHE_SRC_LANG),
          to: normalizeCacheLang(r.tgtLang, DEFAULT_CACHE_TGT_LANG),
          engine: r.engine == null ? null : String(r.engine),
          category: r.category == null || r.category === "" ? null : String(r.category),
          updatedAt: Number(r.updatedAt) || 0,
          hitCount: Number(r.hitCount) || 0,
          nsfw: Number(r.nsfw) === 1
        }))
      };
    },
    /** SQLite rowid lookup for short optimize URLs. */
    getById(id) {
      const n = Math.floor(Number(id) || 0);
      if (n <= 0) return null;
      const row = db.select({
        id: sql`rowid`.mapWith(Number),
        src: translations.src,
        zh: translations.zh,
        srcLang: translations.srcLang,
        tgtLang: translations.tgtLang,
        engine: translations.engine,
        category: translations.category,
        updatedAt: translations.updatedAt,
        hitCount: translations.hitCount,
        nsfw: translations.nsfw
      }).from(translations).where(sql`rowid = ${n}`).get();
      if (!row) return null;
      return {
        id: Number(row.id) || n,
        src: String(row.src),
        zh: String(row.zh),
        from: normalizeCacheLang(row.srcLang, DEFAULT_CACHE_SRC_LANG),
        to: normalizeCacheLang(row.tgtLang, DEFAULT_CACHE_TGT_LANG),
        engine: row.engine == null ? null : String(row.engine),
        category: row.category == null || row.category === "" ? null : String(row.category),
        updatedAt: Number(row.updatedAt) || 0,
        hitCount: Number(row.hitCount) || 0,
        nsfw: Number(row.nsfw) === 1
      };
    },
    /** Compatibility count; callers needing accepted pairs must use writeMany. */
    upsertMany(pairs, engine = "pipeline", pairOpts) {
      return cache.writeMany(pairs, engine, pairOpts).accepted.length;
    },
    /** Legacy explicit-pair compatibility; the graph UI now confirms parent mappings via confirmSegments. */
    upsertOptimizeMany(pairs, engine = "manual:optimize", pairOpts) {
      const stats = {
        inserted: 0,
        identical: 0,
        conflict: 0,
        skipped: 0,
        total: 0,
        localOnly: []
      };
      if (!pairs.length) return stats;
      const candidates2 = [];
      for (const [src, zh] of pairs) {
        if (!src || !zh?.trim()) continue;
        stats.total++;
        if (isSharedIdenticalPair2(src, zh)) {
          stats.localOnly.push([src, zh]);
          continue;
        }
        candidates2.push([src, zh.trim()]);
      }
      const written = cache.writeMany(candidates2, engine, pairOpts);
      stats.inserted = written.accepted.length;
      stats.skipped = written.rejected.length;
      return stats;
    },
    importIgnoreExisting(map, engine = "import", pairOpts) {
      const entries = Object.entries(map || {});
      const inserted = cache.writeMany(entries, engine, pairOpts).accepted.length;
      return { inserted, total: entries.length };
    },
    appendManual(src, zh, engine = "manual", pairOpts, opts) {
      const s = String(src ?? "");
      const t = String(zh ?? "").trim();
      const pair = resolveCacheLangPair({ ...pairOpts, src: s });
      const result = cache.writeMany([[s, t]], engine, pair);
      const id = result.records[0]?.candidateId;
      if (id && typeof opts?.nsfw === "boolean") cache.setNsfw(s, opts.nsfw, pair, id);
      return id || null;
    },
    update(src, zh, engine = "manual", pairOpts, opts) {
      return cache.appendManual(src, zh, engine, pairOpts, opts) != null;
    },
    /** Manual NSFW mark; does not change the translation text. */
    setNsfw(src, nsfw, pairOpts, candidateId) {
      const s = String(src ?? "");
      if (!s) return false;
      const pair = defaultPair(pairOpts);
      const result = db.update(translations).set({ nsfw: nsfw ? 1 : 0 }).where(and(rowWhere(s, pair.from, pair.to), candidateId ? eq(translations.id, candidateId) : void 0)).run();
      return Number(result.changes || 0) > 0;
    },
    remove(src, pairOpts, candidateId) {
      const s = String(src ?? "");
      if (!s) return false;
      const pair = defaultPair(pairOpts);
      const result = db.delete(translations).where(and(rowWhere(s, pair.from, pair.to), candidateId ? eq(translations.id, candidateId) : void 0)).run();
      return Number(result.changes || 0) > 0;
    },
    scrubDirty() {
      const rows = db.select().from(translations).all();
      if (!rows.length) return { removed: 0, rewritten: 0 };
      let removed = 0;
      const rewritten = 0;
      db.transaction((tx) => {
        for (const row of rows) {
          const src = String(row.src);
          const zh = String(row.zh);
          const engine = row.engine == null ? null : String(row.engine);
          const where = eq(translations.id, row.id);
          if (engine === "skip:control" || engine === "skip:sensitive") {
            tx.delete(translations).where(where).run();
            removed += 1;
            continue;
          }
          if (isSharedIdenticalPair2(src, zh)) {
            tx.delete(translations).where(where).run();
            removed += 1;
            continue;
          }
        }
      });
      return { removed, rewritten };
    },
    stats() {
      const n = Number(db.select({ n: count() }).from(translations).get()?.n || 0);
      let sizeBytes = 0;
      try {
        sizeBytes = fs11.statSync(resolved).size;
      } catch {
      }
      return { entries: n, sizeBytes, file: resolved };
    },
    close() {
      db.$client.close();
    }
  };
  scrubbedDbPaths.add(resolved);
  return cache;
}
function openSharedCache(dbPath = defaultSharedDbPath()) {
  if (process.env.NODE_ENV === "test" || path9.resolve(dbPath) !== path9.resolve(defaultSharedDbPath()) || process.env.CHAYA_STORAGE_OWNER === "1")
    return openOwnedSharedCache(dbPath);
  return new Proxy({ path: dbPath }, {
    get(target2, name2) {
      if (name2 === "path") return target2.path;
      if (name2 === "close") return () => {
      };
      if (typeof name2 !== "string" || name2 === "then") return void 0;
      return (...args) => {
        const value = storageCall(`shared.${name2}`, args);
        if (name2 === "numericRecords") {
          const result = value;
          return Object.assign(result.items, { limited: result.limited });
        }
        return value;
      };
    }
  });
}

// services/translate/scheduler/seed-inventory.ts
import fs19 from "node:fs";
import { DatabaseSync as DatabaseSync7 } from "node:sqlite";

// services/extract/lib/rgss.ts
import fs18 from "node:fs";
import path14 from "node:path";

// services/game/rgss-archive.ts
import fs12 from "node:fs";
import path10 from "node:path";
import { inflateSync } from "node:zlib";

// services/extract/lib/rgss/marshal.ts
var HEADER_MAJOR = 4;
var HEADER_MINOR = 8;
function assert(condition, message) {
  if (!condition) throw new Error(`Invalid Ruby Marshal data: ${message}`);
}
function decodeUtf8(bytes) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}
var Reader = class {
  constructor(bytes) {
    this.bytes = bytes;
    this.offset = 0;
    this.symbols = [];
    this.objects = [];
  }
  readByte() {
    assert(this.offset < this.bytes.length, "unexpected end of input");
    return this.bytes[this.offset++];
  }
  readBytes(length) {
    assert(length >= 0 && this.offset + length <= this.bytes.length, "truncated payload");
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
  readIntegerBody() {
    const first = this.readByte();
    if (first === 0) return 0;
    if (first >= 5 && first <= 127) return first - 5;
    if (first >= 128 && first <= 250) return first - 251;
    if (first >= 1 && first <= 4) {
      let value2 = 0;
      for (let i = 0; i < first; i += 1) value2 += this.readByte() * 2 ** (8 * i);
      return value2;
    }
    const length = 256 - first;
    assert(length <= 8, "integer is too large");
    let value = 0;
    for (let i = 0; i < length; i += 1) value += this.readByte() * 2 ** (8 * i);
    return value - 2 ** (8 * length);
  }
  readSymbol() {
    const tag = String.fromCharCode(this.readByte());
    if (tag === ";") {
      const index2 = this.readIntegerBody();
      assert(index2 >= 0 && index2 < this.symbols.length, "symbol link out of range");
      return { kind: "symbol", value: this.symbols[index2] };
    }
    assert(tag === ":", `expected symbol, got ${JSON.stringify(tag)}`);
    const value = decodeUtf8(this.readBytes(this.readIntegerBody()));
    this.symbols.push(value);
    return { kind: "symbol", value };
  }
  readIvars(value) {
    const count2 = this.readIntegerBody();
    const pairs = [];
    for (let i = 0; i < count2; i += 1) pairs.push({ key: this.readSymbol(), value: this.readValue() });
    const ivars = { kind: "hash", pairs };
    if (value && typeof value === "object" && "kind" in value) {
      if (value.kind === "string" || value.kind === "array" || value.kind === "hash" || value.kind === "user-defined" || value.kind === "regexp") value.ivars = ivars;
    }
    return value;
  }
  readValue() {
    const tag = String.fromCharCode(this.readByte());
    switch (tag) {
      case "0":
        return null;
      case "T":
        return true;
      case "F":
        return false;
      case "i":
        return this.readIntegerBody();
      case '"': {
        const bytes = this.readBytes(this.readIntegerBody()).slice();
        const value = { kind: "string", value: decodeUtf8(bytes) };
        Object.defineProperty(value, "bytes", { value: bytes, writable: true });
        this.objects.push(value);
        return value;
      }
      case "f": {
        const length = this.readIntegerBody();
        const bytes = this.readBytes(length).slice();
        const value = { kind: "float", value: decodeUtf8(bytes) };
        Object.defineProperty(value, "bytes", { value: bytes, writable: true });
        this.objects.push(value);
        return value;
      }
      case "/": {
        const value = { kind: "regexp", data: this.readBytes(this.readIntegerBody()).slice(), options: this.readByte() };
        this.objects.push(value);
        return value;
      }
      case ":":
      case ";":
        this.offset -= 1;
        return this.readSymbol();
      case "[": {
        const result = { kind: "array", items: [] };
        this.objects.push(result);
        const count2 = this.readIntegerBody();
        for (let i = 0; i < count2; i += 1) result.items.push(this.readValue());
        return result;
      }
      case "{": {
        const result = { kind: "hash", pairs: [] };
        this.objects.push(result);
        const count2 = this.readIntegerBody();
        for (let i = 0; i < count2; i += 1) result.pairs.push({ key: this.readValue(), value: this.readValue() });
        return result;
      }
      case "}": {
        const result = { kind: "hash", pairs: [] };
        this.objects.push(result);
        const count2 = this.readIntegerBody();
        for (let i = 0; i < count2; i += 1) result.pairs.push({ key: this.readValue(), value: this.readValue() });
        result.defaultValue = this.readValue();
        return result;
      }
      case "l": {
        const sign = String.fromCharCode(this.readByte());
        assert(sign === "+" || sign === "-", "invalid bignum sign");
        const count2 = this.readIntegerBody();
        const value = { kind: "bignum", sign, bytes: this.readBytes(count2 * 2).slice() };
        this.objects.push(value);
        return value;
      }
      case "I":
        return this.readIvars(this.readValue());
      case "o": {
        const className = this.readSymbol().value;
        const count2 = this.readIntegerBody();
        const result = { kind: "object", className, ivars: { kind: "hash", pairs: [] } };
        this.objects.push(result);
        for (let i = 0; i < count2; i += 1) result.ivars.pairs.push({ key: this.readSymbol(), value: this.readValue() });
        return result;
      }
      case "u": {
        const className = this.readSymbol().value;
        const length = this.readIntegerBody();
        const result = { kind: "user-defined", className, data: this.readBytes(length).slice() };
        this.objects.push(result);
        return result;
      }
      case "U": {
        const className = this.readSymbol().value;
        const result = { kind: "user-marshal", className, value: null };
        this.objects.push(result);
        result.value = this.readValue();
        return result;
      }
      case "C": {
        const className = this.readSymbol().value;
        const index2 = this.objects.length;
        const result = { kind: "user-class", className, value: null };
        result.value = this.readValue();
        this.objects[index2] = result;
        return result;
      }
      case "S": {
        const className = this.readSymbol().value;
        const count2 = this.readIntegerBody();
        const result = { kind: "struct", className, members: [] };
        this.objects.push(result);
        for (let i = 0; i < count2; i += 1) result.members.push({ key: this.readSymbol(), value: this.readValue() });
        return result;
      }
      case "@": {
        const index2 = this.readIntegerBody();
        assert(index2 >= 0 && index2 < this.objects.length, "object link out of range");
        return this.objects[index2];
      }
      default:
        throw new Error(`unsupported Ruby Marshal tag ${JSON.stringify(tag)}`);
    }
  }
};
function symbolName(value) {
  return value && typeof value === "object" && value.kind === "symbol" ? value.value : String(plainValue(value));
}
function plainValue(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (value.kind === "string" || value.kind === "symbol") return value.value;
  if (value.kind === "array") return value.items.map(plainValue);
  if (value.kind === "hash") {
    const out2 = {};
    for (const pair of value.pairs) out2[String(plainValue(pair.key))] = plainValue(pair.value);
    return out2;
  }
  if (value.kind === "float") return Number(value.value.split("\0", 1)[0]);
  if (value.kind === "regexp") return { __rubyRegexp: Array.from(value.data), options: value.options };
  if (value.kind === "bignum") {
    let integer2 = BigInt(0);
    for (let i = value.bytes.length - 1; i >= 0; i -= 1) integer2 = integer2 * BigInt(256) + BigInt(value.bytes[i]);
    return (value.sign === "+" ? integer2 : -integer2).toString();
  }
  if (value.kind === "user-defined") return { __rubyClass: value.className, data: Array.from(value.data) };
  if (value.kind === "user-marshal" || value.kind === "user-class") return { __rubyClass: value.className, value: plainValue(value.value) };
  if (value.kind === "struct") {
    const out2 = { __rubyClass: value.className };
    for (const member of value.members) out2[member.key.value] = plainValue(member.value);
    return out2;
  }
  const out = {};
  for (const pair of value.ivars.pairs) out[String(plainValue(pair.key)).replace(/^@/, "")] = plainValue(pair.value);
  return out;
}
function parseRubyMarshal(bytes) {
  if (bytes.length < 2 || bytes[0] !== HEADER_MAJOR || bytes[1] !== HEADER_MINOR) throw new Error("Not a Ruby Marshal 4.8 file");
  return new Reader(bytes.subarray(2)).readValue();
}
function rubyObjectField(value, field) {
  if (!value || typeof value !== "object" || value.kind !== "object") return void 0;
  const pair = value.ivars.pairs.find((item) => symbolName(item.key) === `@${field}`);
  return pair?.value;
}

// services/game/rgss-archive.ts
function readAceMember(archive, member) {
  const fd = fs12.openSync(archive, "r");
  let cursor = 0;
  const length = fs12.fstatSync(fd).size;
  const read = (size, offset = cursor) => {
    if (size < 0 || offset + size > length) throw new Error("Truncated RGSS archive");
    const bytes = Buffer.alloc(size);
    if (fs12.readSync(fd, bytes, 0, size, offset) !== size) throw new Error("Truncated RGSS archive");
    cursor = offset + size;
    return bytes;
  };
  try {
    const header = read(12);
    if (!header.subarray(0, 8).equals(Buffer.from("RGSSAD\0", "binary"))) throw new Error("Unsupported RGSS archive version");
    const key2 = Math.imul(header.readUInt32LE(8), 9) + 3 >>> 0;
    for (let count2 = 0; count2 < 1e5; count2++) {
      const record = read(16);
      const offset = (record.readUInt32LE(0) ^ key2) >>> 0;
      if (!offset) return null;
      const size = (record.readUInt32LE(4) ^ key2) >>> 0;
      let fileKey = (record.readUInt32LE(8) ^ key2) >>> 0;
      const nameSize = (record.readUInt32LE(12) ^ key2) >>> 0;
      if (nameSize > 4096) throw new Error("Invalid RGSS archive filename");
      const name2 = read(nameSize);
      for (let i = 0; i < name2.length; i++) name2[i] ^= key2 >>> i % 4 * 8 & 255;
      if (name2.toString().replaceAll("\\", "/").toLowerCase() !== member.toLowerCase()) continue;
      if (size > 32 * 1024 * 1024) throw new Error("RGSS script archive exceeds 32 MiB");
      const bytes = read(size, offset);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] ^= fileKey >>> i % 4 * 8 & 255;
        if (i % 4 === 3) fileKey = Math.imul(fileKey, 7) + 3 >>> 0;
      }
      return bytes;
    }
    throw new Error("RGSS archive has too many members");
  } finally {
    fs12.closeSync(fd);
  }
}
function readRgssScripts(contentRoot) {
  const names = fs12.readdirSync(contentRoot);
  const data = names.find((name2) => name2.toLowerCase() === "data");
  const script = data && fs12.readdirSync(path10.join(contentRoot, data)).find((name2) => /^scripts\.rvdata2?$/i.test(name2));
  const archive = names.find((name2) => name2.toLowerCase() === "game.rgss3a");
  const bytes = script ? fs12.readFileSync(path10.join(contentRoot, data, script)) : archive ? readAceMember(path10.join(contentRoot, archive), "Data/Scripts.rvdata2") : null;
  if (!bytes) return [];
  const value = parseRubyMarshal(bytes);
  if (!value || typeof value !== "object" || value.kind !== "array") return [];
  return value.items.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || entry.kind !== "array") return [];
    const [, name2, packed] = entry.items;
    if (!packed || typeof packed !== "object" || packed.kind !== "string" || !packed.bytes) return [];
    return [
      {
        name: name2 && typeof name2 === "object" && name2.kind === "string" ? name2.value : "",
        source: inflateSync(packed.bytes, { maxOutputLength: 8 * 1024 * 1024 }).toString("utf8")
      }
    ];
  });
}

// services/translate/game-coverage.ts
import fs13 from "node:fs";
import { DatabaseSync as DatabaseSync5 } from "node:sqlite";
function createGameCoverage(records2, opts) {
  const lookup = createGameTranslateLookup(records2);
  const resolver = createSentenceResolver(records2);
  const numeric2 = createNumericLabelIndex(records2);
  let client;
  let shared;
  let opened = false;
  const resolved = /* @__PURE__ */ new Map();
  return {
    resolve(src) {
      if (resolved.has(src)) return resolved.get(src);
      if (opts?.blocked?.(src)) return null;
      let hit = lookup[src] ?? numeric2.resolve(src);
      if (hit == null) {
        if (!opened) {
          opened = true;
          const database = opts?.database ?? TRANSLATE_CACHE_DB_PATH;
          if (database && fs13.existsSync(database)) {
            client = new DatabaseSync5(database, { readOnly: true });
            client.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=250");
            if (client.prepare("SELECT 1 FROM sqlite_master WHERE name='match_keys'").get()) shared = createMatchIndex(client);
          }
        }
        const pair = { from: detectCacheLang(src), to: "zh" };
        const plan = shared ? shared.plan(src, pair, resolver.select(src)) : resolver.plan(src);
        if (!plan.limited) {
          hit = plan.status === "full" ? plan.zh : null;
          if (hit == null) hit = lookupCachedTranslation((key2) => lookup[key2], src);
          if (hit == null && shared && numericLabelFamily(src)) {
            const rows = shared.numericRecords(pair, src);
            if (!rows.limited) hit = createNumericLabelIndex([...rows, ...records2]).resolve(src);
          }
          if (hit == null && /\\(?:C\[|FS\[|RB\[|ruby\[)/i.test(src)) {
            hit = lookupCachedTranslation((key2) => lookup[key2] ?? shared?.record(key2, pair)?.zh, src);
          }
        }
      }
      resolved.set(src, hit ?? null);
      return hit ?? null;
    },
    close() {
      client?.close();
    }
  };
}

// services/translate/resources/snapshot.ts
import { DatabaseSync as DatabaseSync6 } from "node:sqlite";

// services/translate/resources/defaults/fixed-phrases.json
var fixed_phrases_default = {
  \u306F\u3044: "\u662F",
  \u3044\u3044\u3048: "\u5426",
  \u3046\u3093: "\u55EF",
  \u3059\u308B: "\u505A",
  \u3057\u306A\u3044: "\u4E0D\u505A",
  \u30B9\u30AD\u30C3\u30D7: "\u8DF3\u8FC7",
  \u30C0\u30C3\u30B7\u30E5\u8A31\u53EF: "\u5141\u8BB8\u51B2\u523A",
  \u30C0\u30C3\u30B7\u30E5\u7981\u6B62: "\u7981\u6B62\u51B2\u523A",
  \u30B9\u30C6\u30FC\u30C8\u78BA\u8A8D: "\u72B6\u6001\u786E\u8BA4",
  \u30D1\u30FC\u30C6\u30A3\u30FC\u30B3\u30DE\u30F3\u30C9: "\u961F\u4F0D\u6307\u4EE4",
  \uFF33\u30DC\u30BF\u30F3: "S\u6309\u94AE",
  \u30B8\u30E3\u30F3\u30D7: "\u8DF3\u8DC3",
  \u30D5\u30A9\u30B0\u30B9\u30AD\u30C3\u30D7: "\u8FF7\u96FE\u8DF3\u8FC7",
  \u623B\u308B: "\u8FD4\u56DE",
  \u9032\u3080: "\u524D\u8FDB",
  \u8A71\u3059: "\u4EA4\u8C08",
  \u805E\u304F: "\u503E\u542C",
  \u898B\u308B: "\u67E5\u770B",
  \u5F85\u3064: "\u7B49\u5F85",
  \u958B\u3051\u308B: "\u6253\u5F00",
  \u9589\u3058\u308B: "\u5173\u95ED",
  \u4F7F\u3046: "\u4F7F\u7528",
  \u88C5\u5099: "\u88C5\u5907",
  \u6368\u3066\u308B: "\u4E22\u5F03",
  \u8CB7\u3046: "\u8D2D\u4E70",
  \u58F2\u308B: "\u51FA\u552E"
};

// services/translate/resources/defaults.ts
var records = [];
for (const [id, term] of Object.entries(default_game_terms_default)) {
  for (const [sourceLanguage, sourceText] of Object.entries(term.translations)) {
    for (const [targetLanguage, targetText] of Object.entries(term.translations)) {
      if (sourceLanguage === targetLanguage) continue;
      const aliases = "aliases" in term ? term.aliases[sourceLanguage] : void 0;
      records.push({
        type: "entry",
        entryId: `term.${id}.${sourceLanguage}.${targetLanguage}`,
        sourceLanguage,
        targetLanguage,
        sourceText,
        targetText,
        aliases,
        scope: { kind: "global" },
        reviewStatus: "reviewed",
        provenance: { kind: "legacy-game-term" },
        match: { kind: "exact", allowBoundary: true }
      });
    }
  }
}
for (const [index2, [sourceText, targetText]] of Object.entries(fixed_phrases_default).entries()) {
  records.push({
    type: "entry",
    entryId: `fixed.${index2}`,
    sourceLanguage: "ja",
    targetLanguage: "zh",
    sourceText,
    targetText,
    scope: { kind: "global" },
    reviewStatus: "reviewed",
    provenance: { kind: "legacy-fixed-phrase" },
    match: { kind: "exact", allowBoundary: true }
  });
}

// services/translate/seed-failures.ts
import fs15 from "node:fs";

// services/translate/seed-job-state.ts
import { createHash as createHash3 } from "node:crypto";
import fs14 from "node:fs";
import path11 from "node:path";
var MAX_SEED_JOB_LOGS = 120;
function idleSeedJob(contentRoot = "") {
  return {
    contentRoot,
    status: "idle",
    startedAt: null,
    updatedAt: Date.now(),
    sessionDone: 0,
    rounds: 0,
    performance: null,
    liveStatus: "",
    error: null,
    engines: [],
    logs: [],
    failedSources: [],
    inventoryPreparing: false
  };
}
function seedJobKey(contentRoot) {
  return createHash3("sha1").update(path11.resolve(contentRoot)).digest("hex").slice(0, 16);
}
function seedJobFile(contentRoot) {
  return path11.join(TRANSLATE_JOBS_DIR, `${seedJobKey(contentRoot)}.json`);
}
function readSeedJobState(contentRoot) {
  const file = seedJobFile(contentRoot);
  if (!fs14.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs14.readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object") return null;
    return {
      ...idleSeedJob(contentRoot),
      ...raw,
      contentRoot,
      failedSources: Array.isArray(raw.failedSources) ? raw.failedSources.filter((s) => typeof s === "string") : [],
      logs: Array.isArray(raw.logs) ? raw.logs.slice(-MAX_SEED_JOB_LOGS) : []
    };
  } catch {
    return null;
  }
}

// services/translate/seed-failures.ts
function seedFailureFile(contentRoot) {
  return seedJobFile(contentRoot).replace(/\.json$/, ".failures.ndjson");
}
function readSeedFailures(contentRoot) {
  const failures = new Map((readSeedJobState(contentRoot)?.failedSources ?? []).map((src) => [src, ""]));
  const file = seedFailureFile(contentRoot);
  let text2;
  try {
    text2 = fs15.readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return failures;
    throw error;
  }
  for (const line of text2.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.error === null) failures.delete(event.src);
      else failures.set(event.src, event.error);
    } catch {
    }
  }
  return failures;
}

// services/extract/lib/data-fields.ts
var TEXT_FIELD = /^(?:name|displayName|nickname|description|profile|message\d*|text|label|title|help|caption|summary|dialogue|.*[ _-](?:text|message|label|title|description|name|help))$/i;
var TECH_FIELD = /^(?:.*(?:path|url|script|formula|texture)|file(?:name)?|code|eval|callback|handler|condition|expression|Battle Show List|mode|blendMode|spawnType|(?:character|battler|face|picture|animation\d*|battleback\d*|title\d*|parallax)Name|tilesetNames|bgm|bgs|se|me|audio|image|sound|parameters|params|meta|frames|data|flags|traits|effects|damage|timings)$/i;
var isTextField = (field) => TEXT_FIELD.test(field);
var isTechnicalField = (field) => TECH_FIELD.test(field);

// services/extract/lib/rgss/extended-choices.ts
var CONTROLS2 = /\\(?:[A-Za-z]+(?:\[[^\]\r\n]*\])?|[^A-Za-z\r\n])/g;
function literal(text2) {
  return !/[,[\]\r\n]/.test(text2.replace(CONTROLS2, "")) && !/@m\(|<s>/i.test(text2);
}
function fields(raw, start, end) {
  const result = [];
  let depth = 0;
  let from = start;
  const push = (to) => {
    const value = raw.slice(from, to);
    const text2 = value.trim();
    const offset = value.length - value.trimStart().length;
    result.push({ text: text2, start: from + offset, end: from + offset + text2.length });
  };
  for (let i = start; i < end; i++) {
    if (raw[i] === "[") depth++;
    else if (raw[i] === "]" && --depth < 0) return null;
    else if (raw[i] === "," && depth === 0) {
      push(i);
      from = i + 1;
    }
  }
  if (depth !== 0) return null;
  push(end);
  return result;
}
function parseRgssExtendedChoices(raw) {
  if (raw.length > 1e5) return null;
  const header = /^拡張選択肢[ \t\u3000]+/.exec(raw);
  if (!header) return null;
  const args = fields(raw, header[0].length, raw.length);
  if (!args || args.length < 3 || !/^-?\d+$/.test(args[0].text) || !/^\d*$/.test(args[1].text)) return null;
  const third = args[2];
  let choices;
  if (third.text.startsWith("[")) {
    if (!third.text.endsWith("]") || args.length > 5) return null;
    if (args.slice(3).some((arg) => !/^(?:-?\d+|左|中|右|上|下)?$/.test(arg.text))) return null;
    choices = fields(raw, third.start + 1, third.end - 1);
  } else choices = args.slice(2);
  return choices && choices.every((choice) => literal(choice.text)) ? choices : null;
}
function assertExtendedChoiceTranslation(source, target2) {
  if (!literal(target2) || JSON.stringify(source.match(CONTROLS2) || []) !== JSON.stringify(target2.match(CONTROLS2) || [])) {
    throw new Error("Extended choice translation must preserve escape controls and cannot contain commas, brackets or executable expressions");
  }
}

// services/extract/lib/rgss/script-strings.ts
var ASSIGN_RE = /^\s*(?:[A-Z][\w:]*::)*[A-Z]\w*\s*=\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/;
var RETURN_RE = /^\s*return\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*(?:#.*)?$/;
var DRAW_RE = /\bdraw_text(?:_ex)?\s*\([^)]*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)/;
var PATHISH = /[\\/]|\.(?:rvdata2?|png|jpe?g|ogg|mp3|wav|bmp|json|txt|rb)\b|Graphics\/|Audio\/|Data\//i;
var CODEISH = /&&|\|\||==|!=|\.(?:call|new|size|empty\?)\b|^\s*[\[{]|window\.|SceneManager|DataManager/;
function unescapeRubyLiteral(raw) {
  return raw.slice(1, -1).replace(/\\n/g, "\n").replace(/\\t/g, "	").replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, "\\");
}
function consider(raw, script, found) {
  if (!raw) return;
  const text2 = unescapeRubyLiteral(raw).trim();
  if (!text2 || text2.length < 2 || text2.length > 200) return;
  if (PATHISH.test(text2) || CODEISH.test(text2)) return;
  if (!isSourceText(text2)) return;
  if (!found.has(text2)) found.set(text2, script);
}
function extractRgssScriptUiStrings(contentRoot) {
  const found = /* @__PURE__ */ new Map();
  for (const script of readRgssScripts(contentRoot)) {
    const name2 = script.name || "Scripts";
    for (const line of script.source.split(/\r?\n/)) {
      if (line.length > 400) continue;
      consider(ASSIGN_RE.exec(line)?.[1], name2, found);
      consider(RETURN_RE.exec(line)?.[1], name2, found);
      consider(DRAW_RE.exec(line)?.[1], name2, found);
    }
  }
  return [...found].map(([src, script]) => ({ src, script }));
}

// services/extract/lib/rgss/writeback.ts
import fs16 from "node:fs";
import path12 from "node:path";

// lib/translate/name-glossary.ts
var TOKEN_RE2 = new RegExp(SENTENCE_TOKEN_SOURCE, "g");

// services/extract/lib/rgss/writeback.ts
function translatedString(source, value) {
  const next = { kind: "string", value };
  if (source.ivars) {
    next.ivars = {
      kind: "hash",
      pairs: source.ivars.pairs.filter((pair) => !(pair.key && typeof pair.key === "object" && pair.key.kind === "symbol" && ["E", "encoding"].includes(pair.key.value)))
    };
    next.ivars.pairs.push({ key: { kind: "symbol", value: "E" }, value: true });
  }
  return next;
}
function commentCommand(value) {
  if (!value || typeof value !== "object" || value.kind !== "object" || value.className !== "RPG::EventCommand") return null;
  const code = rubyObjectField(value, "code");
  const parameters = rubyObjectField(value, "parameters");
  if (code !== 108 && code !== 408 || !parameters || typeof parameters !== "object" || parameters.kind !== "array") return null;
  const text2 = parameters.items[0];
  return text2 && typeof text2 === "object" && text2.kind === "string" ? { code, parameters, text: text2 } : null;
}
function extendedChoiceSlots(list, slot, result) {
  for (let i = 0; i < list.items.length; i++) {
    const first = commentCommand(list.items[i]);
    if (first?.code !== 108) continue;
    const start = i;
    const comments = [first];
    while (i + 1 < list.items.length) {
      const next = commentCommand(list.items[i + 1]);
      if (next?.code !== 408) break;
      comments.push(next);
      i++;
    }
    const raw = comments.map((comment) => comment.text.value).join("");
    const choices = parseRgssExtendedChoices(raw);
    if (!choices) continue;
    const values = choices.map((choice) => ({ kind: "string", value: choice.text }));
    const lengths = comments.map((comment) => comment.text.value.length);
    for (const [index2, choice] of choices.entries()) {
      result.set(`${slot}/${start}/choice/${index2}`, {
        get value() {
          return values[index2];
        },
        category: "choice",
        set(next) {
          assertExtendedChoiceTranslation(choice.text, next.value);
          values[index2] = next;
          let text2 = "";
          let offset = 0;
          for (const [j, span] of choices.entries()) {
            text2 += raw.slice(offset, span.start) + values[j].value;
            offset = span.end;
          }
          text2 += raw.slice(offset);
          offset = 0;
          comments.forEach((comment, j) => {
            let end = j === comments.length - 1 ? text2.length : Math.min(offset + lengths[j], text2.length);
            if (end < text2.length && /[\uD800-\uDBFF]/.test(text2[end - 1] ?? "") && /[\uDC00-\uDFFF]/.test(text2[end])) end--;
            comment.parameters.items[0] = translatedString(comment.text, text2.slice(offset, end));
            offset = end;
          });
        }
      });
    }
  }
}
function strings(value) {
  const result = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new WeakSet();
  const walk = (entry, slot, text2, set, category = "other") => {
    if (!entry || typeof entry !== "object") return;
    if (entry.kind === "string") {
      if (text2) result.set(slot, { value: entry, set, category });
      return;
    }
    if (seen.has(entry)) return;
    seen.add(entry);
    if (entry.kind === "array") {
      extendedChoiceSlots(entry, slot, result);
      entry.items.forEach(
        (child, index2) => walk(
          child,
          `${slot}/${index2}`,
          text2,
          (next) => {
            entry.items[index2] = next;
          },
          category
        )
      );
    } else if (entry.kind === "hash") {
      entry.pairs.forEach((pair, index2) => {
        const name2 = pair.key && typeof pair.key === "object" && (pair.key.kind === "symbol" || pair.key.kind === "string") ? pair.key.value : "";
        walk(
          pair.value,
          `${slot}/h${index2}`,
          !isTechnicalField(name2) && (text2 || isTextField(name2)),
          (next) => {
            pair.value = next;
          },
          category
        );
      });
    } else if (entry.kind === "object") {
      if (/^RPG::(?:AudioFile|BGM|BGS|ME|SE)$/.test(entry.className)) return;
      const command = entry.className === "RPG::EventCommand";
      const code = command ? rubyObjectField(entry, "code") : null;
      entry.ivars.pairs.forEach((pair, index2) => {
        const name2 = pair.key && typeof pair.key === "object" && pair.key.kind === "symbol" ? pair.key.value.replace(/^@/, "") : "";
        if (command) {
          if (name2 !== "parameters" || !pair.value || typeof pair.value !== "object" || pair.value.kind !== "array") return;
          const parameter = code === 401 || code === 405 || code === 102 ? 0 : code === 402 || code === 320 || code === 324 || code === 325 ? 1 : -1;
          const child = pair.value.items[parameter];
          const parameters = pair.value;
          if (child !== void 0)
            walk(
              child,
              `${slot}/o${index2}/${parameter}`,
              true,
              (next) => {
                parameters.items[parameter] = next;
              },
              code === 102 || code === 402 ? "choice" : "dialogue"
            );
        } else {
          if (name2 === "name" && ["RPG::Event", "RPG::CommonEvent", "RPG::Troop", "RPG::Animation", "RPG::Tileset"].includes(entry.className)) return;
          if (/^(?:character|battler|face|picture|animation\d*|battleback\d*|title\d*|parallax)_name$/i.test(name2)) return;
          const systemText = /^(?:terms|words|basic|params|etypes|commands|elements|skill_types|weapon_types|armor_types|currency_unit|game_title)$/i.test(name2);
          walk(
            pair.value,
            `${slot}/o${index2}`,
            (systemText || !isTechnicalField(name2)) && (isTextField(name2) || systemText || text2),
            (next) => {
              pair.value = next;
            },
            fieldCategory(entry.className, name2, category)
          );
        }
      });
    }
  };
  walk(value, "", false, () => {
  });
  return result;
}
function fieldCategory(className, field, fallback) {
  const base = {
    "RPG::Actor": "actor",
    "RPG::Item": "item",
    "RPG::Weapon": "weapon",
    "RPG::Armor": "armor",
    "RPG::Skill": "skill",
    "RPG::Enemy": "enemy",
    "RPG::State": "state",
    "RPG::Map": "map",
    "RPG::MapInfo": "map",
    "RPG::System": "system"
  };
  if (className === "RPG::Actor" && field === "nickname") return "actor_nickname";
  if (className === "RPG::Actor" && (field === "profile" || field === "description")) return "actor_profile";
  const category = base[className] ?? fallback;
  if (field === "description" && (category === "item" || category === "weapon" || category === "armor" || category === "skill")) return `${category}_desc`;
  if (category === "state" && /^message/.test(field)) return "state_msg";
  return category;
}
function loadOneDataFile(dataDir, name2) {
  const file = path12.join(dataDir, name2);
  const value = parseRubyMarshal(fs16.readFileSync(file));
  const backup = `${file}.chaya.bak`;
  const original = fs16.existsSync(backup) ? parseRubyMarshal(fs16.readFileSync(backup)) : value;
  const current = strings(value);
  const texts = [];
  for (const [location, source] of strings(original)) {
    if (!isSourceText(source.value.value)) continue;
    const target2 = current.get(location);
    if (!target2) throw new Error(`RGSS data structure changed since backup: ${name2}${location}`);
    texts.push({ source: source.value.value.trim(), current: target2, file: name2, location });
  }
  return { file, value, texts };
}
var SKIP_DATA_STEMS = /^(?:FileSystem|Animations|Tilesets)(?:\.|$)/i;
function listDataFileNames(dataDir) {
  const names = fs16.readdirSync(dataDir).filter((name2) => /\.rvdata2?$/i.test(name2) && !SKIP_DATA_STEMS.test(name2)).sort();
  if (!names.length) throw new Error("RGSS data is unavailable. Unpack the encrypted archive into Data/ first.");
  return names;
}
function loadFiles(dataDir) {
  return listDataFileNames(dataDir).map((name2) => loadOneDataFile(dataDir, name2));
}
function itemsFromFiles(files) {
  const groups = /* @__PURE__ */ new Map();
  for (const file of files) {
    for (const text2 of file.texts) {
      const group = groups.get(text2.source) ?? [];
      group.push(text2);
      groups.set(text2.source, group);
    }
  }
  return [...groups].map(([src, locations], index2) => {
    const translated = locations.every((item) => item.current.value.value === locations[0].current.value.value) ? locations[0].current.value.value : "";
    const zh = translated.trim() !== src ? translated : "";
    return {
      id: String(index2 + 1),
      src,
      zh,
      savedZh: zh || void 0,
      initialZh: zh || void 0,
      meta: { category: locations[0].current.category, label: "RGSS", file: `Data/${locations[0].file}` }
    };
  });
}
function loadRgssItems(dataDir) {
  return itemsFromFiles(loadFiles(dataDir));
}

// services/extract/lib/rgss-sources-index.ts
import fs17 from "node:fs";
import path13 from "node:path";
var SOURCE_INDEX_VERSION = 2;
function rgssDataSignature(dataDir) {
  const files = fs17.readdirSync(dataDir).filter((name2) => /\.rvdata2?(?:\.chaya\.bak)?$/i.test(name2)).sort();
  return JSON.stringify([
    SOURCE_INDEX_VERSION,
    ...files.map((name2) => {
      const stat = fs17.statSync(path13.join(dataDir, name2));
      return [name2, stat.size, stat.mtimeMs, stat.ctimeMs];
    })
  ]);
}
function readIndex(contentRoot) {
  const file = localGameContentFile(contentRoot, "rgssSourcesIndex");
  if (!file) return null;
  try {
    const raw = JSON.parse(fs17.readFileSync(file, "utf8"));
    if (!raw || typeof raw.signature !== "string" || !Array.isArray(raw.sources)) return null;
    return raw;
  } catch {
    return null;
  }
}
function writeRgssSourcesIndex(contentRoot, signature, sources) {
  const file = ensureGameContentDir(contentRoot, "rgssSourcesIndex");
  const payload = {
    signature,
    sources: [...sources],
    updatedAt: Date.now()
  };
  fs17.writeFileSync(file, `${JSON.stringify(payload)}
`);
}
function ensureRgssSourcesIndex(contentRoot, dataDir, build) {
  const signature = rgssDataSignature(dataDir);
  const hit = readIndex(contentRoot);
  if (hit && hit.signature === signature) return new Set(hit.sources);
  const sources = build();
  writeRgssSourcesIndex(contentRoot, signature, sources);
  return new Set(sources);
}

// services/extract/lib/rgss.ts
function findChild(dir, name2) {
  try {
    const hit = fs18.readdirSync(dir).find((entry) => entry.toLowerCase() === name2.toLowerCase());
    return hit ? path14.join(dir, hit) : null;
  } catch {
    return null;
  }
}
function extensionFor(dataDir) {
  try {
    const names = fs18.readdirSync(dataDir).map((name2) => name2.toLowerCase());
    if (names.some((name2) => name2.endsWith(".rvdata2"))) return ".rvdata2";
    if (names.some((name2) => name2.endsWith(".rvdata"))) return ".rvdata";
  } catch {
  }
  return null;
}
var seedSources = /* @__PURE__ */ new Map();
function filterRgssSeedKeys(contentRoot, keys) {
  const dir = findChild(contentRoot, "data");
  if (!dir || !extensionFor(dir)) return keys;
  const signature = rgssDataSignature(dir);
  let entry = seedSources.get(contentRoot);
  if (entry?.signature !== signature) {
    const sources = ensureRgssSourcesIndex(contentRoot, dir, () => loadRgssItems(dir).map((item) => item.src));
    entry = { signature, sources };
    if (seedSources.size >= 20) seedSources.delete(seedSources.keys().next().value);
    seedSources.set(contentRoot, entry);
  }
  const scripts = new Set(extractRgssScriptUiStrings(contentRoot).map((item) => item.src));
  return keys.filter((key2) => entry.sources.has(key2) || scripts.has(key2));
}

// services/translate/scheduler/seed-inventory.ts
function seedFileStamp(contentRoot) {
  const file = localGameContentFile(contentRoot, "seed");
  const stat = file ? fs19.statSync(file, { throwIfNoEntry: false }) : void 0;
  return JSON.stringify([file, stat?.ino, stat?.mtimeMs, stat?.ctimeMs, stat?.size]);
}
function readSeedInventory(contentRoot) {
  const stamp = seedFileStamp(contentRoot);
  const progressStamp = seedProgressStamp(contentRoot);
  const file = localGameContentFile(contentRoot, "seed");
  const data = file ? JSON.parse(fs19.readFileSync(file, "utf8")) : {};
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Seed must be an object mapping source text to translation");
  const entries = data;
  const keys = filterRgssSeedKeys(
    contentRoot,
    Object.keys(entries).filter((key2) => key2.trim())
  );
  const progress = {
    contentRoot,
    hasSeed: keys.length > 0,
    total: keys.length,
    done: 0,
    missing: 0,
    needCount: 0,
    skipCount: 0,
    needChars: 0,
    skipChars: 0,
    missingChars: 0,
    doneChars: 0,
    lines: 0,
    batchSize: 40,
    batchesLeft: 0
  };
  let client;
  let revisionQuery;
  let unavailable = false;
  const revisions = /* @__PURE__ */ new Map();
  let records2;
  try {
    records2 = loadGameTranslationRecords(
      contentRoot,
      (origin) => {
        if (unavailable || !TRANSLATE_CACHE_DB_PATH || origin.database !== TRANSLATE_CACHE_DB_PATH) return false;
        const key2 = `${origin.id}:${origin.revision}`;
        if (!revisions.has(key2)) {
          try {
            if (!client) {
              if (!fs19.existsSync(TRANSLATE_CACHE_DB_PATH)) return false;
              client = new DatabaseSync7(TRANSLATE_CACHE_DB_PATH, { readOnly: true });
              client.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=250; BEGIN");
              revisionQuery = client.prepare("SELECT revision FROM translation_records WHERE id=?");
            }
            const row = revisionQuery.get(origin.id);
            revisions.set(key2, row?.revision === origin.revision);
          } catch (error) {
            unavailable = true;
            console.warn("Saved translation revision check unavailable:", error instanceof Error ? error.message : String(error));
            return false;
          }
        }
        return revisions.get(key2);
      },
      { localOnly: true }
    );
  } finally {
    client?.close();
  }
  const coverage = createGameCoverage(records2, { blocked: getGameCacheContext(contentRoot).blocked });
  const pending = [];
  const failures = readSeedFailures(contentRoot);
  try {
    for (const key2 of keys) {
      const chars = charCount(key2);
      progress.lines += lineCount(key2);
      if (!shouldTranslate(key2)) {
        progress.skipCount++;
        progress.skipChars += chars;
      } else {
        progress.needCount++;
        progress.needChars += chars;
        if (coverage.resolve(key2) != null) {
          progress.done++;
          progress.doneChars += chars;
        } else if (failures.has(key2)) {
          progress.failedCount = (progress.failedCount ?? 0) + 1;
          progress.failedChars = (progress.failedChars ?? 0) + chars;
        } else {
          progress.missing++;
          progress.missingChars += chars;
          pending.push(key2);
        }
      }
    }
  } finally {
    coverage.close();
  }
  progress.batchesLeft = Math.ceil(progress.missing / 40);
  return { progress, pending, stamp, progressStamp };
}
function seedProgressStamp(contentRoot) {
  const files = [localGameContentFile(contentRoot, "seed"), localGameContentFile(contentRoot, "cacheNdjson"), seedFailureFile(contentRoot)];
  return JSON.stringify([
    7,
    files.map((file) => {
      const stat = file ? fs19.statSync(file, { throwIfNoEntry: false }) : void 0;
      return [file, stat?.ino, stat?.mtimeMs, stat?.ctimeMs, stat?.size];
    })
  ]);
}

// services/translate/scheduler/seed-inventory-worker.ts
try {
  const contentRoot = String(workerData?.contentRoot || "");
  if (!contentRoot) throw new Error("seed-inventory-worker: missing contentRoot");
  const cache = openSharedCache();
  try {
    cache.syncGameCache(contentRoot);
  } catch (error) {
    console.warn("seed-inventory-worker: syncGameCache non-fatal error:", error);
  } finally {
    cache.close();
  }
  const inv = readSeedInventory(contentRoot);
  const out = path15.join(os2.tmpdir(), `chaya-seed-inv-${process.pid}-${Date.now()}.json`);
  fs20.writeFileSync(out, JSON.stringify(inv));
  parentPort2?.postMessage({ ok: true, path: out, pending: inv.pending.length, total: inv.progress.total });
} catch (error) {
  parentPort2?.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
}
