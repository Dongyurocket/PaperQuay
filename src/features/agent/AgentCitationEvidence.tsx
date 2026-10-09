import { useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import type { AgentChatMessage } from './AgentWorkspace.types';
import { buildAgentAnswerReferences, citationBindingReason, type AgentAnswerReferenceModel } from './agentCitationRendering.ts';

export default function AgentCitationEvidence({ message, referenceModel, disabled, onVerify, l }: {
  message: AgentChatMessage;
  referenceModel?: AgentAnswerReferenceModel;
  disabled: boolean;
  onVerify?: (message: AgentChatMessage) => Promise<void>;
  l: (zh: string, en: string) => string;
}) {
  const [running, setRunning] = useState(false);
  const resolved = (referenceModel ?? buildAgentAnswerReferences(message.content, message.ragCitations, message.citationBindings)).occurrences;
  if (!resolved.length) return null;
  const available = resolved.filter(({ sourceResolved }) => sourceResolved).length;
  const verified = resolved.filter(({ binding }) => binding.status === 'verified').length;
  const contradicted = resolved.filter(({ binding }) => binding.reason === 'semantic-contradiction').length;
  const checked = resolved.filter(({ sourceResolved, binding }) => sourceResolved && binding.reason !== 'source-resolved');
  return <div className="mt-2 text-xs text-[var(--pq-text-muted)]">
    <div className="flex flex-wrap items-center gap-3">
      <span>{l(`来源可用 ${available} 处${resolved.length === available ? '' : `，不可用 ${resolved.length - available} 处`}`,
        `${available} sources resolved${resolved.length === available ? '' : `, ${resolved.length - available} unavailable`}`)}</span>
      {onVerify && available > 0 ? <button type="button"
        disabled={disabled || running} className="pq-button-secondary gap-1 px-2 py-1 disabled:opacity-50"
        onClick={async () => { setRunning(true); try { await onVerify(message); } finally { setRunning(false); } }}>
        {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
        {l('检查内容', 'Check content')}
      </button> : null}
    </div>
    <details className="mt-2">
      <summary className="cursor-pointer">{l('来源与内容检查明细', 'Source and content check details')}</summary>
      {checked.length ? <div className="mt-2">{l(`内容检查：支持 ${verified} 处，支撑不足或检查不可用 ${checked.length - verified - contradicted} 处，冲突 ${contradicted} 处`,
        `Content check: ${verified} supported, ${checked.length - verified - contradicted} insufficient or unavailable, ${contradicted} contradicted`)}</div> : null}
      <ul className="mt-2 space-y-2">
        {resolved.map(({ binding, referenceNumber }, index) => <li key={`${binding.start}:${index}`} className="break-words">
          <div>{referenceNumber == null ? l(`引用位置 ${index + 1}`, `Occurrence ${index + 1}`) : `[${referenceNumber}]`} {binding.sentenceText}</div>
          <div>{citationBindingReason(binding)}{binding.model ? ` · ${binding.model}` : ''}</div>
          {binding.detail ? <div>{binding.detail}</div> : null}
        </li>)}
      </ul>
    </details>
  </div>;
}
