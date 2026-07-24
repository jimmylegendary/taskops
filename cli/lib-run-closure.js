import { createHash } from 'node:crypto';
import { inspectNonEmptyUtf8File } from './lib-artifact-contract.js';

const CLAIM_REASONS = new Set(['approved_result', 'execution_path_closed']);
const POLICY_MODES = new Set(['enforced', 'guarded', 'runner-managed']);
const ACTION_KIND_TYPES = Object.freeze({
  execute: new Set(['implementation', 'execute']),
  decompose: new Set(['decomposition', 'decompose']),
  explore: new Set(['exploration', 'explore']),
  prototype: new Set(['prototype']),
  review: new Set(['review']),
  verify: new Set(['verification']),
  experiment: new Set(['experiment']),
  loopback: new Set(['loopback']),
  delegate: new Set(['delegate']),
});
const LEGACY_ACTION_KIND_BY_TYPE = new Map([
  ['implementation', 'execute'],
  ['execute', 'execute'],
  ['decomposition', 'decompose'],
  ['decompose', 'decompose'],
  ['exploration', 'explore'],
  ['explore', 'explore'],
  ['prototype', 'prototype'],
  ['review', 'review'],
  ['verification', 'verify'],
  ['experiment', 'experiment'],
  ['loopback', 'loopback'],
  ['delegate', 'delegate'],
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value ?? null;
}

export function canonicalSha256(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')}`;
}

export function validateRunNodeActionIdentity({ type, actionKind, requireActionKind = true } = {}) {
  const issues = [];
  if (actionKind == null || String(actionKind).trim() === '') {
    if (requireActionKind) issues.push('run-node actionKind is required');
    return { valid: issues.length === 0, issues, actionKind: null };
  }
  const normalizedActionKind = String(actionKind).trim();
  const allowedTypes = ACTION_KIND_TYPES[normalizedActionKind];
  if (!allowedTypes) {
    issues.push(`Unknown run-node actionKind '${normalizedActionKind}'`);
  } else if (!allowedTypes.has(type)) {
    issues.push(`run-node type '${type}' does not match actionKind '${normalizedActionKind}'`);
  }
  return {
    valid: issues.length === 0,
    issues,
    actionKind: normalizedActionKind,
  };
}

function inferredRole(node, eow) {
  return node?.type === 'implementation' && CLAIM_REASONS.has(eow?.reason)
    ? 'claim-bearing'
    : 'supporting';
}

function reviewEvidence(node, task, eow, runNodes, runEdges) {
  if (inferredRole(node, eow) !== 'claim-bearing') return { valid: false, issues: [] };
  const approvalFields = [
    'approvedByReviewNodeId',
    'approvedReviewMode',
    'approvedReviewReportHash',
    'reviewedAcceptanceHash',
    'reviewedResultHash',
  ];
  const hasAnyApprovalStamp = approvalFields.some((field) => eow?.[field]);
  if (eow?.reason !== 'approved_result' && !hasAnyApprovalStamp) {
    return { valid: false, issues: [] };
  }
  const review = runNodes.get(`${eow.runId}:${eow.approvedByReviewNodeId}`);
  const issues = [];
  if (!review || review.type !== 'review' || review.status !== 'done') {
    issues.push('approved review node not found or not done');
    return { valid: false, issues };
  }
  if (review.reviewsRunNodeId !== node.id || review.reviewedRunId !== node.runId) {
    issues.push('review target does not match claim run node');
  }
  const edgeFound = [...runEdges.values()].some((edge) => (
    edge.runId === node.runId
    && edge.fromRunNodeId === node.id
    && edge.toRunNodeId === review.id
    && edge.edgeType === 'reviews'
  ));
  if (!edgeFound) issues.push('review edge does not match claim run node');
  const report = review.reviewReport;
  if (report?.decision !== 'approved') issues.push('review decision is not approved');
  if (!POLICY_MODES.has(report?.mode)) issues.push('review mode is not policy-approving');
  if (eow.approvedReviewMode !== report?.mode) issues.push('EoW review mode mismatch');
  if (review.reviewReportHash !== canonicalSha256(report)) issues.push('review report hash mismatch');
  if (eow.approvedReviewReportHash !== review.reviewReportHash) issues.push('EoW review hash mismatch');
  if (eow.reviewedAcceptanceHash !== report?.reviewedAcceptanceHash) issues.push('acceptance hash mismatch');
  if (eow.reviewedResultHash !== report?.reviewedResultHash) issues.push('result hash mismatch');
  if (!task) {
    issues.push('claim source task not found');
  } else {
    const currentAcceptanceHash = canonicalSha256(task.acceptance);
    if (report?.reviewedAcceptanceHash !== currentAcceptanceHash) {
      issues.push('reviewed acceptance hash does not match current task acceptance');
    }
    if (eow.reviewedAcceptanceHash !== currentAcceptanceHash) {
      issues.push('EoW acceptance hash does not match current task acceptance');
    }
  }
  const currentResultHash = canonicalSha256(node.result);
  if (report?.reviewedResultHash !== currentResultHash) {
    issues.push('reviewed result hash does not match current implementation result');
  }
  if (eow.reviewedResultHash !== currentResultHash) {
    issues.push('EoW result hash does not match current implementation result');
  }
  return { valid: issues.length === 0, issues };
}

export function classifyRunClosure({
  node,
  task,
  eow,
  runNodes,
  runEdges,
  versions,
  selectedVersionIds,
} = {}) {
  const expectedRole = inferredRole(node, eow);
  const hasExplicitRole = Boolean(eow && Object.prototype.hasOwnProperty.call(eow, 'closureRole'));
  const role = hasExplicitRole ? eow.closureRole : expectedRole;
  const selected = !node?.sourceTaskGroupVersionId
    || selectedVersionIds.size === 0
    || selectedVersionIds.has(node.sourceTaskGroupVersionId);
  const issues = [];
  if (!['supporting', 'claim-bearing'].includes(role)) issues.push(`invalid closureRole '${role}'`);
  if (hasExplicitRole && role !== expectedRole) issues.push(`closureRole spoof: expected ${expectedRole}`);
  if (role === 'supporting' && CLAIM_REASONS.has(eow?.reason)) {
    issues.push(`supporting closure cannot use claim reason '${eow.reason}'`);
  }

  let supportingActionKind = node?.actionKind;
  if (selected && role === 'supporting') {
    if (supportingActionKind == null || String(supportingActionKind).trim() === '') {
      if (hasExplicitRole) {
        issues.push('explicit supporting closure is missing actionKind');
      } else {
        supportingActionKind = LEGACY_ACTION_KIND_BY_TYPE.get(node?.type) || null;
        if (!supportingActionKind) {
          issues.push(`legacy supporting closure cannot infer actionKind from type '${node?.type}'`);
        }
      }
    }
    if (supportingActionKind) {
      const actionIdentity = validateRunNodeActionIdentity({
        type: node?.type,
        actionKind: supportingActionKind,
      });
      issues.push(...actionIdentity.issues);
      supportingActionKind = actionIdentity.actionKind;
    }

    if (supportingActionKind === 'explore') {
      const inspected = inspectNonEmptyUtf8File(node.result?.artifactPath, { label: 'exploration artifact' });
      if (!inspected.ok) issues.push(inspected.message);
    }
    if (supportingActionKind === 'prototype') {
      const inspected = inspectNonEmptyUtf8File(node.result?.artifactPath, { label: 'prototype options artifact' });
      if (!inspected.ok) issues.push(inspected.message);
    }
    if (supportingActionKind === 'decompose') {
      const backlink = [...versions.values()].some((version) => (
        version.decomposedByRunId === node.runId
        && version.decomposedByRunNodeId === node.id
      ));
      if (!backlink) issues.push('decomposition backlink missing for supporting closure');
    }
    if (supportingActionKind === 'review') {
      const reviewedNode = runNodes.get(`${node.runId}:${node.reviewsRunNodeId}`);
      const reviewEdge = [...runEdges.values()].some((edge) => (
        edge.runId === node.runId
        && edge.fromRunNodeId === node.reviewsRunNodeId
        && edge.toRunNodeId === node.id
        && edge.edgeType === 'reviews'
      ));
      if (!reviewedNode) issues.push('reviewed run node missing for supporting closure');
      if (!node.reviewReport || typeof node.reviewReport !== 'object') {
        issues.push('review report missing for supporting closure');
      }
      if (!reviewEdge) issues.push('review edge missing for supporting closure');
    }
  }

  const review = reviewEvidence(node, task, eow, runNodes, runEdges);
  const allIssues = issues.concat(review.issues);
  return {
    role,
    selected,
    schemaValid: allIssues.length === 0,
    supportValid: role !== 'supporting' || issues.length === 0,
    reviewEvidenceValid: review.valid,
    policyApproved: role === 'claim-bearing' && review.valid,
    issues: allIssues,
  };
}
