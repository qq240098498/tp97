const { load, LEVELS, STATUSES, normalizeExcludeDir } = require('./store');
const { ApiError, pickText } = require('./errors');

// 整词判断里的“词字符”：字母（含汉字）、数字与下划线；其余都算标点或空白
const WORD_CHAR = /[\p{L}\p{N}_]/u;

// 一条规则管不管这个文件：适用文件类型写成全部的管所有文件，否则只认同类型的
function ruleAppliesToFile(rule, file) {
  return rule.fileType === '全部' || rule.fileType === file.type;
}

// 一行里有没有命中：忽略大小写就先统一成小写再比；
// 只认整词时，写法前后紧挨词字符（夹在更长的词里）不算，前后是标点、空白或者行首行尾才算
function lineMatches(text, rule) {
  const needle = rule.ignoreCase ? rule.pattern.toLowerCase() : rule.pattern;
  if (!needle) return false;
  const hay = rule.ignoreCase ? text.toLowerCase() : text;
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at === -1) return false;
    if (!rule.wholeWord) return true;
    const before = at > 0 ? hay[at - 1] : '';
    const after = at + needle.length < hay.length ? hay[at + needle.length] : '';
    const headOpen = !WORD_CHAR.test(needle[0]) || !before || !WORD_CHAR.test(before);
    const tailOpen = !WORD_CHAR.test(needle[needle.length - 1]) || !after || !WORD_CHAR.test(after);
    if (headOpen && tailOpen) return true;
    from = at + 1;
  }
}

// 文件路径是否落在排除目录里，比较时不分大小写
function isUnderDir(filePath, dir) {
  if (!dir) return false;
  const lowerPath = filePath.toLowerCase();
  const lowerDir = dir.toLowerCase();
  return lowerPath === lowerDir || lowerPath.startsWith(`${lowerDir}/`);
}

function levelOrder(level) {
  const index = LEVELS.indexOf(level);
  return index === -1 ? LEVELS.length : index;
}

// 扫一遍：启用的规则逐条去比对范围内的文件，命中记到具体行上
function scan(options) {
  const input = options && typeof options === 'object' ? options : {};
  const level = pickText(input.level);
  const fileId = pickText(input.fileId);
  const ruleId = pickText(input.ruleId);

  if (level && !LEVELS.includes(level)) {
    throw new ApiError(400, 'LEVEL_INVALID', `级别只能是 ${LEVELS.join('、')} 其中之一`, 'scanLevel');
  }

  const data = load();

  let scopeFile = null;
  if (fileId) {
    scopeFile = data.files.find((item) => item.id === fileId);
    if (!scopeFile) throw new ApiError(404, 'FILE_NOT_FOUND', '选中的文件不在清单里', 'scanFile');
  }

  let scopeRule = null;
  if (ruleId) {
    scopeRule = data.rules.find((item) => item.id === ruleId);
    if (!scopeRule) throw new ApiError(404, 'RULE_NOT_FOUND', '选中的规则不在清单里', 'scanRule');
  }

  const enabled = data.rules.filter((item) => item.status === STATUSES[0]);
  const warning = scopeRule && scopeRule.status !== STATUSES[0]
    ? `${scopeRule.code} 当前是停用状态，这一轮不参与比对`
    : '';

  const rulesUsed = enabled
    .filter((item) => !scopeRule || item.id === scopeRule.id)
    .filter((item) => !level || item.level === level);

  const filesInScope = scopeFile ? [scopeFile] : data.files;

  const hits = [];
  const exclusionMap = new Map();
  rulesUsed.forEach((rule) => {
    const excludeDir = normalizeExcludeDir(rule.excludeDir);
    filesInScope.filter((file) => ruleAppliesToFile(rule, file)).forEach((file) => {
      const excluded = isUnderDir(file.path, excludeDir);
      if (excluded) {
        if (!exclusionMap.has(file.id)) {
          exclusionMap.set(file.id, { fileId: file.id, path: file.path, codes: new Set(), dropped: 0 });
        }
        exclusionMap.get(file.id).codes.add(rule.code);
      }
      file.content.split('\n').forEach((text, index) => {
        if (!lineMatches(text, rule)) return;
        const hit = {
          ruleId: rule.id,
          code: rule.code,
          ruleName: rule.name,
          level: rule.level,
          pattern: rule.pattern,
          ignoreCase: rule.ignoreCase,
          wholeWord: rule.wholeWord,
          excludeDir,
          fileId: file.id,
          path: file.path,
          fileType: file.type,
          lineNo: index + 1,
          lineText: text.trim(),
        };
        if (excluded) {
          // 落在排除目录里的命中不进清单，只记进排除统计
          exclusionMap.get(file.id).dropped += 1;
        } else {
          hits.push(hit);
        }
      });
    });
  });

  const excludedFiles = Array.from(exclusionMap.values())
    .map((item) => ({ fileId: item.fileId, path: item.path, codes: Array.from(item.codes).sort(), dropped: item.dropped }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  const droppedHits = excludedFiles.reduce((sum, item) => sum + item.dropped, 0);

  hits.sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return a.lineNo - b.lineNo;
  });

  const byLevel = {};
  LEVELS.forEach((item) => { byLevel[item] = 0; });
  hits.forEach((hit) => { byLevel[hit.level] += 1; });

  const byRuleMap = new Map();
  hits.forEach((hit) => {
    const key = hit.code;
    if (!byRuleMap.has(key)) {
      byRuleMap.set(key, { code: hit.code, ruleName: hit.ruleName, level: hit.level, count: 0 });
    }
    byRuleMap.get(key).count += 1;
  });

  const byFileMap = new Map();
  hits.forEach((hit) => {
    const key = hit.path;
    if (!byFileMap.has(key)) byFileMap.set(key, { path: hit.path, fileType: hit.fileType, count: 0 });
    byFileMap.get(key).count += 1;
  });

  return {
    scannedAt: new Date().toISOString(),
    enabledRules: enabled.length,
    rulesUsed: rulesUsed.length,
    filesInScope: filesInScope.length,
    filesTotal: data.files.length,
    rulesTotal: data.rules.length,
    warning,
    hits,
    exclusions: {
      fileCount: excludedFiles.length,
      droppedHits,
      files: excludedFiles,
    },
    summary: {
      total: hits.length,
      byLevel,
      byRule: Array.from(byRuleMap.values()).sort((a, b) => (a.code < b.code ? -1 : 1)),
      byFile: Array.from(byFileMap.values()).sort((a, b) => (a.path < b.path ? -1 : 1)),
    },
  };
}

module.exports = { scan, ruleAppliesToFile, lineMatches, isUnderDir, levelOrder };
