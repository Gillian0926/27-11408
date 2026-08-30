#!/usr/bin/env node
// build_site.py 的 Node 等价版：扫描 md 内容 -> docs/data.json
// 用法: node build_site_node.js  (在本仓库根目录运行)
'use strict';
const fs = require('fs');
const path = require('path');

const BASE = __dirname;

const SECTIONS = [
  ['英语一/每日一句', 'english', '🇬🇧 英语 · 每日精读'],
  ['英语一/作文技巧', 'essay', '✍️ 英语 · 作文技巧'],
  ['英语一/素材库', 'essay_bank', '📖 英语 · 素材库'],
  ['政治/时事', 'politics', '🗞️ 政治 · 时事'],
  ['数学一/微积分', 'math_calc', '🧮 数学 · 微积分'],
  ['数学一/线性代数', 'math_la', '🧮 数学 · 线性代数'],
  ['数学一/概率论', 'math_prob', '🧮 数学 · 概率论'],
  ['408', 'cs408', '📚 408 · 总览'],
  ['408/操作系统', 'os', '📚 408 · 操作系统'],
  ['408/计算机网络', 'network', '📚 408 · 计算机网络'],
  ['408/数据结构', 'ds', '📚 408 · 数据结构'],
  ['408/计算机组成', 'co', '📚 408 · 计算机组成'],
  ['每日计划', 'plan', '📋 每日计划'],
];

function makeItem(f, key, label, group) {
  const rel = path.relative(BASE, f).split(path.sep).join('/');
  const name = path.basename(f);
  let content = fs.readFileSync(f, 'utf-8');
  // 去掉 BOM
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  const m = content.match(/^#\s+(.+)$/m);
  const title = m ? m[1].trim() : name;
  const dm = name.match(/(\d{4}-\d{2}-\d{2})/);
  const date = dm ? dm[1] : '';
  return {
    key, label, group,
    title, date, path: rel,
    url: 'https://raw.githubusercontent.com/Gillian0926/27-11408/main/' + rel,
    content,
  };
}

function main() {
  const out = [];
  for (const [sub, key, label] of SECTIONS) {
    const subAbs = path.join(BASE, sub);
    if (!fs.existsSync(subAbs)) continue;
    // 根目录的 md（无分组）
    for (const f of fs.readdirSync(subAbs).filter(x => x.endsWith('.md')).sort()) {
      out.push(makeItem(path.join(subAbs, f), key, label, ''));
    }
    // 子目录的 md（group = 子目录名）
    for (const d of fs.readdirSync(subAbs).sort()) {
      const dAbs = path.join(subAbs, d);
      if (!fs.statSync(dAbs).isDirectory()) continue;
      for (const f of fs.readdirSync(dAbs).filter(x => x.endsWith('.md')).sort()) {
        out.push(makeItem(path.join(dAbs, f), key, label, d));
      }
    }
  }
  const docsDir = path.join(BASE, 'docs');
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'data.json'), JSON.stringify(out, null, 1) + '\n', 'utf-8');
  console.log(`${out.length} files -> docs/data.json`);
}

main();
