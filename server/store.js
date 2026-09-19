const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const TEMP_FILE = path.join(DATA_DIR, 'db.json.tmp');

const LEVELS = ['提示', '警告', '错误'];
const STATUSES = ['启用', '停用'];
const FILE_TYPES = ['全部', 'js', 'sh', 'md', 'yml'];
const MAX_CODE_LENGTH = 20;
const MAX_RULE_NAME_LENGTH = 40;
const MAX_PATTERN_LENGTH = 60;
const MAX_NOTE_LENGTH = 200;
const MAX_EXCLUDE_DIR_LENGTH = 120;
const MAX_PATH_LENGTH = 120;
const MAX_CONTENT_LENGTH = 4000;

// 排除目录只能是一段段的相对目录，例如 src/web/legacy，不许带开头的斜线或上级跳转
const DIR_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

// 排除目录落盘前统一长相：去掉首尾空白、开头的 ./ 或 / 与结尾的 /
function normalizeDirSegment(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim().replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!text || text.length > MAX_EXCLUDE_DIR_LENGTH || !DIR_SEGMENT_PATTERN.test(text)) return '';
  return text;
}

// 检查规则的初始数据。十二条规则里有两条是停用的，
// 有一条启用的规则在现有文件里一条命中都没有，用来观察从未命中的规则。
// 三个比对开关也各有代表：CODE-001 只认整词、CODE-003 忽略大小写、CODE-004 排除一段目录
function seedRules() {
  const at = '2026-09-02T02:00:00.000Z';
  return [
    { id: 'rule-1001', code: 'CODE-001', name: '禁止提交调试输出', level: '警告', status: '启用', fileType: 'js', pattern: 'console.log', ignoreCase: false, wholeWord: true, excludeDir: '', note: '上线前要换成统一日志；只认整词，console.logger 这种不算', createdAt: at, updatedAt: at },
    { id: 'rule-1002', code: 'CODE-002', name: '变量声明统一用 let 或 const', level: '错误', status: '启用', fileType: 'js', pattern: 'var ', ignoreCase: false, wholeWord: false, excludeDir: '', note: '老代码里还有不少', createdAt: at, updatedAt: at },
    { id: 'rule-1003', code: 'CODE-003', name: '待办事项需要收口', level: '提示', status: '启用', fileType: '全部', pattern: 'TODO', ignoreCase: true, wholeWord: false, excludeDir: '', note: '带人名与期限的可以留；忽略大小写，todo、Todo 都算', createdAt: at, updatedAt: at },
    { id: 'rule-1004', code: 'CODE-004', name: '禁止动态执行代码', level: '错误', status: '启用', fileType: '全部', pattern: 'eval(', ignoreCase: false, wholeWord: false, excludeDir: 'src/web/legacy', note: '历史遗留目录里的旧代码先不动，这一片不产生命中', createdAt: at, updatedAt: at },
    { id: 'rule-1005', code: 'CODE-005', name: '禁止把口令写进代码', level: '错误', status: '启用', fileType: '全部', pattern: 'password =', ignoreCase: false, wholeWord: false, excludeDir: '', note: '口令一律走统一配置', createdAt: at, updatedAt: at },
    { id: 'rule-1006', code: 'CODE-006', name: '空捕获块要写清原因', level: '警告', status: '启用', fileType: 'js', pattern: 'catch (e) {}', ignoreCase: false, wholeWord: false, excludeDir: '', note: '', createdAt: at, updatedAt: at },
    { id: 'rule-1007', code: 'CODE-007', name: '调试开关上线前要关掉', level: '警告', status: '停用', fileType: 'js', pattern: 'DEBUG = true', ignoreCase: false, wholeWord: false, excludeDir: '', note: '等联调结束再打开', createdAt: at, updatedAt: at },
    { id: 'rule-1008', code: 'CODE-008', name: '数据库地址不许写死在代码里', level: '错误', status: '启用', fileType: '全部', pattern: 'postgres://', ignoreCase: false, wholeWord: false, excludeDir: '', note: '', createdAt: at, updatedAt: at },
    { id: 'rule-1009', code: 'CODE-009', name: '取配置项要走统一封装', level: '提示', status: '启用', fileType: 'js', pattern: 'process.env[', ignoreCase: false, wholeWord: false, excludeDir: '', note: '直接按名字取容易拼错', createdAt: at, updatedAt: at },
    { id: 'rule-1010', code: 'CODE-010', name: '遗留注释要清理', level: '提示', status: '停用', fileType: '全部', pattern: 'FIXME', ignoreCase: false, wholeWord: false, excludeDir: '', note: '', createdAt: at, updatedAt: at },
    { id: 'rule-1011', code: 'CODE-011', name: '脚本里禁止直接用强制删除', level: '警告', status: '启用', fileType: 'sh', pattern: 'rm -rf', ignoreCase: false, wholeWord: false, excludeDir: '', note: '脚本里改用受控的清理命令', createdAt: at, updatedAt: at },
    { id: 'rule-1012', code: 'CODE-012', name: '文档里的临时占位要删掉', level: '提示', status: '启用', fileType: 'md', pattern: '待补', ignoreCase: false, wholeWord: false, excludeDir: '', note: '', createdAt: at, updatedAt: at },
  ];
}

