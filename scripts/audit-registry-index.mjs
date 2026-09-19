const ANCHOR_RE = /^<a id="([^"]+)"><\/a>$/;
const HEADING_RE = /^###\s+(.+)$/;
const SAFE_ANCHOR_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseAuditRegistrySections(content, sourcePath = 'AUDITORIA-REGISTRO.md') {
  const lines = String(content).split(/\r?\n/);
  const sections = [];
  let anchorCount = 0;
  let headingCount = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const anchor = lines[i].match(ANCHOR_RE);
    const heading = lines[i].match(HEADING_RE);

    if (anchor) {
      anchorCount += 1;
      const id = anchor[1];
      if (!SAFE_ANCHOR_RE.test(id)) {
        throw new Error(
          `${sourcePath}:${i + 1}: anchor no seguro "${id}"; usa minusculas ASCII y guiones`
        );
      }

      const nextHeading = String(lines[i + 1] || '').match(HEADING_RE);
      if (!nextHeading) {
        throw new Error(`${sourcePath}:${i + 1}: anchor "${id}" no seguido inmediatamente de ###`);
      }

      const title = nextHeading[1];
      if (title !== title.trim()) {
        throw new Error(`${sourcePath}:${i + 2}: titulo con espacios exteriores`);
      }
      sections.push({ id, title });
    }

    if (heading) {
      headingCount += 1;
      if (i === 0 || !ANCHOR_RE.test(lines[i - 1])) {
        throw new Error(`${sourcePath}:${i + 1}: seccion "${heading[1].trim()}" sin anchor inmediato`);
      }
    }
  }

  if (sections.length === 0) {
    throw new Error(`${sourcePath}: no hay ninguna seccion con anchor seguida de ###`);
  }
  if (sections.length !== anchorCount || sections.length !== headingCount) {
    throw new Error(
      `${sourcePath}: estructura incompleta (secciones=${sections.length}, anchors=${anchorCount}, titulos=${headingCount})`
    );
  }

  const ids = sections.map((section) => section.id);
  const duplicated = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicated) {
    throw new Error(`${sourcePath}: anchor duplicado "${duplicated}"`);
  }

  return sections;
}

function escapeMarkdownLinkLabel(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

export function renderAuditRegistryIndex(sections, registryPath = 'AUDITORIA-REGISTRO.md') {
  return sections
    .map((section) => `- [${escapeMarkdownLinkLabel(section.title)}](${registryPath}#${section.id})`)
    .join('\n');
}
