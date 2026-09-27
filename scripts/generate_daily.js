'use strict';
/**
 * 考研站每日内容生成（云端版，跑在 GitHub Actions）
 * 依赖：Node 18+（内置 fetch）。环境变量：
 *   DEEPSEEK_API_KEY  必填
 *   DEEPSEEK_MODEL    可选，默认 deepseek-v4-flash
 *   DATE_OVERRIDE     可选，YYYY-MM-DD，用于补跑历史日期
 *   FORCE=1           可选，已存在也重新生成
 * 流程：抓新闻 -> 分科目调用模型 -> 写文件 -> (workflow 负责 build/commit/push)
 */
const fs = require('fs');
const path = require('path');

const BASE = path.resolve(__dirname, '..');
const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const API_BASE = process.env.DEEPSEEK_BASE || 'https://api.deepseek.com';
const FORCE = process.env.FORCE === '1';

// ---------- 日期 ----------
const BJ = 8 * 3600 * 1000;
function bjToday() { return new Date(Date.now() + BJ).toISOString().slice(0, 10); }
const TODAY = process.env.DATE_OVERRIDE || bjToday();
const D = new Date(TODAY + 'T00:00:00Z');
const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][(D.getUTCDay() + 7) % 7];
const IS_SAT = WEEKDAY === '周六';
const EXAM = new Date('2026-12-19T00:00:00Z');
const DAYS_LEFT = Math.round((EXAM - D) / 86400000);

// ---------- 文件工具 ----------
function read(rel) { try { return fs.readFileSync(path.join(BASE, rel), 'utf8').replace(/^\uFEFF/, ''); } catch { return ''; } }
function listCards(rel) {
  try {
    return fs.readdirSync(path.join(BASE, rel)).filter(f => f.endsWith('.md')).sort()
      .map(f => { const c = read(path.join(rel, f)); const m = c.match(/^#\s+(.+)$/m); return { name: f, title: m ? m[1].trim() : f }; });
  } catch { return []; }
}
function latestCards(rel, n) {
  const all = listCards(rel);
  return all.slice(-n).map(x => `<<${x.name}>>\n${read(path.join(rel, x.name))}`).join('\n\n');
}
function inventory(rel) { return listCards(rel).map(x => `- ${x.name}  ${x.title}`).join('\n') || '（暂无）'; }

// ---------- 抓新闻 ----------
function stripHtml(html) {
  let t = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  return t.replace(/\s+/g, ' ').trim();
}
async function fetchNews() {
  const urls = ['http://www.news.cn/politics/', 'https://www.news.cn/politics/'];
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PawServiceBot/1.0)' } });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      let text;
      const head = buf.slice(0, 2000).toString('latin1');
      const m = head.match(/charset=["']?([\w-]+)/i);
      const cs = (m && m[1] || 'utf-8').toLowerCase();
      try { text = new TextDecoder(cs).decode(buf); } catch { text = buf.toString('utf8'); }
      const plain = stripHtml(text);
      if (plain.length > 500) return plain.slice(0, 9000);
    } catch (e) { /* try next */ }
  }
  return '';
}

// ---------- 调模型 ----------
async function chat(system, user, maxTokens = 64000) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(API_BASE + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + API_KEY },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          max_tokens: maxTokens, temperature: 0.7, stream: false,
        }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 300));
      const j = await r.json();
      const msg = j.choices && j.choices[0] && j.choices[0].message;
      const content = (msg && (msg.content || '')) || (msg && msg.reasoning_content) || '';
      if (!content.trim()) throw new Error('empty content');
      return content;
    } catch (e) { lastErr = e; await new Promise(res => setTimeout(res, 2000 * attempt)); }
  }
  throw new Error('chat failed: ' + lastErr.message);
}

