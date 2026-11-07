import { GitBranch, Package, Hammer, KeyRound, FileClock } from 'lucide-react';
import { SyncRuleDto, RuleType } from '../../types/dto';


interface ExclusionGroup {
  id: string;
  label: string;
  description: string;
  icon: typeof GitBranch;
  patterns: string[];
}

export const groups: ExclusionGroup[] = [
  {
    id: 'repo',
    label: '版本库',
    description: '.git, .svn, .hg',
    icon: GitBranch,
    patterns: ['**/.git/**', '**/.svn/**', '**/.hg/**'],
  },
  {
    id: 'deps',
    label: '依赖与环境',
    description: 'node_modules, venv, vendor',
    icon: Package,
    patterns: ['**/node_modules/**', '**/vendor/**', '**/.venv/**', '**/venv/**'],
  },
  {
    id: 'build',
    label: '构建与缓存',
    description: 'dist, build, target, cache',
    icon: Hammer,
    patterns: [
      '**/target/**',
      '**/dist/**',
      '**/build/**',
      '**/__pycache__/**',
      '**/.next/**',
      '**/.cache/**',
    ],
  },
  {
    id: 'env',
    label: '环境变量文件',
    description: '.env, .env.*',
    icon: KeyRound,
    patterns: ['**/.env', '**/.env.*'],
  },
  {
    id: 'temp',
    label: '临时文件',
    description: '*.tmp, *.log, .DS_Store',
    icon: FileClock,
    patterns: ['**/*.tmp', '**/*.log', '**/.DS_Store', '**/Thumbs.db'],
  },
];

const contextPatterns = [
  '**/*.md',
  '**/*.mdc',
  '**/*.txt',
  '**/.cursor/rules/**',
  '**/.windsurf/rules/**',
  '**/.github/instructions/**',
  '**/docs/**',
  '**/config/**',
  '**/prompts/**',
];

export const makeRules = (type: RuleType, patterns: string[], start = 0): SyncRuleDto[] =>
  patterns.map((pattern, index) => ({
    id: -(start + index + 1),
    ruleType: type,
    pattern,
    enabled: true,
    priority: index * 10 + 10,
  }));

export function recommendedRules(): SyncRuleDto[] {
  const includes = makeRules('INCLUDE', contextPatterns);
  return [...includes, ...makeRules('EXCLUDE', groups.flatMap((group) => group.patterns), includes.length)];
}

export function allProjectRules(): SyncRuleDto[] {
  return makeRules('EXCLUDE', groups.flatMap((group) => group.patterns));
}
