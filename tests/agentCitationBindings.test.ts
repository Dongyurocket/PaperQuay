import test from 'node:test';
import assert from 'node:assert/strict';
import { bindAgentCitationSources, normalizeAgentCitationTokens, verifyAgentCitationBindings, citationBindingStats } from '../src/services/agentAnswerEvidence.ts';
import { buildAgentAnswerReferences, resolveAgentCitationBindings, usedResolvedAgentCitations, injectAgentCitationBindings } from '../src/features/agent/agentCitationRendering.ts';
import type { LibraryAgentRagCitation } from '../src/services/libraryAgent.ts';

const a: LibraryAgentRagCitation = { id: 'rag:noise:a', label: '3', paperId: 'paper-a', paperTitle: 'Rotor Noise Study',
  pageIndex: 25, blockId: 'block-a', sourceType: 'mineru-markdown', previewText: 'Rotor optimization reduces noise by 12% compared with the baseline rotor.' };
const b: LibraryAgentRagCitation = { ...a, id: 'rag:design:b', label: '4', paperId: 'paper-b', paperTitle: 'Tiltrotor Design Study',
  pageIndex: 69, blockId: 'block-b', previewText: 'Tiltrotor optimization improves overall design performance without evaluating acoustic noise.' };
const claim = 'Rotor optimization reduces noise compared with the baseline rotor.';
const answer = `${claim}[[cite:${a.id}]]`;
const model = (verdict = 'supported') => async () => ({ content: JSON.stringify({ verdict, reason: 'Source assessment' }) });

test('structured tokens retain exact identity and punctuation associates trailing evidence with its claim', () => {
  const bindings = normalizeAgentCitationTokens(`${answer}\n${answer}`, [a]);
  assert.equal(bindings.length, 2);
  assert.deepEqual(bindings.map((item) => item.sentenceText), [claim, claim]);
  assert.notEqual(bindings[0].sentenceIndex, bindings[1].sentenceIndex);
  for (const binding of bindings) assert.equal(binding.reason, 'verifier-unavailable');
  assert.equal(normalizeAgentCitationTokens(`${claim} [[cite: ${a.id}]]`, [a])[0].reason, 'no-token-in-registry');
});

test('unknown, ambiguous, duplicated, numeric and malformed occurrences never gain trust', () => {
  assert.equal(normalizeAgentCitationTokens(`${claim}[[cite:missing]]`, [a])[0].status, 'rejected');
  assert.equal(normalizeAgentCitationTokens(answer, [a, { ...a }])[0].reason, 'ambiguous-token');
  assert.equal(normalizeAgentCitationTokens(answer, [a, { ...b, label: a.label }])[0].reason, 'ambiguous-token');
  assert.deepEqual(normalizeAgentCitationTokens(`${answer} [[cite:${a.id}]]`, [a]).map((item) => item.reason), ['duplicate-token', 'duplicate-token']);
  assert.equal(normalizeAgentCitationTokens(`${claim}[3]`, [a])[0].verifier, 'legacy');
  assert.equal(normalizeAgentCitationTokens(`${claim}[[cite:unfinished`, [a])[0].reason, 'malformed-token');
  assert.equal(normalizeAgentCitationTokens(`${claim}[[cite:]]`, [a])[0].reason, 'malformed-token');
});

test('code is ignored and headings, questions, short claims and empty snippets stay unverified', () => {
  assert.deepEqual(normalizeAgentCitationTokens('```md\n' + answer + '\n```\n`' + answer + '`', [a]), []);
  for (const text of [`# ${answer}`, `Is rotor optimization effective?[[cite:${a.id}]]`, `Noise?[[cite:${a.id}]]`]) {
    assert.equal(normalizeAgentCitationTokens(text, [a])[0].reason, 'insufficient-snippet');
  }
  assert.equal(normalizeAgentCitationTokens(answer, [{ ...a, previewText: '' }])[0].reason, 'insufficient-snippet');
});

test('explicit title and page mismatches fail before any model call', async () => {
  let calls = 0;
  for (const text of [`Rotor Noise Study shows rotor noise reduction. [[cite:${b.id}]]`, `Rotor optimization reduces noise on page 70. [[cite:${a.id}]]`]) {
    const bindings = await verifyAgentCitationBindings({ answer: text, citations: [a, b], callModel: async () => { calls++; return model()(); } });
    assert.equal(bindings[0].reason, 'explicit-metadata-mismatch');
    assert.equal(bindings[0].status, 'rejected');
  }
  assert.equal(calls, 0);
});

