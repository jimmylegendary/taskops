export function updateMarkdownFrontmatter(filePath, updater, io) {
  if (!io || typeof io !== 'object') throw new Error('Missing state writer I/O adapter');
  const {
    parseMarkdownFile,
    readBody,
    fmBlock,
    writeTextFile,
  } = io;
  if (typeof parseMarkdownFile !== 'function') throw new Error('Missing parseMarkdownFile adapter');
  if (typeof readBody !== 'function') throw new Error('Missing readBody adapter');
  if (typeof fmBlock !== 'function') throw new Error('Missing fmBlock adapter');
  if (typeof writeTextFile !== 'function') throw new Error('Missing writeTextFile adapter');

  const fm = parseMarkdownFile(filePath);
  const body = readBody(filePath);
  const next = updater({ ...fm }) ?? fm;
  const text = fmBlock(next) + (body ? body + '\n' : '');
  writeTextFile(filePath, text);
  return next;
}
