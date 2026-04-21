const SYNC_OUTPUTS = new Set([
  'sitemap.xml',
  'feed.xml',
  'data/guides-search-index.json',
  'README.md',
  'CAPACIDADES-WEB.md',
  'JSON-SCHEMA.md'
]);

export function isSyncInput(relPath) {
  return (
    relPath.endsWith('.html') ||
    /^js\/.+\.js$/.test(relPath) ||
    relPath === 'sw.js' ||
    relPath === 'styles.css' ||
    relPath === 'fonts.css' ||
    relPath.endsWith('.webmanifest') ||
    relPath === 'tarifas.json' ||
    relPath === 'novedades.json'
  );
}

export function isSyncManagedPath(relPath) {
  return isSyncInput(relPath) || SYNC_OUTPUTS.has(relPath);
}

export function needsSync(stagedFiles) {
  return stagedFiles.some(isSyncManagedPath);
}

export function getBlockingManagedFiles({ stagedFiles, unstagedFiles, untrackedFiles }) {
  const stagedSet = new Set(stagedFiles);
  const unstagedManaged = unstagedFiles.filter(isSyncManagedPath);
  const partiallyStagedManaged = unstagedManaged.filter((relPath) => stagedSet.has(relPath));
  const dirtyButUnstagedManaged = unstagedManaged.filter((relPath) => !stagedSet.has(relPath));
  const untrackedManaged = untrackedFiles.filter(isSyncManagedPath);

  return {
    partiallyStagedManaged,
    dirtyButUnstagedManaged,
    untrackedManaged,
    hasBlocking:
      partiallyStagedManaged.length > 0 ||
      dirtyButUnstagedManaged.length > 0 ||
      untrackedManaged.length > 0
  };
}

export function getFilesToRestage(stagedFiles) {
  const filesToStage = new Set(SYNC_OUTPUTS);

  for (const relPath of stagedFiles) {
    if (relPath.endsWith('.html')) {
      filesToStage.add(relPath);
    }
  }

  return [...filesToStage];
}
