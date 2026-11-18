import type { AgentToolMountContext } from './agentLoop.ts';
import {
  type AgentCapabilityId,
  getAgentCapability,
} from './agentCapabilityRegistry.ts';
import type { DeliveryRequirement } from './agentDeliveryQuality.ts';

export type AgentCapabilityRouteSource = 'user' | 'keyword' | 'model' | 'none';

export interface AgentCapabilityRoute {
  capabilityId: AgentCapabilityId | null;
  source: AgentCapabilityRouteSource;
  reason: string;
}

export function resolveAgentCapabilityRoute(input: {
  instruction: string;
  paperCount: number;
  pinnedCapabilityId?: AgentCapabilityId | 'auto' | null;
  mountContext: AgentToolMountContext;
  classifierResult?: { capabilityId: AgentCapabilityId | null; confidence: number } | null;
  deliveryRequirement?: DeliveryRequirement;
}): AgentCapabilityRoute {
  // 1. 用户钉选优先级最高
  if (input.pinnedCapabilityId && input.pinnedCapabilityId !== 'auto') {
    const definition = getAgentCapability(input.pinnedCapabilityId);
    if (definition) {
      const isAvailable = definition.available ? definition.available(input.mountContext) : true;
      if (isAvailable) {
        return {
          capabilityId: input.pinnedCapabilityId,
          source: 'user',
          reason: `Pinned by user: ${input.pinnedCapabilityId}`,
        };
      }
    }
  }

  // 3. 模型分类兜底（可选注入）
  if (
    input.instruction.trim().length >= 12 &&
    input.classifierResult &&
    input.classifierResult.capabilityId &&
    typeof input.classifierResult.confidence === 'number' &&
    input.classifierResult.confidence >= 0.75
  ) {
    const candidateId = input.classifierResult.capabilityId;
    const definition = getAgentCapability(candidateId);
    if (definition) {
      const meetsMinPapers = input.paperCount >= definition.minPapers;
      const isAvailable = definition.available ? definition.available(input.mountContext) : true;
      if (meetsMinPapers && isAvailable) {
        return {
          capabilityId: candidateId,
          source: 'model',
          reason: `Model classifier confidence ${input.classifierResult.confidence} >= 0.75`,
        };
      }
    }
  }

  // 4. 无匹配，走 ReAct
  return {
    capabilityId: null,
    source: 'none',
    reason: 'No capability matched',
  };
}
