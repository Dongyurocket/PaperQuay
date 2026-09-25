// 由 scripts/build-office-addin.mjs 生成，请勿手改；源文件：office-addin/src/taskpane.ts
"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __values = (this && this.__values) || function(o) {
    var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
    if (m) return m.call(o);
    if (o && typeof o.length === "number") return {
        next: function () {
            if (o && i >= o.length) o = void 0;
            return { value: o && o[i++], done: !o };
        }
    };
    throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
};
var __read = (this && this.__read) || function (o, n) {
    var m = typeof Symbol === "function" && o[Symbol.iterator];
    if (!m) return o;
    var i = m.call(o), r, ar = [], e;
    try {
        while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
    }
    catch (error) { e = { error: error }; }
    finally {
        try {
            if (r && !r.done && (m = i["return"])) m.call(i);
        }
        finally { if (e) throw e.error; }
    }
    return ar;
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
(function () {
    var __create = Object.create;
    var __defProp = Object.defineProperty;
    var __defProps = Object.defineProperties;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __getOwnPropSymbols = Object.getOwnPropertySymbols;
    var __getProtoOf = Object.getPrototypeOf;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __propIsEnum = Object.prototype.propertyIsEnumerable;
    var __defNormalProp = function (obj, key, value) { return key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value: value }) : obj[key] = value; };
    var __spreadValues = function (a, b) {
        var e_1, _g;
        for (var prop in b || (b = {}))
            if (__hasOwnProp.call(b, prop))
                __defNormalProp(a, prop, b[prop]);
        if (__getOwnPropSymbols)
            try {
                for (var _h = __values(__getOwnPropSymbols(b)), _j = _h.next(); !_j.done; _j = _h.next()) {
                    var prop = _j.value;
                    if (__propIsEnum.call(b, prop))
                        __defNormalProp(a, prop, b[prop]);
                }
            }
            catch (e_1_1) { e_1 = { error: e_1_1 }; }
            finally {
                try {
                    if (_j && !_j.done && (_g = _h.return)) _g.call(_h);
                }
                finally { if (e_1) throw e_1.error; }
            }
        return a;
    };
    var __spreadProps = function (a, b) { return __defProps(a, __getOwnPropDescs(b)); };
    var __commonJS = function (cb, mod) { return function __require() {
        return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    }; };
    var __copyProps = function (to, from, except, desc) {
        var e_2, _g;
        if (from && typeof from === "object" || typeof from === "function") {
            var _loop_1 = function (key) {
                if (!__hasOwnProp.call(to, key) && key !== except)
                    __defProp(to, key, { get: function () { return from[key]; }, enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
            };
            try {
                for (var _h = __values(__getOwnPropNames(from)), _j = _h.next(); !_j.done; _j = _h.next()) {
                    var key = _j.value;
                    _loop_1(key);
                }
            }
            catch (e_2_1) { e_2 = { error: e_2_1 }; }
            finally {
                try {
                    if (_j && !_j.done && (_g = _h.return)) _g.call(_h);
                }
                finally { if (e_2) throw e_2.error; }
            }
        }
        return to;
    };
    var __toESM = function (mod, isNodeMode, target) { return (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target, mod)); };
    // node_modules/core-js/internals/global-this.js
    var require_global_this = __commonJS({
        "node_modules/core-js/internals/global-this.js": function (exports, module) {
            "use strict";
            var check = function (it) {
                return it && it.Math === Math && it;
            };
            module.exports = // eslint-disable-next-line es/no-global-this -- safe
                check(typeof globalThis == "object" && globalThis) || check(typeof window == "object" && window) || // eslint-disable-next-line no-restricted-globals -- safe
                    check(typeof self == "object" && self) || check(typeof global == "object" && global) || check(typeof exports == "object" && exports) || // eslint-disable-next-line no-new-func -- fallback
                    /* @__PURE__ */ (function () {
                        return this;
                    })() || Function("return this")();
        }
    });
    // node_modules/core-js/internals/fails.js
    var require_fails = __commonJS({
        "node_modules/core-js/internals/fails.js": function (exports, module) {
            "use strict";
            module.exports = function (exec) {
                try {
                    return !!exec();
                }
                catch (error) {
                    return true;
                }
            };
        }
    });
    // node_modules/core-js/internals/descriptors.js
    var require_descriptors = __commonJS({
        "node_modules/core-js/internals/descriptors.js": function (exports, module) {
            "use strict";
            var fails = require_fails();
            module.exports = !fails(function () {
                return Object.defineProperty({}, 1, { get: function () {
                        return 7;
                    } })[1] !== 7;
            });
        }
    });
    // node_modules/core-js/internals/function-bind-native.js
    var require_function_bind_native = __commonJS({
        "node_modules/core-js/internals/function-bind-native.js": function (exports, module) {
            "use strict";
            var fails = require_fails();
            module.exports = !fails(function () {
                var test = function () {
                }.bind();
                return typeof test != "function" || test.hasOwnProperty("prototype");
            });
        }
    });
    // node_modules/core-js/internals/function-call.js
    var require_function_call = __commonJS({
        "node_modules/core-js/internals/function-call.js": function (exports, module) {
            "use strict";
            var NATIVE_BIND = require_function_bind_native();
            var call = Function.prototype.call;
            module.exports = NATIVE_BIND ? call.bind(call) : function () {
                return call.apply(call, arguments);
            };
        }
    });
    // node_modules/core-js/internals/object-property-is-enumerable.js
    var require_object_property_is_enumerable = __commonJS({
        "node_modules/core-js/internals/object-property-is-enumerable.js": function (exports) {
            "use strict";
            var $propertyIsEnumerable = {}.propertyIsEnumerable;
            var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
            var NASHORN_BUG = getOwnPropertyDescriptor && !$propertyIsEnumerable.call({ 1: 2 }, 1);
            exports.f = NASHORN_BUG ? function propertyIsEnumerable(V) {
                var descriptor = getOwnPropertyDescriptor(this, V);
                return !!descriptor && descriptor.enumerable;
            } : $propertyIsEnumerable;
        }
    });
    // node_modules/core-js/internals/create-property-descriptor.js
    var require_create_property_descriptor = __commonJS({
        "node_modules/core-js/internals/create-property-descriptor.js": function (exports, module) {
            "use strict";
            module.exports = function (bitmap, value) {
                return {
                    enumerable: !(bitmap & 1),
                    configurable: !(bitmap & 2),
                    writable: !(bitmap & 4),
                    value: value
                };
            };
        }
    });
    // node_modules/core-js/internals/function-uncurry-this.js
    var require_function_uncurry_this = __commonJS({
        "node_modules/core-js/internals/function-uncurry-this.js": function (exports, module) {
            "use strict";
            var NATIVE_BIND = require_function_bind_native();
            var FunctionPrototype = Function.prototype;
            var call = FunctionPrototype.call;
            var uncurryThisWithBind = NATIVE_BIND && FunctionPrototype.bind.bind(call, call);
            module.exports = NATIVE_BIND ? uncurryThisWithBind : function (fn) {
                return function () {
                    return call.apply(fn, arguments);
                };
            };
        }
    });
    // node_modules/core-js/internals/classof-raw.js
    var require_classof_raw = __commonJS({
        "node_modules/core-js/internals/classof-raw.js": function (exports, module) {
            "use strict";
            var uncurryThis = require_function_uncurry_this();
            var toString = uncurryThis({}.toString);
            var stringSlice = uncurryThis("".slice);
            module.exports = function (it) {
                return stringSlice(toString(it), 8, -1);
            };
        }
    });
    // node_modules/core-js/internals/indexed-object.js
    var require_indexed_object = __commonJS({
        "node_modules/core-js/internals/indexed-object.js": function (exports, module) {
            "use strict";
            var uncurryThis = require_function_uncurry_this();
            var fails = require_fails();
            var classof = require_classof_raw();
            var $Object = Object;
            var split = uncurryThis("".split);
            module.exports = fails(function () {
                return !$Object("z").propertyIsEnumerable(0);
            }) ? function (it) {
                return classof(it) === "String" ? split(it, "") : $Object(it);
            } : $Object;
        }
    });
    // node_modules/core-js/internals/is-null-or-undefined.js
    var require_is_null_or_undefined = __commonJS({
        "node_modules/core-js/internals/is-null-or-undefined.js": function (exports, module) {
            "use strict";
            module.exports = function (it) {
                return it === null || it === void 0;
            };
        }
    });
    // node_modules/core-js/internals/require-object-coercible.js
    var require_require_object_coercible = __commonJS({
        "node_modules/core-js/internals/require-object-coercible.js": function (exports, module) {
            "use strict";
            var isNullOrUndefined = require_is_null_or_undefined();
            var $TypeError = TypeError;
            module.exports = function (it) {
                if (isNullOrUndefined(it))
                    throw new $TypeError("Can't call method on " + it);
                return it;
            };
        }
    });
    // node_modules/core-js/internals/to-indexed-object.js
    var require_to_indexed_object = __commonJS({
        "node_modules/core-js/internals/to-indexed-object.js": function (exports, module) {
            "use strict";
            var IndexedObject = require_indexed_object();
            var requireObjectCoercible = require_require_object_coercible();
            module.exports = function (it) {
                return IndexedObject(requireObjectCoercible(it));
            };
        }
    });
    // node_modules/core-js/internals/is-callable.js
    var require_is_callable = __commonJS({
        "node_modules/core-js/internals/is-callable.js": function (exports, module) {
            "use strict";
            var documentAll = typeof document == "object" && document.all;
            module.exports = typeof documentAll == "undefined" && documentAll !== void 0 ? function (argument) {
                return typeof argument == "function" || argument === documentAll;
            } : function (argument) {
                return typeof argument == "function";
            };
        }
    });
    // node_modules/core-js/internals/is-object.js
    var require_is_object = __commonJS({
        "node_modules/core-js/internals/is-object.js": function (exports, module) {
            "use strict";
            var isCallable = require_is_callable();
            module.exports = function (it) {
                return typeof it == "object" ? it !== null : isCallable(it);
            };
        }
    });
    // node_modules/core-js/internals/get-built-in.js
    var require_get_built_in = __commonJS({
        "node_modules/core-js/internals/get-built-in.js": function (exports, module) {
            "use strict";
            var globalThis2 = require_global_this();
            var isCallable = require_is_callable();
            var aFunction = function (argument) {
                return isCallable(argument) ? argument : void 0;
            };
            module.exports = function (namespace, method) {
                return arguments.length < 2 ? aFunction(globalThis2[namespace]) : globalThis2[namespace] && globalThis2[namespace][method];
            };
        }
    });
    // node_modules/core-js/internals/object-is-prototype-of.js
    var require_object_is_prototype_of = __commonJS({
        "node_modules/core-js/internals/object-is-prototype-of.js": function (exports, module) {
            "use strict";
            var uncurryThis = require_function_uncurry_this();
            module.exports = uncurryThis({}.isPrototypeOf);
        }
    });
    // node_modules/core-js/internals/environment-user-agent.js
    var require_environment_user_agent = __commonJS({
        "node_modules/core-js/internals/environment-user-agent.js": function (exports, module) {
            "use strict";
            var globalThis2 = require_global_this();
            var navigator2 = globalThis2.navigator;
            var userAgent = navigator2 && navigator2.userAgent;
            module.exports = userAgent ? String(userAgent) : "";
        }
    });
    // node_modules/core-js/internals/environment-v8-version.js
    var require_environment_v8_version = __commonJS({
        "node_modules/core-js/internals/environment-v8-version.js": function (exports, module) {
            "use strict";
            var globalThis2 = require_global_this();
            var userAgent = require_environment_user_agent();
            var process = globalThis2.process;
            var Deno2 = globalThis2.Deno;
            var versions = process && process.versions || Deno2 && Deno2.version;
            var v8 = versions && versions.v8;
            var match;
            var version;
            if (v8) {
                match = v8.split(".");
                version = match[0] > 0 && match[0] < 4 ? 1 : +(match[0] + match[1]);
            }
            if (!version && userAgent) {
                match = userAgent.match(/Edge\/(\d+)/);
                if (!match || match[1] >= 74) {
                    match = userAgent.match(/Chrome\/(\d+)/);
                    if (match)
                        version = +match[1];
                }
            }
            module.exports = version;
        }
    });
    // node_modules/core-js/internals/symbol-constructor-detection.js
    var require_symbol_constructor_detection = __commonJS({
        "node_modules/core-js/internals/symbol-constructor-detection.js": function (exports, module) {
            "use strict";
            var V8_VERSION = require_environment_v8_version();
            var fails = require_fails();
            var globalThis2 = require_global_this();
            var $String = globalThis2.String;
            module.exports = !!Object.getOwnPropertySymbols && !fails(function () {
                var symbol = Symbol("symbol detection");
                return !$String(symbol) || !(Object(symbol) instanceof Symbol) || // Chrome 38-40 symbols are not inherited from DOM collections prototypes to instances
                    !Symbol.sham && V8_VERSION && V8_VERSION < 41;
            });
        }
    });
    // node_modules/core-js/internals/use-symbol-as-uid.js
    var require_use_symbol_as_uid = __commonJS({
        "node_modules/core-js/internals/use-symbol-as-uid.js": function (exports, module) {
            "use strict";
            var NATIVE_SYMBOL = require_symbol_constructor_detection();
            module.exports = NATIVE_SYMBOL && !Symbol.sham && typeof Symbol.iterator == "symbol";
        }
    });
    // node_modules/core-js/internals/is-symbol.js
    var require_is_symbol = __commonJS({
        "node_modules/core-js/internals/is-symbol.js": function (exports, module) {
            "use strict";
            var getBuiltIn = require_get_built_in();
            var isCallable = require_is_callable();
            var isPrototypeOf = require_object_is_prototype_of();
            var USE_SYMBOL_AS_UID = require_use_symbol_as_uid();
            var $Object = Object;
            module.exports = USE_SYMBOL_AS_UID ? function (it) {
                return typeof it == "symbol";
            } : function (it) {
                var $Symbol = getBuiltIn("Symbol");
                return isCallable($Symbol) && isPrototypeOf($Symbol.prototype, $Object(it));
            };
        }
    });
    // node_modules/core-js/internals/try-to-string.js
    var require_try_to_string = __commonJS({
        "node_modules/core-js/internals/try-to-string.js": function (exports, module) {
            "use strict";
            var $String = String;
            module.exports = function (argument) {
                try {
                    return $String(argument);
                }
                catch (error) {
                    return "Object";
                }
            };
        }
    });
    // node_modules/core-js/internals/a-callable.js
    var require_a_callable = __commonJS({
        "node_modules/core-js/internals/a-callable.js": function (exports, module) {
            "use strict";
            var isCallable = require_is_callable();
            var tryToString = require_try_to_string();
            var $TypeError = TypeError;
            module.exports = function (argument) {
                if (isCallable(argument))
                    return argument;
                throw new $TypeError(tryToString(argument) + " is not a function");
            };
        }
    });
    // node_modules/core-js/internals/get-method.js
    var require_get_method = __commonJS({
        "node_modules/core-js/internals/get-method.js": function (exports, module) {
            "use strict";
            var aCallable = require_a_callable();
            var isNullOrUndefined = require_is_null_or_undefined();
            module.exports = function (V, P) {
                var func = V[P];
                return isNullOrUndefined(func) ? void 0 : aCallable(func);
            };
        }
    });
    // node_modules/core-js/internals/ordinary-to-primitive.js
    var require_ordinary_to_primitive = __commonJS({
        "node_modules/core-js/internals/ordinary-to-primitive.js": function (exports, module) {
            "use strict";
            var call = require_function_call();
            var isCallable = require_is_callable();
            var isObject = require_is_object();
            var $TypeError = TypeError;
            module.exports = function (input, pref) {
                var fn, val;
                if (pref === "string" && isCallable(fn = input.toString) && !isObject(val = call(fn, input)))
                    return val;
                if (isCallable(fn = input.valueOf) && !isObject(val = call(fn, input)))
                    return val;
                if (pref !== "string" && isCallable(fn = input.toString) && !isObject(val = call(fn, input)))
                    return val;
                throw new $TypeError("Can't convert object to primitive value");
            };
        }
    });
    // node_modules/core-js/internals/is-pure.js
    var require_is_pure = __commonJS({
        "node_modules/core-js/internals/is-pure.js": function (exports, module) {
            "use strict";
            module.exports = false;
        }
    });
    // node_modules/core-js/internals/define-global-property.js
    var require_define_global_property = __commonJS({
        "node_modules/core-js/internals/define-global-property.js": function (exports, module) {
            "use strict";
            var globalThis2 = require_global_this();
            var defineProperty = Object.defineProperty;
            module.exports = function (key, value) {
                try {
                    defineProperty(globalThis2, key, { value: value, configurable: true, writable: true });
                }
                catch (error) {
                    globalThis2[key] = value;
                }
                return value;
            };
        }
    });
    // node_modules/core-js/internals/shared-store.js
    var require_shared_store = __commonJS({
        "node_modules/core-js/internals/shared-store.js": function (exports, module) {
            "use strict";
            var IS_PURE = require_is_pure();
            var globalThis2 = require_global_this();
            var defineGlobalProperty = require_define_global_property();
            var SHARED = "__core-js_shared__";
            var store = module.exports = globalThis2[SHARED] || defineGlobalProperty(SHARED, {});
            (store.versions || (store.versions = [])).push({
                version: "3.50.0",
                mode: IS_PURE ? "pure" : "global",
                copyright: "© 2013–2025 Denis Pushkarev (zloirock.ru), 2025–2026 CoreJS Company (core-js.io). All rights reserved.",
                license: "https://github.com/zloirock/core-js/blob/v3.50.0/LICENSE",
                source: "https://github.com/zloirock/core-js"
            });
        }
    });
    // node_modules/core-js/internals/shared.js
    var require_shared = __commonJS({
        "node_modules/core-js/internals/shared.js": function (exports, module) {
            "use strict";
            var store = require_shared_store();
            var create = Object.create || Object;
            module.exports = function (key, value) {
                return store[key] || (store[key] = value || create(null));
            };
        }
    });
    // node_modules/core-js/internals/to-object.js
    var require_to_object = __commonJS({
        "node_modules/core-js/internals/to-object.js": function (exports, module) {
            "use strict";
            var requireObjectCoercible = require_require_object_coercible();
            var $Object = Object;
            module.exports = function (argument) {
                return $Object(requireObjectCoercible(argument));
            };
        }
    });
    // node_modules/core-js/internals/has-own-property.js
    var require_has_own_property = __commonJS({
        "node_modules/core-js/internals/has-own-property.js": function (exports, module) {
            "use strict";
            var uncurryThis = require_function_uncurry_this();
            var toObject = require_to_object();
            var hasOwnProperty = uncurryThis({}.hasOwnProperty);
            module.exports = Object.hasOwn || function hasOwn(it, key) {
                return hasOwnProperty(toObject(it), key);
            };
        }
    });
    // node_modules/core-js/internals/uid.js
    var require_uid = __commonJS({
        "node_modules/core-js/internals/uid.js": function (exports, module) {
            "use strict";
            var uncurryThis = require_function_uncurry_this();
            var id = 0;
            var postfix = Math.random();
            var toString = uncurryThis(1.1.toString);
            module.exports = function (key) {
                return "Symbol(" + (key === void 0 ? "" : key) + ")_" + toString(++id + postfix, 36);
            };
        }
    });
    // node_modules/core-js/internals/well-known-symbol.js
    var require_well_known_symbol = __commonJS({
        "node_modules/core-js/internals/well-known-symbol.js": function (exports, module) {
            "use strict";
            var globalThis2 = require_global_this();
            var shared = require_shared();
            var hasOwn = require_has_own_property();
            var uid = require_uid();
            var NATIVE_SYMBOL = require_symbol_constructor_detection();
            var USE_SYMBOL_AS_UID = require_use_symbol_as_uid();
            var Symbol2 = globalThis2.Symbol;
            var WellKnownSymbolsStore = shared("wks");
            var createWellKnownSymbol = USE_SYMBOL_AS_UID ? Symbol2["for"] || Symbol2 : Symbol2 && Symbol2.withoutSetter || uid;
            module.exports = function (name) {
                if (!hasOwn(WellKnownSymbolsStore, name)) {
                    WellKnownSymbolsStore[name] = NATIVE_SYMBOL && hasOwn(Symbol2, name) ? Symbol2[name] : createWellKnownSymbol("Symbol." + name);
                }
                return WellKnownSymbolsStore[name];
            };
        }
    });
    // node_modules/core-js/internals/to-primitive.js
    var require_to_primitive = __commonJS({
        "node_modules/core-js/internals/to-primitive.js": function (exports, module) {
            "use strict";
            var call = require_function_call();
            var isObject = require_is_object();
            var isSymbol = require_is_symbol();
            var getMethod = require_get_method();
            var ordinaryToPrimitive = require_ordinary_to_primitive();
            var wellKnownSymbol = require_well_known_symbol();
            var $TypeError = TypeError;
            var TO_PRIMITIVE = wellKnownSymbol("toPrimitive");
            module.exports = function (input, pref) {
                if (!isObject(input) || isSymbol(input))
                    return input;
                var exoticToPrim = getMethod(input, TO_PRIMITIVE);
                var result;
                if (exoticToPrim) {
                    if (pref === void 0)
                        pref = "default";
                    result = call(exoticToPrim, input, pref);
                    if (!isObject(result) || isSymbol(result))
                        return result;
                    throw new $TypeError("Can't convert object to primitive value");
                }
                if (pref === void 0)
                    pref = "number";
                return ordinaryToPrimitive(input, pref);
            };
        }
    });
    // node_modules/core-js/internals/to-property-key.js
    var require_to_property_key = __commonJS({
        "node_modules/core-js/internals/to-property-key.js": function (exports, module) {
            "use strict";
            var toPrimitive = require_to_primitive();
            var isSymbol = require_is_symbol();
            module.exports = function (argument) {
                var key = toPrimitive(argument, "string");
                return isSymbol(key) ? key : key + "";
            };
        }
    });
    // node_modules/core-js/internals/document-create-element.js
    var require_document_create_element = __commonJS({
        "node_modules/core-js/internals/document-create-element.js": function (exports, module) {
            "use strict";
            var globalThis2 = require_global_this();
            var isObject = require_is_object();
            var document2 = globalThis2.document;
            var EXISTS = isObject(document2) && isObject(document2.createElement);
            module.exports = function (it) {
                return EXISTS ? document2.createElement(it) : {};
            };
        }
    });
    // node_modules/core-js/internals/ie8-dom-define.js
    var require_ie8_dom_define = __commonJS({
        "node_modules/core-js/internals/ie8-dom-define.js": function (exports, module) {
            "use strict";
            var DESCRIPTORS = require_descriptors();
            var fails = require_fails();
            var createElement = require_document_create_element();
            module.exports = !DESCRIPTORS && !fails(function () {
                return Object.defineProperty(createElement("div"), "a", {
                    get: function () {
                        return 7;
                    }
                }).a !== 7;
            });
        }
    });
    // node_modules/core-js/internals/object-get-own-property-descriptor.js
    var require_object_get_own_property_descriptor = __commonJS({
        "node_modules/core-js/internals/object-get-own-property-descriptor.js": function (exports) {
            "use strict";
            var DESCRIPTORS = require_descriptors();
            var call = require_function_call();
            var propertyIsEnumerableModule = require_object_property_is_enumerable();
            var createPropertyDescriptor = require_create_property_descriptor();
            var toIndexedObject = require_to_indexed_object();
            var toPropertyKey = require_to_property_key();
            var hasOwn = require_has_own_property();
            var IE8_DOM_DEFINE = require_ie8_dom_define();
            var $getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
            exports.f = DESCRIPTORS ? $getOwnPropertyDescriptor : function getOwnPropertyDescriptor(O, P) {
                O = toIndexedObject(O);
                P = toPropertyKey(P);
                if (IE8_DOM_DEFINE)
                    try {
                        return $getOwnPropertyDescriptor(O, P);
                    }
                    catch (error) {
                    }
                if (hasOwn(O, P))
                    return createPropertyDescriptor(!call(propertyIsEnumerableModule.f, O, P), O[P]);
            };
        }
    });
    // node_modules/core-js/internals/v8-prototype-define-bug.js
    var require_v8_prototype_define_bug = __commonJS({
        "node_modules/core-js/internals/v8-prototype-define-bug.js": function (exports, module) {
            "use strict";
            var DESCRIPTORS = require_descriptors();
            var fails = require_fails();
            module.exports = DESCRIPTORS && fails(function () {
                return Object.defineProperty(function () {
                }, "prototype", {
                    value: 42,
                    writable: false
                }).prototype !== 42;
            });
        }
    });
    // node_modules/core-js/internals/an-object.js
    var require_an_object = __commonJS({
        "node_modules/core-js/internals/an-object.js": function (exports, module) {
            "use strict";
            var isObject = require_is_object();
            var $String = String;
            var $TypeError = TypeError;
            module.exports = function (argument) {
                if (isObject(argument))
                    return argument;
                throw new $TypeError($String(argument) + " is not an object");
            };
        }
    });
    // node_modules/core-js/internals/object-define-property.js
    var require_object_define_property = __commonJS({
        "node_modules/core-js/internals/object-define-property.js": function (exports) {
            "use strict";
            var DESCRIPTORS = require_descriptors();
            var IE8_DOM_DEFINE = require_ie8_dom_define();
            var V8_PROTOTYPE_DEFINE_BUG = require_v8_prototype_define_bug();
            var anObject = require_an_object();
            var toPropertyKey = require_to_property_key();
            var $TypeError = TypeError;
            var $defineProperty = Object.defineProperty;
            var $getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
            var ENUMERABLE = "enumerable";
            var CONFIGURABLE = "configurable";
            var WRITABLE = "writable";
            exports.f = DESCRIPTORS ? V8_PROTOTYPE_DEFINE_BUG ? function defineProperty(O, P, Attributes) {
                anObject(O);
                P = toPropertyKey(P);
                anObject(Attributes);
                if (typeof O === "function" && P === "prototype" && "value" in Attributes && WRITABLE in Attributes && !Attributes[WRITABLE]) {
                    var current = $getOwnPropertyDescriptor(O, P);
                    if (current && current[WRITABLE]) {
                        O[P] = Attributes.value;
                        Attributes = {
                            configurable: CONFIGURABLE in Attributes ? Attributes[CONFIGURABLE] : current[CONFIGURABLE],
                            enumerable: ENUMERABLE in Attributes ? Attributes[ENUMERABLE] : current[ENUMERABLE],
                            writable: false
                        };
                    }
                }
                return $defineProperty(O, P, Attributes);
            } : $defineProperty : function defineProperty(O, P, Attributes) {
                anObject(O);
                P = toPropertyKey(P);
                anObject(Attributes);
                if (IE8_DOM_DEFINE)
                    try {
                        return $defineProperty(O, P, Attributes);
                    }
                    catch (error) {
                    }
                if ("get" in Attributes || "set" in Attributes)
                    throw new $TypeError("Accessors not supported");
                if ("value" in Attributes)
                    O[P] = Attributes.value;
                return O;
            };
        }
    });
    // node_modules/core-js/internals/create-non-enumerable-property.js
    var require_create_non_enumerable_property = __commonJS({
        "node_modules/core-js/internals/create-non-enumerable-property.js": function (exports, module) {
            "use strict";
            var DESCRIPTORS = require_descriptors();
            var definePropertyModule = require_object_define_property();
            var createPropertyDescriptor = require_create_property_descriptor();
            module.exports = DESCRIPTORS ? function (object, key, value) {
                return definePropertyModule.f(object, key, createPropertyDescriptor(1, value));
            } : function (object, key, value) {
                object[key] = value;
                return object;
            };
        }
    });
    // node_modules/core-js/internals/function-name.js
    var require_function_name = __commonJS({
        "node_modules/core-js/internals/function-name.js": function (exports, module) {
            "use strict";
            var DESCRIPTORS = require_descriptors();
            var hasOwn = require_has_own_property();
            var FunctionPrototype = Function.prototype;
            var getDescriptor = DESCRIPTORS && Object.getOwnPropertyDescriptor;
            var EXISTS = hasOwn(FunctionPrototype, "name");
            var PROPER = EXISTS && function something() {
            }.name === "something";
            var CONFIGURABLE = EXISTS && (!DESCRIPTORS || DESCRIPTORS && getDescriptor(FunctionPrototype, "name").configurable);
            module.exports = {
                EXISTS: EXISTS,
                PROPER: PROPER,
                CONFIGURABLE: CONFIGURABLE
            };
        }
    });
    // node_modules/core-js/internals/inspect-source.js
    var require_inspect_source = __commonJS({
        "node_modules/core-js/internals/inspect-source.js": function (exports, module) {
            "use strict";
            var uncurryThis = require_function_uncurry_this();
            var isCallable = require_is_callable();
            var store = require_shared_store();
            var functionToString = uncurryThis(Function.toString);
            if (!isCallable(store.inspectSource)) {
                store.inspectSource = function (it) {
                    return functionToString(it);
                };
            }
            module.exports = store.inspectSource;
        }
    });
    // node_modules/core-js/internals/weak-map-basic-detection.js
    var require_weak_map_basic_detection = __commonJS({
        "node_modules/core-js/internals/weak-map-basic-detection.js": function (exports, module) {
            "use strict";
            var globalThis2 = require_global_this();
            var isCallable = require_is_callable();
            var WeakMap = globalThis2.WeakMap;
            module.exports = isCallable(WeakMap) && /native code/.test(String(WeakMap));
        }
    });
    // node_modules/core-js/internals/shared-key.js
    var require_shared_key = __commonJS({
        "node_modules/core-js/internals/shared-key.js": function (exports, module) {
            "use strict";
            var shared = require_shared();
            var uid = require_uid();
            var keys = shared("keys");
            module.exports = function (key) {
                return keys[key] || (keys[key] = uid(key));
            };
        }
    });
    // node_modules/core-js/internals/hidden-keys.js
    var require_hidden_keys = __commonJS({
        "node_modules/core-js/internals/hidden-keys.js": function (exports, module) {
            "use strict";
            module.exports = {};
        }
    });
    // node_modules/core-js/internals/internal-state.js
    var require_internal_state = __commonJS({
        "node_modules/core-js/internals/internal-state.js": function (exports, module) {
            "use strict";
            var NATIVE_WEAK_MAP = require_weak_map_basic_detection();
            var globalThis2 = require_global_this();
            var isObject = require_is_object();
            var createNonEnumerableProperty = require_create_non_enumerable_property();
            var hasOwn = require_has_own_property();
            var shared = require_shared_store();
            var sharedKey = require_shared_key();
            var hiddenKeys = require_hidden_keys();
            var OBJECT_ALREADY_INITIALIZED = "Object already initialized";
            var TypeError2 = globalThis2.TypeError;
            var WeakMap = globalThis2.WeakMap;
            var set;
            var get;
            var has;
            var enforce = function (it) {
                return has(it) ? get(it) : set(it, {});
            };
            var getterFor = function (TYPE) {
                return function (it) {
                    var state2;
                    if (!isObject(it) || (state2 = get(it)).type !== TYPE) {
                        throw new TypeError2("Incompatible receiver, " + TYPE + " required");
                    }
                    return state2;
                };
            };
            if (NATIVE_WEAK_MAP || shared.state) {
                store = shared.state || (shared.state = new WeakMap());
                store.get = store.get;
                store.has = store.has;
                store.set = store.set;
                set = function (it, metadata) {
                    if (store.has(it))
                        throw new TypeError2(OBJECT_ALREADY_INITIALIZED);
                    metadata.facade = it;
                    store.set(it, metadata);
                    return metadata;
                };
                get = function (it) {
                    return store.get(it) || {};
                };
                has = function (it) {
                    return store.has(it);
                };
            }
            else {
                STATE = sharedKey("state");
                hiddenKeys[STATE] = true;
                set = function (it, metadata) {
                    if (hasOwn(it, STATE))
                        throw new TypeError2(OBJECT_ALREADY_INITIALIZED);
                    metadata.facade = it;
                    createNonEnumerableProperty(it, STATE, metadata);
                    return metadata;
                };
                get = function (it) {
                    return hasOwn(it, STATE) ? it[STATE] : {};
                };
                has = function (it) {
                    return hasOwn(it, STATE);
                };
            }
            var store;
            var STATE;
            module.exports = {
                set: set,
                get: get,
                has: has,
                enforce: enforce,
                getterFor: getterFor
            };
        }
    });
    // node_modules/core-js/internals/make-built-in.js
    var require_make_built_in = __commonJS({
        "node_modules/core-js/internals/make-built-in.js": function (exports, module) {
            "use strict";
            var uncurryThis = require_function_uncurry_this();
            var fails = require_fails();
            var isCallable = require_is_callable();
            var hasOwn = require_has_own_property();
            var DESCRIPTORS = require_descriptors();
            var CONFIGURABLE_FUNCTION_NAME = require_function_name().CONFIGURABLE;
            var inspectSource = require_inspect_source();
            var InternalStateModule = require_internal_state();
            var enforceInternalState = InternalStateModule.enforce;
            var getInternalState = InternalStateModule.get;
            var $String = String;
            var defineProperty = Object.defineProperty;
            var stringSlice = uncurryThis("".slice);
            var replace = uncurryThis("".replace);
            var join = uncurryThis([].join);
            var CONFIGURABLE_LENGTH = DESCRIPTORS && !fails(function () {
                return defineProperty(function () {
                }, "length", { value: 8 }).length !== 8;
            });
            var TEMPLATE = String(String).split("String");
            var makeBuiltIn = module.exports = function (value, name, options) {
                if (stringSlice($String(name), 0, 7) === "Symbol(") {
                    name = "[" + replace($String(name), /^Symbol\(([^)]*)\).*$/, "$1") + "]";
                }
                if (options && options.getter)
                    name = "get " + name;
                if (options && options.setter)
                    name = "set " + name;
                if (!hasOwn(value, "name") || CONFIGURABLE_FUNCTION_NAME && value.name !== name) {
                    if (DESCRIPTORS)
                        defineProperty(value, "name", { value: name, configurable: true });
                    else
                        value.name = name;
                }
                if (CONFIGURABLE_LENGTH && options && hasOwn(options, "arity") && value.length !== options.arity) {
                    defineProperty(value, "length", { value: options.arity });
                }
                try {
                    if (options && hasOwn(options, "constructor") && options.constructor) {
                        if (DESCRIPTORS)
                            defineProperty(value, "prototype", { writable: false });
                    }
                    else if (value.prototype)
                        value.prototype = void 0;
                }
                catch (error) {
                }
                var state2 = enforceInternalState(value);
                if (!hasOwn(state2, "source")) {
                    state2.source = join(TEMPLATE, typeof name == "string" ? name : "");
                }
                return value;
            };
            Function.prototype.toString = makeBuiltIn(function toString() {
                return isCallable(this) && getInternalState(this).source || inspectSource(this);
            }, "toString");
        }
    });
    // node_modules/core-js/internals/define-built-in.js
    var require_define_built_in = __commonJS({
        "node_modules/core-js/internals/define-built-in.js": function (exports, module) {
            "use strict";
            var isCallable = require_is_callable();
            var definePropertyModule = require_object_define_property();
            var makeBuiltIn = require_make_built_in();
            var defineGlobalProperty = require_define_global_property();
            module.exports = function (O, key, value, options) {
                if (!options)
                    options = {};
                var simple = options.enumerable;
                var name = options.name !== void 0 ? options.name : key;
                if (isCallable(value))
                    makeBuiltIn(value, name, options);
                if (options.global) {
                    if (simple)
                        O[key] = value;
                    else
                        defineGlobalProperty(key, value);
                }
                else {
                    try {
                        if (!options.unsafe)
                            delete O[key];
                        else if (O[key])
                            simple = true;
                    }
                    catch (error) {
                    }
                    if (simple)
                        O[key] = value;
                    else
                        definePropertyModule.f(O, key, {
                            value: value,
                            enumerable: false,
                            configurable: !options.nonConfigurable,
                            writable: !options.nonWritable
                        });
                }
                return O;
            };
        }
    });
    // node_modules/core-js/internals/math-trunc.js
    var require_math_trunc = __commonJS({
        "node_modules/core-js/internals/math-trunc.js": function (exports, module) {
            "use strict";
            var ceil = Math.ceil;
            var floor = Math.floor;
            module.exports = Math.trunc || function trunc(x) {
                var n = +x;
                return (n > 0 ? floor : ceil)(n);
            };
        }
    });
    // node_modules/core-js/internals/to-integer-or-infinity.js
    var require_to_integer_or_infinity = __commonJS({
        "node_modules/core-js/internals/to-integer-or-infinity.js": function (exports, module) {
            "use strict";
            var trunc = require_math_trunc();
            module.exports = function (argument) {
                var number = +argument;
                return number !== number || number === 0 ? 0 : trunc(number);
            };
        }
    });
    // node_modules/core-js/internals/to-absolute-index.js
    var require_to_absolute_index = __commonJS({
        "node_modules/core-js/internals/to-absolute-index.js": function (exports, module) {
            "use strict";
            var toIntegerOrInfinity = require_to_integer_or_infinity();
            var max = Math.max;
            var min = Math.min;
            module.exports = function (index, length) {
                var integer = toIntegerOrInfinity(index);
                return integer < 0 ? max(integer + length, 0) : min(integer, length);
            };
        }
    });
    // node_modules/core-js/internals/to-length.js
    var require_to_length = __commonJS({
        "node_modules/core-js/internals/to-length.js": function (exports, module) {
            "use strict";
            var toIntegerOrInfinity = require_to_integer_or_infinity();
            var min = Math.min;
            module.exports = function (argument) {
                var len = toIntegerOrInfinity(argument);
                return len > 0 ? min(len, 9007199254740991) : 0;
            };
        }
    });
    // node_modules/core-js/internals/length-of-array-like.js
    var require_length_of_array_like = __commonJS({
        "node_modules/core-js/internals/length-of-array-like.js": function (exports, module) {
            "use strict";
            var toLength = require_to_length();
            module.exports = function (obj) {
                return toLength(obj.length);
            };
        }
    });
    // node_modules/core-js/internals/array-includes.js
    var require_array_includes = __commonJS({
        "node_modules/core-js/internals/array-includes.js": function (exports, module) {
            "use strict";
            var toIndexedObject = require_to_indexed_object();
            var toAbsoluteIndex = require_to_absolute_index();
            var lengthOfArrayLike = require_length_of_array_like();
            var createMethod = function (IS_INCLUDES) {
                return function ($this, el, fromIndex) {
                    var O = toIndexedObject($this);
                    var length = lengthOfArrayLike(O);
                    if (length === 0)
                        return !IS_INCLUDES && -1;
                    var index = toAbsoluteIndex(fromIndex, length);
                    var value;
                    if (IS_INCLUDES && el !== el)
                        while (length > index) {
                            value = O[index++];
                            if (value !== value)
                                return true;
                        }
                    else
                        for (; length > index; index++) {
                            if ((IS_INCLUDES || index in O) && O[index] === el)
                                return IS_INCLUDES || index || 0;
                        }
                    return !IS_INCLUDES && -1;
                };
            };
            module.exports = {
                // `Array.prototype.includes` method
                // https://tc39.es/ecma262/#sec-array.prototype.includes
                includes: createMethod(true),
                // `Array.prototype.indexOf` method
                // https://tc39.es/ecma262/#sec-array.prototype.indexof
                indexOf: createMethod(false)
            };
        }
    });
    // node_modules/core-js/internals/object-keys-internal.js
    var require_object_keys_internal = __commonJS({
        "node_modules/core-js/internals/object-keys-internal.js": function (exports, module) {
            "use strict";
            var uncurryThis = require_function_uncurry_this();
            var hasOwn = require_has_own_property();
            var toIndexedObject = require_to_indexed_object();
            var indexOf = require_array_includes().indexOf;
            var hiddenKeys = require_hidden_keys();
            var push = uncurryThis([].push);
            module.exports = function (object, names) {
                var O = toIndexedObject(object);
                var i = 0;
                var result = [];
                var key;
                for (key in O)
                    !hasOwn(hiddenKeys, key) && hasOwn(O, key) && push(result, key);
                while (names.length > i)
                    if (hasOwn(O, key = names[i++])) {
                        ~indexOf(result, key) || push(result, key);
                    }
                return result;
            };
        }
    });
    // node_modules/core-js/internals/enum-bug-keys.js
    var require_enum_bug_keys = __commonJS({
        "node_modules/core-js/internals/enum-bug-keys.js": function (exports, module) {
            "use strict";
            module.exports = [
                "constructor",
                "hasOwnProperty",
                "isPrototypeOf",
                "propertyIsEnumerable",
                "toLocaleString",
                "toString",
                "valueOf"
            ];
        }
    });
    // node_modules/core-js/internals/object-get-own-property-names.js
    var require_object_get_own_property_names = __commonJS({
        "node_modules/core-js/internals/object-get-own-property-names.js": function (exports) {
            "use strict";
            var internalObjectKeys = require_object_keys_internal();
            var enumBugKeys = require_enum_bug_keys();
            var hiddenKeys = enumBugKeys.concat("length", "prototype");
            exports.f = Object.getOwnPropertyNames || function getOwnPropertyNames(O) {
                return internalObjectKeys(O, hiddenKeys);
            };
        }
    });
    // node_modules/core-js/internals/object-get-own-property-symbols.js
    var require_object_get_own_property_symbols = __commonJS({
        "node_modules/core-js/internals/object-get-own-property-symbols.js": function (exports) {
            "use strict";
            exports.f = Object.getOwnPropertySymbols;
        }
    });
    // node_modules/core-js/internals/own-keys.js
    var require_own_keys = __commonJS({
        "node_modules/core-js/internals/own-keys.js": function (exports, module) {
            "use strict";
            var getBuiltIn = require_get_built_in();
            var uncurryThis = require_function_uncurry_this();
            var getOwnPropertyNamesModule = require_object_get_own_property_names();
            var getOwnPropertySymbolsModule = require_object_get_own_property_symbols();
            var anObject = require_an_object();
            var concat = uncurryThis([].concat);
            module.exports = getBuiltIn("Reflect", "ownKeys") || function ownKeys(it) {
                var keys = getOwnPropertyNamesModule.f(anObject(it));
                var getOwnPropertySymbols = getOwnPropertySymbolsModule.f;
                return getOwnPropertySymbols ? concat(keys, getOwnPropertySymbols(it)) : keys;
            };
        }
    });
    // node_modules/core-js/internals/copy-constructor-properties.js
    var require_copy_constructor_properties = __commonJS({
        "node_modules/core-js/internals/copy-constructor-properties.js": function (exports, module) {
            "use strict";
            var hasOwn = require_has_own_property();
            var ownKeys = require_own_keys();
            var getOwnPropertyDescriptorModule = require_object_get_own_property_descriptor();
            var definePropertyModule = require_object_define_property();
            module.exports = function (target, source, exceptions) {
                var keys = ownKeys(source);
                var defineProperty = definePropertyModule.f;
                var getOwnPropertyDescriptor = getOwnPropertyDescriptorModule.f;
                for (var i = 0; i < keys.length; i++) {
                    var key = keys[i];
                    if (!hasOwn(target, key) && !(exceptions && hasOwn(exceptions, key))) {
                        defineProperty(target, key, getOwnPropertyDescriptor(source, key));
                    }
                }
            };
        }
    });
    // node_modules/core-js/internals/is-forced.js
    var require_is_forced = __commonJS({
        "node_modules/core-js/internals/is-forced.js": function (exports, module) {
            "use strict";
            var fails = require_fails();
            var isCallable = require_is_callable();
            var replacement = /#|\.prototype\./;
            var isForced = function (feature, detection) {
                var value = data[normalize(feature)];
                return value === POLYFILL ? true : value === NATIVE ? false : isCallable(detection) ? fails(detection) : !!detection;
            };
            var normalize = isForced.normalize = function (string) {
                return String(string).replace(replacement, ".").toLowerCase();
            };
            var data = isForced.data = {};
            var NATIVE = isForced.NATIVE = "N";
            var POLYFILL = isForced.POLYFILL = "P";
            module.exports = isForced;
        }
    });
    // node_modules/core-js/internals/export.js
    var require_export = __commonJS({
        "node_modules/core-js/internals/export.js": function (exports, module) {
            "use strict";
            var globalThis2 = require_global_this();
            var getOwnPropertyDescriptor = require_object_get_own_property_descriptor().f;
            var createNonEnumerableProperty = require_create_non_enumerable_property();
            var defineBuiltIn = require_define_built_in();
            var defineGlobalProperty = require_define_global_property();
            var copyConstructorProperties = require_copy_constructor_properties();
            var isForced = require_is_forced();
            module.exports = function (options, source) {
                var TARGET = options.target;
                var GLOBAL = options.global;
                var STATIC = options.stat;
                var FORCED, target, key, targetProperty, sourceProperty, descriptor;
                if (GLOBAL) {
                    target = globalThis2;
                }
                else if (STATIC) {
                    target = globalThis2[TARGET] || defineGlobalProperty(TARGET, {});
                }
                else {
                    target = globalThis2[TARGET] && globalThis2[TARGET].prototype;
                }
                if (target)
                    for (key in source) {
                        sourceProperty = source[key];
                        if (options.dontCallGetSet) {
                            descriptor = getOwnPropertyDescriptor(target, key);
                            targetProperty = descriptor && descriptor.value;
                        }
                        else
                            targetProperty = target[key];
                        FORCED = isForced(GLOBAL ? key : TARGET + (STATIC ? "." : "#") + key, options.forced);
                        if (!FORCED && targetProperty !== void 0) {
                            if (typeof sourceProperty == typeof targetProperty)
                                continue;
                            copyConstructorProperties(sourceProperty, targetProperty);
                        }
                        if (options.sham || targetProperty && targetProperty.sham) {
                            createNonEnumerableProperty(sourceProperty, "sham", true);
                        }
                        defineBuiltIn(target, key, sourceProperty, options);
                    }
            };
        }
    });
    // node_modules/core-js/internals/correct-prototype-getter.js
    var require_correct_prototype_getter = __commonJS({
        "node_modules/core-js/internals/correct-prototype-getter.js": function (exports, module) {
            "use strict";
            var fails = require_fails();
            module.exports = !fails(function () {
                function F() {
                }
                F.prototype.constructor = null;
                return Object.getPrototypeOf(new F()) !== F.prototype;
            });
        }
    });
    // node_modules/core-js/internals/object-get-prototype-of.js
    var require_object_get_prototype_of = __commonJS({
        "node_modules/core-js/internals/object-get-prototype-of.js": function (exports, module) {
            "use strict";
            var hasOwn = require_has_own_property();
            var isCallable = require_is_callable();
            var toObject = require_to_object();
            var sharedKey = require_shared_key();
            var CORRECT_PROTOTYPE_GETTER = require_correct_prototype_getter();
            var IE_PROTO = sharedKey("IE_PROTO");
            var $Object = Object;
            var ObjectPrototype = $Object.prototype;
            module.exports = CORRECT_PROTOTYPE_GETTER ? $Object.getPrototypeOf : function (O) {
                var object = toObject(O);
                if (hasOwn(object, IE_PROTO))
                    return object[IE_PROTO];
                var constructor = object.constructor;
                if (isCallable(constructor) && object instanceof constructor) {
                    return constructor.prototype;
                }
                return object instanceof $Object ? ObjectPrototype : null;
            };
        }
    });
    // node_modules/core-js/internals/function-uncurry-this-accessor.js
    var require_function_uncurry_this_accessor = __commonJS({
        "node_modules/core-js/internals/function-uncurry-this-accessor.js": function (exports, module) {
            "use strict";
            var uncurryThis = require_function_uncurry_this();
            var aCallable = require_a_callable();
            module.exports = function (object, key, method) {
                try {
                    return uncurryThis(aCallable(Object.getOwnPropertyDescriptor(object, key)[method]));
                }
                catch (error) {
                }
            };
        }
    });
    // node_modules/core-js/internals/is-possible-prototype.js
    var require_is_possible_prototype = __commonJS({
        "node_modules/core-js/internals/is-possible-prototype.js": function (exports, module) {
            "use strict";
            var isObject = require_is_object();
            module.exports = function (argument) {
                return isObject(argument) || argument === null;
            };
        }
    });
    // node_modules/core-js/internals/a-possible-prototype.js
    var require_a_possible_prototype = __commonJS({
        "node_modules/core-js/internals/a-possible-prototype.js": function (exports, module) {
            "use strict";
            var isPossiblePrototype = require_is_possible_prototype();
            var $String = String;
            var $TypeError = TypeError;
            module.exports = function (argument) {
                if (isPossiblePrototype(argument))
                    return argument;
                throw new $TypeError("Can't set " + $String(argument) + " as a prototype");
            };
        }
    });
    // node_modules/core-js/internals/object-set-prototype-of.js
    var require_object_set_prototype_of = __commonJS({
        "node_modules/core-js/internals/object-set-prototype-of.js": function (exports, module) {
            "use strict";
            var uncurryThisAccessor = require_function_uncurry_this_accessor();
            var isObject = require_is_object();
            var requireObjectCoercible = require_require_object_coercible();
            var aPossiblePrototype = require_a_possible_prototype();
            module.exports = Object.setPrototypeOf || ("__proto__" in {} ? (function () {
                var CORRECT_SETTER = false;
                var test = {};
                var setter;
                try {
                    setter = uncurryThisAccessor(Object.prototype, "__proto__", "set");
                    setter(test, []);
                    CORRECT_SETTER = test instanceof Array;
                }
                catch (error) {
                }
                return function setPrototypeOf(O, proto) {
                    requireObjectCoercible(O);
                    aPossiblePrototype(proto);
                    if (!isObject(O))
                        return O;
                    if (CORRECT_SETTER)
                        setter(O, proto);
                    else
                        O.__proto__ = proto;
                    return O;
                };
            })() : void 0);
        }
    });
    // node_modules/core-js/internals/object-keys.js
    var require_object_keys = __commonJS({
        "node_modules/core-js/internals/object-keys.js": function (exports, module) {
            "use strict";
            var internalObjectKeys = require_object_keys_internal();
            var enumBugKeys = require_enum_bug_keys();
            module.exports = Object.keys || function keys(O) {
                return internalObjectKeys(O, enumBugKeys);
            };
        }
    });
    // node_modules/core-js/internals/object-define-properties.js
    var require_object_define_properties = __commonJS({
        "node_modules/core-js/internals/object-define-properties.js": function (exports) {
            "use strict";
            var DESCRIPTORS = require_descriptors();
            var V8_PROTOTYPE_DEFINE_BUG = require_v8_prototype_define_bug();
            var definePropertyModule = require_object_define_property();
            var anObject = require_an_object();
            var toIndexedObject = require_to_indexed_object();
            var objectKeys = require_object_keys();
            exports.f = DESCRIPTORS && !V8_PROTOTYPE_DEFINE_BUG ? Object.defineProperties : function defineProperties(O, Properties) {
                anObject(O);
                var props = toIndexedObject(Properties);
                var keys = objectKeys(Properties);
                var length = keys.length;
                var index = 0;
                var key;
                while (length > index)
                    definePropertyModule.f(O, key = keys[index++], props[key]);
                return O;
            };
        }
    });
    // node_modules/core-js/internals/html.js
    var require_html = __commonJS({
        "node_modules/core-js/internals/html.js": function (exports, module) {
            "use strict";
            var getBuiltIn = require_get_built_in();
            module.exports = getBuiltIn("document", "documentElement");
        }
    });
    // node_modules/core-js/internals/object-create.js
    var require_object_create = __commonJS({
        "node_modules/core-js/internals/object-create.js": function (exports, module) {
            "use strict";
            var anObject = require_an_object();
            var definePropertiesModule = require_object_define_properties();
            var enumBugKeys = require_enum_bug_keys();
            var hiddenKeys = require_hidden_keys();
            var html = require_html();
            var documentCreateElement = require_document_create_element();
            var sharedKey = require_shared_key();
            var GT = ">";
            var LT = "<";
            var PROTOTYPE = "prototype";
            var SCRIPT = "script";
            var IE_PROTO = sharedKey("IE_PROTO");
            var EmptyConstructor = function () {
            };
            var scriptTag = function (content) {
                return LT + SCRIPT + GT + content + LT + "/" + SCRIPT + GT;
            };
            var NullProtoObjectViaActiveX = function (activeXDocument2) {
                activeXDocument2.write(scriptTag(""));
                activeXDocument2.close();
                var temp = activeXDocument2.parentWindow.Object;
                activeXDocument2 = null;
                return temp;
            };
            var NullProtoObjectViaIFrame = function () {
                var iframe = documentCreateElement("iframe");
                var JS = "java" + SCRIPT + ":";
                var iframeDocument;
                iframe.style.display = "none";
                html.appendChild(iframe);
                iframe.src = String(JS);
                iframeDocument = iframe.contentWindow.document;
                iframeDocument.open();
                iframeDocument.write(scriptTag("document.F=Object"));
                iframeDocument.close();
                return iframeDocument.F;
            };
            var activeXDocument;
            var NullProtoObject = function () {
                try {
                    activeXDocument = new ActiveXObject("htmlfile");
                }
                catch (error) {
                }
                NullProtoObject = typeof document != "undefined" ? document.domain && activeXDocument ? NullProtoObjectViaActiveX(activeXDocument) : NullProtoObjectViaIFrame() : NullProtoObjectViaActiveX(activeXDocument);
                var length = enumBugKeys.length;
                while (length--)
                    delete NullProtoObject[PROTOTYPE][enumBugKeys[length]];
                return NullProtoObject();
            };
            hiddenKeys[IE_PROTO] = true;
            module.exports = Object.create || function create(O, Properties) {
                var result;
                if (O !== null) {
                    EmptyConstructor[PROTOTYPE] = anObject(O);
                    result = new EmptyConstructor();
                    EmptyConstructor[PROTOTYPE] = null;
                    result[IE_PROTO] = O;
                }
                else
                    result = NullProtoObject();
                return Properties === void 0 ? result : definePropertiesModule.f(result, Properties);
            };
        }
    });
    // node_modules/core-js/internals/install-error-cause.js
    var require_install_error_cause = __commonJS({
        "node_modules/core-js/internals/install-error-cause.js": function (exports, module) {
            "use strict";
            var isObject = require_is_object();
            var createNonEnumerableProperty = require_create_non_enumerable_property();
            module.exports = function (O, options) {
                if (isObject(options) && "cause" in options) {
                    createNonEnumerableProperty(O, "cause", options.cause);
                }
            };
        }
    });
    // node_modules/core-js/internals/error-stack-clear.js
    var require_error_stack_clear = __commonJS({
        "node_modules/core-js/internals/error-stack-clear.js": function (exports, module) {
            "use strict";
            var uncurryThis = require_function_uncurry_this();
            var $Error = Error;
            var replace = uncurryThis("".replace);
            var TEST = (function (arg) {
                return String(new $Error(arg).stack);
            })("zxcasd");
            var V8_OR_CHAKRA_STACK_ENTRY = /\n\s*at [^:]*:[^\n]*/;
            var IS_V8_OR_CHAKRA_STACK = V8_OR_CHAKRA_STACK_ENTRY.test(TEST);
            module.exports = function (stack, dropEntries) {
                if (IS_V8_OR_CHAKRA_STACK && typeof stack == "string" && !$Error.prepareStackTrace) {
                    while (dropEntries--)
                        stack = replace(stack, V8_OR_CHAKRA_STACK_ENTRY, "");
                }
                return stack;
            };
        }
    });
    // node_modules/core-js/internals/error-stack-installable.js
    var require_error_stack_installable = __commonJS({
        "node_modules/core-js/internals/error-stack-installable.js": function (exports, module) {
            "use strict";
            var fails = require_fails();
            var createPropertyDescriptor = require_create_property_descriptor();
            module.exports = !fails(function () {
                var error = new Error("a");
                if (!("stack" in error))
                    return true;
                Object.defineProperty(error, "stack", createPropertyDescriptor(1, 7));
                return error.stack !== 7;
            });
        }
    });
    // node_modules/core-js/internals/error-stack-install.js
    var require_error_stack_install = __commonJS({
        "node_modules/core-js/internals/error-stack-install.js": function (exports, module) {
            "use strict";
            var createNonEnumerableProperty = require_create_non_enumerable_property();
            var clearErrorStack = require_error_stack_clear();
            var ERROR_STACK_INSTALLABLE = require_error_stack_installable();
            var captureStackTrace = Error.captureStackTrace;
            module.exports = function (error, C, stack, dropEntries) {
                if (ERROR_STACK_INSTALLABLE) {
                    if (captureStackTrace)
                        captureStackTrace(error, C);
                    else
                        createNonEnumerableProperty(error, "stack", clearErrorStack(stack, dropEntries));
                }
            };
        }
    });
    // node_modules/core-js/internals/function-uncurry-this-clause.js
    var require_function_uncurry_this_clause = __commonJS({
        "node_modules/core-js/internals/function-uncurry-this-clause.js": function (exports, module) {
            "use strict";
            var classofRaw = require_classof_raw();
            var uncurryThis = require_function_uncurry_this();
            module.exports = function (fn) {
                if (classofRaw(fn) === "Function")
                    return uncurryThis(fn);
            };
        }
    });
    // node_modules/core-js/internals/function-bind-context.js
    var require_function_bind_context = __commonJS({
        "node_modules/core-js/internals/function-bind-context.js": function (exports, module) {
            "use strict";
            var uncurryThis = require_function_uncurry_this_clause();
            var aCallable = require_a_callable();
            var NATIVE_BIND = require_function_bind_native();
            var bind = uncurryThis(uncurryThis.bind);
            module.exports = function (fn, that) {
                aCallable(fn);
                return that === void 0 ? fn : NATIVE_BIND ? bind(fn, that) : function () {
                    return fn.apply(that, arguments);
                };
            };
        }
    });
    // node_modules/core-js/internals/iterators.js
    var require_iterators = __commonJS({
        "node_modules/core-js/internals/iterators.js": function (exports, module) {
            "use strict";
            module.exports = Object.create ? /* @__PURE__ */ Object.create(null) : {};
        }
    });
    // node_modules/core-js/internals/is-array-iterator-method.js
    var require_is_array_iterator_method = __commonJS({
        "node_modules/core-js/internals/is-array-iterator-method.js": function (exports, module) {
            "use strict";
            var wellKnownSymbol = require_well_known_symbol();
            var Iterators = require_iterators();
            var ITERATOR = wellKnownSymbol("iterator");
            var ArrayPrototype = Array.prototype;
            module.exports = function (it) {
                return it !== void 0 && (Iterators.Array === it || ArrayPrototype[ITERATOR] === it);
            };
        }
    });
    // node_modules/core-js/internals/get-iterator-method-internal.js
    var require_get_iterator_method_internal = __commonJS({
        "node_modules/core-js/internals/get-iterator-method-internal.js": function (exports, module) {
            "use strict";
            var classof = require_classof_raw();
            var isNullOrUndefined = require_is_null_or_undefined();
            var getMethod = require_get_method();
            var wellKnownSymbol = require_well_known_symbol();
            var ITERATOR = wellKnownSymbol("iterator");
            var ArrayPrototype = Array.prototype;
            module.exports = function (it) {
                if (!isNullOrUndefined(it))
                    return getMethod(it, ITERATOR) || getMethod(it, "@@iterator") || (classof(it) === "Arguments" ? ArrayPrototype[ITERATOR] : void 0);
            };
        }
    });
    // node_modules/core-js/internals/get-iterator-internal.js
    var require_get_iterator_internal = __commonJS({
        "node_modules/core-js/internals/get-iterator-internal.js": function (exports, module) {
            "use strict";
            var call = require_function_call();
            var isCallable = require_is_callable();
            var anObject = require_an_object();
            var tryToString = require_try_to_string();
            var getIteratorMethod = require_get_iterator_method_internal();
            var $TypeError = TypeError;
            module.exports = function (argument, usingIterator) {
                var iteratorMethod = arguments.length < 2 ? getIteratorMethod(argument) : usingIterator;
                if (isCallable(iteratorMethod))
                    return anObject(call(iteratorMethod, argument));
                throw new $TypeError(tryToString(argument) + " is not iterable");
            };
        }
    });
    // node_modules/core-js/internals/iterator-close.js
    var require_iterator_close = __commonJS({
        "node_modules/core-js/internals/iterator-close.js": function (exports, module) {
            "use strict";
            var call = require_function_call();
            var anObject = require_an_object();
            var getMethod = require_get_method();
            module.exports = function (iterator, kind, value) {
                var innerResult, innerError;
                anObject(iterator);
                try {
                    innerResult = getMethod(iterator, "return");
                    if (!innerResult) {
                        if (kind === "throw")
                            throw value;
                        return value;
                    }
                    innerResult = call(innerResult, iterator);
                }
                catch (error) {
                    innerError = true;
                    innerResult = error;
                }
                if (kind === "throw")
                    throw value;
                if (innerError)
                    throw innerResult;
                anObject(innerResult);
                return value;
            };
        }
    });
    // node_modules/core-js/internals/iterate.js
    var require_iterate = __commonJS({
        "node_modules/core-js/internals/iterate.js": function (exports, module) {
            "use strict";
            var bind = require_function_bind_context();
            var call = require_function_call();
            var anObject = require_an_object();
            var tryToString = require_try_to_string();
            var isArrayIteratorMethod = require_is_array_iterator_method();
            var lengthOfArrayLike = require_length_of_array_like();
            var isPrototypeOf = require_object_is_prototype_of();
            var getIterator = require_get_iterator_internal();
            var getIteratorMethod = require_get_iterator_method_internal();
            var iteratorClose = require_iterator_close();
            var $TypeError = TypeError;
            var Result = function (stopped, result) {
                this.stopped = stopped;
                this.result = result;
            };
            var ResultPrototype = Result.prototype;
            module.exports = function (iterable, unboundFunction, options) {
                var that = options && options.that;
                var AS_ENTRIES = !!(options && options.AS_ENTRIES);
                var IS_RECORD = !!(options && options.IS_RECORD);
                var IS_ITERATOR = !!(options && options.IS_ITERATOR);
                var INTERRUPTED = !!(options && options.INTERRUPTED);
                var fn = bind(unboundFunction, that);
                var iterator, iterFn, index, length, result, next, step;
                var stop = function (condition) {
                    var $iterator = iterator;
                    iterator = void 0;
                    if ($iterator)
                        iteratorClose($iterator, "normal");
                    return new Result(true, condition);
                };
                var callFn = function (value2) {
                    if (AS_ENTRIES) {
                        anObject(value2);
                        return INTERRUPTED ? fn(value2[0], value2[1], stop) : fn(value2[0], value2[1]);
                    }
                    return INTERRUPTED ? fn(value2, stop) : fn(value2);
                };
                if (IS_RECORD) {
                    iterator = iterable.iterator;
                }
                else if (IS_ITERATOR) {
                    iterator = iterable;
                }
                else {
                    iterFn = getIteratorMethod(iterable);
                    if (!iterFn)
                        throw new $TypeError(tryToString(iterable) + " is not iterable");
                    if (isArrayIteratorMethod(iterFn)) {
                        for (index = 0, length = lengthOfArrayLike(iterable); length > index; index++) {
                            result = callFn(iterable[index]);
                            if (result && isPrototypeOf(ResultPrototype, result))
                                return result;
                        }
                        return new Result(false);
                    }
                    iterator = getIterator(iterable, iterFn);
                }
                next = IS_RECORD ? iterable.next : iterator.next;
                while (!(step = call(next, iterator)).done) {
                    var value = step.value;
                    try {
                        result = callFn(value);
                    }
                    catch (error) {
                        if (iterator)
                            iteratorClose(iterator, "throw", error);
                        else
                            throw error;
                    }
                    if (typeof result == "object" && result && isPrototypeOf(ResultPrototype, result))
                        return result;
                }
                return new Result(false);
            };
        }
    });
    // node_modules/core-js/internals/to-string-tag-support.js
    var require_to_string_tag_support = __commonJS({
        "node_modules/core-js/internals/to-string-tag-support.js": function (exports, module) {
            "use strict";
            var wellKnownSymbol = require_well_known_symbol();
            var TO_STRING_TAG = wellKnownSymbol("toStringTag");
            var test = {};
            test[TO_STRING_TAG] = "z";
            module.exports = String(test) === "[object z]";
        }
    });
    // node_modules/core-js/internals/classof.js
    var require_classof = __commonJS({
        "node_modules/core-js/internals/classof.js": function (exports, module) {
            "use strict";
            var TO_STRING_TAG_SUPPORT = require_to_string_tag_support();
            var isCallable = require_is_callable();
            var classofRaw = require_classof_raw();
            var wellKnownSymbol = require_well_known_symbol();
            var TO_STRING_TAG = wellKnownSymbol("toStringTag");
            var $Object = Object;
            var CORRECT_ARGUMENTS = classofRaw(/* @__PURE__ */ (function () {
                return arguments;
            })()) === "Arguments";
            var tryGet = function (it, key) {
                try {
                    return it[key];
                }
                catch (error) {
                }
            };
            module.exports = TO_STRING_TAG_SUPPORT ? classofRaw : function (it) {
                var O, tag, result;
                return it === void 0 ? "Undefined" : it === null ? "Null" : typeof (tag = tryGet(O = $Object(it), TO_STRING_TAG)) == "string" ? tag : CORRECT_ARGUMENTS ? classofRaw(O) : (result = classofRaw(O)) === "Object" && isCallable(O.callee) ? "Arguments" : result;
            };
        }
    });
    // node_modules/core-js/internals/to-string.js
    var require_to_string = __commonJS({
        "node_modules/core-js/internals/to-string.js": function (exports, module) {
            "use strict";
            var classof = require_classof();
            var $String = String;
            module.exports = function (argument) {
                if (classof(argument) === "Symbol")
                    throw new TypeError("Cannot convert a Symbol value to a string");
                return $String(argument);
            };
        }
    });
    // node_modules/core-js/internals/normalize-string-argument.js
    var require_normalize_string_argument = __commonJS({
        "node_modules/core-js/internals/normalize-string-argument.js": function (exports, module) {
            "use strict";
            var toString = require_to_string();
            module.exports = function (argument, $default) {
                return argument === void 0 ? arguments.length < 2 ? "" : $default : toString(argument);
            };
        }
    });
    // node_modules/core-js/modules/es.aggregate-error.constructor.js
    var require_es_aggregate_error_constructor = __commonJS({
        "node_modules/core-js/modules/es.aggregate-error.constructor.js": function () {
            "use strict";
            var $ = require_export();
            var isPrototypeOf = require_object_is_prototype_of();
            var getPrototypeOf = require_object_get_prototype_of();
            var setPrototypeOf = require_object_set_prototype_of();
            var copyConstructorProperties = require_copy_constructor_properties();
            var create = require_object_create();
            var createNonEnumerableProperty = require_create_non_enumerable_property();
            var createPropertyDescriptor = require_create_property_descriptor();
            var installErrorCause = require_install_error_cause();
            var installErrorStack = require_error_stack_install();
            var iterate = require_iterate();
            var normalizeStringArgument = require_normalize_string_argument();
            var wellKnownSymbol = require_well_known_symbol();
            var TO_STRING_TAG = wellKnownSymbol("toStringTag");
            var $Error = Error;
            var push = [].push;
            var $AggregateError = function AggregateError(errors, message) {
                var isInstance = isPrototypeOf(AggregateErrorPrototype, this);
                var that;
                if (setPrototypeOf) {
                    that = setPrototypeOf(new $Error(), isInstance ? getPrototypeOf(this) : AggregateErrorPrototype);
                }
                else {
                    that = isInstance ? this : create(AggregateErrorPrototype);
                    createNonEnumerableProperty(that, TO_STRING_TAG, "Error");
                }
                if (message !== void 0)
                    createNonEnumerableProperty(that, "message", normalizeStringArgument(message));
                installErrorStack(that, $AggregateError, that.stack, 1);
                if (arguments.length > 2)
                    installErrorCause(that, arguments[2]);
                var errorsArray = [];
                iterate(errors, push, { that: errorsArray });
                createNonEnumerableProperty(that, "errors", errorsArray);
                return that;
            };
            if (setPrototypeOf)
                setPrototypeOf($AggregateError, $Error);
            else
                copyConstructorProperties($AggregateError, $Error, { name: true });
            var AggregateErrorPrototype = $AggregateError.prototype = create($Error.prototype, {
                constructor: createPropertyDescriptor(1, $AggregateError),
                message: createPropertyDescriptor(1, ""),
                name: createPropertyDescriptor(1, "AggregateError")
            });
            $({ global: true, constructor: true, arity: 2 }, {
                AggregateError: $AggregateError
            });
        }
    });
    // node_modules/core-js/modules/es.aggregate-error.js
    var require_es_aggregate_error = __commonJS({
        "node_modules/core-js/modules/es.aggregate-error.js": function () {
            "use strict";
            require_es_aggregate_error_constructor();
        }
    });
    // node_modules/core-js/internals/add-to-unscopables.js
    var require_add_to_unscopables = __commonJS({
        "node_modules/core-js/internals/add-to-unscopables.js": function (exports, module) {
            "use strict";
            var wellKnownSymbol = require_well_known_symbol();
            var create = require_object_create();
            var defineProperty = require_object_define_property().f;
            var UNSCOPABLES = wellKnownSymbol("unscopables");
            var ArrayPrototype = Array.prototype;
            if (ArrayPrototype[UNSCOPABLES] === void 0) {
                defineProperty(ArrayPrototype, UNSCOPABLES, {
                    configurable: true,
                    value: create(null)
                });
            }
            module.exports = function (key) {
                ArrayPrototype[UNSCOPABLES][key] = true;
            };
        }
    });
    // node_modules/core-js/internals/iterators-core.js
    var require_iterators_core = __commonJS({
        "node_modules/core-js/internals/iterators-core.js": function (exports, module) {
            "use strict";
            var fails = require_fails();
            var isCallable = require_is_callable();
            var isObject = require_is_object();
            var create = require_object_create();
            var getPrototypeOf = require_object_get_prototype_of();
            var defineBuiltIn = require_define_built_in();
            var wellKnownSymbol = require_well_known_symbol();
            var IS_PURE = require_is_pure();
            var ITERATOR = wellKnownSymbol("iterator");
            var BUGGY_SAFARI_ITERATORS = false;
            var IteratorPrototype;
            var PrototypeOfArrayIteratorPrototype;
            var arrayIterator;
            if ([].keys) {
                arrayIterator = [].keys();
                if (!("next" in arrayIterator))
                    BUGGY_SAFARI_ITERATORS = true;
                else {
                    PrototypeOfArrayIteratorPrototype = getPrototypeOf(getPrototypeOf(arrayIterator));
                    if (PrototypeOfArrayIteratorPrototype !== Object.prototype)
                        IteratorPrototype = PrototypeOfArrayIteratorPrototype;
                }
            }
            var NEW_ITERATOR_PROTOTYPE = !isObject(IteratorPrototype) || fails(function () {
                var test = {};
                return IteratorPrototype[ITERATOR].call(test) !== test;
            });
            if (NEW_ITERATOR_PROTOTYPE)
                IteratorPrototype = {};
            else if (IS_PURE)
                IteratorPrototype = create(IteratorPrototype);
            if (!isCallable(IteratorPrototype[ITERATOR])) {
                defineBuiltIn(IteratorPrototype, ITERATOR, function () {
                    return this;
                });
            }
            module.exports = {
                IteratorPrototype: IteratorPrototype,
                BUGGY_SAFARI_ITERATORS: BUGGY_SAFARI_ITERATORS
            };
        }
    });
    // node_modules/core-js/internals/set-to-string-tag.js
    var require_set_to_string_tag = __commonJS({
        "node_modules/core-js/internals/set-to-string-tag.js": function (exports, module) {
            "use strict";
            var defineProperty = require_object_define_property().f;
            var hasOwn = require_has_own_property();
            var wellKnownSymbol = require_well_known_symbol();
            var TO_STRING_TAG = wellKnownSymbol("toStringTag");
            module.exports = function (target, TAG, STATIC) {
                if (target && !STATIC)
                    target = target.prototype;
                if (target && !hasOwn(target, TO_STRING_TAG)) {
                    defineProperty(target, TO_STRING_TAG, { configurable: true, value: TAG });
                }
            };
        }
    });
    // node_modules/core-js/internals/iterator-create-constructor.js
    var require_iterator_create_constructor = __commonJS({
        "node_modules/core-js/internals/iterator-create-constructor.js": function (exports, module) {
            "use strict";
            var IteratorPrototype = require_iterators_core().IteratorPrototype;
            var create = require_object_create();
            var createPropertyDescriptor = require_create_property_descriptor();
            var setToStringTag = require_set_to_string_tag();
            var Iterators = require_iterators();
            var returnThis = function () {
                return this;
            };
            module.exports = function (IteratorConstructor, NAME, next, ENUMERABLE_NEXT) {
                var TO_STRING_TAG = NAME + " Iterator";
                IteratorConstructor.prototype = create(IteratorPrototype, { next: createPropertyDescriptor(+!ENUMERABLE_NEXT, next) });
                setToStringTag(IteratorConstructor, TO_STRING_TAG, false, true);
                Iterators[TO_STRING_TAG] = returnThis;
                return IteratorConstructor;
            };
        }
    });
    // node_modules/core-js/internals/iterator-define.js
    var require_iterator_define = __commonJS({
        "node_modules/core-js/internals/iterator-define.js": function (exports, module) {
            "use strict";
            var $ = require_export();
            var call = require_function_call();
            var IS_PURE = require_is_pure();
            var FunctionName = require_function_name();
            var isCallable = require_is_callable();
            var createIteratorConstructor = require_iterator_create_constructor();
            var getPrototypeOf = require_object_get_prototype_of();
            var setPrototypeOf = require_object_set_prototype_of();
            var setToStringTag = require_set_to_string_tag();
            var createNonEnumerableProperty = require_create_non_enumerable_property();
            var defineBuiltIn = require_define_built_in();
            var wellKnownSymbol = require_well_known_symbol();
            var Iterators = require_iterators();
            var IteratorsCore = require_iterators_core();
            var PROPER_FUNCTION_NAME = FunctionName.PROPER;
            var CONFIGURABLE_FUNCTION_NAME = FunctionName.CONFIGURABLE;
            var IteratorPrototype = IteratorsCore.IteratorPrototype;
            var BUGGY_SAFARI_ITERATORS = IteratorsCore.BUGGY_SAFARI_ITERATORS;
            var ITERATOR = wellKnownSymbol("iterator");
            var KEYS = "keys";
            var VALUES = "values";
            var ENTRIES = "entries";
            var returnThis = function () {
                return this;
            };
            module.exports = function (Iterable, NAME, IteratorConstructor, next, DEFAULT, IS_SET, FORCED) {
                createIteratorConstructor(IteratorConstructor, NAME, next);
                var getIterationMethod = function (KIND) {
                    if (KIND === DEFAULT && defaultIterator)
                        return defaultIterator;
                    if (!BUGGY_SAFARI_ITERATORS && KIND && KIND in IterablePrototype)
                        return IterablePrototype[KIND];
                    switch (KIND) {
                        case KEYS:
                            return function keys() {
                                return new IteratorConstructor(this, KIND);
                            };
                        case VALUES:
                            return function values() {
                                return new IteratorConstructor(this, KIND);
                            };
                        case ENTRIES:
                            return function entries() {
                                return new IteratorConstructor(this, KIND);
                            };
                    }
                    return function () {
                        return new IteratorConstructor(this);
                    };
                };
                var TO_STRING_TAG = NAME + " Iterator";
                var INCORRECT_VALUES_NAME = false;
                var IterablePrototype = Iterable.prototype;
                var nativeIterator = IterablePrototype[ITERATOR] || IterablePrototype["@@iterator"] || DEFAULT && IterablePrototype[DEFAULT];
                var defaultIterator = !BUGGY_SAFARI_ITERATORS && nativeIterator || getIterationMethod(DEFAULT);
                var anyNativeIterator = NAME === "Array" ? IterablePrototype.entries || nativeIterator : nativeIterator;
                var CurrentIteratorPrototype, methods, KEY;
                if (anyNativeIterator) {
                    CurrentIteratorPrototype = getPrototypeOf(anyNativeIterator.call(new Iterable()));
                    if (CurrentIteratorPrototype !== Object.prototype && CurrentIteratorPrototype.next) {
                        if (!IS_PURE && getPrototypeOf(CurrentIteratorPrototype) !== IteratorPrototype) {
                            if (setPrototypeOf) {
                                setPrototypeOf(CurrentIteratorPrototype, IteratorPrototype);
                            }
                            else if (!isCallable(CurrentIteratorPrototype[ITERATOR])) {
                                defineBuiltIn(CurrentIteratorPrototype, ITERATOR, returnThis);
                            }
                        }
                        setToStringTag(CurrentIteratorPrototype, TO_STRING_TAG, true, true);
                        if (IS_PURE)
                            Iterators[TO_STRING_TAG] = returnThis;
                    }
                }
                if (PROPER_FUNCTION_NAME && DEFAULT === VALUES && nativeIterator && nativeIterator.name !== VALUES) {
                    if (!IS_PURE && CONFIGURABLE_FUNCTION_NAME) {
                        createNonEnumerableProperty(IterablePrototype, "name", VALUES);
                    }
                    else {
                        INCORRECT_VALUES_NAME = true;
                        defaultIterator = function values() {
                            return call(nativeIterator, this);
                        };
                    }
                }
                if (DEFAULT) {
                    methods = {
                        values: getIterationMethod(VALUES),
                        keys: IS_SET ? defaultIterator : getIterationMethod(KEYS),
                        entries: getIterationMethod(ENTRIES)
                    };
                    if (FORCED)
                        for (KEY in methods) {
                            if (BUGGY_SAFARI_ITERATORS || INCORRECT_VALUES_NAME || !(KEY in IterablePrototype)) {
                                defineBuiltIn(IterablePrototype, KEY, methods[KEY]);
                            }
                        }
                    else
                        $({ target: NAME, proto: true, forced: BUGGY_SAFARI_ITERATORS || INCORRECT_VALUES_NAME }, methods);
                }
                if ((!IS_PURE || FORCED) && IterablePrototype[ITERATOR] !== defaultIterator) {
                    defineBuiltIn(IterablePrototype, ITERATOR, defaultIterator, { name: DEFAULT });
                }
                Iterators[NAME] = defaultIterator;
                return methods;
            };
        }
    });
    // node_modules/core-js/internals/create-iter-result-object.js
    var require_create_iter_result_object = __commonJS({
        "node_modules/core-js/internals/create-iter-result-object.js": function (exports, module) {
            "use strict";
            module.exports = function (value, done) {
                return { value: value, done: done };
            };
        }
    });
    // node_modules/core-js/modules/es.array.iterator.js
    var require_es_array_iterator = __commonJS({
        "node_modules/core-js/modules/es.array.iterator.js": function (exports, module) {
            "use strict";
            var toIndexedObject = require_to_indexed_object();
            var addToUnscopables = require_add_to_unscopables();
            var Iterators = require_iterators();
            var InternalStateModule = require_internal_state();
            var defineProperty = require_object_define_property().f;
            var defineIterator = require_iterator_define();
            var createIterResultObject = require_create_iter_result_object();
            var IS_PURE = require_is_pure();
            var DESCRIPTORS = require_descriptors();
            var ARRAY_ITERATOR = "Array Iterator";
            var setInternalState = InternalStateModule.set;
            var getInternalState = InternalStateModule.getterFor(ARRAY_ITERATOR);
            module.exports = defineIterator(Array, "Array", function (iterated, kind) {
                setInternalState(this, {
                    type: ARRAY_ITERATOR,
                    target: toIndexedObject(iterated),
                    // target
                    index: 0,
                    // next index
                    kind: kind
                    // kind
                });
            }, function () {
                var state2 = getInternalState(this);
                var target = state2.target;
                var index = state2.index++;
                if (!target || index >= target.length) {
                    state2.target = null;
                    return createIterResultObject(void 0, true);
                }
                switch (state2.kind) {
                    case "keys":
                        return createIterResultObject(index, false);
                    case "values":
                        return createIterResultObject(target[index], false);
                }
                return createIterResultObject([index, target[index]], false);
            }, "values");
            var values = Iterators.Arguments = Iterators.Array;
            addToUnscopables("keys");
            addToUnscopables("values");
            addToUnscopables("entries");
            if (!IS_PURE && DESCRIPTORS && values.name !== "values")
                try {
                    defineProperty(values, "name", { value: "values" });
                }
                catch (error) {
                }
        }
    });
    // node_modules/core-js/internals/object-to-string.js
    var require_object_to_string = __commonJS({
        "node_modules/core-js/internals/object-to-string.js": function (exports, module) {
            "use strict";
            var TO_STRING_TAG_SUPPORT = require_to_string_tag_support();
            var classof = require_classof();
            module.exports = TO_STRING_TAG_SUPPORT ? {}.toString : function toString() {
                return "[object " + classof(this) + "]";
            };
        }
    });
    // node_modules/core-js/modules/es.object.to-string.js
    var require_es_object_to_string = __commonJS({
        "node_modules/core-js/modules/es.object.to-string.js": function () {
            "use strict";
            var TO_STRING_TAG_SUPPORT = require_to_string_tag_support();
            var defineBuiltIn = require_define_built_in();
            var toString = require_object_to_string();
            if (!TO_STRING_TAG_SUPPORT) {
                defineBuiltIn(Object.prototype, "toString", toString, { unsafe: true });
            }
        }
    });
    // node_modules/core-js/internals/environment.js
    var require_environment = __commonJS({
        "node_modules/core-js/internals/environment.js": function (exports, module) {
            "use strict";
            var globalThis2 = require_global_this();
            var userAgent = require_environment_user_agent();
            var classof = require_classof_raw();
            var userAgentStartsWith = function (string) {
                return userAgent.slice(0, string.length) === string;
            };
            module.exports = (function () {
                if (userAgentStartsWith("Bun/"))
                    return "BUN";
                if (userAgentStartsWith("Cloudflare-Workers"))
                    return "CLOUDFLARE";
                if (userAgentStartsWith("Deno/"))
                    return "DENO";
                if (userAgentStartsWith("Node.js/"))
                    return "NODE";
                if (globalThis2.Bun && typeof Bun.version == "string")
                    return "BUN";
                if (globalThis2.Deno && typeof Deno.version == "object")
                    return "DENO";
                if (classof(globalThis2.process) === "process")
                    return "NODE";
                if (globalThis2.window && globalThis2.document)
                    return "BROWSER";
                return "REST";
            })();
        }
    });
    // node_modules/core-js/internals/environment-is-node.js
    var require_environment_is_node = __commonJS({
        "node_modules/core-js/internals/environment-is-node.js": function (exports, module) {
            "use strict";
            var ENVIRONMENT = require_environment();
            module.exports = ENVIRONMENT === "NODE";
        }
    });
    // node_modules/core-js/internals/path.js
    var require_path = __commonJS({
        "node_modules/core-js/internals/path.js": function (exports, module) {
            "use strict";
            var globalThis2 = require_global_this();
            module.exports = globalThis2;
        }
    });
    // node_modules/core-js/internals/define-built-in-accessor.js
    var require_define_built_in_accessor = __commonJS({
        "node_modules/core-js/internals/define-built-in-accessor.js": function (exports, module) {
            "use strict";
            var makeBuiltIn = require_make_built_in();
            var defineProperty = require_object_define_property();
            module.exports = function (target, name, descriptor) {
                if (descriptor.get)
                    makeBuiltIn(descriptor.get, name, { getter: true });
                if (descriptor.set)
                    makeBuiltIn(descriptor.set, name, { setter: true });
                return defineProperty.f(target, name, descriptor);
            };
        }
    });
    // node_modules/core-js/internals/set-species.js
    var require_set_species = __commonJS({
        "node_modules/core-js/internals/set-species.js": function (exports, module) {
            "use strict";
            var getBuiltIn = require_get_built_in();
            var defineBuiltInAccessor = require_define_built_in_accessor();
            var wellKnownSymbol = require_well_known_symbol();
            var DESCRIPTORS = require_descriptors();
            var SPECIES = wellKnownSymbol("species");
            module.exports = function (CONSTRUCTOR_NAME) {
                var Constructor = getBuiltIn(CONSTRUCTOR_NAME);
                if (DESCRIPTORS && Constructor && !Constructor[SPECIES]) {
                    defineBuiltInAccessor(Constructor, SPECIES, {
                        configurable: true,
                        get: function () {
                            return this;
                        }
                    });
                }
            };
        }
    });
    // node_modules/core-js/internals/an-instance.js
    var require_an_instance = __commonJS({
        "node_modules/core-js/internals/an-instance.js": function (exports, module) {
            "use strict";
            var isPrototypeOf = require_object_is_prototype_of();
            var $TypeError = TypeError;
            module.exports = function (it, Prototype) {
                if (isPrototypeOf(Prototype, it))
                    return it;
                throw new $TypeError("Incorrect invocation");
            };
        }
    });
    // node_modules/core-js/internals/is-constructor.js
    var require_is_constructor = __commonJS({
        "node_modules/core-js/internals/is-constructor.js": function (exports, module) {
            "use strict";
            var uncurryThis = require_function_uncurry_this();
            var fails = require_fails();
            var isCallable = require_is_callable();
            var classof = require_classof();
            var getBuiltIn = require_get_built_in();
            var inspectSource = require_inspect_source();
            var noop = function () {
            };
            var construct = getBuiltIn("Reflect", "construct");
            var constructorRegExp = /^\s*(?:class|function)\b/;
            var exec = uncurryThis(constructorRegExp.exec);
            var INCORRECT_TO_STRING = !constructorRegExp.test(noop);
            var isConstructorModern = function isConstructor(argument) {
                if (!isCallable(argument))
                    return false;
                try {
                    construct(noop, [], argument);
                    return true;
                }
                catch (error) {
                    return false;
                }
            };
            var isConstructorLegacy = function isConstructor(argument) {
                if (!isCallable(argument))
                    return false;
                switch (classof(argument)) {
                    case "AsyncFunction":
                    case "GeneratorFunction":
                    case "AsyncGeneratorFunction":
                        return false;
                }
                try {
                    return INCORRECT_TO_STRING || !!exec(constructorRegExp, inspectSource(argument));
                }
                catch (error) {
                    return true;
                }
            };
            isConstructorLegacy.sham = true;
            module.exports = !construct || fails(function () {
                var called;
                return isConstructorModern(isConstructorModern.call) || !isConstructorModern(Object) || !isConstructorModern(function () {
                    called = true;
                }) || called;
            }) ? isConstructorLegacy : isConstructorModern;
        }
    });
    // node_modules/core-js/internals/a-constructor.js
    var require_a_constructor = __commonJS({
        "node_modules/core-js/internals/a-constructor.js": function (exports, module) {
            "use strict";
            var isConstructor = require_is_constructor();
            var tryToString = require_try_to_string();
            var $TypeError = TypeError;
            module.exports = function (argument) {
                if (isConstructor(argument))
                    return argument;
                throw new $TypeError(tryToString(argument) + " is not a constructor");
            };
        }
    });
    // node_modules/core-js/internals/species-constructor.js
    var require_species_constructor = __commonJS({
        "node_modules/core-js/internals/species-constructor.js": function (exports, module) {
            "use strict";
            var anObject = require_an_object();
            var aConstructor = require_a_constructor();
            var isNullOrUndefined = require_is_null_or_undefined();
            var wellKnownSymbol = require_well_known_symbol();
            var SPECIES = wellKnownSymbol("species");
            module.exports = function (O, defaultConstructor) {
                var C = anObject(O).constructor;
                var S;
                return C === void 0 || isNullOrUndefined(S = anObject(C)[SPECIES]) ? defaultConstructor : aConstructor(S);
            };
        }
    });
    // node_modules/core-js/internals/function-apply.js
    var require_function_apply = __commonJS({
        "node_modules/core-js/internals/function-apply.js": function (exports, module) {
            "use strict";
            var NATIVE_BIND = require_function_bind_native();
            var FunctionPrototype = Function.prototype;
            var apply = FunctionPrototype.apply;
            var call = FunctionPrototype.call;
            module.exports = typeof Reflect == "object" && Reflect.apply || (NATIVE_BIND ? call.bind(apply) : function () {
                return call.apply(apply, arguments);
            });
        }
    });
    // node_modules/core-js/internals/array-slice.js
    var require_array_slice = __commonJS({
        "node_modules/core-js/internals/array-slice.js": function (exports, module) {
            "use strict";
            var uncurryThis = require_function_uncurry_this();
            module.exports = uncurryThis([].slice);
        }
    });
    // node_modules/core-js/internals/validate-arguments-length.js
    var require_validate_arguments_length = __commonJS({
        "node_modules/core-js/internals/validate-arguments-length.js": function (exports, module) {
            "use strict";
            var $TypeError = TypeError;
            module.exports = function (passed, required) {
                if (passed < required)
                    throw new $TypeError("Not enough arguments");
                return passed;
            };
        }
    });
    // node_modules/core-js/internals/environment-is-ios.js
    var require_environment_is_ios = __commonJS({
        "node_modules/core-js/internals/environment-is-ios.js": function (exports, module) {
            "use strict";
            var userAgent = require_environment_user_agent();
            module.exports = /ipad|iphone|ipod/i.test(userAgent) && /applewebkit/i.test(userAgent);
        }
    });
    // node_modules/core-js/internals/task.js
    var require_task = __commonJS({
        "node_modules/core-js/internals/task.js": function (exports, module) {
            "use strict";
            var globalThis2 = require_global_this();
            var apply = require_function_apply();
            var bind = require_function_bind_context();
            var isCallable = require_is_callable();
            var hasOwn = require_has_own_property();
            var fails = require_fails();
            var html = require_html();
            var arraySlice = require_array_slice();
            var createElement = require_document_create_element();
            var validateArgumentsLength = require_validate_arguments_length();
            var IS_IOS = require_environment_is_ios();
            var IS_NODE = require_environment_is_node();
            var set = globalThis2.setImmediate;
            var clear2 = globalThis2.clearImmediate;
            var process = globalThis2.process;
            var Dispatch = globalThis2.Dispatch;
            var Function2 = globalThis2.Function;
            var MessageChannel = globalThis2.MessageChannel;
            var String2 = globalThis2.String;
            var counter = 0;
            var queue2 = {};
            var ONREADYSTATECHANGE = "onreadystatechange";
            var $location;
            var defer;
            var channel;
            var port;
            fails(function () {
                $location = globalThis2.location;
            });
            var run = function (id) {
                if (hasOwn(queue2, id)) {
                    var fn = queue2[id];
                    delete queue2[id];
                    fn();
                }
            };
            var runner = function (id) {
                return function () {
                    run(id);
                };
            };
            var eventListener = function (event) {
                run(event.data);
            };
            var globalPostMessageDefer = function (id) {
                globalThis2.postMessage(String2(id), $location.protocol + "//" + $location.host);
            };
            if (!set || !clear2) {
                set = function setImmediate(handler) {
                    validateArgumentsLength(arguments.length, 1);
                    var fn = isCallable(handler) ? handler : Function2(handler);
                    var args = arraySlice(arguments, 1);
                    queue2[++counter] = function () {
                        apply(fn, void 0, args);
                    };
                    defer(counter);
                    return counter;
                };
                clear2 = function clearImmediate(id) {
                    delete queue2[id];
                };
                if (IS_NODE) {
                    defer = function (id) {
                        process.nextTick(runner(id));
                    };
                }
                else if (Dispatch && Dispatch.now) {
                    defer = function (id) {
                        Dispatch.now(runner(id));
                    };
                }
                else if (MessageChannel && !IS_IOS) {
                    channel = new MessageChannel();
                    port = channel.port2;
                    channel.port1.onmessage = eventListener;
                    defer = bind(port.postMessage, port);
                }
                else if (globalThis2.addEventListener && isCallable(globalThis2.postMessage) && !globalThis2.importScripts && $location && $location.protocol !== "file:" && !fails(globalPostMessageDefer)) {
                    defer = globalPostMessageDefer;
                    globalThis2.addEventListener("message", eventListener, false);
                }
                else if (ONREADYSTATECHANGE in createElement("script")) {
                    defer = function (id) {
                        html.appendChild(createElement("script"))[ONREADYSTATECHANGE] = function () {
                            html.removeChild(this);
                            run(id);
                        };
                    };
                }
                else {
                    defer = function (id) {
                        setTimeout(runner(id), 0);
                    };
                }
            }
            module.exports = {
                set: set,
                clear: clear2
            };
        }
    });
    // node_modules/core-js/internals/safe-get-built-in.js
    var require_safe_get_built_in = __commonJS({
        "node_modules/core-js/internals/safe-get-built-in.js": function (exports, module) {
            "use strict";
            var globalThis2 = require_global_this();
            var DESCRIPTORS = require_descriptors();
            var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
            module.exports = function (name) {
                if (!DESCRIPTORS)
                    return globalThis2[name];
                var descriptor = getOwnPropertyDescriptor(globalThis2, name);
                return descriptor && descriptor.value;
            };
        }
    });
    // node_modules/core-js/internals/queue.js
    var require_queue = __commonJS({
        "node_modules/core-js/internals/queue.js": function (exports, module) {
            "use strict";
            var Queue = function () {
                this.head = null;
                this.tail = null;
            };
            Queue.prototype = {
                add: function (item) {
                    var entry = { item: item, next: null };
                    var tail = this.tail;
                    if (tail)
                        tail.next = entry;
                    else
                        this.head = entry;
                    this.tail = entry;
                },
                get: function () {
                    var entry = this.head;
                    if (entry) {
                        var next = this.head = entry.next;
                        if (next === null)
                            this.tail = null;
                        return entry.item;
                    }
                }
            };
            module.exports = Queue;
        }
    });
    // node_modules/core-js/internals/environment-is-ios-pebble.js
    var require_environment_is_ios_pebble = __commonJS({
        "node_modules/core-js/internals/environment-is-ios-pebble.js": function (exports, module) {
            "use strict";
            var userAgent = require_environment_user_agent();
            module.exports = /ipad|iphone|ipod/i.test(userAgent) && typeof Pebble != "undefined";
        }
    });
    // node_modules/core-js/internals/environment-is-webos-webkit.js
    var require_environment_is_webos_webkit = __commonJS({
        "node_modules/core-js/internals/environment-is-webos-webkit.js": function (exports, module) {
            "use strict";
            var userAgent = require_environment_user_agent();
            module.exports = /web0s(?!.*chrome)/i.test(userAgent);
        }
    });
    // node_modules/core-js/internals/microtask.js
    var require_microtask = __commonJS({
        "node_modules/core-js/internals/microtask.js": function (exports, module) {
            "use strict";
            var globalThis2 = require_global_this();
            var safeGetBuiltIn = require_safe_get_built_in();
            var bind = require_function_bind_context();
            var macrotask = require_task().set;
            var Queue = require_queue();
            var IS_IOS = require_environment_is_ios();
            var IS_IOS_PEBBLE = require_environment_is_ios_pebble();
            var IS_WEBOS_WEBKIT = require_environment_is_webos_webkit();
            var IS_NODE = require_environment_is_node();
            var MutationObserver = globalThis2.MutationObserver || globalThis2.WebKitMutationObserver;
            var document2 = globalThis2.document;
            var process = globalThis2.process;
            var Promise2 = globalThis2.Promise;
            var microtask = safeGetBuiltIn("queueMicrotask");
            var notify2;
            var toggle;
            var node;
            var promise;
            var then;
            if (!microtask) {
                queue2 = new Queue();
                flush = function () {
                    var parent, fn;
                    if (IS_NODE && (parent = process.domain))
                        parent.exit();
                    while (fn = queue2.get())
                        try {
                            fn();
                        }
                        catch (error) {
                            if (queue2.head)
                                notify2();
                            throw error;
                        }
                    if (parent)
                        parent.enter();
                };
                if (!IS_IOS && !IS_NODE && !IS_WEBOS_WEBKIT && MutationObserver && document2) {
                    toggle = true;
                    node = document2.createTextNode("");
                    new MutationObserver(flush).observe(node, { characterData: true });
                    notify2 = function () {
                        node.data = toggle = !toggle;
                    };
                }
                else if (!IS_IOS_PEBBLE && Promise2 && Promise2.resolve) {
                    promise = Promise2.resolve(void 0);
                    promise.constructor = Promise2;
                    then = bind(promise.then, promise);
                    notify2 = function () {
                        then(flush);
                    };
                }
                else if (IS_NODE) {
                    notify2 = function () {
                        process.nextTick(flush);
                    };
                }
                else {
                    macrotask = bind(macrotask, globalThis2);
                    notify2 = function () {
                        macrotask(flush);
                    };
                }
                microtask = function (fn) {
                    if (!queue2.head)
                        notify2();
                    queue2.add(fn);
                };
            }
            var queue2;
            var flush;
            module.exports = microtask;
        }
    });
    // node_modules/core-js/internals/host-report-errors.js
    var require_host_report_errors = __commonJS({
        "node_modules/core-js/internals/host-report-errors.js": function (exports, module) {
            "use strict";
            module.exports = function (a, b) {
                try {
                    arguments.length === 1 ? console.error(a) : console.error(a, b);
                }
                catch (error) {
                }
            };
        }
    });
    // node_modules/core-js/internals/perform.js
    var require_perform = __commonJS({
        "node_modules/core-js/internals/perform.js": function (exports, module) {
            "use strict";
            module.exports = function (exec) {
                try {
                    return { error: false, value: exec() };
                }
                catch (error) {
                    return { error: true, value: error };
                }
            };
        }
    });
    // node_modules/core-js/internals/promise-native-constructor.js
    var require_promise_native_constructor = __commonJS({
        "node_modules/core-js/internals/promise-native-constructor.js": function (exports, module) {
            "use strict";
            var globalThis2 = require_global_this();
            module.exports = globalThis2.Promise;
        }
    });
    // node_modules/core-js/internals/promise-constructor-detection.js
    var require_promise_constructor_detection = __commonJS({
        "node_modules/core-js/internals/promise-constructor-detection.js": function (exports, module) {
            "use strict";
            var globalThis2 = require_global_this();
            var NativePromiseConstructor = require_promise_native_constructor();
            var isCallable = require_is_callable();
            var isForced = require_is_forced();
            var inspectSource = require_inspect_source();
            var wellKnownSymbol = require_well_known_symbol();
            var ENVIRONMENT = require_environment();
            var IS_PURE = require_is_pure();
            var V8_VERSION = require_environment_v8_version();
            var NativePromisePrototype = NativePromiseConstructor && NativePromiseConstructor.prototype;
            var SPECIES = wellKnownSymbol("species");
            var SUBCLASSING = false;
            var NATIVE_PROMISE_REJECTION_EVENT = isCallable(globalThis2.PromiseRejectionEvent);
            var FORCED_PROMISE_CONSTRUCTOR = isForced("Promise", function () {
                var PROMISE_CONSTRUCTOR_SOURCE = inspectSource(NativePromiseConstructor);
                var GLOBAL_CORE_JS_PROMISE = PROMISE_CONSTRUCTOR_SOURCE !== String(NativePromiseConstructor);
                if (!GLOBAL_CORE_JS_PROMISE && V8_VERSION === 66)
                    return true;
                if (IS_PURE && !(NativePromisePrototype["catch"] && NativePromisePrototype["finally"]))
                    return true;
                if (!V8_VERSION || V8_VERSION < 51 || !/native code/.test(PROMISE_CONSTRUCTOR_SOURCE)) {
                    var promise = new NativePromiseConstructor(function (resolve) {
                        resolve(1);
                    });
                    var FakePromise = function (exec) {
                        exec(function () {
                        }, function () {
                        });
                    };
                    var constructor = promise.constructor = {};
                    constructor[SPECIES] = FakePromise;
                    SUBCLASSING = promise.then(function () {
                    }) instanceof FakePromise;
                    if (!SUBCLASSING)
                        return true;
                }
                return !GLOBAL_CORE_JS_PROMISE && (ENVIRONMENT === "BROWSER" || ENVIRONMENT === "DENO") && !NATIVE_PROMISE_REJECTION_EVENT;
            });
            module.exports = {
                CONSTRUCTOR: FORCED_PROMISE_CONSTRUCTOR,
                REJECTION_EVENT: NATIVE_PROMISE_REJECTION_EVENT,
                SUBCLASSING: SUBCLASSING
            };
        }
    });
    // node_modules/core-js/internals/new-promise-capability.js
    var require_new_promise_capability = __commonJS({
        "node_modules/core-js/internals/new-promise-capability.js": function (exports, module) {
            "use strict";
            var aCallable = require_a_callable();
            var $TypeError = TypeError;
            var PromiseCapability = function (C) {
                var resolve, reject;
                this.promise = new C(function ($$resolve, $$reject) {
                    if (resolve !== void 0 || reject !== void 0)
                        throw new $TypeError("Bad Promise constructor");
                    resolve = $$resolve;
                    reject = $$reject;
                });
                this.resolve = aCallable(resolve);
                this.reject = aCallable(reject);
            };
            module.exports.f = function (C) {
                return new PromiseCapability(C);
            };
        }
    });
    // node_modules/core-js/modules/es.promise.constructor.js
    var require_es_promise_constructor = __commonJS({
        "node_modules/core-js/modules/es.promise.constructor.js": function () {
            "use strict";
            var $ = require_export();
            var IS_PURE = require_is_pure();
            var IS_NODE = require_environment_is_node();
            var globalThis2 = require_global_this();
            var path = require_path();
            var call = require_function_call();
            var defineBuiltIn = require_define_built_in();
            var setPrototypeOf = require_object_set_prototype_of();
            var setToStringTag = require_set_to_string_tag();
            var setSpecies = require_set_species();
            var aCallable = require_a_callable();
            var isCallable = require_is_callable();
            var isObject = require_is_object();
            var anInstance = require_an_instance();
            var speciesConstructor = require_species_constructor();
            var task = require_task().set;
            var microtask = require_microtask();
            var hostReportErrors = require_host_report_errors();
            var perform2 = require_perform();
            var Queue = require_queue();
            var InternalStateModule = require_internal_state();
            var NativePromiseConstructor = require_promise_native_constructor();
            var PromiseConstructorDetection = require_promise_constructor_detection();
            var newPromiseCapabilityModule = require_new_promise_capability();
            var PROMISE = "Promise";
            var FORCED_PROMISE_CONSTRUCTOR = PromiseConstructorDetection.CONSTRUCTOR;
            var NATIVE_PROMISE_REJECTION_EVENT = PromiseConstructorDetection.REJECTION_EVENT;
            var NATIVE_PROMISE_SUBCLASSING = PromiseConstructorDetection.SUBCLASSING;
            var getInternalPromiseState = InternalStateModule.getterFor(PROMISE);
            var setInternalState = InternalStateModule.set;
            var NativePromisePrototype = NativePromiseConstructor && NativePromiseConstructor.prototype;
            var PromiseConstructor = NativePromiseConstructor;
            var PromisePrototype = NativePromisePrototype;
            var TypeError2 = globalThis2.TypeError;
            var document2 = globalThis2.document;
            var process = globalThis2.process;
            var newPromiseCapability = newPromiseCapabilityModule.f;
            var newGenericPromiseCapability = newPromiseCapability;
            var DISPATCH_EVENT = !!(document2 && document2.createEvent && globalThis2.dispatchEvent);
            var UNHANDLED_REJECTION = "unhandledrejection";
            var REJECTION_HANDLED = "rejectionhandled";
            var PENDING = 0;
            var FULFILLED = 1;
            var REJECTED = 2;
            var HANDLED = 1;
            var UNHANDLED = 2;
            var Internal;
            var OwnPromiseCapability;
            var PromiseWrapper;
            var nativeThen;
            var isThenable = function (it) {
                var then;
                return isObject(it) && isCallable(then = it.then) ? then : false;
            };
            var callReaction = function (reaction, state2) {
                var value = state2.value;
                var ok = state2.state === FULFILLED;
                var handler = ok ? reaction.ok : reaction.fail;
                var resolve = reaction.resolve;
                var reject = reaction.reject;
                var domain = reaction.domain;
                var result, then, exited;
                try {
                    if (handler) {
                        if (!ok) {
                            if (state2.rejection === UNHANDLED)
                                onHandleUnhandled(state2);
                            state2.rejection = HANDLED;
                        }
                        if (handler === true)
                            result = value;
                        else {
                            if (domain)
                                domain.enter();
                            result = handler(value);
                            if (domain) {
                                domain.exit();
                                exited = true;
                            }
                        }
                        if (result === reaction.promise) {
                            reject(new TypeError2("Promise-chain cycle"));
                        }
                        else if (then = isThenable(result)) {
                            call(then, result, resolve, reject);
                        }
                        else
                            resolve(result);
                    }
                    else
                        reject(value);
                }
                catch (error) {
                    if (domain && !exited)
                        domain.exit();
                    reject(error);
                }
            };
            var notify2 = function (state2, isReject) {
                if (state2.notified)
                    return;
                state2.notified = true;
                microtask(function () {
                    var reactions = state2.reactions;
                    var reaction;
                    while (reaction = reactions.get()) {
                        callReaction(reaction, state2);
                    }
                    state2.notified = false;
                    if (isReject && !state2.rejection)
                        onUnhandled(state2);
                });
            };
            var dispatchEvent = function (name, promise, reason) {
                var event, handler;
                if (DISPATCH_EVENT) {
                    event = document2.createEvent("Event");
                    event.promise = promise;
                    event.reason = reason;
                    event.initEvent(name, false, true);
                    globalThis2.dispatchEvent(event);
                }
                else
                    event = { promise: promise, reason: reason };
                if (!NATIVE_PROMISE_REJECTION_EVENT && (handler = globalThis2["on" + name]))
                    handler(event);
                else if (name === UNHANDLED_REJECTION)
                    hostReportErrors("Unhandled promise rejection", reason);
            };
            var onUnhandled = function (state2) {
                call(task, globalThis2, function () {
                    var promise = state2.facade;
                    var value = state2.value;
                    var IS_UNHANDLED = isUnhandled(state2);
                    var result;
                    if (IS_UNHANDLED) {
                        result = perform2(function () {
                            if (IS_NODE) {
                                process.emit("unhandledRejection", value, promise);
                            }
                            else
                                dispatchEvent(UNHANDLED_REJECTION, promise, value);
                        });
                        state2.rejection = IS_NODE || isUnhandled(state2) ? UNHANDLED : HANDLED;
                        if (result.error)
                            throw result.value;
                    }
                });
            };
            var isUnhandled = function (state2) {
                return state2.rejection !== HANDLED && !state2.parent;
            };
            var onHandleUnhandled = function (state2) {
                call(task, globalThis2, function () {
                    var promise = state2.facade;
                    if (IS_NODE) {
                        process.emit("rejectionHandled", promise);
                    }
                    else
                        dispatchEvent(REJECTION_HANDLED, promise, state2.value);
                });
            };
            var bind = function (fn, state2, unwrap) {
                return function (value) {
                    fn(state2, value, unwrap);
                };
            };
            var internalReject = function (state2, value, unwrap) {
                if (state2.done)
                    return;
                state2.done = true;
                if (unwrap)
                    state2 = unwrap;
                state2.value = value;
                state2.state = REJECTED;
                notify2(state2, true);
            };
            var internalResolve = function (state2, value, unwrap) {
                if (state2.done)
                    return;
                state2.done = true;
                if (unwrap)
                    state2 = unwrap;
                try {
                    if (state2.facade === value)
                        throw new TypeError2("Promise can't be resolved itself");
                    var then = isThenable(value);
                    if (then) {
                        microtask(function () {
                            var wrapper = { done: false };
                            try {
                                call(then, value, bind(internalResolve, wrapper, state2), bind(internalReject, wrapper, state2));
                            }
                            catch (error) {
                                internalReject(wrapper, error, state2);
                            }
                        });
                    }
                    else {
                        state2.value = value;
                        state2.state = FULFILLED;
                        notify2(state2, false);
                    }
                }
                catch (error) {
                    internalReject({ done: false }, error, state2);
                }
            };
            if (FORCED_PROMISE_CONSTRUCTOR) {
                PromiseConstructor = function Promise2(executor) {
                    anInstance(this, PromisePrototype);
                    aCallable(executor);
                    call(Internal, this);
                    var state2 = getInternalPromiseState(this);
                    try {
                        executor(bind(internalResolve, state2), bind(internalReject, state2));
                    }
                    catch (error) {
                        internalReject(state2, error);
                    }
                };
                PromisePrototype = PromiseConstructor.prototype;
                Internal = function Promise2(executor) {
                    setInternalState(this, {
                        type: PROMISE,
                        done: false,
                        notified: false,
                        parent: false,
                        reactions: new Queue(),
                        rejection: false,
                        state: PENDING,
                        value: null
                    });
                };
                Internal.prototype = defineBuiltIn(PromisePrototype, "then", function then(onFulfilled, onRejected) {
                    var state2 = getInternalPromiseState(this);
                    var reaction = newPromiseCapability(speciesConstructor(this, PromiseConstructor));
                    state2.parent = true;
                    reaction.ok = isCallable(onFulfilled) ? onFulfilled : true;
                    reaction.fail = isCallable(onRejected) && onRejected;
                    reaction.domain = IS_NODE ? process.domain : void 0;
                    if (state2.state === PENDING)
                        state2.reactions.add(reaction);
                    else
                        microtask(function () {
                            callReaction(reaction, state2);
                        });
                    return reaction.promise;
                });
                OwnPromiseCapability = function () {
                    var promise = new Internal();
                    var state2 = getInternalPromiseState(promise);
                    this.promise = promise;
                    this.resolve = bind(internalResolve, state2);
                    this.reject = bind(internalReject, state2);
                };
                newPromiseCapabilityModule.f = newPromiseCapability = function (C) {
                    return C === PromiseConstructor || C === PromiseWrapper ? new OwnPromiseCapability(C) : newGenericPromiseCapability(C);
                };
                if (!IS_PURE && isCallable(NativePromiseConstructor) && NativePromisePrototype !== Object.prototype) {
                    nativeThen = NativePromisePrototype.then;
                    if (!NATIVE_PROMISE_SUBCLASSING) {
                        defineBuiltIn(NativePromisePrototype, "then", function then(onFulfilled, onRejected) {
                            var that = this;
                            return new PromiseConstructor(function (resolve, reject) {
                                call(nativeThen, that, resolve, reject);
                            }).then(onFulfilled, onRejected);
                        }, { unsafe: true });
                    }
                    try {
                        delete NativePromisePrototype.constructor;
                    }
                    catch (error) {
                    }
                    if (setPrototypeOf) {
                        setPrototypeOf(NativePromisePrototype, PromisePrototype);
                    }
                }
            }
            $({ global: true, constructor: true, wrap: true, forced: FORCED_PROMISE_CONSTRUCTOR }, {
                Promise: PromiseConstructor
            });
            PromiseWrapper = path.Promise;
            setToStringTag(PromiseConstructor, PROMISE, false, true);
            setSpecies(PROMISE);
        }
    });
    // node_modules/core-js/internals/check-correctness-of-iteration.js
    var require_check_correctness_of_iteration = __commonJS({
        "node_modules/core-js/internals/check-correctness-of-iteration.js": function (exports, module) {
            "use strict";
            var wellKnownSymbol = require_well_known_symbol();
            var ITERATOR = wellKnownSymbol("iterator");
            var SAFE_CLOSING = false;
            try {
                called = 0;
                iteratorWithReturn = {
                    next: function () {
                        return { done: !!called++ };
                    },
                    "return": function () {
                        SAFE_CLOSING = true;
                    }
                };
                iteratorWithReturn[ITERATOR] = function () {
                    return this;
                };
                Array.from(iteratorWithReturn, function () {
                    throw 2;
                });
            }
            catch (error) {
            }
            var called;
            var iteratorWithReturn;
            module.exports = function (exec, SKIP_CLOSING) {
                try {
                    if (!SKIP_CLOSING && !SAFE_CLOSING)
                        return false;
                }
                catch (error) {
                    return false;
                }
                var ITERATION_SUPPORT = false;
                try {
                    var object = {};
                    object[ITERATOR] = function () {
                        return {
                            next: function () {
                                return { done: ITERATION_SUPPORT = true };
                            }
                        };
                    };
                    exec(object);
                }
                catch (error) {
                }
                return ITERATION_SUPPORT;
            };
        }
    });
    // node_modules/core-js/internals/promise-statics-incorrect-iteration.js
    var require_promise_statics_incorrect_iteration = __commonJS({
        "node_modules/core-js/internals/promise-statics-incorrect-iteration.js": function (exports, module) {
            "use strict";
            var NativePromiseConstructor = require_promise_native_constructor();
            var checkCorrectnessOfIteration = require_check_correctness_of_iteration();
            var FORCED_PROMISE_CONSTRUCTOR = require_promise_constructor_detection().CONSTRUCTOR;
            module.exports = FORCED_PROMISE_CONSTRUCTOR || !checkCorrectnessOfIteration(function (iterable) {
                NativePromiseConstructor.all(iterable).then(void 0, function () {
                });
            });
        }
    });
    // node_modules/core-js/modules/es.promise.all.js
    var require_es_promise_all = __commonJS({
        "node_modules/core-js/modules/es.promise.all.js": function () {
            "use strict";
            var $ = require_export();
            var call = require_function_call();
            var aCallable = require_a_callable();
            var newPromiseCapabilityModule = require_new_promise_capability();
            var perform2 = require_perform();
            var iterate = require_iterate();
            var PROMISE_STATICS_INCORRECT_ITERATION = require_promise_statics_incorrect_iteration();
            $({ target: "Promise", stat: true, forced: PROMISE_STATICS_INCORRECT_ITERATION }, {
                all: function all(iterable) {
                    var C = this;
                    var capability = newPromiseCapabilityModule.f(C);
                    var resolve = capability.resolve;
                    var reject = capability.reject;
                    var result = perform2(function () {
                        var $promiseResolve = aCallable(C.resolve);
                        var values = [];
                        var counter = 0;
                        var remaining = 1;
                        iterate(iterable, function (promise) {
                            var index = counter++;
                            var alreadyCalled = false;
                            remaining++;
                            call($promiseResolve, C, promise).then(function (value) {
                                if (alreadyCalled)
                                    return;
                                alreadyCalled = true;
                                values[index] = value;
                                --remaining || resolve(values);
                            }, reject);
                        });
                        --remaining || resolve(values);
                    });
                    if (result.error)
                        reject(result.value);
                    return capability.promise;
                }
            });
        }
    });
    // node_modules/core-js/modules/es.promise.catch.js
    var require_es_promise_catch = __commonJS({
        "node_modules/core-js/modules/es.promise.catch.js": function () {
            "use strict";
            var $ = require_export();
            var IS_PURE = require_is_pure();
            var FORCED_PROMISE_CONSTRUCTOR = require_promise_constructor_detection().CONSTRUCTOR;
            var NativePromiseConstructor = require_promise_native_constructor();
            var getBuiltIn = require_get_built_in();
            var isCallable = require_is_callable();
            var defineBuiltIn = require_define_built_in();
            var NativePromisePrototype = NativePromiseConstructor && NativePromiseConstructor.prototype;
            $({ target: "Promise", proto: true, forced: FORCED_PROMISE_CONSTRUCTOR, real: true }, {
                "catch": function (onRejected) {
                    return this.then(void 0, onRejected);
                }
            });
            if (!IS_PURE && isCallable(NativePromiseConstructor)) {
                method = getBuiltIn("Promise").prototype["catch"];
                if (NativePromisePrototype["catch"] !== method) {
                    defineBuiltIn(NativePromisePrototype, "catch", method, { unsafe: true });
                }
            }
            var method;
        }
    });
    // node_modules/core-js/modules/es.promise.race.js
    var require_es_promise_race = __commonJS({
        "node_modules/core-js/modules/es.promise.race.js": function () {
            "use strict";
            var $ = require_export();
            var call = require_function_call();
            var aCallable = require_a_callable();
            var newPromiseCapabilityModule = require_new_promise_capability();
            var perform2 = require_perform();
            var iterate = require_iterate();
            var PROMISE_STATICS_INCORRECT_ITERATION = require_promise_statics_incorrect_iteration();
            $({ target: "Promise", stat: true, forced: PROMISE_STATICS_INCORRECT_ITERATION }, {
                race: function race(iterable) {
                    var C = this;
                    var capability = newPromiseCapabilityModule.f(C);
                    var reject = capability.reject;
                    var result = perform2(function () {
                        var $promiseResolve = aCallable(C.resolve);
                        iterate(iterable, function (promise) {
                            call($promiseResolve, C, promise).then(capability.resolve, reject);
                        });
                    });
                    if (result.error)
                        reject(result.value);
                    return capability.promise;
                }
            });
        }
    });
    // node_modules/core-js/modules/es.promise.reject.js
    var require_es_promise_reject = __commonJS({
        "node_modules/core-js/modules/es.promise.reject.js": function () {
            "use strict";
            var $ = require_export();
            var newPromiseCapabilityModule = require_new_promise_capability();
            var FORCED_PROMISE_CONSTRUCTOR = require_promise_constructor_detection().CONSTRUCTOR;
            $({ target: "Promise", stat: true, forced: FORCED_PROMISE_CONSTRUCTOR }, {
                reject: function reject(r) {
                    var capability = newPromiseCapabilityModule.f(this);
                    var capabilityReject = capability.reject;
                    capabilityReject(r);
                    return capability.promise;
                }
            });
        }
    });
    // node_modules/core-js/internals/promise-resolve.js
    var require_promise_resolve = __commonJS({
        "node_modules/core-js/internals/promise-resolve.js": function (exports, module) {
            "use strict";
            var anObject = require_an_object();
            var isObject = require_is_object();
            var newPromiseCapability = require_new_promise_capability();
            module.exports = function (C, x) {
                anObject(C);
                if (isObject(x) && x.constructor === C)
                    return x;
                var promiseCapability = newPromiseCapability.f(C);
                var resolve = promiseCapability.resolve;
                resolve(x);
                return promiseCapability.promise;
            };
        }
    });
    // node_modules/core-js/modules/es.promise.resolve.js
    var require_es_promise_resolve = __commonJS({
        "node_modules/core-js/modules/es.promise.resolve.js": function () {
            "use strict";
            var $ = require_export();
            var getBuiltIn = require_get_built_in();
            var IS_PURE = require_is_pure();
            var NativePromiseConstructor = require_promise_native_constructor();
            var FORCED_PROMISE_CONSTRUCTOR = require_promise_constructor_detection().CONSTRUCTOR;
            var promiseResolve = require_promise_resolve();
            var PromiseConstructorWrapper = getBuiltIn("Promise");
            var CHECK_WRAPPER = IS_PURE && !FORCED_PROMISE_CONSTRUCTOR;
            $({ target: "Promise", stat: true, forced: IS_PURE || FORCED_PROMISE_CONSTRUCTOR }, {
                resolve: function resolve(x) {
                    return promiseResolve(CHECK_WRAPPER && this === PromiseConstructorWrapper ? NativePromiseConstructor : this, x);
                }
            });
        }
    });
    // node_modules/core-js/modules/es.promise.js
    var require_es_promise = __commonJS({
        "node_modules/core-js/modules/es.promise.js": function () {
            "use strict";
            require_es_promise_constructor();
            require_es_promise_all();
            require_es_promise_catch();
            require_es_promise_race();
            require_es_promise_reject();
            require_es_promise_resolve();
        }
    });
    // node_modules/core-js/modules/es.promise.all-settled.js
    var require_es_promise_all_settled = __commonJS({
        "node_modules/core-js/modules/es.promise.all-settled.js": function () {
            "use strict";
            var $ = require_export();
            var call = require_function_call();
            var aCallable = require_a_callable();
            var newPromiseCapabilityModule = require_new_promise_capability();
            var perform2 = require_perform();
            var iterate = require_iterate();
            var PROMISE_STATICS_INCORRECT_ITERATION = require_promise_statics_incorrect_iteration();
            $({ target: "Promise", stat: true, forced: PROMISE_STATICS_INCORRECT_ITERATION }, {
                allSettled: function allSettled(iterable) {
                    var C = this;
                    var capability = newPromiseCapabilityModule.f(C);
                    var resolve = capability.resolve;
                    var reject = capability.reject;
                    var result = perform2(function () {
                        var promiseResolve = aCallable(C.resolve);
                        var values = [];
                        var counter = 0;
                        var remaining = 1;
                        iterate(iterable, function (promise) {
                            var index = counter++;
                            var alreadyCalled = false;
                            remaining++;
                            call(promiseResolve, C, promise).then(function (value) {
                                if (alreadyCalled)
                                    return;
                                alreadyCalled = true;
                                values[index] = { status: "fulfilled", value: value };
                                --remaining || resolve(values);
                            }, function (error) {
                                if (alreadyCalled)
                                    return;
                                alreadyCalled = true;
                                values[index] = { status: "rejected", reason: error };
                                --remaining || resolve(values);
                            });
                        });
                        --remaining || resolve(values);
                    });
                    if (result.error)
                        reject(result.value);
                    return capability.promise;
                }
            });
        }
    });
    // node_modules/core-js/modules/es.promise.any.js
    var require_es_promise_any = __commonJS({
        "node_modules/core-js/modules/es.promise.any.js": function () {
            "use strict";
            var $ = require_export();
            var call = require_function_call();
            var aCallable = require_a_callable();
            var getBuiltIn = require_get_built_in();
            var newPromiseCapabilityModule = require_new_promise_capability();
            var perform2 = require_perform();
            var iterate = require_iterate();
            var PROMISE_STATICS_INCORRECT_ITERATION = require_promise_statics_incorrect_iteration();
            var PROMISE_ANY_ERROR = "No one promise resolved";
            $({ target: "Promise", stat: true, forced: PROMISE_STATICS_INCORRECT_ITERATION }, {
                any: function any(iterable) {
                    var C = this;
                    var AggregateError = getBuiltIn("AggregateError");
                    var capability = newPromiseCapabilityModule.f(C);
                    var resolve = capability.resolve;
                    var reject = capability.reject;
                    var result = perform2(function () {
                        var promiseResolve = aCallable(C.resolve);
                        var errors = [];
                        var counter = 0;
                        var remaining = 1;
                        var alreadyResolved = false;
                        iterate(iterable, function (promise) {
                            var index = counter++;
                            var alreadyRejected = false;
                            remaining++;
                            call(promiseResolve, C, promise).then(function (value) {
                                if (alreadyRejected || alreadyResolved)
                                    return;
                                alreadyResolved = true;
                                resolve(value);
                            }, function (error) {
                                if (alreadyRejected || alreadyResolved)
                                    return;
                                alreadyRejected = true;
                                errors[index] = error;
                                --remaining || reject(new AggregateError(errors, PROMISE_ANY_ERROR));
                            });
                        });
                        --remaining || reject(new AggregateError(errors, PROMISE_ANY_ERROR));
                    });
                    if (result.error)
                        reject(result.value);
                    return capability.promise;
                }
            });
        }
    });
    // node_modules/core-js/modules/es.promise.try.js
    var require_es_promise_try = __commonJS({
        "node_modules/core-js/modules/es.promise.try.js": function () {
            "use strict";
            var $ = require_export();
            var globalThis2 = require_global_this();
            var apply = require_function_apply();
            var slice = require_array_slice();
            var promiseResolve = require_promise_resolve();
            var newPromiseCapabilityModule = require_new_promise_capability();
            var aCallable = require_a_callable();
            var perform2 = require_perform();
            var fails = require_fails();
            var Promise2 = globalThis2.Promise;
            var ACCEPT_ARGUMENTS = false;
            var FORCED = !Promise2 || !Promise2["try"] || fails(function () {
                var p = Promise2.resolve();
                return Promise2["try"](function (argument) {
                    ACCEPT_ARGUMENTS = argument === 8;
                    return p;
                }, 8) !== p;
            }) || !ACCEPT_ARGUMENTS;
            $({ target: "Promise", stat: true, forced: FORCED }, {
                "try": function (callbackfn) {
                    var args = arguments.length > 1 ? slice(arguments, 1) : [];
                    var result = perform2(function () {
                        return apply(aCallable(callbackfn), void 0, args);
                    });
                    if (!result.error)
                        return promiseResolve(this, result.value);
                    var promiseCapability = newPromiseCapabilityModule.f(this);
                    var reject = promiseCapability.reject;
                    reject(result.value);
                    return promiseCapability.promise;
                }
            });
        }
    });
    // node_modules/core-js/modules/es.promise.with-resolvers.js
    var require_es_promise_with_resolvers = __commonJS({
        "node_modules/core-js/modules/es.promise.with-resolvers.js": function () {
            "use strict";
            var $ = require_export();
            var newPromiseCapabilityModule = require_new_promise_capability();
            $({ target: "Promise", stat: true }, {
                withResolvers: function withResolvers() {
                    var promiseCapability = newPromiseCapabilityModule.f(this);
                    return {
                        promise: promiseCapability.promise,
                        resolve: promiseCapability.resolve,
                        reject: promiseCapability.reject
                    };
                }
            });
        }
    });
    // node_modules/core-js/modules/es.promise.finally.js
    var require_es_promise_finally = __commonJS({
        "node_modules/core-js/modules/es.promise.finally.js": function () {
            "use strict";
            var $ = require_export();
            var IS_PURE = require_is_pure();
            var NativePromiseConstructor = require_promise_native_constructor();
            var fails = require_fails();
            var getBuiltIn = require_get_built_in();
            var isCallable = require_is_callable();
            var speciesConstructor = require_species_constructor();
            var promiseResolve = require_promise_resolve();
            var defineBuiltIn = require_define_built_in();
            var NativePromisePrototype = NativePromiseConstructor && NativePromiseConstructor.prototype;
            var NON_GENERIC = !!NativePromiseConstructor && fails(function () {
                NativePromisePrototype["finally"].call({ then: function () {
                    } }, function () {
                });
            });
            $({ target: "Promise", proto: true, real: true, forced: NON_GENERIC }, {
                "finally": function (onFinally) {
                    var C = speciesConstructor(this, getBuiltIn("Promise"));
                    var isFunction = isCallable(onFinally);
                    return this.then(isFunction ? function (x) {
                        return promiseResolve(C, onFinally()).then(function () {
                            return x;
                        });
                    } : onFinally, isFunction ? function (e) {
                        return promiseResolve(C, onFinally()).then(function () {
                            throw e;
                        });
                    } : onFinally);
                }
            });
            if (!IS_PURE && isCallable(NativePromiseConstructor)) {
                method = getBuiltIn("Promise").prototype["finally"];
                if (NativePromisePrototype["finally"] !== method) {
                    defineBuiltIn(NativePromisePrototype, "finally", method, { unsafe: true });
                }
            }
            var method;
        }
    });
    // node_modules/core-js/internals/string-multibyte.js
    var require_string_multibyte = __commonJS({
        "node_modules/core-js/internals/string-multibyte.js": function (exports, module) {
            "use strict";
            var uncurryThis = require_function_uncurry_this();
            var toIntegerOrInfinity = require_to_integer_or_infinity();
            var toString = require_to_string();
            var requireObjectCoercible = require_require_object_coercible();
            var charAt = uncurryThis("".charAt);
            var charCodeAt = uncurryThis("".charCodeAt);
            var stringSlice = uncurryThis("".slice);
            var createMethod = function (CONVERT_TO_STRING) {
                return function ($this, pos) {
                    var S = toString(requireObjectCoercible($this));
                    var position = toIntegerOrInfinity(pos);
                    var size = S.length;
                    var first, second;
                    if (position < 0 || position >= size)
                        return CONVERT_TO_STRING ? "" : void 0;
                    first = charCodeAt(S, position);
                    return first < 55296 || first > 56319 || position + 1 === size || (second = charCodeAt(S, position + 1)) < 56320 || second > 57343 ? CONVERT_TO_STRING ? charAt(S, position) : first : CONVERT_TO_STRING ? stringSlice(S, position, position + 2) : (first - 55296 << 10) + (second - 56320) + 65536;
                };
            };
            module.exports = {
                // `String.prototype.codePointAt` method
                // https://tc39.es/ecma262/#sec-string.prototype.codepointat
                codeAt: createMethod(false),
                // `String.prototype.at` method
                // https://github.com/mathiasbynens/String.prototype.at
                charAt: createMethod(true)
            };
        }
    });
    // node_modules/core-js/modules/es.string.iterator.js
    var require_es_string_iterator = __commonJS({
        "node_modules/core-js/modules/es.string.iterator.js": function () {
            "use strict";
            var charAt = require_string_multibyte().charAt;
            var toString = require_to_string();
            var InternalStateModule = require_internal_state();
            var defineIterator = require_iterator_define();
            var createIterResultObject = require_create_iter_result_object();
            var STRING_ITERATOR = "String Iterator";
            var setInternalState = InternalStateModule.set;
            var getInternalState = InternalStateModule.getterFor(STRING_ITERATOR);
            defineIterator(String, "String", function (iterated) {
                setInternalState(this, {
                    type: STRING_ITERATOR,
                    string: toString(iterated),
                    index: 0
                });
            }, function next() {
                var state2 = getInternalState(this);
                var string = state2.string;
                var index = state2.index;
                var point;
                if (index >= string.length)
                    return createIterResultObject(void 0, true);
                point = charAt(string, index);
                state2.index += point.length;
                return createIterResultObject(point, false);
            });
        }
    });
    // node_modules/core-js/es/promise/index.js
    var require_promise = __commonJS({
        "node_modules/core-js/es/promise/index.js": function (exports, module) {
            "use strict";
            require_es_aggregate_error();
            require_es_array_iterator();
            require_es_object_to_string();
            require_es_promise();
            require_es_promise_all_settled();
            require_es_promise_any();
            require_es_promise_try();
            require_es_promise_with_resolvers();
            require_es_promise_finally();
            require_es_string_iterator();
            var path = require_path();
            module.exports = path.Promise;
        }
    });
    // node_modules/core-js/internals/dom-iterables.js
    var require_dom_iterables = __commonJS({
        "node_modules/core-js/internals/dom-iterables.js": function (exports, module) {
            "use strict";
            module.exports = {
                CSSRuleList: 0,
                CSSStyleDeclaration: 0,
                CSSValueList: 0,
                ClientRectList: 0,
                DOMRectList: 0,
                DOMStringList: 0,
                DOMTokenList: 1,
                DataTransferItemList: 0,
                FileList: 0,
                HTMLAllCollection: 0,
                HTMLCollection: 0,
                HTMLFormElement: 0,
                HTMLSelectElement: 0,
                MediaList: 0,
                MimeTypeArray: 0,
                NamedNodeMap: 0,
                NodeList: 1,
                PaintRequestList: 0,
                Plugin: 0,
                PluginArray: 0,
                SVGLengthList: 0,
                SVGNumberList: 0,
                SVGPathSegList: 0,
                SVGPointList: 0,
                SVGStringList: 0,
                SVGTransformList: 0,
                SourceBufferList: 0,
                StyleSheetList: 0,
                TextTrackCueList: 0,
                TextTrackList: 0,
                TouchList: 0
            };
        }
    });
    // node_modules/core-js/internals/dom-token-list-prototype.js
    var require_dom_token_list_prototype = __commonJS({
        "node_modules/core-js/internals/dom-token-list-prototype.js": function (exports, module) {
            "use strict";
            var documentCreateElement = require_document_create_element();
            var classList = documentCreateElement("span").classList;
            var DOMTokenListPrototype = classList && classList.constructor && classList.constructor.prototype;
            module.exports = DOMTokenListPrototype === Object.prototype ? void 0 : DOMTokenListPrototype;
        }
    });
    // node_modules/core-js/modules/web.dom-collections.iterator.js
    var require_web_dom_collections_iterator = __commonJS({
        "node_modules/core-js/modules/web.dom-collections.iterator.js": function () {
            "use strict";
            var globalThis2 = require_global_this();
            var DOMIterables = require_dom_iterables();
            var DOMTokenListPrototype = require_dom_token_list_prototype();
            var ArrayIteratorMethods = require_es_array_iterator();
            var createNonEnumerableProperty = require_create_non_enumerable_property();
            var setToStringTag = require_set_to_string_tag();
            var wellKnownSymbol = require_well_known_symbol();
            var ITERATOR = wellKnownSymbol("iterator");
            var ArrayValues = ArrayIteratorMethods.values;
            var handlePrototype = function (CollectionPrototype, COLLECTION_NAME2) {
                if (CollectionPrototype) {
                    if (CollectionPrototype[ITERATOR] !== ArrayValues)
                        try {
                            createNonEnumerableProperty(CollectionPrototype, ITERATOR, ArrayValues);
                        }
                        catch (error) {
                            CollectionPrototype[ITERATOR] = ArrayValues;
                        }
                    setToStringTag(CollectionPrototype, COLLECTION_NAME2, true);
                    if (DOMIterables[COLLECTION_NAME2])
                        for (var METHOD_NAME in ArrayIteratorMethods) {
                            if (CollectionPrototype[METHOD_NAME] !== ArrayIteratorMethods[METHOD_NAME])
                                try {
                                    createNonEnumerableProperty(CollectionPrototype, METHOD_NAME, ArrayIteratorMethods[METHOD_NAME]);
                                }
                                catch (error) {
                                    CollectionPrototype[METHOD_NAME] = ArrayIteratorMethods[METHOD_NAME];
                                }
                        }
                }
            };
            for (COLLECTION_NAME in DOMIterables) {
                handlePrototype(globalThis2[COLLECTION_NAME] && globalThis2[COLLECTION_NAME].prototype, COLLECTION_NAME);
            }
            var COLLECTION_NAME;
            handlePrototype(DOMTokenListPrototype, "DOMTokenList");
        }
    });
    // node_modules/core-js/stable/promise/index.js
    var require_promise2 = __commonJS({
        "node_modules/core-js/stable/promise/index.js": function (exports, module) {
            "use strict";
            var parent = require_promise();
            require_web_dom_collections_iterator();
            module.exports = parent;
        }
    });
    // node_modules/core-js/modules/es.object.create.js
    var require_es_object_create = __commonJS({
        "node_modules/core-js/modules/es.object.create.js": function () {
            "use strict";
            var $ = require_export();
            var DESCRIPTORS = require_descriptors();
            var create = require_object_create();
            $({ target: "Object", stat: true, sham: !DESCRIPTORS }, {
                create: create
            });
        }
    });
    // node_modules/core-js/modules/es.reflect.own-keys.js
    var require_es_reflect_own_keys = __commonJS({
        "node_modules/core-js/modules/es.reflect.own-keys.js": function () {
            "use strict";
            var $ = require_export();
            var ownKeys = require_own_keys();
            $({ target: "Reflect", stat: true }, {
                ownKeys: ownKeys
            });
        }
    });
    // node_modules/core-js/internals/create-property.js
    var require_create_property = __commonJS({
        "node_modules/core-js/internals/create-property.js": function (exports, module) {
            "use strict";
            var DESCRIPTORS = require_descriptors();
            var definePropertyModule = require_object_define_property();
            var createPropertyDescriptor = require_create_property_descriptor();
            module.exports = function (object, key, value) {
                if (DESCRIPTORS)
                    definePropertyModule.f(object, key, createPropertyDescriptor(0, value));
                else
                    object[key] = value;
            };
        }
    });
    // node_modules/core-js/modules/esnext.promise.all-keyed.js
    var require_esnext_promise_all_keyed = __commonJS({
        "node_modules/core-js/modules/esnext.promise.all-keyed.js": function () {
            "use strict";
            var $ = require_export();
            var aCallable = require_a_callable();
            var anObject = require_an_object();
            var call = require_function_call();
            var createProperty = require_create_property();
            var getBuiltIn = require_get_built_in();
            var getOwnPropertyDescriptor = require_object_get_own_property_descriptor();
            var newPromiseCapabilityModule = require_new_promise_capability();
            var perform2 = require_perform();
            var create = getBuiltIn("Object", "create");
            var ownKeys = getBuiltIn("Reflect", "ownKeys");
            $({ target: "Promise", stat: true }, {
                allKeyed: function allKeyed(promises) {
                    var C = this;
                    var capability = newPromiseCapabilityModule.f(C);
                    var resolve = capability.resolve;
                    var reject = capability.reject;
                    var result = perform2(function () {
                        var promiseResolve = aCallable(C.resolve);
                        var allKeys = ownKeys(anObject(promises));
                        var keys = [];
                        var values = [];
                        var remaining = 1;
                        var counter = 0;
                        for (var i = 0; i < allKeys.length; i++)
                            (function (key) {
                                var desc = getOwnPropertyDescriptor.f(promises, key);
                                if (desc && desc.enumerable) {
                                    var index = counter;
                                    var alreadyCalled = false;
                                    remaining++;
                                    keys[index] = key;
                                    values[index] = void 0;
                                    call(promiseResolve, C, promises[key]).then(function (value) {
                                        if (alreadyCalled)
                                            return;
                                        alreadyCalled = true;
                                        values[index] = value;
                                        --remaining;
                                        if (remaining === 0) {
                                            var res = create(null);
                                            for (var j = 0; j < keys.length; j++)
                                                createProperty(res, keys[j], values[j]);
                                            resolve(res);
                                        }
                                    }, reject);
                                    counter++;
                                }
                            })(allKeys[i]);
                        --remaining || resolve(create(null));
                    });
                    if (result.error)
                        reject(result.value);
                    return capability.promise;
                }
            });
        }
    });
    // node_modules/core-js/modules/esnext.promise.all-settled-keyed.js
    var require_esnext_promise_all_settled_keyed = __commonJS({
        "node_modules/core-js/modules/esnext.promise.all-settled-keyed.js": function () {
            "use strict";
            var $ = require_export();
            var aCallable = require_a_callable();
            var anObject = require_an_object();
            var call = require_function_call();
            var createProperty = require_create_property();
            var getBuiltIn = require_get_built_in();
            var getOwnPropertyDescriptor = require_object_get_own_property_descriptor();
            var newPromiseCapabilityModule = require_new_promise_capability();
            var perform2 = require_perform();
            var create = getBuiltIn("Object", "create");
            var ownKeys = getBuiltIn("Reflect", "ownKeys");
            $({ target: "Promise", stat: true }, {
                allSettledKeyed: function allSettledKeyed(promises) {
                    var C = this;
                    var capability = newPromiseCapabilityModule.f(C);
                    var resolve = capability.resolve;
                    var reject = capability.reject;
                    var result = perform2(function () {
                        var promiseResolve = aCallable(C.resolve);
                        var allKeys = ownKeys(anObject(promises));
                        var keys = [];
                        var values = [];
                        var remaining = 1;
                        var counter = 0;
                        for (var i = 0; i < allKeys.length; i++)
                            (function (key) {
                                var desc = getOwnPropertyDescriptor.f(promises, key);
                                if (desc && desc.enumerable) {
                                    var createElementResolver = function (rejection) {
                                        return function (value) {
                                            if (alreadyCalled)
                                                return;
                                            alreadyCalled = true;
                                            values[index] = rejection ? { status: "rejected", reason: value } : { status: "fulfilled", value: value };
                                            if (--remaining)
                                                return;
                                            var res = create(null);
                                            for (var j = 0; j < keys.length; j++)
                                                createProperty(res, keys[j], values[j]);
                                            resolve(res);
                                        };
                                    };
                                    var index = counter;
                                    var alreadyCalled = false;
                                    remaining++;
                                    keys[index] = key;
                                    values[index] = void 0;
                                    call(promiseResolve, C, promises[key]).then(createElementResolver(false), createElementResolver(true));
                                    counter++;
                                }
                            })(allKeys[i]);
                        --remaining || resolve(create(null));
                    });
                    if (result.error)
                        reject(result.value);
                    return capability.promise;
                }
            });
        }
    });
    // node_modules/core-js/modules/esnext.promise.try.js
    var require_esnext_promise_try = __commonJS({
        "node_modules/core-js/modules/esnext.promise.try.js": function () {
            "use strict";
            require_es_promise_try();
        }
    });
    // node_modules/core-js/modules/esnext.promise.with-resolvers.js
    var require_esnext_promise_with_resolvers = __commonJS({
        "node_modules/core-js/modules/esnext.promise.with-resolvers.js": function () {
            "use strict";
            require_es_promise_with_resolvers();
        }
    });
    // node_modules/core-js/actual/promise/index.js
    var require_promise3 = __commonJS({
        "node_modules/core-js/actual/promise/index.js": function (exports, module) {
            "use strict";
            var parent = require_promise2();
            require_es_object_create();
            require_es_reflect_own_keys();
            require_esnext_promise_all_keyed();
            require_esnext_promise_all_settled_keyed();
            require_esnext_promise_try();
            require_esnext_promise_with_resolvers();
            module.exports = parent;
        }
    });
    // node_modules/core-js/internals/object-get-own-property-names-external.js
    var require_object_get_own_property_names_external = __commonJS({
        "node_modules/core-js/internals/object-get-own-property-names-external.js": function (exports, module) {
            "use strict";
            var classof = require_classof_raw();
            var toIndexedObject = require_to_indexed_object();
            var $getOwnPropertyNames = require_object_get_own_property_names().f;
            var arraySlice = require_array_slice();
            var windowNames = typeof window == "object" && window && Object.getOwnPropertyNames ? Object.getOwnPropertyNames(window) : [];
            var getWindowNames = function (it) {
                try {
                    return $getOwnPropertyNames(it);
                }
                catch (error) {
                    return arraySlice(windowNames);
                }
            };
            module.exports.f = function getOwnPropertyNames(it) {
                return windowNames && classof(it) === "Window" ? getWindowNames(it) : $getOwnPropertyNames(toIndexedObject(it));
            };
        }
    });
    // node_modules/core-js/internals/array-buffer-non-extensible.js
    var require_array_buffer_non_extensible = __commonJS({
        "node_modules/core-js/internals/array-buffer-non-extensible.js": function (exports, module) {
            "use strict";
            var fails = require_fails();
            module.exports = fails(function () {
                if (typeof ArrayBuffer == "function") {
                    var buffer = new ArrayBuffer(8);
                    if (Object.isExtensible(buffer))
                        Object.defineProperty(buffer, "a", { value: 8 });
                }
            });
        }
    });
    // node_modules/core-js/internals/object-is-extensible.js
    var require_object_is_extensible = __commonJS({
        "node_modules/core-js/internals/object-is-extensible.js": function (exports, module) {
            "use strict";
            var fails = require_fails();
            var isObject = require_is_object();
            var classof = require_classof_raw();
            var ARRAY_BUFFER_NON_EXTENSIBLE = require_array_buffer_non_extensible();
            var $isExtensible = Object.isExtensible;
            var FAILS_ON_PRIMITIVES = fails(function () {
                $isExtensible(1);
            });
            module.exports = FAILS_ON_PRIMITIVES || ARRAY_BUFFER_NON_EXTENSIBLE ? function isExtensible(it) {
                if (!isObject(it))
                    return false;
                if (ARRAY_BUFFER_NON_EXTENSIBLE && classof(it) === "ArrayBuffer")
                    return false;
                return $isExtensible ? $isExtensible(it) : true;
            } : $isExtensible;
        }
    });
    // node_modules/core-js/internals/freezing.js
    var require_freezing = __commonJS({
        "node_modules/core-js/internals/freezing.js": function (exports, module) {
            "use strict";
            var fails = require_fails();
            module.exports = !fails(function () {
                return Object.isExtensible(Object.preventExtensions({}));
            });
        }
    });
    // node_modules/core-js/internals/internal-metadata.js
    var require_internal_metadata = __commonJS({
        "node_modules/core-js/internals/internal-metadata.js": function (exports, module) {
            "use strict";
            var $ = require_export();
            var uncurryThis = require_function_uncurry_this();
            var hiddenKeys = require_hidden_keys();
            var isObject = require_is_object();
            var hasOwn = require_has_own_property();
            var defineProperty = require_object_define_property().f;
            var getOwnPropertyNamesModule = require_object_get_own_property_names();
            var getOwnPropertyNamesExternalModule = require_object_get_own_property_names_external();
            var isExtensible = require_object_is_extensible();
            var uid = require_uid();
            var FREEZING = require_freezing();
            var REQUIRED = false;
            var METADATA = uid("meta");
            var id = 0;
            var setMetadata = function (it) {
                defineProperty(it, METADATA, { value: {
                        objectID: "O" + id++,
                        // object ID
                        weakData: {}
                        // weak collections IDs
                    } });
            };
            var fastKey = function (it, create) {
                if (!isObject(it))
                    return typeof it == "symbol" ? it : (typeof it == "string" ? "S" : "P") + it;
                if (!hasOwn(it, METADATA)) {
                    if (!isExtensible(it))
                        return "F";
                    if (!create)
                        return "E";
                    setMetadata(it);
                }
                return it[METADATA].objectID;
            };
            var getWeakData = function (it, create) {
                if (!hasOwn(it, METADATA)) {
                    if (!isExtensible(it))
                        return true;
                    if (!create)
                        return false;
                    setMetadata(it);
                }
                return it[METADATA].weakData;
            };
            var onFreeze = function (it) {
                if (FREEZING && REQUIRED && isExtensible(it) && !hasOwn(it, METADATA))
                    setMetadata(it);
                return it;
            };
            var enable = function () {
                meta.enable = function () {
                };
                REQUIRED = true;
                var getOwnPropertyNames = getOwnPropertyNamesModule.f;
                var splice = uncurryThis([].splice);
                var test = {};
                test[METADATA] = 1;
                if (getOwnPropertyNames(test).length) {
                    getOwnPropertyNamesModule.f = function (it) {
                        var result = getOwnPropertyNames(it);
                        for (var i = 0, length = result.length; i < length; i++) {
                            if (result[i] === METADATA) {
                                splice(result, i, 1);
                                break;
                            }
                        }
                        return result;
                    };
                    $({ target: "Object", stat: true, forced: true }, {
                        getOwnPropertyNames: getOwnPropertyNamesExternalModule.f
                    });
                }
            };
            var meta = module.exports = {
                enable: enable,
                fastKey: fastKey,
                getWeakData: getWeakData,
                onFreeze: onFreeze
            };
            hiddenKeys[METADATA] = true;
        }
    });
    // node_modules/core-js/internals/inherit-if-required.js
    var require_inherit_if_required = __commonJS({
        "node_modules/core-js/internals/inherit-if-required.js": function (exports, module) {
            "use strict";
            var isCallable = require_is_callable();
            var isObject = require_is_object();
            var setPrototypeOf = require_object_set_prototype_of();
            module.exports = function ($this, dummy, Wrapper) {
                var NewTarget, NewTargetPrototype;
                if (
                // it can work only with native `setPrototypeOf`
                setPrototypeOf && // we haven't completely correct pre-ES6 way for getting `new.target`, so use this
                    isCallable(NewTarget = dummy.constructor) && NewTarget !== Wrapper && isObject(NewTargetPrototype = NewTarget.prototype) && NewTargetPrototype !== Wrapper.prototype)
                    setPrototypeOf($this, NewTargetPrototype);
                return $this;
            };
        }
    });
    // node_modules/core-js/internals/collection.js
    var require_collection = __commonJS({
        "node_modules/core-js/internals/collection.js": function (exports, module) {
            "use strict";
            var $ = require_export();
            var globalThis2 = require_global_this();
            var uncurryThis = require_function_uncurry_this();
            var isForced = require_is_forced();
            var defineBuiltIn = require_define_built_in();
            var InternalMetadataModule = require_internal_metadata();
            var iterate = require_iterate();
            var anInstance = require_an_instance();
            var isCallable = require_is_callable();
            var isNullOrUndefined = require_is_null_or_undefined();
            var isObject = require_is_object();
            var fails = require_fails();
            var checkCorrectnessOfIteration = require_check_correctness_of_iteration();
            var setToStringTag = require_set_to_string_tag();
            var inheritIfRequired = require_inherit_if_required();
            module.exports = function (CONSTRUCTOR_NAME, wrapper, common) {
                var IS_MAP = CONSTRUCTOR_NAME.indexOf("Map") !== -1;
                var IS_WEAK = CONSTRUCTOR_NAME.indexOf("Weak") !== -1;
                var ADDER = IS_MAP ? "set" : "add";
                var NativeConstructor = globalThis2[CONSTRUCTOR_NAME];
                var NativePrototype = NativeConstructor && NativeConstructor.prototype;
                var Constructor = NativeConstructor;
                var exported = {};
                var fixMethod = function (KEY) {
                    var uncurriedNativeMethod = uncurryThis(NativePrototype[KEY]);
                    defineBuiltIn(NativePrototype, KEY, KEY === "add" ? function add(value) {
                        uncurriedNativeMethod(this, value === 0 ? 0 : value);
                        return this;
                    } : KEY === "delete" ? function (key) {
                        return IS_WEAK && !isObject(key) ? false : uncurriedNativeMethod(this, key === 0 ? 0 : key);
                    } : KEY === "get" ? function get(key) {
                        return IS_WEAK && !isObject(key) ? void 0 : uncurriedNativeMethod(this, key === 0 ? 0 : key);
                    } : KEY === "has" ? function has(key) {
                        return IS_WEAK && !isObject(key) ? false : uncurriedNativeMethod(this, key === 0 ? 0 : key);
                    } : function set(key, value) {
                        uncurriedNativeMethod(this, key === 0 ? 0 : key, value);
                        return this;
                    });
                };
                var REPLACE = isForced(CONSTRUCTOR_NAME, !isCallable(NativeConstructor) || !(IS_WEAK || NativePrototype.forEach && !fails(function () {
                    new NativeConstructor().entries().next();
                })));
                if (REPLACE) {
                    Constructor = common.getConstructor(wrapper, CONSTRUCTOR_NAME, IS_MAP, ADDER);
                    InternalMetadataModule.enable();
                }
                else if (isForced(CONSTRUCTOR_NAME, true)) {
                    var instance = new Constructor();
                    var HASNT_CHAINING = instance[ADDER](IS_WEAK ? {} : -0, 1) !== instance;
                    var THROWS_ON_PRIMITIVES = fails(function () {
                        instance.has(1);
                    });
                    var ACCEPT_ITERABLES = checkCorrectnessOfIteration(function (iterable) {
                        new NativeConstructor(iterable);
                    });
                    var BUGGY_ZERO = !IS_WEAK && fails(function () {
                        var $instance = new NativeConstructor();
                        var index = 5;
                        while (index--)
                            $instance[ADDER](index, index);
                        return !$instance.has(-0);
                    });
                    if (!ACCEPT_ITERABLES) {
                        Constructor = wrapper(function (dummy, iterable) {
                            anInstance(dummy, NativePrototype);
                            var that = inheritIfRequired(new NativeConstructor(), dummy, Constructor);
                            if (!isNullOrUndefined(iterable))
                                iterate(iterable, that[ADDER], { that: that, AS_ENTRIES: IS_MAP });
                            return that;
                        });
                        Constructor.prototype = NativePrototype;
                        NativePrototype.constructor = Constructor;
                    }
                    if (THROWS_ON_PRIMITIVES || BUGGY_ZERO) {
                        fixMethod("delete");
                        fixMethod("has");
                        IS_MAP && fixMethod("get");
                    }
                    if (BUGGY_ZERO || HASNT_CHAINING)
                        fixMethod(ADDER);
                    if (IS_WEAK && NativePrototype.clear)
                        delete NativePrototype.clear;
                }
                exported[CONSTRUCTOR_NAME] = Constructor;
                $({ global: true, constructor: true, forced: Constructor !== NativeConstructor }, exported);
                setToStringTag(Constructor, CONSTRUCTOR_NAME);
                if (!IS_WEAK)
                    common.setStrong(Constructor, CONSTRUCTOR_NAME, IS_MAP);
                return Constructor;
            };
        }
    });
    // node_modules/core-js/internals/define-built-ins.js
    var require_define_built_ins = __commonJS({
        "node_modules/core-js/internals/define-built-ins.js": function (exports, module) {
            "use strict";
            var defineBuiltIn = require_define_built_in();
            module.exports = function (target, src, options) {
                for (var key in src)
                    defineBuiltIn(target, key, src[key], options);
                return target;
            };
        }
    });
    // node_modules/core-js/internals/collection-strong.js
    var require_collection_strong = __commonJS({
        "node_modules/core-js/internals/collection-strong.js": function (exports, module) {
            "use strict";
            var create = require_object_create();
            var defineBuiltInAccessor = require_define_built_in_accessor();
            var defineBuiltIns = require_define_built_ins();
            var bind = require_function_bind_context();
            var anInstance = require_an_instance();
            var isNullOrUndefined = require_is_null_or_undefined();
            var iterate = require_iterate();
            var defineIterator = require_iterator_define();
            var createIterResultObject = require_create_iter_result_object();
            var setSpecies = require_set_species();
            var DESCRIPTORS = require_descriptors();
            var fastKey = require_internal_metadata().fastKey;
            var InternalStateModule = require_internal_state();
            var setInternalState = InternalStateModule.set;
            var internalStateGetterFor = InternalStateModule.getterFor;
            module.exports = {
                getConstructor: function (wrapper, CONSTRUCTOR_NAME, IS_MAP, ADDER) {
                    var Constructor = wrapper(function (that, iterable) {
                        anInstance(that, Prototype);
                        setInternalState(that, {
                            type: CONSTRUCTOR_NAME,
                            index: create(null),
                            first: null,
                            last: null,
                            size: 0
                        });
                        if (!DESCRIPTORS)
                            that.size = 0;
                        if (!isNullOrUndefined(iterable))
                            iterate(iterable, that[ADDER], { that: that, AS_ENTRIES: IS_MAP });
                    });
                    var Prototype = Constructor.prototype;
                    var getInternalState = internalStateGetterFor(CONSTRUCTOR_NAME);
                    var define = function (that, key, value) {
                        var state2 = getInternalState(that);
                        var entry = getEntry(that, key);
                        var previous, index;
                        if (entry) {
                            entry.value = value;
                        }
                        else {
                            state2.last = entry = {
                                index: index = fastKey(key, true),
                                key: key,
                                value: value,
                                previous: previous = state2.last,
                                next: null,
                                removed: false
                            };
                            if (!state2.first)
                                state2.first = entry;
                            if (previous)
                                previous.next = entry;
                            if (DESCRIPTORS)
                                state2.size++;
                            else
                                that.size++;
                            if (index !== "F")
                                state2.index[index] = entry;
                        }
                        return that;
                    };
                    var getEntry = function (that, key) {
                        var state2 = getInternalState(that);
                        var index = fastKey(key);
                        var entry;
                        if (index !== "F")
                            return state2.index[index];
                        for (entry = state2.first; entry; entry = entry.next) {
                            if (entry.key === key)
                                return entry;
                        }
                    };
                    defineBuiltIns(Prototype, {
                        // `{ Map, Set }.prototype.clear()` methods
                        // https://tc39.es/ecma262/#sec-map.prototype.clear
                        // https://tc39.es/ecma262/#sec-set.prototype.clear
                        clear: function clear2() {
                            var that = this;
                            var state2 = getInternalState(that);
                            var entry = state2.first;
                            while (entry) {
                                entry.removed = true;
                                if (entry.previous)
                                    entry.previous = entry.previous.next = null;
                                entry = entry.next;
                            }
                            state2.first = state2.last = null;
                            state2.index = create(null);
                            if (DESCRIPTORS)
                                state2.size = 0;
                            else
                                that.size = 0;
                        },
                        // `{ Map, Set }.prototype.delete(key)` methods
                        // https://tc39.es/ecma262/#sec-map.prototype.delete
                        // https://tc39.es/ecma262/#sec-set.prototype.delete
                        "delete": function (key) {
                            var that = this;
                            var state2 = getInternalState(that);
                            var entry = getEntry(that, key);
                            if (entry) {
                                var next = entry.next;
                                var prev = entry.previous;
                                delete state2.index[entry.index];
                                entry.removed = true;
                                if (prev)
                                    prev.next = next;
                                if (next)
                                    next.previous = prev;
                                if (state2.first === entry)
                                    state2.first = next;
                                if (state2.last === entry)
                                    state2.last = prev;
                                if (DESCRIPTORS)
                                    state2.size--;
                                else
                                    that.size--;
                            }
                            return !!entry;
                        },
                        // `{ Map, Set }.prototype.forEach(callbackfn, thisArg = undefined)` methods
                        // https://tc39.es/ecma262/#sec-map.prototype.foreach
                        // https://tc39.es/ecma262/#sec-set.prototype.foreach
                        forEach: function forEach(callbackfn) {
                            var state2 = getInternalState(this);
                            var boundFunction = bind(callbackfn, arguments.length > 1 ? arguments[1] : void 0);
                            var entry;
                            while (entry = entry ? entry.next : state2.first) {
                                boundFunction(entry.value, entry.key, this);
                                while (entry && entry.removed)
                                    entry = entry.previous;
                            }
                        },
                        // `{ Map, Set}.prototype.has(key)` methods
                        // https://tc39.es/ecma262/#sec-map.prototype.has
                        // https://tc39.es/ecma262/#sec-set.prototype.has
                        has: function has(key) {
                            return !!getEntry(this, key);
                        }
                    });
                    defineBuiltIns(Prototype, IS_MAP ? {
                        // `Map.prototype.get(key)` method
                        // https://tc39.es/ecma262/#sec-map.prototype.get
                        get: function get(key) {
                            var entry = getEntry(this, key);
                            return entry && entry.value;
                        },
                        // `Map.prototype.set(key, value)` method
                        // https://tc39.es/ecma262/#sec-map.prototype.set
                        set: function set(key, value) {
                            return define(this, key === 0 ? 0 : key, value);
                        }
                    } : {
                        // `Set.prototype.add(value)` method
                        // https://tc39.es/ecma262/#sec-set.prototype.add
                        add: function add(value) {
                            return define(this, value = value === 0 ? 0 : value, value);
                        }
                    });
                    if (DESCRIPTORS)
                        defineBuiltInAccessor(Prototype, "size", {
                            configurable: true,
                            get: function () {
                                return getInternalState(this).size;
                            }
                        });
                    return Constructor;
                },
                setStrong: function (Constructor, CONSTRUCTOR_NAME, IS_MAP) {
                    var ITERATOR_NAME = CONSTRUCTOR_NAME + " Iterator";
                    var getInternalCollectionState = internalStateGetterFor(CONSTRUCTOR_NAME);
                    var getInternalIteratorState = internalStateGetterFor(ITERATOR_NAME);
                    defineIterator(Constructor, CONSTRUCTOR_NAME, function (iterated, kind) {
                        setInternalState(this, {
                            type: ITERATOR_NAME,
                            target: iterated,
                            state: getInternalCollectionState(iterated),
                            kind: kind,
                            last: null
                        });
                    }, function () {
                        var state2 = getInternalIteratorState(this);
                        var kind = state2.kind;
                        var entry = state2.last;
                        while (entry && entry.removed)
                            entry = entry.previous;
                        if (!state2.target || !(state2.last = entry = entry ? entry.next : state2.state.first)) {
                            state2.target = null;
                            return createIterResultObject(void 0, true);
                        }
                        if (kind === "keys")
                            return createIterResultObject(entry.key, false);
                        if (kind === "values")
                            return createIterResultObject(entry.value, false);
                        return createIterResultObject([entry.key, entry.value], false);
                    }, IS_MAP ? "entries" : "values", !IS_MAP, true);
                    setSpecies(CONSTRUCTOR_NAME);
                }
            };
        }
    });
    // node_modules/core-js/modules/es.map.constructor.js
    var require_es_map_constructor = __commonJS({
        "node_modules/core-js/modules/es.map.constructor.js": function () {
            "use strict";
            var collection = require_collection();
            var collectionStrong = require_collection_strong();
            collection("Map", function (init) {
                return function Map2() {
                    return init(this, arguments.length ? arguments[0] : void 0);
                };
            }, collectionStrong);
        }
    });
    // node_modules/core-js/modules/es.map.js
    var require_es_map = __commonJS({
        "node_modules/core-js/modules/es.map.js": function () {
            "use strict";
            require_es_map_constructor();
        }
    });
    // node_modules/core-js/internals/does-not-exceed-safe-integer.js
    var require_does_not_exceed_safe_integer = __commonJS({
        "node_modules/core-js/internals/does-not-exceed-safe-integer.js": function (exports, module) {
            "use strict";
            var $TypeError = TypeError;
            var MAX_SAFE_INTEGER = 9007199254740991;
            module.exports = function (it) {
                if (it > MAX_SAFE_INTEGER)
                    throw new $TypeError("Maximum allowed index exceeded");
                return it;
            };
        }
    });
    // node_modules/core-js/internals/map-helpers.js
    var require_map_helpers = __commonJS({
        "node_modules/core-js/internals/map-helpers.js": function (exports, module) {
            "use strict";
            var uncurryThis = require_function_uncurry_this();
            var MapPrototype = Map.prototype;
            module.exports = {
                // eslint-disable-next-line es/no-map -- safe
                Map: Map,
                set: uncurryThis(MapPrototype.set),
                get: uncurryThis(MapPrototype.get),
                has: uncurryThis(MapPrototype.has),
                remove: uncurryThis(MapPrototype["delete"]),
                proto: MapPrototype
            };
        }
    });
    // node_modules/core-js/modules/es.map.group-by.js
    var require_es_map_group_by = __commonJS({
        "node_modules/core-js/modules/es.map.group-by.js": function () {
            "use strict";
            var $ = require_export();
            var uncurryThis = require_function_uncurry_this();
            var aCallable = require_a_callable();
            var requireObjectCoercible = require_require_object_coercible();
            var iterate = require_iterate();
            var doesNotExceedSafeInteger = require_does_not_exceed_safe_integer();
            var MapHelpers = require_map_helpers();
            var IS_PURE = require_is_pure();
            var fails = require_fails();
            var Map2 = MapHelpers.Map;
            var has = MapHelpers.has;
            var get = MapHelpers.get;
            var set = MapHelpers.set;
            var push = uncurryThis([].push);
            var DOES_NOT_WORK_WITH_PRIMITIVES = IS_PURE || fails(function () {
                return Map2.groupBy("ab", function (it) {
                    return it;
                }).get("a").length !== 1;
            });
            $({ target: "Map", stat: true, forced: IS_PURE || DOES_NOT_WORK_WITH_PRIMITIVES }, {
                groupBy: function groupBy(items, callbackfn) {
                    requireObjectCoercible(items);
                    aCallable(callbackfn);
                    var map = new Map2();
                    var k = 0;
                    iterate(items, function (value) {
                        doesNotExceedSafeInteger(k);
                        var key = callbackfn(value, k++);
                        if (!has(map, key))
                            set(map, key, [value]);
                        else
                            push(get(map, key), value);
                    });
                    return map;
                }
            });
        }
    });
    // node_modules/core-js/modules/es.map.get-or-insert.js
    var require_es_map_get_or_insert = __commonJS({
        "node_modules/core-js/modules/es.map.get-or-insert.js": function () {
            "use strict";
            var $ = require_export();
            var MapHelpers = require_map_helpers();
            var IS_PURE = require_is_pure();
            var get = MapHelpers.get;
            var has = MapHelpers.has;
            var set = MapHelpers.set;
            $({ target: "Map", proto: true, real: true, forced: IS_PURE }, {
                getOrInsert: function getOrInsert(key, value) {
                    if (has(this, key))
                        return get(this, key);
                    set(this, key, value);
                    return value;
                }
            });
        }
    });
    // node_modules/core-js/modules/es.map.get-or-insert-computed.js
    var require_es_map_get_or_insert_computed = __commonJS({
        "node_modules/core-js/modules/es.map.get-or-insert-computed.js": function () {
            "use strict";
            var $ = require_export();
            var aCallable = require_a_callable();
            var MapHelpers = require_map_helpers();
            var IS_PURE = require_is_pure();
            var get = MapHelpers.get;
            var has = MapHelpers.has;
            var set = MapHelpers.set;
            $({ target: "Map", proto: true, real: true, forced: IS_PURE }, {
                getOrInsertComputed: function getOrInsertComputed(key, callbackfn) {
                    var hasKey = has(this, key);
                    aCallable(callbackfn);
                    if (hasKey)
                        return get(this, key);
                    if (key === 0 && 1 / key === -Infinity)
                        key = 0;
                    var value = callbackfn(key);
                    set(this, key, value);
                    return value;
                }
            });
        }
    });
    // node_modules/core-js/es/map/index.js
    var require_map = __commonJS({
        "node_modules/core-js/es/map/index.js": function (exports, module) {
            "use strict";
            require_es_array_iterator();
            require_es_map();
            require_es_map_group_by();
            require_es_map_get_or_insert();
            require_es_map_get_or_insert_computed();
            require_es_object_to_string();
            require_es_string_iterator();
            var path = require_path();
            module.exports = path.Map;
        }
    });
    // node_modules/core-js/stable/map/index.js
    var require_map2 = __commonJS({
        "node_modules/core-js/stable/map/index.js": function (exports, module) {
            "use strict";
            var parent = require_map();
            require_web_dom_collections_iterator();
            module.exports = parent;
        }
    });
    // node_modules/core-js/modules/esnext.map.get-or-insert.js
    var require_esnext_map_get_or_insert = __commonJS({
        "node_modules/core-js/modules/esnext.map.get-or-insert.js": function () {
            "use strict";
            require_es_map_get_or_insert();
        }
    });
    // node_modules/core-js/modules/esnext.map.get-or-insert-computed.js
    var require_esnext_map_get_or_insert_computed = __commonJS({
        "node_modules/core-js/modules/esnext.map.get-or-insert-computed.js": function () {
            "use strict";
            require_es_map_get_or_insert_computed();
        }
    });
    // node_modules/core-js/modules/esnext.map.group-by.js
    var require_esnext_map_group_by = __commonJS({
        "node_modules/core-js/modules/esnext.map.group-by.js": function () {
            "use strict";
            require_es_map_group_by();
        }
    });
    // node_modules/core-js/actual/map/index.js
    var require_map3 = __commonJS({
        "node_modules/core-js/actual/map/index.js": function (exports, module) {
            "use strict";
            var parent = require_map2();
            require_esnext_map_get_or_insert();
            require_esnext_map_get_or_insert_computed();
            require_esnext_map_group_by();
            module.exports = parent;
        }
    });
    // node_modules/core-js/modules/es.set.constructor.js
    var require_es_set_constructor = __commonJS({
        "node_modules/core-js/modules/es.set.constructor.js": function () {
            "use strict";
            var collection = require_collection();
            var collectionStrong = require_collection_strong();
            collection("Set", function (init) {
                return function Set2() {
                    return init(this, arguments.length ? arguments[0] : void 0);
                };
            }, collectionStrong);
        }
    });
    // node_modules/core-js/modules/es.set.js
    var require_es_set = __commonJS({
        "node_modules/core-js/modules/es.set.js": function () {
            "use strict";
            require_es_set_constructor();
        }
    });
    // node_modules/core-js/internals/set-helpers.js
    var require_set_helpers = __commonJS({
        "node_modules/core-js/internals/set-helpers.js": function (exports, module) {
            "use strict";
            var uncurryThis = require_function_uncurry_this();
            var SetPrototype = Set.prototype;
            module.exports = {
                // eslint-disable-next-line es/no-set -- safe
                Set: Set,
                add: uncurryThis(SetPrototype.add),
                has: uncurryThis(SetPrototype.has),
                remove: uncurryThis(SetPrototype["delete"]),
                proto: SetPrototype
            };
        }
    });
    // node_modules/core-js/internals/a-set.js
    var require_a_set = __commonJS({
        "node_modules/core-js/internals/a-set.js": function (exports, module) {
            "use strict";
            var has = require_set_helpers().has;
            module.exports = function (it) {
                has(it);
                return it;
            };
        }
    });
    // node_modules/core-js/internals/iterate-simple.js
    var require_iterate_simple = __commonJS({
        "node_modules/core-js/internals/iterate-simple.js": function (exports, module) {
            "use strict";
            var call = require_function_call();
            module.exports = function (record, fn, ITERATOR_INSTEAD_OF_RECORD) {
                var iterator = ITERATOR_INSTEAD_OF_RECORD ? record : record.iterator;
                var next = record.next;
                var step, result;
                while (!(step = call(next, iterator)).done) {
                    result = fn(step.value);
                    if (result !== void 0)
                        return result;
                }
            };
        }
    });
    // node_modules/core-js/internals/set-iterate.js
    var require_set_iterate = __commonJS({
        "node_modules/core-js/internals/set-iterate.js": function (exports, module) {
            "use strict";
            var uncurryThis = require_function_uncurry_this();
            var iterateSimple = require_iterate_simple();
            var SetHelpers = require_set_helpers();
            var Set2 = SetHelpers.Set;
            var SetPrototype = SetHelpers.proto;
            var forEach = uncurryThis(SetPrototype.forEach);
            var keys = uncurryThis(SetPrototype.keys);
            var next = keys(new Set2()).next;
            module.exports = function (set, fn, interruptible) {
                return interruptible ? iterateSimple({ iterator: keys(set), next: next }, fn) : forEach(set, fn);
            };
        }
    });
    // node_modules/core-js/internals/set-clone.js
    var require_set_clone = __commonJS({
        "node_modules/core-js/internals/set-clone.js": function (exports, module) {
            "use strict";
            var SetHelpers = require_set_helpers();
            var iterate = require_set_iterate();
            var Set2 = SetHelpers.Set;
            var add = SetHelpers.add;
            module.exports = function (set) {
                var result = new Set2();
                iterate(set, function (it) {
                    add(result, it);
                });
                return result;
            };
        }
    });
    // node_modules/core-js/internals/set-size.js
    var require_set_size = __commonJS({
        "node_modules/core-js/internals/set-size.js": function (exports, module) {
            "use strict";
            var uncurryThisAccessor = require_function_uncurry_this_accessor();
            var SetHelpers = require_set_helpers();
            module.exports = uncurryThisAccessor(SetHelpers.proto, "size", "get") || function (set) {
                return set.size;
            };
        }
    });
    // node_modules/core-js/internals/get-iterator-direct.js
    var require_get_iterator_direct = __commonJS({
        "node_modules/core-js/internals/get-iterator-direct.js": function (exports, module) {
            "use strict";
            module.exports = function (obj) {
                return {
                    iterator: obj,
                    next: obj.next,
                    done: false
                };
            };
        }
    });
    // node_modules/core-js/internals/get-set-record.js
    var require_get_set_record = __commonJS({
        "node_modules/core-js/internals/get-set-record.js": function (exports, module) {
            "use strict";
            var aCallable = require_a_callable();
            var anObject = require_an_object();
            var call = require_function_call();
            var toIntegerOrInfinity = require_to_integer_or_infinity();
            var getIteratorDirect = require_get_iterator_direct();
            var INVALID_SIZE = "Invalid size";
            var $RangeError = RangeError;
            var $TypeError = TypeError;
            var max = Math.max;
            var SetRecord = function (set, intSize) {
                this.set = set;
                this.size = max(intSize, 0);
                this.has = aCallable(set.has);
                this.keys = aCallable(set.keys);
            };
            SetRecord.prototype = {
                getIterator: function () {
                    return getIteratorDirect(anObject(call(this.keys, this.set)));
                },
                includes: function (it) {
                    return call(this.has, this.set, it);
                }
            };
            module.exports = function (obj) {
                anObject(obj);
                var numSize = +obj.size;
                if (numSize !== numSize)
                    throw new $TypeError(INVALID_SIZE);
                var intSize = toIntegerOrInfinity(numSize);
                if (intSize < 0)
                    throw new $RangeError(INVALID_SIZE);
                return new SetRecord(obj, intSize);
            };
        }
    });
    // node_modules/core-js/internals/set-difference.js
    var require_set_difference = __commonJS({
        "node_modules/core-js/internals/set-difference.js": function (exports, module) {
            "use strict";
            var aSet = require_a_set();
            var SetHelpers = require_set_helpers();
            var clone = require_set_clone();
            var size = require_set_size();
            var getSetRecord = require_get_set_record();
            var iterateSet = require_set_iterate();
            var iterateSimple = require_iterate_simple();
            var has = SetHelpers.has;
            var remove = SetHelpers.remove;
            module.exports = function difference(other) {
                var O = aSet(this);
                var otherRec = getSetRecord(other);
                var result = clone(O);
                if (size(result) <= otherRec.size)
                    iterateSet(result, function (e) {
                        if (otherRec.includes(e))
                            remove(result, e);
                    });
                else
                    iterateSimple(otherRec.getIterator(), function (e) {
                        if (has(result, e))
                            remove(result, e);
                    });
                return result;
            };
        }
    });
    // node_modules/core-js/internals/set-method-accept-set-like.js
    var require_set_method_accept_set_like = __commonJS({
        "node_modules/core-js/internals/set-method-accept-set-like.js": function (exports, module) {
            "use strict";
            var getBuiltIn = require_get_built_in();
            var createSetLike = function (size) {
                return {
                    size: size,
                    has: function () {
                        return false;
                    },
                    keys: function () {
                        return {
                            next: function () {
                                return { done: true };
                            }
                        };
                    }
                };
            };
            var createSetLikeWithInfinitySize = function (size) {
                return {
                    size: size,
                    has: function () {
                        return true;
                    },
                    keys: function () {
                        throw new Error("e");
                    }
                };
            };
            module.exports = function (name, callback) {
                var Set2 = getBuiltIn("Set");
                try {
                    new Set2()[name](createSetLike(0));
                    try {
                        new Set2()[name](createSetLike(-1));
                        return false;
                    }
                    catch (error2) {
                        if (!callback)
                            return true;
                        try {
                            new Set2()[name](createSetLikeWithInfinitySize(-Infinity));
                            return false;
                        }
                        catch (error) {
                            var set = new Set2([1, 2]);
                            return callback(set[name](createSetLikeWithInfinitySize(Infinity)));
                        }
                    }
                }
                catch (error) {
                    return false;
                }
            };
        }
    });
    // node_modules/core-js/modules/es.set.difference.v2.js
    var require_es_set_difference_v2 = __commonJS({
        "node_modules/core-js/modules/es.set.difference.v2.js": function () {
            "use strict";
            var $ = require_export();
            var difference = require_set_difference();
            var fails = require_fails();
            var setMethodAcceptSetLike = require_set_method_accept_set_like();
            var SET_LIKE_INCORRECT_BEHAVIOR = !setMethodAcceptSetLike("difference", function (result) {
                return result.size === 0;
            });
            var FORCED = SET_LIKE_INCORRECT_BEHAVIOR || fails(function () {
                var setLike = {
                    size: 1,
                    has: function () {
                        return true;
                    },
                    keys: function () {
                        var index = 0;
                        return {
                            next: function () {
                                var done = index++ > 1;
                                if (baseSet.has(1))
                                    baseSet.clear();
                                return { done: done, value: 2 };
                            }
                        };
                    }
                };
                var baseSet = /* @__PURE__ */ new Set([1, 2, 3, 4]);
                return baseSet.difference(setLike).size !== 3;
            });
            $({ target: "Set", proto: true, real: true, forced: FORCED }, {
                difference: difference
            });
        }
    });
    // node_modules/core-js/internals/set-intersection.js
    var require_set_intersection = __commonJS({
        "node_modules/core-js/internals/set-intersection.js": function (exports, module) {
            "use strict";
            var aSet = require_a_set();
            var SetHelpers = require_set_helpers();
            var size = require_set_size();
            var getSetRecord = require_get_set_record();
            var iterateSet = require_set_iterate();
            var iterateSimple = require_iterate_simple();
            var Set2 = SetHelpers.Set;
            var add = SetHelpers.add;
            var has = SetHelpers.has;
            module.exports = function intersection(other) {
                var O = aSet(this);
                var otherRec = getSetRecord(other);
                var result = new Set2();
                if (size(O) > otherRec.size) {
                    iterateSimple(otherRec.getIterator(), function (e) {
                        if (has(O, e))
                            add(result, e);
                    });
                }
                else {
                    iterateSet(O, function (e) {
                        if (otherRec.includes(e))
                            add(result, e);
                    });
                }
                return result;
            };
        }
    });
    // node_modules/core-js/modules/es.set.intersection.v2.js
    var require_es_set_intersection_v2 = __commonJS({
        "node_modules/core-js/modules/es.set.intersection.v2.js": function () {
            "use strict";
            var $ = require_export();
            var fails = require_fails();
            var intersection = require_set_intersection();
            var setMethodAcceptSetLike = require_set_method_accept_set_like();
            var INCORRECT = !setMethodAcceptSetLike("intersection", function (result) {
                return result.size === 2 && result.has(1) && result.has(2);
            }) || fails(function () {
                return String(Array.from(( /* @__PURE__ */new Set([1, 2, 3])).intersection(/* @__PURE__ */ new Set([3, 2])))) !== "3,2";
            });
            $({ target: "Set", proto: true, real: true, forced: INCORRECT }, {
                intersection: intersection
            });
        }
    });
    // node_modules/core-js/internals/set-is-disjoint-from.js
    var require_set_is_disjoint_from = __commonJS({
        "node_modules/core-js/internals/set-is-disjoint-from.js": function (exports, module) {
            "use strict";
            var aSet = require_a_set();
            var has = require_set_helpers().has;
            var size = require_set_size();
            var getSetRecord = require_get_set_record();
            var iterateSet = require_set_iterate();
            var iterateSimple = require_iterate_simple();
            var iteratorClose = require_iterator_close();
            module.exports = function isDisjointFrom(other) {
                var O = aSet(this);
                var otherRec = getSetRecord(other);
                if (size(O) <= otherRec.size)
                    return iterateSet(O, function (e) {
                        if (otherRec.includes(e))
                            return false;
                    }, true) !== false;
                var iterator = otherRec.getIterator();
                return iterateSimple(iterator, function (e) {
                    if (has(O, e))
                        return iteratorClose(iterator.iterator, "normal", false);
                }) !== false;
            };
        }
    });
    // node_modules/core-js/modules/es.set.is-disjoint-from.v2.js
    var require_es_set_is_disjoint_from_v2 = __commonJS({
        "node_modules/core-js/modules/es.set.is-disjoint-from.v2.js": function () {
            "use strict";
            var $ = require_export();
            var isDisjointFrom = require_set_is_disjoint_from();
            var setMethodAcceptSetLike = require_set_method_accept_set_like();
            var INCORRECT = !setMethodAcceptSetLike("isDisjointFrom", function (result) {
                return !result;
            });
            $({ target: "Set", proto: true, real: true, forced: INCORRECT }, {
                isDisjointFrom: isDisjointFrom
            });
        }
    });
    // node_modules/core-js/internals/set-is-subset-of.js
    var require_set_is_subset_of = __commonJS({
        "node_modules/core-js/internals/set-is-subset-of.js": function (exports, module) {
            "use strict";
            var aSet = require_a_set();
            var size = require_set_size();
            var iterate = require_set_iterate();
            var getSetRecord = require_get_set_record();
            module.exports = function isSubsetOf(other) {
                var O = aSet(this);
                var otherRec = getSetRecord(other);
                if (size(O) > otherRec.size)
                    return false;
                return iterate(O, function (e) {
                    if (!otherRec.includes(e))
                        return false;
                }, true) !== false;
            };
        }
    });
    // node_modules/core-js/modules/es.set.is-subset-of.v2.js
    var require_es_set_is_subset_of_v2 = __commonJS({
        "node_modules/core-js/modules/es.set.is-subset-of.v2.js": function () {
            "use strict";
            var $ = require_export();
            var isSubsetOf = require_set_is_subset_of();
            var setMethodAcceptSetLike = require_set_method_accept_set_like();
            var INCORRECT = !setMethodAcceptSetLike("isSubsetOf", function (result) {
                return result;
            });
            $({ target: "Set", proto: true, real: true, forced: INCORRECT }, {
                isSubsetOf: isSubsetOf
            });
        }
    });
    // node_modules/core-js/internals/set-is-superset-of.js
    var require_set_is_superset_of = __commonJS({
        "node_modules/core-js/internals/set-is-superset-of.js": function (exports, module) {
            "use strict";
            var aSet = require_a_set();
            var has = require_set_helpers().has;
            var size = require_set_size();
            var getSetRecord = require_get_set_record();
            var iterateSimple = require_iterate_simple();
            var iteratorClose = require_iterator_close();
            module.exports = function isSupersetOf(other) {
                var O = aSet(this);
                var otherRec = getSetRecord(other);
                if (size(O) < otherRec.size)
                    return false;
                var iterator = otherRec.getIterator();
                return iterateSimple(iterator, function (e) {
                    if (!has(O, e))
                        return iteratorClose(iterator.iterator, "normal", false);
                }) !== false;
            };
        }
    });
    // node_modules/core-js/modules/es.set.is-superset-of.v2.js
    var require_es_set_is_superset_of_v2 = __commonJS({
        "node_modules/core-js/modules/es.set.is-superset-of.v2.js": function () {
            "use strict";
            var $ = require_export();
            var isSupersetOf = require_set_is_superset_of();
            var setMethodAcceptSetLike = require_set_method_accept_set_like();
            var INCORRECT = !setMethodAcceptSetLike("isSupersetOf", function (result) {
                return !result;
            });
            $({ target: "Set", proto: true, real: true, forced: INCORRECT }, {
                isSupersetOf: isSupersetOf
            });
        }
    });
    // node_modules/core-js/internals/set-symmetric-difference.js
    var require_set_symmetric_difference = __commonJS({
        "node_modules/core-js/internals/set-symmetric-difference.js": function (exports, module) {
            "use strict";
            var aSet = require_a_set();
            var SetHelpers = require_set_helpers();
            var clone = require_set_clone();
            var getSetRecord = require_get_set_record();
            var iterateSimple = require_iterate_simple();
            var add = SetHelpers.add;
            var has = SetHelpers.has;
            var remove = SetHelpers.remove;
            module.exports = function symmetricDifference(other) {
                var O = aSet(this);
                var keysIter = getSetRecord(other).getIterator();
                var result = clone(O);
                iterateSimple(keysIter, function (e) {
                    if (has(O, e))
                        remove(result, e);
                    else
                        add(result, e);
                });
                return result;
            };
        }
    });
    // node_modules/core-js/internals/set-method-get-keys-before-cloning-detection.js
    var require_set_method_get_keys_before_cloning_detection = __commonJS({
        "node_modules/core-js/internals/set-method-get-keys-before-cloning-detection.js": function (exports, module) {
            "use strict";
            module.exports = function (METHOD_NAME) {
                try {
                    var baseSet = /* @__PURE__ */ new Set();
                    var setLike = {
                        size: 0,
                        has: function () {
                            return true;
                        },
                        keys: function () {
                            return Object.defineProperty({}, "next", {
                                get: function () {
                                    baseSet.clear();
                                    baseSet.add(4);
                                    return function () {
                                        return { done: true };
                                    };
                                }
                            });
                        }
                    };
                    var result = baseSet[METHOD_NAME](setLike);
                    return result.size === 1 && result.values().next().value === 4;
                }
                catch (error) {
                    return false;
                }
            };
        }
    });
    // node_modules/core-js/modules/es.set.symmetric-difference.v2.js
    var require_es_set_symmetric_difference_v2 = __commonJS({
        "node_modules/core-js/modules/es.set.symmetric-difference.v2.js": function () {
            "use strict";
            var $ = require_export();
            var symmetricDifference = require_set_symmetric_difference();
            var setMethodGetKeysBeforeCloning = require_set_method_get_keys_before_cloning_detection();
            var setMethodAcceptSetLike = require_set_method_accept_set_like();
            var FORCED = !setMethodAcceptSetLike("symmetricDifference") || !setMethodGetKeysBeforeCloning("symmetricDifference");
            $({ target: "Set", proto: true, real: true, forced: FORCED }, {
                symmetricDifference: symmetricDifference
            });
        }
    });
    // node_modules/core-js/internals/set-union.js
    var require_set_union = __commonJS({
        "node_modules/core-js/internals/set-union.js": function (exports, module) {
            "use strict";
            var aSet = require_a_set();
            var add = require_set_helpers().add;
            var clone = require_set_clone();
            var getSetRecord = require_get_set_record();
            var iterateSimple = require_iterate_simple();
            module.exports = function union(other) {
                var O = aSet(this);
                var keysIter = getSetRecord(other).getIterator();
                var result = clone(O);
                iterateSimple(keysIter, function (it) {
                    add(result, it);
                });
                return result;
            };
        }
    });
    // node_modules/core-js/modules/es.set.union.v2.js
    var require_es_set_union_v2 = __commonJS({
        "node_modules/core-js/modules/es.set.union.v2.js": function () {
            "use strict";
            var $ = require_export();
            var union = require_set_union();
            var setMethodGetKeysBeforeCloning = require_set_method_get_keys_before_cloning_detection();
            var setMethodAcceptSetLike = require_set_method_accept_set_like();
            var FORCED = !setMethodAcceptSetLike("union") || !setMethodGetKeysBeforeCloning("union");
            $({ target: "Set", proto: true, real: true, forced: FORCED }, {
                union: union
            });
        }
    });
    // node_modules/core-js/es/set/index.js
    var require_set = __commonJS({
        "node_modules/core-js/es/set/index.js": function (exports, module) {
            "use strict";
            require_es_array_iterator();
            require_es_object_to_string();
            require_es_set();
            require_es_set_difference_v2();
            require_es_set_intersection_v2();
            require_es_set_is_disjoint_from_v2();
            require_es_set_is_subset_of_v2();
            require_es_set_is_superset_of_v2();
            require_es_set_symmetric_difference_v2();
            require_es_set_union_v2();
            require_es_string_iterator();
            var path = require_path();
            module.exports = path.Set;
        }
    });
    // node_modules/core-js/stable/set/index.js
    var require_set2 = __commonJS({
        "node_modules/core-js/stable/set/index.js": function (exports, module) {
            "use strict";
            var parent = require_set();
            require_web_dom_collections_iterator();
            module.exports = parent;
        }
    });
    // node_modules/core-js/modules/esnext.set.difference.v2.js
    var require_esnext_set_difference_v2 = __commonJS({
        "node_modules/core-js/modules/esnext.set.difference.v2.js": function () {
            "use strict";
            require_es_set_difference_v2();
        }
    });
    // node_modules/core-js/modules/esnext.set.intersection.v2.js
    var require_esnext_set_intersection_v2 = __commonJS({
        "node_modules/core-js/modules/esnext.set.intersection.v2.js": function () {
            "use strict";
            require_es_set_intersection_v2();
        }
    });
    // node_modules/core-js/modules/esnext.set.is-disjoint-from.v2.js
    var require_esnext_set_is_disjoint_from_v2 = __commonJS({
        "node_modules/core-js/modules/esnext.set.is-disjoint-from.v2.js": function () {
            "use strict";
            require_es_set_is_disjoint_from_v2();
        }
    });
    // node_modules/core-js/modules/esnext.set.is-subset-of.v2.js
    var require_esnext_set_is_subset_of_v2 = __commonJS({
        "node_modules/core-js/modules/esnext.set.is-subset-of.v2.js": function () {
            "use strict";
            require_es_set_is_subset_of_v2();
        }
    });
    // node_modules/core-js/modules/esnext.set.is-superset-of.v2.js
    var require_esnext_set_is_superset_of_v2 = __commonJS({
        "node_modules/core-js/modules/esnext.set.is-superset-of.v2.js": function () {
            "use strict";
            require_es_set_is_superset_of_v2();
        }
    });
    // node_modules/core-js/modules/esnext.set.symmetric-difference.v2.js
    var require_esnext_set_symmetric_difference_v2 = __commonJS({
        "node_modules/core-js/modules/esnext.set.symmetric-difference.v2.js": function () {
            "use strict";
            require_es_set_symmetric_difference_v2();
        }
    });
    // node_modules/core-js/modules/esnext.set.union.v2.js
    var require_esnext_set_union_v2 = __commonJS({
        "node_modules/core-js/modules/esnext.set.union.v2.js": function () {
            "use strict";
            require_es_set_union_v2();
        }
    });
    // node_modules/core-js/actual/set/index.js
    var require_set3 = __commonJS({
        "node_modules/core-js/actual/set/index.js": function (exports, module) {
            "use strict";
            var parent = require_set2();
            require_esnext_set_difference_v2();
            require_esnext_set_intersection_v2();
            require_esnext_set_is_disjoint_from_v2();
            require_esnext_set_is_subset_of_v2();
            require_esnext_set_is_superset_of_v2();
            require_esnext_set_symmetric_difference_v2();
            require_esnext_set_union_v2();
            module.exports = parent;
        }
    });
    // node_modules/core-js/internals/is-array.js
    var require_is_array = __commonJS({
        "node_modules/core-js/internals/is-array.js": function (exports, module) {
            "use strict";
            var classof = require_classof_raw();
            module.exports = Array.isArray || function isArray(argument) {
                return classof(argument) === "Array";
            };
        }
    });
    // node_modules/core-js/internals/array-set-length.js
    var require_array_set_length = __commonJS({
        "node_modules/core-js/internals/array-set-length.js": function (exports, module) {
            "use strict";
            var DESCRIPTORS = require_descriptors();
            var isArray = require_is_array();
            var $TypeError = TypeError;
            var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
            var SILENT_ON_NON_WRITABLE_LENGTH_SET = DESCRIPTORS && !(function () {
                if (this !== void 0)
                    return true;
                try {
                    Object.defineProperty([], "length", { writable: false }).length = 1;
                }
                catch (error) {
                    return error instanceof TypeError;
                }
            })();
            module.exports = SILENT_ON_NON_WRITABLE_LENGTH_SET ? function (O, length) {
                if (isArray(O) && !getOwnPropertyDescriptor(O, "length").writable) {
                    throw new $TypeError("Cannot set read only .length");
                }
                return O.length = length;
            } : function (O, length) {
                return O.length = length;
            };
        }
    });
    // node_modules/core-js/internals/array-species-constructor.js
    var require_array_species_constructor = __commonJS({
        "node_modules/core-js/internals/array-species-constructor.js": function (exports, module) {
            "use strict";
            var isArray = require_is_array();
            var isConstructor = require_is_constructor();
            var isObject = require_is_object();
            var wellKnownSymbol = require_well_known_symbol();
            var SPECIES = wellKnownSymbol("species");
            var $Array = Array;
            module.exports = function (originalArray) {
                var C;
                if (isArray(originalArray)) {
                    C = originalArray.constructor;
                    if (isConstructor(C) && (C === $Array || isArray(C.prototype)))
                        C = void 0;
                    else if (isObject(C)) {
                        C = C[SPECIES];
                        if (C === null)
                            C = void 0;
                    }
                }
                return C === void 0 ? $Array : C;
            };
        }
    });
    // node_modules/core-js/internals/array-species-create.js
    var require_array_species_create = __commonJS({
        "node_modules/core-js/internals/array-species-create.js": function (exports, module) {
            "use strict";
            var arraySpeciesConstructor = require_array_species_constructor();
            module.exports = function (originalArray, length) {
                return new (arraySpeciesConstructor(originalArray))(length === 0 ? 0 : length);
            };
        }
    });
    // node_modules/core-js/internals/array-method-has-species-support.js
    var require_array_method_has_species_support = __commonJS({
        "node_modules/core-js/internals/array-method-has-species-support.js": function (exports, module) {
            "use strict";
            var fails = require_fails();
            var wellKnownSymbol = require_well_known_symbol();
            var V8_VERSION = require_environment_v8_version();
            var SPECIES = wellKnownSymbol("species");
            module.exports = function (METHOD_NAME) {
                return V8_VERSION >= 51 || !fails(function () {
                    var array = [];
                    var constructor = array.constructor = {};
                    constructor[SPECIES] = function () {
                        return { foo: 1 };
                    };
                    return array[METHOD_NAME](Boolean).foo !== 1;
                });
            };
        }
    });
    // node_modules/core-js/modules/es.array.concat.js
    var require_es_array_concat = __commonJS({
        "node_modules/core-js/modules/es.array.concat.js": function () {
            "use strict";
            var $ = require_export();
            var fails = require_fails();
            var isArray = require_is_array();
            var isObject = require_is_object();
            var toObject = require_to_object();
            var lengthOfArrayLike = require_length_of_array_like();
            var doesNotExceedSafeInteger = require_does_not_exceed_safe_integer();
            var createProperty = require_create_property();
            var setArrayLength = require_array_set_length();
            var arraySpeciesCreate = require_array_species_create();
            var arrayMethodHasSpeciesSupport = require_array_method_has_species_support();
            var wellKnownSymbol = require_well_known_symbol();
            var V8_VERSION = require_environment_v8_version();
            var IS_CONCAT_SPREADABLE = wellKnownSymbol("isConcatSpreadable");
            var IS_CONCAT_SPREADABLE_SUPPORT = V8_VERSION >= 51 || !fails(function () {
                var array = [];
                array[IS_CONCAT_SPREADABLE] = false;
                return array.concat()[0] !== array;
            });
            var isConcatSpreadable = function (O) {
                if (!isObject(O))
                    return false;
                var spreadable = O[IS_CONCAT_SPREADABLE];
                return spreadable !== void 0 ? !!spreadable : isArray(O);
            };
            var FORCED = !IS_CONCAT_SPREADABLE_SUPPORT || !arrayMethodHasSpeciesSupport("concat");
            $({ target: "Array", proto: true, arity: 1, forced: FORCED }, {
                // eslint-disable-next-line no-unused-vars -- required for `.length`
                concat: function concat(arg) {
                    var O = toObject(this);
                    var A = arraySpeciesCreate(O, 0);
                    var n = 0;
                    var i, k, length, len, E;
                    for (i = -1, length = arguments.length; i < length; i++) {
                        E = i === -1 ? O : arguments[i];
                        if (isConcatSpreadable(E)) {
                            len = lengthOfArrayLike(E);
                            doesNotExceedSafeInteger(n + len);
                            for (k = 0; k < len; k++, n++)
                                if (k in E)
                                    createProperty(A, n, E[k]);
                        }
                        else {
                            doesNotExceedSafeInteger(n + 1);
                            createProperty(A, n++, E);
                        }
                    }
                    setArrayLength(A, n);
                    return A;
                }
            });
        }
    });
    // node_modules/core-js/internals/well-known-symbol-wrapped.js
    var require_well_known_symbol_wrapped = __commonJS({
        "node_modules/core-js/internals/well-known-symbol-wrapped.js": function (exports) {
            "use strict";
            var wellKnownSymbol = require_well_known_symbol();
            exports.f = wellKnownSymbol;
        }
    });
    // node_modules/core-js/internals/well-known-symbol-define.js
    var require_well_known_symbol_define = __commonJS({
        "node_modules/core-js/internals/well-known-symbol-define.js": function (exports, module) {
            "use strict";
            var path = require_path();
            var hasOwn = require_has_own_property();
            var wrappedWellKnownSymbolModule = require_well_known_symbol_wrapped();
            var defineProperty = require_object_define_property().f;
            module.exports = function (NAME) {
                var Symbol2 = path.Symbol || (path.Symbol = {});
                if (!hasOwn(Symbol2, NAME))
                    defineProperty(Symbol2, NAME, {
                        value: wrappedWellKnownSymbolModule.f(NAME)
                    });
            };
        }
    });
    // node_modules/core-js/internals/symbol-define-to-primitive.js
    var require_symbol_define_to_primitive = __commonJS({
        "node_modules/core-js/internals/symbol-define-to-primitive.js": function (exports, module) {
            "use strict";
            var call = require_function_call();
            var getBuiltIn = require_get_built_in();
            var wellKnownSymbol = require_well_known_symbol();
            var defineBuiltIn = require_define_built_in();
            module.exports = function () {
                var Symbol2 = getBuiltIn("Symbol");
                var SymbolPrototype = Symbol2 && Symbol2.prototype;
                var valueOf = SymbolPrototype && SymbolPrototype.valueOf;
                var TO_PRIMITIVE = wellKnownSymbol("toPrimitive");
                if (SymbolPrototype && !SymbolPrototype[TO_PRIMITIVE]) {
                    defineBuiltIn(SymbolPrototype, TO_PRIMITIVE, function (hint) {
                        return call(valueOf, this);
                    }, { arity: 1 });
                }
            };
        }
    });
    // node_modules/core-js/internals/array-iteration.js
    var require_array_iteration = __commonJS({
        "node_modules/core-js/internals/array-iteration.js": function (exports, module) {
            "use strict";
            var bind = require_function_bind_context();
            var IndexedObject = require_indexed_object();
            var toObject = require_to_object();
            var lengthOfArrayLike = require_length_of_array_like();
            var arraySpeciesCreate = require_array_species_create();
            var createProperty = require_create_property();
            var createMethod = function (TYPE) {
                var IS_MAP = TYPE === 1;
                var IS_FILTER = TYPE === 2;
                var IS_SOME = TYPE === 3;
                var IS_EVERY = TYPE === 4;
                var IS_FIND_INDEX = TYPE === 6;
                var IS_FILTER_REJECT = TYPE === 7;
                var NO_HOLES = TYPE === 5 || IS_FIND_INDEX;
                return function ($this, callbackfn, that) {
                    var O = toObject($this);
                    var self2 = IndexedObject(O);
                    var length = lengthOfArrayLike(self2);
                    var boundFunction = bind(callbackfn, that);
                    var index = 0;
                    var resIndex = 0;
                    var target = IS_MAP ? arraySpeciesCreate($this, length) : IS_FILTER || IS_FILTER_REJECT ? arraySpeciesCreate($this, 0) : void 0;
                    var value, result;
                    for (; length > index; index++)
                        if (NO_HOLES || index in self2) {
                            value = self2[index];
                            result = boundFunction(value, index, O);
                            if (TYPE) {
                                if (IS_MAP)
                                    createProperty(target, index, result);
                                else if (result)
                                    switch (TYPE) {
                                        case 3:
                                            return true;
                                        // some
                                        case 5:
                                            return value;
                                        // find
                                        case 6:
                                            return index;
                                        // findIndex
                                        case 2:
                                            createProperty(target, resIndex++, value);
                                    }
                                else
                                    switch (TYPE) {
                                        case 4:
                                            return false;
                                        // every
                                        case 7:
                                            createProperty(target, resIndex++, value);
                                    }
                            }
                        }
                    return IS_FIND_INDEX ? -1 : IS_SOME || IS_EVERY ? IS_EVERY : target;
                };
            };
            module.exports = {
                // `Array.prototype.forEach` method
                // https://tc39.es/ecma262/#sec-array.prototype.foreach
                forEach: createMethod(0),
                // `Array.prototype.map` method
                // https://tc39.es/ecma262/#sec-array.prototype.map
                map: createMethod(1),
                // `Array.prototype.filter` method
                // https://tc39.es/ecma262/#sec-array.prototype.filter
                filter: createMethod(2),
                // `Array.prototype.some` method
                // https://tc39.es/ecma262/#sec-array.prototype.some
                some: createMethod(3),
                // `Array.prototype.every` method
                // https://tc39.es/ecma262/#sec-array.prototype.every
                every: createMethod(4),
                // `Array.prototype.find` method
                // https://tc39.es/ecma262/#sec-array.prototype.find
                find: createMethod(5),
                // `Array.prototype.findIndex` method
                // https://tc39.es/ecma262/#sec-array.prototype.findIndex
                findIndex: createMethod(6),
                // `Array.prototype.filterReject` method
                // https://github.com/tc39/proposal-array-filtering
                filterReject: createMethod(7)
            };
        }
    });
    // node_modules/core-js/modules/es.symbol.constructor.js
    var require_es_symbol_constructor = __commonJS({
        "node_modules/core-js/modules/es.symbol.constructor.js": function () {
            "use strict";
            var $ = require_export();
            var globalThis2 = require_global_this();
            var call = require_function_call();
            var uncurryThis = require_function_uncurry_this();
            var IS_PURE = require_is_pure();
            var DESCRIPTORS = require_descriptors();
            var NATIVE_SYMBOL = require_symbol_constructor_detection();
            var fails = require_fails();
            var hasOwn = require_has_own_property();
            var isPrototypeOf = require_object_is_prototype_of();
            var anObject = require_an_object();
            var toIndexedObject = require_to_indexed_object();
            var toPropertyKey = require_to_property_key();
            var $toString = require_to_string();
            var createPropertyDescriptor = require_create_property_descriptor();
            var nativeObjectCreate = require_object_create();
            var objectKeys = require_object_keys();
            var getOwnPropertyNamesModule = require_object_get_own_property_names();
            var getOwnPropertyNamesExternal = require_object_get_own_property_names_external();
            var getOwnPropertySymbolsModule = require_object_get_own_property_symbols();
            var getOwnPropertyDescriptorModule = require_object_get_own_property_descriptor();
            var definePropertyModule = require_object_define_property();
            var definePropertiesModule = require_object_define_properties();
            var propertyIsEnumerableModule = require_object_property_is_enumerable();
            var defineBuiltIn = require_define_built_in();
            var defineBuiltInAccessor = require_define_built_in_accessor();
            var shared = require_shared();
            var sharedKey = require_shared_key();
            var hiddenKeys = require_hidden_keys();
            var uid = require_uid();
            var wellKnownSymbol = require_well_known_symbol();
            var wrappedWellKnownSymbolModule = require_well_known_symbol_wrapped();
            var defineWellKnownSymbol = require_well_known_symbol_define();
            var defineSymbolToPrimitive = require_symbol_define_to_primitive();
            var setToStringTag = require_set_to_string_tag();
            var InternalStateModule = require_internal_state();
            var $forEach = require_array_iteration().forEach;
            var HIDDEN = sharedKey("hidden");
            var SYMBOL = "Symbol";
            var PROTOTYPE = "prototype";
            var setInternalState = InternalStateModule.set;
            var getInternalState = InternalStateModule.getterFor(SYMBOL);
            var ObjectPrototype = Object[PROTOTYPE];
            var $Symbol = globalThis2.Symbol;
            var SymbolPrototype = $Symbol && $Symbol[PROTOTYPE];
            var RangeError2 = globalThis2.RangeError;
            var TypeError2 = globalThis2.TypeError;
            var QObject = globalThis2.QObject;
            var nativeGetOwnPropertyDescriptor = getOwnPropertyDescriptorModule.f;
            var nativeDefineProperty = definePropertyModule.f;
            var nativeGetOwnPropertyNames = getOwnPropertyNamesExternal.f;
            var nativePropertyIsEnumerable = propertyIsEnumerableModule.f;
            var push = uncurryThis([].push);
            var AllSymbols = shared("symbols");
            var ObjectPrototypeSymbols = shared("op-symbols");
            var WellKnownSymbolsStore = shared("wks");
            var USE_SETTER = !QObject || !QObject[PROTOTYPE] || !QObject[PROTOTYPE].findChild;
            var fallbackDefineProperty = function (O, P, Attributes) {
                var ObjectPrototypeDescriptor = nativeGetOwnPropertyDescriptor(ObjectPrototype, P);
                if (ObjectPrototypeDescriptor)
                    delete ObjectPrototype[P];
                nativeDefineProperty(O, P, Attributes);
                if (ObjectPrototypeDescriptor && O !== ObjectPrototype) {
                    nativeDefineProperty(ObjectPrototype, P, ObjectPrototypeDescriptor);
                }
                return O;
            };
            var setSymbolDescriptor = DESCRIPTORS && fails(function () {
                return nativeObjectCreate(nativeDefineProperty({}, "a", {
                    get: function () {
                        return nativeDefineProperty(this, "a", { value: 7 }).a;
                    }
                })).a !== 7;
            }) ? fallbackDefineProperty : nativeDefineProperty;
            var wrap = function (tag, description) {
                var symbol = AllSymbols[tag] = nativeObjectCreate(SymbolPrototype);
                setInternalState(symbol, {
                    type: SYMBOL,
                    tag: tag,
                    description: description
                });
                if (!DESCRIPTORS)
                    symbol.description = description;
                return symbol;
            };
            var $defineProperty = function defineProperty(O, P, Attributes) {
                if (O === ObjectPrototype)
                    $defineProperty(ObjectPrototypeSymbols, P, Attributes);
                anObject(O);
                var key = toPropertyKey(P);
                anObject(Attributes);
                if (hasOwn(AllSymbols, key)) {
                    if (!("enumerable" in Attributes) ? !hasOwn(O, key) || hasOwn(O, HIDDEN) && O[HIDDEN][key] : !Attributes.enumerable) {
                        if (!hasOwn(O, HIDDEN))
                            nativeDefineProperty(O, HIDDEN, createPropertyDescriptor(1, nativeObjectCreate(null)));
                        O[HIDDEN][key] = true;
                    }
                    else {
                        if (hasOwn(O, HIDDEN) && O[HIDDEN][key])
                            O[HIDDEN][key] = false;
                        Attributes = nativeObjectCreate(Attributes, { enumerable: createPropertyDescriptor(0, false) });
                    }
                    return setSymbolDescriptor(O, key, Attributes);
                }
                return nativeDefineProperty(O, key, Attributes);
            };
            var $defineProperties = function defineProperties(O, Properties) {
                anObject(O);
                var properties = toIndexedObject(Properties);
                var keys = objectKeys(properties).concat($getOwnPropertySymbols(properties));
                $forEach(keys, function (key) {
                    if (!DESCRIPTORS || call($propertyIsEnumerable, properties, key))
                        $defineProperty(O, key, properties[key]);
                });
                return O;
            };
            var $create = function create(O, Properties) {
                return Properties === void 0 ? nativeObjectCreate(O) : $defineProperties(nativeObjectCreate(O), Properties);
            };
            var $propertyIsEnumerable = function propertyIsEnumerable(V) {
                var P = toPropertyKey(V);
                var enumerable = call(nativePropertyIsEnumerable, this, P);
                if (this === ObjectPrototype && hasOwn(AllSymbols, P) && !hasOwn(ObjectPrototypeSymbols, P))
                    return false;
                return enumerable || !hasOwn(this, P) || !hasOwn(AllSymbols, P) || hasOwn(this, HIDDEN) && this[HIDDEN][P] ? enumerable : true;
            };
            var $getOwnPropertyDescriptor = function getOwnPropertyDescriptor(O, P) {
                var it = toIndexedObject(O);
                var key = toPropertyKey(P);
                if (it === ObjectPrototype && hasOwn(AllSymbols, key) && !hasOwn(ObjectPrototypeSymbols, key))
                    return;
                var descriptor = nativeGetOwnPropertyDescriptor(it, key);
                if (descriptor && hasOwn(AllSymbols, key) && !(hasOwn(it, HIDDEN) && it[HIDDEN][key])) {
                    descriptor.enumerable = true;
                }
                return descriptor;
            };
            var $getOwnPropertyNames = function getOwnPropertyNames(O) {
                var names = nativeGetOwnPropertyNames(toIndexedObject(O));
                var result = [];
                $forEach(names, function (key) {
                    if (!hasOwn(AllSymbols, key) && !hasOwn(hiddenKeys, key))
                        push(result, key);
                });
                return result;
            };
            var $getOwnPropertySymbols = function (O) {
                var IS_OBJECT_PROTOTYPE = O === ObjectPrototype;
                var names = nativeGetOwnPropertyNames(IS_OBJECT_PROTOTYPE ? ObjectPrototypeSymbols : toIndexedObject(O));
                var result = [];
                $forEach(names, function (key) {
                    if (hasOwn(AllSymbols, key) && (!IS_OBJECT_PROTOTYPE || hasOwn(ObjectPrototype, key))) {
                        push(result, AllSymbols[key]);
                    }
                });
                return result;
            };
            if (!NATIVE_SYMBOL) {
                $Symbol = function Symbol2() {
                    if (isPrototypeOf(SymbolPrototype, this))
                        throw new TypeError2("Symbol is not a constructor");
                    var description = !arguments.length || arguments[0] === void 0 ? void 0 : $toString(arguments[0]);
                    var tag = uid(description);
                    var setter = function (value) {
                        var $this = this === void 0 ? globalThis2 : this;
                        if ($this === ObjectPrototype)
                            call(setter, ObjectPrototypeSymbols, value);
                        if (hasOwn($this, HIDDEN) && hasOwn($this[HIDDEN], tag))
                            $this[HIDDEN][tag] = false;
                        var descriptor = createPropertyDescriptor(1, value);
                        try {
                            setSymbolDescriptor($this, tag, descriptor);
                        }
                        catch (error) {
                            if (!(error instanceof RangeError2))
                                throw error;
                            fallbackDefineProperty($this, tag, descriptor);
                        }
                    };
                    if (DESCRIPTORS && USE_SETTER)
                        setSymbolDescriptor(ObjectPrototype, tag, { configurable: true, set: setter });
                    return wrap(tag, description);
                };
                SymbolPrototype = $Symbol[PROTOTYPE];
                defineBuiltIn(SymbolPrototype, "toString", function toString() {
                    return getInternalState(this).tag;
                });
                defineBuiltIn($Symbol, "withoutSetter", function (description) {
                    return wrap(uid(description), description);
                });
                propertyIsEnumerableModule.f = $propertyIsEnumerable;
                definePropertyModule.f = $defineProperty;
                definePropertiesModule.f = $defineProperties;
                getOwnPropertyDescriptorModule.f = $getOwnPropertyDescriptor;
                getOwnPropertyNamesModule.f = getOwnPropertyNamesExternal.f = $getOwnPropertyNames;
                getOwnPropertySymbolsModule.f = $getOwnPropertySymbols;
                wrappedWellKnownSymbolModule.f = function (name) {
                    return wrap(wellKnownSymbol(name), name);
                };
                if (DESCRIPTORS) {
                    defineBuiltInAccessor(SymbolPrototype, "description", {
                        configurable: true,
                        get: function description() {
                            return getInternalState(this).description;
                        }
                    });
                    if (!IS_PURE) {
                        defineBuiltIn(ObjectPrototype, "propertyIsEnumerable", $propertyIsEnumerable, { unsafe: true });
                    }
                }
            }
            $({ global: true, constructor: true, wrap: true, forced: !NATIVE_SYMBOL, sham: !NATIVE_SYMBOL }, {
                Symbol: $Symbol
            });
            $forEach(objectKeys(WellKnownSymbolsStore), function (name) {
                defineWellKnownSymbol(name);
            });
            $({ target: SYMBOL, stat: true, forced: !NATIVE_SYMBOL }, {
                useSetter: function () {
                    USE_SETTER = true;
                },
                useSimple: function () {
                    USE_SETTER = false;
                }
            });
            $({ target: "Object", stat: true, forced: !NATIVE_SYMBOL, sham: !DESCRIPTORS }, {
                // `Object.create` method
                // https://tc39.es/ecma262/#sec-object.create
                create: $create,
                // `Object.defineProperty` method
                // https://tc39.es/ecma262/#sec-object.defineproperty
                defineProperty: $defineProperty,
                // `Object.defineProperties` method
                // https://tc39.es/ecma262/#sec-object.defineproperties
                defineProperties: $defineProperties,
                // `Object.getOwnPropertyDescriptor` method
                // https://tc39.es/ecma262/#sec-object.getownpropertydescriptors
                getOwnPropertyDescriptor: $getOwnPropertyDescriptor
            });
            $({ target: "Object", stat: true, forced: !NATIVE_SYMBOL }, {
                // `Object.getOwnPropertyNames` method
                // https://tc39.es/ecma262/#sec-object.getownpropertynames
                getOwnPropertyNames: $getOwnPropertyNames
            });
            defineSymbolToPrimitive();
            setToStringTag($Symbol, SYMBOL);
            hiddenKeys[HIDDEN] = true;
        }
    });
    // node_modules/core-js/internals/symbol-registry-detection.js
    var require_symbol_registry_detection = __commonJS({
        "node_modules/core-js/internals/symbol-registry-detection.js": function (exports, module) {
            "use strict";
            var NATIVE_SYMBOL = require_symbol_constructor_detection();
            module.exports = NATIVE_SYMBOL && !!Symbol["for"] && !!Symbol.keyFor;
        }
    });
    // node_modules/core-js/modules/es.symbol.for.js
    var require_es_symbol_for = __commonJS({
        "node_modules/core-js/modules/es.symbol.for.js": function () {
            "use strict";
            var $ = require_export();
            var getBuiltIn = require_get_built_in();
            var hasOwn = require_has_own_property();
            var toString = require_to_string();
            var shared = require_shared();
            var NATIVE_SYMBOL_REGISTRY = require_symbol_registry_detection();
            var StringToSymbolRegistry = shared("string-to-symbol-registry");
            var SymbolToStringRegistry = shared("symbol-to-string-registry");
            $({ target: "Symbol", stat: true, forced: !NATIVE_SYMBOL_REGISTRY }, {
                "for": function (key) {
                    var string = toString(key);
                    if (hasOwn(StringToSymbolRegistry, string))
                        return StringToSymbolRegistry[string];
                    var symbol = getBuiltIn("Symbol")(string);
                    StringToSymbolRegistry[string] = symbol;
                    SymbolToStringRegistry[symbol] = string;
                    return symbol;
                }
            });
        }
    });
    // node_modules/core-js/modules/es.symbol.key-for.js
    var require_es_symbol_key_for = __commonJS({
        "node_modules/core-js/modules/es.symbol.key-for.js": function () {
            "use strict";
            var $ = require_export();
            var hasOwn = require_has_own_property();
            var isSymbol = require_is_symbol();
            var tryToString = require_try_to_string();
            var shared = require_shared();
            var NATIVE_SYMBOL_REGISTRY = require_symbol_registry_detection();
            var SymbolToStringRegistry = shared("symbol-to-string-registry");
            $({ target: "Symbol", stat: true, forced: !NATIVE_SYMBOL_REGISTRY }, {
                keyFor: function keyFor(sym) {
                    if (!isSymbol(sym))
                        throw new TypeError(tryToString(sym) + " is not a symbol");
                    if (hasOwn(SymbolToStringRegistry, sym))
                        return SymbolToStringRegistry[sym];
                }
            });
        }
    });
    // node_modules/core-js/internals/is-raw-json.js
    var require_is_raw_json = __commonJS({
        "node_modules/core-js/internals/is-raw-json.js": function (exports, module) {
            "use strict";
            var isObject = require_is_object();
            var getInternalState = require_internal_state().get;
            module.exports = function isRawJSON(O) {
                if (!isObject(O))
                    return false;
                var state2 = getInternalState(O);
                return !!state2 && state2.type === "RawJSON";
            };
        }
    });
    // node_modules/core-js/internals/this-number-value.js
    var require_this_number_value = __commonJS({
        "node_modules/core-js/internals/this-number-value.js": function (exports, module) {
            "use strict";
            var uncurryThis = require_function_uncurry_this();
            module.exports = uncurryThis(1.1.valueOf);
        }
    });
    // node_modules/core-js/internals/parse-json-string.js
    var require_parse_json_string = __commonJS({
        "node_modules/core-js/internals/parse-json-string.js": function (exports, module) {
            "use strict";
            var uncurryThis = require_function_uncurry_this();
            var hasOwn = require_has_own_property();
            var $SyntaxError = SyntaxError;
            var $parseInt = parseInt;
            var fromCharCode = String.fromCharCode;
            var at = uncurryThis("".charAt);
            var slice = uncurryThis("".slice);
            var exec = uncurryThis(/./.exec);
            var codePoints = {
                '\\"': '"',
                "\\\\": "\\",
                "\\/": "/",
                "\\b": "\b",
                "\\f": "\f",
                "\\n": "\n",
                "\\r": "\r",
                "\\t": "	"
            };
            var IS_4_HEX_DIGITS = /^[\da-f]{4}$/i;
            var IS_C0_CONTROL_CODE = /^[\u0000-\u001F]$/;
            module.exports = function (source, i) {
                var unterminated = true;
                var value = "";
                while (i < source.length) {
                    var chr = at(source, i);
                    if (chr === "\\") {
                        var twoChars = slice(source, i, i + 2);
                        if (hasOwn(codePoints, twoChars)) {
                            value += codePoints[twoChars];
                            i += 2;
                        }
                        else if (twoChars === "\\u") {
                            i += 2;
                            var fourHexDigits = slice(source, i, i + 4);
                            if (!exec(IS_4_HEX_DIGITS, fourHexDigits))
                                throw new $SyntaxError("Bad Unicode escape at: " + i);
                            value += fromCharCode($parseInt(fourHexDigits, 16));
                            i += 4;
                        }
                        else
                            throw new $SyntaxError('Unknown escape sequence: "' + twoChars + '"');
                    }
                    else if (chr === '"') {
                        unterminated = false;
                        i++;
                        break;
                    }
                    else {
                        if (exec(IS_C0_CONTROL_CODE, chr))
                            throw new $SyntaxError("Bad control character in string literal at: " + i);
                        value += chr;
                        i++;
                    }
                }
                if (unterminated)
                    throw new $SyntaxError("Unterminated string at: " + i);
                return { value: value, end: i };
            };
        }
    });
    // node_modules/core-js/internals/native-raw-json.js
    var require_native_raw_json = __commonJS({
        "node_modules/core-js/internals/native-raw-json.js": function (exports, module) {
            "use strict";
            var fails = require_fails();
            module.exports = !fails(function () {
                var unsafeInt = "9007199254740993";
                var raw = JSON.rawJSON(unsafeInt);
                return !JSON.isRawJSON(raw) || JSON.stringify(raw) !== unsafeInt;
            });
        }
    });
    // node_modules/core-js/modules/es.json.stringify.js
    var require_es_json_stringify = __commonJS({
        "node_modules/core-js/modules/es.json.stringify.js": function () {
            "use strict";
            var $ = require_export();
            var getBuiltIn = require_get_built_in();
            var call = require_function_call();
            var uncurryThis = require_function_uncurry_this();
            var fails = require_fails();
            var isArray = require_is_array();
            var isCallable = require_is_callable();
            var isObject = require_is_object();
            var create = require_object_create();
            var isRawJSON = require_is_raw_json();
            var isSymbol = require_is_symbol();
            var classof = require_classof_raw();
            var thisNumberValue = require_this_number_value();
            var includes = require_array_includes().includes;
            var hasOwn = require_has_own_property();
            var toString = require_to_string();
            var parseJSONString = require_parse_json_string();
            var uid = require_uid();
            var NATIVE_SYMBOL = require_symbol_constructor_detection();
            var NATIVE_RAW_JSON = require_native_raw_json();
            var $String = String;
            var $TypeError = TypeError;
            var $stringify = getBuiltIn("JSON", "stringify");
            var $BigInt = getBuiltIn("BigInt");
            var stringValueOf = uncurryThis("".valueOf);
            var booleanValueOf = uncurryThis(true.valueOf);
            var bigIntValueOf = $BigInt && uncurryThis($BigInt.prototype.valueOf);
            var exec = uncurryThis(/./.exec);
            var charAt = uncurryThis("".charAt);
            var charCodeAt = uncurryThis("".charCodeAt);
            var replace = uncurryThis("".replace);
            var slice = uncurryThis("".slice);
            var push = uncurryThis([].push);
            var pop = uncurryThis([].pop);
            var numberToString = uncurryThis(1.1.toString);
            var surrogates = /[\uD800-\uDFFF]/g;
            var leadingSurrogates = /^[\uD800-\uDBFF]$/;
            var trailingSurrogates = /^[\uDC00-\uDFFF]$/;
            var digits = /^\d+$/;
            var RAW_MARK = uid();
            var KEY_MARK = uid();
            var END_MARK = uid();
            var RAW_MARK_LENGTH = RAW_MARK.length;
            var KEY_MARK_LENGTH = KEY_MARK.length;
            var WRONG_SYMBOLS_CONVERSION = !NATIVE_SYMBOL || fails(function () {
                var symbol = getBuiltIn("Symbol")("stringify detection");
                return $stringify([symbol]) !== "[null]" || $stringify({ a: symbol }) !== "{}" || $stringify(Object(symbol)) !== "{}";
            });
            var ILL_FORMED_UNICODE = fails(function () {
                return $stringify("\uDF06\uD834") !== '"\\udf06\\ud834"' || $stringify("\uDEAD") !== '"\\udead"';
            });
            var isRawJSONValue = NATIVE_RAW_JSON ? getBuiltIn("JSON", "isRawJSON") : isRawJSON;
            var stringifyWithProperSymbolsConversion = WRONG_SYMBOLS_CONVERSION ? function (it, replacer, space) {
                return $stringify(it, function (key, value) {
                    var replaced = call(replacer, this, key, value);
                    if (!isSymbol(replaced))
                        return replaced;
                }, space);
            } : $stringify;
            var fixIllFormedJSON = function (match, offset, string) {
                var prev = charAt(string, offset - 1);
                var next = charAt(string, offset + 1);
                if (exec(leadingSurrogates, match) && !exec(trailingSurrogates, next) || exec(trailingSurrogates, match) && !exec(leadingSurrogates, prev)) {
                    return "\\u" + numberToString(charCodeAt(match, 0), 16);
                }
                return match;
            };
            var getPropertyList = function (replacer) {
                if (!isArray(replacer))
                    return;
                var rawLength = replacer.length;
                var propertyList = [];
                var addedKeys = create(null);
                for (var i = 0; i < rawLength; i++) {
                    var element = replacer[i];
                    var key;
                    if (typeof element == "string")
                        key = element;
                    else if (typeof element == "number" || classof(element) === "Number" || classof(element) === "String")
                        key = toString(element);
                    else
                        continue;
                    if (!hasOwn(addedKeys, key)) {
                        addedKeys[key] = true;
                        push(propertyList, key);
                    }
                }
                return propertyList;
            };
            var hasInternalSlot = function (valueOf, it) {
                try {
                    valueOf(it);
                    return true;
                }
                catch (error) {
                    return false;
                }
            };
            var isBoxedPrimitive = function (it) {
                var kind = classof(it);
                return kind === "Number" && hasInternalSlot(thisNumberValue, it) || kind === "String" && hasInternalSlot(stringValueOf, it) || kind === "Boolean" && hasInternalSlot(booleanValueOf, it) || !!bigIntValueOf && kind === "BigInt" && hasInternalSlot(bigIntValueOf, it);
            };
            var isSerializedAsObject = function (it) {
                if (!isObject(it) || isCallable(it) || isArray(it))
                    return false;
                try {
                    return !isBoxedPrimitive(it);
                }
                catch (error) {
                    return true;
                }
            };
            var createElementHolder = function (holder, key) {
                return {
                    toJSON: function () {
                        var element = holder[key];
                        if (isObject(element) || typeof element == "bigint") {
                            var elementToJSON = element.toJSON;
                            if (isCallable(elementToJSON))
                                element = call(elementToJSON, element, key);
                        }
                        return element;
                    }
                };
            };
            var getKeyPrefix = function (propertyList) {
                for (var i = 0, length = propertyList.length; i < length; i++) {
                    if (exec(digits, propertyList[i]))
                        return KEY_MARK;
                }
                return "";
            };
            var createOrderedObject = function (value, propertyList, keyPrefix) {
                var ordered = create(null);
                for (var i = 0, length = propertyList.length; i < length; i++) {
                    var key = propertyList[i];
                    ordered[keyPrefix + key] = createElementHolder(value, key);
                }
                ordered[END_MARK] = null;
                return ordered;
            };
            if ($stringify)
                $({ target: "JSON", stat: true, arity: 3, forced: WRONG_SYMBOLS_CONVERSION || ILL_FORMED_UNICODE || !NATIVE_RAW_JSON }, {
                    stringify: function stringify(text, replacer, space) {
                        var replacerFunction = isCallable(replacer) ? replacer : void 0;
                        var propertyList = replacerFunction ? void 0 : getPropertyList(replacer);
                        var keyPrefix = propertyList && getKeyPrefix(propertyList);
                        var rawStrings = [];
                        var openObjects = [];
                        var parentOrdered = [];
                        var currentOrdered;
                        var marked = false;
                        var root = true;
                        var json = stringifyWithProperSymbolsConversion(text, function (key, value) {
                            key = $String(key);
                            if (propertyList) {
                                if (key === END_MARK) {
                                    pop(openObjects);
                                    currentOrdered = pop(parentOrdered);
                                    return;
                                }
                                if (root)
                                    root = false;
                                else if (this !== currentOrdered && !isArray(this) && !includes(propertyList, key))
                                    return;
                            }
                            else if (replacerFunction)
                                value = call(replacerFunction, this, key, value);
                            if (isRawJSONValue(value)) {
                                if (NATIVE_RAW_JSON)
                                    return value;
                                marked = true;
                                return RAW_MARK + (push(rawStrings, value.rawJSON) - 1);
                            }
                            if (propertyList && isSerializedAsObject(value)) {
                                if (includes(openObjects, value))
                                    throw new $TypeError("Converting circular structure to JSON");
                                var ordered = createOrderedObject(value, propertyList, keyPrefix);
                                push(openObjects, value);
                                push(parentOrdered, currentOrdered);
                                currentOrdered = ordered;
                                if (keyPrefix)
                                    marked = true;
                                return ordered;
                            }
                            return value;
                        }, space);
                        if (typeof json != "string")
                            return json;
                        if (ILL_FORMED_UNICODE)
                            json = replace(json, surrogates, fixIllFormedJSON);
                        if (!marked)
                            return json;
                        var result = "";
                        var length = json.length;
                        for (var i = 0; i < length; i++) {
                            var chr = charAt(json, i);
                            if (chr === '"') {
                                var end = parseJSONString(json, ++i).end - 1;
                                var string = slice(json, i, end);
                                if (slice(string, 0, RAW_MARK_LENGTH) === RAW_MARK)
                                    result += rawStrings[slice(string, RAW_MARK_LENGTH)];
                                else if (slice(string, 0, KEY_MARK_LENGTH) === KEY_MARK)
                                    result += '"' + slice(string, KEY_MARK_LENGTH) + '"';
                                else
                                    result += '"' + string + '"';
                                i = end;
                            }
                            else
                                result += chr;
                        }
                        return result;
                    }
                });
        }
    });
    // node_modules/core-js/modules/es.object.get-own-property-symbols.js
    var require_es_object_get_own_property_symbols = __commonJS({
        "node_modules/core-js/modules/es.object.get-own-property-symbols.js": function () {
            "use strict";
            var $ = require_export();
            var NATIVE_SYMBOL = require_symbol_constructor_detection();
            var fails = require_fails();
            var getOwnPropertySymbolsModule = require_object_get_own_property_symbols();
            var toObject = require_to_object();
            var FORCED = !NATIVE_SYMBOL || fails(function () {
                getOwnPropertySymbolsModule.f(1);
            });
            $({ target: "Object", stat: true, forced: FORCED }, {
                getOwnPropertySymbols: function getOwnPropertySymbols(it) {
                    var $getOwnPropertySymbols = getOwnPropertySymbolsModule.f;
                    return $getOwnPropertySymbols ? $getOwnPropertySymbols(toObject(it)) : [];
                }
            });
        }
    });
    // node_modules/core-js/modules/es.symbol.js
    var require_es_symbol = __commonJS({
        "node_modules/core-js/modules/es.symbol.js": function () {
            "use strict";
            require_es_symbol_constructor();
            require_es_symbol_for();
            require_es_symbol_key_for();
            require_es_json_stringify();
            require_es_object_get_own_property_symbols();
        }
    });
    // node_modules/core-js/modules/es.symbol.async-dispose.js
    var require_es_symbol_async_dispose = __commonJS({
        "node_modules/core-js/modules/es.symbol.async-dispose.js": function () {
            "use strict";
            var globalThis2 = require_global_this();
            var defineWellKnownSymbol = require_well_known_symbol_define();
            var defineProperty = require_object_define_property().f;
            var getOwnPropertyDescriptor = require_object_get_own_property_descriptor().f;
            var Symbol2 = globalThis2.Symbol;
            defineWellKnownSymbol("asyncDispose");
            if (Symbol2) {
                descriptor = getOwnPropertyDescriptor(Symbol2, "asyncDispose");
                if (descriptor.enumerable && descriptor.configurable && descriptor.writable) {
                    defineProperty(Symbol2, "asyncDispose", { value: descriptor.value, enumerable: false, configurable: false, writable: false });
                }
            }
            var descriptor;
        }
    });
    // node_modules/core-js/modules/es.symbol.async-iterator.js
    var require_es_symbol_async_iterator = __commonJS({
        "node_modules/core-js/modules/es.symbol.async-iterator.js": function () {
            "use strict";
            var defineWellKnownSymbol = require_well_known_symbol_define();
            defineWellKnownSymbol("asyncIterator");
        }
    });
    // node_modules/core-js/modules/es.symbol.description.js
    var require_es_symbol_description = __commonJS({
        "node_modules/core-js/modules/es.symbol.description.js": function () {
            "use strict";
            var $ = require_export();
            var DESCRIPTORS = require_descriptors();
            var globalThis2 = require_global_this();
            var call = require_function_call();
            var uncurryThis = require_function_uncurry_this();
            var hasOwn = require_has_own_property();
            var isCallable = require_is_callable();
            var isPrototypeOf = require_object_is_prototype_of();
            var toString = require_to_string();
            var defineBuiltInAccessor = require_define_built_in_accessor();
            var copyConstructorProperties = require_copy_constructor_properties();
            var NativeSymbol = globalThis2.Symbol;
            var SymbolPrototype = NativeSymbol && NativeSymbol.prototype;
            if (DESCRIPTORS && isCallable(NativeSymbol) && (!("description" in SymbolPrototype) || // Safari 12 bug
                NativeSymbol().description !== void 0)) {
                EmptyStringDescriptionStore = {};
                SymbolWrapper = function Symbol2() {
                    var description = arguments.length < 1 || arguments[0] === void 0 ? void 0 : toString(arguments[0]);
                    var result = isPrototypeOf(SymbolPrototype, this) ? new NativeSymbol(description) : description === void 0 ? NativeSymbol() : NativeSymbol(description);
                    if (description === "")
                        EmptyStringDescriptionStore[result] = true;
                    return result;
                };
                copyConstructorProperties(SymbolWrapper, NativeSymbol);
                nativeFor = SymbolWrapper["for"];
                SymbolWrapper["for"] = { "for": function (key) {
                        var stringKey = toString(key);
                        var symbol = call(nativeFor, this, stringKey);
                        if (stringKey === "")
                            EmptyStringDescriptionStore[symbol] = true;
                        return symbol;
                    } }["for"];
                SymbolWrapper.prototype = SymbolPrototype;
                SymbolPrototype.constructor = SymbolWrapper;
                NATIVE_SYMBOL = String(NativeSymbol("description detection")) === "Symbol(description detection)";
                thisSymbolValue = uncurryThis(SymbolPrototype.valueOf);
                symbolDescriptiveString = uncurryThis(SymbolPrototype.toString);
                regexp = /^Symbol\((.*)\)[^)]+$/;
                replace = uncurryThis("".replace);
                stringSlice = uncurryThis("".slice);
                defineBuiltInAccessor(SymbolPrototype, "description", {
                    configurable: true,
                    get: function description() {
                        var symbol = thisSymbolValue(this);
                        if (hasOwn(EmptyStringDescriptionStore, symbol))
                            return "";
                        var string = symbolDescriptiveString(symbol);
                        var desc = NATIVE_SYMBOL ? stringSlice(string, 7, -1) : replace(string, regexp, "$1");
                        return desc === "" ? void 0 : desc;
                    }
                });
                $({ global: true, constructor: true, forced: true }, {
                    Symbol: SymbolWrapper
                });
            }
            var EmptyStringDescriptionStore;
            var SymbolWrapper;
            var nativeFor;
            var NATIVE_SYMBOL;
            var thisSymbolValue;
            var symbolDescriptiveString;
            var regexp;
            var replace;
            var stringSlice;
        }
    });
    // node_modules/core-js/modules/es.symbol.dispose.js
    var require_es_symbol_dispose = __commonJS({
        "node_modules/core-js/modules/es.symbol.dispose.js": function () {
            "use strict";
            var globalThis2 = require_global_this();
            var defineWellKnownSymbol = require_well_known_symbol_define();
            var defineProperty = require_object_define_property().f;
            var getOwnPropertyDescriptor = require_object_get_own_property_descriptor().f;
            var Symbol2 = globalThis2.Symbol;
            defineWellKnownSymbol("dispose");
            if (Symbol2) {
                descriptor = getOwnPropertyDescriptor(Symbol2, "dispose");
                if (descriptor.enumerable && descriptor.configurable && descriptor.writable) {
                    defineProperty(Symbol2, "dispose", { value: descriptor.value, enumerable: false, configurable: false, writable: false });
                }
            }
            var descriptor;
        }
    });
    // node_modules/core-js/modules/es.symbol.has-instance.js
    var require_es_symbol_has_instance = __commonJS({
        "node_modules/core-js/modules/es.symbol.has-instance.js": function () {
            "use strict";
            var defineWellKnownSymbol = require_well_known_symbol_define();
            defineWellKnownSymbol("hasInstance");
        }
    });
    // node_modules/core-js/modules/es.symbol.is-concat-spreadable.js
    var require_es_symbol_is_concat_spreadable = __commonJS({
        "node_modules/core-js/modules/es.symbol.is-concat-spreadable.js": function () {
            "use strict";
            var defineWellKnownSymbol = require_well_known_symbol_define();
            defineWellKnownSymbol("isConcatSpreadable");
        }
    });
    // node_modules/core-js/modules/es.symbol.iterator.js
    var require_es_symbol_iterator = __commonJS({
        "node_modules/core-js/modules/es.symbol.iterator.js": function () {
            "use strict";
            var defineWellKnownSymbol = require_well_known_symbol_define();
            defineWellKnownSymbol("iterator");
        }
    });
    // node_modules/core-js/modules/es.symbol.match.js
    var require_es_symbol_match = __commonJS({
        "node_modules/core-js/modules/es.symbol.match.js": function () {
            "use strict";
            var defineWellKnownSymbol = require_well_known_symbol_define();
            defineWellKnownSymbol("match");
        }
    });
    // node_modules/core-js/modules/es.symbol.match-all.js
    var require_es_symbol_match_all = __commonJS({
        "node_modules/core-js/modules/es.symbol.match-all.js": function () {
            "use strict";
            var defineWellKnownSymbol = require_well_known_symbol_define();
            defineWellKnownSymbol("matchAll");
        }
    });
    // node_modules/core-js/modules/es.symbol.replace.js
    var require_es_symbol_replace = __commonJS({
        "node_modules/core-js/modules/es.symbol.replace.js": function () {
            "use strict";
            var defineWellKnownSymbol = require_well_known_symbol_define();
            defineWellKnownSymbol("replace");
        }
    });
    // node_modules/core-js/modules/es.symbol.search.js
    var require_es_symbol_search = __commonJS({
        "node_modules/core-js/modules/es.symbol.search.js": function () {
            "use strict";
            var defineWellKnownSymbol = require_well_known_symbol_define();
            defineWellKnownSymbol("search");
        }
    });
    // node_modules/core-js/modules/es.symbol.species.js
    var require_es_symbol_species = __commonJS({
        "node_modules/core-js/modules/es.symbol.species.js": function () {
            "use strict";
            var defineWellKnownSymbol = require_well_known_symbol_define();
            defineWellKnownSymbol("species");
        }
    });
    // node_modules/core-js/modules/es.symbol.split.js
    var require_es_symbol_split = __commonJS({
        "node_modules/core-js/modules/es.symbol.split.js": function () {
            "use strict";
            var defineWellKnownSymbol = require_well_known_symbol_define();
            defineWellKnownSymbol("split");
        }
    });
    // node_modules/core-js/modules/es.symbol.to-primitive.js
    var require_es_symbol_to_primitive = __commonJS({
        "node_modules/core-js/modules/es.symbol.to-primitive.js": function () {
            "use strict";
            var defineWellKnownSymbol = require_well_known_symbol_define();
            var defineSymbolToPrimitive = require_symbol_define_to_primitive();
            defineWellKnownSymbol("toPrimitive");
            defineSymbolToPrimitive();
        }
    });
    // node_modules/core-js/modules/es.symbol.to-string-tag.js
    var require_es_symbol_to_string_tag = __commonJS({
        "node_modules/core-js/modules/es.symbol.to-string-tag.js": function () {
            "use strict";
            var getBuiltIn = require_get_built_in();
            var defineWellKnownSymbol = require_well_known_symbol_define();
            var setToStringTag = require_set_to_string_tag();
            defineWellKnownSymbol("toStringTag");
            setToStringTag(getBuiltIn("Symbol"), "Symbol");
        }
    });
    // node_modules/core-js/modules/es.symbol.unscopables.js
    var require_es_symbol_unscopables = __commonJS({
        "node_modules/core-js/modules/es.symbol.unscopables.js": function () {
            "use strict";
            var defineWellKnownSymbol = require_well_known_symbol_define();
            defineWellKnownSymbol("unscopables");
        }
    });
    // node_modules/core-js/modules/es.json.to-string-tag.js
    var require_es_json_to_string_tag = __commonJS({
        "node_modules/core-js/modules/es.json.to-string-tag.js": function () {
            "use strict";
            var globalThis2 = require_global_this();
            var setToStringTag = require_set_to_string_tag();
            setToStringTag(globalThis2.JSON, "JSON", true);
        }
    });
    // node_modules/core-js/modules/es.math.to-string-tag.js
    var require_es_math_to_string_tag = __commonJS({
        "node_modules/core-js/modules/es.math.to-string-tag.js": function () {
            "use strict";
            var setToStringTag = require_set_to_string_tag();
            setToStringTag(Math, "Math", true);
        }
    });
    // node_modules/core-js/modules/es.reflect.to-string-tag.js
    var require_es_reflect_to_string_tag = __commonJS({
        "node_modules/core-js/modules/es.reflect.to-string-tag.js": function () {
            "use strict";
            var $ = require_export();
            var globalThis2 = require_global_this();
            var setToStringTag = require_set_to_string_tag();
            $({ global: true }, { Reflect: {} });
            setToStringTag(globalThis2.Reflect, "Reflect", true);
        }
    });
    // node_modules/core-js/es/symbol/index.js
    var require_symbol = __commonJS({
        "node_modules/core-js/es/symbol/index.js": function (exports, module) {
            "use strict";
            require_es_array_concat();
            require_es_object_to_string();
            require_es_symbol();
            require_es_symbol_async_dispose();
            require_es_symbol_async_iterator();
            require_es_symbol_description();
            require_es_symbol_dispose();
            require_es_symbol_has_instance();
            require_es_symbol_is_concat_spreadable();
            require_es_symbol_iterator();
            require_es_symbol_match();
            require_es_symbol_match_all();
            require_es_symbol_replace();
            require_es_symbol_search();
            require_es_symbol_species();
            require_es_symbol_split();
            require_es_symbol_to_primitive();
            require_es_symbol_to_string_tag();
            require_es_symbol_unscopables();
            require_es_json_to_string_tag();
            require_es_math_to_string_tag();
            require_es_reflect_to_string_tag();
            var path = require_path();
            module.exports = path.Symbol;
        }
    });
    // node_modules/core-js/stable/symbol/index.js
    var require_symbol2 = __commonJS({
        "node_modules/core-js/stable/symbol/index.js": function (exports, module) {
            "use strict";
            var parent = require_symbol();
            require_web_dom_collections_iterator();
            module.exports = parent;
        }
    });
    // node_modules/core-js/modules/esnext.function.metadata.js
    var require_esnext_function_metadata = __commonJS({
        "node_modules/core-js/modules/esnext.function.metadata.js": function () {
            "use strict";
            var wellKnownSymbol = require_well_known_symbol();
            var defineProperty = require_object_define_property().f;
            var METADATA = wellKnownSymbol("metadata");
            var FunctionPrototype = Function.prototype;
            if (FunctionPrototype[METADATA] === void 0) {
                defineProperty(FunctionPrototype, METADATA, {
                    value: null
                });
            }
        }
    });
    // node_modules/core-js/modules/esnext.symbol.async-dispose.js
    var require_esnext_symbol_async_dispose = __commonJS({
        "node_modules/core-js/modules/esnext.symbol.async-dispose.js": function () {
            "use strict";
            require_es_symbol_async_dispose();
        }
    });
    // node_modules/core-js/modules/esnext.symbol.dispose.js
    var require_esnext_symbol_dispose = __commonJS({
        "node_modules/core-js/modules/esnext.symbol.dispose.js": function () {
            "use strict";
            require_es_symbol_dispose();
        }
    });
    // node_modules/core-js/modules/esnext.symbol.metadata.js
    var require_esnext_symbol_metadata = __commonJS({
        "node_modules/core-js/modules/esnext.symbol.metadata.js": function () {
            "use strict";
            var defineWellKnownSymbol = require_well_known_symbol_define();
            defineWellKnownSymbol("metadata");
        }
    });
    // node_modules/core-js/actual/symbol/index.js
    var require_symbol3 = __commonJS({
        "node_modules/core-js/actual/symbol/index.js": function (exports, module) {
            "use strict";
            var parent = require_symbol2();
            require_esnext_function_metadata();
            require_esnext_symbol_async_dispose();
            require_esnext_symbol_dispose();
            require_esnext_symbol_metadata();
            module.exports = parent;
        }
    });
    // node_modules/core-js/internals/call-with-safe-iteration-closing.js
    var require_call_with_safe_iteration_closing = __commonJS({
        "node_modules/core-js/internals/call-with-safe-iteration-closing.js": function (exports, module) {
            "use strict";
            var anObject = require_an_object();
            var iteratorClose = require_iterator_close();
            module.exports = function (iterator, fn, value, ENTRIES) {
                try {
                    return ENTRIES ? fn(anObject(value)[0], value[1]) : fn(value);
                }
                catch (error) {
                    iteratorClose(iterator, "throw", error);
                }
            };
        }
    });
    // node_modules/core-js/internals/array-from.js
    var require_array_from = __commonJS({
        "node_modules/core-js/internals/array-from.js": function (exports, module) {
            "use strict";
            var bind = require_function_bind_context();
            var call = require_function_call();
            var toObject = require_to_object();
            var callWithSafeIterationClosing = require_call_with_safe_iteration_closing();
            var isArrayIteratorMethod = require_is_array_iterator_method();
            var isConstructor = require_is_constructor();
            var lengthOfArrayLike = require_length_of_array_like();
            var createProperty = require_create_property();
            var setArrayLength = require_array_set_length();
            var getIterator = require_get_iterator_internal();
            var getIteratorMethod = require_get_iterator_method_internal();
            var iteratorClose = require_iterator_close();
            var doesNotExceedSafeInteger = require_does_not_exceed_safe_integer();
            var $Array = Array;
            module.exports = function from(arrayLike) {
                var IS_CONSTRUCTOR = isConstructor(this);
                var argumentsLength = arguments.length;
                var mapfn = argumentsLength > 1 ? arguments[1] : void 0;
                var mapping = mapfn !== void 0;
                if (mapping)
                    mapfn = bind(mapfn, argumentsLength > 2 ? arguments[2] : void 0);
                var O = toObject(arrayLike);
                var iteratorMethod = getIteratorMethod(O);
                var index = 0;
                var length, result, step, iterator, next, value;
                if (iteratorMethod && !(this === $Array && isArrayIteratorMethod(iteratorMethod))) {
                    result = IS_CONSTRUCTOR ? new this() : [];
                    iterator = getIterator(O, iteratorMethod);
                    next = iterator.next;
                    for (; !(step = call(next, iterator)).done; index++) {
                        try {
                            doesNotExceedSafeInteger(index);
                        }
                        catch (error) {
                            iteratorClose(iterator, "throw", error);
                        }
                        value = mapping ? callWithSafeIterationClosing(iterator, mapfn, [step.value, index], true) : step.value;
                        try {
                            createProperty(result, index, value);
                        }
                        catch (error) {
                            iteratorClose(iterator, "throw", error);
                        }
                    }
                }
                else {
                    length = lengthOfArrayLike(O);
                    result = IS_CONSTRUCTOR ? new this(length) : $Array(length);
                    for (; length > index; index++) {
                        value = mapping ? mapfn(O[index], index) : O[index];
                        createProperty(result, index, value);
                    }
                }
                setArrayLength(result, index);
                return result;
            };
        }
    });
    // node_modules/core-js/modules/es.array.from.js
    var require_es_array_from = __commonJS({
        "node_modules/core-js/modules/es.array.from.js": function () {
            "use strict";
            var $ = require_export();
            var from = require_array_from();
            var checkCorrectnessOfIteration = require_check_correctness_of_iteration();
            var INCORRECT_ITERATION = !checkCorrectnessOfIteration(function (iterable) {
                Array.from(iterable);
            });
            $({ target: "Array", stat: true, forced: INCORRECT_ITERATION }, {
                from: from
            });
        }
    });
    // node_modules/core-js/es/array/from.js
    var require_from = __commonJS({
        "node_modules/core-js/es/array/from.js": function (exports, module) {
            "use strict";
            require_es_string_iterator();
            require_es_array_from();
            var path = require_path();
            module.exports = path.Array.from;
        }
    });
    // node_modules/core-js/stable/array/from.js
    var require_from2 = __commonJS({
        "node_modules/core-js/stable/array/from.js": function (exports, module) {
            "use strict";
            var parent = require_from();
            module.exports = parent;
        }
    });
    // node_modules/core-js/actual/array/from.js
    var require_from3 = __commonJS({
        "node_modules/core-js/actual/array/from.js": function (exports, module) {
            "use strict";
            var parent = require_from2();
            module.exports = parent;
        }
    });
    // node_modules/core-js/modules/es.array.find.js
    var require_es_array_find = __commonJS({
        "node_modules/core-js/modules/es.array.find.js": function () {
            "use strict";
            var $ = require_export();
            var $find = require_array_iteration().find;
            var addToUnscopables = require_add_to_unscopables();
            var FIND = "find";
            var SKIPS_HOLES = true;
            if (FIND in [])
                Array(1)[FIND](function () {
                    SKIPS_HOLES = false;
                });
            $({ target: "Array", proto: true, forced: SKIPS_HOLES }, {
                find: function find(callbackfn) {
                    return $find(this, callbackfn, arguments.length > 1 ? arguments[1] : void 0);
                }
            });
            addToUnscopables(FIND);
        }
    });
    // node_modules/core-js/internals/entry-unbind.js
    var require_entry_unbind = __commonJS({
        "node_modules/core-js/internals/entry-unbind.js": function (exports, module) {
            "use strict";
            var globalThis2 = require_global_this();
            var uncurryThis = require_function_uncurry_this();
            module.exports = function (CONSTRUCTOR, METHOD) {
                return uncurryThis(globalThis2[CONSTRUCTOR].prototype[METHOD]);
            };
        }
    });
    // node_modules/core-js/es/array/find.js
    var require_find = __commonJS({
        "node_modules/core-js/es/array/find.js": function (exports, module) {
            "use strict";
            require_es_array_find();
            var entryUnbind = require_entry_unbind();
            module.exports = entryUnbind("Array", "find");
        }
    });
    // node_modules/core-js/stable/array/find.js
    var require_find2 = __commonJS({
        "node_modules/core-js/stable/array/find.js": function (exports, module) {
            "use strict";
            var parent = require_find();
            module.exports = parent;
        }
    });
    // node_modules/core-js/actual/array/find.js
    var require_find3 = __commonJS({
        "node_modules/core-js/actual/array/find.js": function (exports, module) {
            "use strict";
            var parent = require_find2();
            module.exports = parent;
        }
    });
    // node_modules/core-js/modules/es.array.find-index.js
    var require_es_array_find_index = __commonJS({
        "node_modules/core-js/modules/es.array.find-index.js": function () {
            "use strict";
            var $ = require_export();
            var $findIndex = require_array_iteration().findIndex;
            var addToUnscopables = require_add_to_unscopables();
            var FIND_INDEX = "findIndex";
            var SKIPS_HOLES = true;
            if (FIND_INDEX in [])
                Array(1)[FIND_INDEX](function () {
                    SKIPS_HOLES = false;
                });
            $({ target: "Array", proto: true, forced: SKIPS_HOLES }, {
                findIndex: function findIndex(callbackfn) {
                    return $findIndex(this, callbackfn, arguments.length > 1 ? arguments[1] : void 0);
                }
            });
            addToUnscopables(FIND_INDEX);
        }
    });
    // node_modules/core-js/es/array/find-index.js
    var require_find_index = __commonJS({
        "node_modules/core-js/es/array/find-index.js": function (exports, module) {
            "use strict";
            require_es_array_find_index();
            var entryUnbind = require_entry_unbind();
            module.exports = entryUnbind("Array", "findIndex");
        }
    });
    // node_modules/core-js/stable/array/find-index.js
    var require_find_index2 = __commonJS({
        "node_modules/core-js/stable/array/find-index.js": function (exports, module) {
            "use strict";
            var parent = require_find_index();
            module.exports = parent;
        }
    });
    // node_modules/core-js/actual/array/find-index.js
    var require_find_index3 = __commonJS({
        "node_modules/core-js/actual/array/find-index.js": function (exports, module) {
            "use strict";
            var parent = require_find_index2();
            module.exports = parent;
        }
    });
    // node_modules/core-js/modules/es.array.includes.js
    var require_es_array_includes = __commonJS({
        "node_modules/core-js/modules/es.array.includes.js": function () {
            "use strict";
            var $ = require_export();
            var $includes = require_array_includes().includes;
            var fails = require_fails();
            var addToUnscopables = require_add_to_unscopables();
            var BROKEN_ON_SPARSE = fails(function () {
                return !Array(1).includes();
            });
            var BROKEN_ON_SPARSE_WITH_FROM_INDEX = fails(function () {
                return [, 1].includes(void 0, 1);
            });
            $({ target: "Array", proto: true, forced: BROKEN_ON_SPARSE || BROKEN_ON_SPARSE_WITH_FROM_INDEX }, {
                includes: function includes(el) {
                    return $includes(this, el, arguments.length > 1 ? arguments[1] : void 0);
                }
            });
            addToUnscopables("includes");
        }
    });
    // node_modules/core-js/es/array/includes.js
    var require_includes = __commonJS({
        "node_modules/core-js/es/array/includes.js": function (exports, module) {
            "use strict";
            require_es_array_includes();
            var entryUnbind = require_entry_unbind();
            module.exports = entryUnbind("Array", "includes");
        }
    });
    // node_modules/core-js/stable/array/includes.js
    var require_includes2 = __commonJS({
        "node_modules/core-js/stable/array/includes.js": function (exports, module) {
            "use strict";
            var parent = require_includes();
            module.exports = parent;
        }
    });
    // node_modules/core-js/actual/array/includes.js
    var require_includes3 = __commonJS({
        "node_modules/core-js/actual/array/includes.js": function (exports, module) {
            "use strict";
            var parent = require_includes2();
            module.exports = parent;
        }
    });
    // node_modules/core-js/es/array/iterator.js
    var require_iterator = __commonJS({
        "node_modules/core-js/es/array/iterator.js": function (exports, module) {
            "use strict";
            require_es_array_iterator();
            require_es_object_to_string();
            var entryUnbind = require_entry_unbind();
            module.exports = entryUnbind("Array", "values");
        }
    });
    // node_modules/core-js/stable/array/iterator.js
    var require_iterator2 = __commonJS({
        "node_modules/core-js/stable/array/iterator.js": function (exports, module) {
            "use strict";
            var parent = require_iterator();
            module.exports = parent;
        }
    });
    // node_modules/core-js/actual/array/iterator.js
    var require_iterator3 = __commonJS({
        "node_modules/core-js/actual/array/iterator.js": function (exports, module) {
            "use strict";
            var parent = require_iterator2();
            module.exports = parent;
        }
    });
    // node_modules/core-js/internals/flatten-into-array.js
    var require_flatten_into_array = __commonJS({
        "node_modules/core-js/internals/flatten-into-array.js": function (exports, module) {
            "use strict";
            var isArray = require_is_array();
            var lengthOfArrayLike = require_length_of_array_like();
            var doesNotExceedSafeInteger = require_does_not_exceed_safe_integer();
            var bind = require_function_bind_context();
            var createProperty = require_create_property();
            var flattenIntoArray = function (target, original, source, sourceLen, start2, depth, mapper, thisArg) {
                var targetIndex = start2;
                var sourceIndex = 0;
                var mapFn = mapper ? bind(mapper, thisArg) : false;
                var element, elementLen;
                while (sourceIndex < sourceLen) {
                    if (sourceIndex in source) {
                        element = mapFn ? mapFn(source[sourceIndex], sourceIndex, original) : source[sourceIndex];
                        if (depth > 0 && isArray(element)) {
                            elementLen = lengthOfArrayLike(element);
                            targetIndex = flattenIntoArray(target, original, element, elementLen, targetIndex, depth - 1) - 1;
                        }
                        else {
                            doesNotExceedSafeInteger(targetIndex + 1);
                            createProperty(target, targetIndex, element);
                        }
                        targetIndex++;
                    }
                    sourceIndex++;
                }
                return targetIndex;
            };
            module.exports = flattenIntoArray;
        }
    });
    // node_modules/core-js/modules/es.array.flat-map.js
    var require_es_array_flat_map = __commonJS({
        "node_modules/core-js/modules/es.array.flat-map.js": function () {
            "use strict";
            var $ = require_export();
            var flattenIntoArray = require_flatten_into_array();
            var aCallable = require_a_callable();
            var toObject = require_to_object();
            var lengthOfArrayLike = require_length_of_array_like();
            var arraySpeciesCreate = require_array_species_create();
            $({ target: "Array", proto: true }, {
                flatMap: function flatMap(callbackfn) {
                    var O = toObject(this);
                    var sourceLen = lengthOfArrayLike(O);
                    var A;
                    aCallable(callbackfn);
                    A = arraySpeciesCreate(O, 0);
                    flattenIntoArray(A, O, O, sourceLen, 0, 1, callbackfn, arguments.length > 1 ? arguments[1] : void 0);
                    return A;
                }
            });
        }
    });
    // node_modules/core-js/modules/es.array.unscopables.flat-map.js
    var require_es_array_unscopables_flat_map = __commonJS({
        "node_modules/core-js/modules/es.array.unscopables.flat-map.js": function () {
            "use strict";
            var addToUnscopables = require_add_to_unscopables();
            addToUnscopables("flatMap");
        }
    });
    // node_modules/core-js/es/array/flat-map.js
    var require_flat_map = __commonJS({
        "node_modules/core-js/es/array/flat-map.js": function (exports, module) {
            "use strict";
            require_es_array_flat_map();
            require_es_array_unscopables_flat_map();
            var entryUnbind = require_entry_unbind();
            module.exports = entryUnbind("Array", "flatMap");
        }
    });
    // node_modules/core-js/stable/array/flat-map.js
    var require_flat_map2 = __commonJS({
        "node_modules/core-js/stable/array/flat-map.js": function (exports, module) {
            "use strict";
            var parent = require_flat_map();
            module.exports = parent;
        }
    });
    // node_modules/core-js/actual/array/flat-map.js
    var require_flat_map3 = __commonJS({
        "node_modules/core-js/actual/array/flat-map.js": function (exports, module) {
            "use strict";
            var parent = require_flat_map2();
            module.exports = parent;
        }
    });
    // node_modules/core-js/internals/object-assign.js
    var require_object_assign = __commonJS({
        "node_modules/core-js/internals/object-assign.js": function (exports, module) {
            "use strict";
            var DESCRIPTORS = require_descriptors();
            var uncurryThis = require_function_uncurry_this();
            var call = require_function_call();
            var fails = require_fails();
            var objectKeys = require_object_keys();
            var getOwnPropertySymbolsModule = require_object_get_own_property_symbols();
            var propertyIsEnumerableModule = require_object_property_is_enumerable();
            var toObject = require_to_object();
            var IndexedObject = require_indexed_object();
            var $assign = Object.assign;
            var defineProperty = Object.defineProperty;
            var concat = uncurryThis([].concat);
            module.exports = !$assign || fails(function () {
                if (DESCRIPTORS && $assign({ b: 1 }, $assign(defineProperty({}, "a", {
                    enumerable: true,
                    get: function () {
                        defineProperty(this, "b", {
                            value: 3,
                            enumerable: false
                        });
                    }
                }), { b: 2 })).b !== 1)
                    return true;
                var A = {};
                var B = {};
                var symbol = Symbol("assign detection");
                var alphabet = "abcdefghijklmnopqrst";
                A[symbol] = 7;
                alphabet.split("").forEach(function (chr) {
                    B[chr] = chr;
                });
                return $assign({}, A)[symbol] !== 7 || objectKeys($assign({}, B)).join("") !== alphabet;
            }) ? function assign(target, source) {
                var T = toObject(target);
                var argumentsLength = arguments.length;
                var index = 1;
                var getOwnPropertySymbols = getOwnPropertySymbolsModule.f;
                var propertyIsEnumerable = propertyIsEnumerableModule.f;
                while (argumentsLength > index) {
                    var S = IndexedObject(arguments[index++]);
                    var keys = getOwnPropertySymbols ? concat(objectKeys(S), getOwnPropertySymbols(S)) : objectKeys(S);
                    var length = keys.length;
                    var j = 0;
                    var key;
                    while (length > j) {
                        key = keys[j++];
                        if (!DESCRIPTORS || call(propertyIsEnumerable, S, key))
                            T[key] = S[key];
                    }
                }
                return T;
            } : $assign;
        }
    });
    // node_modules/core-js/modules/es.object.assign.js
    var require_es_object_assign = __commonJS({
        "node_modules/core-js/modules/es.object.assign.js": function () {
            "use strict";
            var $ = require_export();
            var assign = require_object_assign();
            $({ target: "Object", stat: true, arity: 2, forced: Object.assign !== assign }, {
                assign: assign
            });
        }
    });
    // node_modules/core-js/es/object/assign.js
    var require_assign = __commonJS({
        "node_modules/core-js/es/object/assign.js": function (exports, module) {
            "use strict";
            require_es_object_assign();
            var path = require_path();
            module.exports = path.Object.assign;
        }
    });
    // node_modules/core-js/stable/object/assign.js
    var require_assign2 = __commonJS({
        "node_modules/core-js/stable/object/assign.js": function (exports, module) {
            "use strict";
            var parent = require_assign();
            module.exports = parent;
        }
    });
    // node_modules/core-js/actual/object/assign.js
    var require_assign3 = __commonJS({
        "node_modules/core-js/actual/object/assign.js": function (exports, module) {
            "use strict";
            var parent = require_assign2();
            module.exports = parent;
        }
    });
    // node_modules/core-js/internals/object-to-array.js
    var require_object_to_array = __commonJS({
        "node_modules/core-js/internals/object-to-array.js": function (exports, module) {
            "use strict";
            var DESCRIPTORS = require_descriptors();
            var fails = require_fails();
            var uncurryThis = require_function_uncurry_this();
            var objectGetPrototypeOf = require_object_get_prototype_of();
            var objectKeys = require_object_keys();
            var toIndexedObject = require_to_indexed_object();
            var $propertyIsEnumerable = require_object_property_is_enumerable().f;
            var propertyIsEnumerable = uncurryThis($propertyIsEnumerable);
            var push = uncurryThis([].push);
            var IE_BUG = DESCRIPTORS && fails(function () {
                var O = /* @__PURE__ */ Object.create(null);
                O[2] = 2;
                return !propertyIsEnumerable(O, 2);
            });
            var createMethod = function (TO_ENTRIES) {
                return function (it) {
                    var O = toIndexedObject(it);
                    var keys = objectKeys(O);
                    var IE_WORKAROUND = IE_BUG && objectGetPrototypeOf(O) === null;
                    var length = keys.length;
                    var i = 0;
                    var result = [];
                    var key;
                    while (length > i) {
                        key = keys[i++];
                        if (!DESCRIPTORS || (IE_WORKAROUND ? key in O : propertyIsEnumerable(O, key))) {
                            push(result, TO_ENTRIES ? [key, O[key]] : O[key]);
                        }
                    }
                    return result;
                };
            };
            module.exports = {
                // `Object.entries` method
                // https://tc39.es/ecma262/#sec-object.entries
                entries: createMethod(true),
                // `Object.values` method
                // https://tc39.es/ecma262/#sec-object.values
                values: createMethod(false)
            };
        }
    });
    // node_modules/core-js/modules/es.object.entries.js
    var require_es_object_entries = __commonJS({
        "node_modules/core-js/modules/es.object.entries.js": function () {
            "use strict";
            var $ = require_export();
            var $entries = require_object_to_array().entries;
            $({ target: "Object", stat: true }, {
                entries: function entries(O) {
                    return $entries(O);
                }
            });
        }
    });
    // node_modules/core-js/es/object/entries.js
    var require_entries = __commonJS({
        "node_modules/core-js/es/object/entries.js": function (exports, module) {
            "use strict";
            require_es_object_entries();
            var path = require_path();
            module.exports = path.Object.entries;
        }
    });
    // node_modules/core-js/stable/object/entries.js
    var require_entries2 = __commonJS({
        "node_modules/core-js/stable/object/entries.js": function (exports, module) {
            "use strict";
            var parent = require_entries();
            module.exports = parent;
        }
    });
    // node_modules/core-js/actual/object/entries.js
    var require_entries3 = __commonJS({
        "node_modules/core-js/actual/object/entries.js": function (exports, module) {
            "use strict";
            var parent = require_entries2();
            module.exports = parent;
        }
    });
    // node_modules/core-js/modules/es.object.values.js
    var require_es_object_values = __commonJS({
        "node_modules/core-js/modules/es.object.values.js": function () {
            "use strict";
            var $ = require_export();
            var $values = require_object_to_array().values;
            $({ target: "Object", stat: true }, {
                values: function values(O) {
                    return $values(O);
                }
            });
        }
    });
    // node_modules/core-js/es/object/values.js
    var require_values = __commonJS({
        "node_modules/core-js/es/object/values.js": function (exports, module) {
            "use strict";
            require_es_object_values();
            var path = require_path();
            module.exports = path.Object.values;
        }
    });
    // node_modules/core-js/stable/object/values.js
    var require_values2 = __commonJS({
        "node_modules/core-js/stable/object/values.js": function (exports, module) {
            "use strict";
            var parent = require_values();
            module.exports = parent;
        }
    });
    // node_modules/core-js/actual/object/values.js
    var require_values3 = __commonJS({
        "node_modules/core-js/actual/object/values.js": function (exports, module) {
            "use strict";
            var parent = require_values2();
            module.exports = parent;
        }
    });
    // node_modules/core-js/internals/is-regexp.js
    var require_is_regexp = __commonJS({
        "node_modules/core-js/internals/is-regexp.js": function (exports, module) {
            "use strict";
            var isObject = require_is_object();
            var classof = require_classof_raw();
            var wellKnownSymbol = require_well_known_symbol();
            var MATCH = wellKnownSymbol("match");
            module.exports = function (it) {
                var isRegExp;
                return isObject(it) && ((isRegExp = it[MATCH]) !== void 0 ? !!isRegExp : classof(it) === "RegExp");
            };
        }
    });
    // node_modules/core-js/internals/not-a-regexp.js
    var require_not_a_regexp = __commonJS({
        "node_modules/core-js/internals/not-a-regexp.js": function (exports, module) {
            "use strict";
            var isRegExp = require_is_regexp();
            var $TypeError = TypeError;
            module.exports = function (it) {
                if (isRegExp(it)) {
                    throw new $TypeError("The method doesn't accept regular expressions");
                }
                return it;
            };
        }
    });
    // node_modules/core-js/internals/correct-is-regexp-logic.js
    var require_correct_is_regexp_logic = __commonJS({
        "node_modules/core-js/internals/correct-is-regexp-logic.js": function (exports, module) {
            "use strict";
            var wellKnownSymbol = require_well_known_symbol();
            var MATCH = wellKnownSymbol("match");
            module.exports = function (METHOD_NAME) {
                var regexp = /./;
                try {
                    "/./"[METHOD_NAME](regexp);
                }
                catch (error1) {
                    try {
                        regexp[MATCH] = false;
                        return "/./"[METHOD_NAME](regexp);
                    }
                    catch (error2) {
                    }
                }
                return false;
            };
        }
    });
    // node_modules/core-js/modules/es.string.includes.js
    var require_es_string_includes = __commonJS({
        "node_modules/core-js/modules/es.string.includes.js": function () {
            "use strict";
            var $ = require_export();
            var uncurryThis = require_function_uncurry_this();
            var notARegExp = require_not_a_regexp();
            var requireObjectCoercible = require_require_object_coercible();
            var toString = require_to_string();
            var correctIsRegExpLogic = require_correct_is_regexp_logic();
            var stringIndexOf = uncurryThis("".indexOf);
            $({ target: "String", proto: true, forced: !correctIsRegExpLogic("includes") }, {
                includes: function includes(searchString) {
                    return !!~stringIndexOf(toString(requireObjectCoercible(this)), toString(notARegExp(searchString)), arguments.length > 1 ? arguments[1] : void 0);
                }
            });
        }
    });
    // node_modules/core-js/es/string/includes.js
    var require_includes4 = __commonJS({
        "node_modules/core-js/es/string/includes.js": function (exports, module) {
            "use strict";
            require_es_string_includes();
            var entryUnbind = require_entry_unbind();
            module.exports = entryUnbind("String", "includes");
        }
    });
    // node_modules/core-js/stable/string/includes.js
    var require_includes5 = __commonJS({
        "node_modules/core-js/stable/string/includes.js": function (exports, module) {
            "use strict";
            var parent = require_includes4();
            module.exports = parent;
        }
    });
    // node_modules/core-js/actual/string/includes.js
    var require_includes6 = __commonJS({
        "node_modules/core-js/actual/string/includes.js": function (exports, module) {
            "use strict";
            var parent = require_includes5();
            module.exports = parent;
        }
    });
    // node_modules/core-js/modules/es.string.starts-with.js
    var require_es_string_starts_with = __commonJS({
        "node_modules/core-js/modules/es.string.starts-with.js": function () {
            "use strict";
            var $ = require_export();
            var uncurryThis = require_function_uncurry_this_clause();
            var getOwnPropertyDescriptor = require_object_get_own_property_descriptor().f;
            var toLength = require_to_length();
            var toString = require_to_string();
            var notARegExp = require_not_a_regexp();
            var requireObjectCoercible = require_require_object_coercible();
            var correctIsRegExpLogic = require_correct_is_regexp_logic();
            var IS_PURE = require_is_pure();
            var stringSlice = uncurryThis("".slice);
            var min = Math.min;
            var CORRECT_IS_REGEXP_LOGIC = correctIsRegExpLogic("startsWith");
            var MDN_POLYFILL_BUG = !IS_PURE && !CORRECT_IS_REGEXP_LOGIC && !!(function () {
                var descriptor = getOwnPropertyDescriptor(String.prototype, "startsWith");
                return descriptor && !descriptor.writable;
            })();
            $({ target: "String", proto: true, forced: !MDN_POLYFILL_BUG && !CORRECT_IS_REGEXP_LOGIC }, {
                startsWith: function startsWith(searchString) {
                    var that = toString(requireObjectCoercible(this));
                    notARegExp(searchString);
                    var search = toString(searchString);
                    var index = toLength(min(arguments.length > 1 ? arguments[1] : void 0, that.length));
                    return stringSlice(that, index, index + search.length) === search;
                }
            });
        }
    });
    // node_modules/core-js/es/string/starts-with.js
    var require_starts_with = __commonJS({
        "node_modules/core-js/es/string/starts-with.js": function (exports, module) {
            "use strict";
            require_es_string_starts_with();
            var entryUnbind = require_entry_unbind();
            module.exports = entryUnbind("String", "startsWith");
        }
    });
    // node_modules/core-js/stable/string/starts-with.js
    var require_starts_with2 = __commonJS({
        "node_modules/core-js/stable/string/starts-with.js": function (exports, module) {
            "use strict";
            var parent = require_starts_with();
            module.exports = parent;
        }
    });
    // node_modules/core-js/actual/string/starts-with.js
    var require_starts_with3 = __commonJS({
        "node_modules/core-js/actual/string/starts-with.js": function (exports, module) {
            "use strict";
            var parent = require_starts_with2();
            module.exports = parent;
        }
    });
    // node_modules/core-js/modules/es.string.ends-with.js
    var require_es_string_ends_with = __commonJS({
        "node_modules/core-js/modules/es.string.ends-with.js": function () {
            "use strict";
            var $ = require_export();
            var uncurryThis = require_function_uncurry_this_clause();
            var getOwnPropertyDescriptor = require_object_get_own_property_descriptor().f;
            var toLength = require_to_length();
            var toString = require_to_string();
            var notARegExp = require_not_a_regexp();
            var requireObjectCoercible = require_require_object_coercible();
            var correctIsRegExpLogic = require_correct_is_regexp_logic();
            var IS_PURE = require_is_pure();
            var slice = uncurryThis("".slice);
            var min = Math.min;
            var CORRECT_IS_REGEXP_LOGIC = correctIsRegExpLogic("endsWith");
            var MDN_POLYFILL_BUG = !IS_PURE && !CORRECT_IS_REGEXP_LOGIC && !!(function () {
                var descriptor = getOwnPropertyDescriptor(String.prototype, "endsWith");
                return descriptor && !descriptor.writable;
            })();
            $({ target: "String", proto: true, forced: !MDN_POLYFILL_BUG && !CORRECT_IS_REGEXP_LOGIC }, {
                endsWith: function endsWith(searchString) {
                    var that = toString(requireObjectCoercible(this));
                    notARegExp(searchString);
                    var search = toString(searchString);
                    var endPosition = arguments.length > 1 ? arguments[1] : void 0;
                    var len = that.length;
                    var end = endPosition === void 0 ? len : min(toLength(endPosition), len);
                    return slice(that, end - search.length, end) === search;
                }
            });
        }
    });
    // node_modules/core-js/es/string/ends-with.js
    var require_ends_with = __commonJS({
        "node_modules/core-js/es/string/ends-with.js": function (exports, module) {
            "use strict";
            require_es_string_ends_with();
            var entryUnbind = require_entry_unbind();
            module.exports = entryUnbind("String", "endsWith");
        }
    });
    // node_modules/core-js/stable/string/ends-with.js
    var require_ends_with2 = __commonJS({
        "node_modules/core-js/stable/string/ends-with.js": function (exports, module) {
            "use strict";
            var parent = require_ends_with();
            module.exports = parent;
        }
    });
    // node_modules/core-js/actual/string/ends-with.js
    var require_ends_with3 = __commonJS({
        "node_modules/core-js/actual/string/ends-with.js": function (exports, module) {
            "use strict";
            var parent = require_ends_with2();
            module.exports = parent;
        }
    });
    // node_modules/core-js/internals/string-repeat.js
    var require_string_repeat = __commonJS({
        "node_modules/core-js/internals/string-repeat.js": function (exports, module) {
            "use strict";
            var toIntegerOrInfinity = require_to_integer_or_infinity();
            var toString = require_to_string();
            var requireObjectCoercible = require_require_object_coercible();
            var $RangeError = RangeError;
            var floor = Math.floor;
            module.exports = function repeat(count) {
                var str = toString(requireObjectCoercible(this));
                var result = "";
                var n = toIntegerOrInfinity(count);
                if (n < 0 || n === Infinity)
                    throw new $RangeError("Wrong number of repetitions");
                for (; n > 0; (n = floor(n / 2)) && (str += str))
                    if (n % 2)
                        result += str;
                return result;
            };
        }
    });
    // node_modules/core-js/internals/string-pad.js
    var require_string_pad = __commonJS({
        "node_modules/core-js/internals/string-pad.js": function (exports, module) {
            "use strict";
            var uncurryThis = require_function_uncurry_this();
            var toLength = require_to_length();
            var toString = require_to_string();
            var $repeat = require_string_repeat();
            var requireObjectCoercible = require_require_object_coercible();
            var repeat = uncurryThis($repeat);
            var stringSlice = uncurryThis("".slice);
            var ceil = Math.ceil;
            var createMethod = function (IS_END) {
                return function ($this, maxLength, fillString) {
                    var S = toString(requireObjectCoercible($this));
                    var intMaxLength = toLength(maxLength);
                    var stringLength = S.length;
                    if (intMaxLength <= stringLength)
                        return S;
                    var fillStr = fillString === void 0 ? " " : toString(fillString);
                    var fillLen, stringFiller;
                    if (fillStr === "")
                        return S;
                    fillLen = intMaxLength - stringLength;
                    stringFiller = repeat(fillStr, ceil(fillLen / fillStr.length));
                    if (stringFiller.length > fillLen)
                        stringFiller = stringSlice(stringFiller, 0, fillLen);
                    return IS_END ? S + stringFiller : stringFiller + S;
                };
            };
            module.exports = {
                // `String.prototype.padStart` method
                // https://tc39.es/ecma262/#sec-string.prototype.padstart
                start: createMethod(false),
                // `String.prototype.padEnd` method
                // https://tc39.es/ecma262/#sec-string.prototype.padend
                end: createMethod(true)
            };
        }
    });
    // node_modules/core-js/internals/string-pad-webkit-bug.js
    var require_string_pad_webkit_bug = __commonJS({
        "node_modules/core-js/internals/string-pad-webkit-bug.js": function (exports, module) {
            "use strict";
            var userAgent = require_environment_user_agent();
            module.exports = /Version\/10(?:\.\d+){1,2}(?: [\w./]+)?(?: Mobile\/\w+)? Safari\//.test(userAgent);
        }
    });
    // node_modules/core-js/modules/es.string.pad-end.js
    var require_es_string_pad_end = __commonJS({
        "node_modules/core-js/modules/es.string.pad-end.js": function () {
            "use strict";
            var $ = require_export();
            var $padEnd = require_string_pad().end;
            var WEBKIT_BUG = require_string_pad_webkit_bug();
            $({ target: "String", proto: true, forced: WEBKIT_BUG }, {
                padEnd: function padEnd(maxLength) {
                    return $padEnd(this, maxLength, arguments.length > 1 ? arguments[1] : void 0);
                }
            });
        }
    });
    // node_modules/core-js/es/string/pad-end.js
    var require_pad_end = __commonJS({
        "node_modules/core-js/es/string/pad-end.js": function (exports, module) {
            "use strict";
            require_es_string_pad_end();
            var entryUnbind = require_entry_unbind();
            module.exports = entryUnbind("String", "padEnd");
        }
    });
    // node_modules/core-js/stable/string/pad-end.js
    var require_pad_end2 = __commonJS({
        "node_modules/core-js/stable/string/pad-end.js": function (exports, module) {
            "use strict";
            var parent = require_pad_end();
            module.exports = parent;
        }
    });
    // node_modules/core-js/actual/string/pad-end.js
    var require_pad_end3 = __commonJS({
        "node_modules/core-js/actual/string/pad-end.js": function (exports, module) {
            "use strict";
            var parent = require_pad_end2();
            module.exports = parent;
        }
    });
    // node_modules/core-js/modules/es.string.pad-start.js
    var require_es_string_pad_start = __commonJS({
        "node_modules/core-js/modules/es.string.pad-start.js": function () {
            "use strict";
            var $ = require_export();
            var $padStart = require_string_pad().start;
            var WEBKIT_BUG = require_string_pad_webkit_bug();
            $({ target: "String", proto: true, forced: WEBKIT_BUG }, {
                padStart: function padStart(maxLength) {
                    return $padStart(this, maxLength, arguments.length > 1 ? arguments[1] : void 0);
                }
            });
        }
    });
    // node_modules/core-js/es/string/pad-start.js
    var require_pad_start = __commonJS({
        "node_modules/core-js/es/string/pad-start.js": function (exports, module) {
            "use strict";
            require_es_string_pad_start();
            var entryUnbind = require_entry_unbind();
            module.exports = entryUnbind("String", "padStart");
        }
    });
    // node_modules/core-js/stable/string/pad-start.js
    var require_pad_start2 = __commonJS({
        "node_modules/core-js/stable/string/pad-start.js": function (exports, module) {
            "use strict";
            var parent = require_pad_start();
            module.exports = parent;
        }
    });
    // node_modules/core-js/actual/string/pad-start.js
    var require_pad_start3 = __commonJS({
        "node_modules/core-js/actual/string/pad-start.js": function (exports, module) {
            "use strict";
            var parent = require_pad_start2();
            module.exports = parent;
        }
    });
    // node_modules/core-js/modules/es.string.repeat.js
    var require_es_string_repeat = __commonJS({
        "node_modules/core-js/modules/es.string.repeat.js": function () {
            "use strict";
            var $ = require_export();
            var repeat = require_string_repeat();
            $({ target: "String", proto: true }, {
                repeat: repeat
            });
        }
    });
    // node_modules/core-js/es/string/repeat.js
    var require_repeat = __commonJS({
        "node_modules/core-js/es/string/repeat.js": function (exports, module) {
            "use strict";
            require_es_string_repeat();
            var entryUnbind = require_entry_unbind();
            module.exports = entryUnbind("String", "repeat");
        }
    });
    // node_modules/core-js/stable/string/repeat.js
    var require_repeat2 = __commonJS({
        "node_modules/core-js/stable/string/repeat.js": function (exports, module) {
            "use strict";
            var parent = require_repeat();
            module.exports = parent;
        }
    });
    // node_modules/core-js/actual/string/repeat.js
    var require_repeat3 = __commonJS({
        "node_modules/core-js/actual/string/repeat.js": function (exports, module) {
            "use strict";
            var parent = require_repeat2();
            module.exports = parent;
        }
    });
    // node_modules/core-js/internals/whitespaces.js
    var require_whitespaces = __commonJS({
        "node_modules/core-js/internals/whitespaces.js": function (exports, module) {
            "use strict";
            module.exports = "	\n\v\f\r                　\u2028\u2029\uFEFF";
        }
    });
    // node_modules/core-js/internals/string-trim.js
    var require_string_trim = __commonJS({
        "node_modules/core-js/internals/string-trim.js": function (exports, module) {
            "use strict";
            var uncurryThis = require_function_uncurry_this();
            var requireObjectCoercible = require_require_object_coercible();
            var toString = require_to_string();
            var whitespaces = require_whitespaces();
            var replace = uncurryThis("".replace);
            var ltrim = RegExp("^[" + whitespaces + "]+");
            var rtrim = RegExp("(^|[^" + whitespaces + "])[" + whitespaces + "]+$");
            var createMethod = function (TYPE) {
                return function ($this) {
                    var string = toString(requireObjectCoercible($this));
                    if (TYPE & 1)
                        string = replace(string, ltrim, "");
                    if (TYPE & 2)
                        string = replace(string, rtrim, "$1");
                    return string;
                };
            };
            module.exports = {
                // `String.prototype.{ trimLeft, trimStart }` methods
                // https://tc39.es/ecma262/#sec-string.prototype.trimstart
                start: createMethod(1),
                // `String.prototype.{ trimRight, trimEnd }` methods
                // https://tc39.es/ecma262/#sec-string.prototype.trimend
                end: createMethod(2),
                // `String.prototype.trim` method
                // https://tc39.es/ecma262/#sec-string.prototype.trim
                trim: createMethod(3)
            };
        }
    });
    // node_modules/core-js/internals/string-trim-forced.js
    var require_string_trim_forced = __commonJS({
        "node_modules/core-js/internals/string-trim-forced.js": function (exports, module) {
            "use strict";
            var PROPER_FUNCTION_NAME = require_function_name().PROPER;
            var fails = require_fails();
            var whitespaces = require_whitespaces();
            var non = "​᠎";
            module.exports = function (METHOD_NAME) {
                return fails(function () {
                    return !!whitespaces[METHOD_NAME]() || non[METHOD_NAME]() !== non || PROPER_FUNCTION_NAME && whitespaces[METHOD_NAME].name !== METHOD_NAME;
                });
            };
        }
    });
    // node_modules/core-js/internals/string-trim-end.js
    var require_string_trim_end = __commonJS({
        "node_modules/core-js/internals/string-trim-end.js": function (exports, module) {
            "use strict";
            var $trimEnd = require_string_trim().end;
            var forcedStringTrimMethod = require_string_trim_forced();
            module.exports = forcedStringTrimMethod("trimEnd") ? function trimEnd() {
                return $trimEnd(this);
            } : "".trimEnd;
        }
    });
    // node_modules/core-js/modules/es.string.trim-right.js
    var require_es_string_trim_right = __commonJS({
        "node_modules/core-js/modules/es.string.trim-right.js": function () {
            "use strict";
            var $ = require_export();
            var trimEnd = require_string_trim_end();
            $({ target: "String", proto: true, name: "trimEnd", forced: "".trimRight !== trimEnd }, {
                trimRight: trimEnd
            });
        }
    });
    // node_modules/core-js/modules/es.string.trim-end.js
    var require_es_string_trim_end = __commonJS({
        "node_modules/core-js/modules/es.string.trim-end.js": function () {
            "use strict";
            require_es_string_trim_right();
            var $ = require_export();
            var trimEnd = require_string_trim_end();
            $({ target: "String", proto: true, name: "trimEnd", forced: "".trimEnd !== trimEnd }, {
                trimEnd: trimEnd
            });
        }
    });
    // node_modules/core-js/es/string/trim-end.js
    var require_trim_end = __commonJS({
        "node_modules/core-js/es/string/trim-end.js": function (exports, module) {
            "use strict";
            require_es_string_trim_end();
            var entryUnbind = require_entry_unbind();
            module.exports = entryUnbind("String", "trimRight");
        }
    });
    // node_modules/core-js/stable/string/trim-end.js
    var require_trim_end2 = __commonJS({
        "node_modules/core-js/stable/string/trim-end.js": function (exports, module) {
            "use strict";
            var parent = require_trim_end();
            module.exports = parent;
        }
    });
    // node_modules/core-js/actual/string/trim-end.js
    var require_trim_end3 = __commonJS({
        "node_modules/core-js/actual/string/trim-end.js": function (exports, module) {
            "use strict";
            var parent = require_trim_end2();
            module.exports = parent;
        }
    });
    // node_modules/core-js/internals/number-is-finite.js
    var require_number_is_finite = __commonJS({
        "node_modules/core-js/internals/number-is-finite.js": function (exports, module) {
            "use strict";
            var globalThis2 = require_global_this();
            var globalIsFinite = globalThis2.isFinite;
            module.exports = Number.isFinite || function isFinite2(it) {
                return typeof it == "number" && globalIsFinite(it);
            };
        }
    });
    // node_modules/core-js/modules/es.number.is-finite.js
    var require_es_number_is_finite = __commonJS({
        "node_modules/core-js/modules/es.number.is-finite.js": function () {
            "use strict";
            var $ = require_export();
            var numberIsFinite = require_number_is_finite();
            $({ target: "Number", stat: true }, { isFinite: numberIsFinite });
        }
    });
    // node_modules/core-js/es/number/is-finite.js
    var require_is_finite = __commonJS({
        "node_modules/core-js/es/number/is-finite.js": function (exports, module) {
            "use strict";
            require_es_number_is_finite();
            var path = require_path();
            module.exports = path.Number.isFinite;
        }
    });
    // node_modules/core-js/stable/number/is-finite.js
    var require_is_finite2 = __commonJS({
        "node_modules/core-js/stable/number/is-finite.js": function (exports, module) {
            "use strict";
            var parent = require_is_finite();
            module.exports = parent;
        }
    });
    // node_modules/core-js/actual/number/is-finite.js
    var require_is_finite3 = __commonJS({
        "node_modules/core-js/actual/number/is-finite.js": function (exports, module) {
            "use strict";
            var parent = require_is_finite2();
            module.exports = parent;
        }
    });
    // node_modules/core-js/internals/is-integral-number.js
    var require_is_integral_number = __commonJS({
        "node_modules/core-js/internals/is-integral-number.js": function (exports, module) {
            "use strict";
            var isObject = require_is_object();
            var floor = Math.floor;
            module.exports = Number.isInteger || function isInteger(it) {
                return !isObject(it) && isFinite(it) && floor(it) === it;
            };
        }
    });
    // node_modules/core-js/modules/es.number.is-integer.js
    var require_es_number_is_integer = __commonJS({
        "node_modules/core-js/modules/es.number.is-integer.js": function () {
            "use strict";
            var $ = require_export();
            var isIntegralNumber = require_is_integral_number();
            $({ target: "Number", stat: true }, {
                isInteger: isIntegralNumber
            });
        }
    });
    // node_modules/core-js/es/number/is-integer.js
    var require_is_integer = __commonJS({
        "node_modules/core-js/es/number/is-integer.js": function (exports, module) {
            "use strict";
            require_es_number_is_integer();
            var path = require_path();
            module.exports = path.Number.isInteger;
        }
    });
    // node_modules/core-js/stable/number/is-integer.js
    var require_is_integer2 = __commonJS({
        "node_modules/core-js/stable/number/is-integer.js": function (exports, module) {
            "use strict";
            var parent = require_is_integer();
            module.exports = parent;
        }
    });
    // node_modules/core-js/actual/number/is-integer.js
    var require_is_integer3 = __commonJS({
        "node_modules/core-js/actual/number/is-integer.js": function (exports, module) {
            "use strict";
            var parent = require_is_integer2();
            module.exports = parent;
        }
    });
    // node_modules/core-js/internals/number-parse-int.js
    var require_number_parse_int = __commonJS({
        "node_modules/core-js/internals/number-parse-int.js": function (exports, module) {
            "use strict";
            var globalThis2 = require_global_this();
            var fails = require_fails();
            var uncurryThis = require_function_uncurry_this();
            var toString = require_to_string();
            var trim = require_string_trim().trim;
            var whitespaces = require_whitespaces();
            var $parseInt = globalThis2.parseInt;
            var Symbol2 = globalThis2.Symbol;
            var ITERATOR = Symbol2 && Symbol2.iterator;
            var hex = /^[+-]?0x/i;
            var exec = uncurryThis(hex.exec);
            var FORCED = $parseInt(whitespaces + "08") !== 8 || $parseInt(whitespaces + "0x16") !== 22 || ITERATOR && !fails(function () {
                $parseInt(Object(ITERATOR));
            });
            module.exports = FORCED ? function parseInt2(string, radix) {
                var S = trim(toString(string));
                return $parseInt(S, radix >>> 0 || (exec(hex, S) ? 16 : 10));
            } : $parseInt;
        }
    });
    // node_modules/core-js/modules/es.number.parse-int.js
    var require_es_number_parse_int = __commonJS({
        "node_modules/core-js/modules/es.number.parse-int.js": function () {
            "use strict";
            var $ = require_export();
            var parseInt2 = require_number_parse_int();
            $({ target: "Number", stat: true, forced: Number.parseInt !== parseInt2 }, {
                parseInt: parseInt2
            });
        }
    });
    // node_modules/core-js/es/number/parse-int.js
    var require_parse_int = __commonJS({
        "node_modules/core-js/es/number/parse-int.js": function (exports, module) {
            "use strict";
            require_es_number_parse_int();
            var path = require_path();
            module.exports = path.Number.parseInt;
        }
    });
    // node_modules/core-js/stable/number/parse-int.js
    var require_parse_int2 = __commonJS({
        "node_modules/core-js/stable/number/parse-int.js": function (exports, module) {
            "use strict";
            var parent = require_parse_int();
            module.exports = parent;
        }
    });
    // node_modules/core-js/actual/number/parse-int.js
    var require_parse_int3 = __commonJS({
        "node_modules/core-js/actual/number/parse-int.js": function (exports, module) {
            "use strict";
            var parent = require_parse_int2();
            module.exports = parent;
        }
    });
    // node_modules/core-js/modules/es.math.imul.js
    var require_es_math_imul = __commonJS({
        "node_modules/core-js/modules/es.math.imul.js": function () {
            "use strict";
            var $ = require_export();
            var fails = require_fails();
            var $imul = Math.imul;
            var FORCED = fails(function () {
                return $imul(4294967295, 5) !== -5 || $imul.length !== 2;
            });
            $({ target: "Math", stat: true, forced: FORCED }, {
                imul: function imul(x, y) {
                    var UINT16 = 65535;
                    var xn = +x;
                    var yn = +y;
                    var xl = UINT16 & xn;
                    var yl = UINT16 & yn;
                    return 0 | xl * yl + ((UINT16 & xn >>> 16) * yl + xl * (UINT16 & yn >>> 16) << 16 >>> 0);
                }
            });
        }
    });
    // node_modules/core-js/es/math/imul.js
    var require_imul = __commonJS({
        "node_modules/core-js/es/math/imul.js": function (exports, module) {
            "use strict";
            require_es_math_imul();
            var path = require_path();
            module.exports = path.Math.imul;
        }
    });
    // node_modules/core-js/stable/math/imul.js
    var require_imul2 = __commonJS({
        "node_modules/core-js/stable/math/imul.js": function (exports, module) {
            "use strict";
            var parent = require_imul();
            module.exports = parent;
        }
    });
    // node_modules/core-js/actual/math/imul.js
    var require_imul3 = __commonJS({
        "node_modules/core-js/actual/math/imul.js": function (exports, module) {
            "use strict";
            var parent = require_imul2();
            module.exports = parent;
        }
    });
    // office-addin/src/polyfills.ts
    var import_promise = __toESM(require_promise3(), 1);
    var import_map = __toESM(require_map3(), 1);
    var import_set = __toESM(require_set3(), 1);
    var import_symbol = __toESM(require_symbol3(), 1);
    var import_from = __toESM(require_from3(), 1);
    var import_find = __toESM(require_find3(), 1);
    var import_find_index = __toESM(require_find_index3(), 1);
    var import_includes = __toESM(require_includes3(), 1);
    var import_iterator = __toESM(require_iterator3(), 1);
    var import_flat_map = __toESM(require_flat_map3(), 1);
    var import_assign = __toESM(require_assign3(), 1);
    var import_entries = __toESM(require_entries3(), 1);
    var import_values = __toESM(require_values3(), 1);
    var import_includes2 = __toESM(require_includes6(), 1);
    var import_starts_with = __toESM(require_starts_with3(), 1);
    var import_ends_with = __toESM(require_ends_with3(), 1);
    var import_pad_end = __toESM(require_pad_end3(), 1);
    var import_pad_start = __toESM(require_pad_start3(), 1);
    var import_repeat = __toESM(require_repeat3(), 1);
    var import_trim_end = __toESM(require_trim_end3(), 1);
    var import_is_finite = __toESM(require_is_finite3(), 1);
    var import_is_integer = __toESM(require_is_integer3(), 1);
    var import_parse_int = __toESM(require_parse_int3(), 1);
    var import_imul = __toESM(require_imul3(), 1);
    // src/shared/citation/text.ts
    function trimTrailingPeriod(value) {
        return value.replace(/[.。]+$/, "");
    }
    function cleanPart(value) {
        if (typeof value === "number" && Number.isFinite(value))
            return trimTrailingPeriod(String(value));
        return trimTrailingPeriod(typeof value === "string" ? value.trim() : "");
    }
    var CJK_PATTERN = /[\u3000-\u9fff\uf900-\ufaff]/;
    function isCjkText(value) {
        return CJK_PATTERN.test(value);
    }
    function isCjkName(value) {
        return !/\s/.test(value) && isCjkText(value);
    }
    function initialsWithDots(given) {
        return given.split(/\s+/).filter(Boolean).map(function (token) { return "".concat(token[0].toUpperCase(), "."); }).join(" ");
    }
    function initialsCompact(given) {
        return given.split(/\s+/).filter(Boolean).map(function (token) { return token[0].toUpperCase(); }).join(" ");
    }
    function joinParts(parts, separator) {
        if (separator === void 0) { separator = ", "; }
        return parts.filter(function (part) { return Boolean(part); }).join(separator);
    }
    // src/shared/citation/styles.ts
    var CITATION_STYLE_IDS = ["gbt7714", "gbt7714-87", "gbt7714-author-date", "apa7", "ieee"];
    var DEFAULT_CITATION_STYLE = "gbt7714";
    var CITATION_STYLES = [
        {
            id: "gbt7714",
            label: "GB/T 7714-2015 顺序编码制",
            labelEn: "GB/T 7714-2015 (numeric)",
            kind: "numeric",
            description: "中文写作默认：正文 [1]，文献表按引用顺序编号；同一文献始终同号。"
        },
        {
            id: "gbt7714-87",
            label: "GB 7714-87 顺序编码制（CAJ-CD）",
            labelEn: "GB 7714-87 (numeric, CAJ-CD)",
            kind: "numeric",
            description: "1987 版国标与 CAJ-CD B/T-1998 规范：西文作者姓全大写、名缩写不加缩写点；论文集析出用 [A]…[C]；出版信息用全角标点。"
        },
        {
            id: "gbt7714-author-date",
            label: "GB/T 7714-2015 著者-出版年制",
            labelEn: "GB/T 7714-2015 (author-date)",
            kind: "author-date",
            description: "正文 (张三, 2021)，文献表按作者字母序排列。"
        },
        {
            id: "apa7",
            label: "APA 7",
            labelEn: "APA 7th edition",
            kind: "author-date",
            description: "正文 (Smith et al., 2020)，文献表按作者字母序排列。"
        },
        {
            id: "ieee",
            label: "IEEE",
            labelEn: "IEEE",
            kind: "numeric",
            description: "正文 [1]，文献表按引用顺序编号（IEEE 风格条目）。"
        }
    ];
    function isCitationStyleId(value) {
        return typeof value === "string" && CITATION_STYLE_IDS.includes(value);
    }
    function normalizeCitationStyle(value) {
        return isCitationStyleId(value) ? value : DEFAULT_CITATION_STYLE;
    }
    function getCitationStyle(value) {
        var _a;
        var id = normalizeCitationStyle(value);
        return (_a = CITATION_STYLES.find(function (style) { return style.id === id; })) != null ? _a : CITATION_STYLES[0];
    }
    function citationStyleKind(value) {
        return getCitationStyle(value).kind;
    }
    // src/shared/citation/numbering.ts
    function trimAffix(value) {
        return typeof value === "string" ? value.trim() : "";
    }
    function normalizeCitationItem(value) {
        if (!value || typeof value !== "object")
            return null;
        var record = value;
        var paperId = cleanPart(record.paperId);
        if (!paperId)
            return null;
        return {
            paperId: paperId,
            label: cleanPart(record.label) || null,
            locator: cleanPart(record.locator) || null,
            prefix: trimAffix(record.prefix) || null,
            suffix: trimAffix(record.suffix) || null,
            suppressAuthor: Boolean(record.suppressAuthor)
        };
    }
    function normalizeCitationItems(value) {
        var e_3, _g;
        if (!Array.isArray(value))
            return [];
        var items = [];
        try {
            for (var value_1 = __values(value), value_1_1 = value_1.next(); !value_1_1.done; value_1_1 = value_1.next()) {
                var raw = value_1_1.value;
                var item = normalizeCitationItem(raw);
                if (item)
                    items.push(item);
            }
        }
        catch (e_3_1) { e_3 = { error: e_3_1 }; }
        finally {
            try {
                if (value_1_1 && !value_1_1.done && (_g = value_1.return)) _g.call(value_1);
            }
            finally { if (e_3) throw e_3.error; }
        }
        return items;
    }
    function assignCitationNumbers(items) {
        var e_4, _g;
        var numbers = /* @__PURE__ */ new Map();
        try {
            for (var items_1 = __values(items), items_1_1 = items_1.next(); !items_1_1.done; items_1_1 = items_1.next()) {
                var item = items_1_1.value;
                if (!numbers.has(item.paperId))
                    numbers.set(item.paperId, numbers.size + 1);
            }
        }
        catch (e_4_1) { e_4 = { error: e_4_1 }; }
        finally {
            try {
                if (items_1_1 && !items_1_1.done && (_g = items_1.return)) _g.call(items_1);
            }
            finally { if (e_4) throw e_4.error; }
        }
        return numbers;
    }
    // src/shared/citation/documentTags.ts
    var CITATION_CONTROL_TAG_PREFIX = "pq:c|";
    var BIBLIOGRAPHY_CONTROL_TAG = "pq:bib";
    var CITATION_CONTROL_TITLE = "PaperQuay 引用";
    var BIBLIOGRAPHY_CONTROL_TITLE = "PaperQuay 参考文献";
    function createCitationId(random) {
        if (random === void 0) { random = Math.random; }
        return random().toString(16).slice(2, 10).padEnd(8, "0").slice(0, 8);
    }
    function encodeCitationControlTag(citeId) {
        return "".concat(CITATION_CONTROL_TAG_PREFIX).concat(cleanPart(citeId));
    }
    function parseCitationControlTag(tag) {
        var value = typeof tag === "string" ? tag.trim() : "";
        if (!value.startsWith(CITATION_CONTROL_TAG_PREFIX))
            return null;
        var citeId = value.slice(CITATION_CONTROL_TAG_PREFIX.length).trim();
        return /^[0-9a-z]{4,32}$/i.test(citeId) ? citeId : null;
    }
    function isBibliographyControlTag(tag) {
        return typeof tag === "string" && tag.trim() === BIBLIOGRAPHY_CONTROL_TAG;
    }
    function normalizeStoredCitations(value) {
        var e_5, _g;
        var parsed = value;
        if (typeof value === "string") {
            try {
                parsed = JSON.parse(value);
            }
            catch (e) {
                return [];
            }
        }
        if (!Array.isArray(parsed))
            return [];
        var citations = [];
        try {
            for (var parsed_1 = __values(parsed), parsed_1_1 = parsed_1.next(); !parsed_1_1.done; parsed_1_1 = parsed_1.next()) {
                var raw = parsed_1_1.value;
                if (!raw || typeof raw !== "object")
                    continue;
                var record = raw;
                var citeId = cleanPart(record.citeId).toLowerCase();
                if (!/^[0-9a-z]{4,32}$/.test(citeId))
                    continue;
                var items = normalizeCitationItems(record.items);
                if (items.length === 0)
                    continue;
                citations.push({
                    citeId: citeId,
                    items: items,
                    updatedAt: Number(record.updatedAt) || 0
                });
            }
        }
        catch (e_5_1) { e_5 = { error: e_5_1 }; }
        finally {
            try {
                if (parsed_1_1 && !parsed_1_1.done && (_g = parsed_1.return)) _g.call(parsed_1);
            }
            finally { if (e_5) throw e_5.error; }
        }
        return citations;
    }
    // src/shared/citation/format.ts
    function deriveNameParts(raw) {
        if (!raw)
            return { family: "", given: "" };
        if (isCjkName(raw))
            return { family: raw, given: "" };
        if (raw.includes(",")) {
            var _g = __read(raw.split(",").map(function (part) { return part.trim(); }).filter(Boolean)), family = _g[0], rest = _g.slice(1);
            return { family: family != null ? family : "", given: rest.join(" ") };
        }
        var tokens = raw.split(/\s+/).filter(Boolean);
        if (tokens.length === 1)
            return { family: tokens[0], given: "" };
        return { family: tokens[tokens.length - 1], given: tokens.slice(0, -1).join(" ") };
    }
    function toAuthorParts(author) {
        var record = typeof author === "string" ? { name: author } : author != null ? author : {};
        var family = cleanPart(record.familyName);
        var given = cleanPart(record.givenName);
        var raw = cleanPart(record.name) || joinParts([given, family], " ");
        var structured = Boolean(family || given);
        var derived = structured ? { family: family || raw, given: given } : deriveNameParts(raw);
        return {
            name: raw || derived.family,
            family: derived.family,
            given: derived.given,
            structured: structured,
            cjk: isCjkName(derived.family || raw)
        };
    }
    function paperAuthorParts(paper) {
        var _a;
        return ((_a = paper == null ? void 0 : paper.authors) != null ? _a : []).map(function (author) { return toAuthorParts(author); }).filter(function (parts) { return Boolean(parts.name || parts.family); });
    }
    function gbtAuthorName(parts) {
        if (!parts.structured || parts.cjk)
            return parts.name;
        var initials = initialsCompact(parts.given);
        return initials ? "".concat(parts.family, " ").concat(initials) : parts.family;
    }
    function apaAuthorName(parts) {
        if (parts.cjk)
            return parts.name;
        if (!parts.family)
            return parts.name;
        var initials = initialsWithDots(parts.given);
        return initials ? "".concat(parts.family, ", ").concat(initials) : parts.family;
    }
    function ieeeAuthorName(parts) {
        if (parts.cjk)
            return parts.name;
        if (!parts.family)
            return parts.name;
        var initials = initialsWithDots(parts.given);
        return initials ? "".concat(initials, " ").concat(parts.family) : parts.family;
    }
    function formatAuthorsGbt(parts) {
        if (parts.length === 0)
            return "";
        var shown = parts.slice(0, 3).map(gbtAuthorName);
        var suffix = parts.length > 3 ? parts[0].cjk ? ", 等" : ", et al." : "";
        return "".concat(shown.join(", ")).concat(suffix);
    }
    function formatAuthorsApa(parts) {
        if (parts.length === 0)
            return "";
        var shown = parts.slice(0, 3).map(apaAuthorName);
        if (parts.length > 3)
            return "".concat(shown.join(", "), ", et al.");
        if (shown.length === 1)
            return shown[0];
        return "".concat(shown.slice(0, -1).join(", "), ", & ").concat(shown[shown.length - 1]);
    }
    function formatAuthorsIeee(parts) {
        if (parts.length === 0)
            return "";
        var shown = parts.slice(0, 3).map(ieeeAuthorName);
        if (parts.length > 3)
            return "".concat(shown.join(", "), ", et al.");
        if (shown.length === 1)
            return shown[0];
        return "".concat(shown.slice(0, -1).join(", "), ", and ").concat(shown[shown.length - 1]);
    }
    function gbtDocumentMark(paper) {
        switch (paper == null ? void 0 : paper.itemType) {
            case "journalArticle":
                return "J";
            case "conferencePaper":
                return "C";
            case "book":
            case "bookSection":
                return "M";
            case "thesis":
                return "D";
            case "report":
                return "R";
            case "preprint":
                return "EB/OL";
            default:
                return (paper == null ? void 0 : paper.publication) ? "J" : "EB/OL";
        }
    }
    function gbt87DocumentMark(paper) {
        switch (paper == null ? void 0 : paper.itemType) {
            case "journalArticle":
                return "J";
            case "conferencePaper":
                return "A";
            case "book":
            case "bookSection":
                return "M";
            case "thesis":
                return "D";
            case "report":
                return "R";
            case "patent":
                return "P";
            case "preprint":
            case "webpage":
                return "EB/OL";
            default:
                return (paper == null ? void 0 : paper.publication) ? "J" : "EB/OL";
        }
    }
    function gbt87AuthorName(parts) {
        if (!parts.structured || parts.cjk)
            return parts.name;
        var family = parts.family.toUpperCase();
        var initials = initialsCompact(parts.given);
        return initials ? "".concat(family, " ").concat(initials) : family;
    }
    function formatAuthorsGbt87(parts, options) {
        if (options === void 0) { options = {}; }
        if (parts.length === 0)
            return "";
        var comma = options.punctuation === "half" ? ", " : "，";
        var shown = parts.slice(0, 3).map(gbt87AuthorName);
        var suffix = parts.length > 3 ? parts[0].cjk ? "".concat(comma, "\u7B49") : "".concat(comma, "et al") : "";
        return "".concat(shown.join(comma)).concat(suffix);
    }
    function normalizeGbt87Punctuation(value) {
        return value === "half" ? "half" : "full";
    }
    function formatGbt87Entry(paper, fallbackLabel, options) {
        if (options === void 0) { options = {}; }
        var half = options.punctuation === "half";
        var dot = half ? ". " : ".";
        var comma = half ? ", " : "，";
        var colon = half ? ": " : "：";
        var wrapIssue = function (text) { return half ? "(".concat(text, ")") : "\uFF08".concat(text, "\uFF09"); };
        var title = cleanPart(paper == null ? void 0 : paper.title) || cleanPart(fallbackLabel);
        var mark = gbt87DocumentMark(paper);
        var authors = formatAuthorsGbt87(paperAuthorParts(paper), options);
        var year = cleanPart(paper == null ? void 0 : paper.year);
        var publication = cleanPart(paper == null ? void 0 : paper.publication);
        var volume = cleanPart(paper == null ? void 0 : paper.volume);
        var issue = cleanPart(paper == null ? void 0 : paper.issue);
        var pages = cleanPart(paper == null ? void 0 : paper.pages);
        var publisher = cleanPart(paper == null ? void 0 : paper.publisher);
        var publisherPlace = cleanPart(paper == null ? void 0 : paper.publisherPlace);
        var institution = cleanPart(paper == null ? void 0 : paper.institution);
        var url = cleanPart(paper == null ? void 0 : paper.url);
        var volumeIssue = issue ? "".concat(volume).concat(wrapIssue(issue)) : volume;
        var placeAndPublisher = joinParts([publisherPlace, publisher], colon);
        var entry = authors ? "".concat(trimTrailingPeriod(authors), ".").concat(half ? " " : "").concat(title) : title;
        if (mark === "A") {
            entry += "[A]";
            if (publication)
                entry += "".concat(dot).concat(publication, "[C]");
            var tail = joinParts([placeAndPublisher, year], comma);
            if (tail)
                entry += "".concat(dot).concat(tail);
            if (pages)
                entry += "".concat(colon).concat(pages);
        }
        else if (mark === "M" || mark === "R") {
            entry += "[".concat(mark, "]");
            var tail = joinParts([placeAndPublisher, year], comma);
            if (tail)
                entry += "".concat(dot).concat(tail);
            if (pages)
                entry += "".concat(colon).concat(pages);
        }
        else if (mark === "D") {
            entry += "[D]";
            var holder = institution || publisher;
            var tail = joinParts([joinParts([publisherPlace, holder], colon), year], comma);
            if (tail)
                entry += "".concat(dot).concat(tail);
            if (pages)
                entry += "".concat(colon).concat(pages);
        }
        else if (mark === "P") {
            entry += "[P]";
            if (year)
                entry += "".concat(dot).concat(year);
        }
        else if (mark === "EB/OL") {
            entry += "[EB/OL]";
            var source = placeAndPublisher || publication;
            var tail = joinParts([source, year], comma);
            if (tail)
                entry += "".concat(dot).concat(tail);
            if (url)
                entry += "".concat(dot).concat(url);
        }
        else {
            entry += "[J]";
            var tail = joinParts([publication, year, volumeIssue], comma);
            if (tail)
                entry += "".concat(dot).concat(tail);
            if (pages)
                entry += "".concat(colon).concat(pages);
        }
        return "".concat(trimTrailingPeriod(entry), ".");
    }
    function formatGbtEntry(paper, fallbackLabel, options) {
        if (options === void 0) { options = {}; }
        var title = cleanPart(paper == null ? void 0 : paper.title) || cleanPart(fallbackLabel);
        var mark = gbtDocumentMark(paper);
        var authors = formatAuthorsGbt(paperAuthorParts(paper));
        var year = cleanPart(paper == null ? void 0 : paper.year);
        var publication = cleanPart(paper == null ? void 0 : paper.publication);
        var volume = cleanPart(paper == null ? void 0 : paper.volume);
        var issue = cleanPart(paper == null ? void 0 : paper.issue);
        var pages = cleanPart(paper == null ? void 0 : paper.pages);
        var publisher = cleanPart(paper == null ? void 0 : paper.publisher);
        var publisherPlace = cleanPart(paper == null ? void 0 : paper.publisherPlace);
        var institution = cleanPart(paper == null ? void 0 : paper.institution);
        var doi = cleanPart(paper == null ? void 0 : paper.doi);
        var volumeIssue = issue ? "".concat(volume, "(").concat(issue, ")") : volume;
        var placeAndPublisher = joinParts([publisherPlace, publisher], ": ");
        var yearPrefix = options.authorDate && year ? "".concat(year, ". ") : "";
        var tailYear = options.authorDate ? "" : year;
        var entry = authors ? "".concat(trimTrailingPeriod(authors), ". ").concat(yearPrefix).concat(title) : title;
        entry += "[".concat(mark, "]");
        if (mark === "M") {
            var tail = joinParts([placeAndPublisher, tailYear]);
            if (tail)
                entry += ". ".concat(tail);
            if (pages)
                entry += ": ".concat(pages);
        }
        else if (mark === "D") {
            var holder = publisher || institution;
            var tail = joinParts([joinParts([publisherPlace, holder], ": "), tailYear]);
            if (tail)
                entry += ". ".concat(tail);
            if (pages)
                entry += ": ".concat(pages);
        }
        else if (mark === "EB/OL") {
            var source = publication || publisher;
            var tail = joinParts([source, tailYear]);
            if (tail)
                entry += ". ".concat(tail);
        }
        else if (mark === "C") {
            if (publication)
                entry += "//".concat(publication);
            var tail = joinParts([tailYear, volumeIssue]);
            if (tail)
                entry += ". ".concat(tail);
            if (placeAndPublisher)
                entry += ". ".concat(placeAndPublisher);
            if (pages)
                entry += ": ".concat(pages);
        }
        else {
            var tail = joinParts([publication, tailYear, volumeIssue]);
            if (tail)
                entry += ". ".concat(tail);
            if (pages)
                entry += ": ".concat(pages);
        }
        if (doi)
            entry += ". DOI: ".concat(doi);
        return "".concat(trimTrailingPeriod(entry), ".");
    }
    function formatApa7(paper, fallbackLabel) {
        var title = cleanPart(paper == null ? void 0 : paper.title) || cleanPart(fallbackLabel);
        var authors = formatAuthorsApa(paperAuthorParts(paper));
        var year = cleanPart(paper == null ? void 0 : paper.year);
        var publication = cleanPart(paper == null ? void 0 : paper.publication);
        var volume = cleanPart(paper == null ? void 0 : paper.volume);
        var issue = cleanPart(paper == null ? void 0 : paper.issue);
        var pages = cleanPart(paper == null ? void 0 : paper.pages);
        var doi = cleanPart(paper == null ? void 0 : paper.doi);
        var url = cleanPart(paper == null ? void 0 : paper.url);
        var entry = authors ? "".concat(authors, " ") : "";
        entry += year ? "(".concat(year, "). ") : "(n.d.). ";
        entry += "".concat(title, ".");
        if (publication) {
            entry += " ".concat(publication);
            if (volume)
                entry += ", ".concat(volume).concat(issue ? "(".concat(issue, ")") : "");
            if (pages)
                entry += ", ".concat(pages);
            entry += ".";
        }
        if (doi)
            entry += " https://doi.org/".concat(doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""));
        else if (url)
            entry += " ".concat(url);
        return entry;
    }
    function formatIeee(paper, fallbackLabel) {
        var title = cleanPart(paper == null ? void 0 : paper.title) || cleanPart(fallbackLabel);
        var authors = formatAuthorsIeee(paperAuthorParts(paper));
        var year = cleanPart(paper == null ? void 0 : paper.year);
        var publication = cleanPart(paper == null ? void 0 : paper.publication);
        var volume = cleanPart(paper == null ? void 0 : paper.volume);
        var issue = cleanPart(paper == null ? void 0 : paper.issue);
        var pages = cleanPart(paper == null ? void 0 : paper.pages);
        var doi = cleanPart(paper == null ? void 0 : paper.doi);
        var entry = authors ? "".concat(authors, ", ") : "";
        entry += "\"".concat(title, ",\"");
        if (publication)
            entry += " ".concat(publication, ",");
        if (volume)
            entry += " vol. ".concat(volume, ",");
        if (issue)
            entry += " no. ".concat(issue, ",");
        if (pages)
            entry += " pp. ".concat(pages, ",");
        if (year)
            entry += " ".concat(year, ".");
        if (doi)
            entry += " doi: ".concat(doi, ".");
        return entry;
    }
    function formatBibliographyEntry(paper, fallbackLabel, style, options) {
        if (options === void 0) { options = {}; }
        if (!paper && fallbackLabel)
            return "".concat(trimTrailingPeriod(fallbackLabel), ".");
        switch (style) {
            case "apa7":
                return formatApa7(paper, fallbackLabel);
            case "ieee":
                return formatIeee(paper, fallbackLabel);
            case "gbt7714-87":
                return formatGbt87Entry(paper, fallbackLabel, options);
            case "gbt7714-author-date":
                return formatGbtEntry(paper, fallbackLabel, { authorDate: true });
            default:
                return formatGbtEntry(paper, fallbackLabel);
        }
    }
    function authorDateLabel(parts, style, fallbackLabel) {
        if (parts.length === 0)
            return fallbackLabel;
        var surname = function (item) { return item.cjk ? item.name : item.family || item.name; };
        if (parts.length === 1)
            return surname(parts[0]);
        if (parts.length === 2)
            return "".concat(surname(parts[0]), " & ").concat(surname(parts[1]));
        var useChineseSuffix = style === "gbt7714-author-date" && parts[0].cjk;
        return "".concat(surname(parts[0])).concat(useChineseSuffix ? " 等" : " et al.");
    }
    function segmentsToText(segments) {
        return segments.map(function (segment) { return segment.text; }).join("");
    }
    function wrapAffixSegments(core, prefix, suffix) {
        var head = typeof prefix === "string" ? prefix.trim() : "";
        var tail = typeof suffix === "string" ? suffix.trim() : "";
        var result = __spreadArray([], __read(core), false);
        if (head)
            result.unshift({ text: /[(（[]$/.test(head) ? head : "".concat(head, " ") });
        if (tail)
            result.push({ text: /^[,.;:，。；：)\]）]/.test(tail) ? tail : " ".concat(tail) });
        return result;
    }
    function numberRanges(numbers) {
        var e_6, _g;
        var sorted = __spreadArray([], __read(new Set(numbers.filter(function (value) { return Number.isFinite(value) && value > 0; }))), false).sort(function (left, right) { return left - right; });
        var ranges = [];
        try {
            for (var sorted_1 = __values(sorted), sorted_1_1 = sorted_1.next(); !sorted_1_1.done; sorted_1_1 = sorted_1.next()) {
                var current = sorted_1_1.value;
                var last = ranges[ranges.length - 1];
                if (last && current === last[1] + 1)
                    last[1] = current;
                else
                    ranges.push([current, current]);
            }
        }
        catch (e_6_1) { e_6 = { error: e_6_1 }; }
        finally {
            try {
                if (sorted_1_1 && !sorted_1_1.done && (_g = sorted_1.return)) _g.call(sorted_1);
            }
            finally { if (e_6) throw e_6.error; }
        }
        return ranges;
    }
    function formatNumericSegments(items, seqs) {
        var _a, _b, _c, _d;
        var paperIdBySeq = /* @__PURE__ */ new Map();
        items.forEach(function (item, index) {
            var _a2;
            var seq = (_a2 = seqs[index]) != null ? _a2 : 0;
            if (seq > 0 && !paperIdBySeq.has(seq))
                paperIdBySeq.set(seq, item.paperId);
        });
        var ranges = numberRanges(seqs);
        if (ranges.length === 0)
            return [];
        var core = [{ text: "[" }];
        ranges.forEach(function (_g, index) {
            var _h = __read(_g, 2), start2 = _h[0], end = _h[1];
            if (index > 0)
                core.push({ text: "," });
            core.push({ text: "".concat(start2), paperId: paperIdBySeq.get(start2) });
            if (end > start2) {
                core.push({ text: "-" });
                core.push({ text: "".concat(end), paperId: paperIdBySeq.get(end) });
            }
        });
        core.push({ text: "]" });
        if (items.length === 1) {
            var locator = cleanPart(items[0].locator);
            if (locator)
                core.push({ text: locator });
        }
        return wrapAffixSegments(core, (_b = (_a = items[0]) == null ? void 0 : _a.prefix) != null ? _b : null, (_d = (_c = items[items.length - 1]) == null ? void 0 : _c.suffix) != null ? _d : null);
    }
    function formatAuthorDateSegments(items, style, resolvePaper) {
        var _a, _b, _c, _d;
        var core = [{ text: "(" }];
        items.forEach(function (item, index) {
            if (index > 0)
                core.push({ text: "; " });
            var paper = resolvePaper(item.paperId);
            var year = cleanPart(paper == null ? void 0 : paper.year) || "n.d.";
            var locator = cleanPart(item.locator);
            var locatorText = locator ? ", ".concat(locator) : "";
            var text = item.suppressAuthor ? "".concat(year).concat(locatorText) : "".concat(authorDateLabel(paperAuthorParts(paper), style, cleanPart(item.label) || item.paperId), ", ").concat(year).concat(locatorText);
            core.push({ text: text, paperId: item.paperId });
        });
        core.push({ text: ")" });
        return wrapAffixSegments(core, (_b = (_a = items[0]) == null ? void 0 : _a.prefix) != null ? _b : null, (_d = (_c = items[items.length - 1]) == null ? void 0 : _c.suffix) != null ? _d : null);
    }
    function normalizeRenderGroups(request) {
        var rawGroups = Array.isArray(request == null ? void 0 : request.groups) ? request.groups : null;
        if (rawGroups && rawGroups.length > 0) {
            return rawGroups.map(function (group) {
                var record = group != null ? group : {};
                return {
                    citeId: cleanPart(record.citeId) || null,
                    items: normalizeCitationItems(record.items)
                };
            }).filter(function (group) { return group.items.length > 0; });
        }
        var items = normalizeCitationItems(request == null ? void 0 : request.items);
        return items.length > 0 ? [{ citeId: null, items: items }] : [];
    }
    function formatBibliographyLines(kind, entries) {
        return entries.map(function (entry) { return kind === "numeric" ? "[".concat(entry.seq, "] ").concat(entry.text) : entry.text; });
    }
    function renderCitations(request, resolvePaper) {
        var e_7, _g;
        var _a, _b;
        var groups = normalizeRenderGroups(request != null ? request : {});
        var style = normalizeCitationStyle(request == null ? void 0 : request.style);
        var kind = citationStyleKind(style);
        var flatItems = groups.flatMap(function (group) { return group.items; });
        var seqByPaperId = assignCitationNumbers(flatItems);
        var cache = /* @__PURE__ */ new Map();
        var missing = /* @__PURE__ */ new Set();
        var lookup = function (paperId) {
            if (!cache.has(paperId)) {
                var paper = resolvePaper(paperId);
                cache.set(paperId, paper);
                if (!paper)
                    missing.add(paperId);
            }
            return cache.get(paperId);
        };
        var renderedGroups = groups.map(function (group) {
            var _a2;
            var seqs = group.items.map(function (item) {
                var _a3;
                return (_a3 = seqByPaperId.get(item.paperId)) != null ? _a3 : 0;
            });
            var segments = kind === "numeric" ? formatNumericSegments(group.items, seqs) : formatAuthorDateSegments(group.items, style, lookup);
            return {
                citeId: (_a2 = group.citeId) != null ? _a2 : null,
                inline: segmentsToText(segments),
                segments: segments
            };
        });
        var labelByPaperId = /* @__PURE__ */ new Map();
        try {
            for (var flatItems_1 = __values(flatItems), flatItems_1_1 = flatItems_1.next(); !flatItems_1_1.done; flatItems_1_1 = flatItems_1.next()) {
                var item = flatItems_1_1.value;
                if (!labelByPaperId.has(item.paperId))
                    labelByPaperId.set(item.paperId, cleanPart(item.label));
            }
        }
        catch (e_7_1) { e_7 = { error: e_7_1 }; }
        finally {
            try {
                if (flatItems_1_1 && !flatItems_1_1.done && (_g = flatItems_1.return)) _g.call(flatItems_1);
            }
            finally { if (e_7) throw e_7.error; }
        }
        var orderedPaperIds = __spreadArray([], __read(seqByPaperId.keys()), false);
        if (kind === "author-date" && (request == null ? void 0 : request.bibliographyOrder) !== "appearance") {
            orderedPaperIds = orderedPaperIds.slice().sort(function (left, right) {
                var _a2, _b2, _c, _d, _e, _f;
                var leftParts = paperAuthorParts(lookup(left));
                var rightParts = paperAuthorParts(lookup(right));
                var leftKey = ((_a2 = leftParts[0]) == null ? void 0 : _a2.family) || ((_b2 = leftParts[0]) == null ? void 0 : _b2.name) || labelByPaperId.get(left) || left;
                var rightKey = ((_c = rightParts[0]) == null ? void 0 : _c.family) || ((_d = rightParts[0]) == null ? void 0 : _d.name) || labelByPaperId.get(right) || right;
                var byAuthor = leftKey.localeCompare(rightKey);
                if (byAuthor !== 0)
                    return byAuthor;
                var byYear = (cleanPart((_e = lookup(left)) == null ? void 0 : _e.year) || "").localeCompare(cleanPart((_f = lookup(right)) == null ? void 0 : _f.year) || "");
                if (byYear !== 0)
                    return byYear;
                return left.localeCompare(right);
            });
        }
        var entries = orderedPaperIds.map(function (paperId, index) {
            var _a2;
            var text = formatBibliographyEntry(lookup(paperId), labelByPaperId.get(paperId) || paperId, style, { punctuation: normalizeGbt87Punctuation(request == null ? void 0 : request.punctuation) });
            return {
                paperId: paperId,
                seq: kind === "numeric" ? (_a2 = seqByPaperId.get(paperId)) != null ? _a2 : index + 1 : index + 1,
                text: text,
                missing: missing.has(paperId)
            };
        });
        return {
            style: style,
            kind: kind,
            inline: (_b = (_a = renderedGroups[0]) == null ? void 0 : _a.inline) != null ? _b : "",
            groups: renderedGroups,
            entries: entries,
            bibliography: formatBibliographyLines(kind, entries).join("\n"),
            bibliographyTitle: cleanPart(request == null ? void 0 : request.bibliographyTitle) || "参考文献",
            missingPaperIds: __spreadArray([], __read(missing), false)
        };
    }
    // src/shared/citation/wordOoxml.ts
    var BIBLIOGRAPHY_PARAGRAPH_STYLE_ID = "PaperQuayBibliography";
    var BIBLIOGRAPHY_PARAGRAPH_STYLE_NAME = "PaperQuay 参考文献";
    var BOOKMARK_PREFIX = "_PQ_";
    var BOOKMARK_MAX_LENGTH = 40;
    var W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    var R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    function escapeXmlText(value) {
        return String(value != null ? value : "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
    }
    function fnv1aBase36(value) {
        var hash = 2166136261;
        for (var index = 0; index < value.length; index += 1) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619) >>> 0;
        }
        return hash.toString(36);
    }
    function bookmarkNameFor(paperId, taken) {
        var base = "".concat(BOOKMARK_PREFIX).concat(fnv1aBase36(cleanPart(paperId) || "x"));
        var candidate = base;
        var counter = 2;
        while (taken.has(candidate)) {
            candidate = "".concat(base, "_").concat(counter).slice(0, BOOKMARK_MAX_LENGTH);
            counter += 1;
        }
        taken.add(candidate);
        return candidate;
    }
    function assignBookmarkNames(paperIds) {
        var e_8, _g;
        var taken = /* @__PURE__ */ new Set();
        var names = /* @__PURE__ */ new Map();
        try {
            for (var paperIds_1 = __values(paperIds), paperIds_1_1 = paperIds_1.next(); !paperIds_1_1.done; paperIds_1_1 = paperIds_1.next()) {
                var paperId = paperIds_1_1.value;
                if (!names.has(paperId))
                    names.set(paperId, bookmarkNameFor(paperId, taken));
            }
        }
        catch (e_8_1) { e_8 = { error: e_8_1 }; }
        finally {
            try {
                if (paperIds_1_1 && !paperIds_1_1.done && (_g = paperIds_1.return)) _g.call(paperIds_1);
            }
            finally { if (e_8) throw e_8.error; }
        }
        return names;
    }
    function runProperties(options) {
        var parts = [];
        if (options.plainLink)
            parts.push('<w:color w:val="auto"/><w:u w:val="none"/>');
        if (options.superscript)
            parts.push('<w:vertAlign w:val="superscript"/>');
        return parts.length > 0 ? "<w:rPr>".concat(parts.join(""), "</w:rPr>") : "";
    }
    function textRun(text, options) {
        if (options === void 0) { options = {}; }
        if (!text)
            return "";
        return "<w:r>".concat(runProperties(options), "<w:t xml:space=\"preserve\">").concat(escapeXmlText(text), "</w:t></w:r>");
    }
    function buildInlineCitationRuns(segments, options) {
        if (options === void 0) { options = {}; }
        var superscript = Boolean(options.superscript);
        return segments.map(function (segment) {
            var _a;
            var anchor = segment.paperId ? (_a = options.bookmarks) == null ? void 0 : _a.get(segment.paperId) : void 0;
            if (!anchor)
                return textRun(segment.text, { superscript: superscript });
            return "<w:hyperlink w:anchor=\"".concat(escapeXmlText(anchor), "\" w:history=\"1\">") + textRun(segment.text, { superscript: superscript, plainLink: true }) + "</w:hyperlink>";
        }).join("");
    }
    function paragraph(inner, styleId) {
        var pPr = styleId ? "<w:pPr><w:pStyle w:val=\"".concat(styleId, "\"/></w:pPr>") : "";
        return "<w:p>".concat(pPr).concat(inner, "</w:p>");
    }
    function buildBibliographyParagraphs(entries, options) {
        var e_9, _g;
        var _a, _b, _c;
        var parts = [];
        if (options.heading)
            parts.push(paragraph(textRun(cleanPart(options.title))));
        var bookmarkId = (_a = options.bookmarkIdBase) != null ? _a : 1e3;
        try {
            for (var entries_1 = __values(entries), entries_1_1 = entries_1.next(); !entries_1_1.done; entries_1_1 = entries_1.next()) {
                var entry = entries_1_1.value;
                var label = options.kind === "numeric" ? "[".concat(entry.seq, "]") : "";
                var body = (label ? "".concat(textRun(label), "<w:r><w:tab/></w:r>") : "") + textRun(String((_b = entry.text) != null ? _b : "").trim());
                var name = (_c = options.bookmarks) == null ? void 0 : _c.get(entry.paperId);
                if (name) {
                    var id = bookmarkId;
                    bookmarkId += 1;
                    parts.push(paragraph("<w:bookmarkStart w:id=\"".concat(id, "\" w:name=\"").concat(escapeXmlText(name), "\"/>").concat(body, "<w:bookmarkEnd w:id=\"").concat(id, "\"/>"), BIBLIOGRAPHY_PARAGRAPH_STYLE_ID));
                }
                else {
                    parts.push(paragraph(body, BIBLIOGRAPHY_PARAGRAPH_STYLE_ID));
                }
            }
        }
        catch (e_9_1) { e_9 = { error: e_9_1 }; }
        finally {
            try {
                if (entries_1_1 && !entries_1_1.done && (_g = entries_1.return)) _g.call(entries_1);
            }
            finally { if (e_9) throw e_9.error; }
        }
        return parts.join("");
    }
    function stylesPart(kind) {
        var indent = kind === "numeric" ? '<w:ind w:left="425" w:hanging="425"/>' : '<w:ind w:left="420" w:hanging="420"/>';
        var tabs = kind === "numeric" ? '<w:tabs><w:tab w:val="left" w:pos="425"/></w:tabs>' : "";
        return "<w:styles xmlns:w=\"".concat(W_NS, "\"><w:style w:type=\"paragraph\" w:customStyle=\"1\" w:styleId=\"").concat(BIBLIOGRAPHY_PARAGRAPH_STYLE_ID, "\"><w:name w:val=\"").concat(BIBLIOGRAPHY_PARAGRAPH_STYLE_NAME, "\"/><w:basedOn w:val=\"Normal\"/><w:qFormat/><w:pPr>").concat(tabs).concat(indent, "</w:pPr></w:style></w:styles>");
    }
    function wrapPackage(bodyXml, withStyles) {
        if (withStyles === void 0) { withStyles = null; }
        var documentRels = withStyles ? "<pkg:part pkg:name=\"/word/_rels/document.xml.rels\" pkg:contentType=\"application/vnd.openxmlformats-package.relationships+xml\"><pkg:xmlData><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"".concat(R_NS, "/styles\" Target=\"styles.xml\"/></Relationships></pkg:xmlData></pkg:part>") : "";
        var styles = withStyles ? "<pkg:part pkg:name=\"/word/styles.xml\" pkg:contentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"><pkg:xmlData>".concat(stylesPart(withStyles), "</pkg:xmlData></pkg:part>") : "";
        return "<pkg:package xmlns:pkg=\"http://schemas.microsoft.com/office/2006/xmlPackage\"><pkg:part pkg:name=\"/_rels/.rels\" pkg:contentType=\"application/vnd.openxmlformats-package.relationships+xml\"><pkg:xmlData><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"".concat(R_NS, "/officeDocument\" Target=\"word/document.xml\"/></Relationships></pkg:xmlData></pkg:part>") + documentRels + "<pkg:part pkg:name=\"/word/document.xml\" pkg:contentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"><pkg:xmlData><w:document xmlns:w=\"".concat(W_NS, "\" xmlns:r=\"").concat(R_NS, "\"><w:body>").concat(bodyXml, "</w:body></w:document></pkg:xmlData></pkg:part>") + styles + "</pkg:package>";
    }
    function buildInlineCitationPackage(segments, options) {
        if (options === void 0) { options = {}; }
        return wrapPackage("<w:p>".concat(buildInlineCitationRuns(segments, options), "</w:p>"));
    }
    function buildBibliographyPackage(entries, options) {
        return wrapPackage(buildBibliographyParagraphs(entries, options), options.kind);
    }
    function bookmarkIdBase(random) {
        if (random === void 0) { random = Math.random; }
        return 1e5 + Math.floor(random() * 8e5);
    }
    // src/shared/citation/documentModel.ts
    var DOCUMENT_MODEL_NAMESPACE = "urn:paperquay:word:v2";
    var DOCUMENT_MODEL_SCHEMA_VERSION = 2;
    var SCHEMA_VERSION_SETTING_KEY = "pq:schemaVersion";
    var MODEL_FALLBACK_SETTING_KEY = "pq:model";
    var DEFAULT_PREFS = {
        style: "gbt7714",
        bibliographyTitle: "参考文献",
        bibHeading: true,
        superscript: false,
        punctuation: "full",
        links: true,
        bibliographyOrder: "alpha"
    };
    function createDocumentId(random) {
        if (random === void 0) { random = Math.random; }
        return "doc-".concat(random().toString(16).slice(2, 10)).concat(Date.now().toString(16));
    }
    function createEmptyModel(documentId) {
        if (documentId === void 0) { documentId = createDocumentId(); }
        return { schemaVersion: 2, documentId: documentId, rev: 0, prefs: __spreadValues({}, DEFAULT_PREFS), citations: [], items: {} };
    }
    function asRecord(value) {
        return value && typeof value === "object" ? value : {};
    }
    function normalizePrefs(value) {
        var record = asRecord(value);
        return {
            style: normalizeCitationStyle(record.style),
            bibliographyTitle: cleanPart(record.bibliographyTitle) || DEFAULT_PREFS.bibliographyTitle,
            bibHeading: record.bibHeading !== false,
            superscript: record.superscript === true,
            punctuation: record.punctuation === "half" ? "half" : "full",
            links: record.links !== false,
            bibliographyOrder: record.bibliographyOrder === "appearance" ? "appearance" : "alpha"
        };
    }
    var CITE_ID_PATTERN = /^[0-9a-z]{4,32}$/;
    function normalizeModel(value) {
        var e_10, _g, e_11, _h;
        var record = asRecord(value);
        var citations = [];
        var seen = /* @__PURE__ */ new Set();
        try {
            for (var _j = __values(Array.isArray(record.citations) ? record.citations : []), _k = _j.next(); !_k.done; _k = _j.next()) {
                var raw = _k.value;
                var entry = asRecord(raw);
                var citeId = cleanPart(entry.citeId).toLowerCase();
                if (!CITE_ID_PATTERN.test(citeId) || seen.has(citeId))
                    continue;
                var items2 = normalizeCitationItems(entry.items);
                if (items2.length === 0)
                    continue;
                seen.add(citeId);
                citations.push({
                    citeId: citeId,
                    items: items2,
                    lastText: typeof entry.lastText === "string" ? entry.lastText : void 0,
                    lastSignature: typeof entry.lastSignature === "string" ? entry.lastSignature : void 0,
                    manualText: typeof entry.manualText === "string" ? entry.manualText : void 0,
                    updatedAt: Number(entry.updatedAt) || 0
                });
            }
        }
        catch (e_10_1) { e_10 = { error: e_10_1 }; }
        finally {
            try {
                if (_k && !_k.done && (_g = _j.return)) _g.call(_j);
            }
            finally { if (e_10) throw e_10.error; }
        }
        var items = {};
        try {
            for (var _l = __values(Object.entries(asRecord(record.items))), _m = _l.next(); !_m.done; _m = _l.next()) {
                var _o = __read(_m.value, 2), paperId = _o[0], raw = _o[1];
                var snapshot = asRecord(raw);
                if (!paperId || !snapshot.paper || typeof snapshot.paper !== "object")
                    continue;
                items[paperId] = __spreadValues({
                    paper: snapshot.paper,
                    fetchedAt: Number(snapshot.fetchedAt) || 0
                }, snapshot.missing === true ? { missing: true } : {});
            }
        }
        catch (e_11_1) { e_11 = { error: e_11_1 }; }
        finally {
            try {
                if (_m && !_m.done && (_h = _l.return)) _h.call(_l);
            }
            finally { if (e_11) throw e_11.error; }
        }
        return {
            schemaVersion: 2,
            documentId: cleanPart(record.documentId) || createDocumentId(),
            rev: Math.max(0, Math.floor(Number(record.rev) || 0)),
            prefs: normalizePrefs(record.prefs),
            citations: citations,
            items: items
        };
    }
    function serializeModelXml(model) {
        var json = JSON.stringify(model).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?><pq:model xmlns:pq=\"".concat(DOCUMENT_MODEL_NAMESPACE, "\" rev=\"").concat(model.rev, "\"><![CDATA[").concat(json, "]]></pq:model>");
    }
    function parseModelXml(xml) {
        if (typeof xml !== "string" || !xml.includes(DOCUMENT_MODEL_NAMESPACE))
            return null;
        var match = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(xml);
        if (!match)
            return null;
        try {
            return normalizeModel(JSON.parse(match[1]));
        }
        catch (e) {
            return null;
        }
    }
    function pickLatestModel(xmls) {
        var best = null;
        var index = -1;
        xmls.forEach(function (xml, position) {
            var model = parseModelXml(xml);
            if (model && (!best || model.rev >= best.rev)) {
                best = model;
                index = position;
            }
        });
        return { model: best, index: index };
    }
    function migrateV1Settings(getSetting) {
        var model = createEmptyModel(cleanPart(getSetting("pq:documentId")) || createDocumentId());
        var stored = normalizeStoredCitations(getSetting("pq:citations"));
        model.citations = stored.map(function (citation) { return ({
            citeId: citation.citeId,
            items: citation.items,
            updatedAt: citation.updatedAt
        }); });
        var title = cleanPart(getSetting("pq:bibliographyTitle"));
        model.prefs = normalizePrefs({
            style: getSetting("pq:style"),
            bibliographyTitle: title || DEFAULT_PREFS.bibliographyTitle,
            bibHeading: getSetting("pq:bibHeading") !== "0",
            superscript: getSetting("pq:superscript") === "1",
            punctuation: getSetting("pq:punctuation"),
            links: getSetting("pq:crossref") !== "0"
        });
        return model;
    }
    var V1_SETTING_KEYS = [
        "pq:style",
        "pq:locale",
        "pq:citations",
        "pq:citedPaperIds",
        "pq:bibControlId",
        "pq:documentTitle",
        "pq:bibliographyTitle",
        "pq:bibHeading",
        "pq:superscript",
        "pq:punctuation",
        "pq:crossref"
    ];
    function findCitation(model, citeId) {
        return model.citations.find(function (citation) { return citation.citeId === citeId; });
    }
    function upsertCitation(model, citation) {
        var citations = model.citations.filter(function (item) { return item.citeId !== citation.citeId; });
        citations.push(citation);
        return __spreadProps(__spreadValues({}, model), { citations: citations });
    }
    function removeCitation(model, citeId) {
        return __spreadProps(__spreadValues({}, model), { citations: model.citations.filter(function (item) { return item.citeId !== citeId; }) });
    }
    function upsertSnapshots(model, papers, missingIds, now) {
        var e_12, _g, e_13, _h;
        if (missingIds === void 0) { missingIds = []; }
        if (now === void 0) { now = Date.now(); }
        var items = __spreadValues({}, model.items);
        try {
            for (var papers_1 = __values(papers), papers_1_1 = papers_1.next(); !papers_1_1.done; papers_1_1 = papers_1.next()) {
                var paper = papers_1_1.value;
                var paperId = cleanPart(paper == null ? void 0 : paper.id);
                if (paperId)
                    items[paperId] = { paper: paper, fetchedAt: now };
            }
        }
        catch (e_12_1) { e_12 = { error: e_12_1 }; }
        finally {
            try {
                if (papers_1_1 && !papers_1_1.done && (_g = papers_1.return)) _g.call(papers_1);
            }
            finally { if (e_12) throw e_12.error; }
        }
        try {
            for (var missingIds_1 = __values(missingIds), missingIds_1_1 = missingIds_1.next(); !missingIds_1_1.done; missingIds_1_1 = missingIds_1.next()) {
                var paperId = missingIds_1_1.value;
                var existing = items[paperId];
                if (existing)
                    items[paperId] = __spreadProps(__spreadValues({}, existing), { missing: true });
            }
        }
        catch (e_13_1) { e_13 = { error: e_13_1 }; }
        finally {
            try {
                if (missingIds_1_1 && !missingIds_1_1.done && (_h = missingIds_1.return)) _h.call(missingIds_1);
            }
            finally { if (e_13) throw e_13.error; }
        }
        return __spreadProps(__spreadValues({}, model), { items: items });
    }
    function citedPaperIds(model, orderedCiteIds) {
        var e_14, _g, e_15, _h;
        var _a, _b;
        var order = orderedCiteIds != null ? orderedCiteIds : model.citations.map(function (citation) { return citation.citeId; });
        var ids = [];
        try {
            for (var order_1 = __values(order), order_1_1 = order_1.next(); !order_1_1.done; order_1_1 = order_1.next()) {
                var citeId = order_1_1.value;
                try {
                    for (var _j = (e_15 = void 0, __values((_b = (_a = findCitation(model, citeId)) == null ? void 0 : _a.items) != null ? _b : [])), _k = _j.next(); !_k.done; _k = _j.next()) {
                        var item = _k.value;
                        if (!ids.includes(item.paperId))
                            ids.push(item.paperId);
                    }
                }
                catch (e_15_1) { e_15 = { error: e_15_1 }; }
                finally {
                    try {
                        if (_k && !_k.done && (_h = _j.return)) _h.call(_j);
                    }
                    finally { if (e_15) throw e_15.error; }
                }
            }
        }
        catch (e_14_1) { e_14 = { error: e_14_1 }; }
        finally {
            try {
                if (order_1_1 && !order_1_1.done && (_g = order_1.return)) _g.call(order_1);
            }
            finally { if (e_14) throw e_14.error; }
        }
        return ids;
    }
    function pruneModel(model, presentCiteIds) {
        var e_16, _g, e_17, _h, e_18, _j;
        var present = new Set(presentCiteIds);
        var citations = model.citations.filter(function (citation) { return present.has(citation.citeId); });
        var used = /* @__PURE__ */ new Set();
        try {
            for (var citations_1 = __values(citations), citations_1_1 = citations_1.next(); !citations_1_1.done; citations_1_1 = citations_1.next()) {
                var citation = citations_1_1.value;
                try {
                    for (var _k = (e_17 = void 0, __values(citation.items)), _l = _k.next(); !_l.done; _l = _k.next()) {
                        var item = _l.value;
                        used.add(item.paperId);
                    }
                }
                catch (e_17_1) { e_17 = { error: e_17_1 }; }
                finally {
                    try {
                        if (_l && !_l.done && (_h = _k.return)) _h.call(_k);
                    }
                    finally { if (e_17) throw e_17.error; }
                }
            }
        }
        catch (e_16_1) { e_16 = { error: e_16_1 }; }
        finally {
            try {
                if (citations_1_1 && !citations_1_1.done && (_g = citations_1.return)) _g.call(citations_1);
            }
            finally { if (e_16) throw e_16.error; }
        }
        var items = {};
        try {
            for (var _m = __values(Object.entries(model.items)), _o = _m.next(); !_o.done; _o = _m.next()) {
                var _p = __read(_o.value, 2), paperId = _p[0], snapshot = _p[1];
                if (used.has(paperId))
                    items[paperId] = snapshot;
            }
        }
        catch (e_18_1) { e_18 = { error: e_18_1 }; }
        finally {
            try {
                if (_o && !_o.done && (_j = _m.return)) _j.call(_m);
            }
            finally { if (e_18) throw e_18.error; }
        }
        return __spreadProps(__spreadValues({}, model), { citations: citations, items: items });
    }
    function planDuplicateSplit(ordered, createId) {
        var e_19, _g;
        var _a;
        var counts = /* @__PURE__ */ new Map();
        var taken = new Set(ordered);
        var plan = [];
        try {
            for (var ordered_1 = __values(ordered), ordered_1_1 = ordered_1.next(); !ordered_1_1.done; ordered_1_1 = ordered_1.next()) {
                var citeId = ordered_1_1.value;
                var occurrence = (_a = counts.get(citeId)) != null ? _a : 0;
                counts.set(citeId, occurrence + 1);
                if (occurrence === 0)
                    continue;
                var newCiteId = createId();
                while (taken.has(newCiteId))
                    newCiteId = createId();
                taken.add(newCiteId);
                plan.push({ citeId: citeId, occurrence: occurrence, newCiteId: newCiteId });
            }
        }
        catch (e_19_1) { e_19 = { error: e_19_1 }; }
        finally {
            try {
                if (ordered_1_1 && !ordered_1_1.done && (_g = ordered_1.return)) _g.call(ordered_1);
            }
            finally { if (e_19) throw e_19.error; }
        }
        return plan;
    }
    function applyDuplicateSplit(model, ordered, plan) {
        var e_20, _g;
        if (plan.length === 0)
            return { model: model, ordered: ordered };
        var counts = /* @__PURE__ */ new Map();
        var nextOrdered = ordered.map(function (citeId) {
            var _a;
            var occurrence = (_a = counts.get(citeId)) != null ? _a : 0;
            counts.set(citeId, occurrence + 1);
            var hit = plan.find(function (entry) { return entry.citeId === citeId && entry.occurrence === occurrence; });
            return hit ? hit.newCiteId : citeId;
        });
        var nextModel = model;
        try {
            for (var plan_1 = __values(plan), plan_1_1 = plan_1.next(); !plan_1_1.done; plan_1_1 = plan_1.next()) {
                var entry = plan_1_1.value;
                var source = findCitation(model, entry.citeId);
                if (!source)
                    continue;
                nextModel = upsertCitation(nextModel, {
                    citeId: entry.newCiteId,
                    items: source.items.map(function (item) { return __spreadValues({}, item); }),
                    updatedAt: Date.now()
                });
            }
        }
        catch (e_20_1) { e_20 = { error: e_20_1 }; }
        finally {
            try {
                if (plan_1_1 && !plan_1_1.done && (_g = plan_1.return)) _g.call(plan_1);
            }
            finally { if (e_20) throw e_20.error; }
        }
        return { model: nextModel, ordered: nextOrdered };
    }
    function snapshotResolver(model) {
        return function (paperId) {
            var _a;
            return (_a = model.items[paperId]) == null ? void 0 : _a.paper;
        };
    }
    function planRender(model, ordered, options) {
        var e_21, _g, e_22, _h;
        var groups = [];
        try {
            for (var ordered_2 = __values(ordered), ordered_2_1 = ordered_2.next(); !ordered_2_1.done; ordered_2_1 = ordered_2.next()) {
                var citeId = ordered_2_1.value;
                var citation = findCitation(model, citeId);
                if (citation)
                    groups.push({ citeId: citeId, items: citation.items });
            }
        }
        catch (e_21_1) { e_21 = { error: e_21_1 }; }
        finally {
            try {
                if (ordered_2_1 && !ordered_2_1.done && (_g = ordered_2.return)) _g.call(ordered_2);
            }
            finally { if (e_21) throw e_21.error; }
        }
        var prefs = model.prefs;
        var render = renderCitations({
            style: prefs.style,
            groups: groups,
            bibliographyTitle: prefs.bibliographyTitle,
            bibliographyOrder: prefs.bibliographyOrder,
            punctuation: prefs.punctuation
        }, snapshotResolver(model));
        var linked = prefs.links && options.hasBibliography && render.entries.length > 0;
        var bookmarks = linked ? assignBookmarkNames(render.entries.map(function (entry) { return entry.paperId; })) : /* @__PURE__ */ new Map();
        var superscript = prefs.superscript && render.kind === "numeric";
        var citations = [];
        try {
            for (var _j = __values(render.groups), _k = _j.next(); !_k.done; _k = _j.next()) {
                var group = _k.value;
                if (!group.citeId)
                    continue;
                var ooxml = buildInlineCitationPackage(group.segments, { bookmarks: bookmarks, superscript: superscript });
                citations.push({ citeId: group.citeId, text: group.inline, ooxml: ooxml, signature: fnv1aBase36(ooxml) });
            }
        }
        catch (e_22_1) { e_22 = { error: e_22_1 }; }
        finally {
            try {
                if (_k && !_k.done && (_h = _j.return)) _h.call(_j);
            }
            finally { if (e_22) throw e_22.error; }
        }
        var bibliographyOoxml = buildBibliographyPackage(render.entries, {
            kind: render.kind,
            heading: prefs.bibHeading,
            title: prefs.bibliographyTitle,
            bookmarks: bookmarks,
            bookmarkIdBase: options.bookmarkIdBase
        });
        var lines = render.entries.map(function (entry) { return render.kind === "numeric" ? "[".concat(entry.seq, "] ").concat(entry.text) : entry.text; });
        var bibliographyText = __spreadArray(__spreadArray([], __read(prefs.bibHeading ? [prefs.bibliographyTitle] : []), false), __read(lines), false).join("\n");
        return { render: render, citations: citations, bibliographyOoxml: bibliographyOoxml, bibliographyText: bibliographyText, linked: linked, bookmarks: bookmarks };
    }
    var INVISIBLE_SPACES = new RegExp("[".concat(String.fromCharCode(8203, 160, 12288), "]"), "g");
    function normalizeControlText(value) {
        return String(value != null ? value : "").replace(INVISIBLE_SPACES, " ").replace(/\s+/g, " ").trim();
    }
    function diffRender(model, currentTexts, outputs) {
        var e_23, _g;
        var _a;
        var diff = { rewrite: [], manualEdits: [], kept: [], unchanged: [] };
        try {
            for (var outputs_1 = __values(outputs), outputs_1_1 = outputs_1.next(); !outputs_1_1.done; outputs_1_1 = outputs_1.next()) {
                var output = outputs_1_1.value;
                var citation = findCitation(model, output.citeId);
                var current = normalizeControlText(currentTexts.get(output.citeId));
                var expected = normalizeControlText(output.text);
                var last = (citation == null ? void 0 : citation.lastText) !== void 0 ? normalizeControlText(citation.lastText) : void 0;
                if ((citation == null ? void 0 : citation.manualText) !== void 0 && current === normalizeControlText(citation.manualText)) {
                    diff.kept.push(output.citeId);
                    continue;
                }
                if (last !== void 0 && current && current !== last && current !== expected) {
                    diff.manualEdits.push({
                        citeId: output.citeId,
                        currentText: (_a = currentTexts.get(output.citeId)) != null ? _a : "",
                        expectedText: output.text
                    });
                    continue;
                }
                if ((citation == null ? void 0 : citation.lastSignature) !== output.signature || current !== expected)
                    diff.rewrite.push(output.citeId);
                else
                    diff.unchanged.push(output.citeId);
            }
        }
        catch (e_23_1) { e_23 = { error: e_23_1 }; }
        finally {
            try {
                if (outputs_1_1 && !outputs_1_1.done && (_g = outputs_1.return)) _g.call(outputs_1);
            }
            finally { if (e_23) throw e_23.error; }
        }
        return diff;
    }
    function recordRendered(model, outputs, written) {
        var e_24, _g;
        var writtenSet = new Set(written);
        var byId2 = /* @__PURE__ */ new Map();
        try {
            for (var outputs_2 = __values(outputs), outputs_2_1 = outputs_2.next(); !outputs_2_1.done; outputs_2_1 = outputs_2.next()) {
                var output = outputs_2_1.value;
                byId2.set(output.citeId, output);
            }
        }
        catch (e_24_1) { e_24 = { error: e_24_1 }; }
        finally {
            try {
                if (outputs_2_1 && !outputs_2_1.done && (_g = outputs_2.return)) _g.call(outputs_2);
            }
            finally { if (e_24) throw e_24.error; }
        }
        return __spreadProps(__spreadValues({}, model), {
            citations: model.citations.map(function (citation) {
                var output = byId2.get(citation.citeId);
                if (!output || !writtenSet.has(citation.citeId))
                    return citation;
                return {
                    citeId: citation.citeId,
                    items: citation.items,
                    updatedAt: citation.updatedAt,
                    lastText: output.text,
                    lastSignature: output.signature
                };
            })
        });
    }
    function keepManualEdit(model, citeId, currentText) {
        return __spreadProps(__spreadValues({}, model), {
            citations: model.citations.map(function (citation) { return citation.citeId === citeId ? __spreadProps(__spreadValues({}, citation), { manualText: currentText }) : citation; })
        });
    }
    // office-addin/src/bridge/client.ts
    var API_BASE = "/api/v1";
    var CLIENT_HEADER = "X-PaperQuay-Client";
    var CLIENT_ID = "word-addin/0.4.0";
    var BridgeError = /** @class */ (function (_super) {
        __extends(BridgeError, _super);
        function BridgeError(code, message, status) {
            var _this = _super.call(this, message) || this;
            _this.code = code;
            _this.status = status;
            return _this;
        }
        return BridgeError;
    }(Error));
    var BACKOFF_MS = [1e3, 2e3, 4e3, 8e3, 1e4];
    function createBridgeClient(options) {
        if (options === void 0) { options = {}; }
        var _a, _b, _c, _d;
        var doFetch = (_a = options.fetch) != null ? _a : (function (input, init) { return fetch(input, init); });
        var base = ((_b = options.baseUrl) != null ? _b : "") + API_BASE;
        var setTimer = (_c = options.setTimer) != null ? _c : (function (callback, ms) { return setTimeout(callback, ms); });
        var clearTimer = (_d = options.clearTimer) != null ? _d : (function (handle) { return clearTimeout(handle); });
        var current = "connecting";
        var info = null;
        var attempt = 0;
        var timer = null;
        var running = false;
        var listeners = [];
        function setState(next, health) {
            var e_25, _g;
            var changed = next !== current || health !== info;
            current = next;
            info = health;
            if (changed)
                try {
                    for (var listeners_1 = __values(listeners), listeners_1_1 = listeners_1.next(); !listeners_1_1.done; listeners_1_1 = listeners_1.next()) {
                        var listener = listeners_1_1.value;
                        listener(current, info);
                    }
                }
                catch (e_25_1) { e_25 = { error: e_25_1 }; }
                finally {
                    try {
                        if (listeners_1_1 && !listeners_1_1.done && (_g = listeners_1.return)) _g.call(listeners_1);
                    }
                    finally { if (e_25) throw e_25.error; }
                }
        }
        function request(path_1) {
            return __awaiter(this, arguments, void 0, function (path, init) {
                var _a2, _b2, _c2, headers, body, response, error_1, text, payload, error;
                var _g;
                if (init === void 0) { init = {}; }
                return __generator(this, function (_h) {
                    switch (_h.label) {
                        case 0:
                            headers = (_g = {}, _g[CLIENT_HEADER] = CLIENT_ID, _g.Accept = "application/json", _g);
                            if (init.body !== void 0) {
                                headers["Content-Type"] = "application/json";
                                body = JSON.stringify(init.body);
                            }
                            _h.label = 1;
                        case 1:
                            _h.trys.push([1, 3, , 4]);
                            return [4 /*yield*/, doFetch(base + path, { method: (_a2 = init.method) != null ? _a2 : "GET", headers: headers, body: body })];
                        case 2:
                            response = _h.sent();
                            return [3 /*break*/, 4];
                        case 3:
                            error_1 = _h.sent();
                            if (running)
                                scheduleRetry(true);
                            throw new BridgeError("OFFLINE", "PaperQuay 未运行或无法访问。", 0);
                        case 4: return [4 /*yield*/, response.text()];
                        case 5:
                            text = _h.sent();
                            payload = null;
                            if (text) {
                                try {
                                    payload = JSON.parse(text);
                                }
                                catch (e) {
                                    payload = null;
                                }
                            }
                            if (!response.ok) {
                                error = payload == null ? void 0 : payload.error;
                                if (response.status === 503 && running)
                                    scheduleRetry(true);
                                throw new BridgeError((_b2 = error == null ? void 0 : error.code) != null ? _b2 : "HTTP_" + response.status, (_c2 = error == null ? void 0 : error.message) != null ? _c2 : "\u8BF7\u6C42\u5931\u8D25\uFF08".concat(response.status, "\uFF09"), response.status);
                            }
                            return [2 /*return*/, payload];
                    }
                });
            });
        }
        function scheduleRetry(markOffline) {
            if (markOffline)
                setState("offline", null);
            if (!running || timer !== null)
                return;
            var delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
            attempt += 1;
            timer = setTimer(function () {
                timer = null;
                void probe();
            }, delay);
        }
        function probe() {
            return __awaiter(this, void 0, void 0, function () {
                var health, e_26;
                return __generator(this, function (_g) {
                    switch (_g.label) {
                        case 0:
                            if (timer !== null) {
                                clearTimer(timer);
                                timer = null;
                            }
                            if (current !== "online")
                                setState("connecting", info);
                            _g.label = 1;
                        case 1:
                            _g.trys.push([1, 3, , 4]);
                            return [4 /*yield*/, request("/health")];
                        case 2:
                            health = _g.sent();
                            attempt = 0;
                            setState("online", health);
                            return [2 /*return*/, true];
                        case 3:
                            e_26 = _g.sent();
                            scheduleRetry(true);
                            return [2 /*return*/, false];
                        case 4: return [2 /*return*/];
                    }
                });
            });
        }
        return {
            state: function () { return current; },
            health: function () { return info; },
            onChange: function (listener) {
                listeners.push(listener);
            },
            probe: probe,
            start: function () {
                if (running)
                    return;
                running = true;
                void probe();
            },
            stop: function () {
                running = false;
                if (timer !== null)
                    clearTimer(timer);
                timer = null;
            },
            searchPapers: function (query_1) {
                return __awaiter(this, arguments, void 0, function (query, limit) {
                    var _a2, params, result;
                    if (limit === void 0) { limit = 30; }
                    return __generator(this, function (_g) {
                        switch (_g.label) {
                            case 0:
                                params = "?limit=".concat(limit).concat(query ? "&search=".concat(encodeURIComponent(query)) : "");
                                return [4 /*yield*/, request("/papers".concat(params))];
                            case 1:
                                result = _g.sent();
                                return [2 /*return*/, { papers: Array.isArray(result == null ? void 0 : result.papers) ? result.papers : [], total: (_a2 = result == null ? void 0 : result.total) != null ? _a2 : 0 }];
                        }
                    });
                });
            },
            fetchPapers: function (ids) {
                return __awaiter(this, void 0, void 0, function () {
                    var _a2, _b2, papers, missing, index, chunk, result;
                    return __generator(this, function (_g) {
                        switch (_g.label) {
                            case 0:
                                if (ids.length === 0)
                                    return [2 /*return*/, { papers: [], missing: [] }];
                                papers = [];
                                missing = [];
                                index = 0;
                                _g.label = 1;
                            case 1:
                                if (!(index < ids.length)) return [3 /*break*/, 4];
                                chunk = ids.slice(index, index + 400);
                                return [4 /*yield*/, request("/papers/batch", {
                                        method: "POST",
                                        body: { ids: chunk }
                                    })];
                            case 2:
                                result = _g.sent();
                                papers.push.apply(papers, __spreadArray([], __read((_a2 = result == null ? void 0 : result.papers) != null ? _a2 : []), false));
                                missing.push.apply(missing, __spreadArray([], __read((_b2 = result == null ? void 0 : result.missing) != null ? _b2 : []), false));
                                _g.label = 3;
                            case 3:
                                index += 400;
                                return [3 /*break*/, 1];
                            case 4: return [2 /*return*/, { papers: papers, missing: missing }];
                        }
                    });
                });
            },
            recordCited: function (payload) {
                return __awaiter(this, void 0, void 0, function () {
                    var error_2;
                    return __generator(this, function (_g) {
                        switch (_g.label) {
                            case 0:
                                _g.trys.push([0, 2, , 3]);
                                return [4 /*yield*/, request("/documents/cited", { method: "POST", body: __spreadProps(__spreadValues({}, payload), { source: "office-addin" }) })];
                            case 1:
                                _g.sent();
                                return [3 /*break*/, 3];
                            case 2:
                                error_2 = _g.sent();
                                if (error_2 instanceof BridgeError && error_2.code === "WRITE_DISABLED")
                                    return [2 /*return*/];
                                throw error_2;
                            case 3: return [2 /*return*/];
                        }
                    });
                });
            }
        };
    }
    // office-addin/src/ui/dom.ts
    function byId(id) {
        var node = document.getElementById(id);
        if (!node)
            throw new Error("\u9875\u9762\u7F3A\u5C11\u5143\u7D20 #".concat(id));
        return node;
    }
    function h(tag, props, children) {
        var e_27, _g, e_28, _h;
        if (props === void 0) { props = {}; }
        if (children === void 0) { children = []; }
        var node = document.createElement(tag);
        if (props.className)
            node.className = props.className;
        if (props.text !== void 0)
            node.textContent = props.text;
        if (props.title)
            node.title = props.title;
        if (props.attrs) {
            try {
                for (var _j = __values(Object.keys(props.attrs)), _k = _j.next(); !_k.done; _k = _j.next()) {
                    var key = _k.value;
                    node.setAttribute(key, props.attrs[key]);
                }
            }
            catch (e_27_1) { e_27 = { error: e_27_1 }; }
            finally {
                try {
                    if (_k && !_k.done && (_g = _j.return)) _g.call(_j);
                }
                finally { if (e_27) throw e_27.error; }
            }
        }
        try {
            for (var children_1 = __values(children), children_1_1 = children_1.next(); !children_1_1.done; children_1_1 = children_1.next()) {
                var child = children_1_1.value;
                if (child)
                    node.appendChild(child);
            }
        }
        catch (e_28_1) { e_28 = { error: e_28_1 }; }
        finally {
            try {
                if (children_1_1 && !children_1_1.done && (_h = children_1.return)) _h.call(children_1);
            }
            finally { if (e_28) throw e_28.error; }
        }
        return node;
    }
    function clear(node) {
        while (node.firstChild)
            node.removeChild(node.firstChild);
    }
    function show(node, visible) {
        if (visible)
            node.removeAttribute("hidden");
        else
            node.setAttribute("hidden", "");
    }
    function debounce(fn, ms) {
        var handle = null;
        return function () {
            var args = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
            }
            if (handle !== null)
                clearTimeout(handle);
            handle = setTimeout(function () {
                handle = null;
                fn.apply(void 0, __spreadArray([], __read(args), false));
            }, ms);
        };
    }
    function errorMessage(error) {
        if (!error)
            return "未知错误";
        if (typeof error === "string")
            return error;
        var record = error;
        return record.debugInfo && record.debugInfo.message || record.message || String(error);
    }
    function paperMetaLine(paper) {
        var authors = Array.isArray(paper.authors) ? paper.authors : [];
        var names = authors.slice(0, 3).map(function (author) { return typeof author === "string" ? author : (author == null ? void 0 : author.name) || (author == null ? void 0 : author.familyName) || ""; }).filter(Boolean);
        if (authors.length > 3)
            names.push("等");
        return [names.join(", "), paper.year ? String(paper.year) : "", paper.publication || ""].filter(Boolean).join(" · ");
    }
    // office-addin/src/word/officeAdapter.ts
    var TAG_PATTERN = /<w:tag\b[^>]*\bw:val="([^"]*)"/g;
    function isSetSupported(name, version) {
        try {
            return Boolean(Office.context.requirements && Office.context.requirements.isSetSupported(name, version));
        }
        catch (e) {
            return false;
        }
    }
    function asyncCall(invoke) {
        return new Promise(function (resolve, reject) {
            invoke(function (result) {
                if (result.status === Office.AsyncResultStatus.Succeeded)
                    resolve(result.value);
                else
                    reject(new Error(result.error ? result.error.message : "Office 异步调用失败"));
            });
        });
    }
    function errorText(error) {
        if (!error)
            return "未知错误";
        var record = error;
        return record.debugInfo && record.debugInfo.message || record.message || String(error);
    }
    function createOfficeAdapter() {
        var caps = {
            wordApi13: isSetSupported("WordApi", "1.3"),
            customXmlParts: Boolean(Office.context.document && Office.context.document.customXmlParts),
            dialogApi: isSetSupported("DialogApi", "1.1"),
            changeTracking: isSetSupported("WordApi", "1.4")
        };
        function scan() {
            return __awaiter(this, void 0, void 0, function () {
                var _this = this;
                return __generator(this, function (_g) {
                    return [2 /*return*/, Word.run(function (context) { return __awaiter(_this, void 0, void 0, function () {
                            var body, ooxml, controls, ordered, hasBibliography, xml, match, citeId, texts, fallbackOrder, _g, _h, control, citeId;
                            var e_29, _j;
                            return __generator(this, function (_k) {
                                switch (_k.label) {
                                    case 0:
                                        body = context.document.body;
                                        ooxml = body.getOoxml();
                                        controls = body.contentControls;
                                        controls.load("items/tag,items/text");
                                        return [4 /*yield*/, context.sync()];
                                    case 1:
                                        _k.sent();
                                        ordered = [];
                                        hasBibliography = false;
                                        xml = typeof ooxml.value === "string" ? ooxml.value : "";
                                        TAG_PATTERN.lastIndex = 0;
                                        match = TAG_PATTERN.exec(xml);
                                        while (match) {
                                            citeId = parseCitationControlTag(match[1]);
                                            if (citeId)
                                                ordered.push(citeId);
                                            else if (isBibliographyControlTag(match[1]))
                                                hasBibliography = true;
                                            match = TAG_PATTERN.exec(xml);
                                        }
                                        texts = new Map();
                                        fallbackOrder = [];
                                        try {
                                            for (_g = __values(controls.items), _h = _g.next(); !_h.done; _h = _g.next()) {
                                                control = _h.value;
                                                citeId = parseCitationControlTag(control.tag);
                                                if (citeId) {
                                                    fallbackOrder.push(citeId);
                                                    if (!texts.has(citeId))
                                                        texts.set(citeId, control.text);
                                                }
                                                else if (isBibliographyControlTag(control.tag)) {
                                                    hasBibliography = true;
                                                }
                                            }
                                        }
                                        catch (e_29_1) { e_29 = { error: e_29_1 }; }
                                        finally {
                                            try {
                                                if (_h && !_h.done && (_j = _g.return)) _j.call(_g);
                                            }
                                            finally { if (e_29) throw e_29.error; }
                                        }
                                        return [2 /*return*/, { ordered: ordered.length > 0 || fallbackOrder.length === 0 ? ordered : fallbackOrder, texts: texts, hasBibliography: hasBibliography }];
                                }
                            });
                        }); })];
                });
            });
        }
        function decorate(control, tag, title) {
            control.tag = tag;
            control.title = title;
            control.appearance = "Hidden";
        }
        function insertCitation2(citeId, ooxml, fallbackText) {
            return __awaiter(this, void 0, void 0, function () {
                var tag, error_3;
                var _this = this;
                return __generator(this, function (_g) {
                    switch (_g.label) {
                        case 0:
                            tag = encodeCitationControlTag(citeId);
                            _g.label = 1;
                        case 1:
                            _g.trys.push([1, 3, , 5]);
                            return [4 /*yield*/, Word.run(function (context) { return __awaiter(_this, void 0, void 0, function () {
                                    var range, control;
                                    return __generator(this, function (_g) {
                                        switch (_g.label) {
                                            case 0:
                                                range = context.document.getSelection();
                                                control = range.insertContentControl();
                                                decorate(control, tag, CITATION_CONTROL_TITLE);
                                                control.insertOoxml(ooxml, "Replace");
                                                return [4 /*yield*/, context.sync()];
                                            case 1:
                                                _g.sent();
                                                return [2 /*return*/];
                                        }
                                    });
                                }); })];
                        case 2:
                            _g.sent();
                            return [3 /*break*/, 5];
                        case 3:
                            error_3 = _g.sent();
                            return [4 /*yield*/, Word.run(function (context) { return __awaiter(_this, void 0, void 0, function () {
                                    var existing, control;
                                    return __generator(this, function (_g) {
                                        switch (_g.label) {
                                            case 0:
                                                existing = context.document.body.contentControls.getByTag(tag);
                                                existing.load("items");
                                                return [4 /*yield*/, context.sync()];
                                            case 1:
                                                _g.sent();
                                                control = existing.items.length > 0 ? existing.items[0] : context.document.getSelection().insertContentControl();
                                                decorate(control, tag, CITATION_CONTROL_TITLE);
                                                control.insertText(fallbackText, "Replace");
                                                return [4 /*yield*/, context.sync()];
                                            case 2:
                                                _g.sent();
                                                return [2 /*return*/];
                                        }
                                    });
                                }); }).catch(function (fallbackError) {
                                    throw new Error("\u63D2\u5165\u5F15\u7528\u5931\u8D25\uFF1A".concat(errorText(fallbackError), "\uFF08OOXML\uFF1A").concat(errorText(error_3), "\uFF09"));
                                })];
                        case 4:
                            _g.sent();
                            return [3 /*break*/, 5];
                        case 5: return [2 /*return*/];
                    }
                });
            });
        }
        function rewriteCitations(updates) {
            return __awaiter(this, void 0, void 0, function () {
                var run, e_30, updates_1, updates_1_1, update, e2_1, e_31_1;
                var e_31, _g;
                var _this = this;
                return __generator(this, function (_h) {
                    switch (_h.label) {
                        case 0:
                            if (updates.length === 0)
                                return [2 /*return*/];
                            run = function (mode, subset) { return Word.run(function (context) { return __awaiter(_this, void 0, void 0, function () {
                                var collections, collections_1, collections_1_1, _g, update, collection, _h, _j, control;
                                var e_32, _k, e_33, _l;
                                return __generator(this, function (_m) {
                                    switch (_m.label) {
                                        case 0:
                                            collections = subset.map(function (update) {
                                                var collection = context.document.body.contentControls.getByTag(encodeCitationControlTag(update.citeId));
                                                collection.load("items");
                                                return { update: update, collection: collection };
                                            });
                                            return [4 /*yield*/, context.sync()];
                                        case 1:
                                            _m.sent();
                                            try {
                                                for (collections_1 = __values(collections), collections_1_1 = collections_1.next(); !collections_1_1.done; collections_1_1 = collections_1.next()) {
                                                    _g = collections_1_1.value, update = _g.update, collection = _g.collection;
                                                    try {
                                                        for (_h = (e_33 = void 0, __values(collection.items)), _j = _h.next(); !_j.done; _j = _h.next()) {
                                                            control = _j.value;
                                                            if (mode === "ooxml")
                                                                control.insertOoxml(update.ooxml, "Replace");
                                                            else
                                                                control.insertText(update.fallbackText, "Replace");
                                                            control.appearance = "Hidden";
                                                        }
                                                    }
                                                    catch (e_33_1) { e_33 = { error: e_33_1 }; }
                                                    finally {
                                                        try {
                                                            if (_j && !_j.done && (_l = _h.return)) _l.call(_h);
                                                        }
                                                        finally { if (e_33) throw e_33.error; }
                                                    }
                                                }
                                            }
                                            catch (e_32_1) { e_32 = { error: e_32_1 }; }
                                            finally {
                                                try {
                                                    if (collections_1_1 && !collections_1_1.done && (_k = collections_1.return)) _k.call(collections_1);
                                                }
                                                finally { if (e_32) throw e_32.error; }
                                            }
                                            return [4 /*yield*/, context.sync()];
                                        case 2:
                                            _m.sent();
                                            return [2 /*return*/];
                                    }
                                });
                            }); }); };
                            _h.label = 1;
                        case 1:
                            _h.trys.push([1, 3, , 15]);
                            return [4 /*yield*/, run("ooxml", updates)];
                        case 2:
                            _h.sent();
                            return [3 /*break*/, 15];
                        case 3:
                            e_30 = _h.sent();
                            _h.label = 4;
                        case 4:
                            _h.trys.push([4, 12, 13, 14]);
                            updates_1 = __values(updates), updates_1_1 = updates_1.next();
                            _h.label = 5;
                        case 5:
                            if (!!updates_1_1.done) return [3 /*break*/, 11];
                            update = updates_1_1.value;
                            _h.label = 6;
                        case 6:
                            _h.trys.push([6, 8, , 10]);
                            return [4 /*yield*/, run("ooxml", [update])];
                        case 7:
                            _h.sent();
                            return [3 /*break*/, 10];
                        case 8:
                            e2_1 = _h.sent();
                            return [4 /*yield*/, run("text", [update])];
                        case 9:
                            _h.sent();
                            return [3 /*break*/, 10];
                        case 10:
                            updates_1_1 = updates_1.next();
                            return [3 /*break*/, 5];
                        case 11: return [3 /*break*/, 14];
                        case 12:
                            e_31_1 = _h.sent();
                            e_31 = { error: e_31_1 };
                            return [3 /*break*/, 14];
                        case 13:
                            try {
                                if (updates_1_1 && !updates_1_1.done && (_g = updates_1.return)) _g.call(updates_1);
                            }
                            finally { if (e_31) throw e_31.error; }
                            return [7 /*endfinally*/];
                        case 14: return [3 /*break*/, 15];
                        case 15: return [2 /*return*/];
                    }
                });
            });
        }
        function retagDuplicates(splits) {
            return __awaiter(this, void 0, void 0, function () {
                var _this = this;
                return __generator(this, function (_g) {
                    switch (_g.label) {
                        case 0:
                            if (splits.length === 0)
                                return [2 /*return*/];
                            return [4 /*yield*/, Word.run(function (context) { return __awaiter(_this, void 0, void 0, function () {
                                    var _a, byTag, splits_1, splits_1_1, split, collection, splits_2, splits_2_1, split, control;
                                    var e_34, _g, e_35, _h;
                                    return __generator(this, function (_j) {
                                        switch (_j.label) {
                                            case 0:
                                                byTag = new Map();
                                                try {
                                                    for (splits_1 = __values(splits), splits_1_1 = splits_1.next(); !splits_1_1.done; splits_1_1 = splits_1.next()) {
                                                        split = splits_1_1.value;
                                                        if (byTag.has(split.citeId))
                                                            continue;
                                                        collection = context.document.body.contentControls.getByTag(encodeCitationControlTag(split.citeId));
                                                        collection.load("items");
                                                        byTag.set(split.citeId, collection);
                                                    }
                                                }
                                                catch (e_34_1) { e_34 = { error: e_34_1 }; }
                                                finally {
                                                    try {
                                                        if (splits_1_1 && !splits_1_1.done && (_g = splits_1.return)) _g.call(splits_1);
                                                    }
                                                    finally { if (e_34) throw e_34.error; }
                                                }
                                                return [4 /*yield*/, context.sync()];
                                            case 1:
                                                _j.sent();
                                                try {
                                                    for (splits_2 = __values(splits), splits_2_1 = splits_2.next(); !splits_2_1.done; splits_2_1 = splits_2.next()) {
                                                        split = splits_2_1.value;
                                                        control = (_a = byTag.get(split.citeId)) == null ? void 0 : _a.items[split.occurrence];
                                                        if (control)
                                                            control.tag = encodeCitationControlTag(split.newCiteId);
                                                    }
                                                }
                                                catch (e_35_1) { e_35 = { error: e_35_1 }; }
                                                finally {
                                                    try {
                                                        if (splits_2_1 && !splits_2_1.done && (_h = splits_2.return)) _h.call(splits_2);
                                                    }
                                                    finally { if (e_35) throw e_35.error; }
                                                }
                                                return [4 /*yield*/, context.sync()];
                                            case 2:
                                                _j.sent();
                                                return [2 /*return*/];
                                        }
                                    });
                                }); })];
                        case 1:
                            _g.sent();
                            return [2 /*return*/];
                    }
                });
            });
        }
        function removeTrailingEmptyParagraph(context, control) {
            return __awaiter(this, void 0, void 0, function () {
                var paragraphs, items;
                return __generator(this, function (_g) {
                    switch (_g.label) {
                        case 0:
                            paragraphs = control.paragraphs;
                            paragraphs.load("items/text");
                            return [4 /*yield*/, context.sync()];
                        case 1:
                            _g.sent();
                            items = paragraphs.items;
                            if (!(items.length > 1 && items[items.length - 1].text.trim() === "")) return [3 /*break*/, 3];
                            items[items.length - 1].delete();
                            return [4 /*yield*/, context.sync()];
                        case 2:
                            _g.sent();
                            _g.label = 3;
                        case 3: return [2 /*return*/];
                    }
                });
            });
        }
        function writeBibliography(ooxml, fallbackText, mode) {
            return __awaiter(this, void 0, void 0, function () {
                var locate, error_4;
                var _this = this;
                return __generator(this, function (_g) {
                    switch (_g.label) {
                        case 0:
                            locate = function (context) { return __awaiter(_this, void 0, void 0, function () {
                                var existing, paragraphs, host, target, control;
                                return __generator(this, function (_g) {
                                    switch (_g.label) {
                                        case 0:
                                            existing = context.document.body.contentControls.getByTag(BIBLIOGRAPHY_CONTROL_TAG);
                                            existing.load("items");
                                            return [4 /*yield*/, context.sync()];
                                        case 1:
                                            _g.sent();
                                            if (existing.items.length > 0)
                                                return [2 /*return*/, existing.items[0]];
                                            if (mode === "update")
                                                throw new Error("文档里没有参考文献表。");
                                            paragraphs = context.document.getSelection().paragraphs;
                                            paragraphs.load("items/text");
                                            return [4 /*yield*/, context.sync()];
                                        case 2:
                                            _g.sent();
                                            host = paragraphs.items[0];
                                            target = !host ? context.document.body.insertParagraph("", "End") : host.text.trim().length > 0 ? host.insertParagraph("", "After") : host;
                                            control = target.insertContentControl();
                                            decorate(control, BIBLIOGRAPHY_CONTROL_TAG, BIBLIOGRAPHY_CONTROL_TITLE);
                                            return [4 /*yield*/, context.sync()];
                                        case 3:
                                            _g.sent();
                                            return [2 /*return*/, control];
                                    }
                                });
                            }); };
                            _g.label = 1;
                        case 1:
                            _g.trys.push([1, 3, , 5]);
                            return [4 /*yield*/, Word.run(function (context) { return __awaiter(_this, void 0, void 0, function () {
                                    var control;
                                    return __generator(this, function (_g) {
                                        switch (_g.label) {
                                            case 0: return [4 /*yield*/, locate(context)];
                                            case 1:
                                                control = _g.sent();
                                                control.appearance = "Hidden";
                                                control.insertOoxml(ooxml, "Replace");
                                                return [4 /*yield*/, context.sync()];
                                            case 2:
                                                _g.sent();
                                                return [4 /*yield*/, removeTrailingEmptyParagraph(context, control).catch(function () { return void 0; })];
                                            case 3:
                                                _g.sent();
                                                return [2 /*return*/];
                                        }
                                    });
                                }); })];
                        case 2:
                            _g.sent();
                            return [3 /*break*/, 5];
                        case 3:
                            error_4 = _g.sent();
                            return [4 /*yield*/, Word.run(function (context) { return __awaiter(_this, void 0, void 0, function () {
                                    var control, lines;
                                    return __generator(this, function (_g) {
                                        switch (_g.label) {
                                            case 0: return [4 /*yield*/, locate(context)];
                                            case 1:
                                                control = _g.sent();
                                                control.clear();
                                                lines = fallbackText.split("\n");
                                                lines.forEach(function (line, index) {
                                                    if (index === 0)
                                                        control.insertText(line, "Start");
                                                    else
                                                        control.insertParagraph(line, "End");
                                                });
                                                return [4 /*yield*/, context.sync()];
                                            case 2:
                                                _g.sent();
                                                return [2 /*return*/];
                                        }
                                    });
                                }); }).catch(function (fallbackError) {
                                    throw new Error("\u5199\u5165\u53C2\u8003\u6587\u732E\u8868\u5931\u8D25\uFF1A".concat(errorText(fallbackError), "\uFF08OOXML\uFF1A").concat(errorText(error_4), "\uFF09"));
                                })];
                        case 4:
                            _g.sent();
                            return [3 /*break*/, 5];
                        case 5: return [2 /*return*/];
                    }
                });
            });
        }
        function deleteCitation(citeId) {
            return __awaiter(this, void 0, void 0, function () {
                var _this = this;
                return __generator(this, function (_g) {
                    switch (_g.label) {
                        case 0: return [4 /*yield*/, Word.run(function (context) { return __awaiter(_this, void 0, void 0, function () {
                                var collection, _g, _h, control;
                                var e_36, _j;
                                return __generator(this, function (_k) {
                                    switch (_k.label) {
                                        case 0:
                                            collection = context.document.body.contentControls.getByTag(encodeCitationControlTag(citeId));
                                            collection.load("items");
                                            return [4 /*yield*/, context.sync()];
                                        case 1:
                                            _k.sent();
                                            try {
                                                for (_g = __values(collection.items), _h = _g.next(); !_h.done; _h = _g.next()) {
                                                    control = _h.value;
                                                    control.delete(false);
                                                }
                                            }
                                            catch (e_36_1) { e_36 = { error: e_36_1 }; }
                                            finally {
                                                try {
                                                    if (_h && !_h.done && (_j = _g.return)) _j.call(_g);
                                                }
                                                finally { if (e_36) throw e_36.error; }
                                            }
                                            return [4 /*yield*/, context.sync()];
                                        case 2:
                                            _k.sent();
                                            return [2 /*return*/];
                                    }
                                });
                            }); })];
                        case 1:
                            _g.sent();
                            return [2 /*return*/];
                    }
                });
            });
        }
        function unlinkAll(stripLinks) {
            return __awaiter(this, void 0, void 0, function () {
                var _this = this;
                return __generator(this, function (_g) {
                    return [2 /*return*/, Word.run(function (context) { return __awaiter(_this, void 0, void 0, function () {
                            var controls, removed, _g, _h, control, isCitation;
                            var e_37, _j;
                            return __generator(this, function (_k) {
                                switch (_k.label) {
                                    case 0:
                                        controls = context.document.body.contentControls;
                                        controls.load("items/tag,items/text");
                                        return [4 /*yield*/, context.sync()];
                                    case 1:
                                        _k.sent();
                                        removed = 0;
                                        try {
                                            for (_g = __values(controls.items), _h = _g.next(); !_h.done; _h = _g.next()) {
                                                control = _h.value;
                                                isCitation = parseCitationControlTag(control.tag) !== null;
                                                if (!isCitation && !isBibliographyControlTag(control.tag))
                                                    continue;
                                                if (stripLinks && isCitation)
                                                    control.insertText(control.text, "Replace");
                                                control.delete(true);
                                                removed += 1;
                                            }
                                        }
                                        catch (e_37_1) { e_37 = { error: e_37_1 }; }
                                        finally {
                                            try {
                                                if (_h && !_h.done && (_j = _g.return)) _j.call(_g);
                                            }
                                            finally { if (e_37) throw e_37.error; }
                                        }
                                        return [4 /*yield*/, context.sync()];
                                    case 2:
                                        _k.sent();
                                        return [2 /*return*/, removed];
                                }
                            });
                        }); })];
                });
            });
        }
        function select(target) {
            return __awaiter(this, void 0, void 0, function () {
                var _this = this;
                return __generator(this, function (_g) {
                    switch (_g.label) {
                        case 0: return [4 /*yield*/, Word.run(function (context) { return __awaiter(_this, void 0, void 0, function () {
                                var tag, collection;
                                return __generator(this, function (_g) {
                                    switch (_g.label) {
                                        case 0:
                                            tag = "citeId" in target ? encodeCitationControlTag(target.citeId) : BIBLIOGRAPHY_CONTROL_TAG;
                                            collection = context.document.body.contentControls.getByTag(tag);
                                            collection.load("items");
                                            return [4 /*yield*/, context.sync()];
                                        case 1:
                                            _g.sent();
                                            if (collection.items.length === 0)
                                                throw new Error("文档里找不到该引用。");
                                            collection.items[0].select("Select");
                                            return [4 /*yield*/, context.sync()];
                                        case 2:
                                            _g.sent();
                                            return [2 /*return*/];
                                    }
                                });
                            }); })];
                        case 1:
                            _g.sent();
                            return [2 /*return*/];
                    }
                });
            });
        }
        function citeIdAtSelection() {
            return __awaiter(this, void 0, void 0, function () {
                var e_38;
                var _this = this;
                return __generator(this, function (_g) {
                    switch (_g.label) {
                        case 0:
                            _g.trys.push([0, 2, , 3]);
                            return [4 /*yield*/, Word.run(function (context) { return __awaiter(_this, void 0, void 0, function () {
                                    var selection, control2, control;
                                    return __generator(this, function (_g) {
                                        switch (_g.label) {
                                            case 0:
                                                selection = context.document.getSelection();
                                                if (!caps.wordApi13) return [3 /*break*/, 2];
                                                control2 = selection.parentContentControlOrNullObject;
                                                control2.load("tag");
                                                return [4 /*yield*/, context.sync()];
                                            case 1:
                                                _g.sent();
                                                return [2 /*return*/, control2.isNullObject ? null : parseCitationControlTag(control2.tag)];
                                            case 2:
                                                control = selection.parentContentControl;
                                                control.load("tag");
                                                return [4 /*yield*/, context.sync()];
                                            case 3:
                                                _g.sent();
                                                return [2 /*return*/, parseCitationControlTag(control.tag)];
                                        }
                                    });
                                }); })];
                        case 1: return [2 /*return*/, _g.sent()];
                        case 2:
                            e_38 = _g.sent();
                            return [2 /*return*/, null];
                        case 3: return [2 /*return*/];
                    }
                });
            });
        }
        function isTrackingChanges() {
            return __awaiter(this, void 0, void 0, function () {
                var e_39;
                var _this = this;
                return __generator(this, function (_g) {
                    switch (_g.label) {
                        case 0:
                            if (!caps.changeTracking)
                                return [2 /*return*/, null];
                            _g.label = 1;
                        case 1:
                            _g.trys.push([1, 3, , 4]);
                            return [4 /*yield*/, Word.run(function (context) { return __awaiter(_this, void 0, void 0, function () {
                                    var document2;
                                    return __generator(this, function (_g) {
                                        switch (_g.label) {
                                            case 0:
                                                document2 = context.document;
                                                document2.load("changeTrackingMode");
                                                return [4 /*yield*/, context.sync()];
                                            case 1:
                                                _g.sent();
                                                return [2 /*return*/, document2.changeTrackingMode !== void 0 && document2.changeTrackingMode !== "Off"];
                                        }
                                    });
                                }); })];
                        case 2: return [2 /*return*/, _g.sent()];
                        case 3:
                            e_39 = _g.sent();
                            return [2 /*return*/, null];
                        case 4: return [2 /*return*/];
                    }
                });
            });
        }
        function settingsApi() {
            return Office.context.document.settings;
        }
        function saveSettings() {
            return asyncCall(function (callback) { return settingsApi().saveAsync(callback); });
        }
        function readModelXml() {
            return __awaiter(this, void 0, void 0, function () {
                var value, parts, xmls, _loop_2, parts_1, parts_1_1, part, e_40_1;
                var e_40, _g;
                return __generator(this, function (_h) {
                    switch (_h.label) {
                        case 0:
                            if (!caps.customXmlParts) {
                                value = settingsApi().get(MODEL_FALLBACK_SETTING_KEY);
                                return [2 /*return*/, typeof value === "string" ? [value] : []];
                            }
                            return [4 /*yield*/, asyncCall(function (callback) { return Office.context.document.customXmlParts.getByNamespaceAsync(DOCUMENT_MODEL_NAMESPACE, callback); })];
                        case 1:
                            parts = _h.sent();
                            xmls = [];
                            _loop_2 = function (part) {
                                var _j, _k;
                                return __generator(this, function (_l) {
                                    switch (_l.label) {
                                        case 0:
                                            _k = (_j = xmls).push;
                                            return [4 /*yield*/, asyncCall(function (callback) { return part.getXmlAsync(callback); })];
                                        case 1:
                                            _k.apply(_j, [_l.sent()]);
                                            return [2 /*return*/];
                                    }
                                });
                            };
                            _h.label = 2;
                        case 2:
                            _h.trys.push([2, 7, 8, 9]);
                            parts_1 = __values(parts), parts_1_1 = parts_1.next();
                            _h.label = 3;
                        case 3:
                            if (!!parts_1_1.done) return [3 /*break*/, 6];
                            part = parts_1_1.value;
                            return [5 /*yield**/, _loop_2(part)];
                        case 4:
                            _h.sent();
                            _h.label = 5;
                        case 5:
                            parts_1_1 = parts_1.next();
                            return [3 /*break*/, 3];
                        case 6: return [3 /*break*/, 9];
                        case 7:
                            e_40_1 = _h.sent();
                            e_40 = { error: e_40_1 };
                            return [3 /*break*/, 9];
                        case 8:
                            try {
                                if (parts_1_1 && !parts_1_1.done && (_g = parts_1.return)) _g.call(parts_1);
                            }
                            finally { if (e_40) throw e_40.error; }
                            return [7 /*endfinally*/];
                        case 9: return [2 /*return*/, xmls];
                    }
                });
            });
        }
        function writeModelXml(xml) {
            return __awaiter(this, void 0, void 0, function () {
                var old, _loop_3, old_1, old_1_1, part, e_41_1;
                var e_41, _g;
                return __generator(this, function (_h) {
                    switch (_h.label) {
                        case 0:
                            if (!!caps.customXmlParts) return [3 /*break*/, 2];
                            settingsApi().set(MODEL_FALLBACK_SETTING_KEY, xml);
                            return [4 /*yield*/, saveSettings()];
                        case 1:
                            _h.sent();
                            return [2 /*return*/];
                        case 2: return [4 /*yield*/, asyncCall(function (callback) { return Office.context.document.customXmlParts.getByNamespaceAsync(DOCUMENT_MODEL_NAMESPACE, callback); })];
                        case 3:
                            old = _h.sent();
                            return [4 /*yield*/, asyncCall(function (callback) { return Office.context.document.customXmlParts.addAsync(xml, callback); })];
                        case 4:
                            _h.sent();
                            _loop_3 = function (part) {
                                return __generator(this, function (_j) {
                                    switch (_j.label) {
                                        case 0: return [4 /*yield*/, asyncCall(function (callback) { return part.deleteAsync(callback); }).catch(function () { return void 0; })];
                                        case 1:
                                            _j.sent();
                                            return [2 /*return*/];
                                    }
                                });
                            };
                            _h.label = 5;
                        case 5:
                            _h.trys.push([5, 10, 11, 12]);
                            old_1 = __values(old), old_1_1 = old_1.next();
                            _h.label = 6;
                        case 6:
                            if (!!old_1_1.done) return [3 /*break*/, 9];
                            part = old_1_1.value;
                            return [5 /*yield**/, _loop_3(part)];
                        case 7:
                            _h.sent();
                            _h.label = 8;
                        case 8:
                            old_1_1 = old_1.next();
                            return [3 /*break*/, 6];
                        case 9: return [3 /*break*/, 12];
                        case 10:
                            e_41_1 = _h.sent();
                            e_41 = { error: e_41_1 };
                            return [3 /*break*/, 12];
                        case 11:
                            try {
                                if (old_1_1 && !old_1_1.done && (_g = old_1.return)) _g.call(old_1);
                            }
                            finally { if (e_41) throw e_41.error; }
                            return [7 /*endfinally*/];
                        case 12: return [2 /*return*/];
                    }
                });
            });
        }
        function getSetting(key) {
            try {
                return settingsApi().get(key);
            }
            catch (e) {
                return null;
            }
        }
        function setSettings(values_1) {
            return __awaiter(this, arguments, void 0, function (values, remove) {
                var _g, _h, key, remove_1, remove_1_1, key;
                var e_42, _j, e_43, _k;
                if (remove === void 0) { remove = []; }
                return __generator(this, function (_l) {
                    switch (_l.label) {
                        case 0:
                            try {
                                for (_g = __values(Object.keys(values)), _h = _g.next(); !_h.done; _h = _g.next()) {
                                    key = _h.value;
                                    settingsApi().set(key, values[key]);
                                }
                            }
                            catch (e_42_1) { e_42 = { error: e_42_1 }; }
                            finally {
                                try {
                                    if (_h && !_h.done && (_j = _g.return)) _j.call(_g);
                                }
                                finally { if (e_42) throw e_42.error; }
                            }
                            try {
                                for (remove_1 = __values(remove), remove_1_1 = remove_1.next(); !remove_1_1.done; remove_1_1 = remove_1.next()) {
                                    key = remove_1_1.value;
                                    settingsApi().remove(key);
                                }
                            }
                            catch (e_43_1) { e_43 = { error: e_43_1 }; }
                            finally {
                                try {
                                    if (remove_1_1 && !remove_1_1.done && (_k = remove_1.return)) _k.call(remove_1);
                                }
                                finally { if (e_43) throw e_43.error; }
                            }
                            return [4 /*yield*/, saveSettings()];
                        case 1:
                            _l.sent();
                            return [2 /*return*/];
                    }
                });
            });
        }
        function documentTitle() {
            try {
                var url = Office.context.document.url || "";
                var name = url.split(/[\\/]/).pop() || "";
                return decodeURIComponent(name) || "未命名文档";
            }
            catch (e) {
                return "未命名文档";
            }
        }
        return {
            capabilities: function () { return caps; },
            scan: scan,
            insertCitation: insertCitation2,
            rewriteCitations: rewriteCitations,
            retagDuplicates: retagDuplicates,
            writeBibliography: writeBibliography,
            deleteCitation: deleteCitation,
            unlinkAll: unlinkAll,
            select: select,
            citeIdAtSelection: citeIdAtSelection,
            isTrackingChanges: isTrackingChanges,
            readModelXml: readModelXml,
            writeModelXml: writeModelXml,
            getSetting: getSetting,
            setSettings: setSettings,
            documentTitle: documentTitle
        };
    }
    // office-addin/src/word/operations.ts
    function createOperations(adapter2, createId) {
        if (createId === void 0) { createId = function () { return createCitationId(); }; }
        var model = createEmptyModel();
        var loaded = false;
        function persist(next) {
            return __awaiter(this, void 0, void 0, function () {
                var saved;
                return __generator(this, function (_g) {
                    switch (_g.label) {
                        case 0:
                            saved = __spreadProps(__spreadValues({}, next), { rev: next.rev + 1 });
                            return [4 /*yield*/, adapter2.writeModelXml(serializeModelXml(saved))];
                        case 1:
                            _g.sent();
                            model = saved;
                            return [2 /*return*/];
                    }
                });
            });
        }
        function loadModel() {
            return __awaiter(this, void 0, void 0, function () {
                var _a, xmls, stored, schema;
                var _g;
                return __generator(this, function (_h) {
                    switch (_h.label) {
                        case 0: return [4 /*yield*/, adapter2.readModelXml()];
                        case 1:
                            xmls = _h.sent();
                            stored = pickLatestModel(xmls).model;
                            schema = String((_a = adapter2.getSetting(SCHEMA_VERSION_SETTING_KEY)) != null ? _a : "");
                            if (!stored) return [3 /*break*/, 2];
                            model = stored;
                            return [3 /*break*/, 6];
                        case 2:
                            if (!(schema !== String(DOCUMENT_MODEL_SCHEMA_VERSION) && adapter2.getSetting("pq:citations") != null)) return [3 /*break*/, 5];
                            model = migrateV1Settings(function (key) { return adapter2.getSetting(key); });
                            return [4 /*yield*/, persist(model)];
                        case 3:
                            _h.sent();
                            return [4 /*yield*/, adapter2.setSettings((_g = {}, _g[SCHEMA_VERSION_SETTING_KEY] = String(DOCUMENT_MODEL_SCHEMA_VERSION), _g), __spreadArray([], __read(V1_SETTING_KEYS), false))];
                        case 4:
                            _h.sent();
                            model = __spreadProps(__spreadValues({}, model), { citations: model.citations.map(function (citation) { return __spreadProps(__spreadValues({}, citation), { lastSignature: "v1" }); }) });
                            return [3 /*break*/, 6];
                        case 5:
                            model = createEmptyModel();
                            _h.label = 6;
                        case 6:
                            loaded = true;
                            return [2 /*return*/, model];
                    }
                });
            });
        }
        function ensureLoaded() {
            return __awaiter(this, void 0, void 0, function () {
                return __generator(this, function (_g) {
                    switch (_g.label) {
                        case 0:
                            if (!!loaded) return [3 /*break*/, 2];
                            return [4 /*yield*/, loadModel()];
                        case 1:
                            _g.sent();
                            _g.label = 2;
                        case 2: return [2 /*return*/];
                    }
                });
            });
        }
        function refresh2() {
            return __awaiter(this, arguments, void 0, function (options) {
                var _a, scan, splits, working, applied, texts, splits_3, splits_3_1, split, known, missingSnapshots, plan, diff, rewrite, pending, _g, _h, edit, _j, _k, edit, updates;
                var e_44, _l, e_45, _m, e_46, _o;
                if (options === void 0) { options = {}; }
                return __generator(this, function (_p) {
                    switch (_p.label) {
                        case 0: return [4 /*yield*/, ensureLoaded()];
                        case 1:
                            _p.sent();
                            return [4 /*yield*/, adapter2.scan()];
                        case 2:
                            scan = _p.sent();
                            splits = planDuplicateSplit(scan.ordered, createId);
                            working = model;
                            if (!(splits.length > 0)) return [3 /*break*/, 4];
                            return [4 /*yield*/, adapter2.retagDuplicates(splits)];
                        case 3:
                            _p.sent();
                            applied = applyDuplicateSplit(working, scan.ordered, splits);
                            working = applied.model;
                            texts = new Map(scan.texts);
                            try {
                                for (splits_3 = __values(splits), splits_3_1 = splits_3.next(); !splits_3_1.done; splits_3_1 = splits_3.next()) {
                                    split = splits_3_1.value;
                                    texts.set(split.newCiteId, (_a = scan.texts.get(split.citeId)) != null ? _a : "");
                                }
                            }
                            catch (e_44_1) { e_44 = { error: e_44_1 }; }
                            finally {
                                try {
                                    if (splits_3_1 && !splits_3_1.done && (_l = splits_3.return)) _l.call(splits_3);
                                }
                                finally { if (e_44) throw e_44.error; }
                            }
                            scan = __spreadProps(__spreadValues({}, scan), { ordered: applied.ordered, texts: texts });
                            _p.label = 4;
                        case 4:
                            working = pruneModel(working, scan.ordered);
                            known = scan.ordered.filter(function (citeId) { return findCitation(working, citeId); });
                            missingSnapshots = citedPaperIds(working, known).filter(function (paperId) { return !working.items[paperId]; });
                            if (!(known.length === 0)) return [3 /*break*/, 7];
                            if (!(working !== model)) return [3 /*break*/, 6];
                            return [4 /*yield*/, persist(working)];
                        case 5:
                            _p.sent();
                            _p.label = 6;
                        case 6: return [2 /*return*/, { plan: null, scan: scan, rewritten: 0, pendingManualEdits: [], missingSnapshots: missingSnapshots, splitDuplicates: splits.length }];
                        case 7:
                            plan = planRender(working, known, { hasBibliography: scan.hasBibliography, bookmarkIdBase: bookmarkIdBase() });
                            diff = diffRender(working, scan.texts, plan.citations);
                            rewrite = new Set(options.force ? plan.citations.map(function (citation) { return citation.citeId; }) : diff.rewrite);
                            pending = [];
                            if (!options.force) {
                                if (options.manualEdits === "overwrite") {
                                    try {
                                        for (_g = __values(diff.manualEdits), _h = _g.next(); !_h.done; _h = _g.next()) {
                                            edit = _h.value;
                                            rewrite.add(edit.citeId);
                                        }
                                    }
                                    catch (e_45_1) { e_45 = { error: e_45_1 }; }
                                    finally {
                                        try {
                                            if (_h && !_h.done && (_m = _g.return)) _m.call(_g);
                                        }
                                        finally { if (e_45) throw e_45.error; }
                                    }
                                }
                                else if (options.manualEdits === "keep") {
                                    try {
                                        for (_j = __values(diff.manualEdits), _k = _j.next(); !_k.done; _k = _j.next()) {
                                            edit = _k.value;
                                            working = keepManualEdit(working, edit.citeId, edit.currentText);
                                        }
                                    }
                                    catch (e_46_1) { e_46 = { error: e_46_1 }; }
                                    finally {
                                        try {
                                            if (_k && !_k.done && (_o = _j.return)) _o.call(_j);
                                        }
                                        finally { if (e_46) throw e_46.error; }
                                    }
                                }
                                else {
                                    pending = diff.manualEdits;
                                }
                            }
                            updates = plan.citations.filter(function (citation) { return rewrite.has(citation.citeId); }).map(function (citation) { return ({ citeId: citation.citeId, ooxml: citation.ooxml, fallbackText: citation.text }); });
                            if (!(updates.length > 0)) return [3 /*break*/, 9];
                            return [4 /*yield*/, adapter2.rewriteCitations(updates)];
                        case 8:
                            _p.sent();
                            _p.label = 9;
                        case 9:
                            if (!scan.hasBibliography) return [3 /*break*/, 11];
                            return [4 /*yield*/, adapter2.writeBibliography(plan.bibliographyOoxml, plan.bibliographyText, "update")];
                        case 10:
                            _p.sent();
                            _p.label = 11;
                        case 11:
                            working = recordRendered(working, plan.citations, __spreadArray(__spreadArray([], __read(rewrite), false), __read(diff.unchanged), false));
                            return [4 /*yield*/, persist(working)];
                        case 12:
                            _p.sent();
                            return [2 /*return*/, {
                                    plan: plan,
                                    scan: scan,
                                    rewritten: updates.length,
                                    pendingManualEdits: pending,
                                    missingSnapshots: missingSnapshots,
                                    splitDuplicates: splits.length
                                }];
                    }
                });
            });
        }
        function insertCitation2(items, papers) {
            return __awaiter(this, void 0, void 0, function () {
                var citeId, next, provisional, first;
                return __generator(this, function (_g) {
                    switch (_g.label) {
                        case 0: return [4 /*yield*/, ensureLoaded()];
                        case 1:
                            _g.sent();
                            if (items.length === 0)
                                throw new Error("请先选择至少一篇文献。");
                            citeId = createId();
                            next = upsertSnapshots(model, papers);
                            next = upsertCitation(next, { citeId: citeId, items: items, updatedAt: Date.now() });
                            provisional = planRender(next, [citeId], { hasBibliography: false });
                            first = provisional.citations[0];
                            return [4 /*yield*/, persist(next)];
                        case 2:
                            _g.sent();
                            return [4 /*yield*/, adapter2.insertCitation(citeId, first.ooxml, first.text)];
                        case 3:
                            _g.sent();
                            return [2 /*return*/, refresh2({ manualEdits: "ask" })];
                    }
                });
            });
        }
        function editCitation(citeId, items, papers) {
            return __awaiter(this, void 0, void 0, function () {
                var next;
                return __generator(this, function (_g) {
                    switch (_g.label) {
                        case 0: return [4 /*yield*/, ensureLoaded()];
                        case 1:
                            _g.sent();
                            if (items.length === 0)
                                return [2 /*return*/, removeCitationOp(citeId)];
                            next = upsertSnapshots(model, papers);
                            next = upsertCitation(next, { citeId: citeId, items: items, updatedAt: Date.now() });
                            return [4 /*yield*/, persist(next)];
                        case 2:
                            _g.sent();
                            return [2 /*return*/, refresh2({ manualEdits: "ask" })];
                    }
                });
            });
        }
        function removeCitationOp(citeId) {
            return __awaiter(this, void 0, void 0, function () {
                return __generator(this, function (_g) {
                    switch (_g.label) {
                        case 0: return [4 /*yield*/, ensureLoaded()];
                        case 1:
                            _g.sent();
                            return [4 /*yield*/, adapter2.deleteCitation(citeId)];
                        case 2:
                            _g.sent();
                            return [4 /*yield*/, persist(removeCitation(model, citeId))];
                        case 3:
                            _g.sent();
                            return [2 /*return*/, refresh2({ manualEdits: "ask" })];
                    }
                });
            });
        }
        function insertOrUpdateBibliography() {
            return __awaiter(this, void 0, void 0, function () {
                var scan, known, plan;
                return __generator(this, function (_g) {
                    switch (_g.label) {
                        case 0: return [4 /*yield*/, ensureLoaded()];
                        case 1:
                            _g.sent();
                            return [4 /*yield*/, adapter2.scan()];
                        case 2:
                            scan = _g.sent();
                            known = scan.ordered.filter(function (citeId) { return findCitation(model, citeId); });
                            if (known.length === 0)
                                throw new Error("文档里还没有 PaperQuay 引用，无法生成参考文献表。");
                            if (!!scan.hasBibliography) return [3 /*break*/, 4];
                            plan = planRender(model, known, { hasBibliography: true, bookmarkIdBase: bookmarkIdBase() });
                            return [4 /*yield*/, adapter2.writeBibliography(plan.bibliographyOoxml, plan.bibliographyText, "insertAtSelection")];
                        case 3:
                            _g.sent();
                            _g.label = 4;
                        case 4: return [2 /*return*/, refresh2({ manualEdits: "ask" })];
                    }
                });
            });
        }
        function updatePrefs2(patch) {
            return __awaiter(this, void 0, void 0, function () {
                return __generator(this, function (_g) {
                    switch (_g.label) {
                        case 0: return [4 /*yield*/, ensureLoaded()];
                        case 1:
                            _g.sent();
                            return [4 /*yield*/, persist(__spreadProps(__spreadValues({}, model), { prefs: normalizePrefs(__spreadValues(__spreadValues({}, model.prefs), patch)) }))];
                        case 2:
                            _g.sent();
                            return [2 /*return*/, refresh2({ manualEdits: "ask" })];
                    }
                });
            });
        }
        function unlink(stripLinks) {
            return __awaiter(this, void 0, void 0, function () {
                var removed;
                return __generator(this, function (_g) {
                    switch (_g.label) {
                        case 0: return [4 /*yield*/, ensureLoaded()];
                        case 1:
                            _g.sent();
                            return [4 /*yield*/, adapter2.unlinkAll(stripLinks)];
                        case 2:
                            removed = _g.sent();
                            return [4 /*yield*/, persist(__spreadProps(__spreadValues({}, createEmptyModel(model.documentId)), { prefs: model.prefs }))];
                        case 3:
                            _g.sent();
                            return [2 /*return*/, removed];
                    }
                });
            });
        }
        function applySnapshots(papers, missing) {
            return __awaiter(this, void 0, void 0, function () {
                return __generator(this, function (_g) {
                    switch (_g.label) {
                        case 0: return [4 /*yield*/, ensureLoaded()];
                        case 1:
                            _g.sent();
                            return [4 /*yield*/, persist(upsertSnapshots(model, papers, missing))];
                        case 2:
                            _g.sent();
                            return [2 /*return*/];
                    }
                });
            });
        }
        return {
            loadModel: loadModel,
            getModel: function () { return model; },
            updatePrefs: updatePrefs2,
            insertCitation: insertCitation2,
            editCitation: editCitation,
            removeCitation: removeCitationOp,
            refresh: refresh2,
            insertOrUpdateBibliography: insertOrUpdateBibliography,
            unlink: unlink,
            applySnapshots: applySnapshots,
            citedPaperIds: function () { return citedPaperIds(model); }
        };
    }
    // office-addin/src/word/queue.ts
    function createTaskQueue() {
        var tail = Promise.resolve();
        var active = null;
        var pending = 0;
        var listeners = [];
        function notify2() {
            var e_47, _g;
            try {
                for (var listeners_2 = __values(listeners), listeners_2_1 = listeners_2.next(); !listeners_2_1.done; listeners_2_1 = listeners_2.next()) {
                    var listener = listeners_2_1.value;
                    listener(active);
                }
            }
            catch (e_47_1) { e_47 = { error: e_47_1 }; }
            finally {
                try {
                    if (listeners_2_1 && !listeners_2_1.done && (_g = listeners_2.return)) _g.call(listeners_2);
                }
                finally { if (e_47) throw e_47.error; }
            }
        }
        return {
            run: function (label, task) {
                var _this = this;
                pending += 1;
                var next = tail.then(function () { return __awaiter(_this, void 0, void 0, function () {
                    return __generator(this, function (_g) {
                        switch (_g.label) {
                            case 0:
                                active = label;
                                notify2();
                                _g.label = 1;
                            case 1:
                                _g.trys.push([1, , 3, 4]);
                                return [4 /*yield*/, task()];
                            case 2: return [2 /*return*/, _g.sent()];
                            case 3:
                                pending -= 1;
                                active = pending > 0 ? active : null;
                                notify2();
                                return [7 /*endfinally*/];
                            case 4: return [2 /*return*/];
                        }
                    });
                }); });
                tail = next.catch(function () { return void 0; });
                return next;
            },
            busy: function () { return active; },
            onChange: function (listener) {
                listeners.push(listener);
            }
        };
    }
    // office-addin/src/taskpane.ts
    var SEARCH_LIMIT = 30;
    var state = {
        results: [],
        activeIndex: -1,
        selected: /* @__PURE__ */ new Map(),
        editor: null,
        lastRefresh: null,
        log: []
    };
    var client = createBridgeClient();
    var queue = createTaskQueue();
    var adapter;
    var ops;
    function log(message) {
        var stamp = ( /* @__PURE__ */new Date()).toTimeString().slice(0, 8);
        state.log.unshift("[".concat(stamp, "] ").concat(message));
        state.log = state.log.slice(0, 60);
        var node = byId("log");
        node.textContent = state.log.join("\n");
        show(node, true);
    }
    function notify(message, kind, actions) {
        var e_48, _g;
        if (kind === void 0) { kind = "info"; }
        if (actions === void 0) { actions = []; }
        var node = byId("notice");
        clear(node);
        node.className = kind === "error" ? "notice notice--error" : "notice";
        node.appendChild(h("div", { text: message }));
        var row = h("div", { className: "actions" });
        var _loop_4 = function (action) {
            var button = h("button", { className: "button", text: action.label, attrs: { type: "button" } });
            button.addEventListener("click", function () {
                show(node, false);
                action.run();
            });
            row.appendChild(button);
        };
        try {
            for (var actions_1 = __values(actions), actions_1_1 = actions_1.next(); !actions_1_1.done; actions_1_1 = actions_1.next()) {
                var action = actions_1_1.value;
                _loop_4(action);
            }
        }
        catch (e_48_1) { e_48 = { error: e_48_1 }; }
        finally {
            try {
                if (actions_1_1 && !actions_1_1.done && (_g = actions_1.return)) _g.call(actions_1);
            }
            finally { if (e_48) throw e_48.error; }
        }
        var dismiss = h("button", { className: "link-button", text: "关闭", attrs: { type: "button" } });
        dismiss.addEventListener("click", function () { return show(node, false); });
        row.appendChild(dismiss);
        node.appendChild(row);
        show(node, true);
    }
    function fail(prefix, error) {
        var message = "".concat(prefix, "\uFF1A").concat(errorMessage(error));
        log(message);
        notify(message, "error");
    }
    function perform(label, task) {
        return queue.run(label, task).catch(function (error) {
            fail(label + "失败", error);
            return void 0;
        });
    }
    function renderConnection() {
        var status = byId("bridge-status");
        var current = client.state();
        var health = client.health();
        if (current === "online") {
            status.textContent = "\u5DF2\u8FDE\u63A5 PaperQuay".concat((health == null ? void 0 : health.appVersion) ? " " + health.appVersion : "");
            status.className = "status status--ok";
        }
        else if (current === "connecting") {
            status.textContent = "正在连接…";
            status.className = "status status--idle";
        }
        else {
            status.textContent = "未连接";
            status.className = "status status--error";
        }
        show(byId("offline-banner"), current === "offline");
        updateButtons();
    }
    function updateButtons() {
        var online = client.state() === "online";
        byId("insert-citation-button").disabled = !online || state.selected.size === 0;
        byId("editor-add-button").disabled = state.selected.size === 0;
        byId("update-items-button").disabled = !online;
        byId("quick-cite-button").disabled = !online;
    }
    function citedIds() {
        return new Set(ops ? ops.citedPaperIds() : []);
    }
    function renderSearchResults() {
        var container = byId("search-results");
        clear(container);
        var cited = citedIds();
        state.results.forEach(function (paper, index) {
            var checkbox = h("input", { attrs: { type: "checkbox", tabindex: "-1" } });
            checkbox.checked = state.selected.has(paper.id);
            var row = h("div", {
                className: "result" + (state.selected.has(paper.id) ? " result--selected" : "") + (index === state.activeIndex ? " result--active" : "") + (cited.has(paper.id) ? " result--cited" : ""),
                attrs: { role: "option" }
            }, [
                checkbox,
                h("div", { className: "result__body" }, [
                    h("div", { className: "result__title", text: paper.title || "(无标题)" }),
                    h("div", { className: "result__meta", text: paperMetaLine(paper) })
                ])
            ]);
            row.addEventListener("click", function () { return toggleSelected(paper); });
            container.appendChild(row);
        });
        if (state.results.length === 0 && byId("search-input").value.trim()) {
            container.appendChild(h("div", { className: "hint", text: client.state() === "online" ? "没有匹配的文献。" : "未连接 PaperQuay，无法检索。" }));
        }
        renderSelection();
    }
    function toggleSelected(paper) {
        if (state.selected.has(paper.id))
            state.selected.delete(paper.id);
        else
            state.selected.set(paper.id, paper);
        renderSearchResults();
    }
    function renderSelection() {
        var node = byId("selection");
        if (state.selected.size === 0)
            node.textContent = "未选择文献（Enter 选中高亮项，Ctrl+Enter 插入）";
        else {
            var titles_1 = [];
            state.selected.forEach(function (paper) { return titles_1.push(paper.title || "(无标题)"); });
            node.textContent = "\u5DF2\u9009 ".concat(state.selected.size, " \u7BC7\uFF1A").concat(titles_1.join("；"));
        }
        updateButtons();
    }
    var searchSeq = 0;
    function searchPapers() {
        return __awaiter(this, void 0, void 0, function () {
            var query, seq, result, error_5;
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0:
                        query = byId("search-input").value.trim();
                        seq = searchSeq += 1;
                        if (client.state() !== "online") {
                            state.results = [];
                            renderSearchResults();
                            return [2 /*return*/];
                        }
                        _g.label = 1;
                    case 1:
                        _g.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, client.searchPapers(query, SEARCH_LIMIT)];
                    case 2:
                        result = _g.sent();
                        if (seq !== searchSeq)
                            return [2 /*return*/];
                        state.results = result.papers;
                        state.activeIndex = state.results.length > 0 ? 0 : -1;
                        renderSearchResults();
                        return [3 /*break*/, 4];
                    case 3:
                        error_5 = _g.sent();
                        if (seq === searchSeq)
                            log("\u68C0\u7D22\u5931\u8D25\uFF1A".concat(errorMessage(error_5)));
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    }
    function citationItemsFromSelection() {
        var locator = byId("locator-input").value.trim();
        var prefix = byId("prefix-input").value.trim();
        var suffix = byId("suffix-input").value.trim();
        var suppressAuthor = byId("suppress-author-input").checked;
        var papers = [];
        state.selected.forEach(function (paper) { return papers.push(paper); });
        var items = papers.map(function (paper, index) { return ({
            paperId: paper.id,
            label: paper.title,
            locator: papers.length === 1 ? locator || null : null,
            prefix: index === 0 ? prefix || null : null,
            suffix: index === papers.length - 1 ? suffix || null : null,
            suppressAuthor: suppressAuthor
        }); });
        return { items: items, papers: papers };
    }
    function clearSelectionInputs() {
        var e_49, _g;
        state.selected.clear();
        try {
            for (var _h = __values(["locator-input", "prefix-input", "suffix-input"]), _j = _h.next(); !_j.done; _j = _h.next()) {
                var id = _j.value;
                byId(id).value = "";
            }
        }
        catch (e_49_1) { e_49 = { error: e_49_1 }; }
        finally {
            try {
                if (_j && !_j.done && (_g = _h.return)) _g.call(_h);
            }
            finally { if (e_49) throw e_49.error; }
        }
        byId("suppress-author-input").checked = false;
        renderSearchResults();
    }
    function afterRefresh(result, message) {
        if (!result)
            return;
        state.lastRefresh = result;
        renderCitationList();
        renderSearchResults();
        if (result.splitDuplicates > 0)
            log("\u68C0\u6D4B\u5230 ".concat(result.splitDuplicates, " \u5904\u590D\u5236\u7C98\u8D34\u7684\u5F15\u7528\uFF0C\u5DF2\u62C6\u5206\u4E3A\u72EC\u7ACB\u5F15\u7528\u3002"));
        if (result.missingSnapshots.length > 0) {
            if (client.state() === "online")
                void updateItemsFromLibrary(true);
            else
                log("".concat(result.missingSnapshots.length, " \u7BC7\u6587\u732E\u7F3A\u5C11\u6761\u76EE\u4FE1\u606F\uFF0C\u8FDE\u63A5 PaperQuay \u540E\u4F1A\u81EA\u52A8\u8865\u9F50\u3002"));
        }
        if (result.pendingManualEdits.length > 0)
            promptManualEdits(result.pendingManualEdits);
        if (message)
            log(message);
        renderDiagnostics();
    }
    function promptManualEdits(edits) {
        var sample = edits.slice(0, 3).map(function (edit) { return "\u300C".concat(edit.currentText.trim(), "\u300D\u2192\u300C").concat(edit.expectedText, "\u300D"); }).join("；");
        notify("\u6709 ".concat(edits.length, " \u5904\u5F15\u7528\u88AB\u624B\u52A8\u4FEE\u6539\u8FC7\uFF1A").concat(sample, "\u3002\u5237\u65B0\u65F6\u8981\u600E\u4E48\u5904\u7406\uFF1F"), "info", [
            { label: "保留我的修改", run: function () { return void refresh("keep"); } },
            { label: "用 PaperQuay 覆盖", run: function () { return void refresh("overwrite"); } }
        ]);
    }
    function warnIfTracking() {
        return __awaiter(this, void 0, void 0, function () {
            var tracking;
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0: return [4 /*yield*/, adapter.isTrackingChanges()];
                    case 1:
                        tracking = _g.sent();
                        if (tracking)
                            log("提示：文档处于修订模式，引用更新会记为修订。");
                        return [2 /*return*/];
                }
            });
        });
    }
    function refresh(manualEdits, silent) {
        var _this = this;
        if (manualEdits === void 0) { manualEdits = "ask"; }
        if (silent === void 0) { silent = false; }
        return perform("刷新", function () { return __awaiter(_this, void 0, void 0, function () {
            var result;
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0: return [4 /*yield*/, ops.refresh({ manualEdits: manualEdits })];
                    case 1:
                        result = _g.sent();
                        afterRefresh(result, silent ? void 0 : result.plan ? "\u5DF2\u5237\u65B0\uFF1A".concat(result.plan.render.entries.length, " \u6761\u6587\u732E\uFF0C\u66F4\u65B0\u4E86 ").concat(result.rewritten, " \u5904\u5F15\u7528\u3002") : "文档里还没有 PaperQuay 引用。");
                        return [2 /*return*/];
                }
            });
        }); }).then(function () { return void 0; });
    }
    function insertCitation() {
        var _this = this;
        var _g = citationItemsFromSelection(), items = _g.items, papers = _g.papers;
        if (items.length === 0) {
            notify("请先在检索结果里选中至少一篇文献。");
            return Promise.resolve();
        }
        return perform("插入引用", function () { return __awaiter(_this, void 0, void 0, function () {
            var result;
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0: return [4 /*yield*/, warnIfTracking()];
                    case 1:
                        _g.sent();
                        return [4 /*yield*/, ops.insertCitation(items, papers)];
                    case 2:
                        result = _g.sent();
                        clearSelectionInputs();
                        afterRefresh(result, "\u5DF2\u63D2\u5165\u5F15\u7528\uFF08".concat(items.length, " \u7BC7\uFF09\u3002"));
                        void writeBackCited();
                        return [2 /*return*/];
                }
            });
        }); }).then(function () { return void 0; });
    }
    function insertBibliography() {
        var _this = this;
        return perform("插入参考文献表", function () { return __awaiter(_this, void 0, void 0, function () {
            var result;
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0: return [4 /*yield*/, ops.insertOrUpdateBibliography()];
                    case 1:
                        result = _g.sent();
                        afterRefresh(result, "\u53C2\u8003\u6587\u732E\u8868\u5DF2\u5C31\u4F4D\uFF1A".concat(result.plan ? result.plan.render.entries.length : 0, " \u6761\uFF0C\u6B63\u6587\u5F15\u7528\u53EF\u70B9\u51FB\u8DF3\u8F6C\u3002"));
                        return [2 /*return*/];
                }
            });
        }); }).then(function () { return void 0; });
    }
    function writeBackCited() {
        return __awaiter(this, void 0, void 0, function () {
            var paperIds, error_6;
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0:
                        if (client.state() !== "online")
                            return [2 /*return*/];
                        paperIds = ops.citedPaperIds();
                        if (paperIds.length === 0)
                            return [2 /*return*/];
                        _g.label = 1;
                    case 1:
                        _g.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, client.recordCited({ documentId: ops.getModel().documentId, documentTitle: adapter.documentTitle(), paperIds: paperIds })];
                    case 2:
                        _g.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        error_6 = _g.sent();
                        log("\u5199\u56DE\u300C\u672C\u6587\u5F15\u7528\u8FC7\u300D\u5931\u8D25\uFF1A".concat(errorMessage(error_6)));
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    }
    function updateItemsFromLibrary(automatic) {
        var _this = this;
        if (automatic === void 0) { automatic = false; }
        return perform("更新条目", function () { return __awaiter(_this, void 0, void 0, function () {
            var ids, _g, papers, missing, result;
            return __generator(this, function (_h) {
                switch (_h.label) {
                    case 0:
                        ids = ops.citedPaperIds();
                        if (ids.length === 0)
                            return [2 /*return*/];
                        return [4 /*yield*/, client.fetchPapers(ids)];
                    case 1:
                        _g = _h.sent(), papers = _g.papers, missing = _g.missing;
                        return [4 /*yield*/, ops.applySnapshots(papers, missing)];
                    case 2:
                        _h.sent();
                        return [4 /*yield*/, ops.refresh({ manualEdits: "ask" })];
                    case 3:
                        result = _h.sent();
                        afterRefresh(result, automatic ? void 0 : "\u5DF2\u4ECE\u6587\u732E\u5E93\u66F4\u65B0 ".concat(papers.length, " \u6761").concat(missing.length ? "\uFF0C".concat(missing.length, " \u6761\u5E93\u4E2D\u5DF2\u4E0D\u5B58\u5728\uFF08\u4FDD\u7559\u6587\u6863\u5185\u4FE1\u606F\uFF09") : "", "\u3002"));
                        return [2 /*return*/];
                }
            });
        }); }).then(function () { return void 0; });
    }
    function paperLabel(paperId, fallback) {
        var snapshot = ops.getModel().items[paperId];
        return (snapshot == null ? void 0 : snapshot.paper.title) || fallback || paperId;
    }
    function renderCitationList() {
        var e_50, _g, e_51, _h, e_52, _j;
        var _this = this;
        var _a, _b, _c;
        var container = byId("document-citations");
        clear(container);
        var model = ops.getModel();
        var plan = (_a = state.lastRefresh) == null ? void 0 : _a.plan;
        var ordered = (_c = (_b = state.lastRefresh) == null ? void 0 : _b.scan.ordered) != null ? _c : model.citations.map(function (citation) { return citation.citeId; });
        var seqByPaperId = /* @__PURE__ */ new Map();
        if (plan)
            try {
                for (var _k = __values(plan.render.entries), _l = _k.next(); !_l.done; _l = _k.next()) {
                    var entry = _l.value;
                    seqByPaperId.set(entry.paperId, entry.seq);
                }
            }
            catch (e_50_1) { e_50 = { error: e_50_1 }; }
            finally {
                try {
                    if (_l && !_l.done && (_g = _k.return)) _g.call(_k);
                }
                finally { if (e_50) throw e_50.error; }
            }
        var numeric = plan ? plan.render.kind === "numeric" : citationStyleKind(model.prefs.style) === "numeric";
        var textByCite = /* @__PURE__ */ new Map();
        if (plan)
            try {
                for (var _m = __values(plan.citations), _o = _m.next(); !_o.done; _o = _m.next()) {
                    var citation = _o.value;
                    textByCite.set(citation.citeId, citation.text);
                }
            }
            catch (e_51_1) { e_51 = { error: e_51_1 }; }
            finally {
                try {
                    if (_o && !_o.done && (_h = _m.return)) _h.call(_m);
                }
                finally { if (e_51) throw e_51.error; }
            }
        var count = 0;
        var seen = /* @__PURE__ */ new Set();
        var _loop_5 = function (citeId) {
            var citation = model.citations.find(function (item) { return item.citeId === citeId; });
            if (!citation || seen.has(citeId))
                return "continue";
            seen.add(citeId);
            count += 1;
            var missing = citation.items.some(function (item) {
                var _a2;
                return ((_a2 = model.items[item.paperId]) == null ? void 0 : _a2.missing) || !model.items[item.paperId];
            });
            var titles = citation.items.map(function (item) {
                var seq = seqByPaperId.get(item.paperId);
                return "".concat(numeric && seq ? "[".concat(seq, "] ") : "").concat(paperLabel(item.paperId, item.label));
            });
            var locate = h("button", { className: "link-button", text: "定位", attrs: { type: "button" } });
            locate.addEventListener("click", function () { return void perform("定位", function () { return adapter.select({ citeId: citeId }); }); });
            var edit = h("button", { className: "link-button", text: "编辑", attrs: { type: "button" } });
            edit.addEventListener("click", function () { return openEditor(citeId); });
            var remove = h("button", { className: "link-button", text: "删除", attrs: { type: "button" } });
            remove.addEventListener("click", function () { return void perform("删除引用", function () { return __awaiter(_this, void 0, void 0, function () { var _g; return __generator(this, function (_h) {
                switch (_h.label) {
                    case 0:
                        _g = afterRefresh;
                        return [4 /*yield*/, ops.removeCitation(citeId)];
                    case 1: return [2 /*return*/, _g.apply(void 0, [_h.sent(), "已删除一条引用。"])];
                }
            }); }); }); });
            var meta = [
                textByCite.get(citeId) || citation.lastText || "",
                citation.manualText !== void 0 ? "已保留手改" : "",
                missing ? "部分文献不在库中（使用文档内信息）" : ""
            ].filter(Boolean).join(" · ");
            container.appendChild(h("div", { className: "citation" + (missing ? " citation--missing" : "") }, [
                h("div", { className: "citation__body" }, [
                    h("div", { className: "citation__title", text: titles.join("；") }),
                    h("div", { className: "citation__meta", text: meta })
                ]),
                h("div", { className: "actions" }, [locate, edit, remove])
            ]));
        };
        try {
            for (var ordered_3 = __values(ordered), ordered_3_1 = ordered_3.next(); !ordered_3_1.done; ordered_3_1 = ordered_3.next()) {
                var citeId = ordered_3_1.value;
                _loop_5(citeId);
            }
        }
        catch (e_52_1) { e_52 = { error: e_52_1 }; }
        finally {
            try {
                if (ordered_3_1 && !ordered_3_1.done && (_j = ordered_3.return)) _j.call(ordered_3);
            }
            finally { if (e_52) throw e_52.error; }
        }
        byId("citation-count").textContent = count > 0 ? "\uFF08".concat(count, " \u5904\uFF0C").concat(plan ? plan.render.entries.length : "?", " \u7BC7\uFF09") : "";
        if (count === 0)
            container.appendChild(h("div", { className: "hint", text: "文档里还没有 PaperQuay 引用。" }));
    }
    function openEditor(citeId) {
        var citation = ops.getModel().citations.find(function (item) { return item.citeId === citeId; });
        if (!citation)
            return;
        state.editor = { citeId: citeId, items: citation.items.map(function (item) { return __spreadValues({}, item); }) };
        renderEditor();
    }
    function renderEditor() {
        var card = byId("editor-card");
        var editor = state.editor;
        show(card, Boolean(editor));
        if (!editor)
            return;
        var current = ops.getModel().citations.find(function (item) { return item.citeId === editor.citeId; });
        byId("editor-text").textContent = (current == null ? void 0 : current.lastText) ? "\uFF08".concat(current.lastText, "\uFF09") : "";
        var container = byId("editor-items");
        clear(container);
        editor.items.forEach(function (item, index) {
            var locator = h("input", { attrs: { type: "text", placeholder: "页码" } });
            locator.value = item.locator || "";
            locator.addEventListener("change", function () {
                item.locator = locator.value.trim() || null;
            });
            var up = h("button", { className: "link-button", text: "↑", title: "上移", attrs: { type: "button" } });
            up.addEventListener("click", function () {
                if (index === 0)
                    return;
                var moved = editor.items.splice(index, 1)[0];
                editor.items.splice(index - 1, 0, moved);
                renderEditor();
            });
            var remove = h("button", { className: "link-button", text: "移除", attrs: { type: "button" } });
            remove.addEventListener("click", function () {
                editor.items.splice(index, 1);
                renderEditor();
            });
            container.appendChild(h("div", { className: "citation" }, [
                h("div", { className: "citation__body" }, [h("div", { className: "citation__title", text: paperLabel(item.paperId, item.label) })]),
                h("div", { className: "item-row" }, [locator, up, remove])
            ]));
        });
        if (editor.items.length === 0)
            container.appendChild(h("div", { className: "hint", text: "已移除全部文献：保存后将删除该引用。" }));
        updateButtons();
    }
    function saveEditor() {
        var _this = this;
        var editor = state.editor;
        if (!editor)
            return Promise.resolve();
        var papers = [];
        state.selected.forEach(function (paper) { return papers.push(paper); });
        return perform("保存引用修改", function () { return __awaiter(_this, void 0, void 0, function () {
            var result;
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0: return [4 /*yield*/, ops.editCitation(editor.citeId, editor.items, papers)];
                    case 1:
                        result = _g.sent();
                        state.editor = null;
                        renderEditor();
                        afterRefresh(result, "引用已更新。");
                        void writeBackCited();
                        return [2 /*return*/];
                }
            });
        }); }).then(function () { return void 0; });
    }
    var syncEditorWithSelection = debounce(function () {
        if (!ops)
            return;
        if (queue.busy())
            return;
        void adapter.citeIdAtSelection().then(function (citeId) {
            if (citeId && (!state.editor || state.editor.citeId !== citeId))
                openEditor(citeId);
        });
    }, 300);
    function renderPrefs() {
        var e_53, _g;
        var prefs = ops.getModel().prefs;
        var select = byId("style-select");
        clear(select);
        try {
            for (var CITATION_STYLES_1 = __values(CITATION_STYLES), CITATION_STYLES_1_1 = CITATION_STYLES_1.next(); !CITATION_STYLES_1_1.done; CITATION_STYLES_1_1 = CITATION_STYLES_1.next()) {
                var style = CITATION_STYLES_1_1.value;
                var option = h("option", {
                    text: "".concat(style.label, "\uFF08").concat(style.kind === "numeric" ? "顺序编码" : "著者-出版年", "\uFF09"),
                    title: style.description,
                    attrs: { value: style.id }
                });
                option.selected = style.id === prefs.style;
                select.appendChild(option);
            }
        }
        catch (e_53_1) { e_53 = { error: e_53_1 }; }
        finally {
            try {
                if (CITATION_STYLES_1_1 && !CITATION_STYLES_1_1.done && (_g = CITATION_STYLES_1.return)) _g.call(CITATION_STYLES_1);
            }
            finally { if (e_53) throw e_53.error; }
        }
        byId("punctuation-select").value = prefs.punctuation;
        byId("bib-order-select").value = prefs.bibliographyOrder;
        byId("bibliography-title-input").value = prefs.bibliographyTitle;
        byId("bib-heading-input").checked = prefs.bibHeading;
        byId("superscript-input").checked = prefs.superscript;
        byId("links-input").checked = prefs.links;
        show(byId("punctuation-row"), prefs.style === "gbt7714-87");
        show(byId("bib-order-row"), citationStyleKind(prefs.style) === "author-date");
    }
    function updatePrefs(patch, message) {
        var _this = this;
        void perform("更新首选项", function () { return __awaiter(_this, void 0, void 0, function () {
            var result;
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0: return [4 /*yield*/, ops.updatePrefs(patch)];
                    case 1:
                        result = _g.sent();
                        renderPrefs();
                        afterRefresh(result, message);
                        return [2 /*return*/];
                }
            });
        }); });
    }
    function openQuickCite() {
        if (!adapter.capabilities().dialogApi) {
            byId("search-input").focus();
            return;
        }
        var url = "".concat(window.location.protocol, "//").concat(window.location.host, "/dialog.html");
        Office.context.ui.displayDialogAsync(url, { height: 45, width: 40, displayInIframe: true }, function (result) {
            if (result.status !== Office.AsyncResultStatus.Succeeded) {
                log("\u6253\u5F00\u5FEB\u901F\u5F15\u7528\u5BF9\u8BDD\u6846\u5931\u8D25\uFF1A".concat(result.error.message));
                byId("search-input").focus();
                return;
            }
            var dialog = result.value;
            dialog.addEventHandler(Office.EventType.DialogMessageReceived, function (arg) {
                var e_54, _g;
                var message = arg;
                dialog.close();
                var payload = null;
                try {
                    payload = JSON.parse(message.message || "null");
                }
                catch (e) {
                    payload = null;
                }
                if (!payload || !Array.isArray(payload.papers) || payload.papers.length === 0)
                    return;
                state.selected.clear();
                try {
                    for (var _h = __values(payload.papers), _j = _h.next(); !_j.done; _j = _h.next()) {
                        var paper = _j.value;
                        state.selected.set(paper.id, paper);
                    }
                }
                catch (e_54_1) { e_54 = { error: e_54_1 }; }
                finally {
                    try {
                        if (_j && !_j.done && (_g = _h.return)) _g.call(_h);
                    }
                    finally { if (e_54) throw e_54.error; }
                }
                byId("locator-input").value = payload.locator || "";
                void insertCitation();
            });
        });
    }
    function renderDiagnostics() {
        var _a, _b;
        var caps = adapter ? adapter.capabilities() : null;
        var model = ops ? ops.getModel() : null;
        var host = "";
        try {
            host = "".concat(Office.context.diagnostics.platform, " ").concat(Office.context.diagnostics.version);
        }
        catch (e) {
            host = "未知";
        }
        var lines = [
            "\u52A0\u8F7D\u9879\uFF1A0.4.0\uFF08\u6587\u6863\u6A21\u578B v2\uFF09",
            "Word\uFF1A".concat(host),
            "\u5185\u6838\uFF1A".concat(navigator.userAgent),
            "WordApi 1.3\uFF1A".concat((caps == null ? void 0 : caps.wordApi13) ? "支持" : "不支持", " \u00B7 Custom XML\uFF1A").concat((caps == null ? void 0 : caps.customXmlParts) ? "支持" : "不支持", " \u00B7 \u5BF9\u8BDD\u6846\uFF1A").concat((caps == null ? void 0 : caps.dialogApi) ? "支持" : "不支持"),
            "Service Worker\uFF1A".concat("serviceWorker" in navigator ? "可用" : "不可用"),
            "\u8FDE\u63A5\uFF1A".concat(client.state()).concat(client.health() ? "\uFF08PaperQuay ".concat((_a = client.health()) == null ? void 0 : _a.appVersion, "\uFF0CapiVersion ").concat((_b = client.health()) == null ? void 0 : _b.apiVersion, "\uFF09") : ""),
            "\u6587\u6863\uFF1A".concat(model ? "".concat(model.citations.length, " \u6761\u5F15\u7528\u8BB0\u5F55\uFF0C").concat(Object.keys(model.items).length, " \u7BC7\u5FEB\u7167\uFF0Crev ").concat(model.rev, "\uFF0C\u6837\u5F0F ").concat(model.prefs.style) : "未加载")
        ];
        byId("diagnostics").textContent = lines.join("\n");
    }
    function bindEvents() {
        var _this = this;
        var search = byId("search-input");
        var debouncedSearch = debounce(function () { return void searchPapers(); }, 250);
        search.addEventListener("input", function () { return debouncedSearch(); });
        search.addEventListener("keydown", function (event) {
            if (event.key === "ArrowDown" || event.key === "Down") {
                state.activeIndex = Math.min(state.results.length - 1, state.activeIndex + 1);
                renderSearchResults();
                event.preventDefault();
            }
            else if (event.key === "ArrowUp" || event.key === "Up") {
                state.activeIndex = Math.max(0, state.activeIndex - 1);
                renderSearchResults();
                event.preventDefault();
            }
            else if (event.key === "Enter") {
                if (event.ctrlKey || state.selected.size > 0 && state.activeIndex < 0) {
                    void insertCitation();
                }
                else if (state.results[state.activeIndex]) {
                    toggleSelected(state.results[state.activeIndex]);
                }
                event.preventDefault();
            }
        });
        byId("retry-button").addEventListener("click", function () { return void client.probe(); });
        byId("quick-cite-button").addEventListener("click", openQuickCite);
        byId("insert-citation-button").addEventListener("click", function () { return void insertCitation(); });
        byId("insert-bibliography-button").addEventListener("click", function () { return void insertBibliography(); });
        byId("refresh-button").addEventListener("click", function () { return void refresh("ask"); });
        byId("update-items-button").addEventListener("click", function () { return void updateItemsFromLibrary(); });
        byId("editor-save-button").addEventListener("click", function () { return void saveEditor(); });
        byId("editor-cancel-button").addEventListener("click", function () {
            state.editor = null;
            renderEditor();
        });
        byId("editor-add-button").addEventListener("click", function () {
            var editor = state.editor;
            if (!editor)
                return;
            state.selected.forEach(function (paper) {
                if (!editor.items.some(function (item) { return item.paperId === paper.id; }))
                    editor.items.push({ paperId: paper.id, label: paper.title });
            });
            renderEditor();
        });
        byId("style-select").addEventListener("change", function () {
            var style = normalizeCitationStyle(byId("style-select").value);
            updatePrefs({ style: style }, "\u5F15\u7528\u6837\u5F0F\u5DF2\u5207\u6362\u4E3A ".concat(style, "\u3002"));
        });
        byId("punctuation-select").addEventListener("change", function () { return updatePrefs({ punctuation: byId("punctuation-select").value === "half" ? "half" : "full" }, "GB 7714-87 标点已切换。"); });
        byId("bib-order-select").addEventListener("change", function () { return updatePrefs({ bibliographyOrder: byId("bib-order-select").value === "appearance" ? "appearance" : "alpha" }, "文献表排序已切换。"); });
        byId("bibliography-title-input").addEventListener("change", function () { return updatePrefs({ bibliographyTitle: byId("bibliography-title-input").value.trim() }, "参考文献表标题已更新。"); });
        byId("bib-heading-input").addEventListener("change", function () { return updatePrefs({ bibHeading: byId("bib-heading-input").checked }, "参考文献表标题行设置已更新。"); });
        byId("superscript-input").addEventListener("change", function () { return updatePrefs({ superscript: byId("superscript-input").checked }, "上标设置已更新。"); });
        byId("links-input").addEventListener("change", function () { return updatePrefs({ links: byId("links-input").checked }, "跳转链接设置已更新。"); });
        var unlinkButton = byId("unlink-button");
        var unlinkConfirm = byId("unlink-confirm-button");
        unlinkButton.addEventListener("click", function () {
            show(unlinkConfirm, true);
            setTimeout(function () { return show(unlinkConfirm, false); }, 6e3);
        });
        unlinkConfirm.addEventListener("click", function () {
            show(unlinkConfirm, false);
            var strip = byId("strip-links-input").checked;
            void perform("取消链接", function () { return __awaiter(_this, void 0, void 0, function () {
                var removed;
                return __generator(this, function (_g) {
                    switch (_g.label) {
                        case 0: return [4 /*yield*/, ops.unlink(strip)];
                        case 1:
                            removed = _g.sent();
                            state.lastRefresh = null;
                            renderCitationList();
                            log("\u5DF2\u53D6\u6D88\u94FE\u63A5 ".concat(removed, " \u4E2A\u63A7\u4EF6\uFF1A\u6587\u672C\u4FDD\u7559").concat(strip ? "" : "，跳转链接保留", "\uFF0C\u6B64\u540E\u4E0D\u518D\u81EA\u52A8\u5237\u65B0\u3002"));
                            return [2 /*return*/];
                    }
                });
            }); });
        });
        byId("copy-diagnostics-button").addEventListener("click", function () {
            var text = byId("diagnostics").textContent || "";
            var area = h("textarea");
            area.value = text;
            document.body.appendChild(area);
            area.select();
            try {
                document.execCommand("copy");
                log("诊断信息已复制。");
            }
            catch (e) {
                log("复制失败，请手动选中诊断文本。");
            }
            document.body.removeChild(area);
        });
        queue.onChange(function (label) {
            var bar = byId("busy-bar");
            bar.textContent = label ? "".concat(label, "\u4E2D\u2026") : "";
            show(bar, Boolean(label));
        });
        client.onChange(function () {
            renderConnection();
            renderDiagnostics();
            if (client.state() === "online") {
                if (byId("search-input").value.trim() || state.results.length === 0)
                    void searchPapers();
                if (state.lastRefresh && state.lastRefresh.missingSnapshots.length > 0)
                    void updateItemsFromLibrary(true);
                void writeBackCited();
            }
        });
        var probeNow = function () {
            if (client.state() !== "online")
                void client.probe();
        };
        document.addEventListener("visibilitychange", function () {
            if (!document.hidden)
                probeNow();
        });
        window.addEventListener("focus", probeNow);
    }
    function runLaunchAction() {
        var match = /[?&]action=([a-z]+)/.exec(window.location.search);
        var action = match ? match[1] : "";
        if (action === "cite")
            openQuickCite();
        else if (action === "bib")
            void insertBibliography();
        else if (action === "refresh")
            void refresh("ask");
        else if (action === "prefs")
            byId("style-select").focus();
    }
    function registerServiceWorker() {
        try {
            if ("serviceWorker" in navigator && window.location.protocol === "https:") {
                void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(function () { return void 0; });
            }
        }
        catch (e) {
        }
    }
    function start() {
        var _this = this;
        bindEvents();
        renderConnection();
        Office.onReady(function () {
            adapter = createOfficeAdapter();
            ops = createOperations(adapter);
            renderDiagnostics();
            void perform("读取文档", function () { return __awaiter(_this, void 0, void 0, function () {
                var result;
                return __generator(this, function (_g) {
                    switch (_g.label) {
                        case 0: return [4 /*yield*/, ops.loadModel()];
                        case 1:
                            _g.sent();
                            renderPrefs();
                            return [4 /*yield*/, ops.refresh({ manualEdits: "ask" })];
                        case 2:
                            result = _g.sent();
                            afterRefresh(result);
                            return [2 /*return*/];
                    }
                });
            }); }).then(function () {
                client.start();
                runLaunchAction();
            });
            try {
                Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, function () { return syncEditorWithSelection(); });
            }
            catch (e) {
            }
            registerServiceWorker();
        });
    }
    start();
})();