// 纳入检查的文件。里面有干净的、有踩了好几处的，也有踩到停用规则里那个写法的
function seedFiles() {
  const at = '2026-09-02T03:00:00.000Z';
  return [
    {
      id: 'file-2001',
      path: 'src/server/api.js',
      type: 'js',
      content: [
        'const express = require("express");',
        'const router = express.Router();',
        '',
        'router.get("/users", (req, res) => {',
        '  console.log("查询用户列表");',
        '  var limit = Number(req.query.limit || 20);',
        '  // TODO 分页参数还要补校验',
        '  const parsed = eval("(" + req.query.filter + ")");',
        '  res.json({ limit, parsed });',
        '});',
        '',
        'module.exports = router;',
      ].join('\n'),
      note: '用户相关接口',
      createdAt: at,
      updatedAt: at,
    },
    {
      id: 'file-2002',
      path: 'src/server/store.js',
      type: 'js',
      content: [
        'const fs = require("fs");',
        '',
        'function dataFile() {',
        '  const dir = process.env["DATA_DIR"] || "./data";',
        '  console.log("数据目录", dir);',
        '  // todo 数据目录以后要支持多环境',
        '  return dir + "/db.json";',
        '}',
        '',
        'function load() {',
        '  return JSON.parse(fs.readFileSync(dataFile(), "utf8"));',
        '}',
        '',
        'module.exports = { load };',
      ].join('\n'),
      note: '',
      createdAt: at,
      updatedAt: at,
    },
    {
      id: 'file-2003',
      path: 'src/server/user.js',
      type: 'js',
      content: [
        'const db = require("./db");',
        '',
        'const conn = "postgres://app:app@127.0.0.1:5432/member";',
        'const password = "app-2026";',
        '',
        'function findUser(id) {',
        '  try {',
        '    return db.query("select * from users where id = $1", [id]);',
        '  } catch (e) {}',
        '}',
        '',
        'module.exports = { findUser, conn, password };',
      ].join('\n'),
      note: '账号查询',
      createdAt: at,
      updatedAt: at,
    },
    {
      id: 'file-2004',
      path: 'src/server/report.js',
      type: 'js',
      content: [
        'function summarize(rows) {',
        '  var total = 0;',
        '  rows.forEach((row) => {',
        '    total += row.amount;',
        '  });',
        '  // TODO 还要区分已退款的部分',
        '  return { total, count: rows.length };',
        '}',
        '',
        'module.exports = { summarize };',
      ].join('\n'),
      note: '',
      createdAt: at,
      updatedAt: at,
    },
    {
      id: 'file-2005',
      path: 'src/web/app.js',
      type: 'js',
      content: [
        'const state = { list: [] };',
        '',
        'async function load() {',
        '  console.log("开始加载");',
        '  const res = await fetch("/api/users");',
        '  state.list = await res.json();',
        '  render();',
        '}',
        '',
        'function render() {',
        '  var box = document.getElementById("list");',
        '  // Todo 渲染失败的时候要给用户提示',
        '  console.logger("加载条数", box.length);',
        '  box.textContent = state.list.length + " 条";',
        '}',
      ].join('\n'),
      note: '页面入口',
      createdAt: at,
      updatedAt: at,
    },
    {
      id: 'file-2006',
      path: 'src/web/format.js',
      type: 'js',
      content: [
        'const PAD = (num) => String(num).padStart(2, "0");',
        '',
        'function formatTime(value) {',
        '  const date = new Date(value);',
        '  return date.getFullYear() + "-" + PAD(date.getMonth() + 1) + "-" + PAD(date.getDate());',
        '}',
        '',
        'function formatAmount(cents) {',
        '  return (cents / 100).toFixed(2);',
        '}',
        '',
        'module.exports = { formatTime, formatAmount };',
      ].join('\n'),
      note: '格式化工具，比较干净',
      createdAt: at,
      updatedAt: at,
    },
    {
      id: 'file-2007',
      path: 'src/web/legacy/old-util.js',
      type: 'js',
      content: [
        '// FIXME 这个文件准备整体删掉，暂时先用着',
        'function pick(source, keys) {',
        '  var out = {};',
        '  keys.forEach(function (key) {',
        '    out[key] = source[key];',
        '  });',
        '  console.log("pick", keys.length);',
        '  return out;',
        '}',
        '',
        'function run(expr) {',
        '  return eval(expr);',
        '}',
        '',
        'module.exports = { pick, run };',
      ].join('\n'),
      note: '历史遗留工具',
      createdAt: at,
      updatedAt: at,
    },
    {
      id: 'file-2008',
      path: 'src/config/default.js',
      type: 'js',
      content: [
        'const DEBUG = true;',
        '',
        'const config = {',
        '  port: Number(process.env["PORT"] || 4000),',
        '  password = "member-2026",',
        '  redis: "redis://127.0.0.1:6379/0",',
        '};',
        '',
        'module.exports = config;',
      ].join('\n'),
      note: '默认配置，里面有调试开关',
      createdAt: at,
      updatedAt: at,
    },
    {
      id: 'file-2009',
      path: 'scripts/deploy.sh',
      type: 'sh',
      content: [
        '#!/usr/bin/env bash',
        'set -e',
        '',
        'APP_DIR=/opt/member',
        '',
        '# TODO 换机器之后要改掉这个路径',
        'cd "$APP_DIR"',
        'git pull --ff-only',
        'npm ci --omit=dev',
        'npm start &',
        '',
        'echo "发布完成"',
      ].join('\n'),
      note: '发布脚本',
      createdAt: at,
      updatedAt: at,
    },
    {
      id: 'file-2010',
      path: 'scripts/migrate.sh',
      type: 'sh',
      content: [
        '#!/usr/bin/env bash',
        'set -e',
        '',
        'DB_URL="postgres://app:app@127.0.0.1:5432/member"',
        '',
        'psql "$DB_URL" -f sql/2026-09-01-member.sql',
        'echo "迁移完成"',
      ].join('\n'),
      note: '迁移脚本',
      createdAt: at,
      updatedAt: at,
    },
    {
      id: 'file-2011',
      path: 'docs/readme.md',
      type: 'md',
      content: [
        '# 会员中心',
        '',
        '## 启动',
        '',
        '先装依赖再启动，端口默认 4000。',
        '',
        '## 部署',
        '',
        '待补',
        '',
        '<!-- TODO 补上回滚步骤 -->',
      ].join('\n'),
      note: '',
      createdAt: at,
      updatedAt: at,
    },
    {
      id: 'file-2012',
      path: 'config/deploy.yml',
      type: 'yml',
      content: [
        'service: member',
        'replicas: 2',
        'database: postgres://app:app@127.0.0.1:5432/member',
        'healthcheck: /health',
        'resources:',
        '  cpu: 500m',
        '  memory: 512Mi',
      ].join('\n'),
      note: '部署描述',
      createdAt: at,
      updatedAt: at,
    },
  ];
}

