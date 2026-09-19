const { load, LEVELS, STATUSES } = require('./store');
const { ApiError, pickText } = require('./errors');

// 一条规则管不管这个文件：适用文件类型写成全部的管所有文件，否则只认同类型的
function ruleAppliesToFile(rule, file) {
  return rule.fileType === '全部' || rule.fileType === file.type;
}

function levelOrder(level) {
  const index = LEVELS.indexOf(level);
  return index === -1 ? LEVELS.length : index;
}

// 整词边界按字符认：字母（含汉字）、数字、下划线算词里的字，标点、空格、行首行尾算边界
const WORD_CHAR = /[\p{L}\p{N}_]/u;

function isWordChar(ch) {
  return ch !== '' && WORD_CHAR.test(ch);
}

// 写法前后都不挨着词里的字才算整词：夹在更长的词里不算，挨着标点或行首行尾算
function isWholeWord(text, start, length) {
  const before = start > 0 ? text[start - 1] : '';
  const after = start + length < text.length ? text[start + length] : '';
  return !isWordChar(before) && !isWordChar(after);
}

// 按规则的口径在一行里找写法，找到返回起止位置（位置相对去掉左侧空白后的行），没找到返回 null
function findMatch(line, rule) {
  const haystack = rule.ignoreCase ? line.toLowerCase() : line;
  const needle = rule.ignoreCase ? rule.pattern.toLowerCase() : rule.pattern;
  const leadSpaces = line.length - line.trimStart().length;
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return null;
    if (!rule.wholeWord || isWholeWord(haystack, at, needle.length)) {
      return { start: at - leadSpaces, end: at + needle.length - leadSpaces };
    }
    from = at + 1;
  }
  return null;
}

// 文件路径是不是落在规则要排除的目录段下面：路径等于该段，或以"该段/"开头
function isUnderExcludedDir(filePath, dir) {
  return !!dir && (filePath === dir || filePath.startsWith(`${dir}/`));
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
  // 每条配了排除目录的规则记一块：排除了哪些文件、压下了哪些本可以命中的行
  const exclusionMap = new Map();

  rulesUsed.forEach((rule) => {
    if (rule.excludeDir) {
      const filesExcluded = filesInScope
        .filter((file) => ruleAppliesToFile(rule, file))
        .filter((file) => isUnderExcludedDir(file.path, rule.excludeDir));
      if (filesExcluded.length) {
        exclusionMap.set(rule.id, {
          ruleId: rule.id,
          code: rule.code,
          ruleName: rule.name,
          level: rule.level,
          excludeDir: rule.excludeDir,
          files: filesExcluded.map((file) => ({
            fileId: file.id,
            path: file.path,
            fileType: file.type,
            suppressedLines: [],
          })),
        });
      }
    }

    filesInScope.filter((file) => ruleAppliesToFile(rule, file)).forEach((file) => {
      const excluded = isUnderExcludedDir(file.path, rule.excludeDir);
      const block = exclusionMap.get(rule.id);
      const excludedFile = block ? block.files.find((item) => item.fileId === file.id) : null;

      file.content.split('\n').forEach((text, index) => {
        const match = findMatch(text, rule);
        if (!match) return;

        if (excluded) {
          // 落在排除目录里：这一行本可以命中，只记数不进命中清单
          excludedFile.suppressedLines.push({
            lineNo: index + 1,
            lineText: text.trim(),
            matchStart: match.start,
            matchEnd: match.end,
          });
          return;
        }

        hits.push({
          ruleId: rule.id,
          code: rule.code,
          ruleName: rule.name,
          level: rule.level,
          pattern: rule.pattern,
          ignoreCase: rule.ignoreCase,
          wholeWord: rule.wholeWord,
          fileId: file.id,
          path: file.path,
          fileType: file.type,
          lineNo: index + 1,
          lineText: text.trim(),
          matchStart: match.start,
          matchEnd: match.end,
        });
      });
    });
  });

  const exclusions = Array.from(exclusionMap.values()).map((block) => ({
    ...block,
    fileCount: block.files.length,
    suppressedCount: block.files.reduce((sum, item) => sum + item.suppressedLines.length, 0),
  })).sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

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

  // 参与比对的规则里，三个开关各有多少条开着，让这一轮的口径在结果里看得见
  const optionsUsed = {
    ignoreCaseCount: rulesUsed.filter((item) => item.ignoreCase).length,
    wholeWordCount: rulesUsed.filter((item) => item.wholeWord).length,
    excludeDirCount: rulesUsed.filter((item) => !!item.excludeDir).length,
  };

  return {
    scannedAt: new Date().toISOString(),
    enabledRules: enabled.length,
    rulesUsed: rulesUsed.length,
    filesInScope: filesInScope.length,
    filesTotal: data.files.length,
    rulesTotal: data.rules.length,
    optionsUsed,
    warning,
    hits,
    exclusions,
    excludedFileTotal: exclusions.reduce((sum, block) => sum + block.fileCount, 0),
    suppressedTotal: exclusions.reduce((sum, block) => sum + block.suppressedCount, 0),
    summary: {
      total: hits.length,
      byLevel,
      byRule: Array.from(byRuleMap.values()).sort((a, b) => (a.code < b.code ? -1 : 1)),
      byFile: Array.from(byFileMap.values()).sort((a, b) => (a.path < b.path ? -1 : 1)),
    },
  };
}

module.exports = { scan, ruleAppliesToFile, levelOrder, findMatch, isUnderExcludedDir };
