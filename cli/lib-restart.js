function cloneValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function rebaseBlockedByVersionRefs(
  blockedBy,
  { fromVersionId, toVersionId } = {},
) {
  if (blockedBy == null || blockedBy === '') return blockedBy;
  if (!fromVersionId || !toVersionId) {
    throw new Error('fromVersionId and toVersionId are required');
  }
  const rewrite = (ref) => {
    const copy = cloneValue(ref);
    if (
      copy
      && typeof copy === 'object'
      && !Array.isArray(copy)
      && copy.type === 'task'
      && copy.taskGroupVersionId === fromVersionId
    ) {
      copy.taskGroupVersionId = toVersionId;
    }
    return copy;
  };
  return Array.isArray(blockedBy) ? blockedBy.map(rewrite) : rewrite(blockedBy);
}

function restartAncestorIds(version, versions) {
  const ids = new Set();
  let cursor = version;
  while (cursor) {
    const parentId = cursor.restartedFromVersionId || cursor.supersedesVersionId;
    if (!parentId || ids.has(parentId)) break;
    ids.add(parentId);
    cursor = versions.get(parentId);
  }
  return ids;
}

export function findSelectedRestartBlockedByIssues({ version, versions } = {}) {
  if (!version?.restartedFromVersionId) return [];
  const ancestorIds = restartAncestorIds(version, versions);
  const issues = [];
  for (const task of version.tasks || []) {
    const refs = Array.isArray(task.blockedBy)
      ? task.blockedBy
      : (task.blockedBy == null || task.blockedBy === '' ? [] : [task.blockedBy]);
    for (const ref of refs) {
      if (!ref || ref.type !== 'task' || !ancestorIds.has(ref.taskGroupVersionId)) continue;
      const referenced = versions.get(ref.taskGroupVersionId);
      if (referenced?.taskGroupId !== version.taskGroupId) continue;
      issues.push({
        taskId: task.id,
        blockedTaskId: ref.id || ref.taskId || '',
        referencedVersionId: ref.taskGroupVersionId,
      });
    }
  }
  return issues;
}
