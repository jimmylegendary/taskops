import { createHash } from 'node:crypto';
import { inspectNonEmptyUtf8File } from './lib-artifact-contract.js';

const CLAIM_REASONS = new Set(['approved_result', 'execution_path_closed']);
const POLICY_MODES = new Set(['enforced', 'guarded', 'runner-managed']);

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

function inferredRole(node, eow) {
  return node?.type === 'implementation' && CLAIM_REASONS.has(eow?.reason)
    ? 'claim-bearing'
    : 'supporting';
}

function reviewEvidence(node, eow, runNodes, runEdges) {
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
  return { valid: issues.length === 0, issues };
}

export function classifyRunClosure({
  node,
  eow,
  runNodes,
  runEdges,
  versions,
  selectedVersionIds,
} = {}) {
  const expectedRole = inferredRole(node, eow);
  const role = eow?.closureRole || expectedRole;
  const selected = !node?.sourceTaskGroupVersionId
    || selectedVersionIds.size === 0
    || selectedVersionIds.has(node.sourceTaskGroupVersionId);
  const issues = [];
  if (!['supporting', 'claim-bearing'].includes(role)) issues.push(`invalid closureRole '${role}'`);
  if (eow?.closureRole && role !== expectedRole) issues.push(`closureRole spoof: expected ${expectedRole}`);
  if (role === 'supporting' && CLAIM_REASONS.has(eow?.reason)) {
    issues.push(`supporting closure cannot use claim reason '${eow.reason}'`);
  }

  if (selected && role === 'supporting' && node?.actionKind) {
    if (node.actionKind === 'explore') {
      const inspected = inspectNonEmptyUtf8File(node.result?.artifactPath, { label: 'exploration artifact' });
      if (!inspected.ok) issues.push(inspected.message);
    }
    if (node.actionKind === 'prototype') {
      const inspected = inspectNonEmptyUtf8File(node.result?.artifactPath, { label: 'prototype options artifact' });
      if (!inspected.ok) issues.push(inspected.message);
    }
    if (node.actionKind === 'decompose') {
      const backlink = [...versions.values()].some((version) => (
        version.decomposedByRunId === node.runId
        && version.decomposedByRunNodeId === node.id
      ));
      if (!backlink) issues.push('decomposition backlink missing for supporting closure');
    }
    if (node.actionKind === 'review') {
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

  const review = reviewEvidence(node, eow, runNodes, runEdges);
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
