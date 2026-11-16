# -*- coding: utf-8 -*-
"""export_dataset.py —— 导出 OpticForge 知识库为 ModelScope Dataset 所需的结构化 67 行。

重要：需用户本人先在 ModelScope 网页创建数据集
------------------------------------------------
  GrestestOptics/optics-kb （https://www.modelscope.cn/datasets/GrestestOptics/optics-kb）
  经实测该 Dataset 当前并不存在（REST 返回 404「不存在的数据集」，与
  PLUGIN_PLAN.md:256 一致）。上传前必须**由用户本人**在网页创建该数据集，
  否则上传会撞 404；AI 无法代登、无法代建、不接触任何凭据。
  云端上传脚本见 scripts/upload_dataset.py；本脚本只负责导出，不联网。

用途
----
默认读取插件内置副本 opticforge/data/kb-data.json（与源 kb-data-full.json
逐字段一致）；也可用 -i 显式指定外部全量源
（如 D:/AI/OpticsGPT/opticsgpt-space/kb-data-full.json）。按 ModelScope
Dataset GrestestOptics/optics-kb 的 **9 列**结构导出为：
  - JSONL（每行一个 JSON 对象，UTF-8，ensure_ascii=False）
  - CSV（UTF-8-SIG，表头 9 列，含 BOM 便于 Excel 打开）

列（顺序固定，9 列）：
  doc_id, chunk_id, status, text, source, page_or_section, keywords_zh,
  is_original_excerpt, disclaimer

口径说明（与方案 §2.4 的差异，如实记录，不偷偷偏离）
--------------------------------------------------
  PLUGIN_PLAN.md §2.4 原写 8 列（不含 disclaimer）；但 lib/kb-data.js:14-17
  的 REQUIRED_FIELDS 含 disclaimer，:38-49 的 isValidKB() 对云端拉回数据
  逐块检查全部 9 字段。若云端 Dataset 只存 8 列，syncFromCloud() 会因校验
  失败而静默回退内置数据，云端同步闭环断裂。故本实现导出 **9 列（增加
  disclaimer 作为第 9 列）**，不改 lib/kb-data.js、不改 package.json，
  与运行时 9 字段校验一致。该差异已同步写入 docs/USAGE.zh.md 的 Dataset 段落。
  JSONL 每行因此可直接作为 lib/kb-data.js parseCloudPayload() 的输入。

纯 Python 标准库（json / csv / argparse / pathlib / sys），无第三方依赖。
不修改任何源文件；只写输出目录（命令行 -o 指定，或默认脚本上级的 data/ 目录）。

命令示例
--------
  # 默认：读插件内置 data/kb-data.json，写到 opticforge/data/opticforge-dataset.{jsonl,csv}
  python scripts/export_dataset.py

  # 指定外部全量源与输出目录
  python scripts/export_dataset.py -i D:/data/kb-data-full.json -o D:/out/dataset

  # 只校验数据、不写文件（配合 upload_dataset.py --dry-run 使用）
  python scripts/export_dataset.py --check

校验
----
  - 必须是 JSON 数组且恰好 67 块；
  - 每块含全部 9 个字段（导出即这 9 列，不丢字段）；
  - status 取值仅 present / missing_source / substitute，且分布 51 / 11 / 5；
  - is_original_excerpt 为 bool；disclaimer 为字符串；
  - doc_id 分布 A01=13 A02=9 A03=1 B01=11 B02=4 C01=5 C02=7 D01=11 E01=6。
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

# 默认读插件内置副本；外部全量源保留为可选 -i。
# 用 Path 相对 __file__ 解析，插件复制到别处也能直接运行，不硬编码绝对路径。
DEFAULT_INPUT = str(Path(__file__).resolve().parent.parent / "data" / "kb-data.json")
# 9 列：与 lib/kb-data.js 的 REQUIRED_FIELDS / isValidKB() 逐字段一致，
# 保证云端拉回的数据能通过运行时校验，不会静默回退内置数据。
DATASET_COLUMNS = [
    "doc_id",
    "chunk_id",
    "status",
    "text",
    "source",
    "page_or_section",
    "keywords_zh",
    "is_original_excerpt",
    "disclaimer",
]
SOURCE_FIELDS = list(DATASET_COLUMNS)
EXPECTED_TOTAL = 67
EXPECTED_STATUS = {"present": 51, "missing_source": 11, "substitute": 5}
EXPECTED_DOCS = {
    "A01": 13, "A02": 9, "A03": 1, "B01": 11, "B02": 4,
    "C01": 5, "C02": 7, "D01": 11, "E01": 6,
}

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


def load_rows(input_path: str) -> list[dict]:
    """读取源 JSON，校验结构，返回按 9 列裁剪后的 67 行（保持源文件顺序）。"""
    src = Path(input_path)
    if not src.exists():
        raise SystemExit(f"[错误] 源数据文件不存在: {src}")
    try:
        raw = json.loads(src.read_text(encoding="utf-8"))
    except Exception as exc:
        raise SystemExit(f"[错误] 源 JSON 解析失败: {src} -> {exc}")
    if not isinstance(raw, list):
        raise SystemExit(f"[错误] 源数据应为 JSON 数组，实际为 {type(raw).__name__}: {src}")
    if len(raw) != EXPECTED_TOTAL:
        raise SystemExit(f"[错误] 源数据应为 {EXPECTED_TOTAL} 块，实际 {len(raw)} 块: {src}")

    validate(raw, src)
    rows = []
    for rec in raw:
        row = {col: rec.get(col, "") for col in DATASET_COLUMNS}
        # bool 显式转成 Python bool（JSON 里可能是 1/0）
        row["is_original_excerpt"] = bool(row["is_original_excerpt"])
        rows.append(row)
    return rows


def validate(raw: list, src: Path) -> None:
    """校验 67 块的字段、状态分布与 doc_id 分布；任何不一致直接退出。"""
    problems: list[str] = []
    status_count: dict[str, int] = {}
    doc_count: dict[str, int] = {}
    for i, rec in enumerate(raw):
        tag = rec.get("chunk_id", f"#{i}")
        if not isinstance(rec, dict):
            problems.append(f"{tag}: 不是对象")
            continue
        for f in SOURCE_FIELDS:
            if f not in rec:
                problems.append(f"{tag}: 缺少字段 {f}")
        for f in ("doc_id", "chunk_id", "status", "text", "source", "page_or_section", "keywords_zh", "disclaimer"):
            if f in rec and not isinstance(rec[f], str):
                problems.append(f"{tag}: 字段 {f} 应为字符串")
        st = rec.get("status")
        if st not in EXPECTED_STATUS:
            problems.append(f"{tag}: 未知 status={st!r}")
        status_count[st] = status_count.get(st, 0) + 1
        doc_count[rec.get("doc_id")] = doc_count.get(rec.get("doc_id"), 0) + 1
    if status_count != EXPECTED_STATUS:
        problems.append(f"status 分布不符: 期望 {EXPECTED_STATUS}, 实际 {status_count}")
    if doc_count != EXPECTED_DOCS:
        problems.append(f"doc_id 分布不符: 期望 {EXPECTED_DOCS}, 实际 {doc_count}")
    if problems:
        detail = "\n  - ".join(problems[:20])
        raise SystemExit(f"[错误] 源数据校验未通过（{src}），共 {len(problems)} 处问题:\n  - {detail}")


def write_jsonl(rows: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def write_csv(rows: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # utf-8-sig 带 BOM，Excel 直接打开不乱码；ModelScope 读取时也兼容
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=DATASET_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="导出 OpticForge KB 67 块为 ModelScope Dataset 的 9 列 JSONL + CSV",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("-i", "--input", default=DEFAULT_INPUT,
                        help=f"源 kb-data-full.json 路径（默认插件内置 data/kb-data.json，即 {DEFAULT_INPUT}；可用 -i 指向外部全量源）")
    parser.add_argument("-o", "--output-dir", default=None,
                        help="输出目录；默认脚本上级的 data/ 目录。也可用 --jsonl/--csv 指定具体文件名。")
    parser.add_argument("--jsonl", default=None, help="显式指定 JSONL 输出文件路径")
    parser.add_argument("--csv", default=None, help="显式指定 CSV 输出文件路径")
    parser.add_argument("--stem", default="opticforge-dataset", help="输出文件名前缀（默认 opticforge-dataset）")
    parser.add_argument("--check", action="store_true", help="只校验源数据，不写任何文件")
    args = parser.parse_args(argv)

    rows = load_rows(args.input)
    print(f"[OK] 源数据校验通过: {args.input}")
    print(f"     共 {len(rows)} 行 / {len(DATASET_COLUMNS)} 列; status 分布 {EXPECTED_STATUS}")
    if args.check:
        print("[OK] --check 模式：仅校验，未写出文件")
        return 0

    here = Path(__file__).resolve().parent
    out_dir = Path(args.output_dir) if args.output_dir else (here.parent / "data")
    jsonl_path = Path(args.jsonl) if args.jsonl else (out_dir / f"{args.stem}.jsonl")
    csv_path = Path(args.csv) if args.csv else (out_dir / f"{args.stem}.csv")

    write_jsonl(rows, jsonl_path)
    write_csv(rows, csv_path)
    print(f"[OK] 已写出 JSONL: {jsonl_path}  ({len(rows)} 行, UTF-8)")
    print(f"[OK] 已写出 CSV  : {csv_path}  ({len(rows)} 行, UTF-8-SIG)")
    print("[提示] 下一步用 scripts/upload_dataset.py --dry-run 校验，再由用户本人登录 ModelScope 后上传")
    return 0


if __name__ == "__main__":
    sys.exit(main())