// 解析 @@TOPIC / @@FILE / @@END 分隔格式（比 JSON 稳，不受转义/换行影响）
function parseDelimited(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const files = [];
  let topic = '';
  let cur = null;
  let buf = [];
  const flush = () => { if (cur) files.push({ path: cur, content: buf.join('\n').trim() + '\n' }); cur = null; buf = []; };
  for (const line of lines) {
    if (/^```/.test(line.trim())) continue;
    const mt = line.match(/^@@TOPIC:\s*(.+?)\s*$/);
    if (mt) { topic = mt[1]; continue; }
    const mf = line.match(/^@@FILE:\s*(.+?)\s*$/);
    if (mf) { flush(); cur = mf[1].trim(); continue; }
    if (/^@@END\b/.test(line.trim())) { flush(); continue; }
    if (cur !== null) buf.push(line);
  }
  flush();
  // 合成单个“假”条目方便复用
  return { topic, files };
}

// 允许写入的目录前缀
const ALLOWED = ['机械工程/', '英语二/', '政治/', '每日计划/'];
function safeWrite(rel, content) {
  let norm = String(rel).replace(/\\/g, '/').replace(/^\.\//, '').trim();
  // 归一化模型可能少写的前缀
  norm = norm.replace(/^数学二\//, '机械工程/数学二/')
             .replace(/^数学(?!二)\//, '机械工程/数学二/')
             .replace(/^高数\//, '机械工程/数学二/高等数学/')
             .replace(/^高等数学\//, '机械工程/数学二/高等数学/')
             .replace(/^线性代数\//, '机械工程/数学二/线性代数/')
             .replace(/^机械原理\//, '机械工程/机械原理/');
  if (!ALLOWED.some(p => norm.startsWith(p))) throw new Error('path not allowed: ' + norm);
  if (norm.includes('..')) throw new Error('bad path: ' + norm);
  const abs = path.join(BASE, norm);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content.replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n') + (content.endsWith('\n') ? '' : '\n'), 'utf8');
  return norm;
}

const SYS = '你是 PawService（🦉），一位帮中国考研学生整理学习资料的 AI 助手。你产出的内容用简体中文、Markdown、LaTeX 数学公式（$...$ / $$...$$）。内容必须专业、准确、可直接学习使用。你只输出被要求的格式，不要寒暄。';
const OUT = '\n\n【输出格式】严格按下面的分隔格式输出（**不要** JSON、**不要**代码块、不要多余说明）：\n@@TOPIC: <一句话主题>\n@@FILE: <相对路径>\n<该文件完整 Markdown 内容>\n@@FILE: <下一个相对路径>\n<内容>\n@@END';

const CTX_EXAM = `【报考信息】北京信息科技大学 · 机电学院 · 机械工程（085501，专业学位）。初试四科：政治(101) + 英语二(204) + 数学二(302) + 机械原理(801)。初试 2026-12-19，今天距初试约 ${DAYS_LEFT} 天。
【数二范围】高等数学 + 线性代数；不考概率论，高数不考无穷级数、三重积分、曲线曲面积分、空间解析几何。
【801 考场】不带计算器；作图题需圆规、量角器、直尺、铅笔。`;

// ---------- 各科目生成 ----------
async function genMech() {
  const dir = '机械工程/机械原理';
  const user = `${CTX_EXAM}

【任务】为今天（${TODAY}，${WEEKDAY}）生成机械原理(801)的两张卡片：
1) ${dir}/${TODAY}.md —— 第 N 讲：知识讲解 + 典型例题 + 易错点（格式参考已有卡片，标题写成"# ⚙️ 机械原理 · 第 N 讲：xxx"）
2) ${dir}/${TODAY}-2.md —— 配套"公式与速查卡"
N = 已有讲数 + 1（见下方已有卡片），按 801 考纲九章顺序与学习计划日期推进，别跳章。

【801 考纲】\n${read('机械工程/机械原理/801 考纲.md')}

【学习计划（机械部分）】\n${read('机械工程/学习计划.md').slice(0, 3000)}

【已有卡片】\n${inventory(dir)}

【最近一讲内容（用于承接）】\n${latestCards(dir, 2).slice(0, 6000)}

要求：内容详实（每张 600-1200 字中文），公式用 LaTeX；例题带解答；易错点 3-5 条；第二张全为"必背"公式/结论/口诀。${OUT}`;
  const txt = await chat(SYS, user, 64000);
  return parseDelimited(txt);
}

async function genMath() {
  const hi = '机械工程/数学二/高等数学', la = '机械工程/数学二/线性代数';
  const user = `${CTX_EXAM}

【任务】为今天（${TODAY}，${WEEKDAY}）生成数学二的两张卡片。
优先推进"高等数学"（按学习计划现在在高等数学阶段；等高等数学走完再转线性代数）。
1) 机械工程/数学二/高等数学/${TODAY}.md（若本轮转线性代数则用 机械工程/数学二/线性代数/${TODAY}.md）—— 第 N 站：知识讲解 + 典型例题 + 易错点，标题"# 🧮 数学二 · 第 N 讲：xxx"
2) 同目录/${TODAY}-2.md —— 公式速查卡
N = 该科目已有卡片对数 + 1。

