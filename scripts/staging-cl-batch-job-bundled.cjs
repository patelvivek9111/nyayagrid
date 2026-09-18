var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// scripts/staging-cl-batch-job.ts
var import_node_crypto = require("node:crypto");

// node_modules/postgres/src/index.js
var import_os = __toESM(require("os"), 1);
var import_fs = __toESM(require("fs"), 1);

// node_modules/postgres/src/query.js
var originCache = /* @__PURE__ */ new Map();
var originStackCache = /* @__PURE__ */ new Map();
var originError = Symbol("OriginError");
var CLOSE = {};
var Query = class extends Promise {
  constructor(strings, args, handler, canceller, options = {}) {
    let resolve, reject;
    super((a, b2) => {
      resolve = a;
      reject = b2;
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

// node_modules/postgres/src/errors.js
var PostgresError = class extends Error {
  constructor(x) {
    super(x.message);
    this.name = this.constructor.name;
    Object.assign(this, x);
  }
};
var Errors = {
  connection,
  postgres,
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
function postgres(x) {
  const error = new PostgresError(x);
  Error.captureStackTrace(error, postgres);
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

// node_modules/postgres/src/types.js
var types = {
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
var Identifier = class extends NotTagged {
  constructor(value) {
    super();
    this.value = escapeIdentifier(value);
  }
};
var Parameter = class extends NotTagged {
  constructor(value, type, array) {
    super();
    this.value = value;
    this.type = type;
    this.array = array;
  }
};
var Builder = class extends NotTagged {
  constructor(first, rest) {
    super();
    this.first = first;
    this.rest = rest;
  }
  build(before, parameters, types2, options) {
    const keyword = builders.map(([x, fn]) => ({ fn, i: before.search(x) })).sort((a, b2) => a.i - b2.i).pop();
    return keyword.i === -1 ? escapeIdentifiers(this.first, options) : keyword.fn(this.first, this.rest, parameters, types2, options);
  }
};
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
var serializers = defaultHandlers.serializers;
var parsers = defaultHandlers.parsers;
function firstIsString(x) {
  if (Array.isArray(x))
    return firstIsString(x[0]);
  return typeof x === "string" ? 1009 : 0;
}
var mergeUserTypes = function(types2) {
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
var escapeIdentifier = function escape(str) {
  return '"' + str.replace(/"/g, '""').replace(/\./g, '"."') + '"';
};
var inferType = function inferType2(x) {
  return x instanceof Parameter ? x.type : x instanceof Date ? 1184 : x instanceof Uint8Array ? 17 : x === true || x === false ? 16 : typeof x === "bigint" ? 20 : Array.isArray(x) ? inferType2(x[0]) : 0;
};
var escapeBackslash = /\\/g;
var escapeQuote = /"/g;
function arrayEscape(x) {
  return x.replace(escapeBackslash, "\\\\").replace(escapeQuote, '\\"');
}
var arraySerializer = function arraySerializer2(xs, serializer, options, typarray) {
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
var arrayParser = function arrayParser2(x, parser, typarray) {
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
var toCamel = (x) => {
  let str = x[0];
  for (let i = 1; i < x.length; i++)
    str += x[i] === "_" ? x[++i].toUpperCase() : x[i];
  return str;
};
var toPascal = (x) => {
  let str = x[0].toUpperCase();
  for (let i = 1; i < x.length; i++)
    str += x[i] === "_" ? x[++i].toUpperCase() : x[i];
  return str;
};
var toKebab = (x) => x.replace(/_/g, "-");
var fromCamel = (x) => x.replace(/([A-Z])/g, "_$1").toLowerCase();
var fromPascal = (x) => (x.slice(0, 1) + x.slice(1).replace(/([A-Z])/g, "_$1")).toLowerCase();
var fromKebab = (x) => x.replace(/-/g, "_");
function createJsonTransform(fn) {
  return function jsonTransform(x, column) {
    return typeof x === "object" && x !== null && (column.type === 114 || column.type === 3802) ? Array.isArray(x) ? x.map((x2) => jsonTransform(x2, column)) : Object.entries(x).reduce((acc, [k, v]) => Object.assign(acc, { [fn(k)]: jsonTransform(v, column) }), {}) : x;
  };
}
toCamel.column = { from: toCamel };
toCamel.value = { from: createJsonTransform(toCamel) };
fromCamel.column = { to: fromCamel };
var camel = { ...toCamel };
camel.column.to = fromCamel;
toPascal.column = { from: toPascal };
toPascal.value = { from: createJsonTransform(toPascal) };
fromPascal.column = { to: fromPascal };
var pascal = { ...toPascal };
pascal.column.to = fromPascal;
toKebab.column = { from: toKebab };
toKebab.value = { from: createJsonTransform(toKebab) };
fromKebab.column = { to: fromKebab };
var kebab = { ...toKebab };
kebab.column.to = fromKebab;

// node_modules/postgres/src/connection.js
var import_net = __toESM(require("net"), 1);
var import_tls = __toESM(require("tls"), 1);
var import_crypto = __toESM(require("crypto"), 1);
var import_stream = __toESM(require("stream"), 1);
var import_perf_hooks = require("perf_hooks");

// node_modules/postgres/src/result.js
var Result = class extends Array {
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

// node_modules/postgres/src/queue.js
var queue_default = Queue;
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

// node_modules/postgres/src/bytes.js
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
var bytes_default = b;
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

// node_modules/postgres/src/connection.js
var connection_default = Connection;
var uid = 1;
var Sync = bytes_default().S().end();
var Flush = bytes_default().H().end();
var SSLRequest = bytes_default().i32(8).i32(80877103).end(8);
var ExecuteUnnamed = Buffer.concat([bytes_default().E().str(bytes_default.N).i32(0).end(), Sync]);
var DescribeUnnamed = bytes_default().D().str("S").str(bytes_default.N).end();
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
    parsers: parsers2,
    transform,
    onnotice,
    onnotify,
    onparameter,
    max_pipeline,
    keep_alive,
    backoff: backoff2,
    target_session_attrs
  } = options;
  const sent = queue_default(), id = uid++, backend = { pid: null, secret: null }, idleTimer = timer(end, options.idle_timeout), lifeTimer = timer(end, options.max_lifetime), connectTimer = timer(connectTimedOut, options.connect_timeout);
  let socket = null, cancelMessage, errorResponse = null, result = new Result(), incoming = Buffer.alloc(0), needsTypes = options.fetch_types, backendParameters = {}, statements = {}, statementId = Math.random().toString(36).slice(2), statementCount = 1, closedTime = 0, remaining = 0, hostIndex = 0, retries = 0, length = 0, delay = 0, rows = 0, serverSignature = null, nextWriteTimer = null, terminated = false, incomings = null, results = null, initial = null, ending = null, stream = null, chunk = null, ended = null, nonce = null, query = null, final = null;
  const connection2 = {
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
  queues.closed && queues.closed.push(connection2);
  return connection2;
  async function createSocket() {
    let x;
    try {
      x = options.socket ? await Promise.resolve(options.socket(options)) : new import_net.default.Socket();
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
      cancelMessage = bytes_default().i32(16).i32(80877102).i32(pid).i32(secret).end(16);
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
      return write(toBuffer(q)) && !q.describeFirst && !q.cursorFn && sent.length < max_pipeline && (!q.options.onexecute || q.options.onexecute(connection2));
    } catch (error2) {
      sent.length === 0 && write(Sync);
      errored(error2);
      return true;
    }
  }
  function toBuffer(q) {
    if (q.parameters.length >= 65534)
      throw Errors.generic("MAX_PARAMETERS_EXCEEDED", "Max number of parameters (65534) exceeded");
    return q.options.simple ? bytes_default().Q().str(q.statement.string + bytes_default.N).end() : q.describeFirst ? Buffer.concat([describe(q), Flush]) : q.prepare ? q.prepared ? prepared(q) : Buffer.concat([describe(q), prepared(q)]) : unnamed(q);
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
    const parameters = [], types2 = [];
    const string = stringify(q, q.strings[0], q.args[0], parameters, types2, options);
    !q.tagged && q.args.forEach((x) => handleValue(x, parameters, types2, options));
    q.prepare = options.prepare && ("prepare" in q.options ? q.options.prepare : true);
    q.string = string;
    q.signature = q.prepare && types2 + string;
    q.onlyDescribe && delete statements[q.signature];
    q.parameters = q.parameters || parameters;
    q.prepared = q.prepare && q.signature in statements;
    q.describeFirst = q.onlyDescribe || parameters.length && !q.prepared;
    q.statement = q.prepared ? statements[q.signature] : { string, types: types2, name: q.prepare ? statementId + statementCount++ : "" };
    typeof options.debug === "function" && options.debug(id, string, parameters, types2);
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
      servername: import_net.default.isIP(socket.host) ? void 0 : socket.host
    };
    if (sslnegotiation === "direct")
      options2.ALPNProtocols = ["postgresql"];
    if (ssl === "require" || ssl === "allow" || ssl === "prefer")
      options2.rejectUnauthorized = false;
    else if (typeof ssl === "object")
      Object.assign(options2, ssl);
    socket.removeAllListeners();
    socket = import_tls.default.connect(options2);
    socket.on("secureConnect", connected);
    socket.on("error", error);
    socket.on("close", closed);
    socket.on("drain", drain);
  }
  function drain() {
    !query && onopen(connection2);
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
    setTimeout(connect, closedTime ? Math.max(0, closedTime + delay - import_perf_hooks.performance.now()) : 0);
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
    if (connection2.queue === queues.connecting && options.host[retries + 1])
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
    return ending || (!connection2.reserved && onend(connection2), !connection2.reserved && !initial && !query && sent.length === 0 ? (terminate(), new Promise((r) => socket && socket.readyState !== "closed" ? socket.once("close", r) : r())) : ending = new Promise((r) => ended = r));
  }
  function terminate() {
    terminated = true;
    if (stream || query || initial || sent.length)
      error(Errors.connection("CONNECTION_DESTROYED", options));
    clearImmediate(nextWriteTimer);
    if (socket) {
      socket.removeListener("data", data);
      socket.removeListener("connect", connected);
      socket.readyState === "open" && socket.end(bytes_default().X().end());
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
    closedTime = import_perf_hooks.performance.now();
    hadError && options.shared.retries++;
    delay = (typeof backoff2 === "function" ? backoff2(options.shared.retries) : backoff2) * 1e3;
    onclose(connection2, Errors.connection("CONNECTION_CLOSED", options, socket));
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
    const [k, v] = x.toString("utf8", 5, x.length - 1).split(bytes_default.N);
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
    connection2.reserved ? !connection2.reserved.release && x[5] === 73 ? ending ? terminate() : (connection2.reserved = null, onopen(connection2)) : connection2.reserved() : ending ? terminate() : onopen(connection2);
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
    if (result.command === "BEGIN" && max !== 1 && !connection2.reserved)
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
        parser: parsers2[type],
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
      bytes_default().p().str(payload).z(1).end()
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
      bytes_default().p().str(payload).z(1).end()
    );
  }
  async function SASL() {
    nonce = (await import_crypto.default.randomBytes(18)).toString("base64");
    bytes_default().p().str("SCRAM-SHA-256" + bytes_default.N);
    const i = bytes_default.i;
    write(bytes_default.inc(4).str("n,,n=*,r=" + nonce).i32(bytes_default.i - i - 4, i).end());
  }
  async function SASLContinue(x) {
    const res = x.toString("utf8", 9).split(",").reduce((acc, x2) => (acc[x2[0]] = x2.slice(2), acc), {});
    const saltedPassword = await import_crypto.default.pbkdf2Sync(
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
      Buffer.from(await hmac(await sha256(clientKey), auth))
    ).toString("base64");
    write(
      bytes_default().p().str(payload).end()
    );
  }
  function SASLFinal(x) {
    if (x.toString("utf8", 9).split(bytes_default.N, 1)[0].slice(2) === serverSignature)
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
    const types2 = await new Query([`
      select b.oid, b.typarray
      from pg_catalog.pg_type a
      left join pg_catalog.pg_type b on b.oid = a.typelem
      where a.typcategory = 'A'
      group by b.oid, b.typarray
      order by b.oid
    `], [], execute);
    types2.forEach(({ oid, typarray }) => addArrayType(oid, typarray));
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
    stream = new import_stream.default.Writable({
      autoDestroy: true,
      write(chunk2, encoding, callback) {
        socket.write(bytes_default().d().raw(chunk2).end(), callback);
      },
      destroy(error2, callback) {
        callback(error2);
        socket.write(bytes_default().f().str(error2 + bytes_default.N).end());
        stream = null;
      },
      final(callback) {
        socket.write(bytes_default().c().end());
        final = callback;
        stream = null;
      }
    });
    query.resolve(stream);
  }
  function CopyOutResponse() {
    stream = new import_stream.default.Readable({
      read() {
        socket.resume();
      }
    });
    query.resolve(stream);
  }
  function CopyBothResponse() {
    stream = new import_stream.default.Duplex({
      autoDestroy: true,
      read() {
        socket.resume();
      },
      /* c8 ignore next 11 */
      write(chunk2, encoding, callback) {
        socket.write(bytes_default().d().raw(chunk2).end(), callback);
      },
      destroy(error2, callback) {
        callback(error2);
        socket.write(bytes_default().f().str(error2 + bytes_default.N).end());
        stream = null;
      },
      final(callback) {
        socket.write(bytes_default().c().end());
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
  function Bind(parameters, types2, statement = "", portal = "") {
    let prev, type;
    bytes_default().B().str(portal + bytes_default.N).str(statement + bytes_default.N).i16(0).i16(parameters.length);
    parameters.forEach((x, i) => {
      if (x === null)
        return bytes_default.i32(4294967295);
      type = types2[i];
      parameters[i] = x = type in options.serializers ? options.serializers[type](x) : "" + x;
      prev = bytes_default.i;
      bytes_default.inc(4).str(x).i32(bytes_default.i - prev - 4, prev);
    });
    bytes_default.i16(0);
    return bytes_default.end();
  }
  function Parse(str, parameters, types2, name = "") {
    bytes_default().P().str(name + bytes_default.N).str(str + bytes_default.N).i16(parameters.length);
    parameters.forEach((x, i) => bytes_default.i32(types2[i] || 0));
    return bytes_default.end();
  }
  function Describe(x, name = "") {
    return bytes_default().D().str(x).str(name + bytes_default.N).end();
  }
  function Execute(portal = "", rows2 = 0) {
    return Buffer.concat([
      bytes_default().E().str(portal + bytes_default.N).i32(rows2).end(),
      Flush
    ]);
  }
  function Close(portal = "") {
    return Buffer.concat([
      bytes_default().C().str("P").str(portal + bytes_default.N).end(),
      bytes_default().S().end()
    ]);
  }
  function StartupMessage() {
    return cancelMessage || bytes_default().inc(4).i16(3).z(2).str(
      Object.entries(Object.assign(
        {
          user,
          database,
          client_encoding: "UTF8"
        },
        options.connection
      )).filter(([, v]) => v).map(([k, v]) => k + bytes_default.N + v).join(bytes_default.N)
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
  return import_crypto.default.createHash("md5").update(x).digest("hex");
}
function hmac(key, x) {
  return import_crypto.default.createHmac("sha256", key).update(x).digest();
}
function sha256(x) {
  return import_crypto.default.createHash("sha256").update(x).digest();
}
function xor(a, b2) {
  const length = Math.max(a.length, b2.length);
  const buffer2 = Buffer.allocUnsafe(length);
  for (let i = 0; i < length; i++)
    buffer2[i] = a[i] ^ b2[i];
  return buffer2;
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

// node_modules/postgres/src/subscribe.js
var noop2 = () => {
};
function Subscribe(postgres2, options) {
  const subscribers = /* @__PURE__ */ new Map(), slot = "postgresjs_" + Math.random().toString(36).slice(2), state = {};
  let connection2, stream, ended = false;
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
  async function subscribe(event, fn, onsubscribe = noop2, onerror = noop2) {
    event = parseEvent(event);
    if (!connection2)
      connection2 = init(sql, slot, options.publications);
    const subscriber = { fn, onsubscribe };
    const fns = subscribers.has(event) ? subscribers.get(event).add(subscriber) : subscribers.set(event, /* @__PURE__ */ new Set([subscriber])).get(event);
    const unsubscribe = () => {
      fns.delete(subscriber);
      fns.size === 0 && subscribers.delete(event);
    };
    return connection2.then((x) => {
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
    function handle(a, b2) {
      const path = b2.relation.schema + "." + b2.relation.table;
      call("*", a, b2);
      call("*:" + path, a, b2);
      b2.relation.keys.length && call("*:" + path + "=" + b2.relation.keys.map((x2) => a[x2.name]), a, b2);
      call(b2.command, a, b2);
      call(b2.command + ":" + path, a, b2);
      b2.relation.keys.length && call(b2.command + ":" + path + "=" + b2.relation.keys.map((x2) => a[x2.name]), a, b2);
    }
    function pong() {
      const x2 = Buffer.alloc(34);
      x2[0] = "r".charCodeAt(0);
      x2.fill(state2.lsn, 1);
      x2.writeBigInt64BE(BigInt(Date.now() - Date.UTC(2e3, 0, 1)) * BigInt(1e3), 25);
      stream2.write(x2);
    }
  }
  function call(x, a, b2) {
    subscribers.has(x) && subscribers.get(x).forEach(({ fn }) => fn(a, b2, x));
  }
}
function Time(x) {
  return new Date(Date.UTC(2e3, 0, 1) + Number(x / BigInt(1e3)));
}
function parse(x, state, parsers2, handle, transform) {
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
          parser: parsers2[x2.readUInt32BE(i)],
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

// node_modules/postgres/src/large.js
var import_stream2 = __toESM(require("stream"), 1);
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
        return new import_stream2.default.Readable({
          highWaterMark,
          async read(size2) {
            const l = size2 > max ? size2 - max : size2;
            max -= size2;
            const [{ data }] = await lo.read(l);
            this.push(data);
            if (data.length < size2)
              this.push(null);
          }
        });
      }
      async function writable({
        highWaterMark = 2048 * 8,
        start = 0
      } = {}) {
        start && await lo.seek(start);
        return new import_stream2.default.Writable({
          highWaterMark,
          write(chunk, encoding, callback) {
            lo.write(chunk).then(() => callback(), callback);
          }
        });
      }
    }).catch(reject);
  });
}

// node_modules/postgres/src/index.js
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
var src_default = Postgres;
function Postgres(a, b2) {
  const options = parseOptions(a, b2), subscribe = options.no_subscribe || Subscribe(Postgres, { ...options });
  let ending = false;
  const queries = queue_default(), connecting = queue_default(), reserved = queue_default(), closed = queue_default(), ended = queue_default(), open = queue_default(), busy = queue_default(), full = queue_default(), queues = { connecting, reserved, closed, ended, open, busy, full };
  const connections = [...Array(options.max)].map(() => connection_default(options, queues, { onopen, onend, onclose }));
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
        import_fs.default.readFile(path, "utf8", (err, string) => {
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
    const queue = queue_default();
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
    const queries2 = queue_default();
    let savepoints = 0, connection2, prepare = null;
    try {
      await sql.unsafe("begin " + options2.replace(/[^a-z ]/ig, ""), [], { onexecute }).execute();
      return await Promise.race([
        scope(connection2, fn),
        new Promise((_, reject) => connection2.onclose = reject)
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
      connection2 = c;
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
      query.state ? query.active ? connection_default(options).cancel(query.state, resolve, reject) : query.cancelled = { resolve, reject } : (queries.remove(query), query.cancelled = true, query.reject(Errors.generic("57014", "canceling statement due to user request")), resolve());
    });
  }
  async function end({ timeout = null } = {}) {
    if (ending)
      return ending;
    await 1;
    let timer2;
    return ending = Promise.race([
      new Promise((r) => timeout !== null && (timer2 = setTimeout(destroy, timeout * 1e3, r))),
      Promise.all(connections.map((c) => c.end()).concat(
        listen.sql ? listen.sql.end({ timeout: 0 }) : [],
        subscribe.sql ? subscribe.sql.end({ timeout: 0 }) : []
      ))
    ]).then(() => clearTimeout(timer2));
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
function parseOptions(a, b2) {
  if (a && a.shared)
    return a;
  const env = process.env, o = (!a || typeof a === "string" ? b2 : a) || {}, { url, multihost } = parseUrl(a), query = [...url.searchParams].reduce((a2, [b3, c]) => (a2[b3] = c, a2), {}), host = o.hostname || o.host || multihost || url.hostname || env.PGHOST || "localhost", port = o.port || url.port || env.PGPORT || 5432, user = o.user || o.username || url.username || env.PGUSERNAME || env.PGUSER || osUsername();
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
    return import_os.default.userInfo().username;
  } catch (_) {
    return process.env.USERNAME || process.env.USER || process.env.LOGNAME;
  }
}

// scripts/staging-cl-batch-job.ts
var CL_BASE = "https://www.courtlistener.com/api/rest/v4";
var EMBEDDING_MODEL = "text-embedding-3-small";
var EMBEDDING_DIMS = 384;
var EMBEDDING_BATCH_SIZE = 32;
var MAX_CHUNK_CHARS = 1e3;
var MAX_OPINION_CHARS = 4e4;
var SOURCE = "courtlistener";
var CL_COURT_MAP = {
  scotus: {
    courtId: "us-scotus",
    courtLevel: "scotus",
    authorityState: "US",
    courtName: "Supreme Court of the United States",
    federalCircuit: null,
    jurisdiction: "United States"
  },
  ca1: { courtId: "us-ca-1", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the First Circuit", federalCircuit: "1", jurisdiction: "United States" },
  ca2: { courtId: "us-ca-2", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Second Circuit", federalCircuit: "2", jurisdiction: "United States" },
  ca3: { courtId: "us-ca-3", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Third Circuit", federalCircuit: "3", jurisdiction: "United States" },
  ca4: { courtId: "us-ca-4", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Fourth Circuit", federalCircuit: "4", jurisdiction: "United States" },
  ca5: { courtId: "us-ca-5", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Fifth Circuit", federalCircuit: "5", jurisdiction: "United States" },
  ca6: { courtId: "us-ca-6", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Sixth Circuit", federalCircuit: "6", jurisdiction: "United States" },
  ca7: { courtId: "us-ca-7", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Seventh Circuit", federalCircuit: "7", jurisdiction: "United States" },
  ca8: { courtId: "us-ca-8", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Eighth Circuit", federalCircuit: "8", jurisdiction: "United States" },
  ca9: { courtId: "us-ca-9", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Ninth Circuit", federalCircuit: "9", jurisdiction: "United States" },
  ca10: { courtId: "us-ca-10", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Tenth Circuit", federalCircuit: "10", jurisdiction: "United States" },
  ca11: { courtId: "us-ca-11", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Eleventh Circuit", federalCircuit: "11", jurisdiction: "United States" },
  cadc: { courtId: "us-ca-dc", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the District of Columbia Circuit", federalCircuit: "dc", jurisdiction: "United States" },
  cafc: { courtId: "us-ca-fed", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Federal Circuit", federalCircuit: "fed", jurisdiction: "United States" },
  cal: { courtId: "st-ca-high", courtLevel: "state_high", authorityState: "CA", courtName: "Supreme Court of California", federalCircuit: null, jurisdiction: "CA" },
  calctapp: { courtId: "st-ca-app", courtLevel: "state_appellate", authorityState: "CA", courtName: "California Court of Appeal", federalCircuit: null, jurisdiction: "CA" },
  ny: { courtId: "st-ny-high", courtLevel: "state_high", authorityState: "NY", courtName: "New York Court of Appeals", federalCircuit: null, jurisdiction: "NY" },
  nyappdiv: { courtId: "st-ny-app", courtLevel: "state_appellate", authorityState: "NY", courtName: "New York Supreme Court, Appellate Division", federalCircuit: null, jurisdiction: "NY" },
  pa: { courtId: "st-pa-high", courtLevel: "state_high", authorityState: "PA", courtName: "Supreme Court of Pennsylvania", federalCircuit: null, jurisdiction: "PA" },
  pasuperct: { courtId: "st-pa-super", courtLevel: "state_appellate", authorityState: "PA", courtName: "Superior Court of Pennsylvania", federalCircuit: null, jurisdiction: "PA" },
  pacommwlth: { courtId: "st-pa-comm", courtLevel: "state_appellate", authorityState: "PA", courtName: "Commonwealth Court of Pennsylvania", federalCircuit: null, jurisdiction: "PA" },
  tex: { courtId: "st-tx-high", courtLevel: "state_high", authorityState: "TX", courtName: "Supreme Court of Texas", federalCircuit: null, jurisdiction: "TX" },
  texcrimapp: { courtId: "st-tx-crim-high", courtLevel: "state_high", authorityState: "TX", courtName: "Texas Court of Criminal Appeals", federalCircuit: null, jurisdiction: "TX" },
  texapp: { courtId: "st-tx-app", courtLevel: "state_appellate", authorityState: "TX", courtName: "Texas Courts of Appeals", federalCircuit: null, jurisdiction: "TX" },
  nj: { courtId: "st-nj-high", courtLevel: "state_high", authorityState: "NJ", courtName: "Supreme Court of New Jersey", federalCircuit: null, jurisdiction: "NJ" },
  njsuperct: { courtId: "st-nj-app", courtLevel: "state_appellate", authorityState: "NJ", courtName: "Superior Court of New Jersey, Appellate Division", federalCircuit: null, jurisdiction: "NJ" },
  fla: { courtId: "st-fl-high", courtLevel: "state_high", authorityState: "FL", courtName: "Supreme Court of Florida", federalCircuit: null, jurisdiction: "FL" },
  fladistctapp: { courtId: "st-fl-app", courtLevel: "state_appellate", authorityState: "FL", courtName: "Florida District Courts of Appeal", federalCircuit: null, jurisdiction: "FL" },
  ill: { courtId: "st-il-high", courtLevel: "state_high", authorityState: "IL", courtName: "Supreme Court of Illinois", federalCircuit: null, jurisdiction: "IL" },
  illappct: { courtId: "st-il-app", courtLevel: "state_appellate", authorityState: "IL", courtName: "Appellate Court of Illinois", federalCircuit: null, jurisdiction: "IL" },
  mass: { courtId: "st-ma-high", courtLevel: "state_high", authorityState: "MA", courtName: "Supreme Judicial Court of Massachusetts", federalCircuit: null, jurisdiction: "MA" },
  massappct: { courtId: "st-ma-app", courtLevel: "state_appellate", authorityState: "MA", courtName: "Massachusetts Appeals Court", federalCircuit: null, jurisdiction: "MA" },
  va: { courtId: "st-va-high", courtLevel: "state_high", authorityState: "VA", courtName: "Supreme Court of Virginia", federalCircuit: null, jurisdiction: "VA" },
  vacapp: { courtId: "st-va-app", courtLevel: "state_appellate", authorityState: "VA", courtName: "Court of Appeals of Virginia", federalCircuit: null, jurisdiction: "VA" },
  del: { courtId: "st-de-high", courtLevel: "state_high", authorityState: "DE", courtName: "Supreme Court of Delaware", federalCircuit: null, jurisdiction: "DE" }
};
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function sha256Hex(text) {
  return (0, import_node_crypto.createHash)("sha256").update(text, "utf8").digest("hex");
}
function sanitizeUntrustedLegalText(input) {
  return input.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, " ").replace(/javascript:/gi, "").replace(/ignore previous instructions/gi, "[redacted]").replace(/\s+/g, " ").trim();
}
function stripHtml(html) {
  return sanitizeUntrustedLegalText(html.replace(/<[^>]+>/g, " "));
}
function absoluteUrl(maybe) {
  if (!maybe) return null;
  try {
    return new URL(maybe, "https://www.courtlistener.com").toString();
  } catch {
    return maybe;
  }
}
function resolveOpinionId(hit) {
  if (hit.id != null && String(hit.id).trim() !== "") return String(hit.id);
  const nested = hit.opinions?.find((o) => o?.id != null);
  if (nested?.id != null) return String(nested.id);
  return null;
}
function resolveClusterId(hit) {
  if (hit.cluster_id != null && String(hit.cluster_id).trim() !== "") return String(hit.cluster_id);
  const c = hit.cluster;
  if (typeof c === "number") return String(c);
  if (typeof c === "string") {
    const m = c.match(/\/clusters\/(\d+)\/?/);
    if (m?.[1]) return m[1];
    if (/^\d+$/.test(c.trim())) return c.trim();
  }
  if (c && typeof c === "object" && c.id != null) return String(c.id);
  return null;
}
function pickCitation(hit) {
  if (Array.isArray(hit.citation) && hit.citation.length > 0) {
    return String(hit.citation[0]).trim() || null;
  }
  if (typeof hit.citation === "string" && hit.citation.trim()) return hit.citation.trim();
  return null;
}
function pickText(hit) {
  if (hit.plain_text && String(hit.plain_text).trim()) {
    return sanitizeUntrustedLegalText(String(hit.plain_text)).slice(0, MAX_OPINION_CHARS);
  }
  const html = hit.html_with_citations || hit.html || hit.snippet || "";
  return stripHtml(String(html)).slice(0, MAX_OPINION_CHARS);
}
function citationStatus(citation, docket) {
  if (citation && citation.trim()) return "reported";
  if (docket && docket.trim()) return "unreported";
  return "citation_unknown";
}
function normalizeCitation(raw) {
  return raw.replace(/\s+/g, " ").trim().toUpperCase();
}
function parseRetryAfterSec(res) {
  const h = res.headers.get("retry-after");
  if (!h) return null;
  const asInt = Number.parseInt(h, 10);
  if (Number.isFinite(asInt) && asInt >= 0) return Math.min(asInt, 3600);
  const when = Date.parse(h);
  if (Number.isFinite(when)) {
    const sec = Math.ceil((when - Date.now()) / 1e3);
    return sec > 0 ? Math.min(sec, 3600) : null;
  }
  return null;
}
var ClRateLimiter = class {
  constructor(apiKey, rateMs, maxRetries) {
    this.apiKey = apiKey;
    this.rateMs = rateMs;
    this.maxRetries = maxRetries;
  }
  chain = Promise.resolve();
  lastRequestAt = 0;
  globalPauseUntil = 0;
  apiCalls = 0;
  rateLimitHits = 0;
  lastRetryAfterSec = null;
  last429Endpoint = null;
  async fetch(url) {
    const run = async () => {
      let last = null;
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        const now = Date.now();
        const pauseLeft = Math.max(0, this.globalPauseUntil - now);
        const sinceLast = now - this.lastRequestAt;
        const spacing = Math.max(0, this.rateMs - sinceLast);
        const wait = Math.max(pauseLeft, spacing);
        if (wait > 0) await sleep(wait);
        this.apiCalls += 1;
        this.lastRequestAt = Date.now();
        last = await fetch(url, {
          headers: {
            Authorization: `Token ${this.apiKey}`,
            Accept: "application/json"
          },
          signal: AbortSignal.timeout(45e3)
        });
        if (last.status !== 429) return last;
        this.rateLimitHits += 1;
        this.last429Endpoint = url.split("?")[0] ?? url;
        const retryAfter = parseRetryAfterSec(last) ?? Math.min(
          Math.floor((this.rateMs * Math.pow(2, attempt + 1) + Math.random() * 1e3) / 1e3),
          120
        );
        this.lastRetryAfterSec = retryAfter;
        this.globalPauseUntil = Date.now() + retryAfter * 1e3;
        if (attempt >= this.maxRetries) return last;
        await sleep(retryAfter * 1e3);
      }
      return last;
    };
    const next = this.chain.then(run, run);
    this.chain = next.then(
      () => void 0,
      () => void 0
    );
    return next;
  }
};
async function ensureJobTable(sql) {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS corpus_ingest_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      source text NOT NULL,
      court_id text NOT NULL,
      cl_court text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      cursor text,
      last_successful_external_id text,
      completed_external_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      items_discovered integer NOT NULL DEFAULT 0,
      items_fetched integer NOT NULL DEFAULT 0,
      items_imported integer NOT NULL DEFAULT 0,
      items_skipped integer NOT NULL DEFAULT 0,
      items_failed integer NOT NULL DEFAULT 0,
      items_quarantined integer NOT NULL DEFAULT 0,
      rate_limit_count integer NOT NULL DEFAULT 0,
      api_calls integer NOT NULL DEFAULT 0,
      target_max integer NOT NULL DEFAULT 20,
      batch_size integer NOT NULL DEFAULT 5,
      next_page_url text,
      last_retry_after_sec integer,
      last_error text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      started_at timestamptz,
      updated_at timestamptz DEFAULT now() NOT NULL,
      completed_at timestamptz,
      created_at timestamptz DEFAULT now() NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS corpus_ingest_jobs_source_court_uidx
      ON corpus_ingest_jobs (source, cl_court);
  `);
}
function asIdList(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}
async function loadOrCreateJob(sql, clCourt, mapped, targetMax, batchSize) {
  const existing = await sql`
    select * from corpus_ingest_jobs
    where source = ${SOURCE} and cl_court = ${clCourt}
    limit 1
  `;
  if (existing.length > 0) {
    const row = existing[0];
    await sql`
      update corpus_ingest_jobs set
        status = ${row.status === "completed" ? "completed" : "running"},
        target_max = ${targetMax},
        batch_size = ${batchSize},
        started_at = coalesce(started_at, now()),
        updated_at = now()
      where id = ${row.id}
    `;
    return { ...row, target_max: targetMax, batch_size: batchSize };
  }
  const id = (0, import_node_crypto.randomUUID)();
  await sql`
    insert into corpus_ingest_jobs (
      id, source, court_id, cl_court, status, target_max, batch_size, started_at, metadata
    ) values (
      ${id}, ${SOURCE}, ${mapped.courtId}, ${clCourt}, ${"running"},
      ${targetMax}, ${batchSize}, now(), ${sql.json({ wave: "2b" })}
    )
  `;
  const created = await sql`select * from corpus_ingest_jobs where id = ${id} limit 1`;
  return created[0];
}
async function saveJob(sql, jobId, patch) {
  const completedIds = patch.completed_external_ids;
  await sql`
    update corpus_ingest_jobs set
      status = ${String(patch.status ?? "running")},
      cursor = ${patch.cursor != null ? String(patch.cursor) : null},
      next_page_url = ${patch.next_page_url != null ? String(patch.next_page_url) : null},
      last_successful_external_id = ${patch.last_successful_external_id != null ? String(patch.last_successful_external_id) : null},
      completed_external_ids = ${sql.json(Array.isArray(completedIds) ? completedIds : [])},
      items_discovered = ${Number(patch.items_discovered ?? 0)},
      items_fetched = ${Number(patch.items_fetched ?? 0)},
      items_imported = ${Number(patch.items_imported ?? 0)},
      items_skipped = ${Number(patch.items_skipped ?? 0)},
      items_failed = ${Number(patch.items_failed ?? 0)},
      items_quarantined = ${Number(patch.items_quarantined ?? 0)},
      rate_limit_count = ${Number(patch.rate_limit_count ?? 0)},
      api_calls = ${Number(patch.api_calls ?? 0)},
      last_retry_after_sec = ${patch.last_retry_after_sec != null ? Number(patch.last_retry_after_sec) : null},
      last_error = ${patch.last_error != null ? String(patch.last_error).slice(0, 500) : null},
      completed_at = ${patch.status === "completed" ? sql`now()` : null},
      updated_at = now()
    where id = ${jobId}
  `;
}
function toPgvector(values2) {
  return `[${values2.join(",")}]`;
}
async function embedBatch(texts, apiKey) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMS
    })
  });
  if (!res.ok) throw new Error(`openai_embeddings_${res.status}`);
  const json = await res.json();
  return [...json.data].sort((a, b2) => a.index - b2.index).map((d) => d.embedding);
}
async function embedAll(texts, apiKey) {
  const out = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    out.push(...await embedBatch(texts.slice(i, i + EMBEDDING_BATCH_SIZE), apiKey));
  }
  return out;
}
function chunkContent(content) {
  const paragraphs = content.replace(/\r\n/g, "\n").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= MAX_CHUNK_CHARS) {
      chunks.push(paragraph);
      continue;
    }
    for (let i = 0; i < paragraph.length; i += MAX_CHUNK_CHARS) {
      chunks.push(paragraph.slice(i, i + MAX_CHUNK_CHARS));
    }
  }
  return chunks.length > 0 ? chunks.slice(0, 80) : [content.slice(0, MAX_CHUNK_CHARS)];
}
var CITATION_RES = [
  /\d+ U\.?\s?S\.? \d+/g,
  /\d+ F\.(?:\s?2d|\s?3d|\s?4th)? \d+/g,
  /\d+ F\.\s?Supp\.(?:\s?2d|\s?3d)? \d+/g
];
function extractCitations(content) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const re of CITATION_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      const raw = m[0].trim();
      const normalized = normalizeCitation(raw);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push({ raw, normalized });
    }
  }
  return out;
}
var TREATMENT_PATTERNS = [
  { kind: "overruled", re: /\boverrul(ed|ing)\b/i },
  { kind: "reversed", re: /\brevers(ed|ing)\b/i },
  { kind: "vacated", re: /\bvacat(ed|ing|e)\b/i },
  { kind: "superseded", re: /\bsupersed(ed|ing|es)\b/i },
  { kind: "distinguished", re: /\bdistinguish(ed|ing)\b/i },
  { kind: "followed", re: /\bfollow(ed|ing)\b/i },
  { kind: "criticized", re: /\bcriticiz(ed|ing|e)\b/i }
];
function extractTreatmentSignals(content) {
  const sentences = content.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
  const found = [];
  const seen = /* @__PURE__ */ new Set();
  for (const sentence of sentences) {
    for (const pattern of TREATMENT_PATTERNS) {
      if (pattern.re.test(sentence)) {
        const key = `${pattern.kind}:${sentence.slice(0, 80)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ kind: pattern.kind, sourceSentence: sentence.slice(0, 500) });
      }
    }
  }
  return found;
}
async function insertCitationEdges(sql, fromAuthorityId, content) {
  const cites = extractCitations(content);
  let inserted = 0;
  for (const cit of cites) {
    const dup = await sql`
      select 1 as ok from legal_authority_citations
      where from_authority_id = ${fromAuthorityId}
        and normalized_citation = ${cit.normalized}
      limit 1
    `;
    if (dup.length > 0) continue;
    const matches = await sql`
      select id from legal_authorities
      where normalized_citation = ${cit.normalized}
         or citation = ${cit.raw}
      limit 1
    `;
    const toId = matches.length > 0 ? matches[0].id : null;
    await sql`
      insert into legal_authority_citations (
        id, from_authority_id, to_authority_id, raw_citation, normalized_citation
      ) values (
        ${(0, import_node_crypto.randomUUID)()}, ${fromAuthorityId}, ${toId}, ${cit.raw}, ${cit.normalized}
      )
    `;
    inserted += 1;
  }
  return inserted;
}
async function enrichFromCluster(hit, cl) {
  if (pickCitation(hit) || hit.docket_number || hit.docketNumber) return hit;
  const clusterId = resolveClusterId(hit);
  if (!clusterId) return hit;
  const res = await cl.fetch(`${CL_BASE}/clusters/${clusterId}/`);
  if (res.status === 429) return { rateLimited: true, response: res };
  if (!res.ok) return hit;
  const cluster = await res.json();
  const cites = [];
  if (Array.isArray(cluster.citation)) cites.push(...cluster.citation.map(String));
  else if (typeof cluster.citation === "string" && cluster.citation.trim()) cites.push(cluster.citation);
  if (Array.isArray(cluster.citations)) {
    for (const c of cluster.citations) {
      if (typeof c === "string" && c.trim()) cites.push(c);
      else if (c && typeof c === "object" && c.cite) cites.push(String(c.cite));
    }
  }
  let docket = cluster.docket_number != null ? String(cluster.docket_number) : null;
  if (!docket && cluster.docket && typeof cluster.docket === "object" && cluster.docket.docket_number) {
    docket = String(cluster.docket.docket_number);
  }
  let next = {
    ...hit,
    case_name: hit.case_name ?? cluster.case_name,
    citation: cites.length > 0 ? cites : hit.citation,
    date_filed: hit.date_filed ?? cluster.date_filed,
    docket_number: hit.docket_number ?? docket,
    absolute_url: hit.absolute_url ?? cluster.absolute_url,
    cluster_id: clusterId
  };
  if (!pickCitation(next) && !next.docket_number && typeof cluster.docket === "string") {
    const abs = cluster.docket.startsWith("http") ? cluster.docket : `https://www.courtlistener.com${cluster.docket.startsWith("/") ? "" : "/"}${cluster.docket}`;
    const dRes = await cl.fetch(abs);
    if (dRes.status === 429) return { rateLimited: true, response: dRes };
    if (dRes.ok) {
      const body = await dRes.json();
      if (body.docket_number) next = { ...next, docket_number: String(body.docket_number) };
    }
  }
  return next;
}
async function persistOne(sql, mapped, opinion, apiKey, opts) {
  const existing = await sql`
    select id from legal_authorities
    where source_provider = ${SOURCE} and source_external_id = ${opinion.sourceExternalId}
    limit 1
  `;
  const metadata = {
    sourceClass: "PRIMARY_PUBLIC_REPOSITORY",
    adapter: "courtlistener-batch-job",
    clCourt: opinion.clCourtId,
    retrievedAt: opinion.retrievedAt,
    citationStatus: opinion.citationStatus,
    treatmentSignals: opinion.treatmentSignals
  };
  if (existing.length > 0) {
    const authorityId2 = existing[0].id;
    const latest = await sql`
      select id, version_number, sha256 from legal_authority_versions
      where authority_id = ${authorityId2} order by version_number desc limit 1
    `;
    if (latest.length > 0 && latest[0].sha256 === opinion.contentHash) {
      if (opts.hasLastChecked) {
        await sql`update legal_authorities set last_checked_at = now(), updated_at = now() where id = ${authorityId2}`;
      }
      return { status: "skipped", citationEdges: 0, embeddedChunks: 0 };
    }
    await sql`update legal_authority_versions set valid_to = now() where authority_id = ${authorityId2} and valid_to is null`;
    const nextVersion = Number(latest[0]?.version_number ?? 0) + 1;
    const versionId2 = (0, import_node_crypto.randomUUID)();
    await sql`
      insert into legal_authority_versions (
        id, authority_id, version_number, content, effective_from, effective_to,
        source_provider, source_metadata, sha256
      ) values (
        ${versionId2}, ${authorityId2}, ${nextVersion}, ${opinion.content},
        ${opinion.decisionDate}, ${null}, ${SOURCE},
        ${sql.json({ adapter: "courtlistener-batch-job", retrievedAt: opinion.retrievedAt })},
        ${opinion.contentHash}
      )
    `;
    const chunks2 = chunkContent(opinion.content);
    const vectors2 = await embedAll(chunks2, apiKey);
    for (let i = 0; i < chunks2.length; i++) {
      await sql`
        insert into legal_authority_chunks (
          id, authority_id, authority_version_id, chunk_index, content,
          segment_ref, char_start, char_end, embedding, embedding_model
        ) values (
          ${(0, import_node_crypto.randomUUID)()}, ${authorityId2}, ${versionId2}, ${i}, ${chunks2[i]},
          ${`p${i + 1}`}, ${null}, ${null}, ${toPgvector(vectors2[i])}::vector,
          ${`${EMBEDDING_MODEL}:${EMBEDDING_DIMS}`}
        )
      `;
    }
    let edges2 = 0;
    if (opts.hasCitations) edges2 = await insertCitationEdges(sql, authorityId2, opinion.content);
    return { status: "new_version", citationEdges: edges2, embeddedChunks: chunks2.length };
  }
  const authorityId = (0, import_node_crypto.randomUUID)();
  const versionId = (0, import_node_crypto.randomUUID)();
  const norm = opinion.citation ? normalizeCitation(opinion.citation) : null;
  if (opts.hasCurrentness && opts.hasLastChecked) {
    await sql`
      insert into legal_authorities (
        id, authority_type, jurisdiction, court, court_id, authority_state,
        federal_circuit, court_level, title, citation, normalized_citation,
        docket_number, decision_date, source_provider, source_external_id,
        canonical_source_url, ingestion_status, currentness_status, last_checked_at,
        hierarchy_path, metadata
      ) values (
        ${authorityId}, ${"case"}::authority_type, ${mapped.jurisdiction}, ${mapped.courtName},
        ${mapped.courtId}, ${mapped.authorityState}, ${mapped.federalCircuit}, ${mapped.courtLevel},
        ${opinion.title}, ${opinion.citation}, ${norm}, ${opinion.docketNumber}, ${opinion.decisionDate},
        ${SOURCE}, ${opinion.sourceExternalId}, ${opinion.canonicalSourceUrl},
        'processing'::authority_ingestion_status, 'unknown'::authority_currentness_status, now(),
        ${sql.json([])}, ${sql.json(metadata)}
      )
    `;
  } else {
    await sql`
      insert into legal_authorities (
        id, authority_type, jurisdiction, court, court_id, authority_state,
        federal_circuit, court_level, title, citation, normalized_citation,
        docket_number, decision_date, source_provider, source_external_id,
        canonical_source_url, ingestion_status, hierarchy_path, metadata
      ) values (
        ${authorityId}, ${"case"}::authority_type, ${mapped.jurisdiction}, ${mapped.courtName},
        ${mapped.courtId}, ${mapped.authorityState}, ${mapped.federalCircuit}, ${mapped.courtLevel},
        ${opinion.title}, ${opinion.citation}, ${norm}, ${opinion.docketNumber}, ${opinion.decisionDate},
        ${SOURCE}, ${opinion.sourceExternalId}, ${opinion.canonicalSourceUrl},
        'processing'::authority_ingestion_status, ${sql.json([])}, ${sql.json(metadata)}
      )
    `;
  }
  await sql`
    insert into legal_authority_versions (
      id, authority_id, version_number, content, effective_from, effective_to,
      source_provider, source_metadata, sha256
    ) values (
      ${versionId}, ${authorityId}, 1, ${opinion.content}, ${opinion.decisionDate}, ${null},
      ${SOURCE}, ${sql.json({ adapter: "courtlistener-batch-job", retrievedAt: opinion.retrievedAt })},
      ${opinion.contentHash}
    )
  `;
  const chunks = chunkContent(opinion.content);
  const vectors = await embedAll(chunks, apiKey);
  for (let i = 0; i < chunks.length; i++) {
    await sql`
      insert into legal_authority_chunks (
        id, authority_id, authority_version_id, chunk_index, content,
        segment_ref, char_start, char_end, embedding, embedding_model
      ) values (
        ${(0, import_node_crypto.randomUUID)()}, ${authorityId}, ${versionId}, ${i}, ${chunks[i]},
        ${`p${i + 1}`}, ${null}, ${null}, ${toPgvector(vectors[i])}::vector,
        ${`${EMBEDDING_MODEL}:${EMBEDDING_DIMS}`}
      )
    `;
  }
  await sql`
    update legal_authorities set ingestion_status = 'ready'::authority_ingestion_status, updated_at = now()
    where id = ${authorityId}
  `;
  let edges = 0;
  if (opts.hasCitations) edges = await insertCitationEdges(sql, authorityId, opinion.content);
  return { status: "imported", citationEdges: edges, embeddedChunks: chunks.length };
}
async function hasColumn(sql, column) {
  const rows = await sql`
    select 1 as ok from information_schema.columns
    where table_name = 'legal_authorities' and column_name = ${column} limit 1
  `;
  return rows.length > 0;
}
async function hasCitationsTable(sql) {
  const rows = await sql`
    select 1 as ok from information_schema.tables
    where table_schema = 'public' and table_name = 'legal_authority_citations' limit 1
  `;
  return rows.length > 0;
}
async function main() {
  const clKey = process.env.COURTLISTENER_API_KEY?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const clCourt = (process.env.CL_COURT ?? "").trim().toLowerCase();
  const proofMode = process.env.CL_PROOF === "1";
  const batchSize = Math.min(Math.max(Number.parseInt(process.env.CL_BATCH_SIZE ?? "5", 10) || 5, 1), 25);
  const targetMax = Math.min(Math.max(Number.parseInt(process.env.CL_TARGET_MAX ?? "20", 10) || 20, 1), 200);
  const rateMs = Math.max(Number.parseInt(process.env.CL_RATE_MS ?? "1500", 10) || 1500, 400);
  const maxRetries = Math.min(Math.max(Number.parseInt(process.env.CL_MAX_RETRIES ?? "6", 10) || 6, 1), 10);
  if (!clKey) {
    console.log(JSON.stringify({ ok: false, reason: "COURTLISTENER_API_KEY missing" }));
    process.exit(2);
  }
  if (!clCourt || !/^[a-z0-9_-]+$/i.test(clCourt)) {
    console.log(JSON.stringify({ ok: false, reason: "CL_COURT required" }));
    process.exit(2);
  }
  const mapped = CL_COURT_MAP[clCourt] ?? null;
  if (!mapped) {
    console.log(JSON.stringify({ ok: false, reason: `unmapped_court:${clCourt}`, status: "failed" }));
    process.exit(1);
  }
  if (!proofMode && (!databaseUrl || !openaiKey)) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL/OPENAI_API_KEY required" }));
    process.exit(2);
  }
  const cl = new ClRateLimiter(clKey, rateMs, maxRetries);
  let sql = null;
  let job = null;
  const completed = /* @__PURE__ */ new Set();
  const finish = async (payload, exitCode = 0) => {
    if (sql && job) {
      try {
        await saveJob(sql, job.id, {
          status: payload.status ?? "paused",
          cursor: payload.cursor ?? job.cursor,
          next_page_url: payload.next_page_url ?? job.next_page_url,
          last_successful_external_id: payload.last_successful_external_id ?? job.last_successful_external_id,
          completed_external_ids: [...completed],
          items_discovered: payload.items_discovered ?? job.items_discovered,
          items_fetched: payload.items_fetched ?? job.items_fetched,
          items_imported: payload.items_imported ?? job.items_imported,
          items_skipped: payload.items_skipped ?? job.items_skipped,
          items_failed: payload.items_failed ?? job.items_failed,
          items_quarantined: payload.items_quarantined ?? job.items_quarantined,
          rate_limit_count: cl.rateLimitHits,
          api_calls: cl.apiCalls,
          last_retry_after_sec: cl.lastRetryAfterSec,
          last_error: payload.last_error ?? null
        });
      } catch {
      }
    }
    console.log(JSON.stringify({ ok: payload.ok !== false, ...payload, featureAgents: process.env.FEATURE_AGENTS ?? null }));
    try {
      require("node:fs").writeFileSync(
        "/tmp/cl-batch-result.json",
        JSON.stringify({ ok: payload.ok !== false, ...payload, featureAgents: process.env.FEATURE_AGENTS ?? null })
      );
    } catch {
    }
    if (sql) await sql.end({ timeout: 5 });
    process.exit(exitCode);
  };
  if (!proofMode) {
    sql = src_default(databaseUrl, {
      max: 3,
      ssl: "require",
      onnotice: () => void 0
    });
    await ensureJobTable(sql);
    job = await loadOrCreateJob(sql, clCourt, mapped, targetMax, batchSize);
    for (const id of asIdList(job.completed_external_ids)) completed.add(id);
    if (job.status === "completed" && job.items_imported + job.items_skipped >= job.target_max) {
      await finish({
        ok: true,
        status: "completed",
        clCourt,
        mappedCourt: mapped.courtId,
        reason: "already_completed",
        items_imported: job.items_imported,
        items_skipped: job.items_skipped,
        apiCalls: job.api_calls
      });
      return;
    }
  }
  const pageSize = Math.min(batchSize * 2, 50);
  let discoverUrl = job?.next_page_url || `${CL_BASE}/opinions/?${new URLSearchParams({
    cluster__docket__court: clCourt,
    order_by: "-id",
    page_size: String(pageSize)
  })}`;
  let discoverPath = job?.next_page_url ? "opinions" : "opinions";
  let discoverRes = await cl.fetch(discoverUrl);
  if (discoverRes.status === 429) {
    await finish(
      {
        ok: true,
        status: "rate_limited",
        reason: "RATE LIMIT WINDOW REACHED",
        clCourt,
        mappedCourt: mapped.courtId,
        discoverPath,
        last429Endpoint: cl.last429Endpoint,
        lastRetryAfterSec: cl.lastRetryAfterSec,
        rateLimitCount: cl.rateLimitHits,
        apiCalls: cl.apiCalls,
        cursor: job?.cursor ?? null,
        next_page_url: job?.next_page_url ?? null,
        completedCount: completed.size
      },
      0
    );
    return;
  }
  if (!discoverRes.ok && (discoverRes.status === 400 || discoverRes.status === 404)) {
    discoverPath = "search";
    discoverUrl = `${CL_BASE}/search/?${new URLSearchParams({
      type: "o",
      q: "*",
      court: clCourt,
      order_by: "dateFiled desc",
      page_size: String(pageSize)
    })}`;
    discoverRes = await cl.fetch(discoverUrl);
    if (discoverRes.status === 429) {
      await finish(
        {
          ok: true,
          status: "rate_limited",
          reason: "RATE LIMIT WINDOW REACHED",
          clCourt,
          mappedCourt: mapped.courtId,
          discoverPath,
          last429Endpoint: cl.last429Endpoint,
          lastRetryAfterSec: cl.lastRetryAfterSec,
          apiCalls: cl.apiCalls
        },
        0
      );
      return;
    }
  }
  if (!discoverRes.ok) {
    await finish(
      {
        ok: false,
        status: "failed",
        reason: `discover_http_${discoverRes.status}`,
        clCourt,
        mappedCourt: mapped.courtId,
        discoverPath,
        apiCalls: cl.apiCalls,
        last_error: `discover_http_${discoverRes.status}`
      },
      1
    );
    return;
  }
  const body = await discoverRes.json();
  const hits = body.results ?? [];
  const nextPage = body.next ? absoluteUrl(body.next) : null;
  let itemsDiscovered = (job?.items_discovered ?? 0) + hits.length;
  let itemsFetched = job?.items_fetched ?? 0;
  let itemsImported = job?.items_imported ?? 0;
  let itemsSkipped = job?.items_skipped ?? 0;
  let itemsFailed = job?.items_failed ?? 0;
  let itemsQuarantined = job?.items_quarantined ?? 0;
  let citationEdges = 0;
  let embeddedChunks = 0;
  let lastSuccessful = job?.last_successful_external_id ?? null;
  const batchSample = [];
  const opts = sql ? {
    hasCurrentness: await hasColumn(sql, "currentness_status"),
    hasLastChecked: await hasColumn(sql, "last_checked_at"),
    hasCitations: await hasCitationsTable(sql)
  } : { hasCurrentness: false, hasLastChecked: false, hasCitations: false };
  let processedThisBatch = 0;
  for (const hit of hits) {
    if (processedThisBatch >= batchSize) break;
    if (itemsImported + itemsSkipped >= targetMax) break;
    const id = resolveOpinionId(hit);
    if (!id) {
      itemsQuarantined += 1;
      continue;
    }
    const sourceExternalId = `cl-opinion-${id}`;
    if (completed.has(sourceExternalId)) {
      itemsSkipped += 1;
      processedThisBatch += 1;
      continue;
    }
    try {
      let raw = hit;
      const listText = pickText(hit);
      if (listText.length < 200) {
        const opRes = await cl.fetch(`${CL_BASE}/opinions/${id}/`);
        if (opRes.status === 429) {
          await finish(
            {
              ok: true,
              status: "rate_limited",
              reason: "RATE LIMIT WINDOW REACHED",
              clCourt,
              mappedCourt: mapped.courtId,
              last429Endpoint: cl.last429Endpoint,
              lastRetryAfterSec: cl.lastRetryAfterSec,
              rateLimitCount: cl.rateLimitHits,
              apiCalls: cl.apiCalls,
              cursor: sourceExternalId,
              next_page_url: nextPage,
              items_discovered: itemsDiscovered,
              items_fetched: itemsFetched,
              items_imported: itemsImported,
              items_skipped: itemsSkipped,
              items_failed: itemsFailed,
              items_quarantined: itemsQuarantined,
              last_successful_external_id: lastSuccessful,
              completedCount: completed.size,
              batchProcessed: processedThisBatch
            },
            0
          );
          return;
        }
        if (!opRes.ok) {
          itemsFailed += 1;
          processedThisBatch += 1;
          continue;
        }
        raw = await opRes.json();
      }
      itemsFetched += 1;
      const enriched = await enrichFromCluster(raw, cl);
      if ("rateLimited" in enriched && enriched.rateLimited) {
        await finish(
          {
            ok: true,
            status: "rate_limited",
            reason: "RATE LIMIT WINDOW REACHED",
            clCourt,
            mappedCourt: mapped.courtId,
            last429Endpoint: cl.last429Endpoint,
            lastRetryAfterSec: cl.lastRetryAfterSec,
            apiCalls: cl.apiCalls,
            cursor: sourceExternalId,
            next_page_url: nextPage,
            items_discovered: itemsDiscovered,
            items_fetched: itemsFetched,
            items_imported: itemsImported,
            items_skipped: itemsSkipped,
            items_failed: itemsFailed,
            items_quarantined: itemsQuarantined,
            last_successful_external_id: lastSuccessful,
            completedCount: completed.size,
            batchProcessed: processedThisBatch
          },
          0
        );
        return;
      }
      raw = enriched;
      const content = pickText(raw);
      if (content.length < 20) {
        itemsQuarantined += 1;
        completed.add(sourceExternalId);
        processedThisBatch += 1;
        continue;
      }
      const citation = pickCitation(raw);
      const docket = raw.docket_number ? String(raw.docket_number) : raw.docketNumber ? String(raw.docketNumber) : null;
      if (!citation && !docket && !sourceExternalId) {
        itemsQuarantined += 1;
        processedThisBatch += 1;
        continue;
      }
      const title = sanitizeUntrustedLegalText(
        String(raw.case_name ?? raw.caseName ?? `CourtListener opinion ${id}`)
      );
      const status2 = citationStatus(citation, docket);
      const retrievedAt = (/* @__PURE__ */ new Date()).toISOString();
      const opinion = {
        sourceExternalId,
        title: title.length >= 3 ? title : `CourtListener opinion ${id}`,
        citation,
        docketNumber: docket,
        decisionDate: raw.date_filed ?? raw.dateFiled ?? null,
        content,
        contentHash: sha256Hex(content),
        canonicalSourceUrl: absoluteUrl(raw.absolute_url) ?? absoluteUrl(`/opinion/${id}/`) ?? null,
        clCourtId: clCourt,
        retrievedAt,
        citationStatus: status2,
        treatmentSignals: extractTreatmentSignals(content)
      };
      if (proofMode) {
        batchSample.push({
          title: opinion.title,
          citation: opinion.citation,
          docket: opinion.docketNumber,
          citationStatus: opinion.citationStatus,
          court: mapped.courtId,
          url: opinion.canonicalSourceUrl
        });
        completed.add(sourceExternalId);
        processedThisBatch += 1;
        continue;
      }
      const result = await persistOne(sql, mapped, opinion, openaiKey, opts);
      if (result.status === "imported" || result.status === "new_version") {
        itemsImported += 1;
        citationEdges += result.citationEdges;
        embeddedChunks += result.embeddedChunks;
      } else {
        itemsSkipped += 1;
      }
      completed.add(sourceExternalId);
      lastSuccessful = sourceExternalId;
      processedThisBatch += 1;
      batchSample.push({
        title: opinion.title.slice(0, 80),
        citation: opinion.citation,
        docket: opinion.docketNumber,
        citationStatus: opinion.citationStatus,
        persist: result.status
      });
      if (job && sql) {
        await saveJob(sql, job.id, {
          status: "running",
          cursor: sourceExternalId,
          next_page_url: nextPage,
          last_successful_external_id: lastSuccessful,
          completed_external_ids: [...completed],
          items_discovered: itemsDiscovered,
          items_fetched: itemsFetched,
          items_imported: itemsImported,
          items_skipped: itemsSkipped,
          items_failed: itemsFailed,
          items_quarantined: itemsQuarantined,
          rate_limit_count: cl.rateLimitHits,
          api_calls: cl.apiCalls,
          last_retry_after_sec: cl.lastRetryAfterSec
        });
      }
    } catch (err) {
      itemsFailed += 1;
      processedThisBatch += 1;
      if (job && sql) {
        await saveJob(sql, job.id, {
          status: "running",
          cursor: sourceExternalId,
          next_page_url: nextPage,
          last_successful_external_id: lastSuccessful,
          completed_external_ids: [...completed],
          items_discovered: itemsDiscovered,
          items_fetched: itemsFetched,
          items_imported: itemsImported,
          items_skipped: itemsSkipped,
          items_failed: itemsFailed,
          items_quarantined: itemsQuarantined,
          rate_limit_count: cl.rateLimitHits,
          api_calls: cl.apiCalls,
          last_error: String(err instanceof Error ? err.message : err).slice(0, 400)
        });
      }
    }
  }
  const totalDone = itemsImported + itemsSkipped;
  const status = totalDone >= targetMax || hits.length === 0 && !nextPage ? "completed" : "paused";
  await finish({
    ok: true,
    status,
    proofMode,
    clCourt,
    mappedCourt: mapped.courtId,
    discoverPath,
    batchProcessed: processedThisBatch,
    batchSize,
    targetMax,
    items_discovered: itemsDiscovered,
    items_fetched: itemsFetched,
    items_imported: itemsImported,
    items_skipped: itemsSkipped,
    items_failed: itemsFailed,
    items_quarantined: itemsQuarantined,
    citationEdges,
    embeddedChunks,
    cursor: lastSuccessful,
    next_page_url: nextPage,
    completedCount: completed.size,
    rateLimitCount: cl.rateLimitHits,
    lastRetryAfterSec: cl.lastRetryAfterSec,
    last429Endpoint: cl.last429Endpoint,
    apiCalls: cl.apiCalls,
    sample: batchSample.slice(0, 3)
  });
}
main().catch(async (e) => {
  console.log(
    JSON.stringify({
      ok: false,
      status: "failed",
      err: String(e?.stack || e).slice(0, 2e3)
    })
  );
  process.exit(1);
});