test('shared terminology does not verify an unrelated two-paper snippet', async () => {
  const bindings = await verifyAgentCitationBindings({ answer: `${claim}[[cite:${b.id}]]`, citations: [a, b], callModel: model('contradicted'), model: 'test-model' });
  assert.equal(bindings[0].status, 'rejected');
  assert.equal(bindings[0].reason, 'semantic-contradiction');
  assert.equal(bindings[0].model, 'test-model');
});

test('joint checks attribute support only to contributing sources while all resolved sources stay accessible', async () => {
  const multi = `${claim}[[cite:${a.id}]] [[cite:${b.id}]]`;
  const requests: Array<{ claim: string; evidence: Array<{ citationId: string; paperTitle: string; snippet: string }> }> = [];
  const bindings = await verifyAgentCitationBindings({ answer: multi, citations: [a, b], callModel: async ({ user }) => {
    const request = JSON.parse(user); requests.push(request);
    assert.deepEqual(Object.keys(request).sort(), ['claim', 'evidence']);
    return { content: JSON.stringify({ verdict: 'supported', reason: 'Only the rotor study supports this claim', sourceIds: [a.id] }) };
  } });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].evidence.map((source) => source.citationId), [a.id, b.id]);
  assert.equal(bindings[0].status, 'verified');
  assert.equal(bindings[1].status, 'unverified');
  assert.deepEqual(citationBindingStats(bindings), { supported: 1, partial: 1, 'not-in-library': 0 });
  assert.deepEqual(usedResolvedAgentCitations(multi, [a, b], bindings), [a, b]);
  assert.equal(resolveAgentCitationBindings(multi, [a, b], bindings)[0].citation, a);
});

test('compound claims preserve original spans and combine distinct quantitative sources without pretending each snippet supports everything', async () => {
  const lift = { ...b, previewText: 'The optimized tiltrotor design increases lift by 20% compared with the baseline design.' };
  const body = `旋翼优化使噪声降低12%；倾转旋翼设计使升力提高20%。[[cite:${a.id}]] [[cite:${lift.id}]]`;
  const bindings = await verifyAgentCitationBindings({ answer: body, citations: [a, lift], callModel: async ({ user }) => {
    const request = JSON.parse(user);
    const id = request.claim.includes('噪声') ? a.id : lift.id;
    assert.equal(request.evidence.length, 2);
    return { content: JSON.stringify({ verdict: 'supported', reason: 'Quantitative clause supported', sourceIds: [id] }) };
  } });
  assert.deepEqual(bindings.map((binding) => binding.status), ['verified', 'verified']);
  const checks = bindings[0].claims!;
  assert.equal(checks.length, 2);
  assert.deepEqual(checks.map((check) => check.supportingCitationIds), [[a.id], [lift.id]]);
  for (const check of checks) assert.equal(body.slice(check.start, check.end), check.text);
  for (const binding of bindings) assert.equal(body.slice(binding.start, binding.end), binding.rawToken);
  assert.deepEqual(buildAgentAnswerReferences(body, [a, lift], JSON.parse(JSON.stringify(bindings))).references.map((item) => item.citation), [a, lift]);
});

test('several snippets can jointly support a single comparison while missing quantities remain unverified', async () => {
  const lift = { ...b, previewText: 'The optimized tiltrotor design increases lift by 20% compared with the baseline design.' };
  const body = `噪声降低12%，升力提高20%，两项改善分别来自不同优化研究。[[cite:${a.id}]] [[cite:${lift.id}]]`;
  const bindings = await verifyAgentCitationBindings({ answer: body, citations: [a, lift], callModel: async ({ user }) => {
    const request = JSON.parse(user);
    assert.equal(request.evidence.length, 2);
    return { content: JSON.stringify({ verdict: 'supported', reason: 'Both supplied snippets jointly support the claim', sourceIds: [a.id, lift.id] }) };
  } });
  assert.deepEqual(bindings.map((item) => item.status), ['verified', 'verified']);
  assert.equal(bindings[0].claims!.length, 1);
  let calls = 0;
  const missing = await verifyAgentCitationBindings({ answer: body.replace('20%', '99%'), citations: [a, lift], callModel: async () => { calls++; return model()(); } });
  assert.equal(calls, 0);
  assert.ok(missing.every((item) => item.status === 'unverified' && item.reason === 'insufficient-snippet'));
});

