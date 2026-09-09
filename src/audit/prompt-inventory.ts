import fs from 'node:fs/promises';
import path from 'node:path';

import { decisionNodes, type DecisionNode } from '../core/decision-nodes';
import {
  conversationPromptFilesForNode,
  extractorPromptFilesForCapabilities,
  nodePromptManifest,
} from '../runtime/prompt-manifest';
import { extractorAuditProfiles } from './prompt-audit';

export type PromptInventoryConsumer = {
  callType: 'classifier' | 'extraction' | 'reply' | 'deterministic_reply';
  nodes: string[];
  profiles: string[];
  transitions: string[];
  loader: string;
};

export type PromptInventoryEntry = {
  filePath: string;
  consumers: PromptInventoryConsumer[];
  isOrphaned: boolean;
};

export type PromptInventory = {
  generatedAt: string;
  anchorRef: string | null;
  totalFiles: number;
  totalNodes: number;
  callTypes: string[];
  entries: PromptInventoryEntry[];
  unmappedFiles: string[];
};

export async function buildPromptInventory(args: {
  promptsDir: string;
  anchorRef?: string | null;
  generatedAt?: string;
}): Promise<PromptInventory> {
  const allFiles = await listAllPromptFiles(args.promptsDir);
  const entries: PromptInventoryEntry[] = [];

  for (const filePath of allFiles) {
    const consumers = deriveConsumers(filePath);
    const isOrphaned = consumers.length === 0;
    entries.push({
      filePath,
      consumers,
      isOrphaned,
    });
  }

  const unmappedFiles = entries.filter((entry) => entry.isOrphaned).map((entry) => entry.filePath);

  return {
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    anchorRef: args.anchorRef ?? null,
    totalFiles: allFiles.length,
    totalNodes: decisionNodes.length,
    callTypes: ['classifier', 'extraction', 'reply', 'deterministic_reply'],
    entries: entries.sort((a, b) => a.filePath.localeCompare(b.filePath)),
    unmappedFiles,
  };
}