【学习计划（数学部分）】\n${read('机械工程/学习计划.md').slice(0, 3500)}

【高等数学 已有卡片】\n${inventory(hi)}
【线性代数 已有卡片】\n${inventory(la) || '（暂无）'}

【高等数学 最近内容（用于承接）】\n${latestCards(hi, 2).slice(0, 6000)}

要求：内容详实，公式用 LaTeX；例题带解答；易错点 3-5 条；第二张为必背公式速查。不要超纲（不考概率论/无穷级数/三重积分/曲线曲面积分/空间解析几何）。@@FILE 的 path 用你选定的目录。${OUT}`;
  const txt = await chat(SYS, user, 64000);
  return parseDelimited(txt);
}

async function genEnglish() {
  const dir = '英语二/每日一句';
  const bank = read('英语二/素材库/01-作文素材句库.md');
  const themes = (bank.match(/^#{2,3}\s+.*$/gm) || []).slice(0, 40).join('\n');
  const user = `【任务】为今天（${TODAY}，${WEEKDAY}）生成英语二"每日一句"精读卡片：${dir}/${TODAY}.md（标题"# 📖 英语每日精读 · ${TODAY}"）。
15 大主题按顺序轮换（看已有卡片到哪一站，接下一站；首轮走完后进入第 2 轮）。句子从素材库挑，选 1 个主句 + 2 个补充句，做结构拆解、词汇点、仿写迁移、记忆任务，并给出主题编号（如 #12/15）。

【素材库主题目录】\n${themes || '（见素材库）'}

【素材库正文节选】\n${bank.slice(0, 6000)}

【已有卡片】\n${inventory(dir)}

【最近卡片（用于承接轮次与主题编号）】\n${latestCards(dir, 2).slice(0, 5000)}

要求：英文句子准确地道；讲解中文；标注"第几轮第几站 / 素材库 #编号"。${OUT}`;
  const txt = await chat(SYS, user, 64000);
  return parseDelimited(txt);
}

async function genPolitics(newsText) {
  const dir = '政治/时事';
  const user = `【任务】为今天（${TODAY}，${WEEKDAY}）生成考研政治"时事速览"：${dir}/${TODAY}.md。
从下面的新华网时政文本里挑 3-5 条当日/近日新闻，每条写：要点 + 🎯 考点链接（毛中特/思修/时政，按考研政治板块）。文件开头写"今日主线"，结尾写"今日记忆任务"。

【新华网时政正文】\n${newsText || '（今日抓取失败：请改选近期重大时政——如"十五五"规划、抗战胜利80周年、中央经济工作会议等，并在文件开头注明"新闻来源待核对"）'}

【已有文件】\n${inventory(dir)}
【最近一期（用于避免重复）】\n${latestCards(dir, 1).slice(0, 4000)}