test('joint verifier cannot invent sources, reuse source IDs, or silently omit attribution', async () => {
  const body = `${claim}[[cite:${a.id}]] [[cite:${b.id}]]`;
  for (const sourceIds of [[], ['invented'], [a.id, a.id], undefined]) {
    const result = await verifyAgentCitationBindings({ answer: body, citations: [a, b], callModel: async () => ({ content: JSON.stringify({ verdict: 'supported', reason: 'Unsupported attribution', sourceIds }) }) });
    assert.ok(result.every((item) => item.status === 'unverified' && item.reason === 'verifier-unavailable'));
    assert.deepEqual(usedResolvedAgentCitations(body, [a, b], result), [a, b]);
  }
});

test('partial compound verification records each verdict and never promotes a whole sentence after one check fails', async () => {
  const body = `旋翼优化降低基准旋翼的噪声；倾转旋翼设计改善整体性能。[[cite:${a.id}]] [[cite:${b.id}]]`;
  const result = await verifyAgentCitationBindings({ answer: body, citations: [a, b], callModel: async ({ user }) => {
    const request = JSON.parse(user);
    return request.claim.includes('噪声')
      ? { content: JSON.stringify({ verdict: 'supported', reason: 'Noise supported', sourceIds: [a.id] }) }
      : { content: '{}' };
  } });
  assert.ok(result.every((item) => item.status === 'unverified'));
  assert.deepEqual(result[0].claims!.map((item) => item.status), ['verified', 'unverified']);
  assert.deepEqual(usedResolvedAgentCitations(body, [a, b], result), [a, b]);
});

test('quantities, literal negation and reversed causal direction cannot pass ordinary overlap', () => {
  assert.equal(normalizeAgentCitationTokens(`Rotor optimization reduces noise by 99%. [[cite:${a.id}]]`, [a])[0].reason, 'insufficient-snippet');
  for (const snippet of ['Rotor optimization does not reduce noise compared with the baseline rotor.', 'Rotor optimization increases noise compared with the baseline rotor.']) {
    assert.equal(normalizeAgentCitationTokens(answer, [{ ...a, previewText: snippet }])[0].reason, 'semantic-contradiction');
  }
});

test('Chinese claims with English evidence receive semantic verification', async () => {
  const result = await verifyAgentCitationBindings({ answer: `旋翼优化降低了基准旋翼的噪声水平。[[cite:${a.id}]]`, citations: [a], callModel: model() });
  assert.equal(result[0].status, 'verified');
});

test('network errors, empty output, bad JSON, schema extras and absent verifier all fail closed', async () => {
  const failed = [undefined, async () => { throw new Error('Network key=secret'); }, ...['', '{}', 'null', '```json\n{}\n```', '{"verdict":"supported","reason":"ok","extra":true}'].map((content) => async () => ({ content }))];
  for (const callModel of failed) {
    const result = await verifyAgentCitationBindings({ answer, citations: [a], callModel });
    assert.equal(result[0].status, 'unverified');
    assert.equal(result[0].reason, 'verifier-unavailable');
    assert.ok(!result[0].detail?.includes('secret'));
  }
});

test('timeout and abort, even when provider resolves supported during abort, fail closed', async () => {
  const timed = await verifyAgentCitationBindings({ answer, citations: [a], timeoutMs: 5, callModel: async () => new Promise(() => {}) });
  assert.equal(timed[0].status, 'unverified');
  const controller = new AbortController();
  const aborted = await verifyAgentCitationBindings({ answer, citations: [a], signal: controller.signal, callModel: async () => { controller.abort(); return model()(); } });
  assert.equal(aborted[0].status, 'unverified');
});

