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
  const verified = resolved.filter(({ binding }) => binding.status === 'verified').length;
  const rejected = resolved.filter(({ binding }) => binding.status === 'rejected').length;
  return <div className="mt-2 text-xs text-[var(--pq-text-muted)]">
    <div className="flex flex-wrap items-center gap-3">
      <span>{l(`已核验 ${verified} 条，未验证 ${resolved.length - verified - rejected} 条，拒绝 ${rejected} 条`,
        `${verified} verified, ${resolved.length - verified - rejected} unverified, ${rejected} rejected`)}</span>
      {onVerify && resolved.some(({ binding }) => binding.tokenId) ? <button type="button"
        disabled={disabled || running} className="pq-button-secondary gap-1 px-2 py-1 disabled:opacity-50"
        onClick={async () => { setRunning(true); try { await onVerify(message); } finally { setRunning(false); } }}>
        {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
        {l('核验引用', 'Verify citations')}
      </button> : null}
    </div>
    <details className="mt-2">
      <summary className="cursor-pointer">{l('引用核验明细', 'Citation verification details')}</summary>
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