// 把单条规则整理成固定结构，级别与状态不认识的一律回到默认值
function normalizeRule(item, fallbackIndex) {
  const source = item && typeof item === 'object' ? item : {};
  const createdAt = typeof source.createdAt === 'string' && source.createdAt ? source.createdAt : new Date().toISOString();
  const level = LEVELS.includes(source.level) ? source.level : LEVELS[0];
  const status = STATUSES.includes(source.status) ? source.status : STATUSES[0];
  const fileType = FILE_TYPES.includes(source.fileType) ? source.fileType : FILE_TYPES[0];
  return {
    id: typeof source.id === 'string' && source.id ? source.id : `rule-restored-${fallbackIndex + 1}`,
    code: typeof source.code === 'string' ? source.code.trim() : '',
    name: typeof source.name === 'string' ? source.name.trim() : '',
    level,
    status,
    fileType,
    pattern: typeof source.pattern === 'string' ? source.pattern : '',
    // 旧数据里没有这三个字段时，口径与以前保持一致：区分大小写、允许片段、不排除目录
    ignoreCase: source.ignoreCase === true,
    wholeWord: source.wholeWord === true,
    excludeDir: normalizeDirSegment(source.excludeDir),
    note: typeof source.note === 'string' ? source.note : '',
    createdAt,
    updatedAt: typeof source.updatedAt === 'string' && source.updatedAt ? source.updatedAt : createdAt,
  };
}