test('verification is bounded to three concurrent calls and 48 occurrences', async () => {
  let active = 0, peak = 0, calls = 0;
  const result = await verifyAgentCitationBindings({ answer: Array.from({ length: 50 }, () => answer).join('\n'), citations: [a], callModel: async () => {
    active++; calls++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1)); active--; return model()();
  } });
  assert.equal(peak, 3); assert.equal(calls, 48);
  assert.equal(result.filter((item) => item.status === 'verified').length, 48);
});

for (const [language, ordinary, risky] of [
  ['English', 'Rotor optimization discusses acoustic design methods.', [
    'Rotor optimization reports an acoustic metric of 12.',
    'Rotor optimization reports acoustic performance in dB.',
    'Rotor optimization performs better than the baseline design.',
    'Rotor optimization does not establish acoustic safety.',
    'Rotor optimization causes acoustic changes through geometry.',
    'Rotor optimization is applicable only to subsonic conditions.',
    'Rotor optimization is the first study of acoustic geometry.',
  ]],
  ['Chinese', '这项旋翼优化工作讨论了声学设计方法。', [
    '这项旋翼优化工作的声学测量值为12。',
    '这项旋翼优化工作的声学测量单位是分贝。',
    '这项旋翼优化工作的性能优于基准设计。',
    '这项旋翼优化工作没有建立声学安全证据。',
    '这项旋翼优化工作导致声学特性的改变。',
    '这项旋翼优化工作仅适用于亚声速条件。',
    '这项旋翼优化工作首次开展声学几何研究。',
  ]],
] as const) {
  test(`late ${language} quantities, units, comparisons, negation, causality, scope and gap claims take priority within the verification budget`, async () => {
    const source = { ...a, previewText: 'Rotor optimization discusses acoustic design methods, performance, geometry and safety; measurements use 12 dB. Baseline and subsonic studies are described.' };
    const body = [...Array.from({ length: 50 }, () => ordinary), ...risky]
      .map((text) => `${text}[[cite:${source.id}]]`).join('\n');
    const identity = bindAgentCitationSources(body, [source]);
    assert.ok(identity.every((binding) => binding.status === 'unverified' && binding.reason === 'source-resolved'));
    const requests: string[] = [];
    let active = 0, peak = 0;
    const bindings = await verifyAgentCitationBindings({ answer: body, citations: [source], callModel: async ({ user }) => {
      requests.push(JSON.parse(user).claim);
      active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return model()();
    } });
    assert.equal(requests.length, 48);
    assert.equal(peak, 3);
    assert.deepEqual(new Set(requests.slice(0, risky.length)), new Set(risky));
    assert.ok(requests.slice(risky.length).every((text) => text === ordinary));
    assert.ok(bindings.slice(50).every((binding) => binding.status === 'verified'));
    assert.ok(bindings.slice(0, 48 - risky.length).every((binding) => binding.status === 'verified'));
    const overflow = bindings.slice(48 - risky.length, 50);
    assert.equal(overflow.length, 9);
    assert.ok(overflow.every((binding) => binding.status === 'unverified' && binding.reason === 'verifier-unavailable' &&
      binding.detail === 'Verification claim budget reached' && binding.claims?.[0].supportingCitationIds.length === 0));
    assert.deepEqual(bindings.map((binding) => binding.start), identity.map((binding) => binding.start));
    for (const binding of bindings) {
      assert.equal(body.slice(binding.start, binding.end), binding.rawToken);
      for (const check of binding.claims!) assert.equal(body.slice(check.start, check.end), check.text);
    }
    assert.deepEqual(usedResolvedAgentCitations(body, [source], bindings), [source]);
  });
}

test('prioritizing a late compound clause preserves claim order and leaves the whole sentence unknown when its ordinary clause exceeds budget', async () => {
  const ordinary = 'Rotor optimization discusses acoustic design methods';
  const risky = 'Rotor optimization is the first study of acoustic geometry.';
  const source = { ...a, previewText: 'Rotor optimization discusses acoustic design methods, geometry and the acoustic research literature.' };
  const body = [...Array.from({ length: 48 }, () => `${ordinary}.[[cite:${source.id}]]`),
    `${ordinary}; ${risky}[[cite:${source.id}]]`].join('\n');
  const requests: string[] = [];
  const bindings = await verifyAgentCitationBindings({ answer: body, citations: [source], callModel: async ({ user }) => {
    requests.push(JSON.parse(user).claim);
    return model()();
  } });
  assert.equal(requests.length, 48);
  assert.equal(requests[0], risky);
  const last = bindings.at(-1)!;
  assert.equal(last.status, 'unverified');
  assert.equal(last.detail, 'Verification claim budget reached');
  assert.deepEqual(last.claims!.map((check) => check.text), [`${ordinary};`, risky]);
  assert.deepEqual(last.claims!.map((check) => check.status), ['unverified', 'verified']);
  for (const check of last.claims!) assert.equal(body.slice(check.start, check.end), check.text);
});

