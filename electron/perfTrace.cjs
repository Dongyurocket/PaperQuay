// 性能基线测量：通过环境变量 PAPERQUAY_PERF=1 开启，输出 [paperquay:perf] 日志。
// 默认完全静默（仅保留 Map 写入开销），不影响正常启动路径。
const { performance } = require('node:perf_hooks');

const marks = new Map();

function perfEnabled() {
  return process.env.PAPERQUAY_PERF === '1';
}

function perfMark(name) {
  marks.set(name, performance.now());
}

function perfMeasure(label, startName) {
  if (!perfEnabled()) {
    return;
  }

  const start = marks.get(startName);

  if (start === undefined) {
    return;
  }

  const elapsed = performance.now() - start;
  console.log(`[paperquay:perf] ${label}: ${elapsed.toFixed(1)}ms (since ${startName})`);
}

function perfLog(label) {
  if (!perfEnabled()) {
    return;
  }

  console.log(`[paperquay:perf] ${label}`);
}

module.exports = { perfEnabled, perfMark, perfMeasure, perfLog };
