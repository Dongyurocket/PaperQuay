import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const {
  buildContentSecurityPolicy,
  createPermissionHandlers,
  injectContentSecurityPolicy,
  installContentSecurityPolicy,
  installPermissionHandlers,
  isPermissionAllowed,
} = require('../electron/appSecurity.cjs');

function directive(policy, name) {
  const match = policy.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name} `));
  return match ? match.slice(name.length + 1).trim().split(/\s+/) : [];
}

test('production CSP whitelists self scripts, app protocols and forbids objects/frames', () => {
  const policy = buildContentSecurityPolicy({ isDev: false });

  assert.deepEqual(directive(policy, 'default-src'), ["'self'"]);
  assert.ok(directive(policy, 'script-src').includes("'self'"));
  assert.ok(directive(policy, 'script-src').includes("'wasm-unsafe-eval'"), 'PDF.js WASM decoders need wasm-unsafe-eval');
  assert.ok(!policy.includes("'unsafe-eval'"), 'production must not enable eval');
  assert.ok(!directive(policy, 'script-src').includes("'unsafe-inline'"));
  assert.deepEqual(directive(policy, 'object-src'), ["'none'"]);
  assert.deepEqual(directive(policy, 'frame-ancestors'), ["'none'"]);
  assert.deepEqual(directive(policy, 'base-uri'), ["'self'"]);
  assert.ok(directive(policy, 'connect-src').includes('paperquay-pdf:'));
  assert.ok(directive(policy, 'connect-src').includes('paperquay-pdf-assets:'));
  assert.ok(!directive(policy, 'connect-src').some((source) => source.startsWith('ws:')), 'production does not need HMR sockets');
  assert.ok(directive(policy, 'img-src').includes('data:'));
  assert.ok(directive(policy, 'font-src').includes('paperquay-pdf-assets:'));
  assert.ok(directive(policy, 'style-src').includes("'unsafe-inline'"));
  assert.ok(directive(policy, 'worker-src').includes('blob:'));
});

test('development CSP adds the Vite origin, HMR socket and inline preamble', () => {
  const policy = buildContentSecurityPolicy({
    isDev: true,
    devServerUrl: 'http://127.0.0.1:1420',
  });

  assert.ok(directive(policy, 'script-src').includes("'unsafe-inline'"));
  assert.ok(directive(policy, 'script-src').includes('http://127.0.0.1:1420'));
  assert.ok(directive(policy, 'connect-src').includes('http://127.0.0.1:1420'));
  assert.ok(directive(policy, 'connect-src').includes('ws://127.0.0.1:1420'));
  assert.ok(!policy.includes("'unsafe-eval'"), 'even dev should not need eval');
});

test('CSP meta is inserted once and replaces an existing policy', () => {
  const policy = buildContentSecurityPolicy({ isDev: false });
  const plain = '<!doctype html><html><head><meta charset="UTF-8" /></head><body></body></html>';
  const injected = injectContentSecurityPolicy(plain, policy);
  assert.equal(injected.match(/http-equiv="Content-Security-Policy"/g)?.length, 1);
  assert.ok(injected.includes(policy));

  const existing = '<head><meta http-equiv="Content-Security-Policy" content="default-src *" /></head>';
  const replaced = injectContentSecurityPolicy(existing, policy);
  assert.equal(replaced.match(/http-equiv="Content-Security-Policy"/g)?.length, 1);
  assert.ok(replaced.includes(policy));
  assert.ok(!replaced.includes('default-src *'));
});

test('CSP header installer only rewrites main-frame documents', () => {
  let listener = null;
  const session = {
    webRequest: {
      onHeadersReceived(handler) {
        listener = handler;
      },
    },
  };
  const policy = installContentSecurityPolicy(session, { isDev: false });
  assert.equal(typeof listener, 'function');

  let mainFrameResponse = null;
  listener(
    { resourceType: 'mainFrame', responseHeaders: { 'content-security-policy': ['default-src *'] } },
    (response) => {
      mainFrameResponse = response;
    },
  );
  assert.deepEqual(mainFrameResponse.responseHeaders['Content-Security-Policy'], [policy]);
  assert.equal(mainFrameResponse.responseHeaders['content-security-policy'], undefined);

  let subResourceResponse = null;
  const originalHeaders = { 'content-type': ['image/png'] };
  listener(
    { resourceType: 'image', responseHeaders: originalHeaders },
    (response) => {
      subResourceResponse = response;
    },
  );
  assert.equal(subResourceResponse.responseHeaders['Content-Security-Policy'], undefined);
  assert.deepEqual(subResourceResponse.responseHeaders['content-type'], ['image/png']);
});

test('permission defaults deny everything except clipboard access from the app window', () => {
  assert.equal(isPermissionAllowed('clipboard-read'), true);
  assert.equal(isPermissionAllowed('clipboard-sanitized-write'), true);
  assert.equal(isPermissionAllowed('media'), false);
  assert.equal(isPermissionAllowed('geolocation'), false);
  assert.equal(isPermissionAllowed('notifications'), false);
  assert.equal(isPermissionAllowed(''), false);

  const trusted = { id: 7 };
  const handlers = createPermissionHandlers({
    isTrustedWebContents: (contents) => contents?.id === 7,
    log: () => {},
  });

  const requested = [];
  const callback = (allowed) => requested.push(allowed);
  handlers.requestHandler(trusted, 'clipboard-read', callback);
  handlers.requestHandler(trusted, 'media', callback);
  handlers.requestHandler({ id: 8 }, 'clipboard-read', callback);
  assert.deepEqual(requested, [true, false, false]);

  assert.equal(handlers.checkHandler(trusted, 'clipboard-read'), true);
  assert.equal(handlers.checkHandler(trusted, 'media'), false);
  assert.equal(handlers.checkHandler({ id: 8 }, 'clipboard-read'), false);
  assert.equal(handlers.checkHandler(null, 'clipboard-read'), false);
});

test('permission installers register both the request and check handler', () => {
  const session = {
    requestHandler: null,
    checkHandler: null,
    setPermissionRequestHandler(handler) {
      this.requestHandler = handler;
    },
    setPermissionCheckHandler(handler) {
      this.checkHandler = handler;
    },
  };
  installPermissionHandlers(session, {
    isTrustedWebContents: () => true,
    log: () => {},
  });
  assert.equal(typeof session.requestHandler, 'function');
  assert.equal(typeof session.checkHandler, 'function');
  assert.equal(session.checkHandler({}, 'clipboard-read'), true);
  assert.equal(session.checkHandler({}, 'serial'), false);
});

test('main process and Vite config wire the CSP and permission baseline', () => {
  const mainSource = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const viteSource = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');

  assert.match(mainSource, /installContentSecurityPolicy\(session\.defaultSession/);
  assert.match(mainSource, /installPermissionHandlers\(session\.defaultSession/);
  assert.match(viteSource, /contentSecurityPolicyPlugin\(\)/);
  assert.match(viteSource, /injectContentSecurityPolicy/);
});