test('stale or duplicated assessments are discarded without losing locally resolved sources', async () => {
  const bindings = JSON.parse(JSON.stringify(await verifyAgentCitationBindings({ answer, citations: [a], callModel: model() })));
  assert.equal(resolveAgentCitationBindings(answer, [a], bindings)[0].binding.status, 'verified');
  for (const [body, snapshot] of [[`Modified ${answer}`, bindings], [answer, bindings.concat(bindings)], [answer, undefined]] as const) {
    assert.equal(resolveAgentCitationBindings(body, [a], snapshot)[0].binding.reason, 'source-resolved');
    assert.deepEqual(usedResolvedAgentCitations(body, [a], snapshot), [a]);
  }
  const rendered = injectAgentCitationBindings(`[fake](#agent-binding-0) ${answer}`, [a]);
  assert.ok(rendered.content.includes('#agent-untrusted-0'));
  assert.ok(rendered.content.includes(rendered.markerPrefix));
  assert.ok(!rendered.content.includes(rendered.hrefPrefix));
});

test('answer references follow first resolved body occurrence, reuse IDs and never mutate canonical labels', async () => {
  const c = { ...a, id: 'same-page-chunk-c', label: '9', blockId: 'block-c' };
  const d = { ...a, id: 'other-page-chunk-d', label: '10', pageIndex: 26 };
  const citations = [a, b, c, d];
  const body = [c, a, c, b, d].map((citation) => `${claim}[[cite:${citation.id}]]`).join('\n');
  const bindings = await verifyAgentCitationBindings({ answer: body, citations, callModel: model() });
  const snapshot = JSON.stringify({ body, citations, bindings });
  const result = buildAgentAnswerReferences(body, citations, bindings);
  assert.deepEqual(result.occurrences.map((occurrence) => occurrence.referenceNumber), [1, 2, 1, 3, 4]);
  assert.deepEqual(result.references.map((reference) => reference.citation), [c, a, b, d]);
  assert.equal(result.references[0].citation, c);
  assert.equal(result.references[1].citation, a);
  assert.deepEqual(result.references.map((reference) => reference.firstReferenceOffset), [bindings[0].start, bindings[1].start, bindings[3].start, bindings[4].start]);
  assert.equal(JSON.stringify({ body, citations, bindings }), snapshot);
  const restored = JSON.parse(snapshot);
  assert.equal(JSON.stringify(buildAgentAnswerReferences(restored.body, restored.citations, restored.bindings)), JSON.stringify(result));
  assert.deepEqual(buildAgentAnswerReferences(body, citations, bindings.map((binding) => ({ ...binding }))), result);
  assert.deepEqual(buildAgentAnswerReferences(body, citations).references, result.references);
});

test('advisory content results do not hide references or change first-use numbering', async () => {
  const sameEvidence = { ...a, id: 'b', label: '4' };
  const body = [a, sameEvidence, a, sameEvidence].map((citation) => `${claim}[[cite:${citation.id}]]`).join('\n');
  const bindings = await verifyAgentCitationBindings({ answer: body, citations: [a, sameEvidence], callModel: model() });
  bindings[0] = { ...bindings[0], status: 'rejected', reason: 'semantic-contradiction' };
  bindings[3] = { ...bindings[3], status: 'unverified', reason: 'insufficient-snippet' };
  const result = buildAgentAnswerReferences(body, [a, sameEvidence], bindings);
  assert.deepEqual(result.occurrences.map((occurrence) => occurrence.referenceNumber), [1, 2, 1, 2]);
  assert.deepEqual(result.references.map((reference) => reference.citationId), [a.id, sameEvidence.id]);
  assert.equal(result.occurrences[0].binding.status, 'rejected');
  const rendered = injectAgentCitationBindings(body, [a, sameEvidence], bindings, result).fallbackContent;
  assert.match(rendered, /\[1\]/);
  assert.match(rendered, /\[2\]/);
  bindings[0] = { ...bindings[0], status: 'verified', reason: 'supported' };
  assert.deepEqual(buildAgentAnswerReferences(body, [a, sameEvidence], bindings).references.map((reference) => reference.citationId), [a.id, sameEvidence.id]);
  assert.equal(buildAgentAnswerReferences(`Changed ${body}`, [a, sameEvidence], bindings).references.length, 2);
});