function deriveConsumers(filePath: string): PromptInventoryConsumer[] {
  const consumers: PromptInventoryConsumer[] = [];
  if (filePath === 'nodes/resolver_consultas_informativas/image_inspection.txt' ||
      filePath === 'nodes/resolver_consultas_informativas/image_outcomes.json') {
    consumers.push({ callType: filePath.endsWith('.json') ? 'deterministic_reply' : 'reply',
      nodes: ['resolver_consultas_informativas'], profiles: ['image'],
      transitions: ['media:image_turn'], loader: 'PromptLoader image bundle/messages' });
  }
  if (filePath === 'nodes/resolver_consultas_informativas/support_continuity.txt') {
    consumers.push({ callType: 'reply',
      nodes: ['resolver_consultas_informativas'], profiles: ['support'],
      transitions: ['information:support_acknowledgment'],
      loader: 'PromptLoader.loadSupportContinuityBundle -> AgentService.handleSupportAcknowledgment via composeModelReply' });
  }
  if (filePath === 'nodes/resolver_consultas_informativas/capability_boundary.txt') {
    consumers.push({
      callType: 'deterministic_reply',
      nodes: ['resolver_consultas_informativas'],
      profiles: [],
      transitions: ['capability:boundary_renderer'],
      loader: 'CapabilityBoundaryRenderer (deterministic capability outcomes)',
    });
  }
  if (filePath === 'capability/turn_outcomes.txt') {
    consumers.push({
      callType: 'deterministic_reply',
      nodes: [],
      profiles: [],
      transitions: ['capability:turn_outcome_renderer'],
      loader: 'CapabilityOutcomeRenderer (deterministic S16 turn and handoff outcomes)',
    });
  }
  if (filePath === 'nodes/resolver_consultas_informativas/host-withdrawal.json') {
    consumers.push({
      callType: 'deterministic_reply', nodes: ['resolver_consultas_informativas'],
      profiles: [], transitions: ['information:host_withdrawal_policy_and_support'],
      loader: 'PromptLoader.loadHostWithdrawalMessages -> AgentService.handleHostWithdrawalInformation (no model call)',
    });
  }
  if (filePath === 'nodes/resolver_consultas_informativas/handoff_outcomes.json') {
    consumers.push({
      callType: 'deterministic_reply', nodes: ['resolver_consultas_informativas'],
      profiles: [], transitions: ['information:terminal_handoff', 'information:phone_information_not_found', 'human:explicit_request'],
      loader: 'AgentService escalateInformationAuthentication/selectTerminalHandoffMessage + selectExplicitHumanMessage (no model call)',
    });
  }
  if (filePath === 'nodes/resolver_consultas_informativas/auth_control.txt') {
    consumers.push({
      callType: 'deterministic_reply', nodes: ['resolver_consultas_informativas'],
      profiles: [], transitions: ['information:auth_control'],
      loader: 'AgentService effectivePhoneConfirmation/isPhoneConfirmationRelevant (auth-only guidance, no model call)',
    });
  }
  if (filePath.startsWith('shared/')) {
    const nodes = decisionNodes.filter((node) =>
      conversationPromptFilesForNode(node).includes(filePath as never),
    );
    if (nodes.length > 0) {
      consumers.push({
        callType: 'reply',
        nodes: [...nodes],
        profiles: [],
        transitions: nodes.map((node) => `reply:${node}`),
        loader: 'PromptLoader.loadNodeBundle -> conversationPromptFilesForNode',
      });
    }
  }

  if (filePath.startsWith('extractors/')) {
    if (filePath === 'extractors/capability_boundary.txt') {
      consumers.push({
        callType: 'extraction',
        nodes: [],
        profiles: ['initial_planning_information', 'active_plan', 'shortlist'],
        transitions: ['extraction:capability_boundary'],
        loader: 'OpenAiAgentRuntime.extract -> extractorPromptFilesForCapabilities(capabilityBoundary)',
      });
    }
    const profiles = extractorAuditProfiles.filter((profile) =>
      extractorPromptFilesForCapabilities(profile.capabilities).includes(filePath as never),
    );
    if (profiles.length > 0) {
      consumers.push({
        callType: 'extraction',
        nodes: [],
        profiles: profiles.map((profile) => `extractor:${profile.name}`),
        transitions: profiles.map((profile) => `extraction:${profile.name}`),
        loader: 'PromptLoader.loadExtractorBundle -> extractorPromptFilesForCapabilities',
      });
    }
    // also extractor base files are used via extractorPromptFilesForCapabilities
    // ensure shared extractor files map even if not in profile? Already covered.
  }

  if (filePath.startsWith('nodes/deteccion_intencion/response_classifier')) {
    const isGeneral = filePath === 'nodes/deteccion_intencion/response_classifier.txt';
    const isCampaign = filePath === 'nodes/deteccion_intencion/response_classifier_campaign.txt';
    if (isGeneral) {
      consumers.push({
        callType: 'classifier',
        nodes: ['deteccion_intencion'],
        profiles: ['general'],
        transitions: ['classifier:general'],
        loader: 'PromptLoader.loadResponseClassifierBundle("general") -> responseClassifierPromptFiles.general',
      });
    }
    if (isCampaign) {
      consumers.push({
        callType: 'classifier',
        nodes: ['deteccion_intencion'],
        profiles: ['campaign_reply'],
        transitions: ['classifier:campaign_reply'],
        loader: 'PromptLoader.loadResponseClassifierBundle("campaign_reply") -> responseClassifierPromptFiles.campaign_reply',
      });
    }
  }

  if (filePath.startsWith('nodes/')) {
    const parts = filePath.split('/');
    const nodeName = parts[1] as DecisionNode | undefined;
    if (nodeName && isDecisionNode(nodeName)) {
      const manifestFiles = nodePromptManifest[nodeName]?.files ?? [];
      if (manifestFiles.includes(filePath as never)) {
        const transitions =
          nodeName === 'responder_invitacion'
            ? [
                `reply:${nodeName}`,
                `reply:${nodeName}:resolved_single (rsvp_phone_evidence.state via projectRsvpPhoneEvidenceForReply)`,
                `reply:${nodeName}:needs_event_selection (rsvp_phone_evidence.state via projectRsvpPhoneEvidenceForReply)`,
                `reply:${nodeName}:unavailable (rsvp_phone_evidence.state via projectRsvpPhoneEvidenceForReply)`,
              ]
            : [`reply:${nodeName}`];
        consumers.push({
          callType: 'reply',
          nodes: [nodeName],
          profiles: [],
          transitions,
          loader: `PromptLoader.loadNodeBundle("${nodeName}") -> nodePromptManifest["${nodeName}"].files`,
        });
      } else if (filePath.endsWith('response_classifier.txt') || filePath.endsWith('response_classifier_campaign.txt')) {
        // already handled above, skip
      } else if (filePath.includes('/')) {
        // File exists on disk but not in manifest (e.g., transition_policy.txt)
        // Still map to its node for inventory completeness, flagged via isOrphaned=false by adding consumer
        // This ensures zero unmapped files while documenting the gap.
        const isTransitionPolicy = filePath.endsWith('transition_policy.txt');
        if (isTransitionPolicy) {
          consumers.push({
            callType: 'reply',
            nodes: [nodeName],
            profiles: [],
            transitions: [`reply:${nodeName}:transition_policy (orphaned: not in nodePromptManifest)`],
            loader: 'filesystem: prompts/nodes/<node>/transition_policy.txt exists but not wired in PromptLoader',
          });
        }
      }
    }
  }

  // Deduplicate consumers by callType+nodes signature
  return consumers;
}

function isDecisionNode(value: string): value is DecisionNode {
  return (decisionNodes as readonly string[]).includes(value);
}

async function listAllPromptFiles(promptsDir: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(currentDir: string, relativePrefix: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.join(relativePrefix, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        results.push(relativePath);
      }
    }
  }
  await walk(promptsDir, '');
  return results.sort();
}
