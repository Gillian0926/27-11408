#!/usr/bin/env python3
"""Scan kaoyan markdown content -> docs/data.json for the site.

Run:  python3 build_site.py   (in /root/kaoyan-11408)
"""
import json
import os
import re
import glob

BASE = os.path.dirname(os.path.abspath(__file__))

# (目录, key, 板块标签)
SECTIONS = [
    ('英语一/每日一句', 'english', '🇬🇧 英语 · 每日精读'),
    ('英语一/作文技巧', 'essay', '✍️ 英语 · 作文技巧'),
    ('英语一/素材库', 'essay_bank', '📖 英语 · 素材库'),
    ('政治/时事', 'politics', '🗞️ 政治 · 时事'),
    ('数学一/微积分', 'math_calc', '🧮 数学 · 微积分'),
    ('数学一/线性代数', 'math_la', '🧮 数学 · 线性代数'),
    ('数学一/概率论', 'math_prob', '🧮 数学 · 概率论'),
    ('408', 'cs408', '📚 408 · 总览'),
    ('408/操作系统', 'os', '📚 408 · 操作系统'),
    ('408/计算机网络', 'network', '📚 408 · 计算机网络'),
    ('408/数据结构', 'ds', '📚 408 · 数据结构'),
    ('408/计算机组成', 'co', '📚 408 · 计算机组成'),
    ('每日计划', 'plan', '📋 每日计划'),
]


def make_item(f, key, label, group):
    rel = os.path.relpath(f, BASE).replace('\\', '/')
    name = os.path.basename(f)
    content = open(f, encoding='utf-8').read()
    m = re.search(r'^#\s+(.+)$', content, re.M)
    title = m.group(1).strip() if m else name
    dm = re.search(r'(\d{4}-\d{2}-\d{2})', name)
    date = dm.group(1) if dm else ''
    return {
        'key': key, 'label': label, 'group': group,
        'title': title, 'date': date, 'path': rel,
        'url': 'https://raw.githubusercontent.com/Gillian0926/27-11408/main/' + rel,
        'content': content,
    }


def main():
    out = []
    for sub, key, label in SECTIONS:
        # 科目根目录的 md（无分组）
        for f in sorted(glob.glob(os.path.join(BASE, sub, '*.md'))):
            out.append(make_item(f, key, label, ''))
        # 子目录的 md（group = 子目录名：知识点/课件要点/课程资料…）
        for d in sorted(glob.glob(os.path.join(BASE, sub, '*'))):
            if not os.path.isdir(d):
                continue
            g = os.path.basename(d)
            for f in sorted(glob.glob(os.path.join(d, '*.md'))):
                out.append(make_item(f, key, label, g))
    os.makedirs(os.path.join(BASE, 'docs'), exist_ok=True)
    with open(os.path.join(BASE, 'docs', 'data.json'), 'w', encoding='utf-8') as fp:
        json.dump(out, fp, ensure_ascii=False, indent=1)
    print(f'{len(out)} files -> docs/data.json')


if __name__ == '__main__':
    main()
