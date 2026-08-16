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
    ('政治/时事', 'politics', '🗞️ 政治 · 时事'),
    ('数学一/卡片', 'math', '🧮 数学 · 知识点卡片'),
    ('数学一/技巧', 'math_tips', '🧮 数学 · 做题技巧'),
    ('408', 'cs408', '📚 408'),
    ('每日计划', 'plan', '📋 每日计划'),
]


def main():
    out = []
    for sub, key, label in SECTIONS:
        pattern = os.path.join(BASE, sub, '**', '*.md')
        for f in sorted(glob.glob(pattern, recursive=True)):
            rel = os.path.relpath(f, BASE).replace('\\', '/')
            name = os.path.basename(f)
            content = open(f, encoding='utf-8').read()
            m = re.search(r'^#\s+(.+)$', content, re.M)
            title = m.group(1).strip() if m else name
            dm = re.search(r'(\d{4}-\d{2}-\d{2})', name)
            date = dm.group(1) if dm else ''
            out.append({
                'key': key, 'label': label, 'title': title, 'date': date,
                'path': rel,
                'url': 'https://raw.githubusercontent.com/Gillian0926/27-11408/main/' + rel,
                'content': content,
            })
    os.makedirs(os.path.join(BASE, 'docs'), exist_ok=True)
    with open(os.path.join(BASE, 'docs', 'data.json'), 'w', encoding='utf-8') as fp:
        json.dump(out, fp, ensure_ascii=False, indent=1)
    print(f'{len(out)} files -> docs/data.json')


if __name__ == '__main__':
    main()
