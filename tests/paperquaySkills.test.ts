import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const mcpSource = readFileSync(path.join(repoRoot, 'bin/paperquay-mcp.cjs'), 'utf8');
const mcpToolNames = [...mcpSource.matchAll(/^\s*name: '([a-z_]+)',$/gm)].map((match) => match[1]);

const SKILL_TOOLS: Record<string, string[]> = {
  'paperquay-knowledge-search': [
    'search_papers',
    'get_paper_details',
    'search_knowledge_base',
    'read_paper_content',
    'search_notes',
  ],
  'paperquay-zotero-sync': [
    'zotero_list_collections',
    'zotero_search_items',
    'zotero_preview_sync',
    'paperquay_sync_from_zotero',
  ],
  'paperquay-library-manage': [
    'search_papers',
    'get_paper_details',
    'list_categories',
    'import_pdfs',
    'manage_category',
    'set_paper_categories',
    'update_paper',
    'delete_papers',
  ],
  'paperquay-notes': [
    'search_notes',
    'list_note_tags',
    'list_note_folders',
    'create_note',
    'update_note',
    'delete_note',
    'create_note_folder',
    'rename_note_folder',
    'delete_note_folder',
  ],
};

test('repo skills cover the planned set and every referenced tool exists in MCP', () => {
  assert.deepEqual([...new Set(mcpToolNames)].length, 23, 'MCP must expose exactly 23 unique tools');

  const skillDirs = readdirSync(path.join(repoRoot, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(skillDirs, Object.keys(SKILL_TOOLS).sort());

  for (const [skillName, tools] of Object.entries(SKILL_TOOLS)) {
    const skillPath = path.join(repoRoot, 'skills', skillName, 'SKILL.md');
    const content = readFileSync(skillPath, 'utf8');
    const frontmatterName = content.match(/^name:\s*(\S+)\s*$/m)?.[1];
    assert.equal(frontmatterName, skillName, `${skillName} frontmatter name mismatch`);
    for (const tool of tools) {
      assert.ok(mcpToolNames.includes(tool), `${skillName} references unknown MCP tool: ${tool}`);
      assert.ok(content.includes(`\`${tool}\``), `${skillName} must document tool ${tool}`);
    }
  }
});

test('MCP integration guide documents every registered tool and repo skill', () => {
  const guide = readFileSync(path.join(repoRoot, 'docs/MCP_AGENT_INTEGRATION.md'), 'utf8');
  for (const tool of new Set(mcpToolNames)) {
    assert.ok(guide.includes(`\`${tool}\``), `MCP guide must document tool ${tool}`);
  }
  for (const skillName of Object.keys(SKILL_TOOLS)) {
    assert.ok(guide.includes(`skills/${skillName}/SKILL.md`), `MCP guide must reference ${skillName}`);
  }
});
