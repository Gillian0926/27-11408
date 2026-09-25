#!/usr/bin/env node
// build_site.py 的 Node 等价版：扫描 md 内容 -> docs/data.json
// 用法: node build_site_node.js  (在本仓库根目录运行)
'use strict';
const fs = require('fs');
const path = require('path');

const BASE = __dirname;

// [目录, key, 显示名] —— 顺序即站点内的显示顺序
const SECTIONS = [
  // ===== 机械工程（当前主线）=====
  ['机械工程', 'mech_home', '⚙️ 机械工程 · 总览'],
  ['机械工程/机械原理', 'mech_principle', '⚙️ 机械原理（801）'],
  ['机械工程/机械原理/真题', 'mech_principle_past', '⚙️ 机械原理 · 真题'],
  ['机械工程/数学二/高等数学', 'mech_math2_calc', '🧮 数学二 · 高等数学'],
  ['机械工程/数学二/线性代数', 'mech_math2_la', '🧮 数学二 · 线性代数'],
  // ===== 计算机（原 11408，归档）=====
  ['计算机', 'comp_home', '💻 计算机 · 总览（归档）'],
  ['计算机/数学一/微积分', 'comp_math_calc', '🧮 数学一 · 微积分（归档）'],
  ['计算机/数学一/线性代数', 'comp_math_la', '🧮 数学一 · 线性代数（归档）'],
  ['计算机/数学一/概率论', 'comp_math_prob', '🧮 数学一 · 概率论（归档）'],
  ['计算机/408', 'cs408', '💻 408 · 总览（归档）'],
  ['计算机/408/操作系统', 'os', '💻 408 · 操作系统（归档）'],
  ['计算机/408/计算机网络', 'network', '💻 408 · 计算机网络（归档）'],
  ['计算机/408/数据结构', 'ds', '💻 408 · 数据结构（归档）'],
  ['计算机/408/计算机组成', 'co', '💻 408 · 计算机组成（归档）'],
  // ===== 公共课 =====
  ['英语二/每日一句', 'english', '🇬🇧 英语二 · 每日精读'],
  ['英语二/作文技巧', 'essay', '✍️ 英语二 · 作文技巧'],
  ['英语二/素材库', 'essay_bank', '📖 英语二 · 素材库'],
  ['政治/时事', 'politics', '🗞️ 政治 · 时事'],
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
  // 已知 section 目录集合：扫描某个 section 的子目录时跳过它们，避免重复收录
  const sectionDirs = new Set(SECTIONS.map(s => s[0]));
  for (const [sub, key, label] of SECTIONS) {
    const subAbs = path.join(BASE, sub);
    if (!fs.existsSync(subAbs)) continue;
    // 根目录的 md（无分组）
    for (const f of fs.readdirSync(subAbs).filter(x => x.endsWith('.md')).sort()) {
      out.push(makeItem(path.join(subAbs, f), key, label, ''));
    }
    // 子目录的 md（group = 子目录名）；子目录若本身是 section，则跳过
    for (const d of fs.readdirSync(subAbs).sort()) {
      const dAbs = path.join(subAbs, d);
      if (!fs.statSync(dAbs).isDirectory()) continue;
      if (sectionDirs.has(sub + '/' + d)) continue;
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
