import type { LibraryAgentPaperScopeInput } from '../../services/libraryAgent';
import { resolveAgentPaperScope } from '../../services/agentPaperScope.ts';
import type { LiteratureCategory, LiteraturePaper } from '../../types/library';
import type { AgentChatMessage, AgentHistorySession } from './AgentWorkspace.types';
import {
  findMentionedCategoryScope,
  hasExplicitFullLibraryScope,
  type AgentCategoryScopeMatch,
} from './agentCategoryScopes.ts';

export interface AgentWorkspacePaperScope {
  source: 'inline' | 'category' | 'full-library' | 'selected' | 'history' | 'empty';
  /** Keep requested IDs, including deleted IDs, until the service resolves them. */
  paperIds: string[];
  papers: LiteraturePaper[];
  unavailablePaperIds: string[];
  categoryScope: AgentCategoryScopeMatch | null;
}

/** Resolve this turn before consulting historical scopes; empty explicit scopes stay empty. */
export function resolveAgentWorkspacePaperScope(input: {
  instruction: string;
  papers: LiteraturePaper[];
  categories: LiteratureCategory[];
  messages: AgentChatMessage[];
  selectedPaperIds: Iterable<string>;
  inlinePaperIds?: string[];
  ragEnabled: boolean;
}): AgentWorkspacePaperScope {
  const scopeForIds = (
    source: AgentWorkspacePaperScope['source'],
    requestedIds: string[],
    categoryScope: AgentCategoryScopeMatch | null = null,
  ): AgentWorkspacePaperScope => {
    const paperIds = uniquePaperScopeIds(requestedIds);
    const scope = resolveAgentPaperScope(input.papers, paperIds);
    return { source, paperIds, papers: scope.papers, unavailablePaperIds: scope.unavailableIds, categoryScope };
  };

  if (input.inlinePaperIds !== undefined) {
    return scopeForIds('inline', input.inlinePaperIds);
  }

  const categoryScope = findMentionedCategoryScope(input.instruction, input.categories, input.papers);
  if (categoryScope) {
    return scopeForIds('category', categoryScope.papers.map((paper) => paper.id), categoryScope);
  }
  if (hasExplicitFullLibraryScope(input.instruction)) {
    return scopeForIds('full-library', input.papers.map((paper) => paper.id));
  }

  const selectedPaperIds = uniquePaperScopeIds([...input.selectedPaperIds]);
  if (selectedPaperIds.length > 0) {
    return scopeForIds('selected', selectedPaperIds);
  }

  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const paperIds = input.messages[index]?.paperScopeIds;
    if (Array.isArray(paperIds)) {
      return scopeForIds('history', paperIds);
    }
  }

  return input.ragEnabled
    ? scopeForIds('full-library', input.papers.map((paper) => paper.id))
    : scopeForIds('empty', []);
}

export function containsLegacyMojibake(value: string): boolean {
  return /[\uFFFD]|\u93b6|\u95ab|\u7b49|\u93c0|\u7025/.test(value);
}

export function hasSameAgentHistoryMessages(
  left: AgentHistorySession | undefined,
  right: AgentHistorySession,
): boolean {
  return Boolean(left) && JSON.stringify(left?.messages) === JSON.stringify(right.messages);
}

export function uniquePaperScopeIds(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.map((id) => id?.trim()).filter((id): id is string => Boolean(id)))];
}

function excerptAgentMessage(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 240);
}

export function buildConversationPaperScopes(
  messages: AgentChatMessage[],
  currentPaperScopeIds: string[],
): LibraryAgentPaperScopeInput[] {
  const scopes: LibraryAgentPaperScopeInput[] = [];
  const seenKeys = new Set<string>();
  const currentIds = uniquePaperScopeIds(currentPaperScopeIds);

  if (currentIds.length > 0) {
    const key = currentIds.join('|');
    seenKeys.add(key);
    scopes.push({
      id: 'current-turn',
      label: 'Current turn paper scope',
      source: 'current',
      paperIds: currentIds,
    });
  }

  const scopedMessages = messages
    .filter((message) => message.paperScopeIds?.length)
    .slice(-16)
    .reverse();

  for (const message of scopedMessages) {
    const paperIds = uniquePaperScopeIds(message.paperScopeIds ?? []);

    if (paperIds.length === 0) {
      continue;
    }

    const key = paperIds.join('|');

    if (seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
    scopes.push({
      id: `history-${message.id}`,
      label: `${message.role === 'user' ? 'User' : 'Assistant'} turn paper scope`,
      source: 'history',
      paperIds,
      messageRole: message.role,
      messageContent: excerptAgentMessage(message.content),
    });

    if (scopes.length >= 9) {
      break;
    }
  }

  return scopes;
}

export function collectPaperScopeCandidateIds(scopes: LibraryAgentPaperScopeInput[]): string[] {
  return uniquePaperScopeIds(scopes.flatMap((scope) => scope.paperIds));
}

export function latestConversationPaperScopeIds(messages: AgentChatMessage[]): string[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const paperIds = messages[index]?.paperScopeIds;
    if (Array.isArray(paperIds)) {
      return uniquePaperScopeIds(paperIds);
    }
  }

  return [];
}
