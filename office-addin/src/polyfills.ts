/**
 * IE11（Word 2016 批量授权版）所需的最小 polyfill 集合；现代内核里 core-js 会检测后跳过。
 * 必须是每个入口的第一个 import。
 */
import 'core-js/actual/promise';
import 'core-js/actual/map';
import 'core-js/actual/set';
import 'core-js/actual/symbol';
import 'core-js/actual/array/from';
import 'core-js/actual/array/find';
import 'core-js/actual/array/find-index';
import 'core-js/actual/array/includes';
import 'core-js/actual/array/iterator';
import 'core-js/actual/array/flat-map';
import 'core-js/actual/object/assign';
import 'core-js/actual/object/entries';
import 'core-js/actual/object/values';
import 'core-js/actual/string/includes';
import 'core-js/actual/string/starts-with';
import 'core-js/actual/string/ends-with';
import 'core-js/actual/string/pad-end';
import 'core-js/actual/string/pad-start';
import 'core-js/actual/string/repeat';
import 'core-js/actual/string/trim-end';
import 'core-js/actual/number/is-finite';
import 'core-js/actual/number/is-integer';
import 'core-js/actual/number/parse-int';
import 'core-js/actual/math/imul';