test('untrusted, unused, duplicate and code tokens never enter formal references', async () => {
  const body = `${answer} [[cite:${a.id}]]\n${claim}[[cite:unknown]]\n\`${answer}\`\n${claim}[3]`;
  const bindings = await verifyAgentCitationBindings({ answer: body, citations: [a, b], callModel: model() });
  assert.equal(buildAgentAnswerReferences(body, [a, b], bindings).references.length, 0);
  const verified = await verifyAgentCitationBindings({ answer, citations: [a], callModel: model() });
  assert.equal(buildAgentAnswerReferences(answer, [a, { ...a }], verified).references.length, 0);
  assert.equal(buildAgentAnswerReferences(answer, [a, { ...b, label: a.label }], verified).references.length, 0);
});

test('streamed token prefixes and interrupted tokens hide internal IDs without granting reference numbers', () => {
  const token = `[[cite:${a.id}]]`;
  for (let length = 2; length < token.length; length++) {
    const body = `${claim}${token.slice(0, length)}`;
    const rendered = injectAgentCitationBindings(body, [a]);
    assert.ok(!rendered.content.includes(a.id));
    assert.equal(buildAgentAnswerReferences(body, [a]).references.length, 0);
  }
  assert.equal(buildAgentAnswerReferences(`${claim}${token}`, [a]).references.length, 1);
});

test('source identity never implies semantic support, including short snippets and unsupported quantities', () => {
  const body = `Rotor optimization reduces noise by 99%. [[cite:${a.id}]]`;
  const bindings = bindAgentCitationSources(body, [{ ...a, previewText: '' }]);
  assert.equal(bindings[0].reason, 'source-resolved');
  assert.equal(bindings[0].status, 'unverified');
  assert.equal(citationBindingStats(bindings).supported, 0);
  assert.equal(buildAgentAnswerReferences(body, [a]).references[0].citation, a);
  for (const text of [`${claim}[[cite:missing]]`, `${claim}[3]`]) {
    assert.equal(buildAgentAnswerReferences(text, [a]).references.length, 0);
  }
});

test('prose title and page disagreements stay advisory and cannot alter the canonical navigation target', async () => {
  const body = `Tiltrotor Design Study reports noise results on page 70. [[cite:${a.id}]]`;
  const bindings = await verifyAgentCitationBindings({ answer: body, citations: [a, b], callModel: model() });
  assert.equal(bindings[0].reason, 'explicit-metadata-mismatch');
  const reference = buildAgentAnswerReferences(body, [a, b], bindings).references[0];
  assert.equal(reference.citation, a);
  assert.equal(reference.citation.paperTitle, 'Rotor Noise Study');
  assert.equal(reference.citation.pageIndex, 25);
  assert.equal(reference.citation.blockId, 'block-a');
});

test('verifier failures and timeout remain advisory for a compound sentence with multiple real sources', async () => {
  const body = `旋翼优化降低噪声，同时倾转旋翼设计改善整体性能。[[cite:${a.id}]] [[cite:${b.id}]]`;
  for (const callModel of [model('insufficient'), model('contradicted'), async () => ({ content: '{}' }), async () => new Promise<{ content: string }>(() => {})]) {
    const bindings = await verifyAgentCitationBindings({ answer: body, citations: [a, b], callModel, timeoutMs: 5 });
    const result = buildAgentAnswerReferences(body, [a, b], bindings);
    assert.deepEqual(result.occurrences.map((item) => item.referenceNumber), [1, 2]);
    assert.deepEqual(result.references.map((item) => item.citation), [a, b]);
    assert.equal(citationBindingStats(bindings).supported, 0);
  }
});
