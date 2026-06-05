/**
 * HaloFire Skill Loader
 *
 * Progressive Disclosure Pattern:
 *   1. ADVERTISE: Name + description only (~100 tokens)
 *   2. LOAD: Full SKILL.md instructions (<5000 tokens)
 *   3. RESOURCES: Reference files loaded on-demand
 *
 * Skills are self-contained directories:
 *   skills/<name>/
 *     SKILL.md          - Metadata + instructions (YAML frontmatter + markdown)
 *     index.js           - Skill entry point (exports handlers)
 *     handlers/          - Individual action handlers
 *     refs/              - Reference data files
 *     tests/             - Skill-specific tests
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(__dirname, '../skills');

// Parse YAML-ish frontmatter from SKILL.md
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { meta: {}, body: content };

  const meta = {};
  match[1].split('\n').forEach(line => {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) {
      const val = rest.join(':').trim().replace(/^["']|["']$/g, '');
      // Handle arrays (lines starting with -)
      if (val.startsWith('[')) {
        try { meta[key.trim()] = JSON.parse(val); } catch { meta[key.trim()] = val; }
      } else {
        meta[key.trim()] = val;
      }
    }
  });

  return { meta, body: content.slice(match[0].length).trim() };
}

// Phase 1: Advertise — lightweight skill catalog
export function advertiseSkills() {
  const skills = [];

  if (!fs.existsSync(SKILLS_DIR)) return skills;

  const dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const dir of dirs) {
    const skillPath = path.join(SKILLS_DIR, dir.name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;

    const content = fs.readFileSync(skillPath, 'utf8');
    const { meta } = parseFrontmatter(content);

    skills.push({
      id: dir.name,
      name: meta.name || dir.name,
      description: meta.description || '',
      version: meta.version || '1.0.0',
      triggers: meta.triggers ? JSON.parse(meta.triggers) : [],
      cronSchedule: meta.cron || null,
      enabled: meta.enabled !== 'false',
      category: meta.category || 'general',
      dependencies: meta.dependencies ? JSON.parse(meta.dependencies) : [],
    });
  }

  return skills;
}

// Phase 2: Load — full skill instructions
export function loadSkill(skillId) {
  const skillDir = path.join(SKILLS_DIR, skillId);
  const skillPath = path.join(skillDir, 'SKILL.md');

  if (!fs.existsSync(skillPath)) {
    throw new Error(`Skill not found: ${skillId}`);
  }

  const content = fs.readFileSync(skillPath, 'utf8');
  const { meta, body } = parseFrontmatter(content);

  return {
    id: skillId,
    meta,
    instructions: body,
    path: skillDir,
    hasIndex: fs.existsSync(path.join(skillDir, 'index.js')),
    handlers: getHandlerNames(skillDir),
    refs: getRefFiles(skillDir),
  };
}

// Phase 3: Load reference files on demand
export function loadSkillRef(skillId, refName) {
  const refPath = path.join(SKILLS_DIR, skillId, 'refs', refName);
  if (!fs.existsSync(refPath)) {
    throw new Error(`Ref not found: ${skillId}/refs/${refName}`);
  }
  return fs.readFileSync(refPath, 'utf8');
}

// Load skill's executable module
export async function loadSkillModule(skillId) {
  const indexPath = path.join(SKILLS_DIR, skillId, 'index.js');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`No index.js for skill: ${skillId}`);
  }
  return await import(indexPath);
}

// List handler files
function getHandlerNames(skillDir) {
  const handlersDir = path.join(skillDir, 'handlers');
  if (!fs.existsSync(handlersDir)) return [];
  return fs.readdirSync(handlersDir)
    .filter(f => f.endsWith('.js'))
    .map(f => f.replace('.js', ''));
}

// List reference files
function getRefFiles(skillDir) {
  const refsDir = path.join(skillDir, 'refs');
  if (!fs.existsSync(refsDir)) return [];
  return fs.readdirSync(refsDir);
}

// Match a user intent to the best skill
export function matchSkill(intent, skills = null) {
  const catalog = skills || advertiseSkills();
  const intentLower = intent.toLowerCase();

  // Score each skill
  const scored = catalog
    .filter(s => s.enabled)
    .map(skill => {
      let score = 0;

      // Check triggers
      if (skill.triggers.length) {
        for (const trigger of skill.triggers) {
          if (intentLower.includes(trigger.toLowerCase())) {
            score += 10;
          }
        }
      }

      // Check name match
      if (intentLower.includes(skill.id.toLowerCase())) score += 5;
      if (intentLower.includes(skill.name.toLowerCase())) score += 5;

      // Check description keywords
      const descWords = skill.description.toLowerCase().split(/\s+/);
      const intentWords = intentLower.split(/\s+/);
      for (const word of intentWords) {
        if (word.length > 3 && descWords.includes(word)) score += 2;
      }

      return { ...skill, score };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored;
}

export default {
  advertiseSkills,
  loadSkill,
  loadSkillRef,
  loadSkillModule,
  matchSkill,
};
