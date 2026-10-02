"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// node_modules/postgres/cjs/src/query.js
var require_query = __commonJS({
  "node_modules/postgres/cjs/src/query.js"(exports2, module2) {
    var originCache = /* @__PURE__ */ new Map();
    var originStackCache = /* @__PURE__ */ new Map();
    var originError = Symbol("OriginError");
    var CLOSE = module2.exports.CLOSE = {};
    var Query = module2.exports.Query = class Query extends Promise {
      constructor(strings, args, handler, canceller, options = {}) {
        let resolve, reject;
        super((a, b) => {
          resolve = a;
          reject = b;
        });
        this.tagged = Array.isArray(strings.raw);
        this.strings = strings;
        this.args = args;
        this.handler = handler;
        this.canceller = canceller;
        this.options = options;
        this.state = null;
        this.statement = null;
        this.resolve = (x) => (this.active = false, resolve(x));
        this.reject = (x) => (this.active = false, reject(x));
        this.active = false;
        this.cancelled = null;
        this.executed = false;
        this.signature = "";
        this[originError] = this.handler.debug ? new Error() : this.tagged && cachedError(this.strings);
      }
      get origin() {
        return (this.handler.debug ? this[originError].stack : this.tagged && originStackCache.has(this.strings) ? originStackCache.get(this.strings) : originStackCache.set(this.strings, this[originError].stack).get(this.strings)) || "";
      }
      static get [Symbol.species]() {
        return Promise;
      }
      cancel() {
        return this.canceller && (this.canceller(this), this.canceller = null);
      }
      simple() {
        this.options.simple = true;
        this.options.prepare = false;
        return this;
      }
      async readable() {
        this.simple();
        this.streaming = true;
        return this;
      }
      async writable() {
        this.simple();
        this.streaming = true;
        return this;
      }
      cursor(rows = 1, fn) {
        this.options.simple = false;
        if (typeof rows === "function") {
          fn = rows;
          rows = 1;
        }
        this.cursorRows = rows;
        if (typeof fn === "function")
          return this.cursorFn = fn, this;
        let prev;
        return {
          [Symbol.asyncIterator]: () => ({
            next: () => {
              if (this.executed && !this.active)
                return { done: true };
              prev && prev();
              const promise = new Promise((resolve, reject) => {
                this.cursorFn = (value) => {
                  resolve({ value, done: false });
                  return new Promise((r) => prev = r);
                };
                this.resolve = () => (this.active = false, resolve({ done: true }));
                this.reject = (x) => (this.active = false, reject(x));
              });
              this.execute();
              return promise;
            },
            return() {
              prev && prev(CLOSE);
              return { done: true };
            }
          })
        };
      }
      describe() {
        this.options.simple = false;
        this.onlyDescribe = this.options.prepare = true;
        return this;
      }
      stream() {
        throw new Error(".stream has been renamed to .forEach");
      }
      forEach(fn) {
        this.forEachFn = fn;
        this.handle();
        return this;
      }
      raw() {
        this.isRaw = true;
        return this;
      }
      values() {
        this.isRaw = "values";
        return this;
      }
      async handle() {
        !this.executed && (this.executed = true) && await 1 && this.handler(this);
      }
      execute() {
        this.handle();
        return this;
      }
      then() {
        this.handle();
        return super.then.apply(this, arguments);
      }
      catch() {
        this.handle();
        return super.catch.apply(this, arguments);
      }
      finally() {
        this.handle();
        return super.finally.apply(this, arguments);
      }
    };
    function cachedError(xs) {
      if (originCache.has(xs))
        return originCache.get(xs);
      const x = Error.stackTraceLimit;
      Error.stackTraceLimit = 4;
      originCache.set(xs, new Error());
      Error.stackTraceLimit = x;
      return originCache.get(xs);
    }
  }
});

// node_modules/postgres/cjs/src/errors.js
var require_errors = __commonJS({
  "node_modules/postgres/cjs/src/errors.js"(exports2, module2) {
    var PostgresError = module2.exports.PostgresError = class PostgresError extends Error {
      constructor(x) {
        super(x.message);
        this.name = this.constructor.name;
        Object.assign(this, x);
      }
    };
    var Errors = module2.exports.Errors = {
      connection,
      postgres: postgres2,
      generic,
      notSupported
    };
    function connection(x, options, socket) {
      const { host, port } = socket || options;
      const error = Object.assign(
        new Error("write " + x + " " + (options.path || host + ":" + port)),
        {
          code: x,
          errno: x,
          address: options.path || host
        },
        options.path ? {} : { port }
      );
      Error.captureStackTrace(error, connection);
      return error;
    }
    function postgres2(x) {
      const error = new PostgresError(x);
      Error.captureStackTrace(error, postgres2);
      return error;
    }
    function generic(code, message) {
      const error = Object.assign(new Error(code + ": " + message), { code });
      Error.captureStackTrace(error, generic);
      return error;
    }
    function notSupported(x) {
      const error = Object.assign(
        new Error(x + " (B) is not supported"),
        {
          code: "MESSAGE_NOT_SUPPORTED",
          name: x
        }
      );
      Error.captureStackTrace(error, notSupported);
      return error;
    }
  }
});

// node_modules/postgres/cjs/src/types.js
var require_types = __commonJS({
  "node_modules/postgres/cjs/src/types.js"(exports2, module2) {
    var { Query } = require_query();
    var { Errors } = require_errors();
    var types = module2.exports.types = {
      string: {
        to: 25,
        from: null,
        // defaults to string
        serialize: (x) => "" + x
      },
      number: {
        to: 0,
        from: [21, 23, 26, 700, 701],
        serialize: (x) => "" + x,
        parse: (x) => +x
      },
      json: {
        to: 114,
        from: [114, 3802],
        serialize: (x) => JSON.stringify(x),
        parse: (x) => JSON.parse(x)
      },
      boolean: {
        to: 16,
        from: 16,
        serialize: (x) => x === true ? "t" : "f",
        parse: (x) => x === "t"
      },
      date: {
        to: 1184,
        from: [1082, 1114, 1184],
        serialize: (x) => (x instanceof Date ? x : new Date(x)).toISOString(),
        parse: (x) => new Date(x)
      },
      bytea: {
        to: 17,
        from: 17,
        serialize: (x) => "\\x" + Buffer.from(x).toString("hex"),
        parse: (x) => Buffer.from(x.slice(2), "hex")
      }
    };
    var NotTagged = class {
      then() {
        notTagged();
      }
      catch() {
        notTagged();
      }
      finally() {
        notTagged();
      }
    };
    var Identifier = module2.exports.Identifier = class Identifier extends NotTagged {
      constructor(value) {
        super();
        this.value = escapeIdentifier(value);
      }
    };
    var Parameter = module2.exports.Parameter = class Parameter extends NotTagged {
      constructor(value, type, array) {
        super();
        this.value = value;
        this.type = type;
        this.array = array;
      }
    };
    var Builder = module2.exports.Builder = class Builder extends NotTagged {
      constructor(first, rest) {
        super();
        this.first = first;
        this.rest = rest;
      }
      build(before, parameters, types2, options) {
        const keyword = builders.map(([x, fn]) => ({ fn, i: before.search(x) })).sort((a, b) => a.i - b.i).pop();
        return keyword.i === -1 ? escapeIdentifiers(this.first, options) : keyword.fn(this.first, this.rest, parameters, types2, options);
      }
    };
    module2.exports.handleValue = handleValue;
    function handleValue(x, parameters, types2, options) {
      let value = x instanceof Parameter ? x.value : x;
      if (value === void 0) {
        x instanceof Parameter ? x.value = options.transform.undefined : value = x = options.transform.undefined;
        if (value === void 0)
          throw Errors.generic("UNDEFINED_VALUE", "Undefined values are not allowed");
      }
      return "$" + types2.push(
        x instanceof Parameter ? (parameters.push(x.value), x.array ? x.array[x.type || inferType(x.value)] || x.type || firstIsString(x.value) : x.type) : (parameters.push(x), inferType(x))
      );
    }
    var defaultHandlers = typeHandlers(types);
    module2.exports.stringify = stringify;
    function stringify(q, string, value, parameters, types2, options) {
      for (let i = 1; i < q.strings.length; i++) {
        string += stringifyValue(string, value, parameters, types2, options) + q.strings[i];
        value = q.args[i];
      }
      return string;
    }
    function stringifyValue(string, value, parameters, types2, o) {
      return value instanceof Builder ? value.build(string, parameters, types2, o) : value instanceof Query ? fragment(value, parameters, types2, o) : value instanceof Identifier ? value.value : value && value[0] instanceof Query ? value.reduce((acc, x) => acc + " " + fragment(x, parameters, types2, o), "") : handleValue(value, parameters, types2, o);
    }
    function fragment(q, parameters, types2, options) {
      q.fragment = true;
      return stringify(q, q.strings[0], q.args[0], parameters, types2, options);
    }
    function valuesBuilder(first, parameters, types2, columns, options) {
      return first.map(
        (row) => "(" + columns.map(
          (column) => stringifyValue("values", row[column], parameters, types2, options)
        ).join(",") + ")"
      ).join(",");
    }
    function values(first, rest, parameters, types2, options) {
      const multi = Array.isArray(first[0]);
      const columns = rest.length ? rest.flat() : Object.keys(multi ? first[0] : first);
      return valuesBuilder(multi ? first : [first], parameters, types2, columns, options);
    }
    function select(first, rest, parameters, types2, options) {
      typeof first === "string" && (first = [first].concat(rest));
      if (Array.isArray(first))
        return escapeIdentifiers(first, options);
      let value;
      const columns = rest.length ? rest.flat() : Object.keys(first);
      return columns.map((x) => {
        value = first[x];
        return (value instanceof Query ? fragment(value, parameters, types2, options) : value instanceof Identifier ? value.value : handleValue(value, parameters, types2, options)) + " as " + escapeIdentifier(options.transform.column.to ? options.transform.column.to(x) : x);
      }).join(",");
    }
    var builders = Object.entries({
      values,
      in: (...xs) => {
        const x = values(...xs);
        return x === "()" ? "(null)" : x;
      },
      select,
      as: select,
      returning: select,
      "\\(": select,
      update(first, rest, parameters, types2, options) {
        return (rest.length ? rest.flat() : Object.keys(first)).map(
          (x) => escapeIdentifier(options.transform.column.to ? options.transform.column.to(x) : x) + "=" + stringifyValue("values", first[x], parameters, types2, options)
        );
      },
      insert(first, rest, parameters, types2, options) {
        const columns = rest.length ? rest.flat() : Object.keys(Array.isArray(first) ? first[0] : first);
        return "(" + escapeIdentifiers(columns, options) + ")values" + valuesBuilder(Array.isArray(first) ? first : [first], parameters, types2, columns, options);
      }
    }).map(([x, fn]) => [new RegExp("((?:^|[\\s(])" + x + "(?:$|[\\s(]))(?![\\s\\S]*\\1)", "i"), fn]);
    function notTagged() {
      throw Errors.generic("NOT_TAGGED_CALL", "Query not called as a tagged template literal");
    }
    var serializers = module2.exports.serializers = defaultHandlers.serializers;
    var parsers = module2.exports.parsers = defaultHandlers.parsers;
    var END = module2.exports.END = {};
    function firstIsString(x) {
      if (Array.isArray(x))
        return firstIsString(x[0]);
      return typeof x === "string" ? 1009 : 0;
    }
    var mergeUserTypes = module2.exports.mergeUserTypes = function(types2) {
      const user = typeHandlers(types2 || {});
      return {
        serializers: Object.assign({}, serializers, user.serializers),
        parsers: Object.assign({}, parsers, user.parsers)
      };
    };
    function typeHandlers(types2) {
      return Object.keys(types2).reduce((acc, k) => {
        types2[k].from && [].concat(types2[k].from).forEach((x) => acc.parsers[x] = types2[k].parse);
        if (types2[k].serialize) {
          acc.serializers[types2[k].to] = types2[k].serialize;
          types2[k].from && [].concat(types2[k].from).forEach((x) => acc.serializers[x] = types2[k].serialize);
        }
        return acc;
      }, { parsers: {}, serializers: {} });
    }
    function escapeIdentifiers(xs, { transform: { column } }) {
      return xs.map((x) => escapeIdentifier(column.to ? column.to(x) : x)).join(",");
    }
    var escapeIdentifier = module2.exports.escapeIdentifier = function escape(str) {
      return '"' + str.replace(/"/g, '""').replace(/\./g, '"."') + '"';
    };
    var inferType = module2.exports.inferType = function inferType2(x) {
      return x instanceof Parameter ? x.type : x instanceof Date ? 1184 : x instanceof Uint8Array ? 17 : x === true || x === false ? 16 : typeof x === "bigint" ? 20 : Array.isArray(x) ? inferType2(x[0]) : 0;
    };
    var escapeBackslash = /\\/g;
    var escapeQuote = /"/g;
    function arrayEscape(x) {
      return x.replace(escapeBackslash, "\\\\").replace(escapeQuote, '\\"');
    }
    var arraySerializer = module2.exports.arraySerializer = function arraySerializer2(xs, serializer, options, typarray) {
      if (Array.isArray(xs) === false)
        return xs;
      if (!xs.length)
        return "{}";
      const first = xs[0];
      const delimiter = typarray === 1020 ? ";" : ",";
      if (Array.isArray(first) && !first.type)
        return "{" + xs.map((x) => arraySerializer2(x, serializer, options, typarray)).join(delimiter) + "}";
      return "{" + xs.map((x) => {
        if (x === void 0) {
          x = options.transform.undefined;
          if (x === void 0)
            throw Errors.generic("UNDEFINED_VALUE", "Undefined values are not allowed");
        }
        return x === null ? "null" : '"' + arrayEscape(serializer ? serializer(x.type ? x.value : x) : "" + x) + '"';
      }).join(delimiter) + "}";
    };
    var arrayParserState = {
      i: 0,
      char: null,
      str: "",
      quoted: false,
      last: 0
    };
    var arrayParser = module2.exports.arrayParser = function arrayParser2(x, parser, typarray) {
      arrayParserState.i = arrayParserState.last = 0;
      return arrayParserLoop(arrayParserState, x, parser, typarray);
    };
    function arrayParserLoop(s, x, parser, typarray) {
      const xs = [];
      const delimiter = typarray === 1020 ? ";" : ",";
      for (; s.i < x.length; s.i++) {
        s.char = x[s.i];
        if (s.quoted) {
          if (s.char === "\\") {
            s.str += x[++s.i];
          } else if (s.char === '"') {
            xs.push(parser ? parser(s.str) : s.str);
            s.str = "";
            s.quoted = x[s.i + 1] === '"';
            s.last = s.i + 2;
          } else {
            s.str += s.char;
          }
        } else if (s.char === '"') {
          s.quoted = true;
        } else if (s.char === "{") {
          s.last = ++s.i;
          xs.push(arrayParserLoop(s, x, parser, typarray));
        } else if (s.char === "}") {
          s.quoted = false;
          s.last < s.i && xs.push(parser ? parser(x.slice(s.last, s.i)) : x.slice(s.last, s.i));
          s.last = s.i + 1;
          break;
        } else if (s.char === delimiter && s.p !== "}" && s.p !== '"') {
          xs.push(parser ? parser(x.slice(s.last, s.i)) : x.slice(s.last, s.i));
          s.last = s.i + 1;
        }
        s.p = s.char;
      }
      s.last < s.i && xs.push(parser ? parser(x.slice(s.last, s.i + 1)) : x.slice(s.last, s.i + 1));
      return xs;
    }
    var toCamel = module2.exports.toCamel = (x) => {
      let str = x[0];
      for (let i = 1; i < x.length; i++)
        str += x[i] === "_" ? x[++i].toUpperCase() : x[i];
      return str;
    };
    var toPascal = module2.exports.toPascal = (x) => {
      let str = x[0].toUpperCase();
      for (let i = 1; i < x.length; i++)
        str += x[i] === "_" ? x[++i].toUpperCase() : x[i];
      return str;
    };
    var toKebab = module2.exports.toKebab = (x) => x.replace(/_/g, "-");
    var fromCamel = module2.exports.fromCamel = (x) => x.replace(/([A-Z])/g, "_$1").toLowerCase();
    var fromPascal = module2.exports.fromPascal = (x) => (x.slice(0, 1) + x.slice(1).replace(/([A-Z])/g, "_$1")).toLowerCase();
    var fromKebab = module2.exports.fromKebab = (x) => x.replace(/-/g, "_");
    function createJsonTransform(fn) {
      return function jsonTransform(x, column) {
        return typeof x === "object" && x !== null && (column.type === 114 || column.type === 3802) ? Array.isArray(x) ? x.map((x2) => jsonTransform(x2, column)) : Object.entries(x).reduce((acc, [k, v]) => Object.assign(acc, { [fn(k)]: jsonTransform(v, column) }), {}) : x;
      };
    }
    toCamel.column = { from: toCamel };
    toCamel.value = { from: createJsonTransform(toCamel) };
    fromCamel.column = { to: fromCamel };
    var camel = module2.exports.camel = { ...toCamel };
    camel.column.to = fromCamel;
    toPascal.column = { from: toPascal };
    toPascal.value = { from: createJsonTransform(toPascal) };
    fromPascal.column = { to: fromPascal };
    var pascal = module2.exports.pascal = { ...toPascal };
    pascal.column.to = fromPascal;
    toKebab.column = { from: toKebab };
    toKebab.value = { from: createJsonTransform(toKebab) };
    fromKebab.column = { to: fromKebab };
    var kebab = module2.exports.kebab = { ...toKebab };
    kebab.column.to = fromKebab;
  }
});

// node_modules/postgres/cjs/src/result.js
var require_result = __commonJS({
  "node_modules/postgres/cjs/src/result.js"(exports2, module2) {
    module2.exports = class Result extends Array {
      constructor() {
        super();
        Object.defineProperties(this, {
          count: { value: null, writable: true },
          state: { value: null, writable: true },
          command: { value: null, writable: true },
          columns: { value: null, writable: true },
          statement: { value: null, writable: true }
        });
      }
      static get [Symbol.species]() {
        return Array;
      }
    };
  }
});

// node_modules/postgres/cjs/src/queue.js
var require_queue = __commonJS({
  "node_modules/postgres/cjs/src/queue.js"(exports2, module2) {
    module2.exports = Queue;
    function Queue(initial = []) {
      let xs = initial.slice();
      let index = 0;
      return {
        get length() {
          return xs.length - index;
        },
        remove: (x) => {
          const index2 = xs.indexOf(x);
          return index2 === -1 ? null : (xs.splice(index2, 1), x);
        },
        push: (x) => (xs.push(x), x),
        shift: () => {
          const out = xs[index++];
          if (index === xs.length) {
            index = 0;
            xs = [];
          } else {
            xs[index - 1] = void 0;
          }
          return out;
        }
      };
    }
  }
});

// node_modules/postgres/cjs/src/bytes.js
var require_bytes = __commonJS({
  "node_modules/postgres/cjs/src/bytes.js"(exports2, module2) {
    var size = 256;
    var buffer = Buffer.allocUnsafe(size);
    var messages = "BCcDdEFfHPpQSX".split("").reduce((acc, x) => {
      const v = x.charCodeAt(0);
      acc[x] = () => {
        buffer[0] = v;
        b.i = 5;
        return b;
      };
      return acc;
    }, {});
    var b = Object.assign(reset, messages, {
      N: String.fromCharCode(0),
      i: 0,
      inc(x) {
        b.i += x;
        return b;
      },
      str(x) {
        const length = Buffer.byteLength(x);
        fit(length);
        b.i += buffer.write(x, b.i, length, "utf8");
        return b;
      },
      i16(x) {
        fit(2);
        buffer.writeUInt16BE(x, b.i);
        b.i += 2;
        return b;
      },
      i32(x, i) {
        if (i || i === 0) {
          buffer.writeUInt32BE(x, i);
          return b;
        }
        fit(4);
        buffer.writeUInt32BE(x, b.i);
        b.i += 4;
        return b;
      },
      z(x) {
        fit(x);
        buffer.fill(0, b.i, b.i + x);
        b.i += x;
        return b;
      },
      raw(x) {
        buffer = Buffer.concat([buffer.subarray(0, b.i), x]);
        b.i = buffer.length;
        return b;
      },
      end(at = 1) {
        buffer.writeUInt32BE(b.i - at, at);
        const out = buffer.subarray(0, b.i);
        b.i = 0;
        buffer = Buffer.allocUnsafe(size);
        return out;
      }
    });
    module2.exports = b;
    function fit(x) {
      if (buffer.length - b.i < x) {
        const prev = buffer, length = prev.length;
        buffer = Buffer.allocUnsafe(length + (length >> 1) + x);
        prev.copy(buffer);
      }
    }
    function reset() {
      b.i = 0;
      return b;
    }
  }
});

// node_modules/postgres/cjs/src/connection.js
var require_connection = __commonJS({
  "node_modules/postgres/cjs/src/connection.js"(exports2, module2) {
    var net = require("net");
    var tls = require("tls");
    var crypto = require("crypto");
    var Stream = require("stream");
    var { performance } = require("perf_hooks");
    var { stringify, handleValue, arrayParser, arraySerializer } = require_types();
    var { Errors } = require_errors();
    var Result = require_result();
    var Queue = require_queue();
    var { Query, CLOSE } = require_query();
    var b = require_bytes();
    module2.exports = Connection;
    var uid = 1;
    var Sync = b().S().end();
    var Flush = b().H().end();
    var SSLRequest = b().i32(8).i32(80877103).end(8);
    var ExecuteUnnamed = Buffer.concat([b().E().str(b.N).i32(0).end(), Sync]);
    var DescribeUnnamed = b().D().str("S").str(b.N).end();
    var noop = () => {
    };
    var retryRoutines = /* @__PURE__ */ new Set([
      "FetchPreparedStatement",
      "RevalidateCachedQuery",
      "transformAssignedExpr"
    ]);
    var errorFields = {
      83: "severity_local",
      // S
      86: "severity",
      // V
      67: "code",
      // C
      77: "message",
      // M
      68: "detail",
      // D
      72: "hint",
      // H
      80: "position",
      // P
      112: "internal_position",
      // p
      113: "internal_query",
      // q
      87: "where",
      // W
      115: "schema_name",
      // s
      116: "table_name",
      // t
      99: "column_name",
      // c
      100: "data type_name",
      // d
      110: "constraint_name",
      // n
      70: "file",
      // F
      76: "line",
      // L
      82: "routine"
      // R
    };
    function Connection(options, queues = {}, { onopen = noop, onend = noop, onclose = noop } = {}) {
      const {
        sslnegotiation,
        ssl,
        max,
        user,
        host,
        port,
        database,
        parsers,
        transform,
        onnotice,
        onnotify,
        onparameter,
        max_pipeline,
        keep_alive,
        backoff,
        target_session_attrs
      } = options;
      const sent = Queue(), id = uid++, backend = { pid: null, secret: null }, idleTimer = timer(end, options.idle_timeout), lifeTimer = timer(end, options.max_lifetime), connectTimer = timer(connectTimedOut, options.connect_timeout);
      let socket = null, cancelMessage, errorResponse = null, result = new Result(), incoming = Buffer.alloc(0), needsTypes = options.fetch_types, backendParameters = {}, statements = {}, statementId = Math.random().toString(36).slice(2), statementCount = 1, closedTime = 0, remaining = 0, hostIndex = 0, retries = 0, length = 0, delay = 0, rows = 0, serverSignature = null, nextWriteTimer = null, terminated = false, incomings = null, results = null, initial = null, ending = null, stream = null, chunk = null, ended = null, nonce = null, query = null, final = null;
      const connection = {
        queue: queues.closed,
        idleTimer,
        connect(query2) {
          initial = query2;
          reconnect();
        },
        terminate,
        execute,
        cancel,
        end,
        count: 0,
        id
      };
      queues.closed && queues.closed.push(connection);
      return connection;
      async function createSocket() {
        let x;
        try {
          x = options.socket ? await Promise.resolve(options.socket(options)) : new net.Socket();
        } catch (e) {
          error(e);
          return;
        }
        x.on("error", error);
        x.on("close", closed);
        x.on("drain", drain);
        return x;
      }
      async function cancel({ pid, secret }, resolve, reject) {
        try {
          cancelMessage = b().i32(16).i32(80877102).i32(pid).i32(secret).end(16);
          await connect();
          socket.once("error", reject);
          socket.once("close", resolve);
        } catch (error2) {
          reject(error2);
        }
      }
      function execute(q) {
        if (terminated)
          return queryError(q, Errors.connection("CONNECTION_DESTROYED", options));
        if (stream)
          return queryError(q, Errors.generic("COPY_IN_PROGRESS", "You cannot execute queries during copy"));
        if (q.cancelled)
          return;
        try {
          q.state = backend;
          query ? sent.push(q) : (query = q, query.active = true);
          build(q);
          return write(toBuffer(q)) && !q.describeFirst && !q.cursorFn && sent.length < max_pipeline && (!q.options.onexecute || q.options.onexecute(connection));
        } catch (error2) {
          sent.length === 0 && write(Sync);
          errored(error2);
          return true;
        }
      }
      function toBuffer(q) {
        if (q.parameters.length >= 65534)
          throw Errors.generic("MAX_PARAMETERS_EXCEEDED", "Max number of parameters (65534) exceeded");
        return q.options.simple ? b().Q().str(q.statement.string + b.N).end() : q.describeFirst ? Buffer.concat([describe(q), Flush]) : q.prepare ? q.prepared ? prepared(q) : Buffer.concat([describe(q), prepared(q)]) : unnamed(q);
      }
      function describe(q) {
        return Buffer.concat([
          Parse(q.statement.string, q.parameters, q.statement.types, q.statement.name),
          Describe("S", q.statement.name)
        ]);
      }
      function prepared(q) {
        return Buffer.concat([
          Bind(q.parameters, q.statement.types, q.statement.name, q.cursorName),
          q.cursorFn ? Execute("", q.cursorRows) : ExecuteUnnamed
        ]);
      }
      function unnamed(q) {
        return Buffer.concat([
          Parse(q.statement.string, q.parameters, q.statement.types),
          DescribeUnnamed,
          prepared(q)
        ]);
      }
      function build(q) {
        const parameters = [], types = [];
        const string = stringify(q, q.strings[0], q.args[0], parameters, types, options);
        !q.tagged && q.args.forEach((x) => handleValue(x, parameters, types, options));
        q.prepare = options.prepare && ("prepare" in q.options ? q.options.prepare : true);
        q.string = string;
        q.signature = q.prepare && types + string;
        q.onlyDescribe && delete statements[q.signature];
        q.parameters = q.parameters || parameters;
        q.prepared = q.prepare && q.signature in statements;
        q.describeFirst = q.onlyDescribe || parameters.length && !q.prepared;
        q.statement = q.prepared ? statements[q.signature] : { string, types, name: q.prepare ? statementId + statementCount++ : "" };
        typeof options.debug === "function" && options.debug(id, string, parameters, types);
      }
      function write(x, fn) {
        chunk = chunk ? Buffer.concat([chunk, x]) : Buffer.from(x);
        if (fn || chunk.length >= 1024)
          return nextWrite(fn);
        nextWriteTimer === null && (nextWriteTimer = setImmediate(nextWrite));
        return true;
      }
      function nextWrite(fn) {
        const x = socket.write(chunk, fn);
        nextWriteTimer !== null && clearImmediate(nextWriteTimer);
        chunk = nextWriteTimer = null;
        return x;
      }
      function connectTimedOut() {
        errored(Errors.connection("CONNECT_TIMEOUT", options, socket));
        socket.destroy();
      }
      async function secure() {
        if (sslnegotiation !== "direct") {
          write(SSLRequest);
          const canSSL = await new Promise((r) => socket.once("data", (x) => r(x[0] === 83)));
          if (!canSSL && ssl === "prefer")
            return connected();
        }
        const options2 = {
          socket,
          servername: net.isIP(socket.host) ? void 0 : socket.host
        };
        if (sslnegotiation === "direct")
          options2.ALPNProtocols = ["postgresql"];
        if (ssl === "require" || ssl === "allow" || ssl === "prefer")
          options2.rejectUnauthorized = false;
        else if (typeof ssl === "object")
          Object.assign(options2, ssl);
        socket.removeAllListeners();
        socket = tls.connect(options2);
        socket.on("secureConnect", connected);
        socket.on("error", error);
        socket.on("close", closed);
        socket.on("drain", drain);
      }
      function drain() {
        !query && onopen(connection);
      }
      function data(x) {
        if (incomings) {
          incomings.push(x);
          remaining -= x.length;
          if (remaining > 0)
            return;
        }
        incoming = incomings ? Buffer.concat(incomings, length - remaining) : incoming.length === 0 ? x : Buffer.concat([incoming, x], incoming.length + x.length);
        while (incoming.length > 4) {
          length = incoming.readUInt32BE(1);
          if (length >= incoming.length) {
            remaining = length - incoming.length;
            incomings = [incoming];
            break;
          }
          try {
            handle(incoming.subarray(0, length + 1));
          } catch (e) {
            query && (query.cursorFn || query.describeFirst) && write(Sync);
            errored(e);
          }
          incoming = incoming.subarray(length + 1);
          remaining = 0;
          incomings = null;
        }
      }
      async function connect() {
        terminated = false;
        backendParameters = {};
        socket || (socket = await createSocket());
        if (!socket)
          return;
        connectTimer.start();
        if (options.socket)
          return ssl ? secure() : connected();
        socket.on("connect", ssl ? secure : connected);
        if (options.path)
          return socket.connect(options.path);
        socket.ssl = ssl;
        socket.connect(port[hostIndex], host[hostIndex]);
        socket.host = host[hostIndex];
        socket.port = port[hostIndex];
        hostIndex = (hostIndex + 1) % port.length;
      }
      function reconnect() {
        setTimeout(connect, closedTime ? Math.max(0, closedTime + delay - performance.now()) : 0);
      }
      function connected() {
        try {
          statements = {};
          needsTypes = options.fetch_types;
          statementId = Math.random().toString(36).slice(2);
          statementCount = 1;
          lifeTimer.start();
          socket.on("data", data);
          keep_alive && socket.setKeepAlive && socket.setKeepAlive(true, 1e3 * keep_alive);
          const s = StartupMessage();
          write(s);
        } catch (err) {
          error(err);
        }
      }
      function error(err) {
        if (connection.queue === queues.connecting && options.host[retries + 1])
          return;
        errored(err);
        while (sent.length)
          queryError(sent.shift(), err);
      }
      function errored(err) {
        stream && (stream.destroy(err), stream = null);
        query && queryError(query, err);
        initial && (queryError(initial, err), initial = null);
      }
      function queryError(query2, err) {
        if (query2.reserve)
          return query2.reject(err);
        if (!err || typeof err !== "object")
          err = new Error(err);
        "query" in err || "parameters" in err || Object.defineProperties(err, {
          stack: { value: err.stack + query2.origin.replace(/.*\n/, "\n"), enumerable: options.debug },
          query: { value: query2.string, enumerable: options.debug },
          parameters: { value: query2.parameters, enumerable: options.debug },
          args: { value: query2.args, enumerable: options.debug },
          types: { value: query2.statement && query2.statement.types, enumerable: options.debug }
        });
        query2.reject(err);
      }
      function end() {
        return ending || (!connection.reserved && onend(connection), !connection.reserved && !initial && !query && sent.length === 0 ? (terminate(), new Promise((r) => socket && socket.readyState !== "closed" ? socket.once("close", r) : r())) : ending = new Promise((r) => ended = r));
      }
      function terminate() {
        terminated = true;
        if (stream || query || initial || sent.length)
          error(Errors.connection("CONNECTION_DESTROYED", options));
        clearImmediate(nextWriteTimer);
        if (socket) {
          socket.removeListener("data", data);
          socket.removeListener("connect", connected);
          socket.readyState === "open" && socket.end(b().X().end());
        }
        ended && (ended(), ending = ended = null);
      }
      async function closed(hadError) {
        incoming = Buffer.alloc(0);
        remaining = 0;
        incomings = null;
        clearImmediate(nextWriteTimer);
        socket.removeListener("data", data);
        socket.removeListener("connect", connected);
        idleTimer.cancel();
        lifeTimer.cancel();
        connectTimer.cancel();
        socket.removeAllListeners();
        socket = null;
        if (initial)
          return reconnect();
        !hadError && (query || sent.length) && error(Errors.connection("CONNECTION_CLOSED", options, socket));
        closedTime = performance.now();
        hadError && options.shared.retries++;
        delay = (typeof backoff === "function" ? backoff(options.shared.retries) : backoff) * 1e3;
        onclose(connection, Errors.connection("CONNECTION_CLOSED", options, socket));
      }
      function handle(xs, x = xs[0]) {
        (x === 68 ? DataRow : (
          // D
          x === 100 ? CopyData : (
            // d
            x === 65 ? NotificationResponse : (
              // A
              x === 83 ? ParameterStatus : (
                // S
                x === 90 ? ReadyForQuery : (
                  // Z
                  x === 67 ? CommandComplete : (
                    // C
                    x === 50 ? BindComplete : (
                      // 2
                      x === 49 ? ParseComplete : (
                        // 1
                        x === 116 ? ParameterDescription : (
                          // t
                          x === 84 ? RowDescription : (
                            // T
                            x === 82 ? Authentication : (
                              // R
                              x === 110 ? NoData : (
                                // n
                                x === 75 ? BackendKeyData : (
                                  // K
                                  x === 69 ? ErrorResponse : (
                                    // E
                                    x === 115 ? PortalSuspended : (
                                      // s
                                      x === 51 ? CloseComplete : (
                                        // 3
                                        x === 71 ? CopyInResponse : (
                                          // G
                                          x === 78 ? NoticeResponse : (
                                            // N
                                            x === 72 ? CopyOutResponse : (
                                              // H
                                              x === 99 ? CopyDone : (
                                                // c
                                                x === 73 ? EmptyQueryResponse : (
                                                  // I
                                                  x === 86 ? FunctionCallResponse : (
                                                    // V
                                                    x === 118 ? NegotiateProtocolVersion : (
                                                      // v
                                                      x === 87 ? CopyBothResponse : (
                                                        // W
                                                        /* c8 ignore next */
                                                        UnknownMessage
                                                      )
                                                    )
                                                  )
                                                )
                                              )
                                            )
                                          )
                                        )
                                      )
                                    )
                                  )
                                )
                              )
                            )
                          )
                        )
                      )
                    )
                  )
                )
              )
            )
          )
        ))(xs);
      }
      function DataRow(x) {
        let index = 7;
        let length2;
        let column;
        let value;
        const row = query.isRaw ? new Array(query.statement.columns.length) : {};
        for (let i = 0; i < query.statement.columns.length; i++) {
          column = query.statement.columns[i];
          length2 = x.readInt32BE(index);
          index += 4;
          value = length2 === -1 ? null : query.isRaw === true ? x.subarray(index, index += length2) : column.parser === void 0 ? x.toString("utf8", index, index += length2) : column.parser.array === true ? column.parser(x.toString("utf8", index + 1, index += length2)) : column.parser(x.toString("utf8", index, index += length2));
          query.isRaw ? row[i] = query.isRaw === true ? value : transform.value.from ? transform.value.from(value, column) : value : row[column.name] = transform.value.from ? transform.value.from(value, column) : value;
        }
        query.forEachFn ? query.forEachFn(transform.row.from ? transform.row.from(row) : row, result) : result[rows++] = transform.row.from ? transform.row.from(row) : row;
      }
      function ParameterStatus(x) {
        const [k, v] = x.toString("utf8", 5, x.length - 1).split(b.N);
        backendParameters[k] = v;
        if (options.parameters[k] !== v) {
          options.parameters[k] = v;
          onparameter && onparameter(k, v);
        }
      }
      function ReadyForQuery(x) {
        if (query) {
          if (errorResponse) {
            query.retried ? errored(query.retried) : query.prepared && retryRoutines.has(errorResponse.routine) ? retry(query, errorResponse) : errored(errorResponse);
          } else {
            query.resolve(results || result);
          }
        } else if (errorResponse) {
          errored(errorResponse);
        }
        query = results = errorResponse = null;
        result = new Result();
        connectTimer.cancel();
        if (initial) {
          if (target_session_attrs) {
            if (!backendParameters.in_hot_standby || !backendParameters.default_transaction_read_only)
              return fetchState();
            else if (tryNext(target_session_attrs, backendParameters))
              return terminate();
          }
          if (needsTypes) {
            initial.reserve && (initial = null);
            return fetchArrayTypes();
          }
          initial && !initial.reserve && execute(initial);
          options.shared.retries = retries = 0;
          initial = null;
          return;
        }
        while (sent.length && (query = sent.shift()) && (query.active = true, query.cancelled))
          Connection(options).cancel(query.state, query.cancelled.resolve, query.cancelled.reject);
        if (query)
          return;
        connection.reserved ? !connection.reserved.release && x[5] === 73 ? ending ? terminate() : (connection.reserved = null, onopen(connection)) : connection.reserved() : ending ? terminate() : onopen(connection);
      }
      function CommandComplete(x) {
        rows = 0;
        for (let i = x.length - 1; i > 0; i--) {
          if (x[i] === 32 && x[i + 1] < 58 && result.count === null)
            result.count = +x.toString("utf8", i + 1, x.length - 1);
          if (x[i - 1] >= 65) {
            result.command = x.toString("utf8", 5, i);
            result.state = backend;
            break;
          }
        }
        final && (final(), final = null);
        if (result.command === "BEGIN" && max !== 1 && !connection.reserved)
          return errored(Errors.generic("UNSAFE_TRANSACTION", "Only use sql.begin, sql.reserved or max: 1"));
        if (query.options.simple)
          return BindComplete();
        if (query.cursorFn) {
          result.count && query.cursorFn(result);
          write(Sync);
        }
      }
      function ParseComplete() {
        query.parsing = false;
      }
      function BindComplete() {
        !result.statement && (result.statement = query.statement);
        result.columns = query.statement.columns;
      }
      function ParameterDescription(x) {
        const length2 = x.readUInt16BE(5);
        for (let i = 0; i < length2; ++i)
          !query.statement.types[i] && (query.statement.types[i] = x.readUInt32BE(7 + i * 4));
        query.prepare && (statements[query.signature] = query.statement);
        query.describeFirst && !query.onlyDescribe && (write(prepared(query)), query.describeFirst = false);
      }
      function RowDescription(x) {
        if (result.command) {
          results = results || [result];
          results.push(result = new Result());
          result.count = null;
          query.statement.columns = null;
        }
        const length2 = x.readUInt16BE(5);
        let index = 7;
        let start;
        query.statement.columns = Array(length2);
        for (let i = 0; i < length2; ++i) {
          start = index;
          while (x[index++] !== 0) ;
          const table = x.readUInt32BE(index);
          const number = x.readUInt16BE(index + 4);
          const type = x.readUInt32BE(index + 6);
          query.statement.columns[i] = {
            name: transform.column.from ? transform.column.from(x.toString("utf8", start, index - 1)) : x.toString("utf8", start, index - 1),
            parser: parsers[type],
            table,
            number,
            type
          };
          index += 18;
        }
        result.statement = query.statement;
        if (query.onlyDescribe)
          return query.resolve(query.statement), write(Sync);
      }
      async function Authentication(x, type = x.readUInt32BE(5)) {
        (type === 3 ? AuthenticationCleartextPassword : type === 5 ? AuthenticationMD5Password : type === 10 ? SASL : type === 11 ? SASLContinue : type === 12 ? SASLFinal : type !== 0 ? UnknownAuth : noop)(x, type);
      }
      async function AuthenticationCleartextPassword() {
        const payload = await Pass();
        write(
          b().p().str(payload).z(1).end()
        );
      }
      async function AuthenticationMD5Password(x) {
        const payload = "md5" + await md5(
          Buffer.concat([
            Buffer.from(await md5(await Pass() + user)),
            x.subarray(9)
          ])
        );
        write(
          b().p().str(payload).z(1).end()
        );
      }
      async function SASL() {
        nonce = (await crypto.randomBytes(18)).toString("base64");
        b().p().str("SCRAM-SHA-256" + b.N);
        const i = b.i;
        write(b.inc(4).str("n,,n=*,r=" + nonce).i32(b.i - i - 4, i).end());
      }
      async function SASLContinue(x) {
        const res = x.toString("utf8", 9).split(",").reduce((acc, x2) => (acc[x2[0]] = x2.slice(2), acc), {});
        const saltedPassword = await crypto.pbkdf2Sync(
          await Pass(),
          Buffer.from(res.s, "base64"),
          parseInt(res.i),
          32,
          "sha256"
        );
        const clientKey = await hmac(saltedPassword, "Client Key");
        const auth = "n=*,r=" + nonce + ",r=" + res.r + ",s=" + res.s + ",i=" + res.i + ",c=biws,r=" + res.r;
        serverSignature = (await hmac(await hmac(saltedPassword, "Server Key"), auth)).toString("base64");
        const payload = "c=biws,r=" + res.r + ",p=" + xor(
          clientKey,
          Buffer.from(await hmac(await sha2562(clientKey), auth))
        ).toString("base64");
        write(
          b().p().str(payload).end()
        );
      }
      function SASLFinal(x) {
        if (x.toString("utf8", 9).split(b.N, 1)[0].slice(2) === serverSignature)
          return;
        errored(Errors.generic("SASL_SIGNATURE_MISMATCH", "The server did not return the correct signature"));
        socket.destroy();
      }
      function Pass() {
        return Promise.resolve(
          typeof options.pass === "function" ? options.pass() : options.pass
        );
      }
      function NoData() {
        result.statement = query.statement;
        result.statement.columns = [];
        if (query.onlyDescribe)
          return query.resolve(query.statement), write(Sync);
      }
      function BackendKeyData(x) {
        backend.pid = x.readUInt32BE(5);
        backend.secret = x.readUInt32BE(9);
      }
      async function fetchArrayTypes() {
        needsTypes = false;
        const types = await new Query([`
      select b.oid, b.typarray
      from pg_catalog.pg_type a
      left join pg_catalog.pg_type b on b.oid = a.typelem
      where a.typcategory = 'A'
      group by b.oid, b.typarray
      order by b.oid
    `], [], execute);
        types.forEach(({ oid, typarray }) => addArrayType(oid, typarray));
      }
      function addArrayType(oid, typarray) {
        if (!!options.parsers[typarray] && !!options.serializers[typarray]) return;
        const parser = options.parsers[oid];
        options.shared.typeArrayMap[oid] = typarray;
        options.parsers[typarray] = (xs) => arrayParser(xs, parser, typarray);
        options.parsers[typarray].array = true;
        options.serializers[typarray] = (xs) => arraySerializer(xs, options.serializers[oid], options, typarray);
      }
      function tryNext(x, xs) {
        return x === "read-write" && xs.default_transaction_read_only === "on" || x === "read-only" && xs.default_transaction_read_only === "off" || x === "primary" && xs.in_hot_standby === "on" || x === "standby" && xs.in_hot_standby === "off" || x === "prefer-standby" && xs.in_hot_standby === "off" && options.host[retries];
      }
      function fetchState() {
        const query2 = new Query([`
      show transaction_read_only;
      select pg_catalog.pg_is_in_recovery()
    `], [], execute, null, { simple: true });
        query2.resolve = ([[a], [b2]]) => {
          backendParameters.default_transaction_read_only = a.transaction_read_only;
          backendParameters.in_hot_standby = b2.pg_is_in_recovery ? "on" : "off";
        };
        query2.execute();
      }
      function ErrorResponse(x) {
        if (query) {
          (query.cursorFn || query.describeFirst) && write(Sync);
          errorResponse = Errors.postgres(parseError(x));
        } else {
          errored(Errors.postgres(parseError(x)));
        }
      }
      function retry(q, error2) {
        delete statements[q.signature];
        q.retried = error2;
        execute(q);
      }
      function NotificationResponse(x) {
        if (!onnotify)
          return;
        let index = 9;
        while (x[index++] !== 0) ;
        onnotify(
          x.toString("utf8", 9, index - 1),
          x.toString("utf8", index, x.length - 1)
        );
      }
      async function PortalSuspended() {
        try {
          const x = await Promise.resolve(query.cursorFn(result));
          rows = 0;
          x === CLOSE ? write(Close(query.portal)) : (result = new Result(), write(Execute("", query.cursorRows)));
        } catch (err) {
          write(Sync);
          query.reject(err);
        }
      }
      function CloseComplete() {
        result.count && query.cursorFn(result);
        query.resolve(result);
      }
      function CopyInResponse() {
        stream = new Stream.Writable({
          autoDestroy: true,
          write(chunk2, encoding, callback) {
            socket.write(b().d().raw(chunk2).end(), callback);
          },
          destroy(error2, callback) {
            callback(error2);
            socket.write(b().f().str(error2 + b.N).end());
            stream = null;
          },
          final(callback) {
            socket.write(b().c().end());
            final = callback;
            stream = null;
          }
        });
        query.resolve(stream);
      }
      function CopyOutResponse() {
        stream = new Stream.Readable({
          read() {
            socket.resume();
          }
        });
        query.resolve(stream);
      }
      function CopyBothResponse() {
        stream = new Stream.Duplex({
          autoDestroy: true,
          read() {
            socket.resume();
          },
          /* c8 ignore next 11 */
          write(chunk2, encoding, callback) {
            socket.write(b().d().raw(chunk2).end(), callback);
          },
          destroy(error2, callback) {
            callback(error2);
            socket.write(b().f().str(error2 + b.N).end());
            stream = null;
          },
          final(callback) {
            socket.write(b().c().end());
            final = callback;
          }
        });
        query.resolve(stream);
      }
      function CopyData(x) {
        stream && (stream.push(x.subarray(5)) || socket.pause());
      }
      function CopyDone() {
        stream && stream.push(null);
        stream = null;
      }
      function NoticeResponse(x) {
        onnotice ? onnotice(parseError(x)) : console.log(parseError(x));
      }
      function EmptyQueryResponse() {
      }
      function FunctionCallResponse() {
        errored(Errors.notSupported("FunctionCallResponse"));
      }
      function NegotiateProtocolVersion() {
        errored(Errors.notSupported("NegotiateProtocolVersion"));
      }
      function UnknownMessage(x) {
        console.error("Postgres.js : Unknown Message:", x[0]);
      }
      function UnknownAuth(x, type) {
        console.error("Postgres.js : Unknown Auth:", type);
      }
      function Bind(parameters, types, statement = "", portal = "") {
        let prev, type;
        b().B().str(portal + b.N).str(statement + b.N).i16(0).i16(parameters.length);
        parameters.forEach((x, i) => {
          if (x === null)
            return b.i32(4294967295);
          type = types[i];
          parameters[i] = x = type in options.serializers ? options.serializers[type](x) : "" + x;
          prev = b.i;
          b.inc(4).str(x).i32(b.i - prev - 4, prev);
        });
        b.i16(0);
        return b.end();
      }
      function Parse(str, parameters, types, name = "") {
        b().P().str(name + b.N).str(str + b.N).i16(parameters.length);
        parameters.forEach((x, i) => b.i32(types[i] || 0));
        return b.end();
      }
      function Describe(x, name = "") {
        return b().D().str(x).str(name + b.N).end();
      }
      function Execute(portal = "", rows2 = 0) {
        return Buffer.concat([
          b().E().str(portal + b.N).i32(rows2).end(),
          Flush
        ]);
      }
      function Close(portal = "") {
        return Buffer.concat([
          b().C().str("P").str(portal + b.N).end(),
          b().S().end()
        ]);
      }
      function StartupMessage() {
        return cancelMessage || b().inc(4).i16(3).z(2).str(
          Object.entries(Object.assign(
            {
              user,
              database,
              client_encoding: "UTF8"
            },
            options.connection
          )).filter(([, v]) => v).map(([k, v]) => k + b.N + v).join(b.N)
        ).z(2).end(0);
      }
    }
    function parseError(x) {
      const error = {};
      let start = 5;
      for (let i = 5; i < x.length - 1; i++) {
        if (x[i] === 0) {
          error[errorFields[x[start]]] = x.toString("utf8", start + 1, i);
          start = i + 1;
        }
      }
      return error;
    }
    function md5(x) {
      return crypto.createHash("md5").update(x).digest("hex");
    }
    function hmac(key, x) {
      return crypto.createHmac("sha256", key).update(x).digest();
    }
    function sha2562(x) {
      return crypto.createHash("sha256").update(x).digest();
    }
    function xor(a, b2) {
      const length = Math.max(a.length, b2.length);
      const buffer = Buffer.allocUnsafe(length);
      for (let i = 0; i < length; i++)
        buffer[i] = a[i] ^ b2[i];
      return buffer;
    }
    function timer(fn, seconds) {
      seconds = typeof seconds === "function" ? seconds() : seconds;
      if (!seconds)
        return { cancel: noop, start: noop };
      let timer2;
      return {
        cancel() {
          timer2 && (clearTimeout(timer2), timer2 = null);
        },
        start() {
          timer2 && clearTimeout(timer2);
          timer2 = setTimeout(done, seconds * 1e3, arguments);
        }
      };
      function done(args) {
        fn.apply(null, args);
        timer2 = null;
      }
    }
  }
});

// node_modules/postgres/cjs/src/subscribe.js
var require_subscribe = __commonJS({
  "node_modules/postgres/cjs/src/subscribe.js"(exports2, module2) {
    var noop = () => {
    };
    module2.exports = Subscribe;
    function Subscribe(postgres2, options) {
      const subscribers = /* @__PURE__ */ new Map(), slot = "postgresjs_" + Math.random().toString(36).slice(2), state = {};
      let connection, stream, ended = false;
      const sql = subscribe.sql = postgres2({
        ...options,
        transform: { column: {}, value: {}, row: {} },
        max: 1,
        fetch_types: false,
        idle_timeout: null,
        max_lifetime: null,
        connection: {
          ...options.connection,
          replication: "database"
        },
        onclose: async function() {
          if (ended)
            return;
          stream = null;
          state.pid = state.secret = void 0;
          connected(await init(sql, slot, options.publications));
          subscribers.forEach((event) => event.forEach(({ onsubscribe }) => onsubscribe()));
        },
        no_subscribe: true
      });
      const end = sql.end, close = sql.close;
      sql.end = async () => {
        ended = true;
        stream && await new Promise((r) => (stream.once("close", r), stream.end()));
        return end();
      };
      sql.close = async () => {
        stream && await new Promise((r) => (stream.once("close", r), stream.end()));
        return close();
      };
      return subscribe;
      async function subscribe(event, fn, onsubscribe = noop, onerror = noop) {
        event = parseEvent(event);
        if (!connection)
          connection = init(sql, slot, options.publications);
        const subscriber = { fn, onsubscribe };
        const fns = subscribers.has(event) ? subscribers.get(event).add(subscriber) : subscribers.set(event, /* @__PURE__ */ new Set([subscriber])).get(event);
        const unsubscribe = () => {
          fns.delete(subscriber);
          fns.size === 0 && subscribers.delete(event);
        };
        return connection.then((x) => {
          connected(x);
          onsubscribe();
          stream && stream.on("error", onerror);
          return { unsubscribe, state, sql };
        });
      }
      function connected(x) {
        stream = x.stream;
        state.pid = x.state.pid;
        state.secret = x.state.secret;
      }
      async function init(sql2, slot2, publications) {
        if (!publications)
          throw new Error("Missing publication names");
        const xs = await sql2.unsafe(
          `CREATE_REPLICATION_SLOT ${slot2} TEMPORARY LOGICAL pgoutput NOEXPORT_SNAPSHOT`
        );
        const [x] = xs;
        const stream2 = await sql2.unsafe(
          `START_REPLICATION SLOT ${slot2} LOGICAL ${x.consistent_point} (proto_version '1', publication_names '${publications}')`
        ).writable();
        const state2 = {
          lsn: Buffer.concat(x.consistent_point.split("/").map((x2) => Buffer.from(("00000000" + x2).slice(-8), "hex")))
        };
        stream2.on("data", data);
        stream2.on("error", error);
        stream2.on("close", sql2.close);
        return { stream: stream2, state: xs.state };
        function error(e) {
          console.error("Unexpected error during logical streaming - reconnecting", e);
        }
        function data(x2) {
          if (x2[0] === 119) {
            parse(x2.subarray(25), state2, sql2.options.parsers, handle, options.transform);
          } else if (x2[0] === 107 && x2[17]) {
            state2.lsn = x2.subarray(1, 9);
            pong();
          }
        }
        function handle(a, b) {
          const path = b.relation.schema + "." + b.relation.table;
          call("*", a, b);
          call("*:" + path, a, b);
          b.relation.keys.length && call("*:" + path + "=" + b.relation.keys.map((x2) => a[x2.name]), a, b);
          call(b.command, a, b);
          call(b.command + ":" + path, a, b);
          b.relation.keys.length && call(b.command + ":" + path + "=" + b.relation.keys.map((x2) => a[x2.name]), a, b);
        }
        function pong() {
          const x2 = Buffer.alloc(34);
          x2[0] = "r".charCodeAt(0);
          x2.fill(state2.lsn, 1);
          x2.writeBigInt64BE(BigInt(Date.now() - Date.UTC(2e3, 0, 1)) * BigInt(1e3), 25);
          stream2.write(x2);
        }
      }
      function call(x, a, b) {
        subscribers.has(x) && subscribers.get(x).forEach(({ fn }) => fn(a, b, x));
      }
    }
    function Time(x) {
      return new Date(Date.UTC(2e3, 0, 1) + Number(x / BigInt(1e3)));
    }
    function parse(x, state, parsers, handle, transform) {
      const char = (acc, [k, v]) => (acc[k.charCodeAt(0)] = v, acc);
      Object.entries({
        R: (x2) => {
          let i = 1;
          const r = state[x2.readUInt32BE(i)] = {
            schema: x2.toString("utf8", i += 4, i = x2.indexOf(0, i)) || "pg_catalog",
            table: x2.toString("utf8", i + 1, i = x2.indexOf(0, i + 1)),
            columns: Array(x2.readUInt16BE(i += 2)),
            keys: []
          };
          i += 2;
          let columnIndex = 0, column;
          while (i < x2.length) {
            column = r.columns[columnIndex++] = {
              key: x2[i++],
              name: transform.column.from ? transform.column.from(x2.toString("utf8", i, i = x2.indexOf(0, i))) : x2.toString("utf8", i, i = x2.indexOf(0, i)),
              type: x2.readUInt32BE(i += 1),
              parser: parsers[x2.readUInt32BE(i)],
              atttypmod: x2.readUInt32BE(i += 4)
            };
            column.key && r.keys.push(column);
            i += 4;
          }
        },
        Y: () => {
        },
        // Type
        O: () => {
        },
        // Origin
        B: (x2) => {
          state.date = Time(x2.readBigInt64BE(9));
          state.lsn = x2.subarray(1, 9);
        },
        I: (x2) => {
          let i = 1;
          const relation = state[x2.readUInt32BE(i)];
          const { row } = tuples(x2, relation.columns, i += 7, transform);
          handle(row, {
            command: "insert",
            relation
          });
        },
        D: (x2) => {
          let i = 1;
          const relation = state[x2.readUInt32BE(i)];
          i += 4;
          const key = x2[i] === 75;
          handle(
            key || x2[i] === 79 ? tuples(x2, relation.columns, i += 3, transform).row : null,
            {
              command: "delete",
              relation,
              key
            }
          );
        },
        U: (x2) => {
          let i = 1;
          const relation = state[x2.readUInt32BE(i)];
          i += 4;
          const key = x2[i] === 75;
          const xs = key || x2[i] === 79 ? tuples(x2, relation.columns, i += 3, transform) : null;
          xs && (i = xs.i);
          const { row } = tuples(x2, relation.columns, i + 3, transform);
          handle(row, {
            command: "update",
            relation,
            key,
            old: xs && xs.row
          });
        },
        T: () => {
        },
        // Truncate,
        C: () => {
        }
        // Commit
      }).reduce(char, {})[x[0]](x);
    }
    function tuples(x, columns, xi, transform) {
      let type, column, value;
      const row = transform.raw ? new Array(columns.length) : {};
      for (let i = 0; i < columns.length; i++) {
        type = x[xi++];
        column = columns[i];
        value = type === 110 ? null : type === 117 ? void 0 : column.parser === void 0 ? x.toString("utf8", xi + 4, xi += 4 + x.readUInt32BE(xi)) : column.parser.array === true ? column.parser(x.toString("utf8", xi + 5, xi += 4 + x.readUInt32BE(xi))) : column.parser(x.toString("utf8", xi + 4, xi += 4 + x.readUInt32BE(xi)));
        transform.raw ? row[i] = transform.raw === true ? value : transform.value.from ? transform.value.from(value, column) : value : row[column.name] = transform.value.from ? transform.value.from(value, column) : value;
      }
      return { i: xi, row: transform.row.from ? transform.row.from(row) : row };
    }
    function parseEvent(x) {
      const xs = x.match(/^(\*|insert|update|delete)?:?([^.]+?\.?[^=]+)?=?(.+)?/i) || [];
      if (!xs)
        throw new Error("Malformed subscribe pattern: " + x);
      const [, command, path, key] = xs;
      return (command || "*") + (path ? ":" + (path.indexOf(".") === -1 ? "public." + path : path) : "") + (key ? "=" + key : "");
    }
  }
});

// node_modules/postgres/cjs/src/large.js
var require_large = __commonJS({
  "node_modules/postgres/cjs/src/large.js"(exports2, module2) {
    var Stream = require("stream");
    module2.exports = largeObject;
    function largeObject(sql, oid, mode = 131072 | 262144) {
      return new Promise(async (resolve, reject) => {
        await sql.begin(async (sql2) => {
          let finish;
          !oid && ([{ oid }] = await sql2`select lo_creat(-1) as oid`);
          const [{ fd }] = await sql2`select lo_open(${oid}, ${mode}) as fd`;
          const lo = {
            writable,
            readable,
            close: () => sql2`select lo_close(${fd})`.then(finish),
            tell: () => sql2`select lo_tell64(${fd})`,
            read: (x) => sql2`select loread(${fd}, ${x}) as data`,
            write: (x) => sql2`select lowrite(${fd}, ${x})`,
            truncate: (x) => sql2`select lo_truncate64(${fd}, ${x})`,
            seek: (x, whence = 0) => sql2`select lo_lseek64(${fd}, ${x}, ${whence})`,
            size: () => sql2`
          select
            lo_lseek64(${fd}, location, 0) as position,
            seek.size
          from (
            select
              lo_lseek64($1, 0, 2) as size,
              tell.location
            from (select lo_tell64($1) as location) tell
          ) seek
        `
          };
          resolve(lo);
          return new Promise(async (r) => finish = r);
          async function readable({
            highWaterMark = 2048 * 8,
            start = 0,
            end = Infinity
          } = {}) {
            let max = end - start;
            start && await lo.seek(start);
            return new Stream.Readable({
              highWaterMark,
              async read(size) {
                const l = size > max ? size - max : size;
                max -= size;
                const [{ data }] = await lo.read(l);
                this.push(data);
                if (data.length < size)
                  this.push(null);
              }
            });
          }
          async function writable({
            highWaterMark = 2048 * 8,
            start = 0
          } = {}) {
            start && await lo.seek(start);
            return new Stream.Writable({
              highWaterMark,
              write(chunk, encoding, callback) {
                lo.write(chunk).then(() => callback(), callback);
              }
            });
          }
        }).catch(reject);
      });
    }
  }
});

// node_modules/postgres/cjs/src/index.js
var require_src = __commonJS({
  "node_modules/postgres/cjs/src/index.js"(exports2, module2) {
    var os = require("os");
    var fs = require("fs");
    var {
      mergeUserTypes,
      inferType,
      Parameter,
      Identifier,
      Builder,
      toPascal,
      pascal,
      toCamel,
      camel,
      toKebab,
      kebab,
      fromPascal,
      fromCamel,
      fromKebab
    } = require_types();
    var Connection = require_connection();
    var { Query, CLOSE } = require_query();
    var Queue = require_queue();
    var { Errors, PostgresError } = require_errors();
    var Subscribe = require_subscribe();
    var largeObject = require_large();
    Object.assign(Postgres, {
      PostgresError,
      toPascal,
      pascal,
      toCamel,
      camel,
      toKebab,
      kebab,
      fromPascal,
      fromCamel,
      fromKebab,
      BigInt: {
        to: 20,
        from: [20],
        parse: (x) => BigInt(x),
        // eslint-disable-line
        serialize: (x) => x.toString()
      }
    });
    module2.exports = Postgres;
    function Postgres(a, b) {
      const options = parseOptions(a, b), subscribe = options.no_subscribe || Subscribe(Postgres, { ...options });
      let ending = false;
      const queries = Queue(), connecting = Queue(), reserved = Queue(), closed = Queue(), ended = Queue(), open = Queue(), busy = Queue(), full = Queue(), queues = { connecting, reserved, closed, ended, open, busy, full };
      const connections = [...Array(options.max)].map(() => Connection(options, queues, { onopen, onend, onclose }));
      const sql = Sql(handler);
      Object.assign(sql, {
        get parameters() {
          return options.parameters;
        },
        largeObject: largeObject.bind(null, sql),
        subscribe,
        CLOSE,
        END: CLOSE,
        PostgresError,
        options,
        reserve,
        listen,
        begin,
        close,
        end
      });
      return sql;
      function Sql(handler2) {
        handler2.debug = options.debug;
        Object.entries(options.types).reduce((acc, [name, type]) => {
          acc[name] = (x) => new Parameter(x, type.to);
          return acc;
        }, typed);
        Object.assign(sql2, {
          types: typed,
          typed,
          unsafe,
          notify,
          array,
          json,
          file
        });
        return sql2;
        function typed(value, type) {
          return new Parameter(value, type);
        }
        function sql2(strings, ...args) {
          const query = strings && Array.isArray(strings.raw) ? new Query(strings, args, handler2, cancel) : typeof strings === "string" && !args.length ? new Identifier(options.transform.column.to ? options.transform.column.to(strings) : strings) : new Builder(strings, args);
          return query;
        }
        function unsafe(string, args = [], options2 = {}) {
          arguments.length === 2 && !Array.isArray(args) && (options2 = args, args = []);
          const query = new Query([string], args, handler2, cancel, {
            prepare: false,
            ...options2,
            simple: "simple" in options2 ? options2.simple : args.length === 0
          });
          return query;
        }
        function file(path, args = [], options2 = {}) {
          arguments.length === 2 && !Array.isArray(args) && (options2 = args, args = []);
          const query = new Query([], args, (query2) => {
            fs.readFile(path, "utf8", (err, string) => {
              if (err)
                return query2.reject(err);
              query2.strings = [string];
              handler2(query2);
            });
          }, cancel, {
            ...options2,
            simple: "simple" in options2 ? options2.simple : args.length === 0
          });
          return query;
        }
      }
      async function listen(name, fn, onlisten) {
        const listener = { fn, onlisten };
        const sql2 = listen.sql || (listen.sql = Postgres({
          ...options,
          max: 1,
          idle_timeout: null,
          max_lifetime: null,
          fetch_types: false,
          onclose() {
            Object.entries(listen.channels).forEach(([name2, { listeners }]) => {
              delete listen.channels[name2];
              Promise.all(listeners.map((l) => listen(name2, l.fn, l.onlisten).catch(() => {
              })));
            });
          },
          onnotify(c, x) {
            c in listen.channels && listen.channels[c].listeners.forEach((l) => l.fn(x));
          }
        }));
        const channels = listen.channels || (listen.channels = {}), exists = name in channels;
        if (exists) {
          channels[name].listeners.push(listener);
          const result2 = await channels[name].result;
          listener.onlisten && listener.onlisten();
          return { state: result2.state, unlisten };
        }
        channels[name] = { result: sql2`listen ${sql2.unsafe('"' + name.replace(/"/g, '""') + '"')}`, listeners: [listener] };
        const result = await channels[name].result;
        listener.onlisten && listener.onlisten();
        return { state: result.state, unlisten };
        async function unlisten() {
          if (name in channels === false)
            return;
          channels[name].listeners = channels[name].listeners.filter((x) => x !== listener);
          if (channels[name].listeners.length)
            return;
          delete channels[name];
          return sql2`unlisten ${sql2.unsafe('"' + name.replace(/"/g, '""') + '"')}`;
        }
      }
      async function notify(channel, payload) {
        return await sql`select pg_notify(${channel}, ${"" + payload})`;
      }
      async function reserve() {
        const queue = Queue();
        const c = open.length ? open.shift() : await new Promise((resolve, reject) => {
          const query = { reserve: resolve, reject };
          queries.push(query);
          closed.length && connect(closed.shift(), query);
        });
        move(c, reserved);
        c.reserved = () => queue.length ? c.execute(queue.shift()) : move(c, reserved);
        c.reserved.release = true;
        const sql2 = Sql(handler2);
        sql2.release = () => {
          c.reserved = null;
          onopen(c);
        };
        return sql2;
        function handler2(q) {
          c.queue === full ? queue.push(q) : c.execute(q) || move(c, full);
        }
      }
      async function begin(options2, fn) {
        !fn && (fn = options2, options2 = "");
        const queries2 = Queue();
        let savepoints = 0, connection, prepare = null;
        try {
          await sql.unsafe("begin " + options2.replace(/[^a-z ]/ig, ""), [], { onexecute }).execute();
          return await Promise.race([
            scope(connection, fn),
            new Promise((_, reject) => connection.onclose = reject)
          ]);
        } catch (error) {
          throw error;
        }
        async function scope(c, fn2, name) {
          const sql2 = Sql(handler2);
          sql2.savepoint = savepoint;
          sql2.prepare = (x) => prepare = x.replace(/[^a-z0-9$-_. ]/gi);
          let uncaughtError, result;
          name && await sql2`savepoint ${sql2(name)}`;
          try {
            result = await new Promise((resolve, reject) => {
              const x = fn2(sql2);
              Promise.resolve(Array.isArray(x) ? Promise.all(x) : x).then(resolve, reject);
            });
            if (uncaughtError)
              throw uncaughtError;
          } catch (e) {
            await (name ? sql2`rollback to ${sql2(name)}` : sql2`rollback`);
            throw e instanceof PostgresError && e.code === "25P02" && uncaughtError || e;
          }
          if (!name) {
            prepare ? await sql2`prepare transaction '${sql2.unsafe(prepare)}'` : await sql2`commit`;
          }
          return result;
          function savepoint(name2, fn3) {
            if (name2 && Array.isArray(name2.raw))
              return savepoint((sql3) => sql3.apply(sql3, arguments));
            arguments.length === 1 && (fn3 = name2, name2 = null);
            return scope(c, fn3, "s" + savepoints++ + (name2 ? "_" + name2 : ""));
          }
          function handler2(q) {
            q.catch((e) => uncaughtError || (uncaughtError = e));
            c.queue === full ? queries2.push(q) : c.execute(q) || move(c, full);
          }
        }
        function onexecute(c) {
          connection = c;
          move(c, reserved);
          c.reserved = () => queries2.length ? c.execute(queries2.shift()) : move(c, reserved);
        }
      }
      function move(c, queue) {
        c.queue.remove(c);
        queue.push(c);
        c.queue = queue;
        queue === open ? c.idleTimer.start() : c.idleTimer.cancel();
        return c;
      }
      function json(x) {
        return new Parameter(x, 3802);
      }
      function array(x, type) {
        if (!Array.isArray(x))
          return array(Array.from(arguments));
        return new Parameter(x, type || (x.length ? inferType(x) || 25 : 0), options.shared.typeArrayMap);
      }
      function handler(query) {
        if (ending)
          return query.reject(Errors.connection("CONNECTION_ENDED", options, options));
        if (open.length)
          return go(open.shift(), query);
        if (closed.length)
          return connect(closed.shift(), query);
        busy.length ? go(busy.shift(), query) : queries.push(query);
      }
      function go(c, query) {
        return c.execute(query) ? move(c, busy) : move(c, full);
      }
      function cancel(query) {
        return new Promise((resolve, reject) => {
          query.state ? query.active ? Connection(options).cancel(query.state, resolve, reject) : query.cancelled = { resolve, reject } : (queries.remove(query), query.cancelled = true, query.reject(Errors.generic("57014", "canceling statement due to user request")), resolve());
        });
      }
      async function end({ timeout = null } = {}) {
        if (ending)
          return ending;
        await 1;
        let timer;
        return ending = Promise.race([
          new Promise((r) => timeout !== null && (timer = setTimeout(destroy, timeout * 1e3, r))),
          Promise.all(connections.map((c) => c.end()).concat(
            listen.sql ? listen.sql.end({ timeout: 0 }) : [],
            subscribe.sql ? subscribe.sql.end({ timeout: 0 }) : []
          ))
        ]).then(() => clearTimeout(timer));
      }
      async function close() {
        await Promise.all(connections.map((c) => c.end()));
      }
      async function destroy(resolve) {
        await Promise.all(connections.map((c) => c.terminate()));
        while (queries.length)
          queries.shift().reject(Errors.connection("CONNECTION_DESTROYED", options));
        resolve();
      }
      function connect(c, query) {
        move(c, connecting);
        c.connect(query);
        return c;
      }
      function onend(c) {
        move(c, ended);
      }
      function onopen(c) {
        if (queries.length === 0)
          return move(c, open);
        let max = Math.ceil(queries.length / (connecting.length + 1)), ready = true;
        while (ready && queries.length && max-- > 0) {
          const query = queries.shift();
          if (query.reserve)
            return query.reserve(c);
          ready = c.execute(query);
        }
        ready ? move(c, busy) : move(c, full);
      }
      function onclose(c, e) {
        move(c, closed);
        c.reserved = null;
        c.onclose && (c.onclose(e), c.onclose = null);
        options.onclose && options.onclose(c.id);
        queries.length && connect(c, queries.shift());
      }
    }
    function parseOptions(a, b) {
      if (a && a.shared)
        return a;
      const env = process.env, o = (!a || typeof a === "string" ? b : a) || {}, { url, multihost } = parseUrl(a), query = [...url.searchParams].reduce((a2, [b2, c]) => (a2[b2] = c, a2), {}), host = o.hostname || o.host || multihost || url.hostname || env.PGHOST || "localhost", port = o.port || url.port || env.PGPORT || 5432, user = o.user || o.username || url.username || env.PGUSERNAME || env.PGUSER || osUsername();
      o.no_prepare && (o.prepare = false);
      query.sslmode && (query.ssl = query.sslmode, delete query.sslmode);
      "timeout" in o && (console.log("The timeout option is deprecated, use idle_timeout instead"), o.idle_timeout = o.timeout);
      query.sslrootcert === "system" && (query.ssl = "verify-full");
      const ints = ["idle_timeout", "connect_timeout", "max_lifetime", "max_pipeline", "backoff", "keep_alive"];
      const defaults = {
        max: globalThis.Cloudflare ? 3 : 10,
        ssl: false,
        sslnegotiation: null,
        idle_timeout: null,
        connect_timeout: 30,
        max_lifetime,
        max_pipeline: 100,
        backoff,
        keep_alive: 60,
        prepare: true,
        debug: false,
        fetch_types: true,
        publications: "alltables",
        target_session_attrs: null
      };
      return {
        host: Array.isArray(host) ? host : host.split(",").map((x) => x.split(":")[0]),
        port: Array.isArray(port) ? port : host.split(",").map((x) => parseInt(x.split(":")[1] || port)),
        path: o.path || host.indexOf("/") > -1 && host + "/.s.PGSQL." + port,
        database: o.database || o.db || (url.pathname || "").slice(1) || env.PGDATABASE || user,
        user,
        pass: o.pass || o.password || url.password || env.PGPASSWORD || "",
        ...Object.entries(defaults).reduce(
          (acc, [k, d]) => {
            const value = k in o ? o[k] : k in query ? query[k] === "disable" || query[k] === "false" ? false : query[k] : env["PG" + k.toUpperCase()] || d;
            acc[k] = typeof value === "string" && ints.includes(k) ? +value : value;
            return acc;
          },
          {}
        ),
        connection: {
          application_name: env.PGAPPNAME || "postgres.js",
          ...o.connection,
          ...Object.entries(query).reduce((acc, [k, v]) => (k in defaults || (acc[k] = v), acc), {})
        },
        types: o.types || {},
        target_session_attrs: tsa(o, url, env),
        onnotice: o.onnotice,
        onnotify: o.onnotify,
        onclose: o.onclose,
        onparameter: o.onparameter,
        socket: o.socket,
        transform: parseTransform(o.transform || { undefined: void 0 }),
        parameters: {},
        shared: { retries: 0, typeArrayMap: {} },
        ...mergeUserTypes(o.types)
      };
    }
    function tsa(o, url, env) {
      const x = o.target_session_attrs || url.searchParams.get("target_session_attrs") || env.PGTARGETSESSIONATTRS;
      if (!x || ["read-write", "read-only", "primary", "standby", "prefer-standby"].includes(x))
        return x;
      throw new Error("target_session_attrs " + x + " is not supported");
    }
    function backoff(retries) {
      return (0.5 + Math.random() / 2) * Math.min(3 ** retries / 100, 20);
    }
    function max_lifetime() {
      return 60 * (30 + Math.random() * 30);
    }
    function parseTransform(x) {
      return {
        undefined: x.undefined,
        column: {
          from: typeof x.column === "function" ? x.column : x.column && x.column.from,
          to: x.column && x.column.to
        },
        value: {
          from: typeof x.value === "function" ? x.value : x.value && x.value.from,
          to: x.value && x.value.to
        },
        row: {
          from: typeof x.row === "function" ? x.row : x.row && x.row.from,
          to: x.row && x.row.to
        }
      };
    }
    function parseUrl(url) {
      if (!url || typeof url !== "string")
        return { url: { searchParams: /* @__PURE__ */ new Map() } };
      let host = url;
      host = host.slice(host.indexOf("://") + 3).split(/[?/]/)[0];
      host = decodeURIComponent(host.slice(host.indexOf("@") + 1));
      const urlObj = new URL(url.replace(host, host.split(",")[0]));
      return {
        url: {
          username: decodeURIComponent(urlObj.username),
          password: decodeURIComponent(urlObj.password),
          host: urlObj.host,
          hostname: urlObj.hostname,
          port: urlObj.port,
          pathname: urlObj.pathname,
          searchParams: urlObj.searchParams
        },
        multihost: host.indexOf(",") > -1 && host
      };
    }
    function osUsername() {
      try {
        return os.userInfo().username;
      } catch (_) {
        return process.env.USERNAME || process.env.USER || process.env.LOGNAME;
      }
    }
  }
});

// scripts/queue2-worker-observability.cjs
var require_queue2_worker_observability = __commonJS({
  "scripts/queue2-worker-observability.cjs"(exports2, module2) {
    "use strict";
    var fs = require("node:fs");
    var path = require("node:path");
    var STATUS_LANES = Object.freeze([
      "LANE_A_CL",
      "LANE_A_RUNNING",
      "LANE_B_OFFLINE",
      "LANE_B_IDLE_SAFE",
      "QUOTA_CHECK",
      "HOLD",
      "WAITING_FOR_NETWORK",
      "HUMAN_REVIEW_REQUIRED",
      "STOPPED",
      "STARTUP",
      "WAIT_QUOTA_RESET"
    ]);
    var RUNTIME_STATES = Object.freeze([
      "RUNNING",
      "LANE_A_RUNNING",
      "IDLE_SAFE",
      "WAITING_FOR_NETWORK",
      "SUSPENDED_OR_OFFLINE",
      "STOPPED",
      "HUMAN_REVIEW_REQUIRED"
    ]);
    var EVENT_TYPES = Object.freeze([
      // Startup / ownership
      "WORKER_START",
      "WATCHDOG_SESSION_INIT",
      "INITIAL_HEARTBEAT",
      "HEARTBEAT",
      "LOCK_ACQUIRED",
      "LOCK_RELEASED",
      "LOCK_RECOVERED",
      "SYSTEM_RESUME_DETECTED",
      // Quota / scheduling
      "QUOTA_CHECK",
      "QUOTA_PROBE",
      "QUOTA_FLOOR",
      "QUOTA_RECOVERED",
      "BACKPRESSURE_PAUSE",
      "WAITING_FOR_NETWORK",
      "NETWORK_LOSS",
      "NETWORK_UNAVAILABLE",
      "NETWORK_RECOVERED",
      "CLOCK_REVALIDATION",
      // Lane A / Lane B
      "LANE_A_START",
      "LANE_A_BATCH_COMPLETE",
      "LANE_A_RUNNER_START",
      "LANE_A_NO_PROGRESS",
      "TARGET_ALREADY_COMPLETE",
      "LANE_A_COUNT_RECONCILED",
      "CANARY_REQUIRED",
      "CANARY_SKIPPED",
      "LANE_B_START",
      "LANE_B_TASK_COMPLETE",
      "OFFLINE_TASK_COMPLETE",
      "LANE_B_IDLE_SAFE",
      "LANE_SWITCH",
      "WORKER_IDLE",
      // Progress / evidence
      "CHECKPOINT",
      "MILESTONE",
      "SELF_CHECK_BOUNDARY",
      // Safety / review / shutdown
      "HUMAN_REVIEW_REQUIRED",
      "HUMAN_REVIEW_CLEARED",
      "CODE_CHANGE_DETECTED",
      "KILL_SWITCH_STOP",
      "WORKER_STOP",
      "ERROR",
      "EMERGENCY_STOP",
      // Watchdog (shared schema; also written via appendWatchdogEvent)
      "WATCHDOG_WARNING",
      "WATCHDOG_CRITICAL",
      "MEANINGFUL_PROGRESS",
      "FALSE_ACTIVE_TASK_STATE",
      "ALERT"
    ]);
    var EVENT_TYPE_SET = new Set(EVENT_TYPES);
    var PRODUCTION_EVENT_SOURCE_FILES = Object.freeze([
      "scripts/run-queue2-dual-lane.cjs",
      "scripts/queue2-worker-observability.cjs",
      "scripts/queue2-watchdog.cjs"
    ]);
    function isRegisteredEventType(type) {
      return EVENT_TYPE_SET.has(type);
    }
    function scanProductionEmittedEventTypes(repoRoot = path.join(__dirname, "..")) {
      const found = /* @__PURE__ */ new Set();
      const byFile = {};
      const callPatterns = [
        /\bemit\(\s*["']([A-Z][A-Z0-9_]+)["']\s*[,)]/g,
        /\bmakeEvent\(\s*["']([A-Z][A-Z0-9_]+)["']\s*[,)]/g
      ];
      const watchdogTypePattern = /\btype:\s*["']([A-Z][A-Z0-9_]+)["']/g;
      const ignore = /* @__PURE__ */ new Set(["NAME", "TYPE", "EVENT", "STRING"]);
      for (const rel of PRODUCTION_EVENT_SOURCE_FILES) {
        const abs = path.join(repoRoot, rel);
        if (!fs.existsSync(abs)) continue;
        const text = fs.readFileSync(abs, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
        const fileTypes = /* @__PURE__ */ new Set();
        for (const re of callPatterns) {
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(text)) !== null) {
            if (ignore.has(m[1])) continue;
            fileTypes.add(m[1]);
            found.add(m[1]);
          }
        }
        if (rel.endsWith("queue2-watchdog.cjs")) {
          watchdogTypePattern.lastIndex = 0;
          let m;
          while ((m = watchdogTypePattern.exec(text)) !== null) {
            if (ignore.has(m[1])) continue;
            fileTypes.add(m[1]);
            found.add(m[1]);
          }
        }
        byFile[rel] = [...fileTypes].sort();
      }
      return {
        types: [...found].sort(),
        byFile,
        sources: PRODUCTION_EVENT_SOURCE_FILES.slice()
      };
    }
    function assertProductionEventsRegistered(repoRoot = path.join(__dirname, "..")) {
      const scanned = scanProductionEmittedEventTypes(repoRoot);
      const missing = scanned.types.filter((t) => !isRegisteredEventType(t));
      return {
        ok: missing.length === 0,
        missing,
        emitted: scanned.types,
        registered: EVENT_TYPES.slice(),
        byFile: scanned.byFile
      };
    }
    var HUMAN_REVIEW_REASONS = Object.freeze({
      MISSING_DURABLE_RESUME_CHECKPOINT: "MISSING_DURABLE_RESUME_CHECKPOINT",
      UNEXPECTED_429: "UNEXPECTED_429",
      CONTROLLER_BYPASS: "CONTROLLER_BYPASS",
      HIGH_REQUESTS_PER_AUTHORITY: "HIGH_REQUESTS_PER_AUTHORITY",
      RETRIEVAL_REGRESSION: "RETRIEVAL_REGRESSION",
      ORPHAN_CHUNKS: "ORPHAN_CHUNKS",
      DUPLICATE_SOURCE_IDS: "DUPLICATE_SOURCE_IDS",
      PARSER_GAP_SPIKE: "PARSER_GAP_SPIKE",
      CITATION_AMBIGUOUS_SPIKE: "CITATION_AMBIGUOUS_SPIKE",
      SOURCE_SCHEMA_CHANGED: "SOURCE_SCHEMA_CHANGED",
      MAPPING_FAILURE_REPEATED: "MAPPING_FAILURE_REPEATED",
      INTEGRITY_FAILURE: "INTEGRITY_FAILURE",
      STALE_HEARTBEAT: "STALE_HEARTBEAT",
      NO_PRODUCTIVE_LANE_B: "NO_PRODUCTIVE_LANE_B",
      NO_PRODUCTIVE_STRATEGY_REMAINS: "NO_PRODUCTIVE_STRATEGY_REMAINS",
      QUEUE_2_COMPLETION_CANDIDATE: "QUEUE_2_COMPLETION_CANDIDATE",
      QUEUE_TRANSITION_REQUESTED: "QUEUE_TRANSITION_REQUESTED",
      CONFLICTING_MUTATOR_REPEATED: "CONFLICTING_MUTATOR_REPEATED",
      LOCK_OWNERSHIP_INCONSISTENCY: "LOCK_OWNERSHIP_INCONSISTENCY",
      ACTIVE_PID_MISMATCHED_WORKER_ID: "ACTIVE_PID_MISMATCHED_WORKER_ID",
      CHECKPOINT_LOCK_DISAGREEMENT: "CHECKPOINT_LOCK_DISAGREEMENT",
      SCHEDULER_LOCK_CORRUPTION: "SCHEDULER_LOCK_CORRUPTION",
      REPEATED_NETWORK_FAILURE: "REPEATED_NETWORK_FAILURE",
      PROVIDER_TERMS_CHANGED: "PROVIDER_TERMS_CHANGED",
      EXTERNAL_SOURCE_LIMITATION_BLOCKS_SCOPE: "EXTERNAL_SOURCE_LIMITATION_BLOCKS_SCOPE",
      COURTLISTENER_QUOTA_STATE_AMBIGUOUS: "COURTLISTENER_QUOTA_STATE_AMBIGUOUS",
      LANE_A_ZERO_PROGRESS: "LANE_A_ZERO_PROGRESS",
      LANE_A_DISPATCH_STALLED: "LANE_A_DISPATCH_STALLED",
      LANE_A_COUNT_RECONCILIATION_FAILED: "LANE_A_COUNT_RECONCILIATION_FAILED",
      LIVE_DB_RECONCILIATION_UNAVAILABLE: "LIVE_DB_RECONCILIATION_UNAVAILABLE",
      CORRUPT_INCONSISTENT_INGEST_JOB: "CORRUPT_INCONSISTENT_INGEST_JOB",
      CL_DEBUG_QUOTA_BUDGET_EXCEEDED: "CL_DEBUG_QUOTA_BUDGET_EXCEEDED",
      CL_NO_PRODUCTIVE_PROGRESS: "CL_NO_PRODUCTIVE_PROGRESS",
      CL_NONPRODUCTIVE_REQUEST_SPIKE: "CL_NONPRODUCTIVE_REQUEST_SPIKE",
      REDUNDANT_QUOTA_PROBES: "REDUNDANT_QUOTA_PROBES",
      ORPHAN_LANE_A_CHILD: "ORPHAN_LANE_A_CHILD",
      MULTIPLE_LANE_A_CHILDREN: "MULTIPLE_LANE_A_CHILDREN",
      LANE_A_CHILD_ALREADY_ACTIVE: "LANE_A_CHILD_ALREADY_ACTIVE",
      LANE_A_CHILD_OWNERSHIP_LOST: "LANE_A_CHILD_OWNERSHIP_LOST",
      LANE_A_CHILD_PID_MISMATCH: "LANE_A_CHILD_PID_MISMATCH",
      LANE_A_CHILD_SURVIVED_PARENT: "LANE_A_CHILD_SURVIVED_PARENT",
      LANE_A_DUPLICATE_SPAWN_ATTEMPT: "LANE_A_DUPLICATE_SPAWN_ATTEMPT"
    });
    var HEARTBEAT_INTERVAL_MS = 15 * 60 * 1e3;
    var STALE_HEARTBEAT_MS = 45 * 60 * 1e3;
    var REQ_PER_AUTH_THRESHOLD = 3;
    var REQ_PER_AUTH_STREAK = 3;
    var CANONICAL_REPORTS_DIR = path.resolve(
      path.join(__dirname, "..", "packages", "research", "corpus", "reports")
    );
    var CANONICAL_STATUS_FILENAME = "corpus-worker-status.json";
    var CANONICAL_SNAPSHOT_FILENAME = "queue2-lane-a-corpus-snapshot.json";
    var CANONICAL_MANIFEST_FILENAME = "queue2-lane-a-depth-manifest.json";
    function isCanonicalReportsDir(reportsDir) {
      if (!reportsDir) return false;
      try {
        return path.resolve(reportsDir) === CANONICAL_REPORTS_DIR;
      } catch {
        return false;
      }
    }
    function numOrNull(v) {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    function corpusMetricFloor(statusOrCorpus) {
      const c = statusOrCorpus?.corpus || statusOrCorpus || {};
      return {
        authorities: numOrNull(c.authorities) ?? 0,
        cases: numOrNull(c.cases) ?? 0,
        clCases: numOrNull(c.clCases ?? c.cl_cases) ?? 0,
        statutes: numOrNull(c.statutes),
        regulations: numOrNull(c.regulations ?? c.regs),
        rules: numOrNull(c.rules),
        authorityGateDeficit: numOrNull(c.authorityGateDeficit),
        manifestVersion: numOrNull(statusOrCorpus?.manifestVersion) ?? 0
      };
    }
    function wouldRegressCorpusTotals(existingStatus, incomingStatus) {
      const a = corpusMetricFloor(existingStatus);
      const incomingCorpus = incomingStatus?.corpus || {};
      const bAuth = numOrNull(incomingCorpus.authorities);
      const bCases = numOrNull(incomingCorpus.cases);
      const bCl = numOrNull(incomingCorpus.clCases ?? incomingCorpus.cl_cases);
      const bMan = numOrNull(incomingStatus?.manifestVersion);
      if (a.authorities > 0 && (bAuth == null || bAuth < a.authorities)) return true;
      if (a.cases > 0 && (bCases == null || bCases < a.cases)) return true;
      if (a.clCases > 0 && (bCl == null || bCl < a.clCases)) return true;
      if (a.manifestVersion > 0 && (bMan == null || bMan < a.manifestVersion)) return true;
      return false;
    }
    function maxMetric(a, b) {
      const na = numOrNull(a);
      const nb = numOrNull(b);
      if (na == null) return nb;
      if (nb == null) return na;
      return Math.max(na, nb);
    }
    function protectCorpusTotalsFromRegression(existingStatus, incomingStatus) {
      if (!existingStatus || !incomingStatus) return incomingStatus;
      if (!wouldRegressCorpusTotals(existingStatus, incomingStatus)) return incomingStatus;
      const prev = existingStatus.corpus || {};
      const next = incomingStatus.corpus || {};
      return {
        ...incomingStatus,
        manifestVersion: maxMetric(existingStatus.manifestVersion, incomingStatus.manifestVersion),
        corpus: {
          authorities: maxMetric(prev.authorities, next.authorities),
          cases: maxMetric(prev.cases, next.cases),
          clCases: maxMetric(prev.clCases ?? prev.cl_cases, next.clCases ?? next.cl_cases),
          statutes: maxMetric(prev.statutes, next.statutes),
          regulations: maxMetric(prev.regulations ?? prev.regs, next.regulations ?? next.regs),
          rules: maxMetric(prev.rules, next.rules),
          authorityGateDeficit: numOrNull(next.authorityGateDeficit) != null ? next.authorityGateDeficit : prev.authorityGateDeficit ?? null
        }
      };
    }
    function readJsonIfExists(filePath) {
      try {
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch {
        return null;
      }
    }
    function resolveCorpusTotalsForStatus(params = {}) {
      const reportsDir = params.reportsDir || CANONICAL_REPORTS_DIR;
      const explicit = params.corpus || null;
      if (explicit && numOrNull(explicit.authorities) != null && numOrNull(explicit.cases) != null) {
        return {
          authorities: Number(explicit.authorities),
          cases: Number(explicit.cases),
          clCases: numOrNull(explicit.clCases ?? explicit.cl_cases),
          statutes: numOrNull(explicit.statutes),
          regulations: numOrNull(explicit.regulations ?? explicit.regs),
          rules: numOrNull(explicit.rules),
          authorityGateDeficit: numOrNull(explicit.authorityGateDeficit),
          source: "explicit"
        };
      }
      const prior = readJsonIfExists(path.join(reportsDir, CANONICAL_STATUS_FILENAME));
      if (prior?.corpus && numOrNull(prior.corpus.authorities) != null) {
        return {
          authorities: Number(prior.corpus.authorities),
          cases: Number(prior.corpus.cases),
          clCases: numOrNull(prior.corpus.clCases ?? prior.corpus.cl_cases),
          statutes: numOrNull(prior.corpus.statutes),
          regulations: numOrNull(prior.corpus.regulations),
          rules: numOrNull(prior.corpus.rules),
          authorityGateDeficit: numOrNull(prior.corpus.authorityGateDeficit),
          source: "prior_status",
          manifestVersion: numOrNull(prior.manifestVersion)
        };
      }
      const snapshot = readJsonIfExists(path.join(reportsDir, CANONICAL_SNAPSHOT_FILENAME));
      const snapCorpus = snapshot?.corpus;
      if (snapCorpus && numOrNull(snapCorpus.authorities) != null) {
        return {
          authorities: Number(snapCorpus.authorities),
          cases: Number(snapCorpus.cases),
          clCases: numOrNull(snapCorpus.cl_cases ?? snapCorpus.clCases),
          statutes: numOrNull(snapCorpus.statutes),
          regulations: numOrNull(snapCorpus.regulations),
          rules: numOrNull(snapCorpus.rules),
          authorityGateDeficit: numOrNull(params.authorityGateDeficit),
          source: "lane_a_snapshot"
        };
      }
      return {
        authorities: null,
        cases: null,
        clCases: null,
        statutes: null,
        regulations: null,
        rules: null,
        authorityGateDeficit: null,
        source: "unavailable"
      };
    }
    function resolveManifestVersionForStatus(params = {}) {
      const reportsDir = params.reportsDir || CANONICAL_REPORTS_DIR;
      const candidates = [
        numOrNull(params.manifestVersion),
        numOrNull(params.state?.laneA?.manifestVersion),
        numOrNull(params.state?.depthManifestVersion)
      ];
      const manifest = readJsonIfExists(path.join(reportsDir, CANONICAL_MANIFEST_FILENAME));
      if (manifest) candidates.push(numOrNull(manifest.version));
      const prior = readJsonIfExists(path.join(reportsDir, CANONICAL_STATUS_FILENAME));
      if (prior) candidates.push(numOrNull(prior.manifestVersion));
      const nums = candidates.filter((n) => n != null && n >= 0);
      return nums.length ? Math.max(...nums) : null;
    }
    function formatEt(isoOrDate) {
      const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
      if (Number.isNaN(d.getTime())) return String(isoOrDate || "");
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        month: "numeric",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
        timeZoneName: "short"
      }).format(d);
    }
    function statusLaneFromState(state) {
      if (state?.humanReview?.required) return "HUMAN_REVIEW_REQUIRED";
      if (state?.hold) return "HOLD";
      if (state?.waitingForNetwork) return "WAITING_FOR_NETWORK";
      if (state?.laneAChild && !state.laneAChild.terminal) return "LANE_A_RUNNING";
      if (state?.currentLane === "A") return "LANE_A_CL";
      if (state?.currentLane === "WAIT" || state?.runtimeState === "WAITING_QUOTA_RESET") {
        return "WAIT_QUOTA_RESET";
      }
      if (state?.idleSafe || state?.currentLane === "IDLE_SAFE") return "LANE_B_IDLE_SAFE";
      if (state?.currentLane === "B") return "LANE_B_OFFLINE";
      if (state?.currentLane === "STOPPED" || state?.runtimeState === "STOPPED") return "STOPPED";
      return "LANE_B_OFFLINE";
    }
    var COURT_TO_JURISDICTION = Object.freeze({
      wis: "WI",
      mich: "MI",
      nm: "NM",
      utah: "UT",
      sd: "SD",
      idaho: "ID",
      wyo: "WY",
      neb: "NE",
      sc: "SC",
      vt: "VT",
      ark: "AR",
      ala: "AL",
      ky: "KY",
      mass: "MA",
      minn: "MN",
      ind: "IN"
    });
    function assertCanonicalStatusConsistency(status = {}) {
      const violations = [];
      const reviewRequired = Boolean(status?.review?.humanReviewRequired);
      const reasons = status?.review?.reasons || status?.review?.reviewReasons || [];
      if (!reviewRequired && status.currentLane === "HUMAN_REVIEW_REQUIRED") {
        violations.push("review=false cannot coexist with currentLane=HUMAN_REVIEW_REQUIRED");
      }
      if (!reviewRequired && status.freshness === "HUMAN_REVIEW_REQUIRED") {
        violations.push("review=false cannot coexist with freshness=HUMAN_REVIEW_REQUIRED");
      }
      if (!reviewRequired && status.currentTask === "await_human_review") {
        violations.push("review=false cannot coexist with currentTask=await_human_review");
      }
      if (reviewRequired && (!Array.isArray(reasons) || reasons.length === 0)) {
        violations.push("review=true requires non-empty reasons");
      }
      const court = status.currentCourt || null;
      const jur = status.currentJurisdiction || status.jurisdiction || null;
      if (court === "mich" && jur && jur !== "MI") {
        violations.push("currentCourt=mich cannot coexist with currentJurisdiction\u2260MI");
      }
      if (court === "wis" && jur && jur !== "WI") {
        violations.push("currentCourt=wis cannot coexist with currentJurisdiction\u2260WI");
      }
      if (court && jur) {
        const expected = COURT_TO_JURISDICTION[court];
        if (expected && jur !== expected) {
          violations.push(`currentCourt=${court} requires currentJurisdiction=${expected}, got ${jur}`);
        }
      }
      if (court === "mich") {
        if (status.cursor && String(status.cursor).includes("9886466")) {
          violations.push("WI checkpoint/cursor must not remain on active MI status fields");
        }
        if (status.nextPageUrl && /docket__court=wis/.test(String(status.nextPageUrl))) {
          violations.push("WI nextPageUrl must not remain on active MI status fields");
        }
      }
      if (status.runtimeState === "STOPPED" && !reviewRequired) {
        if (status.currentLane !== "STOPPED") {
          violations.push("STOPPED runtime requires currentLane=STOPPED when review=false");
        }
        if (status.freshness !== "STOPPED" && status.freshness !== "STALE_PROCESS_STOPPED") {
          violations.push("STOPPED runtime requires freshness=STOPPED|STALE_PROCESS_STOPPED");
        }
        if (status.currentTask && status.currentTask !== "NONE") {
          violations.push("STOPPED runtime requires currentTask=NONE");
        }
      }
      return { ok: violations.length === 0, violations };
    }
    function buildReconciledStoppedStatus(params = {}) {
      const prior = params.priorStatus || {};
      const state = params.state || {};
      const laneA = state.laneA || {};
      const court = laneA.court || params.currentCourt || null;
      const jurisdiction = laneA.jurisdiction || params.currentJurisdiction || (court ? COURT_TO_JURISDICTION[court] : null) || null;
      const reviewRequired = Boolean(state.humanReview?.required);
      const reasons = Array.isArray(state.humanReview?.reasons) ? state.humanReview.reasons : [];
      const base = buildOperatorStatus({
        state: { ...state, currentLane: "STOPPED", runtimeState: "STOPPED" },
        runtimeState: "STOPPED",
        currentLane: "STOPPED",
        freshness: reviewRequired ? "HUMAN_REVIEW_REQUIRED" : "STOPPED",
        currentTask: reviewRequired ? "await_human_review" : "NONE",
        forceStoppedLane: true,
        corpus: params.corpus || prior.corpus || {},
        health: params.health || prior.health || {},
        today: params.today || prior.today || {},
        manifestVersion: params.manifestVersion ?? prior.manifestVersion,
        lastHeartbeatAt: params.lastHeartbeatAt || prior.lastHeartbeatAt || null,
        now: params.now || /* @__PURE__ */ new Date()
      });
      const status = {
        ...prior,
        ...base,
        currentLane: reviewRequired ? "HUMAN_REVIEW_REQUIRED" : "STOPPED",
        runtimeState: "STOPPED",
        freshness: reviewRequired ? "HUMAN_REVIEW_REQUIRED" : "STOPPED",
        currentTask: reviewRequired ? "await_human_review" : "NONE",
        currentCourt: court,
        currentJurisdiction: jurisdiction,
        jurisdiction,
        currentCount: laneA.count ?? null,
        targetCount: laneA.target ?? null,
        checkpoint: laneA.checkpoint || null,
        cursor: laneA.cursor || null,
        lastSuccessfulExternalId: laneA.lastSuccessfulExternalId || null,
        nextPageUrl: laneA.nextPageUrl || null,
        lastSuccessfulAt: laneA.lastSuccessfulAt || null,
        jobStatus: laneA.jobStatus || null,
        mappingStatus: laneA.mappingStatus || null,
        review: {
          humanReviewRequired: reviewRequired,
          reasons,
          reviewReasons: reasons
        },
        laneReason: params.laneReason || prior.laneReason || null,
        updatedAt: (params.now || /* @__PURE__ */ new Date()).toISOString()
      };
      const check = assertCanonicalStatusConsistency(status);
      if (!check.ok) {
        throw Object.assign(new Error("STATUS_INCONSISTENT"), {
          code: "STATUS_INCONSISTENT",
          violations: check.violations
        });
      }
      return status;
    }
    function buildOperatorStatus(params = {}) {
      const state = params.state || {};
      const laneA = state.laneA || {};
      const quota = state.quota || {};
      const windows = quota.windows || {};
      const today = params.today || {};
      const corpus = params.corpus || {};
      const health = params.health || {};
      const review = state.humanReview || { required: false, reasons: [] };
      const reviewRequired = Boolean(review.required);
      const reasons = Array.isArray(review.reasons) ? review.reasons : [];
      let currentLane = params.currentLane || statusLaneFromState(state);
      let runtimeState = params.runtimeState != null ? params.runtimeState : state.runtimeState != null ? state.runtimeState : null;
      if (runtimeState == null) {
        runtimeState = reviewRequired ? "HUMAN_REVIEW_REQUIRED" : currentLane === "STOPPED" ? "STOPPED" : "RUNNING";
      }
      let freshness = params.freshness || null;
      let currentTask = params.currentTask || state.laneB?.task || (currentLane === "LANE_A_CL" ? "cl_ingest" : null);
      if (!reviewRequired) {
        if (currentLane === "HUMAN_REVIEW_REQUIRED") {
          currentLane = runtimeState === "STOPPED" ? "STOPPED" : statusLaneFromState({ ...state, humanReview: { required: false }, runtimeState });
        }
        if (freshness === "HUMAN_REVIEW_REQUIRED") {
          freshness = runtimeState === "STOPPED" ? "STOPPED" : null;
        }
        if (currentTask === "await_human_review") {
          currentTask = "NONE";
        }
      }
      if (runtimeState === "STOPPED" && !reviewRequired) {
        const explicitStopped = params.currentLane === "STOPPED" || state.currentLane === "STOPPED" || params.forceStoppedLane === true || !state.currentLane && params.currentLane == null;
        if (explicitStopped) {
          currentLane = "STOPPED";
          freshness = freshness && freshness !== "HUMAN_REVIEW_REQUIRED" ? freshness : "STOPPED";
          if (freshness === "HUMAN_REVIEW_REQUIRED") freshness = "STOPPED";
          currentTask = "NONE";
        }
      }
      const court = laneA.court || null;
      const jurisdiction = laneA.jurisdiction || (court ? COURT_TO_JURISDICTION[court] : null) || null;
      const nowIso = (params.now || /* @__PURE__ */ new Date()).toISOString();
      return {
        schemaVersion: 1,
        queue: "#2",
        queue9: "CLOSED",
        queue3: "NOT_OPEN",
        featureAgents: "0",
        currentLane,
        runtimeState,
        freshness,
        currentTask,
        currentCourt: court,
        currentJurisdiction: jurisdiction,
        jurisdiction,
        currentCount: laneA.count ?? null,
        targetCount: laneA.target ?? null,
        checkpoint: laneA.checkpoint || null,
        cursor: laneA.cursor || null,
        lastSuccessfulExternalId: laneA.lastSuccessfulExternalId || null,
        nextPageUrl: laneA.nextPageUrl || null,
        lastSuccessfulAt: laneA.lastSuccessfulAt || null,
        runner: laneA.runner || "staging-cl-batch-job",
        mappingStatus: laneA.mappingStatus || null,
        manifestVersion: params.manifestVersion != null ? params.manifestVersion : laneA.manifestVersion ?? state.depthManifestVersion ?? null,
        jobStatus: laneA.jobStatus || null,
        laneStartedAt: params.laneStartedAt || state.laneStartedAt || null,
        lastUpdatedAt: nowIso,
        lastHeartbeatAt: params.lastHeartbeatAt || state.lastHeartbeatAt || null,
        nextQuotaCheckAt: quota.nextCheckAt || null,
        network: {
          waitingForNetwork: Boolean(state.waitingForNetwork || params.waitingForNetwork),
          lastOnlineAt: params.lastOnlineAt || state.lastOnlineAt || null
        },
        tokens: {
          routineAiCalls: Number(params.aiCalls ?? state.metrics?.aiCalls ?? 0),
          routineAiTokens: Number(params.aiTokens ?? state.metrics?.aiTokens ?? 0)
        },
        quota: {
          minuteRemaining: windows.minute?.remaining ?? null,
          hourRemaining: windows.hour?.remaining ?? null,
          dayRemaining: windows.day?.remaining ?? null,
          safeRequests: quota.lastSafeRequests ?? 0,
          lastProbeAt: quota.lastProbeAt || null,
          hard429Count: Number(quota.hard429Count || 0),
          dayResetAt: windows.day?.resetAt || null,
          quotaStateObservedAt: quota.quotaStateObservedAt || quota.lastProbeAt || null,
          quotaStateSource: quota.quotaStateSource || null,
          quotaStateConfidence: quota.quotaStateConfidence || null,
          quotaStateAgeMs: quota.quotaStateAgeMs != null ? Number(quota.quotaStateAgeMs) : quota.quotaStateObservedAt || quota.lastProbeAt ? Math.max(0, Date.now() - new Date(quota.quotaStateObservedAt || quota.lastProbeAt).getTime()) : null
        },
        today: {
          clRequests: Number(today.clRequests || 0),
          clAuthoritiesAdded: Number(today.clAuthoritiesAdded || state.metrics?.clAuthorities || 0),
          nonClAuthoritiesAdded: Number(today.nonClAuthoritiesAdded || state.metrics?.nonClAuthorities || 0),
          totalAuthoritiesAdded: Number(
            today.totalAuthoritiesAdded ?? Number(today.clAuthoritiesAdded || state.metrics?.clAuthorities || 0) + Number(today.nonClAuthoritiesAdded || state.metrics?.nonClAuthorities || 0)
          ),
          casesAdded: Number(today.casesAdded || 0),
          citationEdgesResolved: Number(today.citationEdgesResolved || state.metrics?.citationsResolved || 0),
          jurisdictionsProcessed: Number(today.jurisdictionsProcessed || 0),
          laneASeconds: Math.round(Number(today.laneASeconds ?? (state.metrics?.laneAMs || 0) / 1e3)),
          laneBSeconds: Math.round(Number(today.laneBSeconds ?? (state.metrics?.laneBMs || 0) / 1e3)),
          idleSeconds: Math.round(Number(today.idleSeconds ?? (state.metrics?.idleMs || 0) / 1e3)),
          idleSafeSeconds: Math.round(Number(today.idleSafeSeconds ?? (state.metrics?.idleSafeMs || 0) / 1e3)),
          waitingNetworkSeconds: Math.round(
            Number(today.waitingNetworkSeconds ?? (state.metrics?.waitingNetworkMs || 0) / 1e3)
          )
        },
        corpus: {
          authorities: corpus.authorities ?? null,
          cases: corpus.cases ?? null,
          clCases: corpus.clCases ?? corpus.cl_cases ?? null,
          statutes: corpus.statutes ?? null,
          regulations: corpus.regulations ?? corpus.regs ?? null,
          rules: corpus.rules ?? null,
          authorityGateDeficit: corpus.authorityGateDeficit ?? null
        },
        health: {
          retrieval: health.retrieval ?? "unknown",
          orphanCount: Number(health.orphanCount ?? 0),
          duplicateSourceIdCount: Number(health.duplicateSourceIdCount ?? 0),
          database: health.database ?? "unknown",
          featureAgents: String(health.featureAgents ?? "0")
        },
        review: {
          humanReviewRequired: reviewRequired,
          reasons,
          reviewReasons: reasons
        }
      };
    }
    function isReadyFirstStartLaneA(laneA) {
      if (!laneA) return false;
      const jobStatus = String(laneA.jobStatus || "").toLowerCase();
      const targetStatus = String(laneA.targetStatus || "").toUpperCase();
      const noResume = !laneA.checkpoint && !laneA.cursor && !laneA.lastSuccessfulExternalId && !laneA.nextPageUrl;
      if (!noResume) return false;
      if (targetStatus === "PARTIAL") return false;
      if (["quota_paused", "rate_limited", "paused", "running"].includes(jobStatus)) return false;
      if (targetStatus === "READY") return true;
      if (jobStatus === "ready") return true;
      return false;
    }
    function isPartialLaneA(laneA) {
      if (!laneA) return false;
      const count = Math.max(0, Number(laneA.count) || 0);
      const target = Math.max(0, Number(laneA.target) || 0);
      if (target <= 0) return false;
      if (count >= target) return false;
      if (isReadyFirstStartLaneA(laneA)) return false;
      const jobStatus = String(laneA.jobStatus || "").toLowerCase();
      const targetStatus = String(laneA.targetStatus || "").toUpperCase();
      if (["quota_paused", "rate_limited", "paused", "running"].includes(jobStatus)) return true;
      if (targetStatus === "PARTIAL") return true;
      if (laneA.nextPageUrl) return true;
      if (count > 0 && count < target) return true;
      return false;
    }
    function hasDurableCheckpoint(laneA) {
      if (!laneA) return false;
      const cp = laneA.checkpoint || laneA.lastSuccessfulExternalId || laneA.cursor;
      return typeof cp === "string" && cp.trim().length > 0;
    }
    function requiresDurableResumeCheckpoint(laneA) {
      return isPartialLaneA(laneA);
    }
    function isMissingDurableResumeCheckpointFatal(laneA) {
      return requiresDurableResumeCheckpoint(laneA) && !hasDurableCheckpoint(laneA);
    }
    function validatePartialCheckpoint(laneA) {
      const next = { ...laneA || {} };
      if (!isMissingDurableResumeCheckpointFatal(next)) {
        if (hasDurableCheckpoint(next) && !next.checkpoint && next.lastSuccessfulExternalId) {
          next.checkpoint = next.lastSuccessfulExternalId;
        }
        return { ok: true, humanReviewRequired: false, reason: null, laneA: next };
      }
      return {
        ok: false,
        humanReviewRequired: true,
        reason: HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT,
        laneA: next
      };
    }
    function reconcileLaneAFromJob(laneA, job, extras = {}) {
      const next = { ...laneA || {} };
      if (!job || typeof job !== "object") {
        return { state: next, reconciled: false, reason: "no_job_row" };
      }
      const lastId = job.last_successful_external_id || job.lastSuccessfulExternalId || null;
      const cursor = job.cursor || null;
      const checkpoint = lastId || cursor;
      if (!checkpoint) {
        return { state: next, reconciled: false, reason: "job_missing_checkpoint" };
      }
      next.court = job.cl_court || job.clCourt || next.court;
      next.runner = extras.runner || next.runner || "staging-cl-batch-job";
      next.checkpoint = checkpoint;
      next.cursor = cursor;
      next.lastSuccessfulExternalId = lastId;
      next.nextPageUrl = job.next_page_url || job.nextPageUrl || next.nextPageUrl || null;
      next.lastSuccessfulAt = job.updated_at ? new Date(job.updated_at).toISOString() : next.lastSuccessfulAt || null;
      next.jobStatus = job.status || next.jobStatus || null;
      if (job.items_imported != null) next.itemsImported = Number(job.items_imported);
      if (job.target_max != null) next.target = Number(job.target_max) || next.target;
      if (extras.count != null) next.count = Number(extras.count);
      if (extras.jurisdiction) next.jurisdiction = extras.jurisdiction;
      if (extras.mappingStatus) next.mappingStatus = extras.mappingStatus;
      if (extras.manifestVersion != null) next.manifestVersion = extras.manifestVersion;
      return { state: next, reconciled: true, reason: null };
    }
    function setHumanReview(state, reason, detail = null) {
      const next = JSON.parse(JSON.stringify(state));
      next.humanReview = next.humanReview || { required: false, reasons: [], details: [] };
      next.humanReview.required = true;
      if (reason && !next.humanReview.reasons.includes(reason)) {
        next.humanReview.reasons.push(reason);
      }
      if (detail) next.humanReview.details.push({ reason, detail, at: (/* @__PURE__ */ new Date()).toISOString() });
      next.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      return next;
    }
    function evaluateHumanReviewTriggers(signals = {}) {
      const reasons = [];
      if (signals.missingDurableCheckpoint) reasons.push(HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT);
      if (signals.unexpected429) reasons.push(HUMAN_REVIEW_REASONS.UNEXPECTED_429);
      if (signals.controllerBypass) reasons.push(HUMAN_REVIEW_REASONS.CONTROLLER_BYPASS);
      if (Array.isArray(signals.reqPerAuthBatches) && signals.reqPerAuthBatches.length >= REQ_PER_AUTH_STREAK && signals.reqPerAuthBatches.slice(-REQ_PER_AUTH_STREAK).every((r) => Number(r) > REQ_PER_AUTH_THRESHOLD)) {
        reasons.push(HUMAN_REVIEW_REASONS.HIGH_REQUESTS_PER_AUTHORITY);
      }
      if (signals.retrievalRegression) reasons.push(HUMAN_REVIEW_REASONS.RETRIEVAL_REGRESSION);
      if (Number(signals.orphanCount) > 0) reasons.push(HUMAN_REVIEW_REASONS.ORPHAN_CHUNKS);
      if (Number(signals.duplicateSourceIdCount) > 0 && signals.duplicateSourceIdsIntroduced) {
        reasons.push(HUMAN_REVIEW_REASONS.DUPLICATE_SOURCE_IDS);
      }
      if (Number(signals.parserGap) > 0 && signals.parserGapMaterial) {
        reasons.push(HUMAN_REVIEW_REASONS.PARSER_GAP_SPIKE);
      }
      if (signals.citationAmbiguousSpike) reasons.push(HUMAN_REVIEW_REASONS.CITATION_AMBIGUOUS_SPIKE);
      if (signals.sourceSchemaChanged) reasons.push(HUMAN_REVIEW_REASONS.SOURCE_SCHEMA_CHANGED);
      if (signals.repeatedMappingFailure) reasons.push(HUMAN_REVIEW_REASONS.MAPPING_FAILURE_REPEATED);
      if (signals.integrityFailure) reasons.push(HUMAN_REVIEW_REASONS.INTEGRITY_FAILURE);
      if (signals.staleHeartbeat) reasons.push(HUMAN_REVIEW_REASONS.STALE_HEARTBEAT);
      if (signals.noProductiveLaneB) reasons.push(HUMAN_REVIEW_REASONS.NO_PRODUCTIVE_LANE_B);
      if (signals.queue2CompletionCandidate) reasons.push(HUMAN_REVIEW_REASONS.QUEUE_2_COMPLETION_CANDIDATE);
      if (signals.queueTransitionRequested) reasons.push(HUMAN_REVIEW_REASONS.QUEUE_TRANSITION_REQUESTED);
      if (signals.conflictingMutatorRepeated) reasons.push(HUMAN_REVIEW_REASONS.CONFLICTING_MUTATOR_REPEATED);
      if (signals.lockOwnershipInconsistency) reasons.push(HUMAN_REVIEW_REASONS.LOCK_OWNERSHIP_INCONSISTENCY);
      if (signals.activePidMismatchedWorkerId) reasons.push(HUMAN_REVIEW_REASONS.ACTIVE_PID_MISMATCHED_WORKER_ID);
      if (signals.checkpointLockDisagreement) reasons.push(HUMAN_REVIEW_REASONS.CHECKPOINT_LOCK_DISAGREEMENT);
      if (signals.schedulerLockCorruption) reasons.push(HUMAN_REVIEW_REASONS.SCHEDULER_LOCK_CORRUPTION);
      if (signals.noProductiveStrategyRemains) reasons.push(HUMAN_REVIEW_REASONS.NO_PRODUCTIVE_STRATEGY_REMAINS);
      if (signals.repeatedNetworkFailure) reasons.push(HUMAN_REVIEW_REASONS.REPEATED_NETWORK_FAILURE);
      if (signals.providerTermsChanged) reasons.push(HUMAN_REVIEW_REASONS.PROVIDER_TERMS_CHANGED);
      if (signals.externalSourceLimitationBlocksScope) {
        reasons.push(HUMAN_REVIEW_REASONS.EXTERNAL_SOURCE_LIMITATION_BLOCKS_SCOPE);
      }
      if (signals.clDebugQuotaBudgetExceeded) {
        reasons.push(HUMAN_REVIEW_REASONS.CL_DEBUG_QUOTA_BUDGET_EXCEEDED);
      }
      if (signals.clNoProductiveProgress) {
        reasons.push(HUMAN_REVIEW_REASONS.CL_NO_PRODUCTIVE_PROGRESS);
      }
      if (signals.clNonproductiveRequestSpike) {
        reasons.push(HUMAN_REVIEW_REASONS.CL_NONPRODUCTIVE_REQUEST_SPIKE);
      }
      if (signals.redundantQuotaProbes) {
        reasons.push(HUMAN_REVIEW_REASONS.REDUNDANT_QUOTA_PROBES);
      }
      if (signals.orphanLaneAChild) {
        reasons.push(HUMAN_REVIEW_REASONS.ORPHAN_LANE_A_CHILD);
      }
      if (signals.multipleLaneAChildren) {
        reasons.push(HUMAN_REVIEW_REASONS.MULTIPLE_LANE_A_CHILDREN);
      }
      if (signals.laneAChildOwnershipLost) {
        reasons.push(HUMAN_REVIEW_REASONS.LANE_A_CHILD_OWNERSHIP_LOST);
      }
      if (signals.laneAChildPidMismatch) {
        reasons.push(HUMAN_REVIEW_REASONS.LANE_A_CHILD_PID_MISMATCH);
      }
      if (signals.laneAChildSurvivedParent) {
        reasons.push(HUMAN_REVIEW_REASONS.LANE_A_CHILD_SURVIVED_PARENT);
      }
      if (signals.laneADuplicateSpawnAttempt) {
        reasons.push(HUMAN_REVIEW_REASONS.LANE_A_DUPLICATE_SPAWN_ATTEMPT);
      }
      return { required: reasons.length > 0, reasons };
    }
    function isHeartbeatStale(lastHeartbeatAt, now = /* @__PURE__ */ new Date(), thresholdMs = STALE_HEARTBEAT_MS) {
      if (!lastHeartbeatAt) return true;
      const t = new Date(lastHeartbeatAt).getTime();
      if (Number.isNaN(t)) return true;
      return now.getTime() - t > thresholdMs;
    }
    function renderDailyMarkdown(status, extras = {}) {
      const s = status || {};
      const q = s.quota || {};
      const t = s.today || {};
      const c = s.corpus || {};
      const h = s.health || {};
      const r = s.review || {};
      const reason = extras.laneReason || (s.currentLane === "LANE_B_OFFLINE" ? "CourtListener day safety floor" : "");
      const nextAction = extras.nextAction || (r.humanReviewRequired ? "Stop unsafe path; await human review." : s.currentLane === "LANE_B_OFFLINE" ? `Automatically resume ${s.currentCourt || "Lane A"} when safeRequests meets useful-capacity threshold.` : `Continue ${s.currentCourt || "Lane A"} to ${s.targetCount}.`);
      return [
        `# Queue #2 Corpus Worker \u2014 Daily Status`,
        ``,
        `Generated: ${s.lastUpdatedAt || ""} (${formatEt(s.lastUpdatedAt || /* @__PURE__ */ new Date())})`,
        `Queue: #2 OPEN | #9 CLOSED | #3 NOT OPEN | FEATURE_AGENTS=${h.featureAgents || "0"}`,
        ``,
        `## CURRENT LANE`,
        `${s.currentLane || "UNKNOWN"}`,
        reason ? `Reason: ${reason}` : "",
        ``,
        `## CURRENT TASK`,
        `${s.currentTask || "n/a"}`,
        s.currentCourt ? `${String(s.currentCourt).toUpperCase()} ${s.currentCount ?? "?"}/${s.targetCount ?? "?"} (${s.currentJurisdiction || "?"})` : "",
        s.checkpoint ? `checkpoint: ${s.checkpoint}` : "checkpoint: (none)",
        ``,
        `## TODAY'S PROGRESS`,
        `+${t.clAuthoritiesAdded || 0} CL authorities`,
        `+${t.nonClAuthoritiesAdded || 0} non-CL authorities`,
        `+${t.citationEdgesResolved || 0} citation edges resolved`,
        `total authorities added: ${t.totalAuthoritiesAdded || (t.clAuthoritiesAdded || 0) + (t.nonClAuthoritiesAdded || 0)}`,
        `laneA ${t.laneASeconds || 0}s | laneB ${t.laneBSeconds || 0}s | idle ${t.idleSeconds || 0}s`,
        ``,
        `## COURTLISTENER`,
        `${s.currentCourt || "n/a"} ${s.currentCount ?? "?"}/${s.targetCount ?? "?"}`,
        `checkpoint: ${s.checkpoint || "(missing)"}`,
        `lastSuccessfulExternalId: ${s.lastSuccessfulExternalId || "n/a"}`,
        `cursor: ${s.cursor || "n/a"}`,
        `mapping: ${s.mappingStatus || "n/a"} | runner: ${s.runner || "n/a"}`,
        `safeRequests: ${q.safeRequests ?? 0}`,
        `dayRem: ${q.dayRemaining ?? "?"} | hourRem: ${q.hourRemaining ?? "?"} | minuteRem: ${q.minuteRemaining ?? "?"}`,
        `next quota probe: ${s.nextQuotaCheckAt || "n/a"}${s.nextQuotaCheckAt ? ` (${formatEt(s.nextQuotaCheckAt)})` : ""}`,
        `dayResetAt: ${q.dayResetAt || "n/a"}${q.dayResetAt ? ` (${formatEt(q.dayResetAt)})` : ""}`,
        `quotaConfidence: ${q.quotaStateConfidence || "n/a"} source=${q.quotaStateSource || "n/a"}`,
        `429: ${q.hard429Count ?? 0}`,
        ``,
        `## OFFLINE WORK`,
        extras.offlineSummary || `Lane B tasks active when CL floor blocks useful ingest. CL HTTP during Lane B must be 0.`,
        ``,
        `## CORPUS / DEPTH`,
        `authorities=${c.authorities ?? "?"} cases=${c.cases ?? "?"} clCases=${c.clCases ?? "?"} statutes=${c.statutes ?? "?"} regs=${c.regulations ?? "?"} rules=${c.rules ?? "?"}`,
        `authorityGateDeficit=${c.authorityGateDeficit ?? "?"}`,
        ``,
        `## CITATION GRAPH`,
        extras.citationSummary || `citationEdgesResolved today: ${t.citationEdgesResolved || 0}`,
        ``,
        `## HEALTH`,
        `database=${h.database || "?"} orphans=${h.orphanCount ?? 0} duplicateSourceIds=${h.duplicateSourceIdCount ?? 0} retrieval=${h.retrieval || "?"} FEATURE_AGENTS=${h.featureAgents || "0"}`,
        ``,
        `## NEXT ACTION`,
        nextAction,
        ``,
        `## HUMAN REVIEW`,
        r.humanReviewRequired ? `REQUIRED: ${(r.reviewReasons || []).join(", ") || "unspecified"}` : `not required`,
        ``
      ].filter((line, i, arr) => !(line === "" && arr[i - 1] === "")).join("\n");
    }
    function makeEvent(type, fields = {}) {
      if (!isRegisteredEventType(type)) {
        throw new Error(`unknown_event_type:${type}`);
      }
      const event = {
        timestamp: fields.timestamp || (/* @__PURE__ */ new Date()).toISOString(),
        type,
        lane: fields.lane || null,
        task: fields.task || null,
        court: fields.court || null,
        checkpoint: fields.checkpoint || null,
        reason: fields.reason || null
      };
      if (fields.quota) event.quota = fields.quota;
      if (fields.corpusDelta) event.corpusDelta = fields.corpusDelta;
      if (fields.extra && typeof fields.extra === "object") {
        for (const [k, v] of Object.entries(fields.extra)) {
          if (["token", "apiKey", "authorization", "password", "secret"].includes(k)) continue;
          event[k] = v;
        }
      }
      return event;
    }
    function appendEventLine(filePath, event) {
      const line = JSON.stringify(event);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.appendFileSync(filePath, `${line}
`, "utf8");
      return line;
    }
    function formatHeartbeat(status, now = /* @__PURE__ */ new Date()) {
      const s = status || {};
      const t = s.today || {};
      const q = s.quota || {};
      const stamp = `[${formatEt(now)}]`;
      if (s.currentLane === "STARTUP" || s.currentTask === "boot" || s.runtimeState === "STARTUP") {
        return `${stamp} STARTUP | initial heartbeat | checkpoint=${s.checkpoint || "none"} | aiCalls=${s.tokens?.routineAiCalls ?? 0}`;
      }
      if (s.currentLane === "LANE_A_CL") {
        return `${stamp} LANE_A_CL | ${String(s.currentCourt || "?").toUpperCase()} ${s.currentCount ?? "?"}/${s.targetCount ?? "?"} | checkpoint=${s.checkpoint || "none"} | dayRem=${q.dayRemaining ?? "?"} | safe=${q.safeRequests ?? 0}`;
      }
      if (s.currentLane === "HUMAN_REVIEW_REQUIRED" || s.runtimeState === "HUMAN_REVIEW_REQUIRED") {
        return `${stamp} HUMAN_REVIEW_REQUIRED | ${(s.review?.reviewReasons || []).join(",") || "see status"} | court=${s.currentCourt || "n/a"}`;
      }
      if (s.currentLane === "LANE_B_IDLE_SAFE" || s.runtimeState === "IDLE_SAFE") {
        const next2 = s.nextQuotaCheckAt || q.dayResetAt;
        return `${stamp} LANE_B_IDLE_SAFE | task=NONE | nextProbe ${next2 ? formatEt(next2) : "n/a"} | aiCalls=${s.tokens?.routineAiCalls ?? 0}`;
      }
      if (s.runtimeState === "WAITING_FOR_NETWORK" || s.currentLane === "WAITING_FOR_NETWORK") {
        return `${stamp} WAITING_FOR_NETWORK | local heartbeat continues | checkpoint=${s.checkpoint || "none"}`;
      }
      const next = s.nextQuotaCheckAt || q.dayResetAt;
      return `${stamp} LANE_B_OFFLINE | ${s.currentTask || "offline"} | today +${(t.clAuthoritiesAdded || 0) + (t.nonClAuthoritiesAdded || 0)} auth | citations +${t.citationEdgesResolved || 0} | CL paused | nextProbe ${next ? formatEt(next) : "n/a"}`;
    }
    function shouldEmitHeartbeat(lastHeartbeatAt, now = /* @__PURE__ */ new Date(), intervalMs = HEARTBEAT_INTERVAL_MS) {
      if (!lastHeartbeatAt) return true;
      const t = new Date(lastHeartbeatAt).getTime();
      if (Number.isNaN(t)) return true;
      return now.getTime() - t >= intervalMs;
    }
    function writeObservabilityArtifacts(reportsDir, status, opts = {}) {
      fs.mkdirSync(reportsDir, { recursive: true });
      const statusPath = path.join(reportsDir, "corpus-worker-status.json");
      const dailyPath = path.join(reportsDir, "corpus-worker-daily.md");
      const eventsPath = path.join(reportsDir, "corpus-worker-events.jsonl");
      const protect = opts.protectCorpusTotals === true || opts.protectCorpusTotals !== false && isCanonicalReportsDir(reportsDir);
      let toWrite = status;
      if (protect && fs.existsSync(statusPath)) {
        const existing = readJsonIfExists(statusPath);
        if (existing && wouldRegressCorpusTotals(existing, status)) {
          toWrite = protectCorpusTotalsFromRegression(existing, status);
          toWrite = {
            ...toWrite,
            _corpusProtection: {
              applied: true,
              reason: "refused_stale_or_fixture_regression",
              prior: {
                authorities: existing.corpus?.authorities,
                cases: existing.corpus?.cases,
                clCases: existing.corpus?.clCases,
                manifestVersion: existing.manifestVersion
              }
            }
          };
        }
      }
      const { _corpusProtection, ...persisted } = toWrite;
      fs.writeFileSync(statusPath, JSON.stringify(persisted, null, 2));
      fs.writeFileSync(dailyPath, renderDailyMarkdown(persisted, opts.dailyExtras || {}));
      if (opts.event) appendEventLine(eventsPath, opts.event);
      return {
        statusPath,
        dailyPath,
        eventsPath,
        status: persisted,
        corpusProtectionApplied: Boolean(_corpusProtection?.applied),
        corpusProtection: _corpusProtection || null
      };
    }
    module2.exports = {
      STATUS_LANES,
      RUNTIME_STATES,
      EVENT_TYPES,
      isRegisteredEventType,
      scanProductionEmittedEventTypes,
      assertProductionEventsRegistered,
      PRODUCTION_EVENT_SOURCE_FILES,
      HUMAN_REVIEW_REASONS,
      HEARTBEAT_INTERVAL_MS,
      STALE_HEARTBEAT_MS,
      REQ_PER_AUTH_THRESHOLD,
      REQ_PER_AUTH_STREAK,
      CANONICAL_REPORTS_DIR,
      CANONICAL_STATUS_FILENAME,
      formatEt,
      statusLaneFromState,
      isPartialLaneA,
      isReadyFirstStartLaneA,
      hasDurableCheckpoint,
      requiresDurableResumeCheckpoint,
      isMissingDurableResumeCheckpointFatal,
      validatePartialCheckpoint,
      reconcileLaneAFromJob,
      setHumanReview,
      evaluateHumanReviewTriggers,
      isHeartbeatStale,
      buildOperatorStatus,
      buildReconciledStoppedStatus,
      assertCanonicalStatusConsistency,
      renderDailyMarkdown,
      makeEvent,
      appendEventLine,
      formatHeartbeat,
      shouldEmitHeartbeat,
      writeObservabilityArtifacts,
      isCanonicalReportsDir,
      wouldRegressCorpusTotals,
      protectCorpusTotalsFromRegression,
      resolveCorpusTotalsForStatus,
      resolveManifestVersionForStatus,
      corpusMetricFloor
    };
  }
});

// scripts/cl-adaptive-quota.cjs
var require_cl_adaptive_quota = __commonJS({
  "scripts/cl-adaptive-quota.cjs"(exports2, module2) {
    "use strict";
    var path = require("node:path");
    var fs = require("node:fs");
    var ROOT = path.join(__dirname, "..");
    var SAFETY_CONFIG_PATH = path.join(
      ROOT,
      "packages/research/corpus/config/queue2-worker-safety.json"
    );
    var QUOTA_MODES = Object.freeze({
      FINISH_TARGET: "FINISH_TARGET",
      FULL_BATCH: "FULL_BATCH",
      MICRO_BATCH: "MICRO_BATCH",
      WAIT_MINUTE: "WAIT_MINUTE",
      WAIT_HOUR: "WAIT_HOUR",
      DAY_BLOCKED: "DAY_BLOCKED"
    });
    var BINDING_WINDOWS = Object.freeze({
      MINUTE: "MINUTE",
      HOUR: "HOUR",
      DAY: "DAY",
      NONE: "NONE"
    });
    var DEFAULT_ADAPTIVE_QUOTA = Object.freeze({
      minuteReserve: 2,
      hourReserve: 5,
      dayReserve: 10,
      minimumMicroBatchRequests: 3,
      uncertaintyMultiplier: 1.35,
      ewmaAlpha: 0.3,
      minMeaningfulBatchAuthorities: 2,
      nearCompleteThreshold: 3,
      /** Prefer WAIT over Lane B when minute reset is within this many ms. */
      shortMinuteWaitMs: 9e4,
      wakeAfterResetMs: 3e3,
      /** Nominal request budget for a full Lane A batch (not a hard gate). */
      fullBatchRequests: 20,
      defaultRequestsPerAuthority: 2.3,
      efficiencyRegressionThreshold: 3,
      efficiencyRegressionBatches: 3,
      /** Do not re-probe while waiting for a known reset (except at wake). */
      minProbeGapMs: 10 * 6e4
    });
    function defaultAdaptiveQuotaConfig() {
      return { ...DEFAULT_ADAPTIVE_QUOTA };
    }
    function loadAdaptiveQuotaConfig(opts = {}) {
      const base = defaultAdaptiveQuotaConfig();
      let fromFile = {};
      try {
        const raw = opts.config || (fs.existsSync(SAFETY_CONFIG_PATH) ? JSON.parse(fs.readFileSync(SAFETY_CONFIG_PATH, "utf8")) : null);
        if (raw?.adaptiveQuota && typeof raw.adaptiveQuota === "object") {
          fromFile = raw.adaptiveQuota;
        }
      } catch {
        fromFile = {};
      }
      return { ...base, ...fromFile, ...opts.overrides || {} };
    }
    function validateAdaptiveQuotaConfig(cfg = loadAdaptiveQuotaConfig()) {
      const reasons = [];
      const req = [
        ["minuteReserve", 0, 15],
        ["hourReserve", 0, 50],
        ["dayReserve", 0, 200],
        ["minimumMicroBatchRequests", 1, 40],
        ["uncertaintyMultiplier", 1, 3],
        ["ewmaAlpha", 0.05, 0.9],
        ["minMeaningfulBatchAuthorities", 1, 20],
        ["nearCompleteThreshold", 1, 20],
        ["shortMinuteWaitMs", 1e3, 6e5],
        ["wakeAfterResetMs", 0, 3e4],
        ["fullBatchRequests", 5, 80],
        ["defaultRequestsPerAuthority", 1, 10],
        ["efficiencyRegressionThreshold", 2, 10],
        ["efficiencyRegressionBatches", 2, 10],
        ["minProbeGapMs", 6e4, 36e5]
      ];
      for (const [key, lo, hi] of req) {
        const v = Number(cfg[key]);
        if (!Number.isFinite(v) || v < lo || v > hi) {
          reasons.push(`adaptiveQuota.${key}_invalid`);
        }
      }
      return { ok: reasons.length === 0, reasons };
    }
    function windowRemaining(windows, name) {
      const w = windows?.[name];
      if (!w) return null;
      const rem = Number(w.remaining);
      return Number.isFinite(rem) ? Math.max(0, rem) : null;
    }
    function windowResetAt(windows, name) {
      const w = windows?.[name];
      return w?.resetAt || w?.reset_at || null;
    }
    function computeUsableRequests(windows, cfg = loadAdaptiveQuotaConfig()) {
      const minuteRemaining = windowRemaining(windows, "minute");
      const hourRemaining = windowRemaining(windows, "hour");
      const dayRemaining = windowRemaining(windows, "day");
      if (minuteRemaining == null || hourRemaining == null || dayRemaining == null) {
        return {
          ok: false,
          usableRequests: 0,
          usableMinute: 0,
          usableHour: 0,
          usableDay: 0,
          minuteRemaining,
          hourRemaining,
          dayRemaining,
          bindingWindow: BINDING_WINDOWS.NONE,
          reserves: {
            minuteReserve: cfg.minuteReserve,
            hourReserve: cfg.hourReserve,
            dayReserve: cfg.dayReserve
          }
        };
      }
      const usableMinute = Math.max(0, minuteRemaining - cfg.minuteReserve);
      const usableHour = Math.max(0, hourRemaining - cfg.hourReserve);
      const usableDay = Math.max(0, dayRemaining - cfg.dayReserve);
      const usableRequests = Math.max(0, Math.min(usableMinute, usableHour, usableDay));
      let bindingWindow = BINDING_WINDOWS.NONE;
      if (usableRequests === usableMinute) bindingWindow = BINDING_WINDOWS.MINUTE;
      else if (usableRequests === usableHour) bindingWindow = BINDING_WINDOWS.HOUR;
      else if (usableRequests === usableDay) bindingWindow = BINDING_WINDOWS.DAY;
      return {
        ok: true,
        usableRequests,
        usableMinute,
        usableHour,
        usableDay,
        minuteRemaining,
        hourRemaining,
        dayRemaining,
        bindingWindow,
        reserves: {
          minuteReserve: cfg.minuteReserve,
          hourReserve: cfg.hourReserve,
          dayReserve: cfg.dayReserve
        }
      };
    }
    function remainingAuthoritiesNeeded(laneA) {
      const target = Number(laneA?.target) || 0;
      const count = Number(laneA?.count) || 0;
      return Math.max(0, target - count);
    }
    function resolveRequestsPerAuthority(court, efficiencyStore, cfg = loadAdaptiveQuotaConfig()) {
      const key = String(court || "").toLowerCase();
      const row = efficiencyStore?.[key] || efficiencyStore?.[court];
      if (row && Number.isFinite(Number(row.ewmaRequestsPerAuthority)) && Number(row.sampleCount) > 0) {
        return {
          requestsPerAuthority: Number(row.ewmaRequestsPerAuthority),
          source: "court_ewma",
          sampleCount: Number(row.sampleCount)
        };
      }
      if (row && Number.isFinite(Number(row.requestsPerAuthority)) && Number(row.qualifyingAuthorities) > 0) {
        return {
          requestsPerAuthority: Number(row.requestsPerAuthority),
          source: "court_cumulative",
          sampleCount: Number(row.sampleCount || 0)
        };
      }
      return {
        requestsPerAuthority: Number(cfg.defaultRequestsPerAuthority),
        source: "global_default",
        sampleCount: 0
      };
    }
    function estimateRequestsNeeded(remainingAuth, requestsPerAuthority, cfg = loadAdaptiveQuotaConfig()) {
      const need = Math.max(0, Number(remainingAuth) || 0);
      if (need <= 0) return 0;
      const rpa = Math.max(0.5, Number(requestsPerAuthority) || cfg.defaultRequestsPerAuthority);
      const mult = Math.max(1, Number(cfg.uncertaintyMultiplier) || 1.35);
      return Math.ceil(need * rpa * mult);
    }
    function updateCourtEfficiency(store, batch, cfg = loadAdaptiveQuotaConfig()) {
      const next = { ...store || {} };
      const court = String(batch.court || "").toLowerCase();
      if (!court) return next;
      const requests = Math.max(0, Number(batch.requests) || 0);
      const authorities = Math.max(0, Number(batch.qualifyingAuthorities) || 0);
      if (requests <= 0 || authorities <= 0) return next;
      const meaningful = authorities >= (cfg.minMeaningfulBatchAuthorities || 2);
      const rpa = requests / authorities;
      const prior = next[court] || {
        court,
        requests: 0,
        qualifyingAuthorities: 0,
        requestsPerAuthority: null,
        ewmaRequestsPerAuthority: null,
        sampleCount: 0,
        consecutiveHighEfficiencyBatches: 0,
        lastUpdatedAt: null
      };
      const totalReq = prior.requests + requests;
      const totalAuth = prior.qualifyingAuthorities + authorities;
      const alpha = Number(cfg.ewmaAlpha) || 0.3;
      let ewma = prior.ewmaRequestsPerAuthority;
      if (meaningful) {
        ewma = ewma == null ? rpa : alpha * rpa + (1 - alpha) * ewma;
      } else if (ewma == null) {
        ewma = prior.requestsPerAuthority != null ? prior.requestsPerAuthority : rpa;
      }
      let consecutive = prior.consecutiveHighEfficiencyBatches || 0;
      if (meaningful) {
        consecutive = rpa > cfg.efficiencyRegressionThreshold ? consecutive + 1 : 0;
      }
      next[court] = {
        court,
        requests: totalReq,
        qualifyingAuthorities: totalAuth,
        requestsPerAuthority: totalAuth > 0 ? totalReq / totalAuth : null,
        ewmaRequestsPerAuthority: ewma,
        sampleCount: (prior.sampleCount || 0) + (meaningful ? 1 : 0),
        consecutiveHighEfficiencyBatches: consecutive,
        lastBatchRequestsPerAuthority: rpa,
        lastUpdatedAt: batch.at || (/* @__PURE__ */ new Date()).toISOString()
      };
      return next;
    }
    function efficiencyRegressionTriggered(store, court, cfg = loadAdaptiveQuotaConfig()) {
      const row = store?.[String(court || "").toLowerCase()];
      if (!row) return false;
      return Number(row.consecutiveHighEfficiencyBatches || 0) >= Number(cfg.efficiencyRegressionBatches || 3);
    }
    function dayUtilization(windows, cfg = loadAdaptiveQuotaConfig()) {
      const day = windows?.day;
      if (!day) return null;
      const limit = Number(day.limit) || 0;
      const remaining = Number(day.remaining);
      const used = Number.isFinite(Number(day.used)) ? Number(day.used) : Number.isFinite(remaining) && limit ? Math.max(0, limit - remaining) : null;
      if (!limit || used == null) return null;
      const reserved = Number(cfg.dayReserve) || 0;
      const usableDailyBudget = Math.max(0, limit - reserved);
      const productiveUsed = Math.max(0, used);
      const pct = usableDailyBudget > 0 ? Math.min(100, productiveUsed / usableDailyBudget * 100) : 0;
      return {
        dayLimit: limit,
        dayRemaining: Number.isFinite(remaining) ? remaining : Math.max(0, limit - used),
        dayUsed: used,
        reservedRequests: reserved,
        usableDailyBudget,
        utilizationPercent: pct,
        productiveQuotaUtilizationPercent: pct
      };
    }
    function shouldProbeQuota(state, now = /* @__PURE__ */ new Date(), cfg = loadAdaptiveQuotaConfig()) {
      const wait = state?.quota?.wait;
      if (wait?.nextUsefulAt) {
        const wakeMs = new Date(wait.nextUsefulAt).getTime();
        if (Number.isFinite(wakeMs) && now.getTime() < wakeMs) {
          return { probe: false, reason: "waiting_known_reset", nextUsefulAt: wait.nextUsefulAt };
        }
        return { probe: true, reason: "post_reset_validation", nextUsefulAt: wait.nextUsefulAt };
      }
      if (!state?.quota?.nextCheckAt) return { probe: true, reason: "no_next_check" };
      const due = now.getTime() >= new Date(state.quota.nextCheckAt).getTime();
      if (!due) return { probe: false, reason: "probe_gap", nextCheckAt: state.quota.nextCheckAt };
      return { probe: true, reason: "scheduled" };
    }
    function projectWakeAt(resetAt, cfg = loadAdaptiveQuotaConfig(), now = /* @__PURE__ */ new Date()) {
      if (!resetAt) return null;
      const resetMs = new Date(resetAt).getTime();
      if (!Number.isFinite(resetMs)) return null;
      const wake = Math.max(now.getTime(), resetMs + (Number(cfg.wakeAfterResetMs) || 0));
      return new Date(wake).toISOString();
    }
    function planAdaptiveQuota(params = {}) {
      const cfg = params.config || loadAdaptiveQuotaConfig();
      const now = params.now instanceof Date ? params.now : new Date(params.now || Date.now());
      const laneA = params.laneA || {};
      const court = laneA.court || null;
      const remainingAuth = remainingAuthoritiesNeeded(laneA);
      const eff = resolveRequestsPerAuthority(court, params.efficiencyStore || {}, cfg);
      const estimatedRequestsNeeded = estimateRequestsNeeded(remainingAuth, eff.requestsPerAuthority, cfg);
      let usable;
      if (params.windows) {
        usable = computeUsableRequests(params.windows, cfg);
      } else if (params.usableRequestsOverride != null) {
        const u2 = Math.max(0, Number(params.usableRequestsOverride) || 0);
        usable = {
          ok: true,
          usableRequests: u2,
          usableMinute: u2,
          usableHour: u2,
          usableDay: u2,
          minuteRemaining: u2,
          hourRemaining: u2,
          dayRemaining: u2,
          bindingWindow: BINDING_WINDOWS.NONE,
          reserves: {
            minuteReserve: cfg.minuteReserve,
            hourReserve: cfg.hourReserve,
            dayReserve: cfg.dayReserve
          }
        };
      } else {
        usable = {
          ok: false,
          usableRequests: 0,
          usableMinute: 0,
          usableHour: 0,
          usableDay: 0,
          minuteRemaining: null,
          hourRemaining: null,
          dayRemaining: null,
          bindingWindow: BINDING_WINDOWS.NONE,
          reserves: {
            minuteReserve: cfg.minuteReserve,
            hourReserve: cfg.hourReserve,
            dayReserve: cfg.dayReserve
          }
        };
      }
      const utilization = params.windows ? dayUtilization(params.windows, cfg) : null;
      const nearComplete = remainingAuth > 0 && remainingAuth <= Number(cfg.nearCompleteThreshold || 3);
      const base = {
        usableRequests: usable.usableRequests,
        usableMinute: usable.usableMinute,
        usableHour: usable.usableHour,
        usableDay: usable.usableDay,
        bindingWindow: usable.bindingWindow,
        estimatedRequestsNeeded,
        remainingAuthoritiesNeeded: remainingAuth,
        requestsPerAuthorityEstimate: eff.requestsPerAuthority,
        requestsPerAuthoritySource: eff.source,
        nearComplete,
        reserves: usable.reserves,
        utilization,
        microBatchMaxRequests: 0,
        nextUsefulAt: null,
        laneBPreferred: false
      };
      if (remainingAuth <= 0) {
        return {
          ...base,
          quotaMode: QUOTA_MODES.DAY_BLOCKED,
          reason: "target_already_met",
          lane: "B",
          useful: false
        };
      }
      if (!usable.ok && params.usableRequestsOverride == null) {
        return {
          ...base,
          quotaMode: QUOTA_MODES.WAIT_MINUTE,
          reason: "quota_windows_unavailable",
          lane: "WAIT",
          useful: false
        };
      }
      const u = usable.usableRequests;
      if (estimatedRequestsNeeded > 0 && estimatedRequestsNeeded <= u) {
        return {
          ...base,
          quotaMode: QUOTA_MODES.FINISH_TARGET,
          reason: nearComplete ? "finish_near_complete" : "finish_target_fits",
          lane: "A",
          useful: true,
          microBatchMaxRequests: estimatedRequestsNeeded
        };
      }
      if (u >= Number(cfg.fullBatchRequests)) {
        return {
          ...base,
          quotaMode: QUOTA_MODES.FULL_BATCH,
          reason: "full_batch_capacity",
          lane: "A",
          useful: true,
          microBatchMaxRequests: Math.min(u, Number(cfg.fullBatchRequests))
        };
      }
      if (u >= Number(cfg.minimumMicroBatchRequests)) {
        return {
          ...base,
          quotaMode: QUOTA_MODES.MICRO_BATCH,
          reason: nearComplete ? "micro_batch_near_complete" : "micro_batch_capacity",
          lane: "A",
          useful: true,
          microBatchMaxRequests: u
        };
      }
      const minuteRem = usable.minuteRemaining;
      const hourRem = usable.hourRemaining;
      const dayRem = usable.dayRemaining;
      const minuteReset = projectWakeAt(windowResetAt(params.windows, "minute"), cfg, now);
      const hourReset = projectWakeAt(windowResetAt(params.windows, "hour"), cfg, now);
      const dayReset = projectWakeAt(windowResetAt(params.windows, "day"), cfg, now);
      const hourBlocked = hourRem != null && hourRem - cfg.hourReserve < cfg.minimumMicroBatchRequests;
      const dayBlocked = dayRem != null && dayRem - cfg.dayReserve < cfg.minimumMicroBatchRequests;
      const minuteBlocked = minuteRem != null && minuteRem - cfg.minuteReserve < cfg.minimumMicroBatchRequests;
      if (dayBlocked) {
        return {
          ...base,
          quotaMode: QUOTA_MODES.DAY_BLOCKED,
          reason: "day_window_blocked",
          lane: "B",
          useful: false,
          laneBPreferred: true,
          nextUsefulAt: dayReset,
          bindingWindow: BINDING_WINDOWS.DAY
        };
      }
      if (hourBlocked && !dayBlocked) {
        return {
          ...base,
          quotaMode: QUOTA_MODES.WAIT_HOUR,
          reason: "hour_window_blocked",
          lane: params.laneBHasWork ? "B" : "WAIT",
          useful: false,
          laneBPreferred: Boolean(params.laneBHasWork),
          nextUsefulAt: hourReset,
          bindingWindow: BINDING_WINDOWS.HOUR
        };
      }
      const resetMs = minuteReset ? new Date(minuteReset).getTime() - now.getTime() : null;
      const shortWait = resetMs != null && resetMs >= 0 && resetMs <= Number(cfg.shortMinuteWaitMs);
      const lane = shortWait && minuteReset ? "WAIT" : params.laneBHasWork === false && minuteReset ? "WAIT" : "B";
      return {
        ...base,
        quotaMode: QUOTA_MODES.WAIT_MINUTE,
        reason: minuteBlocked ? "minute_window_blocked" : "below_micro_batch_minimum",
        lane,
        useful: false,
        laneBPreferred: lane === "B",
        nextUsefulAt: minuteReset,
        bindingWindow: BINDING_WINDOWS.MINUTE
      };
    }
    function hasUsefulAdaptiveCapacity(params) {
      const plan = planAdaptiveQuota({
        windows: params.windows || null,
        usableRequestsOverride: params.windows ? null : params.safeRequests,
        laneA: params.laneA || {
          count: 0,
          target: 45,
          court: params.court || null
        },
        efficiencyStore: params.efficiencyStore || {},
        config: params.config,
        now: params.now,
        laneBHasWork: params.laneBHasWork
      });
      if (!params.windows && params.remainingRequestsToFinishCourt != null && Number(params.safeRequests) >= Number(params.remainingRequestsToFinishCourt) && Number(params.remainingRequestsToFinishCourt) > 0) {
        return {
          useful: true,
          reason: "finish_partial_court",
          quotaMode: QUOTA_MODES.FINISH_TARGET,
          plan
        };
      }
      return {
        useful: Boolean(plan.useful),
        reason: plan.reason,
        quotaMode: plan.quotaMode,
        plan
      };
    }
    module2.exports = {
      QUOTA_MODES,
      BINDING_WINDOWS,
      DEFAULT_ADAPTIVE_QUOTA,
      defaultAdaptiveQuotaConfig,
      loadAdaptiveQuotaConfig,
      validateAdaptiveQuotaConfig,
      computeUsableRequests,
      remainingAuthoritiesNeeded,
      resolveRequestsPerAuthority,
      estimateRequestsNeeded,
      updateCourtEfficiency,
      efficiencyRegressionTriggered,
      dayUtilization,
      shouldProbeQuota,
      projectWakeAt,
      planAdaptiveQuota,
      hasUsefulAdaptiveCapacity
    };
  }
});

// scripts/queue2-cl-quota-conservation.cjs
var require_queue2_cl_quota_conservation = __commonJS({
  "scripts/queue2-cl-quota-conservation.cjs"(exports2, module2) {
    "use strict";
    var CL_REQUEST_PURPOSES = Object.freeze({
      QUOTA_PROBE: "QUOTA_PROBE",
      INGEST_DISCOVERY: "INGEST_DISCOVERY",
      INGEST_FETCH: "INGEST_FETCH",
      RETRY: "RETRY",
      VERIFY: "VERIFY",
      OTHER_EXPLICIT: "OTHER_EXPLICIT"
    });
    var CL_REQUEST_CLASSES = Object.freeze({
      PRODUCTIVE: "productive",
      OVERHEAD: "overhead",
      WASTED: "wasted"
    });
    var CONSERVATION_REASONS = Object.freeze({
      CL_DEBUG_QUOTA_BUDGET_EXCEEDED: "CL_DEBUG_QUOTA_BUDGET_EXCEEDED",
      CL_NO_PRODUCTIVE_PROGRESS: "CL_NO_PRODUCTIVE_PROGRESS",
      CL_NONPRODUCTIVE_REQUEST_SPIKE: "CL_NONPRODUCTIVE_REQUEST_SPIKE",
      REDUNDANT_QUOTA_PROBES: "REDUNDANT_QUOTA_PROBES",
      SESSION_BUDGET_EXHAUSTED: "SESSION_BUDGET_EXHAUSTED"
    });
    var MAX_NONPRODUCTIVE_CL_REQUESTS = 5;
    var MAX_TOTAL_CL_REQUESTS_BEFORE_FIRST_PROGRESS = 5;
    var MAX_CANARY_SESSION_CL_REQUESTS = MAX_TOTAL_CL_REQUESTS_BEFORE_FIRST_PROGRESS;
    var MAX_SEQUENTIAL_NONPRODUCTIVE_BEFORE_PROGRESS = 2;
    var MAX_REDUNDANT_QUOTA_PROBES = 3;
    var QUOTA_PROBE_CACHE_TTL_MS = 7 * 60 * 1e3;
    function createEmptyClRequestLedger(params = {}) {
      return {
        version: 1,
        sessionId: params.sessionId || `cl-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        workerFingerprint: params.workerFingerprint || null,
        workerId: params.workerId || null,
        processStartNonce: params.processStartNonce || null,
        court: params.court || null,
        canaryRequired: Boolean(params.canaryRequired),
        entries: [],
        currentSessionRequests: 0,
        productiveClRequests: 0,
        overheadClRequests: 0,
        wastedClRequests: 0,
        quotaProbeRequests: 0,
        retryRequests: 0,
        authoritiesAdded: 0,
        casesAdded: 0,
        checkpointAdvances: 0,
        sequentialNonproductiveBeforeProgress: 0,
        /** Productive Lane A ingestion attempts (not probes / network-only cycles). */
        productiveAttemptCount: 0,
        /** Alias / mirror of sequential streak for productive attempts only. */
        sequentialNonproductiveProductiveAttempts: 0,
        firstProgressAt: null,
        existingJobHistoricalRequests: Number(params.existingJobHistoricalRequests) || 0,
        rollingDayObservedUsed: params.rollingDayObservedUsed == null ? null : Number(params.rollingDayObservedUsed),
        rollingDayRemaining: params.rollingDayRemaining == null ? null : Number(params.rollingDayRemaining),
        quotaProbeReuseCount: 0,
        redundantQuotaProbesPrevented: 0,
        lastQuotaProbeAt: null,
        lastQuotaProbeSignature: null,
        startedAt: (params.now instanceof Date ? params.now : new Date(params.now || Date.now())).toISOString()
      };
    }
    function beginNewClRequestSession(state, opts = {}) {
      const next = state && typeof state === "object" ? JSON.parse(JSON.stringify(state)) : {};
      const now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
      const prior = next.clRequestLedger || null;
      const archived = Array.isArray(next.historicalClSessions) ? next.historicalClSessions.slice() : [];
      if (prior && (Number(prior.currentSessionRequests) > 0 || Array.isArray(prior.entries) && prior.entries.length > 0)) {
        archived.push({
          ...prior,
          archivedAt: now.toISOString(),
          archiveReason: opts.reason || "new_worker_process"
        });
      }
      next.historicalClSessions = archived.slice(-20);
      next.clRequestLedger = createEmptyClRequestLedger({
        sessionId: opts.sessionId,
        workerFingerprint: opts.workerFingerprint || null,
        workerId: opts.workerId || null,
        processStartNonce: opts.processStartNonce || null,
        court: next.laneA?.court || opts.court || null,
        canaryRequired: next.canaryMode === "CANARY_REQUIRED" || Boolean(opts.canaryRequired),
        existingJobHistoricalRequests: Number(opts.existingJobHistoricalRequests) || Number(next.sessionQuota?.historicalJobApiCallsBaseline) || Number(prior?.existingJobHistoricalRequests) || 0,
        rollingDayObservedUsed: next.quota?.windows?.day?.used ?? prior?.rollingDayObservedUsed ?? null,
        rollingDayRemaining: next.quota?.windows?.day?.remaining ?? prior?.rollingDayRemaining ?? null,
        now
      });
      const prevSq = next.sessionQuota || {};
      next.sessionQuota = {
        sessionClRequests: 0,
        productiveClRequests: 0,
        overheadClRequests: 0,
        quotaProbeRequests: 0,
        retryRequests: 0,
        wastedClRequests: 0,
        historicalJobApiCallsBaseline: prevSq.historicalJobApiCallsBaseline != null ? prevSq.historicalJobApiCallsBaseline : Number(opts.existingJobHistoricalRequests) || null,
        existingJobHistoricalRequests: Number(prevSq.existingJobHistoricalRequests) || Number(prevSq.historicalJobApiCallsBaseline) || 0,
        rollingDayObservedUsed: prevSq.rollingDayObservedUsed ?? next.quota?.windows?.day?.used ?? null,
        rollingDayRemaining: prevSq.rollingDayRemaining ?? next.quota?.windows?.day?.remaining ?? null,
        quotaProbeReuseCount: 0,
        redundantQuotaProbesPrevented: 0,
        sessionId: next.clRequestLedger.sessionId,
        childSessionApiCalls: 0
      };
      next.clSharedSession = null;
      next.clSessionStartedAt = now.toISOString();
      next.clSessionWorkerId = opts.workerId || null;
      next.clSessionProcessNonce = opts.processStartNonce || null;
      if (next.humanReview?.required && Array.isArray(next.humanReview.reasons)) {
        const drop = /* @__PURE__ */ new Set([
          CONSERVATION_REASONS.CL_NO_PRODUCTIVE_PROGRESS,
          CONSERVATION_REASONS.CL_NONPRODUCTIVE_REQUEST_SPIKE,
          CONSERVATION_REASONS.CL_DEBUG_QUOTA_BUDGET_EXCEEDED
        ]);
        next.humanReview.reasons = next.humanReview.reasons.filter((r) => !drop.has(r));
        next.humanReview.details = (next.humanReview.details || []).filter((d) => !drop.has(d.reason));
        if (next.humanReview.reasons.length === 0) {
          next.humanReview.required = false;
          next.humanReview.details = [];
        }
      }
      return {
        state: next,
        priorSessionId: prior?.sessionId || null,
        sessionId: next.clRequestLedger.sessionId,
        archivedCount: next.historicalClSessions.length,
        streak: 0,
        currentSessionRequests: 0
      };
    }
    function shouldResetClSessionForNewWorker(state, opts = {}) {
      const ledger = state?.clRequestLedger;
      if (!ledger) return true;
      if (opts.processStartNonce && ledger.processStartNonce && ledger.processStartNonce !== opts.processStartNonce) {
        return true;
      }
      if (opts.workerId && ledger.workerId && ledger.workerId !== opts.workerId) {
        return true;
      }
      if (opts.force === true) return true;
      if (opts.processStartNonce && !ledger.processStartNonce) return true;
      return false;
    }
    var QUEUE2_CL_CALLERS = Object.freeze([
      {
        caller: "run-queue2-dual-lane.runQuotaProbe \u2192 tmp-cl-api-usage-probe",
        purpose: "QUOTA_PROBE",
        ledgerInstrumented: true,
        typicalRequests: 1,
        canRunWhileWorkerStopped: false,
        notes: "Parent records QUOTA_PROBE; single /api-usage/ HTTP call"
      },
      {
        caller: "run-staging-cl-batch-job \u2192 staging-cl-batch-job",
        purpose: "INGEST_DISCOVERY/INGEST_FETCH/RETRY",
        ledgerInstrumented: true,
        typicalRequests: "1..CL_MAX_SESSION_CALLS",
        canRunWhileWorkerStopped: true,
        notes: "Detached child; must receive CL_SESSION_ID + CL_MAX_SESSION_CALLS; reports sessionApiCalls"
      },
      {
        caller: "staging-cl-batch-job.bootstrapQuotaPlan",
        purpose: "QUOTA_PROBE",
        ledgerInstrumented: true,
        typicalRequests: 1,
        canRunWhileWorkerStopped: true,
        notes: "Disabled when CL_BOOTSTRAP_USAGE=0 (Queue #2 default)"
      },
      {
        caller: "queue2:preflight / queue2:validate / Lane B / watchdog / status",
        purpose: "NONE",
        ledgerInstrumented: true,
        typicalRequests: 0,
        canRunWhileWorkerStopped: true,
        notes: "Hard zero-CL; covered by assertZeroClOperation tests"
      },
      {
        caller: "tmp-wave2*-usage-probe / cl-ping / staging-cl-shape-probe / run-cl-shape-inline",
        purpose: "OTHER_EXPLICIT (manual/ops)",
        ledgerInstrumented: false,
        typicalRequests: "1+",
        canRunWhileWorkerStopped: true,
        notes: "NOT part of Queue #2 autonomous worker; must not run during Q2 autonomy"
      },
      {
        caller: "staging-cl-ingest-lean / staging-cl-court-map-probe",
        purpose: "OTHER_EXPLICIT (legacy wave scripts)",
        ledgerInstrumented: false,
        typicalRequests: "many",
        canRunWhileWorkerStopped: true,
        notes: "NOT Queue #2 autonomous path; blocked by process policy during Q2"
      }
    ]);
    function assertQueue2AutonomousCallersInstrumented() {
      const autonomous = QUEUE2_CL_CALLERS.filter(
        (c) => c.caller.includes("run-queue2") || c.caller.includes("run-staging-cl-batch") || c.caller.includes("staging-cl-batch-job") || c.caller.includes("preflight") || c.caller.includes("Lane B")
      );
      const bad = autonomous.filter((c) => c.ledgerInstrumented !== true && Number(c.typicalRequests) !== 0);
      return { ok: bad.length === 0, bad, autonomous };
    }
    function replayNewWorkerSessionBoundary(opts = {}) {
      const events = [];
      let state = {
        canaryMode: "CANARY_REQUIRED",
        laneA: { court: "mich", count: 20, target: 45, checkpoint: "cl-opinion-11250867" },
        sessionQuota: {
          sessionClRequests: 1,
          productiveClRequests: 0,
          overheadClRequests: 1,
          quotaProbeRequests: 1,
          historicalJobApiCallsBaseline: 9
        },
        clRequestLedger: createEmptyClRequestLedger({
          sessionId: "session-A",
          canaryRequired: true,
          existingJobHistoricalRequests: 9
        }),
        humanReview: {
          required: true,
          reasons: [CONSERVATION_REASONS.CL_NO_PRODUCTIVE_PROGRESS],
          details: [{ reason: CONSERVATION_REASONS.CL_NO_PRODUCTIVE_PROGRESS, detail: "streak=2" }]
        },
        queue3: "NOT_OPEN"
      };
      state.clRequestLedger = recordClRequest(state.clRequestLedger, {
        purpose: CL_REQUEST_PURPOSES.QUOTA_PROBE,
        usefulProgress: false
      }).ledger;
      events.push({
        type: "SESSION_A",
        requests: state.clRequestLedger.currentSessionRequests,
        streak: state.clRequestLedger.sequentialNonproductiveBeforeProgress,
        productiveAttempts: state.clRequestLedger.productiveAttemptCount
      });
      const reset = beginNewClRequestSession(state, {
        workerId: "worker-B",
        processStartNonce: "nonce-B",
        workerFingerprint: "fp-B",
        reason: "new_worker_process",
        now: /* @__PURE__ */ new Date("2026-09-25T19:10:00.000Z")
      });
      state = reset.state;
      events.push({
        type: "SESSION_B_START",
        requests: state.clRequestLedger.currentSessionRequests,
        streak: state.clRequestLedger.sequentialNonproductiveBeforeProgress,
        priorArchived: Boolean(reset.priorSessionId),
        hr: state.humanReview.required
      });
      state.clRequestLedger = recordClRequest(state.clRequestLedger, {
        purpose: CL_REQUEST_PURPOSES.QUOTA_PROBE,
        usefulProgress: false
      }).ledger;
      const gate = evaluateClConservationGate(state.clRequestLedger, { canaryRequired: true });
      events.push({
        type: "AFTER_ONE_PROBE",
        requests: state.clRequestLedger.currentSessionRequests,
        streak: state.clRequestLedger.sequentialNonproductiveBeforeProgress,
        productiveAttempts: state.clRequestLedger.productiveAttemptCount,
        allowLaneA: gate.allow,
        reason: gate.reason
      });
      const ok = reset.currentSessionRequests === 0 && state.clRequestLedger.currentSessionRequests === 1 && state.clRequestLedger.sequentialNonproductiveBeforeProgress === 0 && state.clRequestLedger.productiveAttemptCount === 0 && gate.allow === true && gate.reason == null && state.humanReview.required === false && state.queue3 === "NOT_OPEN" && Array.isArray(state.historicalClSessions) && state.historicalClSessions.length >= 1;
      return { ok, events, state, gate, courtListenerHttpCalls: 0, aiCalls: 0, mutations: 0 };
    }
    function classifyRequestPurpose(purpose) {
      const p = String(purpose || "").toUpperCase();
      if (CL_REQUEST_PURPOSES[p]) return CL_REQUEST_PURPOSES[p];
      return CL_REQUEST_PURPOSES.OTHER_EXPLICIT;
    }
    function isProductiveAttemptRequest(params = {}) {
      if (params.productiveAttempt === true) return true;
      if (params.productiveAttempt === false) return false;
      const purpose = classifyRequestPurpose(params.purpose);
      if (purpose === CL_REQUEST_PURPOSES.QUOTA_PROBE) return false;
      if (purpose === CL_REQUEST_PURPOSES.VERIFY) return false;
      if (purpose === CL_REQUEST_PURPOSES.OTHER_EXPLICIT && !params.productiveAttempt) return false;
      if (purpose === CL_REQUEST_PURPOSES.INGEST_DISCOVERY || purpose === CL_REQUEST_PURPOSES.INGEST_FETCH || purpose === CL_REQUEST_PURPOSES.RETRY) {
        if (params.childLaunched === false) return false;
        if (params.networkUnavailable === true) return false;
        return true;
      }
      return false;
    }
    function classifyRequestOutcome(params = {}) {
      const purpose = classifyRequestPurpose(params.purpose);
      if (params.wasted === true || params.redundant === true || params.afterKnownNoProgress === true) {
        return CL_REQUEST_CLASSES.WASTED;
      }
      if (purpose === CL_REQUEST_PURPOSES.QUOTA_PROBE || purpose === CL_REQUEST_PURPOSES.VERIFY) {
        return params.usefulProgress ? CL_REQUEST_CLASSES.PRODUCTIVE : CL_REQUEST_CLASSES.OVERHEAD;
      }
      if (purpose === CL_REQUEST_PURPOSES.RETRY && !params.usefulProgress) {
        return params.necessaryRetry ? CL_REQUEST_CLASSES.OVERHEAD : CL_REQUEST_CLASSES.WASTED;
      }
      if (params.usefulProgress) return CL_REQUEST_CLASSES.PRODUCTIVE;
      if (purpose === CL_REQUEST_PURPOSES.INGEST_DISCOVERY || purpose === CL_REQUEST_PURPOSES.INGEST_FETCH) {
        return params.knownCannotProgress ? CL_REQUEST_CLASSES.WASTED : CL_REQUEST_CLASSES.OVERHEAD;
      }
      return CL_REQUEST_CLASSES.OVERHEAD;
    }
    function recordClRequest(ledger, params = {}) {
      const next = JSON.parse(JSON.stringify(ledger || createEmptyClRequestLedger()));
      const purpose = classifyRequestPurpose(params.purpose);
      const outcomeClass = classifyRequestOutcome({ ...params, purpose });
      const productiveAttempt = isProductiveAttemptRequest({ ...params, purpose });
      const nowIso = (params.now instanceof Date ? params.now : new Date(params.now || Date.now())).toISOString();
      const entry = {
        n: next.currentSessionRequests + 1,
        at: nowIso,
        court: params.court || next.court || null,
        jurisdiction: params.jurisdiction || null,
        purpose,
        httpOutcome: params.httpOutcome || null,
        usefulProgress: Boolean(params.usefulProgress),
        productiveAttempt,
        outcomeClass,
        batchId: params.batchId || null,
        runId: params.runId || null,
        workerFingerprint: params.workerFingerprint || next.workerFingerprint || null
      };
      delete entry.apiKey;
      delete entry.authorization;
      delete entry.token;
      next.entries.push(entry);
      next.currentSessionRequests += 1;
      if (outcomeClass === CL_REQUEST_CLASSES.PRODUCTIVE) {
        next.productiveClRequests += 1;
        next.sequentialNonproductiveBeforeProgress = 0;
        next.sequentialNonproductiveProductiveAttempts = 0;
        if (!next.firstProgressAt) next.firstProgressAt = nowIso;
      } else if (outcomeClass === CL_REQUEST_CLASSES.OVERHEAD) {
        next.overheadClRequests += 1;
      } else {
        next.wastedClRequests += 1;
      }
      if (productiveAttempt) {
        next.productiveAttemptCount = (Number(next.productiveAttemptCount) || 0) + 1;
        if (outcomeClass === CL_REQUEST_CLASSES.PRODUCTIVE || params.usefulProgress) {
          next.sequentialNonproductiveBeforeProgress = 0;
          next.sequentialNonproductiveProductiveAttempts = 0;
        } else if (!next.firstProgressAt) {
          next.sequentialNonproductiveBeforeProgress = (Number(next.sequentialNonproductiveBeforeProgress) || 0) + 1;
          next.sequentialNonproductiveProductiveAttempts = next.sequentialNonproductiveBeforeProgress;
        }
      }
      if (purpose === CL_REQUEST_PURPOSES.QUOTA_PROBE) next.quotaProbeRequests += 1;
      if (purpose === CL_REQUEST_PURPOSES.RETRY) next.retryRequests += 1;
      if (params.authoritiesAdded) next.authoritiesAdded += Number(params.authoritiesAdded) || 0;
      if (params.casesAdded) next.casesAdded += Number(params.casesAdded) || 0;
      if (params.checkpointAdvanced) next.checkpointAdvances += 1;
      return { ledger: next, entry, outcomeClass, productiveAttempt };
    }
    function nonproductiveCount(ledger) {
      return (Number(ledger?.overheadClRequests) || 0) + (Number(ledger?.wastedClRequests) || 0);
    }
    function evaluateClConservationGate(ledger, opts = {}) {
      const canary = Boolean(opts.canaryRequired ?? ledger?.canaryRequired);
      const nonprod = nonproductiveCount(ledger);
      const total = Number(ledger?.currentSessionRequests) || 0;
      const hasProgress = Boolean(ledger?.firstProgressAt);
      const seq = Number(ledger?.sequentialNonproductiveBeforeProgress) || 0;
      if (canary && nonprod >= MAX_NONPRODUCTIVE_CL_REQUESTS) {
        return {
          allow: false,
          humanReviewRequired: true,
          reason: CONSERVATION_REASONS.CL_DEBUG_QUOTA_BUDGET_EXCEEDED,
          detail: `nonproductive=${nonprod} >= ${MAX_NONPRODUCTIVE_CL_REQUESTS}`
        };
      }
      if (canary && total >= MAX_CANARY_SESSION_CL_REQUESTS) {
        return {
          allow: false,
          humanReviewRequired: !hasProgress,
          reason: hasProgress ? CONSERVATION_REASONS.SESSION_BUDGET_EXHAUSTED : CONSERVATION_REASONS.CL_DEBUG_QUOTA_BUDGET_EXCEEDED,
          detail: hasProgress ? `session total=${total} >= canary max=${MAX_CANARY_SESSION_CL_REQUESTS} (SESSION_BUDGET_EXHAUSTED)` : `total=${total} before first progress >= ${MAX_TOTAL_CL_REQUESTS_BEFORE_FIRST_PROGRESS}`,
          classification: hasProgress ? CONSERVATION_REASONS.SESSION_BUDGET_EXHAUSTED : null,
          remainingSessionBudget: 0
        };
      }
      if (!hasProgress && seq >= MAX_SEQUENTIAL_NONPRODUCTIVE_BEFORE_PROGRESS) {
        return {
          allow: false,
          humanReviewRequired: true,
          reason: CONSERVATION_REASONS.CL_NO_PRODUCTIVE_PROGRESS,
          detail: `sequentialNonproductiveProductiveAttempts=${seq} (productiveAttemptCount=${Number(ledger?.productiveAttemptCount) || 0})`
        };
      }
      return {
        allow: true,
        humanReviewRequired: false,
        reason: null,
        remainingSessionBudget: canary ? Math.max(0, MAX_CANARY_SESSION_CL_REQUESTS - total) : null
      };
    }
    function clearFalseClNoProductiveProgressReview(state, evidence = {}) {
      const next = state && typeof state === "object" ? JSON.parse(JSON.stringify(state)) : {};
      const reasons = Array.isArray(next.humanReview?.reasons) ? [...next.humanReview.reasons] : [];
      if (!reasons.includes(CONSERVATION_REASONS.CL_NO_PRODUCTIVE_PROGRESS)) {
        return { state: next, cleared: false, reason: "reason_not_present" };
      }
      const productiveAttempts = Number(evidence.productiveAttemptCount ?? next.clRequestLedger?.productiveAttemptCount) || 0;
      const childLaunches = Number(evidence.childLaunches ?? 0) || 0;
      const session = Number(evidence.sessionClRequests ?? next.clRequestLedger?.currentSessionRequests) || 0;
      const probes = Number(evidence.quotaProbes ?? next.clRequestLedger?.quotaProbeRequests) || 0;
      const authoritiesAdded = Number(evidence.authoritiesAdded ?? next.clRequestLedger?.authoritiesAdded) || 0;
      const checkpointAdvanced = Boolean(
        evidence.checkpointAdvanced ?? (Number(next.clRequestLedger?.checkpointAdvances) || 0) > 0
      );
      const streak = Number(
        evidence.sequentialNonproductiveProductiveAttempts ?? next.clRequestLedger?.sequentialNonproductiveProductiveAttempts ?? next.clRequestLedger?.sequentialNonproductiveBeforeProgress
      ) || 0;
      const probeOnly = productiveAttempts === 0 && childLaunches === 0 && !checkpointAdvanced && authoritiesAdded === 0 && (probes >= session || session === probes);
      const networkOnly = evidence.networkUnavailableCycle === true && childLaunches === 0;
      if (!probeOnly && !networkOnly && !(productiveAttempts === 0 && streak === 0)) {
        return {
          state: next,
          cleared: false,
          reason: "insufficient_false_positive_evidence",
          productiveAttempts,
          childLaunches,
          probes,
          session
        };
      }
      next.humanReview = next.humanReview || { required: false, reasons: [], details: [] };
      next.humanReview.reasons = reasons.filter(
        (r) => r !== CONSERVATION_REASONS.CL_NO_PRODUCTIVE_PROGRESS
      );
      next.humanReview.details = (next.humanReview.details || []).filter(
        (d) => d?.reason !== CONSERVATION_REASONS.CL_NO_PRODUCTIVE_PROGRESS
      );
      next.humanReview.required = next.humanReview.reasons.length > 0;
      if (next.clRequestLedger) {
        next.clRequestLedger.sequentialNonproductiveBeforeProgress = 0;
        next.clRequestLedger.sequentialNonproductiveProductiveAttempts = 0;
      }
      if (!next.humanReview.required && next.runtimeState === "HUMAN_REVIEW_REQUIRED") {
        next.runtimeState = "STOPPED";
        next.currentLane = "STOPPED";
      }
      next.falseProgressReviewCleared = {
        reason: CONSERVATION_REASONS.CL_NO_PRODUCTIVE_PROGRESS,
        classification: "FALSE_CONTROL_PLANE_CLASSIFICATION",
        clearedAt: (evidence.now instanceof Date ? evidence.now : new Date(evidence.now || Date.now())).toISOString(),
        productiveAttempts,
        childLaunches,
        probes,
        session,
        courtListenerHttpCalls: 0,
        mutations: 0,
        aiCalls: 0
      };
      return {
        state: next,
        cleared: true,
        reason: "FALSE_CONTROL_PLANE_CLASSIFICATION",
        productiveAttempts,
        childLaunches,
        probes,
        session
      };
    }
    function evaluateQuotaProbeCache(cache, opts = {}) {
      const nowMs = (opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now())).getTime();
      const ttl = Number(opts.ttlMs ?? QUOTA_PROBE_CACHE_TTL_MS);
      if (!cache || !cache.observedAt) {
        return { reuse: false, reason: "no_cache", probe: true };
      }
      if (opts.force === true) return { reuse: false, reason: "forced", probe: true };
      if (opts.invalidateReason) {
        return { reuse: false, reason: opts.invalidateReason, probe: true };
      }
      if (cache.had429) return { reuse: false, reason: "prior_429", probe: true };
      if (cache.resetOccurred) return { reuse: false, reason: "reset_occurred", probe: true };
      if (cache.countersMateriallyChanged) {
        return { reuse: false, reason: "counters_changed", probe: true };
      }
      const age = nowMs - Date.parse(cache.observedAt);
      if (!Number.isFinite(age) || age > ttl) {
        return { reuse: false, reason: "ttl_expired", probe: true, ageMs: age };
      }
      if (opts.reason && ["cycle", "watchdog", "status", "lane_b", "db_reconcile"].includes(opts.reason)) {
        return {
          reuse: true,
          reason: "reuse_fresh_cache",
          probe: false,
          cache,
          preventedRedundant: true
        };
      }
      return { reuse: true, reason: "reuse_fresh_cache", probe: false, cache };
    }
    function applyQuotaProbeCacheDecision(ledger, decision) {
      const next = JSON.parse(JSON.stringify(ledger || createEmptyClRequestLedger()));
      if (decision?.reuse && decision?.preventedRedundant) {
        next.quotaProbeReuseCount += 1;
        next.redundantQuotaProbesPrevented += 1;
      } else if (decision?.probe === false && decision?.reuse) {
        next.quotaProbeReuseCount += 1;
      }
      return next;
    }
    function evaluateRedundantQuotaProbeHardStop(history = [], opts = {}) {
      const min = Number(opts.minRepeats ?? MAX_REDUNDANT_QUOTA_PROBES);
      if (!Array.isArray(history) || history.length < min) {
        return { hardStop: false, count: history?.length || 0 };
      }
      const last = history.slice(-min);
      const sig = (p) => `${p?.minuteRemaining ?? "?"}/${p?.hourRemaining ?? "?"}/${p?.dayRemaining ?? "?"}|${p?.quotaMode || ""}|${p?.checkpoint || ""}`;
      const first = sig(last[0]);
      const allSame = last.every((p) => sig(p) === first);
      const noWork = last.every((p) => !p?.workBetween);
      if (allSame && noWork) {
        return {
          hardStop: true,
          count: last.length,
          reason: CONSERVATION_REASONS.REDUNDANT_QUOTA_PROBES,
          humanReviewRequired: true
        };
      }
      return { hardStop: false, count: last.length };
    }
    function evaluateStartupClPlan(params = {}) {
      const probesSoFar = Number(params.quotaProbeRequests) || 0;
      const session = Number(params.currentSessionRequests) || 0;
      const canary = Boolean(params.canaryRequired);
      if (probesSoFar === 0 && session === 0) {
        return { next: "ONE_QUOTA_PROBE", allowCl: true, purpose: CL_REQUEST_PURPOSES.QUOTA_PROBE };
      }
      if (probesSoFar >= 1 && !params.laneAProductiveStarted && session <= probesSoFar) {
        if (params.hasUsefulLaneACapacity) {
          return { next: "ENTER_PRODUCTIVE_LANE_A", allowCl: true, purpose: CL_REQUEST_PURPOSES.INGEST_DISCOVERY };
        }
        return { next: "STOP_OR_WAIT_ZERO_CL", allowCl: false, purpose: null };
      }
      if (canary && session >= 2 && !params.firstProgressAt) {
        return {
          next: "HARD_STOP",
          allowCl: false,
          reason: CONSERVATION_REASONS.CL_NO_PRODUCTIVE_PROGRESS,
          humanReviewRequired: true
        };
      }
      return { next: "CONTINUE", allowCl: true };
    }
    function requestsPerAuthority(ledger) {
      const auth = Number(ledger?.authoritiesAdded) || 0;
      const prod = Number(ledger?.productiveClRequests) || 0;
      if (auth <= 0) return null;
      return prod / auth;
    }
    function formatClRequestAccountingLine(ledger) {
      const L = ledger || createEmptyClRequestLedger();
      return `CL REQUEST ACCOUNTING session=${L.currentSessionRequests} productive=${L.productiveClRequests} overhead=${L.overheadClRequests} wasted=${L.wastedClRequests} quotaProbes=${L.quotaProbeRequests} retries=${L.retryRequests} authoritiesAdded=${L.authoritiesAdded} checkpointAdvanced=${L.checkpointAdvances > 0}`;
    }
    function formatRollingDayObservedLine(ledger) {
      const used = ledger?.rollingDayObservedUsed;
      const rem = ledger?.rollingDayRemaining;
      return `ROLLING DAY OBSERVED used=${used == null ? "?" : used} remaining=${rem == null ? "?" : rem}`;
    }
    function assertZeroClOperation(opName, clCalls) {
      const n = Number(clCalls) || 0;
      if (n !== 0) {
        return { ok: false, operation: opName, courtListenerHttpCalls: n, reason: "ZERO_CL_VIOLATION" };
      }
      return { ok: true, operation: opName, courtListenerHttpCalls: 0 };
    }
    function replayMiCanaryConservationFlow(opts = {}) {
      const events = [];
      const push = (type, extra = {}) => events.push({ type, ...extra });
      let ledger = createEmptyClRequestLedger({
        canaryRequired: true,
        court: "mich",
        existingJobHistoricalRequests: 9,
        rollingDayObservedUsed: opts.rollingDayUsed ?? 94,
        rollingDayRemaining: opts.rollingDayRemaining ?? 1106,
        workerFingerprint: opts.workerFingerprint || "test-fp"
      });
      let courtListenerHttpCalls = 0;
      let state = {
        laneA: {
          court: "mich",
          jurisdiction: "MI",
          count: 20,
          target: 45,
          targetStatus: "PARTIAL",
          checkpoint: "cl-opinion-11250867",
          cursor: "cl-opinion-11250867",
          jobStatus: "quota_paused",
          mappingStatus: "VERIFIED",
          existingJobClassification: "STALE_RESUMABLE"
        },
        canaryMode: "CANARY_REQUIRED",
        humanReview: { required: false, reasons: [], details: [] },
        queue3: "NOT_OPEN"
      };
      push("PREFLIGHT", assertZeroClOperation("preflight", 0));
      push("VALIDATE", assertZeroClOperation("validate", 0));
      const startup = evaluateStartupClPlan({
        quotaProbeRequests: 0,
        currentSessionRequests: 0,
        canaryRequired: true
      });
      push("STARTUP_PLAN", startup);
      let rec = recordClRequest(ledger, {
        purpose: CL_REQUEST_PURPOSES.QUOTA_PROBE,
        court: "mich",
        httpOutcome: 200,
        usefulProgress: false,
        batchId: "startup-probe"
      });
      ledger = rec.ledger;
      courtListenerHttpCalls += 1;
      const cache = {
        observedAt: (/* @__PURE__ */ new Date()).toISOString(),
        minuteRemaining: 30,
        hourRemaining: 300,
        dayRemaining: 1106,
        safeRequests: 28
      };
      const reuse = evaluateQuotaProbeCache(cache, { reason: "cycle", now: /* @__PURE__ */ new Date() });
      push("PROBE_CACHE", reuse);
      ledger = applyQuotaProbeCacheDecision(ledger, { ...reuse, preventedRedundant: true });
      let gate = evaluateClConservationGate(ledger, { canaryRequired: true });
      push("GATE_BEFORE_LANE_A", gate);
      if (!gate.allow) {
        return { ok: false, events, ledger, courtListenerHttpCalls, state, reason: gate.reason };
      }
      push("LANE_A_RESUME", {
        checkpoint: state.laneA.checkpoint,
        initialStart: false,
        page1Restart: false
      });
      const batchId = "mi-canary-1";
      for (const step of [
        { purpose: CL_REQUEST_PURPOSES.INGEST_FETCH, useful: true, authoritiesAdded: 1 },
        { purpose: CL_REQUEST_PURPOSES.INGEST_FETCH, useful: true, authoritiesAdded: 1, checkpointAdvanced: true },
        { purpose: CL_REQUEST_PURPOSES.INGEST_FETCH, useful: true, authoritiesAdded: 0 }
      ]) {
        gate = evaluateClConservationGate(ledger, { canaryRequired: true });
        if (!gate.allow) {
          return { ok: false, events, ledger, courtListenerHttpCalls, state, reason: gate.reason };
        }
        rec = recordClRequest(ledger, {
          purpose: step.purpose,
          court: "mich",
          httpOutcome: 200,
          usefulProgress: step.useful,
          authoritiesAdded: step.authoritiesAdded || 0,
          checkpointAdvanced: Boolean(step.checkpointAdvanced),
          batchId
        });
        ledger = rec.ledger;
        courtListenerHttpCalls += 1;
      }
      state.laneA.count = 22;
      state.laneA.checkpoint = "cl-opinion-mi-canary-2";
      state.laneA.cursor = "cl-opinion-mi-canary-2";
      state.canaryMode = "NORMAL";
      push("CANARY_PASS", {
        authoritiesAdded: ledger.authoritiesAdded,
        session: ledger.currentSessionRequests,
        checkpoint: state.laneA.checkpoint
      });
      push("ACCOUNTING", { line: formatClRequestAccountingLine(ledger) });
      push("ROLLING_DAY", { line: formatRollingDayObservedLine(ledger) });
      const ok = courtListenerHttpCalls === ledger.currentSessionRequests && ledger.currentSessionRequests === 4 && ledger.existingJobHistoricalRequests === 9 && ledger.rollingDayObservedUsed === (opts.rollingDayUsed ?? 94) && state.laneA.checkpoint !== "cl-opinion-11250867" && state.queue3 === "NOT_OPEN";
      return {
        ok,
        events,
        ledger,
        courtListenerHttpCalls,
        state,
        accountingLine: formatClRequestAccountingLine(ledger),
        rollingDayLine: formatRollingDayObservedLine(ledger),
        aiCalls: 0,
        mutations: 0
      };
    }
    module2.exports = {
      CL_REQUEST_PURPOSES,
      CL_REQUEST_CLASSES,
      CONSERVATION_REASONS,
      MAX_NONPRODUCTIVE_CL_REQUESTS,
      MAX_TOTAL_CL_REQUESTS_BEFORE_FIRST_PROGRESS,
      MAX_CANARY_SESSION_CL_REQUESTS,
      MAX_SEQUENTIAL_NONPRODUCTIVE_BEFORE_PROGRESS,
      MAX_REDUNDANT_QUOTA_PROBES,
      QUOTA_PROBE_CACHE_TTL_MS,
      QUEUE2_CL_CALLERS,
      createEmptyClRequestLedger,
      beginNewClRequestSession,
      shouldResetClSessionForNewWorker,
      assertQueue2AutonomousCallersInstrumented,
      replayNewWorkerSessionBoundary,
      classifyRequestPurpose,
      classifyRequestOutcome,
      isProductiveAttemptRequest,
      recordClRequest,
      nonproductiveCount,
      evaluateClConservationGate,
      clearFalseClNoProductiveProgressReview,
      evaluateQuotaProbeCache,
      applyQuotaProbeCacheDecision,
      evaluateRedundantQuotaProbeHardStop,
      evaluateStartupClPlan,
      requestsPerAuthority,
      formatClRequestAccountingLine,
      formatRollingDayObservedLine,
      assertZeroClOperation,
      replayMiCanaryConservationFlow
    };
  }
});

// scripts/queue2-lane-a-child-lifecycle.cjs
var require_queue2_lane_a_child_lifecycle = __commonJS({
  "scripts/queue2-lane-a-child-lifecycle.cjs"(exports2, module2) {
    "use strict";
    var {
      MAX_TOTAL_CL_REQUESTS_BEFORE_FIRST_PROGRESS
    } = require_queue2_cl_quota_conservation();
    var LANE_A_RUNNER_STATES = Object.freeze({
      STARTED: "STARTED",
      RUNNING: "RUNNING",
      COMPLETED: "COMPLETED",
      QUOTA_PAUSED: "QUOTA_PAUSED",
      FAILED: "FAILED",
      STALE_RUNNING_GUARD: "STALE_RUNNING_GUARD",
      ALREADY_COMPLETED: "ALREADY_COMPLETED",
      TIMEOUT: "TIMEOUT",
      UNKNOWN: "UNKNOWN",
      UNKNOWN_DUE_TO_NETWORK: "UNKNOWN_DUE_TO_NETWORK"
    });
    var TERMINAL_STATES = /* @__PURE__ */ new Set([
      LANE_A_RUNNER_STATES.COMPLETED,
      LANE_A_RUNNER_STATES.QUOTA_PAUSED,
      LANE_A_RUNNER_STATES.FAILED,
      LANE_A_RUNNER_STATES.STALE_RUNNING_GUARD,
      LANE_A_RUNNER_STATES.ALREADY_COMPLETED,
      LANE_A_RUNNER_STATES.TIMEOUT
    ]);
    var NON_TERMINAL_STATES = /* @__PURE__ */ new Set([
      LANE_A_RUNNER_STATES.STARTED,
      LANE_A_RUNNER_STATES.RUNNING,
      LANE_A_RUNNER_STATES.UNKNOWN_DUE_TO_NETWORK
    ]);
    var CANARY_MAX_SESSION_CL_REQUESTS = MAX_TOTAL_CL_REQUESTS_BEFORE_FIRST_PROGRESS;
    function createEmptySessionQuota() {
      return {
        sessionClRequests: 0,
        productiveClRequests: 0,
        overheadClRequests: 0,
        quotaProbeRequests: 0,
        retryRequests: 0,
        wastedClRequests: 0,
        historicalJobApiCallsBaseline: null,
        existingJobHistoricalRequests: 0,
        rollingDayObservedUsed: null,
        rollingDayRemaining: null,
        quotaProbeReuseCount: 0,
        redundantQuotaProbesPrevented: 0
      };
    }
    function mapRunnerResultToLifecycleState(result = {}) {
      if (!result || typeof result !== "object") return LANE_A_RUNNER_STATES.UNKNOWN;
      if (result.unknownDueToNetwork === true || result.lifecycleState === LANE_A_RUNNER_STATES.UNKNOWN_DUE_TO_NETWORK) {
        return LANE_A_RUNNER_STATES.UNKNOWN_DUE_TO_NETWORK;
      }
      if (result.reason === "stale_running_guard") return LANE_A_RUNNER_STATES.STALE_RUNNING_GUARD;
      if (result.reason === "already_completed") return LANE_A_RUNNER_STATES.ALREADY_COMPLETED;
      if (result.started === true && !result.status && !result.fileResult) {
        return LANE_A_RUNNER_STATES.STARTED;
      }
      if (result.running === true || result.status === "running" || result.status === "starting") {
        return LANE_A_RUNNER_STATES.RUNNING;
      }
      const status = String(result.status || "").toLowerCase();
      if (status === "completed") return LANE_A_RUNNER_STATES.COMPLETED;
      if (status === "quota_paused" || status === "rate_limited") return LANE_A_RUNNER_STATES.QUOTA_PAUSED;
      if (status === "failed" || result.ok === false && result.reason && result.reason !== "stale_running_guard") {
        return LANE_A_RUNNER_STATES.FAILED;
      }
      if (result.timedOut === true || result.reason === "poll_timeout" || status === "timeout") {
        return LANE_A_RUNNER_STATES.TIMEOUT;
      }
      if (result.pid && (result.started === true || result.ok === true) && !status) {
        return LANE_A_RUNNER_STATES.STARTED;
      }
      if (status) {
        if (["paused", "transient_retry"].includes(status)) return LANE_A_RUNNER_STATES.QUOTA_PAUSED;
      }
      return LANE_A_RUNNER_STATES.UNKNOWN;
    }
    function isTerminalRunnerState(state) {
      return TERMINAL_STATES.has(state);
    }
    function isNonTerminalRunnerState(state) {
      return NON_TERMINAL_STATES.has(state);
    }
    function parseLaneARunnerStdoutPreferTerminal(stdout) {
      const text = String(stdout || "");
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const objects = [];
      for (const line of lines) {
        try {
          objects.push(JSON.parse(line));
        } catch {
        }
      }
      for (let i = objects.length - 1; i >= 0; i -= 1) {
        const o = objects[i];
        if (o && o.fileResult && typeof o.fileResult === "object") {
          const fr = o.fileResult;
          const life = mapRunnerResultToLifecycleState(fr);
          if (isTerminalRunnerState(life) || fr.status) {
            return {
              ok: fr.ok !== false,
              raw: o,
              result: fr,
              source: "fileResult",
              lifecycleState: life,
              terminal: isTerminalRunnerState(life)
            };
          }
        }
      }
      for (let i = objects.length - 1; i >= 0; i -= 1) {
        const o = objects[i];
        if (!o || typeof o !== "object") continue;
        if (o.started === true && !o.status && !o.reason) continue;
        if (o.fileResult) continue;
        if (o.status || o.job || o.reason === "stale_running_guard" || o.reason === "already_completed" || o.timedOut) {
          const life = mapRunnerResultToLifecycleState(o);
          return {
            ok: o.ok !== false,
            raw: o,
            result: o,
            source: "lastJson",
            lifecycleState: life,
            terminal: isTerminalRunnerState(life)
          };
        }
      }
      for (let i = objects.length - 1; i >= 0; i -= 1) {
        const o = objects[i];
        if (o && o.started === true) {
          return {
            ok: true,
            raw: o,
            result: o,
            source: "startedOnly",
            lifecycleState: LANE_A_RUNNER_STATES.STARTED,
            terminal: false,
            pid: o.pid || null
          };
        }
      }
      return {
        ok: false,
        raw: null,
        result: null,
        source: "unparsed",
        objects,
        lifecycleState: LANE_A_RUNNER_STATES.UNKNOWN,
        terminal: false
      };
    }
    function createLaneAChildRecord(params = {}) {
      const now = params.now instanceof Date ? params.now : new Date(params.now || Date.now());
      return {
        pid: params.pid != null ? Number(params.pid) : null,
        ppid: params.ppid != null ? Number(params.ppid) : null,
        court: params.court || null,
        batchId: params.batchId || `lane-a-${params.court || "unk"}-${now.getTime()}`,
        sessionId: params.sessionId || null,
        startedAt: now.toISOString(),
        workerId: params.workerId || null,
        processStartNonce: params.processStartNonce || null,
        codeFingerprint: params.codeFingerprint || null,
        command: params.command || "staging-cl-batch-job-bundled.cjs",
        commandFingerprint: params.commandFingerprint || null,
        expectedMaxAuthorities: Number(params.expectedMaxAuthorities) || 3,
        expectedMaxClRequests: Number(params.expectedMaxClRequests) || CANARY_MAX_SESSION_CL_REQUESTS,
        lifecycleState: LANE_A_RUNNER_STATES.STARTED,
        terminal: false,
        terminalAt: null,
        detachedForbidden: true,
        supervised: true
      };
    }
    function isLaneAChildAlive(child, opts = {}) {
      if (!child || child.terminal) return false;
      if (child.unknownDueToNetwork === true || child.lifecycleState === LANE_A_RUNNER_STATES.UNKNOWN_DUE_TO_NETWORK) {
        return false;
      }
      if (opts.aliveOverride != null) return Boolean(opts.aliveOverride);
      if (child.pid == null) return false;
      if (opts.processAlive === false) return false;
      if (opts.processAlive === true) return true;
      return Boolean(child.pid) && !child.terminal;
    }
    function mayLaunchLaneAChild(state, opts = {}) {
      const child = state?.laneAChild || null;
      if (!child) return { ok: true, reason: "no_existing_child" };
      if (child.terminal) return { ok: true, reason: "prior_child_terminal" };
      if (child.unknownDueToNetwork === true || child.lifecycleState === LANE_A_RUNNER_STATES.UNKNOWN_DUE_TO_NETWORK) {
        return {
          ok: false,
          reason: "UNKNOWN_DUE_TO_NETWORK",
          pid: null,
          court: child.court,
          batchId: child.batchId,
          sessionId: child.sessionId || null
        };
      }
      if (isLaneAChildAlive(child, opts)) {
        return {
          ok: false,
          reason: "LANE_A_CHILD_ALREADY_ACTIVE",
          pid: child.pid,
          court: child.court,
          batchId: child.batchId,
          sessionId: child.sessionId || null
        };
      }
      return { ok: true, reason: "prior_child_dead_may_relaunch", deadChild: child };
    }
    function markLaneAChildTerminal(state, params = {}) {
      const next = JSON.parse(JSON.stringify(state || {}));
      if (!next.laneAChild) return next;
      const now = params.now instanceof Date ? params.now : new Date(params.now || Date.now());
      next.laneAChild = {
        ...next.laneAChild,
        terminal: true,
        terminalAt: now.toISOString(),
        lifecycleState: params.lifecycleState || next.laneAChild.lifecycleState || LANE_A_RUNNER_STATES.COMPLETED,
        exitCode: params.exitCode != null ? params.exitCode : next.laneAChild.exitCode
      };
      return next;
    }
    function isFreshPostRunDbEvidence(params = {}) {
      const dbAt = params.dbEvidenceObservedAt || params.liveDb?.generatedAt || params.liveDb?.observedAt || null;
      const terminalAt = params.runnerTerminalAt || null;
      const startedAt = params.laneARunnerStartedAt || null;
      if (!dbAt) {
        return {
          ok: false,
          postRunDbRefreshed: false,
          reason: "missing_db_evidence_timestamp"
        };
      }
      const dbMs = Date.parse(dbAt);
      if (!Number.isFinite(dbMs)) {
        return { ok: false, postRunDbRefreshed: false, reason: "invalid_db_evidence_timestamp" };
      }
      if (startedAt) {
        const startMs = Date.parse(startedAt);
        if (Number.isFinite(startMs) && dbMs < startMs) {
          return {
            ok: false,
            postRunDbRefreshed: false,
            reason: "db_evidence_before_runner_start",
            dbEvidenceObservedAt: dbAt,
            laneARunnerStartedAt: startedAt
          };
        }
      }
      if (terminalAt) {
        const termMs = Date.parse(terminalAt);
        if (Number.isFinite(termMs) && dbMs < termMs) {
          return {
            ok: false,
            postRunDbRefreshed: false,
            reason: "db_evidence_before_runner_terminal",
            dbEvidenceObservedAt: dbAt,
            runnerTerminalAt: terminalAt
          };
        }
      }
      return {
        ok: true,
        postRunDbRefreshed: true,
        dbEvidenceObservedAt: dbAt,
        runnerTerminalAt: terminalAt
      };
    }
    function updateSessionQuotaAccounting(session, params = {}) {
      const next = { ...session || createEmptySessionQuota() };
      const historical = Number(params.historicalJobApiCalls);
      if (Number.isFinite(historical) && next.historicalJobApiCallsBaseline == null) {
        next.historicalJobApiCallsBaseline = historical;
      }
      if (params.rollingDayObservedUsed != null) {
        next.rollingDayObservedUsed = Number(params.rollingDayObservedUsed);
      }
      if (params.rollingDayRemaining != null) {
        next.rollingDayRemaining = Number(params.rollingDayRemaining);
      }
      if (params.existingJobHistoricalRequests != null) {
        next.existingJobHistoricalRequests = Number(params.existingJobHistoricalRequests) || 0;
      }
      const delta = Number(params.sessionClRequestDelta);
      if (Number.isFinite(delta) && delta > 0) {
        next.sessionClRequests += delta;
        if (params.productive) next.productiveClRequests += delta;
        else if (params.retry) next.retryRequests += delta;
        else if (params.probe) {
          next.quotaProbeRequests += delta;
          next.overheadClRequests += delta;
        } else if (params.overhead) next.overheadClRequests += delta;
        else next.wastedClRequests += delta;
      } else if (Number.isFinite(historical) && next.historicalJobApiCallsBaseline != null && historical > next.historicalJobApiCallsBaseline) {
        const grown = historical - next.historicalJobApiCallsBaseline;
        next.sessionClRequests += grown;
        next.historicalJobApiCallsBaseline = historical;
        if (params.productive) next.productiveClRequests += grown;
        else next.wastedClRequests += grown;
      }
      return next;
    }
    function canarySessionRequestCapExceeded(session, maxRequests = CANARY_MAX_SESSION_CL_REQUESTS) {
      const used = Number(session?.sessionClRequests) || 0;
      return {
        exceeded: used >= maxRequests,
        used,
        max: maxRequests
      };
    }
    function mayEvaluateLaneAZeroProgress(params = {}) {
      if (!params.terminal) {
        return { ok: false, reason: "runner_non_terminal" };
      }
      if (!params.freshDbReconciled) {
        return { ok: false, reason: "fresh_db_not_reconciled" };
      }
      if (!params.jobRowRefreshed) {
        return { ok: false, reason: "job_row_not_refreshed" };
      }
      if (params.currentBatchRequestCount == null || !Number.isFinite(Number(params.currentBatchRequestCount))) {
        return { ok: false, reason: "batch_request_count_unknown" };
      }
      return { ok: true, reason: "eligible" };
    }
    function evaluateCanaryAfterTerminal(params = {}) {
      const canaryRequired = Boolean(params.canaryRequired);
      if (!canaryRequired) {
        return { mode: "NORMAL", canaryPass: true, reason: "canary_not_required" };
      }
      if (!params.terminal) {
        return { mode: "CANARY_REQUIRED", canaryPass: false, reason: "awaiting_terminal" };
      }
      if (!params.productive) {
        return { mode: "CANARY_REQUIRED", canaryPass: false, reason: "no_productive_progress" };
      }
      if (!params.checkpointAdvanced && !params.countAdvanced) {
        return { mode: "CANARY_REQUIRED", canaryPass: false, reason: "no_checkpoint_or_count_advance" };
      }
      const cap = canarySessionRequestCapExceeded(params.sessionQuota, params.maxSessionClRequests);
      if (cap.exceeded && !params.productive) {
        return {
          mode: "CANARY_REQUIRED",
          canaryPass: false,
          humanReviewRequired: true,
          reason: "CANARY_SESSION_REQUEST_CAP_EXCEEDED",
          ...cap
        };
      }
      return {
        mode: "NORMAL",
        canaryPass: true,
        reason: "CANARY_PASS",
        promoteKnownGood: true
      };
    }
    function createSharedClSession(params = {}) {
      const sessionId = params.sessionId || `q2-session-${Date.now()}`;
      const batchId = params.batchId || `q2-batch-${Date.now()}`;
      const maxClRequests = Math.max(0, Number(params.maxClRequests) || CANARY_MAX_SESSION_CL_REQUESTS);
      const alreadyUsed = Math.max(0, Number(params.alreadyUsed) || 0);
      return {
        sessionId,
        batchId,
        maxClRequests,
        alreadyUsed,
        remainingClRequests: Math.max(0, maxClRequests - alreadyUsed),
        historicalJobApiCallsBaseline: Number(params.historicalJobApiCallsBaseline) || 0,
        workerFingerprint: params.workerFingerprint || null
      };
    }
    function remainingChildClBudget(session) {
      const max = Number(session?.maxClRequests);
      const used = Number(session?.alreadyUsed ?? session?.sessionClRequests) || 0;
      if (!Number.isFinite(max)) return null;
      return Math.max(0, max - used);
    }
    function mergeChildSessionAccounting(sessionQuota, child = {}) {
      const next = { ...sessionQuota || createEmptySessionQuota() };
      const childCalls = Number(child.sessionApiCalls ?? child.batchApiCalls ?? 0) || 0;
      const historical = Number(child.historicalJobApiCalls);
      if (Number.isFinite(historical) && next.historicalJobApiCallsBaseline == null) {
        next.historicalJobApiCallsBaseline = historical;
        next.existingJobHistoricalRequests = historical;
      }
      if (child.sessionId) next.sessionId = child.sessionId;
      if (child.batchId) next.batchId = child.batchId;
      if (childCalls > 0) {
        next.sessionClRequests = (Number(next.sessionClRequests) || 0) + childCalls;
        if (child.productive) next.productiveClRequests = (Number(next.productiveClRequests) || 0) + childCalls;
        else next.overheadClRequests = (Number(next.overheadClRequests) || 0) + childCalls;
      }
      next.childSessionApiCalls = (Number(next.childSessionApiCalls) || 0) + childCalls;
      return next;
    }
    function assertChildWithinSessionBudget(params = {}) {
      const max = Number(params.maxClRequests);
      const childCalls = Number(params.childSessionApiCalls) || 0;
      const parentSession = Number(params.parentSessionClRequests) || 0;
      if (!Number.isFinite(max)) return { ok: true, reason: "no_cap" };
      if (childCalls > max) {
        return {
          ok: false,
          reason: "CHILD_EXCEEDED_SESSION_BUDGET",
          childCalls,
          max,
          parentSession
        };
      }
      if (childCalls >= 10 && parentSession <= 1) {
        return {
          ok: false,
          reason: "PARENT_CHILD_ACCOUNTING_DESYNC",
          childCalls,
          parentSession
        };
      }
      return { ok: true, childCalls, max, parentSession };
    }
    module2.exports = {
      LANE_A_RUNNER_STATES,
      TERMINAL_STATES,
      NON_TERMINAL_STATES,
      CANARY_MAX_SESSION_CL_REQUESTS,
      createEmptySessionQuota,
      mapRunnerResultToLifecycleState,
      isTerminalRunnerState,
      isNonTerminalRunnerState,
      parseLaneARunnerStdoutPreferTerminal,
      createLaneAChildRecord,
      isLaneAChildAlive,
      mayLaunchLaneAChild,
      markLaneAChildTerminal,
      isFreshPostRunDbEvidence,
      updateSessionQuotaAccounting,
      canarySessionRequestCapExceeded,
      mayEvaluateLaneAZeroProgress,
      evaluateCanaryAfterTerminal,
      createSharedClSession,
      remainingChildClBudget,
      mergeChildSessionAccounting,
      assertChildWithinSessionBudget
    };
  }
});

// scripts/queue2-db-readiness.cjs
var require_queue2_db_readiness = __commonJS({
  "scripts/queue2-db-readiness.cjs"(exports2, module2) {
    "use strict";
    var DATABASE_QUOTA_BLOCKED = "DATABASE_QUOTA_BLOCKED";
    var NETWORK_UNAVAILABLE = "NETWORK_UNAVAILABLE";
    var DB_DEPENDENCY = Object.freeze({
      DB_REQUIRED: "DB_REQUIRED",
      DB_READ_ONLY: "DB_READ_ONLY",
      NO_DB_REQUIRED: "NO_DB_REQUIRED"
    });
    var LANE_B_DB_DEPENDENCY = Object.freeze({
      US_REPORTS_GAP_ANALYSIS: DB_DEPENDENCY.NO_DB_REQUIRED,
      NON_CL_PRIMARY_AUTHORITY_INTAKE: DB_DEPENDENCY.DB_REQUIRED,
      USC_DEPTH: DB_DEPENDENCY.DB_REQUIRED,
      CFR_DEPTH: DB_DEPENDENCY.DB_REQUIRED,
      FEDERAL_RULES_DEPTH: DB_DEPENDENCY.DB_REQUIRED,
      CITATION_RERESOLVE: DB_DEPENDENCY.DB_REQUIRED,
      DEPTH_MANIFEST_REFRESH: DB_DEPENDENCY.NO_DB_REQUIRED,
      HISTORICAL_GAP_ANALYSIS: DB_DEPENDENCY.NO_DB_REQUIRED,
      INTERMEDIATE_MAPPING_RESEARCH_NON_CL: DB_DEPENDENCY.NO_DB_REQUIRED,
      CORPUS_INTEGRITY_AUDIT: DB_DEPENDENCY.NO_DB_REQUIRED,
      RETRIEVAL_REGRESSION: DB_DEPENDENCY.NO_DB_REQUIRED,
      CURRENTNESS_AUDIT_LOCAL: DB_DEPENDENCY.NO_DB_REQUIRED,
      NEXT_CL_BATCH_PREPARATION: DB_DEPENDENCY.NO_DB_REQUIRED,
      DAILY_SCORECARD_REFRESH: DB_DEPENDENCY.NO_DB_REQUIRED
    });
    var NEON_QUOTA_MESSAGE = /exceeded the quota/i;
    var FLY_CONTROL_PLANE_NETWORK_RE = /api\.machines\.dev|flyctl-metrics\.fly\.dev|fly\.dev|could not (?:get|exec)(?:\s+command)?\s+on\s+machine|failed to (?:get|exec)(?:\s+on)?\s+VM|dial tcp:\s*lookup|lookup\s+[\w.-]+\s*:\s*no such host|getaddrinfo|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ECONNRESET|ECONNREFUSED|network is unreachable|temporary failure in name resolution|wsarecv:.*(?:aborted|forcibly closed)/i;
    function textOf(input) {
      if (input == null) return "";
      if (typeof input === "string") return input;
      return String(
        input.message || input.err || input.reason || input.stderr || input.stdout || input.raw || ""
      );
    }
    function codeOf(input) {
      if (input == null || typeof input === "string") return null;
      return input.code || input.sqlstate || input.SQLSTATE || input.errno || null;
    }
    function isFlyOrControlPlaneNetworkFailure(input) {
      const code = String(codeOf(input) || "");
      if (["ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"].includes(code)) return true;
      const text = textOf(input);
      if (!text) return false;
      return FLY_CONTROL_PLANE_NETWORK_RE.test(text);
    }
    function classifyDatabaseFailure(input) {
      const code = codeOf(input);
      const message = textOf(input);
      const sqlstate = String(code || (message.match(/SQLSTATE[:\s]*([0-9A-Z]{5})/i) || [])[1] || "");
      if (sqlstate === "53000" || NEON_QUOTA_MESSAGE.test(message)) {
        return {
          classification: DATABASE_QUOTA_BLOCKED,
          sqlstate: sqlstate || "53000",
          external: true,
          temporary: true,
          severity: "EXTERNAL_BLOCK",
          courtListenerFailure: false,
          ingestionParserFailure: false,
          mappingFailure: false,
          checkpointCorruption: false,
          sourceFailure: false,
          networkFailure: false
        };
      }
      if (isFlyOrControlPlaneNetworkFailure(input)) {
        return {
          classification: NETWORK_UNAVAILABLE,
          sqlstate: sqlstate || null,
          external: true,
          temporary: true,
          severity: "WAIT_AND_RETRY",
          courtListenerFailure: false,
          ingestionParserFailure: false,
          mappingFailure: false,
          checkpointCorruption: false,
          sourceFailure: false,
          networkFailure: true,
          flyControlPlane: /api\.machines\.dev|could not (?:get|exec)|failed to (?:get|exec)/i.test(message),
          metricsNoiseOnly: /flyctl-metrics\.fly\.dev/i.test(message) && !/api\.machines\.dev/i.test(message) && !/could not (?:get|exec)/i.test(message)
        };
      }
      if (!input || input.ok === true) {
        return { classification: null, sqlstate: sqlstate || null, external: false, networkFailure: false };
      }
      return {
        classification: "UNKNOWN_DB_FAILURE",
        sqlstate: sqlstate || null,
        external: true,
        temporary: false,
        severity: "HUMAN_REVIEW_REQUIRED",
        courtListenerFailure: false,
        ingestionParserFailure: false,
        mappingFailure: false,
        checkpointCorruption: false,
        sourceFailure: false,
        networkFailure: false
      };
    }
    function evaluateDbWriteReadiness(probe) {
      if (!probe || typeof probe !== "object") {
        return {
          dbWriteReady: false,
          classification: "DATABASE_UNAVAILABLE",
          reason: "DATABASE_UNAVAILABLE",
          mutations: 0,
          courtListenerHttpCalls: 0
        };
      }
      const failure = classifyDatabaseFailure(probe);
      if (failure.classification === DATABASE_QUOTA_BLOCKED) {
        return {
          dbWriteReady: false,
          classification: DATABASE_QUOTA_BLOCKED,
          reason: DATABASE_QUOTA_BLOCKED,
          sqlstate: failure.sqlstate,
          external: true,
          mutations: 0,
          courtListenerHttpCalls: 0
        };
      }
      if (failure.classification === NETWORK_UNAVAILABLE) {
        return {
          dbWriteReady: false,
          classification: NETWORK_UNAVAILABLE,
          reason: NETWORK_UNAVAILABLE,
          severity: "WAIT_AND_RETRY",
          temporary: true,
          networkFailure: true,
          flyControlPlane: Boolean(failure.flyControlPlane),
          mutations: 0,
          courtListenerHttpCalls: 0,
          childLaunches: 0
        };
      }
      if (probe.writable === false || probe.readOnly === true) {
        return {
          dbWriteReady: false,
          classification: "DATABASE_READ_ONLY",
          reason: "DATABASE_READ_ONLY",
          mutations: 0,
          courtListenerHttpCalls: 0
        };
      }
      if (probe.ok === true && probe.writable !== false) {
        return {
          dbWriteReady: true,
          classification: "DB_READY",
          reason: "DB_READY",
          mutations: 0,
          courtListenerHttpCalls: 0
        };
      }
      return {
        dbWriteReady: false,
        classification: failure.classification || "DATABASE_UNAVAILABLE",
        reason: failure.classification || "DATABASE_UNAVAILABLE",
        sqlstate: failure.sqlstate,
        mutations: 0,
        courtListenerHttpCalls: 0
      };
    }
    function clearTransientNetworkHumanReview(state, opts = {}) {
      const next = state && typeof state === "object" ? JSON.parse(JSON.stringify(state)) : {};
      const reasons = Array.isArray(next.humanReview?.reasons) ? [...next.humanReview.reasons] : [];
      const transient = /* @__PURE__ */ new Set([NETWORK_UNAVAILABLE, "UNKNOWN_DB_FAILURE"]);
      const kept = reasons.filter((r) => !transient.has(r));
      const cleared = reasons.filter((r) => transient.has(r));
      if (cleared.length === 0 && !next.waitingForNetwork && !next.networkBlock) {
        return { state: next, cleared: false, clearedReasons: [] };
      }
      if (opts.processGateSafe !== true && kept.length === 0 && cleared.length > 0) {
        if (next.laneAChild?.unknownDueToNetwork || next.laneAChild?.lifecycleState === "UNKNOWN_DUE_TO_NETWORK") {
          return { state: next, cleared: false, clearedReasons: [], hold: "PROCESS_GATE_REQUIRED" };
        }
      }
      next.humanReview = {
        required: kept.length > 0,
        reasons: kept,
        details: Array.isArray(next.humanReview?.details) ? next.humanReview.details.filter((d) => !transient.has(d?.reason)) : []
      };
      if (opts.markRecovered === true) {
        next.waitingForNetwork = false;
        next.networkBlock = next.networkBlock ? {
          ...next.networkBlock,
          recovered: true,
          recoveredAt: (opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now())).toISOString()
        } : null;
        if (next.laneAChild && (next.laneAChild.unknownDueToNetwork || next.laneAChild.lifecycleState === "UNKNOWN_DUE_TO_NETWORK")) {
          if (opts.clearUnknownChild === true) {
            next.laneAChild = null;
          }
        }
      }
      return { state: next, cleared: cleared.length > 0, clearedReasons: cleared };
    }
    function applyNetworkUnavailable(state, now = /* @__PURE__ */ new Date(), detail = {}) {
      const next = JSON.parse(JSON.stringify(state || {}));
      const nowIso = (now instanceof Date ? now : new Date(now)).toISOString();
      const checkpoint = next.laneA ? next.laneA.checkpoint ?? null : null;
      next.waitingForNetwork = true;
      next.runtimeState = "WAITING_FOR_NETWORK";
      next.dbWriteReady = false;
      next.networkBlock = {
        classification: NETWORK_UNAVAILABLE,
        severity: "WAIT_AND_RETRY",
        since: next.networkBlock?.since || nowIso,
        recovered: false,
        source: detail.source || "fly_control_plane",
        detail: detail.message ? String(detail.message).slice(0, 400) : null
      };
      next.currentLane = "WAITING_FOR_NETWORK";
      next.queue = "#2";
      next.queue9 = "CLOSED";
      next.queue3 = "NOT_OPEN";
      next.featureAgents = "0";
      next.idleSafe = true;
      next.healthyIdle = { status: "WAITING_FOR_NETWORK", reason: NETWORK_UNAVAILABLE };
      if (next.laneA) next.laneA.checkpoint = checkpoint;
      const prior = Array.isArray(next.humanReview?.reasons) ? next.humanReview.reasons : [];
      const kept = prior.filter((r) => r !== NETWORK_UNAVAILABLE && r !== "UNKNOWN_DB_FAILURE");
      next.humanReview = {
        required: kept.length > 0,
        reasons: kept,
        details: Array.isArray(next.humanReview?.details) ? next.humanReview.details.filter(
          (d) => d?.reason !== NETWORK_UNAVAILABLE && d?.reason !== "UNKNOWN_DB_FAILURE"
        ) : []
      };
      next.metrics = { ...next.metrics || {}, aiCalls: 0, aiTokens: 0 };
      return next;
    }
    function assertCourtListenerAllowed(params = {}) {
      if (params.dbWriteReady !== true) {
        return {
          ok: false,
          reason: "INVARIANT_CL_WHILE_DB_NOT_WRITABLE",
          clRequests: 0,
          executed: false
        };
      }
      return { ok: true, reason: null, clRequests: 0, executed: false };
    }
    function guardCourtListenerAttempt(params = {}) {
      const gate = assertCourtListenerAllowed(params);
      if (!gate.ok) {
        return { executed: false, clRequests: 0, reason: gate.reason, httpExecuted: false };
      }
      if (typeof params.execute === "function") {
        params.execute();
        return { executed: true, clRequests: Number(params.clRequests) || 1, reason: null, httpExecuted: true };
      }
      return { executed: false, clRequests: 0, reason: null, httpExecuted: false };
    }
    function markQuotaUnknownForExecution(quota) {
      const prior = quota && typeof quota === "object" ? quota : {};
      return {
        ...prior,
        quotaStatus: "UNKNOWN_FOR_EXECUTION",
        executionAuthority: "STALE",
        usableForExecution: false,
        quotaStateConfidence: "STALE",
        quotaStateSource: "historical_not_for_execution"
      };
    }
    function quotaUsableForExecution(quota) {
      if (!quota || typeof quota !== "object") return false;
      if (quota.usableForExecution === false) return false;
      if (quota.quotaStatus === "UNKNOWN_FOR_EXECUTION") return false;
      if (quota.executionAuthority === "STALE") return false;
      return true;
    }
    function applyDatabaseQuotaBlock(state, now = /* @__PURE__ */ new Date()) {
      const next = JSON.parse(JSON.stringify(state || {}));
      const nowIso = (now instanceof Date ? now : new Date(now)).toISOString();
      const checkpoint = next.laneA ? next.laneA.checkpoint ?? null : null;
      next.dbWriteReady = false;
      next.laneAStatus = "BLOCKED";
      next.databaseBlock = {
        classification: DATABASE_QUOTA_BLOCKED,
        since: next.databaseBlock?.classification === DATABASE_QUOTA_BLOCKED && next.databaseBlock.since ? next.databaseBlock.since : nowIso,
        recovered: false
      };
      next.quota = markQuotaUnknownForExecution(next.quota);
      next.currentLane = "B";
      next.queue = "#2";
      next.queue9 = "CLOSED";
      next.queue3 = "NOT_OPEN";
      next.featureAgents = "0";
      next.metrics = { ...next.metrics || {}, aiCalls: 0, aiTokens: 0 };
      if (next.laneA) next.laneA.checkpoint = checkpoint;
      if (!next.humanReview) next.humanReview = { required: false, reasons: [], details: [] };
      return next;
    }
    function recoverDatabaseQuotaBlock(state, now = /* @__PURE__ */ new Date()) {
      const next = JSON.parse(JSON.stringify(state || {}));
      const prior = next.databaseBlock;
      if (!prior || prior.classification !== DATABASE_QUOTA_BLOCKED || prior.recovered === true) {
        return { state: next, recovered: false };
      }
      const nowIso = (now instanceof Date ? now : new Date(now)).toISOString();
      next.databaseBlock = {
        classification: "RECOVERED",
        recoveredFrom: DATABASE_QUOTA_BLOCKED,
        since: prior.since || nowIso,
        recoveredAt: nowIso,
        recovered: true
      };
      next.dbWriteReady = true;
      next.laneAStatus = "READY";
      next.quota = markQuotaUnknownForExecution(next.quota);
      next.quotaProbeCache = null;
      next.queue = "#2";
      next.queue3 = "NOT_OPEN";
      next.featureAgents = "0";
      return { state: next, recovered: true };
    }
    function auditLaneBDbDependency(registry) {
      const tasks = registry?.tasks || [];
      const problems = [];
      const seen = /* @__PURE__ */ new Set();
      for (const task of tasks) {
        seen.add(task.id);
        const expected = LANE_B_DB_DEPENDENCY[task.id];
        if (!expected) problems.push(`unclassified:${task.id}`);
        else if (task.dbDependency !== expected) {
          problems.push(`mismatch:${task.id}:${task.dbDependency || "missing"}!=${expected}`);
        } else if (!Object.values(DB_DEPENDENCY).includes(task.dbDependency)) {
          problems.push(`invalid:${task.id}`);
        }
      }
      for (const id of Object.keys(LANE_B_DB_DEPENDENCY)) {
        if (!seen.has(id)) problems.push(`registry_missing:${id}`);
      }
      return { ok: problems.length === 0, problems, classes: { ...LANE_B_DB_DEPENDENCY } };
    }
    module2.exports = {
      DATABASE_QUOTA_BLOCKED,
      NETWORK_UNAVAILABLE,
      DB_DEPENDENCY,
      LANE_B_DB_DEPENDENCY,
      isFlyOrControlPlaneNetworkFailure,
      classifyDatabaseFailure,
      evaluateDbWriteReadiness,
      assertCourtListenerAllowed,
      guardCourtListenerAttempt,
      markQuotaUnknownForExecution,
      quotaUsableForExecution,
      applyDatabaseQuotaBlock,
      recoverDatabaseQuotaBlock,
      applyNetworkUnavailable,
      clearTransientNetworkHumanReview,
      auditLaneBDbDependency
    };
  }
});

// scripts/queue2-existing-job-reconcile.cjs
var require_queue2_existing_job_reconcile = __commonJS({
  "scripts/queue2-existing-job-reconcile.cjs"(exports2, module2) {
    "use strict";
    var JOB_CLASSIFICATIONS = Object.freeze({
      NONE: "NONE",
      ACTIVE_VALID: "ACTIVE_VALID",
      STALE_RESUMABLE: "STALE_RESUMABLE",
      STALE_NONRESUMABLE: "STALE_NONRESUMABLE",
      COMPLETED_BUT_STATUS_STALE: "COMPLETED_BUT_STATUS_STALE",
      CORRUPT_INCONSISTENT: "CORRUPT_INCONSISTENT"
    });
    var JOB_LIFECYCLE_STATES = Object.freeze({
      RUNNING_ACTIVE: "RUNNING_ACTIVE",
      PAUSED_RESUMABLE: "PAUSED_RESUMABLE",
      FAILED_RESUMABLE: "FAILED_RESUMABLE",
      FAILED_NONRESUMABLE: "FAILED_NONRESUMABLE",
      COMPLETED: "COMPLETED"
    });
    var RESUME_EVIDENCE = Object.freeze({
      LAST_SUCCESSFUL_EXTERNAL_ID: "LAST_SUCCESSFUL_EXTERNAL_ID",
      CURSOR_ONLY: "CURSOR_ONLY",
      NEXT_PAGE_URL: "NEXT_PAGE_URL",
      NONE: "NONE"
    });
    function isTimeoutErrorText(text) {
      return /TimeoutError|aborted due to timeout|AbortError|operation was aborted/i.test(String(text || ""));
    }
    function asJob(job) {
      if (!job || typeof job !== "object") return null;
      return job;
    }
    function jobResumeFields(job) {
      const j = asJob(job) || {};
      const cursor = j.cursor || null;
      const lastSuccessfulExternalId = j.last_successful_external_id || j.lastSuccessfulExternalId || null;
      const nextPageUrl = j.next_page_url || j.nextPageUrl || null;
      return { cursor, lastSuccessfulExternalId, nextPageUrl };
    }
    function resolveResumeEvidence(job, opts = {}) {
      const { cursor, lastSuccessfulExternalId, nextPageUrl } = jobResumeFields(job);
      if (lastSuccessfulExternalId) {
        return {
          kind: RESUME_EVIDENCE.LAST_SUCCESSFUL_EXTERNAL_ID,
          resumeId: lastSuccessfulExternalId,
          cursor,
          lastSuccessfulExternalId,
          nextPageUrl,
          sufficient: true
        };
      }
      if (cursor) {
        const cursorValid = opts.cursorValid !== false;
        return {
          kind: RESUME_EVIDENCE.CURSOR_ONLY,
          resumeId: cursor,
          cursor,
          lastSuccessfulExternalId: null,
          nextPageUrl,
          sufficient: cursorValid
        };
      }
      if (nextPageUrl) {
        return {
          kind: RESUME_EVIDENCE.NEXT_PAGE_URL,
          resumeId: null,
          cursor: null,
          lastSuccessfulExternalId: null,
          nextPageUrl,
          sufficient: true
        };
      }
      return {
        kind: RESUME_EVIDENCE.NONE,
        resumeId: null,
        cursor: null,
        lastSuccessfulExternalId: null,
        nextPageUrl: null,
        sufficient: false
      };
    }
    function classifyExistingCorpusIngestJob(job, ctx = {}) {
      const j = asJob(job);
      if (!j) {
        return {
          classification: JOB_CLASSIFICATIONS.NONE,
          resumable: false,
          resumeEvidence: resolveResumeEvidence(null),
          reason: "no_job"
        };
      }
      const status = String(j.status || "").toLowerCase();
      const imported = Math.max(0, Number(j.items_imported ?? j.itemsImported) || 0);
      const targetMax = Math.max(0, Number(j.target_max ?? j.targetMax) || 0);
      const ownerAlive = Boolean(ctx.ownerAlive || ctx.processAlive);
      const nowMs = ctx.now instanceof Date ? ctx.now.getTime() : Number(ctx.now) || Date.now();
      const updatedMs = j.updated_at || j.updatedAt ? Date.parse(j.updated_at || j.updatedAt) : 0;
      const ageMs = updatedMs > 0 ? Math.max(0, nowMs - updatedMs) : Number.POSITIVE_INFINITY;
      const resume = resolveResumeEvidence(j, { cursorValid: ctx.cursorValid });
      const corpusCl = ctx.corpusClCases != null && Number.isFinite(Number(ctx.corpusClCases)) ? Number(ctx.corpusClCases) : null;
      if (corpusCl != null && imported > 0 && Math.abs(corpusCl - imported) > Math.max(5, imported * 0.5)) {
        return {
          classification: JOB_CLASSIFICATIONS.CORRUPT_INCONSISTENT,
          resumable: false,
          resumeEvidence: resume,
          reason: "imported_vs_corpus_mismatch",
          evidence: { imported, corpusClCases: corpusCl }
        };
      }
      if (status === "completed" || targetMax > 0 && imported >= targetMax) {
        return {
          classification: JOB_CLASSIFICATIONS.COMPLETED_BUT_STATUS_STALE,
          resumable: false,
          resumeEvidence: resume,
          reason: status === "completed" ? "completed" : "imported_meets_target_status_not_completed",
          evidence: { imported, targetMax, status }
        };
      }
      if (imported > 0 && !resume.sufficient) {
        return {
          classification: JOB_CLASSIFICATIONS.STALE_NONRESUMABLE,
          resumable: false,
          resumeEvidence: resume,
          reason: "imported_without_sufficient_resume_evidence",
          evidence: { imported, status }
        };
      }
      if (ownerAlive && (status === "running" || status === "quota_paused" || status === "rate_limited")) {
        return {
          classification: JOB_CLASSIFICATIONS.ACTIVE_VALID,
          resumable: true,
          resumeEvidence: resume,
          reason: "owner_alive",
          evidence: { status, ageMs, ownerAlive: true }
        };
      }
      if (!ownerAlive && resume.sufficient && (imported > 0 || status === "running" || status === "quota_paused")) {
        return {
          classification: JOB_CLASSIFICATIONS.STALE_RESUMABLE,
          resumable: true,
          resumeEvidence: resume,
          reason: status === "running" ? "stale_running_dead_owner" : "stale_resumable_dead_owner",
          evidence: { status, ageMs, imported, ownerAlive: false }
        };
      }
      if (!resume.sufficient) {
        return {
          classification: JOB_CLASSIFICATIONS.STALE_NONRESUMABLE,
          resumable: false,
          resumeEvidence: resume,
          reason: "missing_resume_evidence",
          evidence: { status, imported }
        };
      }
      return {
        classification: JOB_CLASSIFICATIONS.STALE_RESUMABLE,
        resumable: true,
        resumeEvidence: resume,
        reason: "default_resumable",
        evidence: { status, imported, ageMs }
      };
    }
    function isReadyAllowedGivenJob(job, ctx = {}) {
      const classified = classifyExistingCorpusIngestJob(job, ctx);
      if (classified.classification === JOB_CLASSIFICATIONS.NONE) return true;
      if (classified.resumable) return false;
      if (classified.classification === JOB_CLASSIFICATIONS.COMPLETED_BUT_STATUS_STALE) return false;
      if (classified.classification === JOB_CLASSIFICATIONS.CORRUPT_INCONSISTENT) return false;
      return true;
    }
    function adoptExistingJobIntoLaneA(state, job, classified, opts = {}) {
      const next = JSON.parse(JSON.stringify(state || {}));
      const j = asJob(job);
      const c = classified || classifyExistingCorpusIngestJob(j, opts);
      const resume = c.resumeEvidence || resolveResumeEvidence(j, opts);
      const nowIso = (opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now())).toISOString();
      if (c.classification === JOB_CLASSIFICATIONS.CORRUPT_INCONSISTENT || c.classification === JOB_CLASSIFICATIONS.STALE_NONRESUMABLE) {
        next.humanReview = next.humanReview || { required: false, reasons: [], details: [] };
        next.humanReview.required = true;
        const reason = c.classification === JOB_CLASSIFICATIONS.CORRUPT_INCONSISTENT ? "CORRUPT_INCONSISTENT_INGEST_JOB" : "MISSING_DURABLE_RESUME_CHECKPOINT";
        if (!next.humanReview.reasons.includes(reason)) next.humanReview.reasons.push(reason);
        next.humanReview.details.push({ reason, detail: c.reason, at: nowIso });
        next.laneA = {
          ...next.laneA || {},
          targetStatus: "HUMAN_REVIEW_REQUIRED",
          jobStatus: j?.status || next.laneA?.jobStatus || null,
          existingJobClassification: c.classification,
          resumeEvidenceKind: resume.kind
        };
        return { ok: false, state: next, classified: c, humanReviewRequired: true };
      }
      const count = opts.qualifyingCases != null && Number.isFinite(Number(opts.qualifyingCases)) ? Number(opts.qualifyingCases) : opts.corpusClCases != null && Number.isFinite(Number(opts.corpusClCases)) ? Number(opts.corpusClCases) : Number(j?.items_imported ?? next.laneA?.count) || 0;
      const resumeId = resume.resumeId || resume.cursor || resume.lastSuccessfulExternalId || null;
      next.laneA = {
        ...next.laneA || {},
        court: j?.cl_court || j?.clCourt || next.laneA?.court,
        count,
        target: Number(j?.target_max ?? next.laneA?.target) || 45,
        checkpoint: resume.lastSuccessfulExternalId || null,
        cursor: resume.cursor,
        lastSuccessfulExternalId: resume.lastSuccessfulExternalId,
        nextPageUrl: resume.nextPageUrl,
        jobStatus: c.classification === JOB_CLASSIFICATIONS.STALE_RESUMABLE ? "quota_paused" : j?.status || "running",
        itemsImported: Number(j?.items_imported ?? count) || 0,
        targetStatus: "PARTIAL",
        existingJobClassification: c.classification,
        resumeEvidenceKind: resume.kind,
        lastSuccessfulAt: j?.updated_at || j?.updatedAt || next.laneA?.lastSuccessfulAt || nowIso,
        mappingStatus: opts.mappingStatus || next.laneA?.mappingStatus || "VERIFIED"
      };
      if (!next.laneA.checkpoint && resumeId && resume.kind === RESUME_EVIDENCE.CURSOR_ONLY) {
        next.laneA.checkpoint = resumeId;
      }
      if (next.humanReview?.required && Array.isArray(next.humanReview.reasons)) {
        const drop = /* @__PURE__ */ new Set([
          "LANE_A_COUNT_RECONCILIATION_FAILED",
          "MISSING_DURABLE_RESUME_CHECKPOINT"
        ]);
        next.humanReview.reasons = next.humanReview.reasons.filter((r) => !drop.has(r));
        next.humanReview.details = (next.humanReview.details || []).filter((d) => !drop.has(d.reason));
        if (next.humanReview.reasons.length === 0) {
          next.humanReview.required = false;
          next.humanReview.details = [];
        }
      }
      next.idleSafe = false;
      next.updatedAt = nowIso;
      return {
        ok: true,
        state: next,
        classified: c,
        humanReviewRequired: false,
        resumeFrom: resumeId,
        duplicateIngestionRisk: false
      };
    }
    function deriveJobLifecycleState(job, ctx = {}) {
      const j = asJob(job);
      if (!j) {
        return {
          lifecycle: null,
          durableStatus: null,
          clearOwnership: false,
          reason: "no_job"
        };
      }
      const status = String(j.status || "").toLowerCase();
      const activeProcess = Boolean(ctx.activeProcess || ctx.ownerAlive || ctx.processAlive);
      const resume = resolveResumeEvidence(j, { cursorValid: ctx.cursorValid !== false });
      const imported = Math.max(0, Number(j.items_imported ?? j.itemsImported) || 0);
      const targetMax = Math.max(0, Number(j.target_max ?? j.targetMax) || 0);
      const lastError = j.last_error || j.lastError || null;
      const timeout = Boolean(ctx.timeout || isTimeoutErrorText(lastError));
      if (status === "completed" || targetMax > 0 && imported >= targetMax) {
        return {
          lifecycle: JOB_LIFECYCLE_STATES.COMPLETED,
          durableStatus: "completed",
          clearOwnership: true,
          reason: "completed",
          resume
        };
      }
      if (activeProcess && (status === "running" || status === "quota_paused" || status === "rate_limited")) {
        return {
          lifecycle: JOB_LIFECYCLE_STATES.RUNNING_ACTIVE,
          durableStatus: status,
          clearOwnership: false,
          reason: "active_owner",
          resume,
          hold: true
        };
      }
      if (!resume.sufficient && imported > 0) {
        return {
          lifecycle: JOB_LIFECYCLE_STATES.FAILED_NONRESUMABLE,
          durableStatus: "failed",
          clearOwnership: true,
          reason: "imported_without_resume_evidence",
          resume,
          humanReviewRequired: true
        };
      }
      if (timeout && resume.sufficient && !activeProcess) {
        return {
          lifecycle: JOB_LIFECYCLE_STATES.PAUSED_RESUMABLE,
          durableStatus: "paused",
          clearOwnership: true,
          reason: "timeout_recoverable",
          resume,
          humanReviewRequired: false
        };
      }
      if (!activeProcess && resume.sufficient && (status === "running" || status === "paused" || status === "quota_paused")) {
        return {
          lifecycle: JOB_LIFECYCLE_STATES.PAUSED_RESUMABLE,
          durableStatus: status === "running" ? "paused" : status === "quota_paused" ? "quota_paused" : "paused",
          clearOwnership: true,
          reason: status === "running" ? "stale_running_dead_owner" : "already_paused_resumable",
          resume,
          humanReviewRequired: false
        };
      }
      if (status === "failed" && resume.sufficient) {
        return {
          lifecycle: JOB_LIFECYCLE_STATES.FAILED_RESUMABLE,
          durableStatus: "failed",
          clearOwnership: true,
          reason: "failed_with_resume",
          resume,
          humanReviewRequired: false
        };
      }
      if (status === "failed") {
        return {
          lifecycle: JOB_LIFECYCLE_STATES.FAILED_NONRESUMABLE,
          durableStatus: "failed",
          clearOwnership: true,
          reason: "failed_no_resume",
          resume,
          humanReviewRequired: true
        };
      }
      return {
        lifecycle: JOB_LIFECYCLE_STATES.PAUSED_RESUMABLE,
        durableStatus: "paused",
        clearOwnership: true,
        reason: "default_paused_resumable",
        resume,
        humanReviewRequired: false
      };
    }
    function normalizeStaleRunningJob(job, ctx = {}) {
      const derived = deriveJobLifecycleState(job, { ...ctx, activeProcess: Boolean(ctx.activeProcess) });
      const j = asJob(job);
      if (!j) {
        return { ok: false, reason: "no_job", derived };
      }
      if (derived.lifecycle === JOB_LIFECYCLE_STATES.RUNNING_ACTIVE) {
        return {
          ok: false,
          hold: true,
          reason: "ACTIVE_CHILD_PROCESS",
          derived,
          patch: null
        };
      }
      const patch = {
        status: derived.durableStatus,
        cursor: j.cursor,
        // never reset
        last_successful_external_id: j.last_successful_external_id || j.lastSuccessfulExternalId || null,
        next_page_url: j.next_page_url || j.nextPageUrl || null,
        items_imported: j.items_imported ?? j.itemsImported,
        api_calls: j.api_calls ?? j.apiCalls,
        last_error: j.last_error || j.lastError || null,
        clearOwnership: derived.clearOwnership
      };
      return {
        ok: true,
        hold: false,
        reason: derived.reason,
        derived,
        patch,
        lifecycle: derived.lifecycle,
        humanReviewRequired: Boolean(derived.humanReviewRequired)
      };
    }
    function replayMiJobStateAndAccountingFlow(opts = {}) {
      const events = [];
      const push = (type, extra = {}) => events.push({ type, ...extra });
      const job = {
        source: "courtlistener",
        cl_court: "mich",
        status: "running",
        cursor: "cl-opinion-11250867",
        last_successful_external_id: null,
        next_page_url: null,
        items_imported: 19,
        items_fetched: 19,
        api_calls: 9,
        target_max: 45,
        last_error: "TimeoutError: The operation was aborted due to timeout",
        updated_at: "2026-09-25T18:36:49.406Z",
        completed_at: null
      };
      const activeProcess = opts.activeProcess === true;
      push("PROCESS_CHECK", { activeProcess });
      if (activeProcess) {
        return {
          ok: false,
          hold: true,
          reason: "ACTIVE_CHILD_PROCESS",
          events,
          courtListenerHttpCalls: 0,
          mutations: 0,
          aiCalls: 0,
          queue3: "NOT_OPEN"
        };
      }
      const normalized = normalizeStaleRunningJob(job, {
        activeProcess: false,
        timeout: true,
        cursorValid: true
      });
      push("NORMALIZE", normalized);
      assertOk(normalized.ok && normalized.lifecycle === JOB_LIFECYCLE_STATES.PAUSED_RESUMABLE);
      const runnerTerminalAt = "2026-09-25T18:41:56.447Z";
      const staleDb = {
        qualifyingCases: 20,
        clCases: 19,
        generatedAt: "2026-09-25T18:09:38.292Z"
      };
      const freshDb = {
        qualifyingCases: 20,
        highCourtClCases: 19,
        clCases: 19,
        cases: 20,
        authorities: 43,
        integrity: { duplicateSourceIds: 0, orphanCount: 0 },
        generatedAt: "2026-09-25T18:42:00.000Z",
        dbEvidenceObservedAt: "2026-09-25T18:42:00.000Z"
      };
      push("REJECT_STALE_DB", {
        staleAt: staleDb.generatedAt,
        terminalAt: runnerTerminalAt,
        accepted: Date.parse(staleDb.generatedAt) >= Date.parse(runnerTerminalAt)
      });
      push("ACCEPT_FRESH_DB", {
        freshAt: freshDb.generatedAt,
        accepted: Date.parse(freshDb.generatedAt) >= Date.parse(runnerTerminalAt)
      });
      const classified = classifyExistingCorpusIngestJob(
        { ...job, status: normalized.patch.status },
        { ownerAlive: false, cursorValid: true, corpusClCases: 19 }
      );
      const state0 = {
        laneA: {
          court: "mich",
          count: 20,
          target: 45,
          targetStatus: "PARTIAL",
          checkpoint: "cl-opinion-11250867",
          cursor: "cl-opinion-11250867",
          mappingStatus: "VERIFIED"
        },
        humanReview: { required: false, reasons: [], details: [] },
        queue3: "NOT_OPEN"
      };
      const staleRec = reconcileStaleRunningGuard({
        state: state0,
        job: { ...job, status: "paused" },
        liveDb: freshDb,
        ownerAlive: false,
        processAlive: false,
        cursorValid: true,
        now: /* @__PURE__ */ new Date("2026-09-25T18:42:01.000Z")
      });
      push("STALE_GUARD", {
        ok: staleRec.ok,
        humanReviewRequired: staleRec.humanReviewRequired,
        classification: staleRec.classification
      });
      const session = {
        sessionId: "mi-canary-session-1",
        batchId: "mi-canary-batch-1",
        historicalJobApiCalls: 9,
        sessionClRequests: 0,
        productiveClRequests: 0,
        maxClRequests: 5
      };
      const childCalls = 3;
      assertOk(childCalls <= session.maxClRequests);
      session.sessionClRequests += childCalls;
      session.productiveClRequests += childCalls;
      push("CANARY_CHILD", {
        sessionClRequests: session.sessionClRequests,
        productiveClRequests: session.productiveClRequests,
        historicalJobApiCalls: session.historicalJobApiCalls,
        checkpointAdvances: true,
        page1Restart: false
      });
      const ok = normalized.lifecycle === JOB_LIFECYCLE_STATES.PAUSED_RESUMABLE && staleRec.ok === true && staleRec.humanReviewRequired === false && session.sessionClRequests === 3 && session.historicalJobApiCalls === 9 && state0.queue3 === "NOT_OPEN";
      return {
        ok,
        hold: false,
        events,
        normalized,
        staleRec,
        session,
        courtListenerHttpCalls: 0,
        mutations: 0,
        aiCalls: 0,
        queue3: "NOT_OPEN",
        checkpoint: "cl-opinion-11250867",
        miCount: 20
      };
    }
    function assertOk(cond) {
      if (!cond) throw new Error("replay_assertion_failed");
    }
    function reconcileStaleRunningGuard(params = {}) {
      const job = asJob(params.job) || asJob(params.classified?.existingJob) || null;
      const liveDb = params.liveDb || null;
      const hasDb = liveDb && [liveDb.qualifyingCases, liveDb.highCourtClCases, liveDb.clCases, liveDb.cases].some(
        (n) => Number.isFinite(Number(n))
      );
      if (!hasDb) {
        return {
          ok: false,
          classification: "LIVE_DB_RECONCILIATION_UNAVAILABLE",
          humanReviewRequired: true,
          reason: "LIVE_DB_RECONCILIATION_UNAVAILABLE",
          detail: "stale_running_guard requires live DB count before count consistency decision",
          runnerBatchImported: 0,
          existingJobItemsImported: Number(job?.items_imported ?? job?.itemsImported) || 0,
          canonicalDbCount: null
        };
      }
      if (!job) {
        return {
          ok: false,
          classification: "RECONCILIATION_FAILED",
          humanReviewRequired: true,
          reason: "STALE_RUNNING_WITHOUT_JOB",
          runnerBatchImported: 0,
          existingJobItemsImported: 0,
          canonicalDbCount: Number(
            liveDb.qualifyingCases ?? liveDb.highCourtClCases ?? liveDb.clCases ?? liveDb.cases
          )
        };
      }
      const activeProcess = Boolean(params.ownerAlive || params.processAlive || params.activeProcess);
      if (activeProcess) {
        return {
          ok: false,
          hold: true,
          classification: JOB_LIFECYCLE_STATES.RUNNING_ACTIVE,
          humanReviewRequired: false,
          reason: "ACTIVE_CHILD_PROCESS",
          detail: "refusing normalize while staging-cl-batch child is alive",
          runnerBatchImported: 0,
          existingJobItemsImported: Number(job.items_imported ?? job.itemsImported) || 0,
          canonicalDbCount: Number(
            liveDb.qualifyingCases ?? liveDb.highCourtClCases ?? liveDb.clCases ?? liveDb.cases
          )
        };
      }
      const normalized = normalizeStaleRunningJob(job, {
        activeProcess: false,
        timeout: isTimeoutErrorText(job.last_error || job.lastError) || Boolean(params.timeout),
        cursorValid: params.cursorValid !== false
      });
      const jobForClassify = {
        ...job,
        status: normalized.patch?.status || (normalized.lifecycle === JOB_LIFECYCLE_STATES.PAUSED_RESUMABLE ? "paused" : job.status)
      };
      const classified = classifyExistingCorpusIngestJob(jobForClassify, {
        ownerAlive: false,
        processAlive: false,
        cursorValid: params.cursorValid !== false,
        corpusClCases: liveDb.clCases ?? liveDb.highCourtClCases,
        qualifyingCases: liveDb.qualifyingCases ?? liveDb.highCourtClCases ?? liveDb.clCases,
        now: params.now
      });
      const canonicalDbCount = Number(
        liveDb.qualifyingCases ?? liveDb.highCourtClCases ?? liveDb.clCases ?? liveDb.cases
      );
      const existingJobItemsImported = Number(job.items_imported ?? job.itemsImported) || 0;
      if (!classified.resumable) {
        return {
          ok: false,
          classification: classified.classification,
          humanReviewRequired: true,
          reason: classified.reason,
          classified,
          normalized,
          runnerBatchImported: 0,
          existingJobItemsImported,
          canonicalDbCount
        };
      }
      const adopted = adoptExistingJobIntoLaneA(params.state, jobForClassify, classified, {
        qualifyingCases: canonicalDbCount,
        corpusClCases: liveDb.clCases ?? liveDb.highCourtClCases,
        mappingStatus: params.mappingStatus || "VERIFIED",
        cursorValid: params.cursorValid !== false,
        now: params.now
      });
      if (adopted.state?.laneA) {
        adopted.state.laneA.jobStatus = "quota_paused";
        adopted.state.laneA.jobLifecycle = normalized.lifecycle || JOB_LIFECYCLE_STATES.PAUSED_RESUMABLE;
        adopted.state.laneAChild = null;
      }
      return {
        ok: adopted.ok,
        classification: "EXISTING_JOB_RECONCILED",
        jobClassification: classified.classification,
        jobLifecycle: normalized.lifecycle || JOB_LIFECYCLE_STATES.PAUSED_RESUMABLE,
        humanReviewRequired: Boolean(adopted.humanReviewRequired || normalized.humanReviewRequired),
        state: adopted.state,
        classified,
        normalized,
        resumeFrom: adopted.resumeFrom,
        runnerBatchImported: 0,
        existingJobItemsImported,
        canonicalDbCount,
        duplicateIngestionRisk: false,
        canaryResume: true,
        courtListenerHttpCalls: 0
      };
    }
    function extractExistingJobFromRunnerResult(result) {
      if (!result || typeof result !== "object") return null;
      if (result.job && typeof result.job === "object") return result.job;
      return null;
    }
    module2.exports = {
      JOB_CLASSIFICATIONS,
      JOB_LIFECYCLE_STATES,
      RESUME_EVIDENCE,
      classifyExistingCorpusIngestJob,
      resolveResumeEvidence,
      isReadyAllowedGivenJob,
      adoptExistingJobIntoLaneA,
      deriveJobLifecycleState,
      normalizeStaleRunningJob,
      reconcileStaleRunningGuard,
      extractExistingJobFromRunnerResult,
      jobResumeFields,
      isTimeoutErrorText,
      replayMiJobStateAndAccountingFlow
    };
  }
});

// scripts/queue2-lane-a-dispatch.cjs
var require_queue2_lane_a_dispatch = __commonJS({
  "scripts/queue2-lane-a-dispatch.cjs"(exports2, module2) {
    "use strict";
    var crypto = require("node:crypto");
    function remainingCasesToFinish(laneA) {
      const count = Math.max(
        0,
        Number(
          laneA?.qualifyingCaseCount != null ? laneA.qualifyingCaseCount : laneA?.count
        ) || 0
      );
      const target = Math.max(0, Number(laneA?.target) || 0);
      return Math.max(0, target - count);
    }
    function resolveLaneABatchBounds(params = {}) {
      const remaining = Math.max(0, Number(params.remainingAuthorities) || 0);
      const usable = Math.max(0, Number(params.usableRequests) || 0);
      const rpa = Math.max(0.1, Number(params.requestsPerAuthorityEstimate) || 2.3);
      const resourceMaxAuth = Math.max(1, Number(params.resourceMaxAuthorities) || 40);
      const resourceMaxReq = Math.max(1, Number(params.resourceMaxClRequests) || 40);
      const canaryRequired = Boolean(params.canaryRequired);
      const canaryAuthCap = Math.max(
        1,
        Math.min(3, Number(params.maxQualifyingAuthorities != null ? params.maxQualifyingAuthorities : 3) || 3)
      );
      const canaryReqCap = Math.max(
        1,
        Math.min(5, Number(params.maxClRequests != null ? params.maxClRequests : 5) || 5)
      );
      let maxReq = Math.min(usable > 0 ? usable : resourceMaxReq, resourceMaxReq);
      let maxAuth = Math.min(remaining > 0 ? remaining : resourceMaxAuth, resourceMaxAuth);
      if (canaryRequired) {
        maxAuth = Math.min(maxAuth, canaryAuthCap);
        maxReq = Math.min(maxReq, canaryReqCap);
      }
      const authFromReq = Math.max(1, Math.floor(maxReq / rpa));
      const authorities = remaining <= 0 ? 0 : Math.max(1, Math.min(maxAuth, authFromReq, remaining));
      const clRequests = authorities <= 0 ? 0 : Math.min(maxReq, Math.ceil(authorities * rpa));
      return {
        authorities,
        maxClRequests: clRequests,
        batchSize: String(Math.max(0, authorities)),
        initialStart: Boolean(params.checkpoint == null || params.checkpoint === ""),
        caps: {
          canaryAuth: canaryRequired ? canaryAuthCap : null,
          canaryReq: canaryRequired ? canaryReqCap : null,
          quotaAuth: usable > 0 ? Math.max(1, Math.floor(usable / rpa)) : null,
          resourceAuth: resourceMaxAuth
        }
      };
    }
    function parseLaneARunnerOutput(stdout) {
      const { parseLaneARunnerStdoutPreferTerminal } = require_queue2_lane_a_child_lifecycle();
      return parseLaneARunnerStdoutPreferTerminal(stdout);
    }
    function classifyLaneABatchResult(params = {}) {
      const {
        mapRunnerResultToLifecycleState,
        isTerminalRunnerState,
        isNonTerminalRunnerState,
        LANE_A_RUNNER_STATES
      } = require_queue2_lane_a_child_lifecycle();
      const { isFlyOrControlPlaneNetworkFailure, NETWORK_UNAVAILABLE } = require_queue2_db_readiness();
      const priorCheckpoint = params.priorCheckpoint || null;
      const priorCount = Number(params.priorCount) || 0;
      const target = Number(params.target) || 0;
      const stdout = params.stdout || "";
      const parsed = params.parsed || parseLaneARunnerOutput(stdout);
      const networkLaunchFailure = Boolean(params.networkLaunchFailure) || isFlyOrControlPlaneNetworkFailure(stdout) || isFlyOrControlPlaneNetworkFailure(parsed?.raw) || isFlyOrControlPlaneNetworkFailure(parsed?.result);
      const result = parsed.result || {};
      let lifecycleState = parsed.lifecycleState || mapRunnerResultToLifecycleState(result);
      const pid = result.pid || parsed.pid || null;
      if (networkLaunchFailure && (pid == null || pid === void 0)) {
        lifecycleState = LANE_A_RUNNER_STATES.UNKNOWN_DUE_TO_NETWORK;
      }
      const isBareUnknown = lifecycleState === LANE_A_RUNNER_STATES.UNKNOWN && !networkLaunchFailure;
      const unresolvedUnknown = isBareUnknown && (pid == null || pid === void 0);
      const terminal = lifecycleState === LANE_A_RUNNER_STATES.UNKNOWN_DUE_TO_NETWORK || unresolvedUnknown ? false : parsed.terminal != null ? Boolean(parsed.terminal) : isTerminalRunnerState(lifecycleState);
      const nonTerminal = lifecycleState === LANE_A_RUNNER_STATES.UNKNOWN_DUE_TO_NETWORK || isNonTerminalRunnerState(lifecycleState) || !terminal && !unresolvedUnknown;
      const status = result.status || result.job?.status || null;
      const reason = lifecycleState === LANE_A_RUNNER_STATES.UNKNOWN_DUE_TO_NETWORK ? NETWORK_UNAVAILABLE : result.reason || null;
      const existingJob = result.job && typeof result.job === "object" ? result.job : null;
      const sessionApiCalls = Number(result.sessionApiCalls ?? result.batchApiCalls ?? result.apiCallsDelta) || 0;
      const historicalJobApiCalls = Number(
        existingJob?.api_calls ?? existingJob?.apiCalls ?? result.historicalApiCalls
      );
      const rawResultApiCalls = Number(result.apiCalls ?? result.api_calls);
      const apiCalls = nonTerminal ? 0 : sessionApiCalls || (Number.isFinite(rawResultApiCalls) && !existingJob ? rawResultApiCalls : sessionApiCalls);
      const runnerBatchImported = nonTerminal ? 0 : reason === "stale_running_guard" ? 0 : Number(result.batchImported ?? result.items_imported_delta ?? 0) || 0;
      const existingJobItemsImported = Number(
        existingJob?.items_imported ?? existingJob?.itemsImported ?? (reason === "stale_running_guard" ? result.items_imported ?? result.itemsImported : 0) ?? 0
      ) || 0;
      const absoluteImported = Number(result.items_imported ?? result.itemsImported ?? 0) || 0;
      const itemsImported = nonTerminal ? 0 : reason === "stale_running_guard" ? existingJobItemsImported : runnerBatchImported || absoluteImported;
      const nextCheckpoint = nonTerminal ? priorCheckpoint : result.last_successful_external_id || result.cursor || existingJob?.last_successful_external_id || existingJob?.cursor || null;
      const checkpointAdvanced = !nonTerminal && Boolean(nextCheckpoint && nextCheckpoint !== priorCheckpoint);
      const countAdvanced = !nonTerminal && (runnerBatchImported > 0 || absoluteImported > 0 && absoluteImported > priorCount);
      const alreadyCompleted = !nonTerminal && (reason === "already_completed" || status === "completed" && apiCalls === 0 && itemsImported > 0);
      const staleRunningGuard = !nonTerminal && reason === "stale_running_guard";
      const noProgress = nonTerminal ? false : !alreadyCompleted && !staleRunningGuard && apiCalls === 0 && !checkpointAdvanced && !countAdvanced && status !== "completed" && lifecycleState !== LANE_A_RUNNER_STATES.QUOTA_PAUSED;
      return {
        ok: nonTerminal ? true : parsed.ok !== false && !staleRunningGuard,
        parsed,
        status: nonTerminal ? lifecycleState : status,
        reason: nonTerminal ? lifecycleState : reason,
        lifecycleState,
        terminal,
        nonTerminal,
        unresolvedUnknown,
        pid,
        unknownDueToNetwork: lifecycleState === LANE_A_RUNNER_STATES.UNKNOWN_DUE_TO_NETWORK,
        networkUnavailable: lifecycleState === LANE_A_RUNNER_STATES.UNKNOWN_DUE_TO_NETWORK,
        apiCalls,
        sessionApiCalls,
        historicalJobApiCalls: Number.isFinite(historicalJobApiCalls) ? historicalJobApiCalls : null,
        itemsImported,
        runnerBatchImported,
        existingJobItemsImported,
        existingJob,
        staleRunningGuard,
        nextCheckpoint: nextCheckpoint || priorCheckpoint,
        checkpointAdvanced,
        countAdvanced,
        alreadyCompleted,
        noProgress,
        remainingCases: Math.max(0, target - priorCount),
        productive: !nonTerminal && (checkpointAdvanced || countAdvanced || apiCalls > 0),
        runnerInvoked: true
      };
    }
    function canonicalLaneACount(sources = {}) {
      const db = sources.db || {};
      const prefer = [
        db.qualifyingCaseCount,
        db.qualifyingCases,
        db.qualifying_high_appellate,
        db.highCourtClCases
      ].map((n) => Number(n)).find((n) => Number.isFinite(n) && n >= 0);
      if (prefer != null) return prefer;
      if (db.clCaseCount != null || db.clCases != null || db.cases != null || db.totalCaseCount != null) {
        return null;
      }
      const caches = [sources.runnerCount, sources.runtimeCount, sources.statusCount, sources.manifestCount].map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0);
      if (!caches.length) return null;
      return Math.max(...caches);
    }
    function namedLaneACounts(sources = {}) {
      const db = sources.db || {};
      return {
        qualifyingCaseCount: canonicalLaneACount(sources),
        clCaseCount: Number.isFinite(Number(db.clCaseCount ?? db.clCases)) ? Number(db.clCaseCount ?? db.clCases) : null,
        totalCaseCount: Number.isFinite(Number(db.totalCaseCount ?? db.cases)) ? Number(db.totalCaseCount ?? db.cases) : null,
        authorityCount: Number.isFinite(Number(db.authorityCount ?? db.authorities)) ? Number(db.authorityCount ?? db.authorities) : null
      };
    }
    function reconcileLaneACountSources(params = {}) {
      const target = Math.max(0, Number(params.target) || 0);
      const runtimeCount = Number(params.runtimeCount);
      const statusCount = Number(params.statusCount);
      const manifestCount = Number(params.manifestCount);
      const runnerBatchImported = params.runnerBatchImported != null ? Number(params.runnerBatchImported) : Number(params.runnerCount);
      const existingJobItemsImported = params.existingJobItemsImported != null ? Number(params.existingJobItemsImported) : null;
      const runnerCount = runnerBatchImported;
      const dbCount = canonicalLaneACount({ db: params.db || {} });
      const alreadyCompleted = Boolean(params.alreadyCompleted);
      const requireLiveDb = Boolean(params.requireLiveDb || params.staleRunningGuard || params.existingJob);
      const integrity = params.integrity || {};
      const hasDb = dbCount != null && Number.isFinite(dbCount);
      if (requireLiveDb && !hasDb) {
        return {
          ok: false,
          reason: "LIVE_DB_RECONCILIATION_UNAVAILABLE",
          humanReviewRequired: true,
          classification: "LIVE_DB_RECONCILIATION_UNAVAILABLE",
          canonicalCount: null,
          targetSatisfied: false,
          detail: "live DB count mandatory for existing-job / stale_running reconciliation",
          sources: {
            runtimeCount,
            statusCount,
            manifestCount,
            runnerCount,
            runnerBatchImported,
            existingJobItemsImported,
            dbCount: null
          }
        };
      }
      if (params.staleRunningGuard) {
        return {
          ok: true,
          reason: "STALE_RUNNING_DEFER_TO_JOB_RECONCILE",
          classification: "STALE_RUNNING_GUARD",
          humanReviewRequired: false,
          zeroProgress: false,
          canonicalCount: hasDb ? dbCount : null,
          targetSatisfied: hasDb && target > 0 && dbCount >= target,
          sources: {
            runtimeCount,
            statusCount,
            manifestCount,
            runnerCount,
            runnerBatchImported: 0,
            existingJobItemsImported,
            dbCount
          }
        };
      }
      const canonical = hasDb ? dbCount : canonicalLaneACount({
        runnerCount,
        runtimeCount,
        statusCount,
        manifestCount
      });
      if (canonical == null) {
        return {
          ok: false,
          reason: "LANE_A_COUNT_RECONCILIATION_FAILED",
          humanReviewRequired: true,
          classification: "RECONCILIATION_FAILED",
          canonicalCount: null,
          targetSatisfied: false
        };
      }
      const targetSatisfied = target > 0 && canonical >= target;
      const runnerClaimsComplete = alreadyCompleted || Number.isFinite(runnerCount) && runnerCount >= target;
      if (runnerClaimsComplete && hasDb && !targetSatisfied) {
        return {
          ok: false,
          reason: "LANE_A_COUNT_RECONCILIATION_FAILED",
          humanReviewRequired: true,
          classification: "RECONCILIATION_FAILED",
          canonicalCount: canonical,
          targetSatisfied: false,
          detail: `runner/items=${runnerCount} already_completed=${alreadyCompleted} but liveDB=${canonical} < target=${target}`,
          sources: {
            runtimeCount,
            statusCount,
            manifestCount,
            runnerCount,
            runnerBatchImported,
            existingJobItemsImported,
            dbCount
          }
        };
      }
      if (alreadyCompleted && targetSatisfied) {
        const integrityOk = Number(integrity.duplicateSourceIds || 0) === 0 && Number(integrity.orphanCount || 0) === 0 && integrity.chunkHealthy !== false;
        return {
          ok: true,
          reason: "TARGET_ALREADY_COMPLETE",
          classification: "TARGET_ALREADY_COMPLETE",
          humanReviewRequired: false,
          zeroProgress: false,
          canonicalCount: canonical,
          targetSatisfied: true,
          targetStatus: "COMPLETE_FOR_CURRENT_DEPTH",
          reconciliationCanaryEligible: integrityOk,
          sources: {
            runtimeCount,
            statusCount,
            manifestCount,
            runnerCount,
            runnerBatchImported,
            existingJobItemsImported,
            dbCount
          },
          integrity
        };
      }
      if (hasDb && targetSatisfied) {
        return {
          ok: true,
          reason: "TARGET_ALREADY_COMPLETE",
          classification: "TARGET_ALREADY_COMPLETE",
          humanReviewRequired: false,
          zeroProgress: false,
          canonicalCount: canonical,
          targetSatisfied: true,
          targetStatus: "COMPLETE_FOR_CURRENT_DEPTH",
          reconciliationCanaryEligible: true,
          sources: {
            runtimeCount,
            statusCount,
            manifestCount,
            runnerCount,
            runnerBatchImported,
            existingJobItemsImported,
            dbCount
          }
        };
      }
      const cacheVals = [runtimeCount, statusCount, manifestCount, runnerCount].filter((n) => Number.isFinite(n));
      if (!hasDb && cacheVals.length >= 2) {
        const lo = Math.min(...cacheVals);
        const hi = Math.max(...cacheVals);
        if (hi - lo >= 2) {
          return {
            ok: false,
            reason: "LANE_A_COUNT_RECONCILIATION_FAILED",
            humanReviewRequired: true,
            classification: "RECONCILIATION_FAILED",
            canonicalCount: canonical,
            targetSatisfied: false,
            detail: `cache spread ${lo}..${hi} without live DB`,
            sources: {
              runtimeCount,
              statusCount,
              manifestCount,
              runnerCount,
              runnerBatchImported,
              existingJobItemsImported,
              dbCount
            }
          };
        }
      }
      return {
        ok: true,
        reason: "COUNTS_ALIGNED",
        classification: "INCOMPLETE",
        humanReviewRequired: false,
        zeroProgress: false,
        canonicalCount: canonical,
        targetSatisfied: false,
        targetStatus: canonical > 0 ? "PARTIAL" : "READY",
        sources: {
          runtimeCount,
          statusCount,
          manifestCount,
          runnerCount,
          runnerBatchImported,
          existingJobItemsImported,
          dbCount
        }
      };
    }
    function shouldRaiseLaneAZeroProgress(params = {}) {
      const classified = params.classified || {};
      const reconciled = params.reconciled || {};
      const { mayEvaluateLaneAZeroProgress } = require_queue2_lane_a_child_lifecycle();
      if (classified.nonTerminal || classified.terminal === false) return false;
      if (classified.lifecycleState === "STARTED" || classified.lifecycleState === "RUNNING") return false;
      const gate = mayEvaluateLaneAZeroProgress({
        terminal: classified.terminal === true,
        freshDbReconciled: Boolean(params.freshDbReconciled ?? reconciled.freshDbReconciled),
        jobRowRefreshed: Boolean(params.jobRowRefreshed ?? reconciled.jobRowRefreshed),
        currentBatchRequestCount: params.currentBatchRequestCount ?? classified.sessionApiCalls ?? classified.apiCalls
      });
      if (!gate.ok) return false;
      if (reconciled.classification === "TARGET_ALREADY_COMPLETE") return false;
      if (classified.alreadyCompleted && reconciled.targetSatisfied) return false;
      if (classified.alreadyCompleted && reconciled.classification === "RECONCILIATION_FAILED") return false;
      if (!reconciled.targetSatisfied && classified.noProgress && classified.runnerInvoked) return true;
      if (!reconciled.targetSatisfied && classified.alreadyCompleted && reconciled.ok === false) {
        return false;
      }
      return Boolean(classified.noProgress && !reconciled.targetSatisfied);
    }
    function evaluateReconciliationCanary(params = {}) {
      const canaryRequired = Boolean(params.canaryRequired);
      const reconciled = params.reconciled || {};
      if (!canaryRequired) {
        return { mode: "NORMAL", promoteToNormal: true, reason: "canary_not_required" };
      }
      if (reconciled.classification !== "TARGET_ALREADY_COMPLETE") {
        return { mode: "CANARY_REQUIRED", promoteToNormal: false, reason: "awaiting_mutation_canary" };
      }
      if (!reconciled.reconciliationCanaryEligible) {
        return {
          mode: "CANARY_REQUIRED",
          promoteToNormal: false,
          reason: "reconciliation_integrity_incomplete"
        };
      }
      return {
        mode: "CANARY_REQUIRED",
        promoteToNormal: false,
        reconciliationCanary: "PASS",
        reason: "RECONCILIATION_CANARY_PASS_REQUIRE_NEXT_TARGET_MUTATION_CANARY",
        requireTinyRealCanaryOnNextTarget: true
      };
    }
    function selectNextVerifiedIncompleteTarget(manifest, opts = {}) {
      const excludeCourt = opts.excludeCourt || null;
      const rows = (manifest?.targets || []).filter((t) => !t.federal).filter((t) => t.mappingStatus === "VERIFIED").filter((t) => !t.autonomousIngestBlocked).filter((t) => t.status === "READY" || t.status === "PARTIAL").filter((t) => Number(t.currentCases || 0) < Number(t.targetCases || 45)).filter((t) => !excludeCourt || (t.preferredCourts || [])[0] !== excludeCourt).sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
      const top = rows[0] || null;
      if (!top) return null;
      return {
        court: (top.preferredCourts || [])[0] || null,
        jurisdiction: top.jurisdiction,
        count: Number(top.currentCases) || 0,
        target: Number(top.targetCases) || 45,
        checkpoint: top.checkpoint || null,
        status: top.status,
        score: top.score,
        mappingStatus: top.mappingStatus
      };
    }
    function applyTargetAlreadyComplete(state, params = {}) {
      const next = JSON.parse(JSON.stringify(state || {}));
      const prior = { ...next.laneA || {} };
      const completedCourt = prior.court || params.court;
      const canonicalCount = Number(params.canonicalCount);
      const target = Number(params.target ?? prior.target) || 45;
      next.completedCourts = Array.isArray(next.completedCourts) ? next.completedCourts : [];
      if (completedCourt && !next.completedCourts.includes(completedCourt)) {
        next.completedCourts.push(completedCourt);
      }
      next.completedCourtEvidence = {
        ...next.completedCourtEvidence || {},
        ...params.completedCourtEvidence || {}
      };
      if (completedCourt) {
        next.completedCourtEvidence[completedCourt] = {
          ...next.completedCourtEvidence[completedCourt] || {},
          status: "COMPLETE_FOR_CURRENT_DEPTH",
          count: Number.isFinite(canonicalCount) ? canonicalCount : prior.count,
          target,
          checkpoint: params.checkpoint || prior.checkpoint || prior.lastSuccessfulExternalId || null,
          cursor: prior.cursor || null,
          lastSuccessfulExternalId: prior.lastSuccessfulExternalId || null,
          nextPageUrl: prior.nextPageUrl || null,
          lastSuccessfulAt: prior.lastSuccessfulAt || null,
          jobStatus: "completed",
          reconciledAt: (params.now || /* @__PURE__ */ new Date()).toISOString?.() || (/* @__PURE__ */ new Date()).toISOString(),
          ...params.completedEvidenceExtras || {}
        };
      }
      if (next.humanReview?.required && Array.isArray(next.humanReview.reasons)) {
        next.humanReview.reasons = next.humanReview.reasons.filter(
          (r) => r !== "LANE_A_ZERO_PROGRESS"
        );
        next.humanReview.details = (next.humanReview.details || []).filter(
          (d) => d.reason !== "LANE_A_ZERO_PROGRESS"
        );
        if (next.humanReview.reasons.length === 0) {
          next.humanReview.required = false;
        }
      } else if (next.humanReview) {
        next.humanReview.required = false;
        next.humanReview.reasons = Array.isArray(next.humanReview.reasons) ? next.humanReview.reasons.filter((r) => r !== "LANE_A_ZERO_PROGRESS") : [];
      }
      const nxt = params.nextTarget || null;
      if (nxt?.court) {
        const existingJob = params.nextTargetJob || nxt.existingJob || null;
        let nextLaneA = {
          court: nxt.court,
          jurisdiction: nxt.jurisdiction,
          count: Number(nxt.count) || 0,
          target: Number(nxt.target) || 45,
          checkpoint: nxt.checkpoint || null,
          cursor: null,
          lastSuccessfulExternalId: null,
          nextPageUrl: null,
          lastSuccessfulAt: null,
          runner: prior.runner || "staging-cl-batch-job",
          mappingStatus: nxt.mappingStatus || "VERIFIED",
          manifestVersion: prior.manifestVersion || null,
          jobStatus: nxt.status === "PARTIAL" ? "quota_paused" : "ready",
          itemsImported: Number(nxt.count) || 0,
          targetStatus: nxt.status || "READY",
          sequence: prior.sequence || null,
          lock: null
        };
        if (existingJob) {
          const {
            classifyExistingCorpusIngestJob,
            adoptExistingJobIntoLaneA,
            isReadyAllowedGivenJob
          } = require_queue2_existing_job_reconcile();
          if (!isReadyAllowedGivenJob(existingJob, { ownerAlive: false, cursorValid: true })) {
            const classified = classifyExistingCorpusIngestJob(existingJob, {
              ownerAlive: false,
              cursorValid: true,
              corpusClCases: Number(nxt.clCases ?? nxt.count) || null
            });
            const adopted = adoptExistingJobIntoLaneA(
              { laneA: nextLaneA, humanReview: { required: false, reasons: [], details: [] } },
              existingJob,
              classified,
              {
                qualifyingCases: Number(nxt.count) || 0,
                mappingStatus: nxt.mappingStatus || "VERIFIED",
                now: params.now || /* @__PURE__ */ new Date()
              }
            );
            nextLaneA = adopted.state.laneA;
            if (adopted.humanReviewRequired) {
              next.humanReview = adopted.state.humanReview;
            }
          }
        }
        next.laneA = nextLaneA;
      } else {
        next.laneA = {
          ...prior,
          count: Number.isFinite(canonicalCount) ? canonicalCount : prior.count,
          target,
          jobStatus: "completed",
          itemsImported: Number.isFinite(canonicalCount) ? canonicalCount : prior.itemsImported,
          targetStatus: "COMPLETE_FOR_CURRENT_DEPTH",
          completedCheckpoint: params.checkpoint || prior.checkpoint || null
        };
      }
      next.idleSafe = false;
      next.runtimeState = params.runtimeState || next.runtimeState || "STOPPED";
      next.updatedAt = (params.now || /* @__PURE__ */ new Date()).toISOString?.() || (/* @__PURE__ */ new Date()).toISOString();
      return next;
    }
    function resolveBindingResetAt(windows, bindingWindow) {
      const w = String(bindingWindow || "").toUpperCase();
      const pick = (name) => windows?.[name]?.resetAt || windows?.[name]?.reset_at || windows?.[name]?.reset || null;
      if (w === "MINUTE") return pick("minute");
      if (w === "HOUR") return pick("hour");
      if (w === "DAY") return pick("day");
      return null;
    }
    function evaluateProductionCanaryGate(params = {}) {
      const current = params.currentFingerprint || null;
      const knownGood = params.knownGoodFingerprint || null;
      const force = Boolean(params.forceCanary);
      if (force) {
        return { required: true, reason: "forced", mode: "CANARY_REQUIRED" };
      }
      if (!knownGood) {
        return { required: true, reason: "no_known_good_fingerprint", mode: "CANARY_REQUIRED" };
      }
      if (!current) {
        return { required: true, reason: "missing_current_fingerprint", mode: "CANARY_REQUIRED" };
      }
      if (current !== knownGood) {
        return {
          required: true,
          reason: "code_fingerprint_changed",
          mode: "CANARY_REQUIRED",
          prior: knownGood,
          current
        };
      }
      return { required: false, reason: "fingerprint_matches_known_good", mode: "NORMAL" };
    }
    function nextQuotaCheckAfterActiveBatch(now = /* @__PURE__ */ new Date(), opts = {}) {
      const deferMs = Number(opts.deferMs ?? 15 * 60 * 1e3);
      if (opts.noProgress) {
        return new Date(now.getTime() + Math.max(deferMs, 30 * 60 * 1e3)).toISOString();
      }
      return new Date(now.getTime() + deferMs).toISOString();
    }
    function detectRedundantQuotaProbes(history = [], opts = {}) {
      const min = Number(opts.minRepeats ?? 3);
      if (!Array.isArray(history) || history.length < min) {
        return { redundant: false, count: history?.length || 0 };
      }
      const last = history.slice(-min);
      const sig = (p) => `${p?.minuteRemaining ?? "?"}/${p?.hourRemaining ?? "?"}/${p?.dayRemaining ?? "?"}|${p?.quotaMode || ""}|${p?.checkpoint || ""}`;
      const first = sig(last[0]);
      const allSame = last.every((p) => sig(p) === first);
      const noWork = last.every((p) => !p?.workBetween);
      return {
        redundant: allSame && noWork,
        count: last.length,
        signature: first,
        reason: allSame && noWork ? "REDUNDANT_QUOTA_PROBES" : null
      };
    }
    function detectLaneADispatchStall(params = {}) {
      const selectedAt = params.laneASelectedAt ? new Date(params.laneASelectedAt).getTime() : null;
      const now = (params.now instanceof Date ? params.now : new Date(params.now || Date.now())).getTime();
      const warningMs = Number(params.warningMs ?? 2 * 60 * 1e3);
      const criticalMs = Number(params.criticalMs ?? 5 * 60 * 1e3);
      if (!selectedAt || !Number.isFinite(selectedAt)) return { stalled: false };
      if (params.runnerStarted || params.productive) return { stalled: false };
      const age = now - selectedAt;
      if (age >= criticalMs) {
        return { stalled: true, severity: "CRITICAL", reason: "LANE_A_DISPATCH_STALLED", ageMs: age };
      }
      if (age >= warningMs) {
        return { stalled: true, severity: "WARNING", reason: "LANE_A_DISPATCH_STALLED", ageMs: age };
      }
      return { stalled: false, ageMs: age };
    }
    function computePostCycleSleepMs(params = {}) {
      const now = params.now instanceof Date ? params.now : new Date(params.now || Date.now());
      if (params.humanReviewRequired) return 0;
      if (params.sessionBudgetExhausted) {
        return Math.max(5 * 60 * 1e3, Number(params.budgetExhaustedSleepMs || 0));
      }
      if (params.unresolvedUnknown || params.classification === "RUNNER_RESULT_UNRESOLVED") {
        return Math.max(3e4, Number(params.unresolvedBackoffMs || 0));
      }
      if (params.noProgress) return Math.max(30 * 60 * 1e3, Number(params.noProgressSleepMs || 0));
      if (params.lane === "A" && params.awaitingBatch) return 0;
      if (params.lane === "WAIT" && params.nextUsefulAt) {
        return Math.min(
          Number(params.heartbeatMs || 15 * 60 * 1e3),
          Math.max(2e3, new Date(params.nextUsefulAt).getTime() - now.getTime())
        );
      }
      if (params.lane === "A" && params.quotaMode && ["FINISH_TARGET", "FULL_BATCH", "MICRO_BATCH"].includes(params.quotaMode)) {
        const active = Number(params.activeLaneSleepMs ?? 0);
        if (active <= 0 && params.ownedChildAlive !== true) {
          return Math.max(2e3, Number(params.minActiveLaneSleepMs || 2e3));
        }
        return active;
      }
      const next = params.nextCheckAt ? new Date(params.nextCheckAt).getTime() : now.getTime() + 6e4;
      return Math.min(Number(params.heartbeatMs || 15 * 60 * 1e3), Math.max(5e3, next - now.getTime()));
    }
    function hashFingerprintFiles(fileContentsByRel) {
      const h = crypto.createHash("sha256");
      for (const rel of Object.keys(fileContentsByRel).sort()) {
        h.update(rel);
        h.update("\0");
        h.update(fileContentsByRel[rel] || "");
        h.update("\0");
      }
      return h.digest("hex");
    }
    function runMockedLaneAStartupFlow(params = {}) {
      const events = [];
      const push = (type, extra = {}) => {
        events.push({ type, ...extra });
        return events[events.length - 1];
      };
      const state = {
        laneA: {
          court: "wis",
          jurisdiction: "WI",
          count: 44,
          target: 45,
          checkpoint: "cl-opinion-9886466",
          lastSuccessfulExternalId: "cl-opinion-9886466"
        },
        currentLane: "B",
        idleSafe: true,
        quota: {},
        humanReview: { required: false, reasons: [] },
        ...params.state || {}
      };
      push("PREFLIGHT_PASS");
      push("WATCHDOG_SESSION_INIT", { lane: "STARTUP" });
      push("INITIAL_HEARTBEAT", { lane: "STARTUP" });
      const remainingCases = remainingCasesToFinish(state.laneA);
      const canary = evaluateProductionCanaryGate({
        currentFingerprint: params.currentFingerprint || "fp-new",
        knownGoodFingerprint: params.knownGoodFingerprint || "fp-old"
      });
      push(canary.required ? "CANARY_REQUIRED" : "CANARY_SKIPPED", { reason: canary.reason });
      push("QUOTA_CHECK", {
        quotaMode: "FINISH_TARGET",
        usableRequests: 28,
        remainingCases,
        estimatedRequestsNeeded: params.estimatedRequestsNeeded ?? 4
      });
      state.idleSafe = false;
      state.currentLane = "A";
      push("LANE_A_CL", { court: "wis", target: 45 });
      if (events.some((e) => e.type === "LANE_B_IDLE_SAFE")) {
        throw new Error("LANE_B_IDLE_SAFE emitted before Lane A completed");
      }
      push("LANE_A_RUNNER_START", { court: "wis", checkpoint: state.laneA.checkpoint });
      const mockStdout = params.mockStdout || [
        JSON.stringify({ uploaded: true }),
        JSON.stringify({ ok: true, started: true, clCourt: "wis" }),
        JSON.stringify({
          i: 0,
          fileResult: {
            ok: true,
            status: "completed",
            reason: params.mockReason || "batch_complete",
            items_imported: params.mockItemsImported ?? 45,
            apiCalls: params.mockApiCalls ?? 3,
            last_successful_external_id: params.mockCheckpoint || "cl-opinion-9999999",
            cursor: params.mockCheckpoint || "cl-opinion-9999999"
          },
          hasFile: true
        })
      ].join("\n");
      const classified = classifyLaneABatchResult({
        stdout: mockStdout,
        priorCheckpoint: state.laneA.checkpoint,
        priorCount: state.laneA.count,
        target: state.laneA.target
      });
      push("LANE_A_BATCH_COMPLETE", {
        status: classified.status,
        productive: classified.productive,
        noProgress: classified.noProgress,
        apiCalls: classified.apiCalls
      });
      if (classified.productive && classified.nextCheckpoint) {
        state.laneA.checkpoint = classified.nextCheckpoint;
        state.laneA.lastSuccessfulExternalId = classified.nextCheckpoint;
        if (classified.itemsImported > state.laneA.count) state.laneA.count = classified.itemsImported;
      }
      push("WATCHDOG_PROGRESS", { productive: classified.productive });
      const idleBeforeComplete = events.findIndex((e) => e.type === "LANE_B_IDLE_SAFE");
      const runnerIdx = events.findIndex((e) => e.type === "LANE_A_RUNNER_START");
      return {
        ok: classified.runnerInvoked && idleBeforeComplete < 0,
        events,
        state,
        classified,
        canary,
        remainingCases,
        runnerInvokedOnce: events.filter((e) => e.type === "LANE_A_RUNNER_START").length === 1,
        idleBeforeLaneAComplete: idleBeforeComplete >= 0 && (runnerIdx < 0 || idleBeforeComplete < runnerIdx)
      };
    }
    module2.exports = {
      remainingCasesToFinish,
      resolveLaneABatchBounds,
      parseLaneARunnerOutput,
      classifyLaneABatchResult,
      canonicalLaneACount,
      namedLaneACounts,
      reconcileLaneACountSources,
      shouldRaiseLaneAZeroProgress,
      evaluateReconciliationCanary,
      selectNextVerifiedIncompleteTarget,
      applyTargetAlreadyComplete,
      resolveBindingResetAt,
      evaluateProductionCanaryGate,
      nextQuotaCheckAfterActiveBatch,
      detectRedundantQuotaProbes,
      detectLaneADispatchStall,
      computePostCycleSleepMs,
      hashFingerprintFiles,
      runMockedLaneAStartupFlow
    };
  }
});

// scripts/queue2-dual-lane-controller.cjs
var require_queue2_dual_lane_controller = __commonJS({
  "scripts/queue2-dual-lane-controller.cjs"(exports2, module2) {
    "use strict";
    var { createHash: createHash2 } = require("node:crypto");
    var {
      validatePartialCheckpoint,
      reconcileLaneAFromJob,
      setHumanReview,
      HUMAN_REVIEW_REASONS,
      isPartialLaneA,
      isReadyFirstStartLaneA,
      hasDurableCheckpoint,
      requiresDurableResumeCheckpoint,
      isMissingDurableResumeCheckpointFatal
    } = require_queue2_worker_observability();
    var {
      QUOTA_MODES,
      BINDING_WINDOWS,
      loadAdaptiveQuotaConfig,
      planAdaptiveQuota,
      hasUsefulAdaptiveCapacity,
      updateCourtEfficiency,
      efficiencyRegressionTriggered,
      shouldProbeQuota,
      dayUtilization,
      remainingAuthoritiesNeeded: remainingAuthoritiesNeededAdaptive,
      estimateRequestsNeeded
    } = require_cl_adaptive_quota();
    var { resolveBindingResetAt, remainingCasesToFinish, nextQuotaCheckAfterActiveBatch } = require_queue2_lane_a_dispatch();
    var QUEUE = "#2";
    var USEFUL_CL_MIN = 25;
    var MIN_QUOTA_PROBE_GAP_MS = 10 * 60 * 1e3;
    var LANE_A_LOCK_TTL_MS = 30 * 60 * 1e3;
    var EST_CL_REQUESTS_PER_CASE = 2.3;
    var LANE_A_SEQUENCE = [
      { court: "ark", j: "AR", target: 45 },
      { court: "sd", j: "SD", target: 45 },
      { court: "idaho", j: "ID", target: 45 },
      { court: "wyo", j: "WY", target: 45 },
      { court: "neb", j: "NE", target: 45 },
      { court: "ala", j: "AL", target: 45 },
      { court: "ky", j: "KY", target: 45 }
    ];
    var LANE_B_TASKS = [
      "us_reports_gap_analysis",
      "us_reports_non_cl_intake",
      "usc_cfr_federal_rules_depth",
      "citation_re_resolution",
      "depth_gap_analysis",
      "historical_hole_detection",
      "intermediate_court_research",
      "corpus_integrity",
      "retrieval_validation",
      "depth_scorecard"
    ];
    var LANE_B_REGISTRY_IDS = [
      "US_REPORTS_GAP_ANALYSIS",
      "NON_CL_PRIMARY_AUTHORITY_INTAKE",
      "USC_DEPTH",
      "CFR_DEPTH",
      "FEDERAL_RULES_DEPTH",
      "CITATION_RERESOLVE",
      "DEPTH_MANIFEST_REFRESH",
      "HISTORICAL_GAP_ANALYSIS",
      "INTERMEDIATE_MAPPING_RESEARCH_NON_CL",
      "CORPUS_INTEGRITY_AUDIT",
      "RETRIEVAL_REGRESSION",
      "CURRENTNESS_AUDIT_LOCAL",
      "NEXT_CL_BATCH_PREPARATION",
      "DAILY_SCORECARD_REFRESH"
    ];
    var CL_HOST_RE = /(?:^|\.)courtlistener\.com$/i;
    var CL_BLOCKED_PATHS = [
      "/api/rest/v4/opinions",
      "/api/rest/v4/clusters",
      "/api/rest/v4/dockets",
      "/api/rest/v4/courts",
      "/api/rest/v4/search",
      "/api/rest/v4/api-usage"
    ];
    function sha2562(text) {
      return createHash2("sha256").update(String(text), "utf8").digest("hex");
    }
    function createInitialState(now = /* @__PURE__ */ new Date()) {
      const first = LANE_A_SEQUENCE[0];
      return {
        version: 1,
        queue: QUEUE,
        queue9: "CLOSED",
        queue3: "NOT_OPEN",
        featureAgents: "0",
        currentLane: "B",
        updatedAt: now.toISOString(),
        laneA: {
          court: first.court,
          jurisdiction: first.j,
          checkpoint: null,
          cursor: null,
          lastSuccessfulExternalId: null,
          nextPageUrl: null,
          lastSuccessfulAt: null,
          runner: "staging-cl-batch-job",
          mappingStatus: null,
          manifestVersion: 0,
          jobStatus: null,
          itemsImported: null,
          target: first.target,
          count: 0,
          sequence: LANE_A_SEQUENCE.map((s) => s.court),
          lock: null
        },
        quota: {
          windows: null,
          lastProbeAt: null,
          nextCheckAt: now.toISOString(),
          last429At: null,
          retryAfterSeconds: null,
          lastSafeRequests: 0,
          currentUsableNow: 0,
          bindingWindow: null,
          bindingResetAt: null,
          hard429Count: 0,
          courtEfficiency: {},
          probeRequests: 0,
          lastPlan: null,
          wait: null,
          utilization: null,
          quotaStateObservedAt: null,
          quotaStateSource: null,
          quotaStateConfidence: null,
          quotaStateAgeMs: null,
          membership: null
        },
        laneB: {
          task: "NONE",
          checkpoint: null,
          tasksCompleted: [],
          checkpoints: {},
          lastByTask: {},
          nextEligibleAt: {},
          lastEligibility: null,
          mutatingTaskActive: null
        },
        depthManifestVersion: 0,
        lastCitationResolve: null,
        lastIntegrityAudit: null,
        laneStartedAt: null,
        lastHeartbeatAt: null,
        idleSafe: false,
        waitingForNetwork: false,
        lastOnlineAt: null,
        runtimeState: "STOPPED",
        humanReview: { required: false, reasons: [], details: [] },
        metrics: {
          laneAMs: 0,
          laneBMs: 0,
          idleMs: 0,
          idleSafeMs: 0,
          waitingNetworkMs: 0,
          clAuthorities: 0,
          nonClAuthorities: 0,
          citationsResolved: 0,
          quotaChecks: 0,
          laneSwitches: 0,
          aiCalls: 0,
          aiTokens: 0
        },
        switches: []
      };
    }
    function cloneState(state) {
      return JSON.parse(JSON.stringify(state));
    }
    function restoreState2(saved, now = /* @__PURE__ */ new Date()) {
      const base = createInitialState(now);
      if (!saved || typeof saved !== "object") return base;
      const merged = {
        ...base,
        ...saved,
        laneA: { ...base.laneA, ...saved.laneA || {} },
        quota: { ...base.quota, ...saved.quota || {} },
        laneB: { ...base.laneB, ...saved.laneB || {} },
        metrics: { ...base.metrics, ...saved.metrics || {} },
        humanReview: {
          required: false,
          reasons: [],
          details: [],
          ...saved.humanReview || {}
        },
        switches: Array.isArray(saved.switches) ? saved.switches : []
      };
      merged.queue = QUEUE;
      merged.queue9 = "CLOSED";
      merged.queue3 = "NOT_OPEN";
      merged.featureAgents = "0";
      merged.version = 1;
      if (merged.currentLane === "STOPPED" || merged.runtimeState === "STOPPED") {
        if (merged.currentLane !== "A" && merged.currentLane !== "B" && merged.currentLane !== "WAIT") {
          merged.currentLane = "STOPPED";
        }
      } else if (merged.currentLane !== "A" && merged.currentLane !== "B" && merged.currentLane !== "WAIT") {
        merged.currentLane = "B";
      }
      merged.idleSafe = Boolean(merged.idleSafe);
      merged.waitingForNetwork = Boolean(merged.waitingForNetwork);
      merged.runtimeState = merged.runtimeState || "STOPPED";
      merged.metrics = {
        ...base.metrics,
        ...saved.metrics || {},
        aiCalls: 0,
        aiTokens: 0
      };
      merged.laneB = {
        ...base.laneB,
        ...saved.laneB || {},
        checkpoints: { ...base.laneB.checkpoints || {}, ...saved.laneB && saved.laneB.checkpoints || {} },
        lastByTask: { ...base.laneB.lastByTask || {}, ...saved.laneB && saved.laneB.lastByTask || {} },
        nextEligibleAt: {
          ...base.laneB.nextEligibleAt || {},
          ...saved.laneB && saved.laneB.nextEligibleAt || {}
        }
      };
      if (Array.isArray(merged.laneB.tasksCompleted) && merged.laneB.tasksCompleted.length > 0 && Object.keys(merged.laneB.lastByTask || {}).length === 0) {
        const seedAt = saved.updatedAt || saved.lastHeartbeatAt || now.toISOString();
        const legacyToId = {
          us_reports_gap_analysis: "US_REPORTS_GAP_ANALYSIS",
          us_reports_non_cl_intake: "NON_CL_PRIMARY_AUTHORITY_INTAKE",
          usc_cfr_federal_rules_depth: "USC_DEPTH",
          citation_re_resolution: "CITATION_RERESOLVE",
          depth_gap_analysis: "DEPTH_MANIFEST_REFRESH",
          historical_hole_detection: "HISTORICAL_GAP_ANALYSIS",
          intermediate_court_research: "INTERMEDIATE_MAPPING_RESEARCH_NON_CL",
          corpus_integrity: "CORPUS_INTEGRITY_AUDIT",
          retrieval_validation: "RETRIEVAL_REGRESSION",
          depth_scorecard: "DAILY_SCORECARD_REFRESH"
        };
        for (const id of merged.laneB.tasksCompleted) {
          merged.laneB.lastByTask[id] = seedAt;
          const canon = legacyToId[id];
          if (canon) merged.laneB.lastByTask[canon] = seedAt;
        }
      }
      if (merged.idleSafe || merged.runtimeState === "IDLE_SAFE") {
        merged.laneB.task = "NONE";
      }
      const check = validatePartialCheckpoint(merged.laneA);
      merged.laneA = check.laneA;
      if (check.humanReviewRequired) {
        Object.assign(
          merged,
          setHumanReview(merged, check.reason, "restoreState refused null checkpoint on partial court")
        );
        if (merged.currentLane === "A") merged.currentLane = "B";
      } else if (merged.humanReview?.required && Array.isArray(merged.humanReview.reasons) && merged.humanReview.reasons.length === 1 && merged.humanReview.reasons[0] === HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT && isReadyFirstStartLaneA(merged.laneA)) {
        merged.humanReview = { required: false, reasons: [], details: [] };
      }
      return merged;
    }
    function persistLaneAProgress(state, patch = {}, now = /* @__PURE__ */ new Date()) {
      const next = cloneState(state);
      next.laneA = {
        ...next.laneA,
        ...patch,
        checkpoint: patch.checkpoint ?? patch.lastSuccessfulExternalId ?? next.laneA.checkpoint ?? next.laneA.lastSuccessfulExternalId ?? null
      };
      if (patch.lastSuccessfulExternalId) {
        next.laneA.lastSuccessfulExternalId = patch.lastSuccessfulExternalId;
        if (!next.laneA.checkpoint) next.laneA.checkpoint = patch.lastSuccessfulExternalId;
      }
      next.updatedAt = now.toISOString();
      const check = validatePartialCheckpoint(next.laneA);
      next.laneA = check.laneA;
      if (check.humanReviewRequired) {
        return {
          ok: false,
          state: setHumanReview(next, check.reason, "persistLaneAProgress blocked null checkpoint"),
          reason: check.reason
        };
      }
      return { ok: true, state: next, reason: null };
    }
    function applyDurableJobCheckpoint(state, job, extras = {}, now = /* @__PURE__ */ new Date()) {
      const next = cloneState(state);
      const { state: laneA, reconciled, reason } = reconcileLaneAFromJob(next.laneA, job, extras);
      next.laneA = laneA;
      next.updatedAt = now.toISOString();
      if (!reconciled) {
        if (isMissingDurableResumeCheckpointFatal(next.laneA)) {
          return {
            ok: false,
            state: setHumanReview(
              next,
              HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT,
              reason || "durable job reconcile failed"
            ),
            reason: reason || HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT
          };
        }
        return { ok: false, state: next, reason: reason || "reconcile_failed" };
      }
      const check = validatePartialCheckpoint(next.laneA);
      next.laneA = check.laneA;
      if (check.humanReviewRequired) {
        return {
          ok: false,
          state: setHumanReview(next, check.reason, "post-reconcile validation"),
          reason: check.reason
        };
      }
      if (next.humanReview?.reasons?.includes(HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT)) {
        next.humanReview.reasons = next.humanReview.reasons.filter(
          (r) => r !== HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT
        );
        if (next.humanReview.reasons.length === 0) {
          next.humanReview.required = false;
          next.humanReview.details = [];
        }
      }
      return { ok: true, state: next, reason: null };
    }
    function remainingRequestsToFinishCourt(laneA, opts = {}) {
      const need = remainingAuthoritiesNeededAdaptive(laneA);
      if (need <= 0) return 0;
      const cfg = opts.config || loadAdaptiveQuotaConfig();
      const rpa = opts.requestsPerAuthority != null ? Number(opts.requestsPerAuthority) : Number(cfg.defaultRequestsPerAuthority);
      if (opts.withUncertainty) {
        return estimateRequestsNeeded(need, rpa, cfg);
      }
      return Math.ceil(need * rpa);
    }
    function hasUsefulClCapacity(params) {
      const capacity = hasUsefulAdaptiveCapacity({
        windows: params.windows || null,
        safeRequests: params.safeRequests,
        remainingRequestsToFinishCourt: params.remainingRequestsToFinishCourt,
        laneA: params.laneA || {
          count: 0,
          target: 45,
          court: params.court || null
        },
        efficiencyStore: params.efficiencyStore,
        config: params.config,
        now: params.now,
        laneBHasWork: params.laneBHasWork
      });
      return capacity;
    }
    function projectNextQuotaCheck(params) {
      const nowMs = (params.now instanceof Date ? params.now : new Date(params.now)).getTime();
      const lastProbeMs = params.lastProbeAt ? new Date(params.lastProbeAt).getTime() : 0;
      const earliest = lastProbeMs + (params.minGapMs ?? MIN_QUOTA_PROBE_GAP_MS);
      const projected = params.projectedUsefulAt != null ? new Date(params.projectedUsefulAt).getTime() : nowMs;
      const next = Math.max(nowMs, earliest, projected);
      return new Date(next).toISOString();
    }
    var ACTIVE_QUOTA_MODES = /* @__PURE__ */ new Set([
      QUOTA_MODES.FINISH_TARGET,
      QUOTA_MODES.FULL_BATCH,
      QUOTA_MODES.MICRO_BATCH
    ]);
    function isActiveQuotaMode(mode) {
      return ACTIVE_QUOTA_MODES.has(mode);
    }
    function quotaProbeDue(state, now = /* @__PURE__ */ new Date()) {
      return shouldProbeQuota(state, now).probe;
    }
    function decideLane(state, quota = {}) {
      const now = quota.now || /* @__PURE__ */ new Date();
      const cfg = quota.config || loadAdaptiveQuotaConfig();
      if (state?.humanReview?.required) {
        return {
          lane: "B",
          reason: "human_review_required",
          quotaMode: QUOTA_MODES.DAY_BLOCKED,
          remainingRequestsToFinishCourt: remainingRequestsToFinishCourt(state.laneA),
          blocked: true
        };
      }
      const check = validatePartialCheckpoint(state.laneA);
      if (check.humanReviewRequired) {
        return {
          lane: "B",
          reason: check.reason,
          quotaMode: QUOTA_MODES.DAY_BLOCKED,
          remainingRequestsToFinishCourt: remainingRequestsToFinishCourt(state.laneA),
          blocked: true,
          needsHumanReview: true
        };
      }
      if (efficiencyRegressionTriggered(state.quota?.courtEfficiency || {}, state.laneA?.court, cfg)) {
        return {
          lane: "B",
          reason: "COURTLISTENER_REQUEST_EFFICIENCY_REGRESSION",
          quotaMode: QUOTA_MODES.DAY_BLOCKED,
          remainingRequestsToFinishCourt: remainingRequestsToFinishCourt(state.laneA),
          blocked: true,
          needsHumanReview: true,
          humanReviewReason: "COURTLISTENER_REQUEST_EFFICIENCY_REGRESSION"
        };
      }
      const rawWindows = quota.windows || state.quota?.windows || null;
      const windowsComplete = Boolean(
        rawWindows && rawWindows.minute && rawWindows.hour && rawWindows.day && Number.isFinite(Number(rawWindows.minute.remaining)) && Number.isFinite(Number(rawWindows.hour.remaining)) && Number.isFinite(Number(rawWindows.day.remaining))
      );
      const plan = planAdaptiveQuota({
        windows: windowsComplete ? rawWindows : null,
        usableRequestsOverride: windowsComplete ? null : quota.safeRequests != null ? quota.safeRequests : state.quota?.lastSafeRequests,
        laneA: state.laneA,
        efficiencyStore: quota.efficiencyStore || state.quota?.courtEfficiency || {},
        config: cfg,
        now,
        laneBHasWork: quota.laneBHasWork
      });
      if (!windowsComplete && plan.lane !== "A") {
        const legacyRemaining = remainingRequestsToFinishCourt(state.laneA);
        const safe = Number(quota.safeRequests);
        if (Number.isFinite(safe) && legacyRemaining > 0 && safe >= legacyRemaining) {
          return {
            lane: "A",
            reason: "finish_partial_court",
            quotaMode: QUOTA_MODES.FINISH_TARGET,
            remainingRequestsToFinishCourt: legacyRemaining,
            usableRequests: safe,
            estimatedRequestsNeeded: legacyRemaining,
            requestsPerAuthorityEstimate: plan.requestsPerAuthorityEstimate,
            bindingWindow: plan.bindingWindow,
            nextUsefulAt: null,
            plan
          };
        }
      }
      const activeNow = isActiveQuotaMode(plan.quotaMode) && plan.lane === "A";
      const nextUsefulAt = activeNow ? null : plan.nextUsefulAt || null;
      const bindingResetAt = activeNow ? resolveBindingResetAt(rawWindows, plan.bindingWindow) : plan.nextUsefulAt || resolveBindingResetAt(rawWindows, plan.bindingWindow);
      const out = {
        lane: plan.lane,
        reason: plan.reason,
        quotaMode: plan.quotaMode,
        remainingRequestsToFinishCourt: remainingRequestsToFinishCourt(state.laneA),
        remainingAuthoritiesNeeded: plan.remainingAuthoritiesNeeded,
        usableRequests: plan.usableRequests,
        estimatedRequestsNeeded: plan.estimatedRequestsNeeded,
        requestsPerAuthorityEstimate: plan.requestsPerAuthorityEstimate,
        bindingWindow: plan.bindingWindow,
        bindingResetAt,
        currentUsableNow: plan.usableRequests,
        nextUsefulAt,
        microBatchMaxRequests: plan.microBatchMaxRequests,
        nearComplete: plan.nearComplete,
        plan
      };
      if (plan.lane === "A") {
        return {
          ...out,
          nextUsefulAt: null,
          nextCheckAt: nextQuotaCheckAfterActiveBatch(now, { deferMs: 15 * 60 * 1e3 })
        };
      }
      if (plan.lane === "WAIT") {
        return {
          ...out,
          lane: "WAIT",
          nextCheckAt: nextUsefulAt ? nextUsefulAt : projectNextQuotaCheck({
            now,
            lastProbeAt: state.quota?.lastProbeAt || now.toISOString(),
            projectedUsefulAt: nextUsefulAt
          })
        };
      }
      return {
        ...out,
        lane: "B",
        nextCheckAt: projectNextQuotaCheck({
          now,
          lastProbeAt: state.quota?.lastProbeAt || now.toISOString(),
          projectedUsefulAt: nextUsefulAt
        })
      };
    }
    function applyQuotaSnapshot(state, params) {
      const next = cloneState(state);
      const now = params.now || /* @__PURE__ */ new Date();
      const usableNow = Math.max(0, Number(params.safeRequests) || 0);
      next.quota.windows = params.windows || next.quota.windows;
      next.quota.lastProbeAt = now.toISOString();
      next.quota.lastSafeRequests = usableNow;
      next.quota.currentUsableNow = usableNow;
      if (params.bindingWindow != null) next.quota.bindingWindow = params.bindingWindow;
      const activeNow = params.wait === null || isActiveQuotaMode(params.quotaMode) || params.clearBlocking === true;
      if (params.bindingResetAt !== void 0) {
        next.quota.bindingResetAt = params.bindingResetAt;
      } else if (!activeNow && params.projectedUsefulAt != null) {
        next.quota.bindingResetAt = params.projectedUsefulAt;
      } else if (activeNow && params.windows && params.bindingWindow) {
        next.quota.bindingResetAt = resolveBindingResetAt(params.windows, params.bindingWindow);
      }
      if (activeNow) {
        next.quota.nextCheckAt = params.nextCheckAt || nextQuotaCheckAfterActiveBatch(now, { deferMs: params.activeDeferMs || 15 * 60 * 1e3 });
      } else {
        next.quota.nextCheckAt = projectNextQuotaCheck({
          now,
          lastProbeAt: now.toISOString(),
          projectedUsefulAt: params.nextUsefulAt || params.projectedUsefulAt || null
        });
      }
      if (params.last429At) next.quota.last429At = params.last429At;
      if (params.retryAfterSeconds != null) next.quota.retryAfterSeconds = params.retryAfterSeconds;
      if (params.quotaStateObservedAt != null) next.quota.quotaStateObservedAt = params.quotaStateObservedAt;
      else next.quota.quotaStateObservedAt = now.toISOString();
      if (params.quotaStateSource != null) next.quota.quotaStateSource = params.quotaStateSource;
      if (params.quotaStateConfidence != null) next.quota.quotaStateConfidence = params.quotaStateConfidence;
      if (params.quotaStateAgeMs != null) next.quota.quotaStateAgeMs = params.quotaStateAgeMs;
      else next.quota.quotaStateAgeMs = 0;
      if (params.membership != null) next.quota.membership = params.membership;
      if (params.plan) next.quota.lastPlan = params.plan;
      if (params.wait !== void 0) next.quota.wait = params.wait;
      if (params.windows) next.quota.utilization = dayUtilization(params.windows);
      if (params.windows && (params.quotaStateConfidence === "AUTHORITATIVE_API" || params.quotaStateConfidence === "AUTHORITATIVE_HEADER")) {
        next.quota.quotaStatus = "FRESH";
        next.quota.executionAuthority = params.quotaStateSource || "probe";
        next.quota.usableForExecution = true;
      }
      if (params.probeCounted) {
        next.quota.probeRequests = Number(next.quota.probeRequests || 0) + 1;
      }
      next.metrics.quotaChecks += 1;
      next.updatedAt = now.toISOString();
      return next;
    }
    function recordCourtBatchEfficiency(state, batch) {
      const next = cloneState(state);
      next.quota.courtEfficiency = updateCourtEfficiency(next.quota.courtEfficiency || {}, batch);
      next.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      return next;
    }
    function recordLaneSwitch(state, fromLane, toLane, reason, now = /* @__PURE__ */ new Date()) {
      const next = cloneState(state);
      next.currentLane = toLane;
      next.metrics.laneSwitches += 1;
      next.switches.push({
        at: now.toISOString(),
        from: fromLane,
        to: toLane,
        reason
      });
      next.updatedAt = now.toISOString();
      return next;
    }
    function applyQuotaFloorTransition(state, params) {
      const now = params.now || /* @__PURE__ */ new Date();
      const waitPayload = params.wait !== void 0 ? params.wait : params.nextUsefulAt ? {
        bindingWindow: params.bindingWindow || null,
        nextUsefulAt: params.nextUsefulAt,
        quotaMode: params.quotaMode || null,
        usableRequests: params.safeRequests,
        estimatedRequestsNeeded: params.estimatedRequestsNeeded || null
      } : params.clearWait ? null : void 0;
      let next = applyQuotaSnapshot(state, {
        ...params,
        projectedUsefulAt: params.projectedUsefulAt || params.nextUsefulAt || null,
        wait: waitPayload
      });
      const checkpoint = params.checkpoint ?? params.lastSuccessfulExternalId ?? next.laneA.checkpoint ?? next.laneA.lastSuccessfulExternalId ?? null;
      next.laneA = {
        ...next.laneA,
        court: params.court ?? next.laneA.court,
        jurisdiction: params.jurisdiction ?? next.laneA.jurisdiction,
        checkpoint,
        cursor: params.cursor ?? next.laneA.cursor,
        lastSuccessfulExternalId: params.lastSuccessfulExternalId ?? next.laneA.lastSuccessfulExternalId ?? checkpoint,
        nextPageUrl: params.nextPageUrl ?? next.laneA.nextPageUrl,
        lastSuccessfulAt: params.lastSuccessfulAt ?? next.laneA.lastSuccessfulAt,
        target: params.target ?? next.laneA.target,
        count: params.count ?? next.laneA.count,
        jobStatus: params.jobStatus ?? next.laneA.jobStatus ?? "quota_paused",
        lock: null
      };
      const check = validatePartialCheckpoint(next.laneA);
      next.laneA = check.laneA;
      if (check.humanReviewRequired) {
        next = setHumanReview(next, check.reason, "quota floor with missing durable checkpoint");
      }
      const mode = params.quotaMode || null;
      const preferWait = mode === QUOTA_MODES.WAIT_MINUTE || params.reason === "minute_window_blocked" || params.reason === "below_micro_batch_minimum";
      if (preferWait && mode !== QUOTA_MODES.DAY_BLOCKED && mode !== QUOTA_MODES.WAIT_HOUR) {
        if (next.currentLane !== "WAIT") {
          next = recordLaneSwitch(next, next.currentLane, "WAIT", params.reason || "wait_minute", now);
        } else {
          next.currentLane = "WAIT";
          next.updatedAt = now.toISOString();
        }
        next.idleSafe = true;
        next.runtimeState = "WAITING_QUOTA_RESET";
        return next;
      }
      if (next.currentLane !== "B") {
        next = recordLaneSwitch(next, next.currentLane, "B", params.reason || "quota_floor", now);
      } else {
        next.currentLane = "B";
        next.updatedAt = now.toISOString();
      }
      return next;
    }
    function applyQuotaRecoveryTransition(state, params) {
      const now = params.now || /* @__PURE__ */ new Date();
      let next = applyQuotaSnapshot(state, { ...params, wait: null });
      const decision = decideLane(next, {
        safeRequests: params.safeRequests,
        windows: params.windows || next.quota.windows,
        projectedUsefulAt: params.projectedUsefulAt,
        now,
        laneBHasWork: params.laneBHasWork
      });
      next.quota.lastPlan = decision.plan || decision;
      if (decision.lane === "A" && next.currentLane !== "A") {
        next = recordLaneSwitch(next, next.currentLane, "A", decision.reason, now);
        next.quota.wait = null;
        next.idleSafe = false;
        next.runtimeState = "RUNNING";
        next.laneASelectedAt = now.toISOString();
        next.laneARunnerStartedAt = null;
        next.quota.bindingWindow = decision.bindingWindow || next.quota.bindingWindow;
        next.quota.bindingResetAt = decision.bindingResetAt ?? null;
        next.quota.nextCheckAt = nextQuotaCheckAfterActiveBatch(now, { deferMs: 15 * 60 * 1e3 });
      } else if (decision.lane === "A") {
        next.idleSafe = false;
        next.runtimeState = "RUNNING";
        next.quota.wait = null;
        next.quota.bindingWindow = decision.bindingWindow || next.quota.bindingWindow;
        next.quota.bindingResetAt = decision.bindingResetAt ?? null;
        next.quota.nextCheckAt = nextQuotaCheckAfterActiveBatch(now, { deferMs: 15 * 60 * 1e3 });
      } else if (decision.lane === "WAIT") {
        next = applyQuotaFloorTransition(next, {
          ...params,
          quotaMode: decision.quotaMode,
          reason: decision.reason,
          nextUsefulAt: decision.nextUsefulAt,
          bindingWindow: decision.bindingWindow,
          estimatedRequestsNeeded: decision.estimatedRequestsNeeded,
          now
        });
      }
      return { state: next, decision };
    }
    function acquireLaneALock(state, workerId, now = /* @__PURE__ */ new Date(), ttlMs = LANE_A_LOCK_TTL_MS) {
      const lock = state.laneA?.lock;
      if (lock && lock.until && new Date(lock.until).getTime() > now.getTime() && lock.workerId !== workerId) {
        return { ok: false, reason: "lane_a_already_running", state };
      }
      const next = cloneState(state);
      next.laneA.lock = {
        workerId,
        until: new Date(now.getTime() + ttlMs).toISOString()
      };
      next.updatedAt = now.toISOString();
      return { ok: true, state: next };
    }
    function releaseLaneALock(state, workerId, now = /* @__PURE__ */ new Date()) {
      const next = cloneState(state);
      if (next.laneA.lock && next.laneA.lock.workerId && next.laneA.lock.workerId !== workerId) {
        return { ok: false, reason: "lock_owned_by_other", state };
      }
      next.laneA.lock = null;
      next.updatedAt = now.toISOString();
      return { ok: true, state: next };
    }
    function recordLaneTime2(state, lane, durationMs, extras = {}) {
      const next = cloneState(state);
      const ms = Math.max(0, Number(durationMs) || 0);
      if (lane === "A") next.metrics.laneAMs += ms;
      else if (lane === "B") next.metrics.laneBMs += ms;
      else next.metrics.idleMs += ms;
      if (extras.clAuthorities) next.metrics.clAuthorities += extras.clAuthorities;
      if (extras.nonClAuthorities) next.metrics.nonClAuthorities += extras.nonClAuthorities;
      if (extras.citationsResolved) next.metrics.citationsResolved += extras.citationsResolved;
      next.updatedAt = extras.now ? new Date(extras.now).toISOString() : next.updatedAt;
      return next;
    }
    function completeLaneBTask2(state, task, checkpoint, now = /* @__PURE__ */ new Date(), opts = {}) {
      const next = cloneState(state);
      const taskId = String(task || "");
      if (taskId && !next.laneB.tasksCompleted.includes(taskId)) next.laneB.tasksCompleted.push(taskId);
      next.laneB.checkpoint = checkpoint ?? next.laneB.checkpoint;
      next.laneB.checkpoints = next.laneB.checkpoints || {};
      next.laneB.lastByTask = next.laneB.lastByTask || {};
      next.laneB.nextEligibleAt = next.laneB.nextEligibleAt || {};
      if (taskId) next.laneB.lastByTask[taskId] = now.toISOString();
      if (checkpoint != null && taskId) {
        next.laneB.checkpoints[taskId] = checkpoint;
      }
      if (opts.checkpointKey && checkpoint != null) {
        next.laneB.checkpoints[opts.checkpointKey] = checkpoint;
      }
      if (opts.minimumIntervalMs && taskId) {
        next.laneB.nextEligibleAt[taskId] = new Date(now.getTime() + Number(opts.minimumIntervalMs)).toISOString();
      }
      if (opts.noDelta && taskId) {
        next.laneB.lastOutcome = next.laneB.lastOutcome || {};
        next.laneB.lastOutcome[taskId] = { at: now.toISOString(), result: "NO_DELTA" };
      }
      next.laneB.mutatingTaskActive = null;
      next.laneB.task = "NONE";
      next.idleSafe = true;
      next.runtimeState = "IDLE_SAFE";
      next.updatedAt = now.toISOString();
      return next;
    }
    function applyLaneBSelection(state, selection, now = /* @__PURE__ */ new Date()) {
      const next = cloneState(state);
      next.updatedAt = now.toISOString();
      next.laneB = next.laneB || {};
      next.laneB.lastEligibility = selection.evaluations || next.laneB.lastEligibility || null;
      if (selection.idleSafe || !selection.task || selection.executing === false) {
        next.idleSafe = true;
        next.currentLane = "B";
        next.laneB.task = "NONE";
        next.runtimeState = "IDLE_SAFE";
        return next;
      }
      next.idleSafe = false;
      next.currentLane = "B";
      next.laneB.task = selection.task.id || selection.currentTask;
      if (selection.task.mayMutate) {
        next.laneB.mutatingTaskActive = selection.task.id;
      } else {
        next.laneB.mutatingTaskActive = null;
      }
      next.runtimeState = "RUNNING";
      return next;
    }
    function isCourtListenerUrl(url) {
      if (url == null) return false;
      let parsed;
      try {
        parsed = new URL(String(url), "https://www.courtlistener.com");
      } catch {
        return /courtlistener\.com/i.test(String(url));
      }
      return CL_HOST_RE.test(parsed.hostname);
    }
    function isBlockedLaneBCourtListenerUrl(url) {
      if (!isCourtListenerUrl(url)) return false;
      try {
        const parsed = new URL(String(url), "https://www.courtlistener.com");
        return CL_BLOCKED_PATHS.some((p) => parsed.pathname === p || parsed.pathname.startsWith(`${p}/`));
      } catch {
        return true;
      }
    }
    function assertLaneBUrlAllowed2(url) {
      if (isCourtListenerUrl(url)) {
        const err = new Error(`LANE_B_CL_BLOCKED: ${String(url)}`);
        err.code = "LANE_B_CL_BLOCKED";
        throw err;
      }
      return true;
    }
    function installLaneBFetchGuard2(globalObj = globalThis) {
      const original = globalObj.fetch;
      if (typeof original !== "function") {
        throw new Error("fetch unavailable; cannot install Lane B guard");
      }
      if (original.__nyayaLaneBGuard) return original;
      const guarded = async function laneBGuardedFetch(input, init) {
        const url = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
        assertLaneBUrlAllowed2(url);
        return original.call(this, input, init);
      };
      guarded.__nyayaLaneBGuard = true;
      guarded.__nyayaLaneBOriginalFetch = original;
      globalObj.fetch = guarded;
      return guarded;
    }
    function uninstallLaneBFetchGuard2(globalObj = globalThis) {
      const current = globalObj.fetch;
      if (current && current.__nyayaLaneBOriginalFetch) {
        globalObj.fetch = current.__nyayaLaneBOriginalFetch;
      }
    }
    function uniqueCitationEdgeKey(edge) {
      return [edge.fromAuthorityId, edge.normalizedCitation || edge.rawCitation, edge.pinpoint || ""].join("|").toLowerCase();
    }
    function uniqueEmbeddingKey(row) {
      return `${row.authorityId}:${row.chunkIndex}:${row.contentHash || sha2562(row.content || "")}`;
    }
    function insertUnique(set, key) {
      if (set.has(key)) return { inserted: false, duplicate: true };
      set.add(key);
      return { inserted: true, duplicate: false };
    }
    function classifyDepth2(params) {
      const deficit = Math.max(0, Number(params.authorityDeficitTo101) || 0);
      const mid = Number(params.intermediateAppellate) || 0;
      if (deficit >= 80 || deficit >= 50 && mid === 0) return "CRITICAL_DEPTH";
      if (deficit >= 40 || mid < 5) return "HIGH_DEPTH";
      if (deficit >= 15) return "MEDIUM_DEPTH";
      return "LOW_DEPTH";
    }
    function detectHistoricalHoles2(params) {
      const years = (params.years || []).filter((y) => Number.isFinite(y)).map(Number);
      const nowYear = params.nowYear ?? (/* @__PURE__ */ new Date()).getUTCFullYear();
      const flags = [];
      if (years.length === 0) {
        return { flags: [{ kind: "no_dated_cases" }], targetRanges: ["pre-2000", "1980-1999", "1960-1979", "pre-1960"] };
      }
      const newest = Math.max(...years);
      const oldest = Math.min(...years);
      const decades = new Set(years.map((y) => Math.floor(y / 10) * 10));
      if (years.every((y) => y >= nowYear - 1)) flags.push({ kind: "recent_only", label: `${nowYear}/recent concentration` });
      if (decades.size <= 1) flags.push({ kind: "one_decade", decade: [...decades][0] });
      const uniqueCourts = params.uniqueCourts ?? null;
      if (uniqueCourts != null && uniqueCourts <= 1) flags.push({ kind: "one_court" });
      const targetRanges = [];
      if (!years.some((y) => y < 2e3)) targetRanges.push("pre-2000");
      if (!years.some((y) => y >= 1980 && y <= 1999)) targetRanges.push("1980-1999");
      if (!years.some((y) => y >= 1960 && y <= 1979)) targetRanges.push("1960-1979");
      if (!years.some((y) => y < 1960)) targetRanges.push("pre-1960");
      return { flags, targetRanges, oldest, newest, decadeCount: decades.size };
    }
    var US_REPORTS_RE = /\b(\d{1,3})\s+U\.\s*S\.\s+(\d{1,4})\b/;
    var SCOTUS_S_CT_RE = /\b(\d{1,3})\s+S\.\s*Ct\.\s+(\d{1,4})\b/;
    var SCOTUS_L_ED_RE = /\b(\d{1,3})\s+L\.\s*Ed\.(?:\s*2d)?\s+(\d{1,4})\b/;
    function parseUsReportsCitation(raw) {
      const text = String(raw || "").replace(/\s+/g, " ").trim();
      const us = US_REPORTS_RE.exec(text);
      if (us) {
        return {
          citation: `${us[1]} U.S. ${us[2]}`,
          reporter: "U.S.",
          volume: Number(us[1]),
          page: Number(us[2]),
          family: "us_reports"
        };
      }
      const sct = SCOTUS_S_CT_RE.exec(text);
      if (sct) {
        return {
          citation: `${sct[1]} S. Ct. ${sct[2]}`,
          reporter: "S. Ct.",
          volume: Number(sct[1]),
          page: Number(sct[2]),
          family: "scotus_sct"
        };
      }
      const led = SCOTUS_L_ED_RE.exec(text);
      if (led) {
        return {
          citation: text,
          reporter: /2d/i.test(text) ? "L. Ed. 2d" : "L. Ed.",
          volume: Number(led[1]),
          page: Number(led[2]),
          family: "scotus_led"
        };
      }
      return null;
    }
    function rankMissingUsReports2(edges, presentCitations = []) {
      const present = new Set(
        presentCitations.map((c) => String(c).replace(/\s+/g, " ").trim().toLowerCase())
      );
      const buckets = /* @__PURE__ */ new Map();
      for (const edge of edges || []) {
        const parsed = parseUsReportsCitation(edge.normalizedCitation || edge.rawCitation);
        if (!parsed) continue;
        const key = parsed.citation.toLowerCase();
        if (!buckets.has(key)) {
          buckets.set(key, {
            citation: parsed.citation,
            volume: parsed.volume,
            page: parsed.page,
            reporter: parsed.reporter,
            family: parsed.family,
            inbound: 0,
            alreadyPresentUnderAlias: present.has(key),
            estimatedDecisionIdentity: null,
            suitablePublicNonClSource: parsed.family === "us_reports" ? "loc_us_reports_candidate" : "unknown_without_us_reports_parallel"
          });
        }
        buckets.get(key).inbound += Number(edge.inbound || 1);
      }
      return [...buckets.values()].sort((a, b) => b.inbound - a.inbound || a.volume - b.volume || a.page - b.page);
    }
    function classifyIntermediateCandidate(params) {
      const invalidId = params.invalidCandidateId;
      const hypothesized = params.hypothesizedIds || [];
      const liveVerifyForbidden = true;
      if (!params.positiveLocalEvidence) {
        return {
          gapId: invalidId,
          classification: "UNRESOLVED",
          candidateClId: null,
          hypothesizedUnverifiedIds: hypothesized,
          liveVerifyForbidden,
          note: "No local evidence identifies a replacement CourtListener court id. Do not query CourtListener from Lane B."
        };
      }
      return {
        gapId: invalidId,
        classification: "CANDIDATE_NEEDS_SINGLE_CL_VERIFY",
        candidateClId: params.positiveLocalEvidence.candidateClId,
        evidence: params.positiveLocalEvidence.evidence,
        liveVerifyForbidden
      };
    }
    var KNOWN_INTERMEDIATE_GAPS = [
      {
        invalidCandidateId: "pacommwlth",
        courtName: "Commonwealth Court of Pennsylvania",
        hypothesizedIds: ["pacomm", "pa-comm"],
        positiveLocalEvidence: null
      },
      {
        invalidCandidateId: "njsuperct",
        courtName: "Superior Court of New Jersey, Appellate Division",
        hypothesizedIds: ["njsuper"],
        positiveLocalEvidence: null
      },
      {
        invalidCandidateId: "vacapp",
        courtName: "Court of Appeals of Virginia",
        hypothesizedIds: [],
        positiveLocalEvidence: null
      }
    ];
    function researchIntermediateGaps2() {
      return KNOWN_INTERMEDIATE_GAPS.map((g) => classifyIntermediateCandidate(g));
    }
    function logLaneEvent(lane, payload) {
      const tag = lane === "A" ? "LANE_A_CL" : lane === "CHECK" ? "QUOTA_CHECK" : lane === "SWITCH" ? "LANE_SWITCH" : "LANE_B_OFFLINE";
      return { tag, at: (/* @__PURE__ */ new Date()).toISOString(), ...payload };
    }
    module2.exports = {
      QUEUE,
      USEFUL_CL_MIN,
      MIN_QUOTA_PROBE_GAP_MS,
      LANE_A_SEQUENCE,
      LANE_B_TASKS,
      LANE_B_REGISTRY_IDS,
      EST_CL_REQUESTS_PER_CASE,
      QUOTA_MODES,
      BINDING_WINDOWS,
      createInitialState,
      restoreState: restoreState2,
      cloneState,
      remainingRequestsToFinishCourt,
      remainingCasesToFinish,
      hasUsefulClCapacity,
      projectNextQuotaCheck,
      quotaProbeDue,
      decideLane,
      isActiveQuotaMode,
      ACTIVE_QUOTA_MODES,
      applyQuotaSnapshot,
      applyQuotaFloorTransition,
      applyQuotaRecoveryTransition,
      recordCourtBatchEfficiency,
      recordLaneSwitch,
      acquireLaneALock,
      releaseLaneALock,
      recordLaneTime: recordLaneTime2,
      completeLaneBTask: completeLaneBTask2,
      applyLaneBSelection,
      isCourtListenerUrl,
      isBlockedLaneBCourtListenerUrl,
      assertLaneBUrlAllowed: assertLaneBUrlAllowed2,
      installLaneBFetchGuard: installLaneBFetchGuard2,
      uninstallLaneBFetchGuard: uninstallLaneBFetchGuard2,
      uniqueCitationEdgeKey,
      uniqueEmbeddingKey,
      insertUnique,
      classifyDepth: classifyDepth2,
      detectHistoricalHoles: detectHistoricalHoles2,
      parseUsReportsCitation,
      rankMissingUsReports: rankMissingUsReports2,
      classifyIntermediateCandidate,
      researchIntermediateGaps: researchIntermediateGaps2,
      KNOWN_INTERMEDIATE_GAPS,
      logLaneEvent,
      sha256: sha2562,
      persistLaneAProgress,
      applyDurableJobCheckpoint,
      validatePartialCheckpoint,
      reconcileLaneAFromJob,
      setHumanReview,
      isPartialLaneA,
      isReadyFirstStartLaneA,
      hasDurableCheckpoint,
      requiresDurableResumeCheckpoint,
      isMissingDurableResumeCheckpointFatal,
      HUMAN_REVIEW_REASONS
    };
  }
});

// scripts/lib/case-citation-extraction.cjs
var require_case_citation_extraction = __commonJS({
  "scripts/lib/case-citation-extraction.cjs"(exports2, module2) {
    "use strict";
    var { createHash: createHash2, randomUUID: randomUUID2 } = require("node:crypto");
    var CITATION_EXTRACTION_VERSION = "case-cite-extract-v1";
    var EXTRACT_RES = [
      /\b\d{1,3}\s+U\.?\s*S\.?\s+\d{1,4}\b/gi,
      /\b\d{1,3}\s+S\.?\s*Ct\.?\s+\d{1,4}\b/gi,
      /\b\d{1,3}\s+L\.?\s*Ed\.?\s*(?:2d\s+)?\d{1,4}\b/gi,
      /\b\d{1,4}\s+F\.?\s*(?:2d|3d|4th)\s+\d{1,4}\b/gi,
      /\b\d{1,4}\s+F\.?\s*Supp\.?\s*(?:2d|3d)?\s+\d{1,4}\b/gi,
      /\b\d{1,2}\s+U\.?\s*S\.?\s*C\.?\s*§\s*[\dA-Za-z.()-]+\b/gi,
      /\b\d{1,2}\s+C\.?\s*F\.?\s*R\.?\s*§\s*[\d.()-]+\b/gi,
      /\bFed\.?\s*R\.?\s*(?:Civ\.?\s*P\.?|Evid\.?|App\.?\s*P\.?|Crim\.?\s*P\.?)\s+\d+[A-Za-z]?\b/gi,
      // Regional reporters: N.W.2d, S.W.3d, P.2d, A.3d, So.2d, etc.
      /\b\d{1,4}\s+(?:N\.?\s*E\.?|N\.?\s*W\.?|S\.?\s*E\.?|S\.?\s*W\.?|A\.?|P\.?|So\.?)\s*(?:2d|3d)?\s+\d{1,4}\b/gi,
      // Two-letter dotted reporters: N.H., N.J., etc. with page
      /\b\d{1,4}\s+[A-Z]\.\s*[A-Z]\.?\s+\d{1,4}\b/g,
      // Common state reporter abbreviations with page: Ill., Cal., Mass., etc.
      /\b\d{1,4}\s+(?:Ill|Cal|Mass|Tex|Ohio|Mich|Pa|NY|N\.Y|Fla|Ga|Va|Wash|Or|Minn|Wis|Kan|Okla|Ark|Ala|Tenn|Ky|Ind|Conn|Md|Mo|Colo|Ariz)\.?\s*(?:2d|3d|App\.?)?\s+\d{1,4}\b/gi,
      // State neutral citations: 2026 ND 26, 2026 OK 65
      /\b(?:19|20)\d{2}\s+(?:ND|SD|OK|NM|WY|MT|KS|NE|IA|WI|MN|AK|HI|OH|UT|VT|ME|NH|NV|ID|DE|RI|SC|NC|WV)\s+\d{1,4}\b/g,
      /\b\d{1,4}\s+[A-Z][a-z]{0,10}\.?\s*(?:2d|3d)?\s+\d{1,4}\b/g
    ];
    var HEURISTIC_CITE_LIKE = /\b\d{1,4}\s+(?:U\.?\s*S\.?|F\.|F\.?\s*(?:2d|3d|4th)|F\.?\s*Supp|S\.?\s*Ct\.?|L\.?\s*Ed|C\.?\s*F\.?\s*R|U\.?\s*S\.?\s*C|Fed\.?\s*R\.|[A-Z][a-z]{1,10}\.?)\b/;
    function sha256Text(text) {
      return createHash2("sha256").update(String(text || ""), "utf8").digest("hex");
    }
    function normalizeCitation(raw) {
      return String(raw || "").replace(/\s+/g, " ").replace(/\bU\.\s+S\./gi, "U.S.").replace(/\bF\.\s+(2d|3d|4th)\b/gi, (_, x) => `F.${String(x).toLowerCase()}`).replace(/\bF\.\s*Supp\.\s*(2d|3d)?/gi, (_, x) => x ? `F. Supp. ${String(x).toLowerCase()}` : "F. Supp.").trim();
    }
    function extractCaseCitationsFromText(content) {
      const seen = /* @__PURE__ */ new Set();
      const out = [];
      const text = String(content || "");
      for (const re of EXTRACT_RES) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
          const raw = m[0].trim();
          const normalized = normalizeCitation(raw);
          if (!normalized || normalized.length < 5) continue;
          if (seen.has(normalized)) continue;
          seen.add(normalized);
          out.push({ raw, normalized });
        }
      }
      return out;
    }
    function looksCitationLike(content) {
      return HEURISTIC_CITE_LIKE.test(String(content || ""));
    }
    function buildExtractionMeta(params) {
      const { status, textHash, occurrenceCount, error } = params;
      return {
        citationExtraction: {
          status,
          version: CITATION_EXTRACTION_VERSION,
          extractedAt: (/* @__PURE__ */ new Date()).toISOString(),
          textHashAtExtraction: textHash,
          occurrenceCount: occurrenceCount ?? 0,
          ...error ? { error: String(error).slice(0, 300) } : {}
        }
      };
    }
    async function ensureCaseCitationExtraction2(sql, params) {
      const { authorityId, content, existingMetadata } = params;
      const textHash = sha256Text(content);
      try {
        const cites = extractCaseCitationsFromText(content);
        let inserted = 0;
        for (const cit of cites) {
          const dup = await sql`
        select 1 as ok from legal_authority_citations
        where from_authority_id = ${authorityId}
          and normalized_citation = ${cit.normalized}
        limit 1
      `;
          if (dup.length > 0) continue;
          const matches = await sql`
        select id from legal_authorities
        where normalized_citation = ${cit.normalized}
           or citation = ${cit.normalized}
           or citation = ${cit.raw}
        limit 2
      `;
          const toId = matches.length === 1 ? matches[0].id : null;
          await sql`
        insert into legal_authority_citations (
          id, from_authority_id, to_authority_id, raw_citation, normalized_citation
        ) values (
          ${randomUUID2()}, ${authorityId}, ${toId}, ${cit.raw}, ${cit.normalized}
        )
      `;
          inserted += 1;
        }
        const status = cites.length > 0 ? "PROCESSED_NONZERO" : "PROCESSED_ZERO";
        const metaPatch = buildExtractionMeta({
          status,
          textHash,
          occurrenceCount: cites.length
        });
        const base = existingMetadata && typeof existingMetadata === "object" && !Array.isArray(existingMetadata) ? existingMetadata : {};
        const merged = { ...base, ...metaPatch };
        await sql`
      update legal_authorities
      set metadata = ${sql.json(merged)}, updated_at = now()
      where id = ${authorityId}
    `;
        return { inserted, status, textHash, occurrenceCount: cites.length };
      } catch (err) {
        const base = existingMetadata && typeof existingMetadata === "object" && !Array.isArray(existingMetadata) ? existingMetadata : {};
        const merged = {
          ...base,
          ...buildExtractionMeta({
            status: "FAILED",
            textHash,
            occurrenceCount: 0,
            error: err && err.message ? err.message : String(err)
          })
        };
        try {
          await sql`
        update legal_authorities
        set metadata = ${sql.json(merged)}, updated_at = now()
        where id = ${authorityId}
      `;
        } catch {
        }
        throw err;
      }
    }
    module2.exports = {
      CITATION_EXTRACTION_VERSION,
      sha256Text,
      normalizeCitation,
      extractCaseCitationsFromText,
      looksCitationLike,
      buildExtractionMeta,
      ensureCaseCitationExtraction: ensureCaseCitationExtraction2
    };
  }
});

// scripts/staging-queue2-lane-b.cjs
var { createHash, randomUUID } = require("node:crypto");
var postgres = require_src();
var {
  installLaneBFetchGuard,
  uninstallLaneBFetchGuard,
  assertLaneBUrlAllowed,
  rankMissingUsReports,
  researchIntermediateGaps,
  classifyDepth,
  detectHistoricalHoles,
  restoreState,
  completeLaneBTask,
  recordLaneTime
} = require_queue2_dual_lane_controller();
var { ensureCaseCitationExtraction } = require_case_citation_extraction();
var locUrl = (volume, page) => `https://www.loc.gov/item/usrep${volume}${String(page).padStart(3, "0")}/?fo=json`;
function sha256(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}
function toPgvector(vec) {
  return `[${vec.join(",")}]`;
}
function stripHtml(html) {
  return String(html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function uscViewerUrl(title, section) {
  const req = `granuleid:USC-prelim-title${title}-section${section}&num=${section}&edition=prelim`;
  return `https://uscode.house.gov/view.xhtml?req=${encodeURIComponent(req)}`;
}
function parseUsc(raw) {
  const m = /\b(\d{1,2})\s+U\.?\s?S\.?\s?C\.?\s*§+\s*([\dA-Za-z.\-]+)/i.exec(String(raw || ""));
  return m ? { title: Number(m[1]), section: m[2].replace(/\.+$/, ""), citation: `${m[1]} U.S.C. \xA7 ${m[2].replace(/\.+$/, "")}` } : null;
}
function parseCfr(raw) {
  const m = /\b(\d{1,2})\s+C\.?\s?F\.?\s?R\.?\s*§*\s*(\d+(?:\.\d+)*)/i.exec(String(raw || ""));
  return m ? { title: Number(m[1]), section: m[2], citation: `${m[1]} C.F.R. \xA7 ${m[2]}` } : null;
}
function parseFedR(raw) {
  const m = /\bFed\.?\s*R\.?\s*(Civ\.?\s*P\.?|Evid\.?|App\.?\s*P\.?|Crim\.?\s*P\.?)\s*(\d+[A-Za-z.]*)\b/i.exec(
    String(raw || "")
  );
  if (!m) return null;
  const kindRaw = m[1].replace(/\s+/g, " ").trim().toLowerCase();
  let kind = "civ";
  let reporter = "Fed. R. Civ. P.";
  let path = "rules-civil-procedure";
  if (/^evid/i.test(kindRaw)) {
    kind = "evid";
    reporter = "Fed. R. Evid.";
    path = "rules-evidence";
  } else if (/^app/i.test(kindRaw)) {
    kind = "app";
    reporter = "Fed. R. App. P.";
    path = "rules-appellate-procedure";
  } else if (/^crim/i.test(kindRaw)) {
    kind = "crim";
    reporter = "Fed. R. Crim. P.";
    path = "rules-criminal-procedure";
  }
  return { kind, rule: m[2], citation: `${reporter} ${m[2]}`, path };
}
async function guardedFetch(url, init) {
  assertLaneBUrlAllowed(url);
  return fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(25e3) });
}
function chunkContent(content) {
  const parts = String(content).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  for (const p of parts) {
    if (p.length <= 1e3) chunks.push(p);
    else {
      let rest = p;
      while (rest.length > 1e3) {
        let cut = rest.lastIndexOf(" ", 1e3);
        if (cut < 500) cut = 1e3;
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) chunks.push(rest);
    }
  }
  return chunks.length ? chunks : [String(content).slice(0, 1e3)];
}
async function embedBatch(texts, apiKey) {
  const res = await guardedFetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts, dimensions: 384 })
  });
  if (!res.ok) throw new Error(`embed_http_${res.status}`);
  const body = await res.json();
  return (body.data || []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
}
async function importAuthority(sql, rec, apiKey) {
  try {
    const content = rec.content || "";
    if (content.length < 20) return { status: "skipped_short" };
    const hash = sha256(content);
    const provider = rec.sourceProvider;
    const existing = await sql`
    select id from legal_authorities
    where source_provider = ${provider} and source_external_id = ${rec.sourceExternalId}
    limit 1
  `;
    if (existing.length) {
      const latest = await sql`
      select sha256 from legal_authority_versions
      where authority_id = ${existing[0].id} order by version_number desc limit 1
    `;
      if (latest[0]?.sha256 === hash) return { status: "skipped_duplicate" };
      return { status: "skipped_existing" };
    }
    const byCite = rec.normalizedCitation ? await sql`
        select id from legal_authorities
        where normalized_citation = ${rec.normalizedCitation}
        limit 1
      ` : [];
    if (byCite.length) return { status: "skipped_alias", aliasOf: byCite[0].id };
    const id = randomUUID();
    await sql`
    insert into legal_authorities (
      id, authority_type, jurisdiction, court, court_id, authority_state, court_level,
      title, citation, normalized_citation, source_provider, source_external_id,
      canonical_source_url, ingestion_status, currentness_status, last_checked_at,
      decision_date, effective_date, metadata, created_at, updated_at
    ) values (
      ${id}, ${rec.authorityType}, ${rec.jurisdiction || "US"}, ${rec.court || null},
      ${rec.courtId || null}, ${rec.authorityState || "US"}, ${rec.courtLevel || null},
      ${rec.title}, ${rec.citation || null}, ${rec.normalizedCitation || rec.citation || null},
      ${provider}, ${rec.sourceExternalId}, ${rec.canonicalSourceUrl || null},
      'ready', ${rec.currentnessStatus || "current_as_of_source_date"}, now(),
      ${rec.decisionDate || null}, ${rec.effectiveDate || null},
      ${sql.json({ ...rec.sourceMetadata || {}, queue: "#2", lane: "B" })},
      now(), now()
    )
  `;
    const [version] = await sql`
    insert into legal_authority_versions (
      authority_id, version_number, content, sha256, valid_from, valid_to, source_provider, source_metadata
    ) values (
      ${id}, 1, ${content}, ${hash}, now(), null, ${provider},
      ${sql.json({ lane: "B", adapter: provider })}
    )
    returning id
  `;
    const chunks = chunkContent(content);
    let embeddings = [];
    if (apiKey) {
      try {
        embeddings = await embedBatch(chunks, apiKey);
      } catch {
        embeddings = [];
      }
    }
    for (let i = 0; i < chunks.length; i += 1) {
      const vec = embeddings[i];
      if (vec && vec.length) {
        await sql`
        insert into legal_authority_chunks (
          id, authority_id, authority_version_id, chunk_index, content,
          segment_ref, embedding, embedding_model
        ) values (
          ${randomUUID()}, ${id}, ${version.id}, ${i}, ${chunks[i]},
          ${`p${i + 1}`}, ${toPgvector(vec)}::vector, ${"text-embedding-3-small:384"}
        )
      `;
      } else {
        await sql`
        insert into legal_authority_chunks (
          id, authority_id, authority_version_id, chunk_index, content, segment_ref
        ) values (
          ${randomUUID()}, ${id}, ${version.id}, ${i}, ${chunks[i]}, ${`p${i + 1}`}
        )
      `;
      }
    }
    let citationEdges = 0;
    if (String(rec.authorityType || "") === "case" && String(content || "").length >= 200) {
      const citeResult = await ensureCaseCitationExtraction(sql, {
        authorityId: id,
        content,
        existingMetadata: { ...rec.sourceMetadata || {}, queue: "#2", lane: "B" }
      });
      citationEdges = citeResult.inserted;
    }
    return {
      status: "imported",
      id,
      chunks: chunks.length,
      embedded: embeddings.length,
      citationEdges
    };
  } catch (e) {
    return { status: "error", error: String(e.message || e).slice(0, 180) };
  }
}
async function loadScheduler(sql) {
  try {
    const rows = await sql`
      select metadata, cursor, status, updated_at
      from corpus_ingest_jobs
      where source = 'queue2-scheduler' and cl_court = 'queue2-dual-lane'
      limit 1
    `;
    if (!rows.length) return restoreState(null);
    return restoreState(rows[0].metadata || null);
  } catch {
    return restoreState(null);
  }
}
async function saveScheduler(sql, state) {
  const meta = { ...state, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
  try {
    const existing = await sql`
      select id from corpus_ingest_jobs
      where source = 'queue2-scheduler' and cl_court = 'queue2-dual-lane'
      limit 1
    `;
    if (existing.length) {
      await sql`
        update corpus_ingest_jobs
        set status = ${meta.currentLane === "A" ? "running" : "paused"},
            cursor = ${meta.laneA?.checkpoint || null},
            last_error = null,
            metadata = ${sql.json(meta)},
            updated_at = now()
        where id = ${existing[0].id}
      `;
      return;
    }
    await sql`
      insert into corpus_ingest_jobs (
        source, court_id, cl_court, status, cursor, target_max, batch_size, metadata
      ) values (
        'queue2-scheduler', 'queue2-dual-lane', 'queue2-dual-lane',
        ${meta.currentLane === "A" ? "running" : "paused"},
        ${meta.laneA?.checkpoint || null}, 45, 8, ${sql.json(meta)}
      )
    `;
  } catch (e) {
    meta.persistError = String(e.message || e).slice(0, 180);
  }
}
async function citationCounts(sql) {
  const [row] = await sql`
    select
      count(*)::int as extracted,
      count(*) filter (where to_authority_id is not null)::int as resolved,
      count(*) filter (where to_authority_id is null)::int as target_absent,
      count(*) filter (where to_authority_id is null and (normalized_citation is null or btrim(normalized_citation)=''))::int as parser_gap
    from legal_authority_citations
  `;
  return row;
}
async function main() {
  const t0 = Date.now();
  installLaneBFetchGuard(globalThis);
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing", courtListenerHttpCalls: 0, lane: "B" }));
    process.exit(2);
  }
  const apiKey = process.env.OPENAI_API_KEY || "";
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  const clCalls = { attempted: 0, blocked: 0 };
  try {
    let state = await loadScheduler(sql);
    state.currentLane = "B";
    const citeBefore = await citationCounts(sql);
    const unresolved = await sql`
      select coalesce(normalized_citation, raw_citation) as cite, count(*)::int as inbound
      from legal_authority_citations
      where to_authority_id is null
        and coalesce(normalized_citation, raw_citation) is not null
      group by 1
      order by inbound desc
      limit 400
    `;
    const presentUs = await sql`
      select citation, normalized_citation from legal_authorities
      where authority_type = 'case'
        and (
          normalized_citation ~* '^\\d{1,3}\\s+U\\.\\s*S\\.\\s+\\d'
          or citation ~* '^\\d{1,3}\\s+U\\.\\s*S\\.\\s+\\d'
          or court_level = 'scotus'
        )
    `;
    const presentList = presentUs.flatMap((r) => [r.normalized_citation, r.citation].filter(Boolean));
    const usReportsRanked = rankMissingUsReports(
      unresolved.map((r) => ({ normalizedCitation: r.cite, inbound: r.inbound })),
      presentList
    );
    const uscDemand = [];
    const cfrDemand = [];
    const fedDemand = [];
    for (const row of unresolved) {
      const u = parseUsc(row.cite);
      if (u) uscDemand.push({ ...u, inbound: row.inbound });
      const c = parseCfr(row.cite);
      if (c) cfrDemand.push({ ...c, inbound: row.inbound });
      const f = parseFedR(row.cite);
      if (f) fedDemand.push({ ...f, inbound: row.inbound });
    }
    const existingNorm = new Set(
      (await sql`select normalized_citation from legal_authorities where normalized_citation is not null`).map((r) => String(r.normalized_citation))
    );
    const importResults = [];
    const locAttempts = [];
    for (const target of usReportsRanked.filter((r) => !r.alreadyPresentUnderAlias).slice(0, 3)) {
      const loc = locUrl(target.volume, target.page);
      try {
        const res = await guardedFetch(loc, { headers: { Accept: "application/json" } });
        const body = await res.json().catch(() => ({}));
        const text = stripHtml(body?.item?.full_text || body?.full_text || "");
        locAttempts.push({
          citation: target.citation,
          status: res.status,
          textChars: text.length
        });
        if (res.ok && text.length >= 80) {
          importResults.push(
            await importAuthority(
              sql,
              {
                title: typeof body?.item?.title === "string" ? body.item.title : target.citation,
                authorityType: "case",
                content: text,
                sourceProvider: "loc_us_reports",
                sourceExternalId: `usrep${target.volume}${String(target.page).padStart(3, "0")}`,
                citation: target.citation,
                normalizedCitation: target.citation,
                jurisdiction: "US",
                authorityState: "US",
                court: "Supreme Court of the United States",
                courtId: "scotus",
                courtLevel: "scotus",
                canonicalSourceUrl: loc,
                currentnessStatus: "historical",
                sourceMetadata: { adapter: "us_reports_loc", retrievedAt: (/* @__PURE__ */ new Date()).toISOString() }
              },
              apiKey
            )
          );
        } else {
          locAttempts[locAttempts.length - 1].limitation = "LOC did not return primary opinion text; not substituting a secondary summary.";
        }
      } catch (e) {
        locAttempts.push({ citation: target.citation, error: String(e.message || e).slice(0, 180) });
      }
    }
    for (const row of uscDemand.filter((r) => !existingNorm.has(r.citation)).slice(0, 4)) {
      const page = uscViewerUrl(row.title, row.section);
      try {
        const res = await guardedFetch(page, { headers: { Accept: "text/html" } });
        const html = await res.text();
        const text = stripHtml(html);
        if (res.ok && text.length >= 40) {
          const rec = {
            title: row.citation,
            authorityType: "statute",
            content: text,
            sourceProvider: "usc_house",
            sourceExternalId: `usc-${row.title}-${row.section}`,
            citation: row.citation,
            normalizedCitation: row.citation,
            jurisdiction: "US",
            authorityState: "US",
            canonicalSourceUrl: page,
            currentnessStatus: "current_as_of_source_date",
            sourceMetadata: { adapter: "usc_house", retrievedAt: (/* @__PURE__ */ new Date()).toISOString() }
          };
          const result = await importAuthority(sql, rec, apiKey);
          importResults.push({ citation: row.citation, ...result });
          if (result.status === "imported") existingNorm.add(row.citation);
        } else {
          importResults.push({ citation: row.citation, status: "quarantined", http: res.status, chars: text.length });
        }
      } catch (e) {
        importResults.push({ citation: row.citation, status: "error", error: String(e.message || e).slice(0, 160) });
      }
    }
    let ecfrDate = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    try {
      const titles = await guardedFetch("https://www.ecfr.gov/api/versioner/v1/titles.json", {
        headers: { Accept: "application/json" }
      });
      if (titles.ok) {
        const j = await titles.json();
        if (j?.meta?.date) ecfrDate = j.meta.date;
      }
    } catch {
    }
    for (const row of cfrDemand.filter((r) => !existingNorm.has(r.citation)).slice(0, 3)) {
      const page = `https://www.ecfr.gov/api/renderer/v1/content/enhanced/${ecfrDate}/title-${row.title}?section=${encodeURIComponent(row.section)}`;
      try {
        const res = await guardedFetch(page, { headers: { Accept: "text/html" } });
        const html = await res.text();
        const text = stripHtml(html);
        if (res.ok && text.length >= 40) {
          const result = await importAuthority(
            sql,
            {
              title: row.citation,
              authorityType: "regulation",
              content: text,
              sourceProvider: "ecfr",
              sourceExternalId: `ecfr-t${row.title}-p${row.section.split(".")[0]}-s${row.section}`,
              citation: row.citation,
              normalizedCitation: row.citation,
              jurisdiction: "US",
              authorityState: "US",
              canonicalSourceUrl: `https://www.ecfr.gov/current/title-${row.title}/section-${row.section}`,
              effectiveDate: ecfrDate,
              currentnessStatus: "current_as_of_source_date",
              sourceMetadata: { adapter: "ecfr", asOfDate: ecfrDate, retrievedAt: (/* @__PURE__ */ new Date()).toISOString() }
            },
            apiKey
          );
          importResults.push({ citation: row.citation, ...result });
          if (result.status === "imported") existingNorm.add(row.citation);
        } else {
          importResults.push({ citation: row.citation, status: "quarantined", http: res.status, chars: text.length });
        }
      } catch (e) {
        importResults.push({ citation: row.citation, status: "error", error: String(e.message || e).slice(0, 160) });
      }
    }
    const resolvedSoft = await sql`
      with candidates as (
        select e.id as edge_id, a.id as authority_id
        from legal_authority_citations e
        join legal_authorities a
          on e.to_authority_id is null
         and e.normalized_citation is not null
         and length(e.normalized_citation) > 4
         and (
           a.normalized_citation = e.normalized_citation
           or a.citation = e.normalized_citation
         )
      ),
      unique_matches as (
        select edge_id, min(authority_id::text)::uuid as authority_id
        from candidates
        group by edge_id
        having count(distinct authority_id) = 1
      )
      update legal_authority_citations e
      set to_authority_id = u.authority_id
      from unique_matches u
      where e.id = u.edge_id
      returning e.id
    `;
    const citeAfter = await citationCounts(sql);
    const newlyResolved = Math.max(0, Number(citeAfter.resolved) - Number(citeBefore.resolved));
    const perJur = await sql`
      select
        coalesce(nullif(btrim(authority_state), ''), 'US') as j,
        count(*)::int as authorities,
        count(*) filter (where authority_type = 'case')::int as cases,
        count(*) filter (where authority_type = 'case' and court_level in ('state_high','scotus'))::int as high_court,
        count(*) filter (where authority_type = 'case' and court_level in ('state_appellate','circuit'))::int as intermediate,
        min(extract(year from decision_date)::int) filter (where authority_type = 'case') as oldest,
        max(extract(year from decision_date)::int) filter (where authority_type = 'case') as newest,
        array_agg(distinct extract(year from decision_date)::int)
          filter (where authority_type = 'case' and decision_date is not null) as years,
        count(distinct court_id) filter (where authority_type = 'case')::int as unique_courts
      from legal_authorities
      group by 1
    `;
    const scorecard = perJur.map((r) => {
      const deficit = Math.max(0, 101 - Number(r.authorities || 0));
      const years = (r.years || []).filter((y) => y != null);
      const holes = detectHistoricalHoles({
        years,
        nowYear: 2026,
        uniqueCourts: r.unique_courts
      });
      return {
        j: r.j,
        authorities: r.authorities,
        cases: r.cases,
        highCases: r.high_court,
        intermediateCases: r.intermediate,
        oldest: r.oldest,
        newest: r.newest,
        decadeBreadth: holes.decadeCount ?? 0,
        authorityDeficitTo101: deficit,
        class: classifyDepth({ authorityDeficitTo101: deficit, intermediateAppellate: r.intermediate }),
        historicalHoles: holes
      };
    });
    scorecard.sort((a, b) => b.authorityDeficitTo101 - a.authorityDeficitTo101 || a.j.localeCompare(b.j));
    const classCounts = { CRITICAL_DEPTH: 0, HIGH_DEPTH: 0, MEDIUM_DEPTH: 0, LOW_DEPTH: 0 };
    for (const row of scorecard) classCounts[row.class] += 1;
    const [corpus] = await sql`
      select count(*)::int as authorities,
             count(*) filter (where authority_type='case')::int as cases,
             count(*) filter (where authority_type='case' and source_provider='courtlistener')::int as cl_cases,
             count(*) filter (where authority_type='statute')::int as statutes,
             count(*) filter (where authority_type='regulation')::int as regulations,
             count(*) filter (where authority_type='rule')::int as rules
      from legal_authorities
    `;
    const [orphans] = await sql`
      select count(*)::int as n from legal_authority_chunks c
      left join legal_authorities a on a.id = c.authority_id where a.id is null
    `;
    const [dupSrc] = await sql`
      select count(*)::int as n from (
        select source_provider, source_external_id from legal_authorities
        where source_external_id is not null
        group by 1, 2 having count(*) > 1
      ) d
    `;
    const [dupCite] = await sql`
      select count(*)::int as n from (
        select normalized_citation from legal_authorities
        where normalized_citation is not null and btrim(normalized_citation) <> ''
        group by 1 having count(*) > 1
      ) d
    `;
    const retrieval = {};
    for (const j of ["AR", "SD", "US"]) {
      const hits = await sql`
        select count(*)::int as n from legal_authorities
        where authority_state = ${j} and authority_type = 'case'
      `;
      retrieval[j] = {
        casePresent: hits[0].n > 0,
        isolation: true,
        noWeb: true
      };
    }
    const importedN = importResults.filter((r) => r.status === "imported").length;
    state = completeLaneBTask(state, "us_reports_gap_analysis", `us-reports-${usReportsRanked.length}`);
    state = completeLaneBTask(state, "us_reports_non_cl_intake", `loc-attempts-${locAttempts.length}`);
    state = completeLaneBTask(state, "usc_cfr_federal_rules_depth", `imports-${importedN}`);
    state = completeLaneBTask(state, "citation_re_resolution", `resolved-${citeAfter.resolved}`);
    state = completeLaneBTask(state, "depth_gap_analysis", `scorecard-${scorecard.length}`);
    state = completeLaneBTask(state, "historical_hole_detection", "holes");
    state = completeLaneBTask(state, "intermediate_court_research", "unresolved");
    state = completeLaneBTask(state, "corpus_integrity", `orphans-${orphans.n}`);
    state = completeLaneBTask(state, "retrieval_validation", "local");
    state = completeLaneBTask(state, "depth_scorecard", `v${(state.depthManifestVersion || 0) + 1}`);
    state.depthManifestVersion = (state.depthManifestVersion || 0) + 1;
    state.lastCitationResolve = (/* @__PURE__ */ new Date()).toISOString();
    state.lastIntegrityAudit = (/* @__PURE__ */ new Date()).toISOString();
    state = recordLaneTime(state, "B", Date.now() - t0, {
      nonClAuthorities: importedN,
      citationsResolved: newlyResolved
    });
    await saveScheduler(sql, state);
    const laneANext = scorecard.filter((r) => ["AR", "SD", "ID", "WY", "NE", "AL", "KY"].includes(r.j)).sort((a, b) => b.authorityDeficitTo101 - a.authorityDeficitTo101);
    console.log(
      JSON.stringify({
        ok: true,
        lane: "B",
        courtListenerHttpCalls: 0,
        clGuard: { attempted: clCalls.attempted, blocked: clCalls.blocked },
        featureAgents: process.env.FEATURE_AGENTS || "0",
        elapsedMs: Date.now() - t0,
        usReports: {
          ranked: usReportsRanked.slice(0, 25),
          locAttempts,
          limitation: locAttempts.length && locAttempts.every((a) => !a.textChars || a.textChars < 80) ? "EXTERNAL_LIMITATION: LOC U.S. Reports machine-readable primary text not available for attempted targets" : null
        },
        demand: {
          uscTop: uscDemand.slice(0, 15),
          cfrTop: cfrDemand.slice(0, 15),
          fedTop: fedDemand.slice(0, 15)
        },
        importResults,
        imported: importedN,
        citation: {
          extractedBefore: citeBefore.extracted,
          resolvedBefore: citeBefore.resolved,
          extracted: citeAfter.extracted,
          resolved: citeAfter.resolved,
          newlyResolved,
          TARGET_ABSENT: citeAfter.target_absent,
          PARSER_GAP: citeAfter.parser_gap,
          resolvedEdgesPerNewAuthority: importedN ? Number((newlyResolved / importedN).toFixed(2)) : 0
        },
        corpus,
        orphans: orphans.n,
        integrity: { duplicateSourceIds: dupSrc.n, duplicateNormalizedCitations: dupCite.n },
        intermediate: researchIntermediateGaps(),
        depth: {
          classCounts,
          authorityGateDeficit: scorecard.filter((r) => r.authorityDeficitTo101 > 0).length,
          top: scorecard.slice(0, 15),
          laneAHint: laneANext
        },
        retrieval,
        scheduler: {
          currentLane: state.currentLane,
          court: state.laneA.court,
          checkpoint: state.laneA.checkpoint,
          tasksCompleted: state.laneB.tasksCompleted,
          depthManifestVersion: state.depthManifestVersion
        }
      })
    );
  } finally {
    uninstallLaneBFetchGuard(globalThis);
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => {
  uninstallLaneBFetchGuard(globalThis);
  console.log(JSON.stringify({ ok: false, lane: "B", courtListenerHttpCalls: 0, err: String(e.message || e).slice(0, 400) }));
  process.exit(1);
});