// 把单个文件整理成固定结构，类型不在清单里的一律从路径后缀推断
function normalizeFile(item, fallbackIndex) {
  const source = item && typeof item === 'object' ? item : {};
  const createdAt = typeof source.createdAt === 'string' && source.createdAt ? source.createdAt : new Date().toISOString();
  const filePath = typeof source.path === 'string' ? source.path.trim() : '';
  const ext = filePath.includes('.') ? filePath.split('.').pop().toLowerCase() : '';
  const type = FILE_TYPES.includes(source.type) && source.type !== '全部' ? source.type : (FILE_TYPES.includes(ext) ? ext : 'js');
  const content = typeof source.content === 'string' ? source.content : '';
  return {
    id: typeof source.id === 'string' && source.id ? source.id : `file-restored-${fallbackIndex + 1}`,
    path: filePath,
    type,
    content,
    note: typeof source.note === 'string' ? source.note : '',
    createdAt,
    updatedAt: typeof source.updatedAt === 'string' && source.updatedAt ? source.updatedAt : createdAt,
  };
}

// 整份数据保证规则与文件结构一致，缺编号、缺名称、缺路径的条目一律丢掉
function normalize(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const seed = { rules: seedRules(), files: seedFiles() };

  const rawRules = Array.isArray(source.rules) ? source.rules : seed.rules;
  const seenRuleIds = new Set();
  const seenCodes = new Set();
  const rules = [];
  rawRules.forEach((item, index) => {
    const rule = normalizeRule(item, index);
    if (!rule.id || !rule.code || !rule.name || !rule.pattern) return;
    const lower = rule.code.toLowerCase();
    if (seenRuleIds.has(rule.id) || seenCodes.has(lower)) return;
    seenRuleIds.add(rule.id);
    seenCodes.add(lower);
    rules.push(rule);
  });

  const rawFiles = Array.isArray(source.files) ? source.files : seed.files;
  const seenFileIds = new Set();
  const seenPaths = new Set();
  const files = [];
  rawFiles.forEach((item, index) => {
    const file = normalizeFile(item, index);
    if (!file.id || !file.path) return;
    const lower = file.path.toLowerCase();
    if (seenFileIds.has(file.id) || seenPaths.has(lower)) return;
    seenFileIds.add(file.id);
    seenPaths.add(lower);
    files.push(file);
  });

  return { rules, files };
}

// 读取数据文件：文件缺失或内容损坏时回落到初始数据并立刻补写
function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return normalize(JSON.parse(raw));
  } catch (err) {
    const data = { rules: seedRules(), files: seedFiles() };
    save(data);
    return data;
  }
}

// 先写临时文件再改名，写入中途被打断也不会把正式数据文件写坏
function save(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const text = `${JSON.stringify(normalize(data), null, 2)}\n`;
  fs.writeFileSync(TEMP_FILE, text, 'utf8');
  fs.renameSync(TEMP_FILE, DATA_FILE);
}

module.exports = {
  load,
  save,
  seedRules,
  seedFiles,
  normalize,
  normalizeRule,
  normalizeFile,
  LEVELS,
  STATUSES,
  FILE_TYPES,
  MAX_CODE_LENGTH,
  MAX_RULE_NAME_LENGTH,
  MAX_PATTERN_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_EXCLUDE_DIR_LENGTH,
  MAX_PATH_LENGTH,
  MAX_CONTENT_LENGTH,
  DIR_SEGMENT_PATTERN,
  normalizeDirSegment,
  DATA_FILE,
};
