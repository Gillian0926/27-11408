'use strict';
/**
 * 生成《逐日总规划》：从 START 到 END 每天学什么（机械原理/数学二/英语二/政治/每日计划）。
 * 用法: DEEPSEEK_API_KEY=xxx node scripts/make_outline.js
 * 环境变量 START/END 可选（默认 2026-09-28 ~ 2026-12-18）。
 */
const fs = require('fs');
const path = require('path');
const BASE = path.resolve(__dirname, '..');
const API_KEY = process.env['DEEPSEEK_' + 'API_KEY'] || '';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const START = process.env.START || '2026-09-28';
const END = process.env.END || '2026-12-18';

function read(rel) { try { return fs.readFileSync(path.join(BASE, rel), 'utf8').replace(/^\uFEFF/, ''); } catch { return ''; } }

async function chat(user, maxTokens = 64000) {
  let lastErr;
  for (let i = 1; i <= 4; i++) {
    try {
      const r = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + API_KEY },
        body: JSON.stringify({ model: MODEL, messages: [
          { role: 'system', content: '你是 PawService（🦉），帮中国考研学生做复习规划。输出简体中文 Markdown，务实、可执行、不啰嗦。' },
          { role: 'user', content: user },
        ], max_tokens: maxTokens, temperature: 0.5, stream: false }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
      const j = await r.json();
      const c = j.choices[0].message.content || j.choices[0].message.reasoning_content || '';
      if (!c.trim()) throw new Error('empty');
      return c;
    } catch (e) { lastErr = e; await new Promise(s => setTimeout(s, 2000 * i)); }
  }
  throw new Error('chat failed: ' + lastErr.message);
}

(async () => {
  if (!API_KEY) { console.error('缺 DEEPSEEK_API_KEY'); process.exit(1); }
  const user = `根据下面的《复习总计划》和《801 考纲》，生成一份**逐日总规划**，覆盖 ${START} 到 ${END}（考试 2026-12-19）。

【报考】北京信息科技大学·机械工程(085501)；初试：政治(101)+英语二(204)+数学二(302)+机械原理(801)。
【每日时间表（已在网站首页）】机械原理 4:30 / 数学二 3:00 / 英语 1:30 / 政治 0:40；周六下午起休息。

【复习总计划】\n${read('机械工程/学习计划.md')}

【801 考纲】\n${read('机械工程/机械原理/801 考纲.md')}

【要求】
1. 输出一份 Markdown 文档，标题 "# 📅 逐日总规划 · ${START} → ${END}"。
2. 主体是一张**逐日表格**，每行一天：日期｜星期｜机械原理｜数学二｜英语二｜政治。单元格写"当天具体学什么/第几讲/第几轮"（简明，10-25 字）。周末（周六下午起）标注休息。
3. 表格前用 3-6 条写清**阶段划分**（基础/强化/冲刺/考前）与各阶段目标。
4. 表格后写"每周节奏建议"（比如周日复盘、周六下午休、错题本怎么用）。
5. 严格按总计划的章节时间与 801 九章顺序推进，不超纲（数二不考概率论/无穷级数/三重积分/曲线曲面积分/空间解析几何）。
6. 只输出这份 Markdown 文档本身，不要多余说明。`;
  const md = await chat(user);
  const outRel = '每日计划/00-逐日总规划.md';
  fs.mkdirSync(path.dirname(path.join(BASE, outRel)), { recursive: true });
  fs.writeFileSync(path.join(BASE, outRel), md.trim() + '\n', 'utf8');
  console.log('写入', outRel, '长度', md.length);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
