import { useState } from 'react';
import { Plus, Trash2, FileText, Code2, Check, CheckCircle2 } from 'lucide-react';
import { Button } from '../../components/common/UIComponents';
import { SyncRuleDto, RuleType } from '../../types/dto';
import { AiScope } from './AiScope';

import { allProjectRules, groups, makeRules, recommendedRules } from './rulePresets';
import { RulePathDiagnostics } from './RulePathDiagnostics';

export { recommendedRules } from './rulePresets';

export function RuleEditor({
  rules,
  onChange,
  localPath,
}: {
  rules: SyncRuleDto[];
  onChange: (rules: SyncRuleDto[]) => void;
  localPath: string;
}) {
  const [pattern, setPattern] = useState('');
  const [type, setType] = useState<RuleType>('EXCLUDE');
  const [message, setMessage] = useState('');
  const [ruleFilter, setRuleFilter] = useState<'ALL' | 'INCLUDE' | 'EXCLUDE'>('ALL');
  const [searchFilter, setSearchFilter] = useState('');

  const enabledIncludes = rules.filter((rule) => rule.enabled && rule.ruleType === 'INCLUDE').length;
  const isRecommendedMode = enabledIncludes > 0;

  const applyPreset = (preset: 'context' | 'project') => {
    if (preset === 'context' && isRecommendedMode) return;
    if (preset === 'project' && !isRecommendedMode) return;
    if (!window.confirm('切换预设方案将重置当前的规则列表。确定继续吗？')) return;
    onChange(preset === 'context' ? recommendedRules() : allProjectRules());
    setMessage('方案已切换并应用，请按需微调规则。');
  };

  const toggleGroup = (patterns: string[], checked: boolean) => {
    const keys = new Set(patterns.map((p) => p.toLowerCase()));
    if (!checked) {
      onChange(rules.filter((rule) => !(rule.ruleType === 'EXCLUDE' && keys.has(rule.pattern.toLowerCase()))));
      return;
    }
    const existing = new Set(
      rules
        .filter((rule) => rule.ruleType === 'EXCLUDE' && rule.enabled)
        .map((rule) => rule.pattern.toLowerCase())
    );
    const retained = rules.filter(
      (rule) => !(rule.ruleType === 'EXCLUDE' && !rule.enabled && keys.has(rule.pattern.toLowerCase()))
    );
    onChange([
      ...retained,
      ...makeRules(
        'EXCLUDE',
        patterns.filter((p) => !existing.has(p.toLowerCase())),
        Date.now()
      ),
    ]);
  };

  const addRule = () => {
    const value = pattern.trim().replace(/\\/g, '/');
    if (!value) return;
    if (
      rules.some(
        (rule) => rule.ruleType === type && rule.pattern.toLowerCase() === value.toLowerCase()
      )
    ) {
      setMessage('该过滤规则已存在。');
      return;
    }
    onChange([...rules, ...makeRules(type, [value], Date.now())]);
    setPattern('');
    setMessage('');
  };

  const filteredRules = rules.filter((rule) => {
    if (ruleFilter !== 'ALL' && rule.ruleType !== ruleFilter) return false;
    if (searchFilter.trim() && !rule.pattern.toLowerCase().includes(searchFilter.trim().toLowerCase())) {
      return false;
    }
    return true;
  });

  const includeCount = rules.filter((r) => r.ruleType === 'INCLUDE').length;
  const excludeCount = rules.filter((r) => r.ruleType === 'EXCLUDE').length;

  return (
    <div className="space-y-4 text-xs">
      {/* 1. Scope Selection Preset Cards */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            同步范围模式
          </label>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
            {isRecommendedMode
              ? `白名单模式 · ${enabledIncludes} 条包含规则`
              : '全量同步模式'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Preset Card 1: Context & Config */}
          <div
            onClick={() => applyPreset('context')}
            className={`p-3.5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between relative ${
              isRecommendedMode
                ? 'border-indigo-500 ring-2 ring-indigo-500/15 bg-indigo-50/40 dark:bg-indigo-950/30 text-slate-900 dark:text-slate-100 shadow-soft-sm'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 hover:border-slate-300 dark:hover:border-slate-600 text-slate-700 dark:text-slate-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-xs text-slate-900 dark:text-slate-100">
                <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>文档与项目配置</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  推荐
                </span>
              </div>
              {isRecommendedMode && (
                <div className="w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0">
                  <Check className="w-2.5 h-2.5" />
                </div>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              同步 Markdown、文本、AI 规则提示词及 docs / config 目录
            </p>
          </div>

          {/* Preset Card 2: Full Project */}
          <div
            onClick={() => applyPreset('project')}
            className={`p-3.5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between relative ${
              !isRecommendedMode
                ? 'border-indigo-500 ring-2 ring-indigo-500/15 bg-indigo-50/40 dark:bg-indigo-950/30 text-slate-900 dark:text-slate-100 shadow-soft-sm'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 hover:border-slate-300 dark:hover:border-slate-600 text-slate-700 dark:text-slate-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-xs text-slate-900 dark:text-slate-100">
                <Code2 className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                <span>完整工程源码</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                  全量
                </span>
              </div>
              {!isRecommendedMode && (
                <div className="w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0">
                  <Check className="w-2.5 h-2.5" />
                </div>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              同步工程内全部源码与资源，自动排除依赖、构建产物与临时文件
            </p>
          </div>
        </div>
      </div>

      {/* 2. Quick Exclusions Chips */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            快速排除常用目录与文件
          </label>
          <span className="text-[11px] text-slate-400 dark:text-slate-500">
            排除规则优先生效
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
          {groups.map((group) => {
            const Icon = group.icon;
            const activeCount = group.patterns.filter((p) =>
              rules.some(
                (r) =>
                  r.enabled &&
                  r.ruleType === 'EXCLUDE' &&
                  r.pattern.toLowerCase() === p.toLowerCase()
              )
            ).length;
            const isAllActive = activeCount === group.patterns.length;
            const isPartial = activeCount > 0 && !isAllActive;

            return (
              <button
                key={group.id}
                type="button"
                onClick={() => toggleGroup(group.patterns, !isAllActive)}
                className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between gap-1.5 ${
                  isAllActive
                    ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50/60 dark:bg-indigo-950/40 text-indigo-950 dark:text-indigo-100 shadow-soft-sm'
                    : isPartial
                    ? 'border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/30 text-amber-950 dark:text-amber-100'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/70 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <Icon
                    className={`w-3.5 h-3.5 ${
                      isAllActive
                        ? 'text-indigo-600 dark:text-indigo-400'
                        : isPartial
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-slate-400'
                    }`}
                  />
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      isAllActive
                        ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300 font-semibold'
                        : isPartial
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                    }`}
                  >
                    {isAllActive ? '已排除' : isPartial ? `${activeCount}/${group.patterns.length}` : '未排除'}
                  </span>
                </div>
                <div>
                  <div className="font-semibold text-xs truncate">{group.label}</div>
                  <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 truncate mt-0.5">
                    {group.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Custom Rules List & Add Bar */}
      <div className="border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800/80 overflow-hidden shadow-soft-sm">
        {/* Header & Filter Tabs */}
        <div className="px-3.5 py-2.5 bg-slate-50/80 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-xs text-slate-900 dark:text-slate-100">
              自定义规则
            </span>
            <span className="text-[11px] font-mono tabular-nums text-slate-500 bg-slate-200/70 dark:bg-slate-800 px-1.5 py-0.5 rounded">
              {rules.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Filter Tabs */}
            <div className="flex rounded-lg bg-slate-200/60 dark:bg-slate-800 p-0.5">
              <button
                type="button"
                onClick={() => setRuleFilter('ALL')}
                className={`px-2.5 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
                  ruleFilter === 'ALL'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-soft-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                全部 ({rules.length})
              </button>
              <button
                type="button"
                onClick={() => setRuleFilter('INCLUDE')}
                className={`px-2.5 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
                  ruleFilter === 'INCLUDE'
                    ? 'bg-white dark:bg-slate-700 text-emerald-700 dark:text-emerald-300 shadow-soft-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                包含 ({includeCount})
              </button>
              <button
                type="button"
                onClick={() => setRuleFilter('EXCLUDE')}
                className={`px-2.5 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
                  ruleFilter === 'EXCLUDE'
                    ? 'bg-white dark:bg-slate-700 text-rose-700 dark:text-rose-300 shadow-soft-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                排除 ({excludeCount})
              </button>
            </div>

            {/* Quick Search */}
            <div className="relative">
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="筛选规则..."
                className="w-28 focus:w-40 transition-all bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 text-[11px] font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* Inline Add Bar */}
        <div className="p-3 bg-slate-50/30 dark:bg-slate-900/40 border-b border-slate-200/80 dark:border-slate-700/80 flex flex-wrap sm:flex-nowrap items-center gap-2">
          {/* Segmented Type Toggle (Subtle surface styling so it doesn't clash with primary Add button) */}
          <div className="flex rounded-lg bg-slate-200/70 dark:bg-slate-800 p-0.5 shrink-0 border border-slate-200/80 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setType('INCLUDE')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                type === 'INCLUDE'
                  ? 'bg-white dark:bg-slate-700 text-emerald-700 dark:text-emerald-300 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              + 包含
            </button>
            <button
              type="button"
              onClick={() => setType('EXCLUDE')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                type === 'EXCLUDE'
                  ? 'bg-white dark:bg-slate-700 text-rose-700 dark:text-rose-300 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              - 排除
            </button>
          </div>

          <input
            aria-label="规则表达式"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addRule();
              }
            }}
            placeholder="填写 Glob 表达式，例如: docs/**、**/*.md、**/cache/**"
            className="min-w-0 flex-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
          />

          <Button variant="primary" size="sm" onClick={addRule} className="gap-1 shrink-0 py-1.5 px-3">
            <Plus className="w-3.5 h-3.5" /> 添加
          </Button>
        </div>

        {/* Rules 2-Column Scrollable Grid */}
        <div className="max-h-64 overflow-y-auto p-2.5">
          {filteredRules.length === 0 ? (
            <div className="py-6 text-center text-slate-400 text-xs">
              {searchFilter ? '未找到匹配该关键字的规则' : '当前类别暂无规则'}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
              {filteredRules.map((rule, idx) => {
                const originalIndex = rules.indexOf(rule);
                return (
                  <div
                    key={`${rule.id || idx}-${rule.pattern}`}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded-lg border border-slate-200/70 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-slate-100/70 dark:hover:bg-slate-800/80 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                          rule.ruleType === 'INCLUDE'
                            ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                            : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                        }`}
                      >
                        {rule.ruleType === 'INCLUDE' ? '包含' : '排除'}
                      </span>
                      <code
                        title={rule.pattern}
                        className={`font-mono text-xs truncate ${
                          rule.enabled
                            ? 'text-slate-800 dark:text-slate-200 font-medium'
                            : 'text-slate-400 dark:text-slate-500 line-through'
                        }`}
                      >
                        {rule.pattern}
                      </code>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <label className="flex items-center gap-1 cursor-pointer text-[11px] text-slate-500 dark:text-slate-400 select-none">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={(e) =>
                            onChange(
                              rules.map((r, i) =>
                                i === originalIndex ? { ...r, enabled: e.target.checked } : r
                              )
                            )
                          }
                          className="rounded text-indigo-600 focus:ring-indigo-500"
                        />
                        <span>启用</span>
                      </label>
                      <button
                        type="button"
                        aria-label={`删除规则 ${rule.pattern}`}
                        onClick={() => onChange(rules.filter((_, i) => i !== originalIndex))}
                        className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                        title="删除规则"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {message && (
        <div
          role="status"
          className="text-xs text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-lg p-2 flex items-center gap-1.5"
        >
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {/* 4 & 5. Side-by-side Auxiliary Tools: Path Diagnostics & AI Scope Recommendation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
        <RulePathDiagnostics rules={rules} />

        <AiScope key={localPath} localPath={localPath} onApply={onChange} />
      </div>
    </div>
  );
}