要求：5 条左右；每条 150-300 字；考点链接 3-4 条；不要与最近一期重复。${OUT}`;
  const txt = await chat(SYS, user, 64000);
  return parseDelimited(txt);
}

async function genPlan(topics) {
  const dir = '每日计划';
  const user = `【任务】为今天（${TODAY}，${WEEKDAY}）生成"每日计划"：${dir}/${TODAY}.md，标题"# 📋 每日计划 · ${TODAY}（第 X 天）"。
X = 已有计划数 + 1（首日 2026-08-16 为第 1 天，见已有文件）。

【今日各科主题】
- 机械原理：${topics.mech || '（见站点）'}
- 数学二：${topics.math || '（见站点）'}
- 英语二：${topics.en || '（见站点）'}
- 政治：${topics.pol || '（见站点）'}

【距初试】约 ${DAYS_LEFT} 天（初试 2026-12-19 ${IS_SAT ? '；今天是周六，下午起休息，不安排学习内容' : ''}）。

【学习计划】\n${read('机械工程/学习计划.md').slice(0, 2500)}
【已有计划】\n${inventory(dir)}
【最近一期（用于承接格式）】\n${latestCards(dir, 1).slice(0, 3500)}

格式：参考最近一期——"今日更新"清单、"今日学习清单（按顺序，含时长与重点）"、结尾给思岐一段鼓励/叮嘱（爪爪口吻，别太长）。${IS_SAT ? '今天周六：注明"下午休息"，上午正常。' : ''}${OUT}`;
  const txt = await chat(SYS, user, 64000);
  return parseDelimited(txt);
}

// ---------- 主流程 ----------
async function main() {
  if (!API_KEY) { console.error('缺少 DEEPSEEK_API_KEY'); process.exit(1); }
  if (fs.existsSync(path.join(BASE, '每日计划', TODAY + '.md')) && !FORCE) {
    console.log(`${TODAY} 的每日计划已存在，跳过（FORCE=1 可强制重跑）`);
    return;
  }
  console.log(`生成 ${TODAY}（${WEEKDAY}）内容，模型 ${MODEL}`);

  const news = await fetchNews();
  console.log('新闻抓取:', news ? news.length + ' 字符' : '失败');

  const results = [];
  const topics = {};

  const mech = await genMech();
  topics.mech = mech.topic; results.push(['机械原理', mech]);

  const math = await genMath();
  topics.math = math.topic; results.push(['数学二', math]);

  const en = await genEnglish();
  topics.en = en.topic; results.push(['英语二', en]);

  const pol = await genPolitics(news);
  topics.pol = pol.topic; results.push(['政治', pol]);

  const plan = await genPlan(topics);
  results.push(['每日计划', plan]);

  let written = 0;
  const missing = [];
  for (const [name, r] of results) {
    if (!r || !Array.isArray(r.files) || !r.files.length) { console.error(`[${name}] 无 files`); missing.push(name); continue; }
    for (const f of r.files) {
      try { const p = safeWrite(f.path, String(f.content || '')); console.log(`  写入 ${p}`); written++; }
      catch (e) { console.error(`  [skip] ${name}: ${e.message}  path=${f.path}`); }
    }
  }
  // 关键文件校验
  const need = [
    '机械工程/机械原理/' + TODAY + '.md',
    '机械工程/数学二/高等数学/' + TODAY + '.md',
    '英语二/每日一句/' + TODAY + '.md',
    '政治/时事/' + TODAY + '.md',
    '每日计划/' + TODAY + '.md',
  ].filter(p => !fs.existsSync(path.join(BASE, p)));
  if (!written) { console.error('没有写入任何文件'); process.exit(1); }
  if (need.length) { console.error('缺失关键文件:', need.join(', ')); process.exit(1); }
  console.log(`完成：${written} 个文件。主题：`, JSON.stringify(topics, null, 0));
}

main().catch(e => { console.error('生成失败:', e.stack || e.message); process.exit(1); });
