# -*- coding: utf-8 -*-
"""upload_dataset.py —— 把 OpticForge 知识库上传到 ModelScope Dataset。

重要：需用户本人先在 ModelScope 网页创建 GrestestOptics/optics-kb
------------------------------------------------------------------
  目标 Dataset：GrestestOptics/optics-kb
  https://www.modelscope.cn/datasets/GrestestOptics/optics-kb
  经实测该 Dataset 当前并不存在（REST 返回 404「不存在的数据集」，与
  PLUGIN_PLAN.md:256 一致）。上传前必须**由用户本人**在网页创建该数据集
  并确认账号有写权限，否则上传必然撞 404；AI 无法代登、无法代建、
  不接触任何凭据。若改用其它数据集，可用 --dataset-id 覆盖。

重要：需用户本人先 modelscope login / 网页登录；AI 无法代登
--------------------------------------------------------------
ModelScope 的上传使用**用户本人账号的登录态/token**。本脚本不会、也不能代替
用户登录：不含任何账号密码、不读取浏览器隐私数据、不模拟登录、不打印 token 值。
请先由用户本人完成以下任一方式登录，再运行本脚本：
  1) 命令行：modelscope login --token <本人 Access Token>
  2) 网页：https://www.modelscope.cn 登录，SDK 会读取本地缓存的登录态
  3) 高级：由用户本人在自己的脚本里用 HubApi(token=<本人 token>) 或
     api.login(<本人 token>) 显式传入；本脚本不读取任何 token 环境变量，
     也不会代用户传递凭据。

本脚本默认 **不执行上传**（--dry-run 是默认行为，零网络请求、不需登录/SDK）。
必须**显式加上 --upload**（且不带 --dry-run）才会真正推送；仅去掉 --dry-run
或只给 --commit 都不会上传。AI 交付时只运行 --dry-run 做数据校验，不实际执行上传。

命令示例
--------
  # 0) 先导出 67 行（纯标准库，无需登录）
  python scripts/export_dataset.py -o data/
  #    产出 data/opticforge-dataset.jsonl（9 列，含 disclaimer）与 .csv

  # 1) 只校验数据、不上传、不需要登录（AI 可安全执行）
  python scripts/upload_dataset.py --dry-run
  python scripts/upload_dataset.py --dry-run --dataset-file data/opticforge-dataset.jsonl

  # 2) 用户本人登录（必须本人操作）
  modelscope login --token <本人 Access Token>

  # 3) 用户本人执行上传（注意必须带 --upload）
  python scripts/upload_dataset.py --upload \
    --dataset-file data/opticforge-dataset.jsonl \
    --commit "init: 67 optical KB chunks"

上传所用官方 API（不编造 API）
------------------------------
  官方 Python SDK（见 https://www.modelscope.cn/docs/datasets/upload）：
    from modelscope.hub.api import HubApi
    HubApi().upload_file(
        path_or_fileobj=<本地文件绝对路径>, path_in_repo=<仓库内文件名>,
        repo_id=<owner/name>, repo_type="dataset", commit_message=<说明>)
  或 HubApi().upload_folder(repo_id=..., folder_path=..., repo_type="dataset")。
  **HubApi 没有 push_dataset 方法**（PLUGIN_PLAN.md:87 给出的
  from modelscope.hub.dataset import Dataset; api.push_dataset 是错的，
  会让 hasattr 守卫必然失败）：本脚本只调用上面已核对过的官方接口。
  若 SDK 版本过旧、连 upload_file 都没有，则回退到官方 CLI：
    modelscope upload <owner/repo> <本地文件> <仓库内路径> --repo-type dataset

  仓库内文件名默认 kb-data.json：与 lib/kb-data.js 的 CANDIDATE_URLS
  （.../repo?Revision=master&FilePath=kb-data.json 等）一致，使云端同步
  闭环真正可用。JSONL 内容由 parseCloudPayload() 按行解析后交给
  isValidKB() 校验 9 字段，因此导出必须是 9 列（含 disclaimer）。

依赖
----
  - 仅上传阶段需要 modelscope Python SDK：pip install modelscope
  - 校验阶段（默认 / --dry-run）只用 Python 标准库，不 import modelscope，
    不需要登录、不连接网络。
  - 不依赖 torch；不链接任何之前的 AI / 创空间 / 模型 API。

错误处理
--------
  - 数据文件缺失 / 行数不对 / 列不对 / status 非法 → 明确报错并退出码 2；
  - 未安装 SDK / 未登录 / token 失效 / 网络失败 / Dataset 不存在或无写权限
    → 捕获异常、打印中文提示与排查清单，退出码 3，不吞异常、不伪造成功；
  - 任何情况下都不会删除或改写本地数据文件；上传用临时文件由 tempfile
    生成唯一文件名，收尾一定清理，绝不会覆盖用户同名文件。
"""

from __future__ import annotations

import argparse
import inspect
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

DATASET_ID = "GrestestOptics/optics-kb"
DEFAULT_DATASET_FILE = "data/opticforge-dataset.jsonl"
DEFAULT_PATH_IN_REPO = "kb-data.json"
# 基础 8 列（PLUGIN_PLAN.md §2.4）+ 第 9 列 disclaimer（运行时 9 字段校验所需）。
# 校验同时接受 8 列（旧版导出）与 9 列（当前 export_dataset.py 导出）。
BASE_COLUMNS = [
    "doc_id", "chunk_id", "status", "text", "source",
    "page_or_section", "keywords_zh", "is_original_excerpt",
]
FULL_COLUMNS = BASE_COLUMNS + ["disclaimer"]
ALLOWED_COLUMNS = set(FULL_COLUMNS)
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


def plugin_root() -> Path:
    return Path(__file__).resolve().parent.parent


def resolve_dataset_file(arg: str) -> Path:
    p = Path(arg)
    if p.is_absolute():
        return p
    # 相对路径：先按当前工作目录，再按插件根目录解析
    cwd_candidate = Path.cwd() / p
    if cwd_candidate.exists():
        return cwd_candidate
    return plugin_root() / p


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        raise FileNotFoundError(f"数据文件不存在: {path}")
    rows: list[dict] = []
    with path.open("r", encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"第 {lineno} 行不是合法 JSON: {exc}") from exc
            if not isinstance(obj, dict):
                raise ValueError(f"第 {lineno} 行不是 JSON 对象")
            rows.append(obj)
    return rows


def output_columns(rows: list[dict]) -> list[str]:
    """全部行都带 disclaimer 时按 9 列上传（云端同步可通过校验），否则按 8 列。"""
    if rows and all("disclaimer" in r for r in rows):
        return list(FULL_COLUMNS)
    return list(BASE_COLUMNS)


def validate(rows: list[dict]) -> list[str]:
    """返回问题清单；空清单表示数据可上传。接受 8 列或 9 列。"""
    problems: list[str] = []
    if len(rows) != EXPECTED_TOTAL:
        problems.append(f"行数应为 {EXPECTED_TOTAL}，实际 {len(rows)}")
    status_count: dict[str, int] = {}
    doc_count: dict[str, int] = {}
    for i, row in enumerate(rows):
        tag = row.get("chunk_id", f"#{i}")
        for col in BASE_COLUMNS:
            if col not in row:
                problems.append(f"{tag}: 缺少基础列 {col}")
        extra = set(row) - ALLOWED_COLUMNS
        if extra:
            problems.append(f"{tag}: 含 Dataset 之外的多余列 {sorted(extra)}")
        st = row.get("status")
        if st not in EXPECTED_STATUS:
            problems.append(f"{tag}: 未知 status={st!r}")
        status_count[st] = status_count.get(st, 0) + 1
        doc_count[row.get("doc_id")] = doc_count.get(row.get("doc_id"), 0) + 1
        if not isinstance(row.get("is_original_excerpt"), bool):
            problems.append(f"{tag}: is_original_excerpt 应为 bool")
        for col in ("doc_id", "chunk_id", "status", "text", "source", "page_or_section", "keywords_zh"):
            if col in row and not isinstance(row[col], str):
                problems.append(f"{tag}: 列 {col} 应为字符串")
        if "disclaimer" in row and not isinstance(row["disclaimer"], str):
            problems.append(f"{tag}: disclaimer 应为字符串")
    if status_count != EXPECTED_STATUS:
        problems.append(f"status 分布不符: 期望 {EXPECTED_STATUS}, 实际 {status_count}")
    if doc_count != EXPECTED_DOCS:
        problems.append(f"doc_id 分布不符: 期望 {EXPECTED_DOCS}, 实际 {doc_count}")
    return problems


def print_login_banner(dataset_id: str) -> None:
    print("[提示] 上传需用户本人登录 ModelScope；AI 无法代登、不接触任何凭据。")
    print("       本人执行: modelscope login --token <本人 Access Token>")
    print("       或网页登录 https://www.modelscope.cn 让 SDK 读取本地登录态")
    print("       高级用法（用户本人自己的脚本）：HubApi(token=<本人 token>) / api.login(<本人 token>)")
    print(f"       目标 Dataset: {dataset_id}（需本人已创建且有写权限）")


def dry_run(rows: list[dict], path: Path, dataset_id: str) -> int:
    problems = validate(rows)
    cols = output_columns(rows)
    print(f"[dry-run] 数据文件: {path}")
    print(f"[dry-run] 读取 {len(rows)} 行 / {len(cols)} 列（{'9 列含 disclaimer' if len(cols) == 9 else '8 列'}）")
    print(f"[dry-run] 目标 Dataset: {dataset_id}（本模式不会连接网络、不会上传、不需要登录/SDK）")
    if len(cols) == 8:
        print("[dry-run] 注意: 该文件只有 8 列、缺 disclaimer。云端拉回后 lib/kb-data.js")
        print("         的 isValidKB() 会因 9 字段校验失败而静默回退内置数据；")
        print("         请用当前 scripts/export_dataset.py 重新导出 9 列版本。")
    if problems:
        print(f"[dry-run] 校验未通过，共 {len(problems)} 处问题:")
        for x in problems[:30]:
            print(f"  - {x}")
        return 2
    print("[dry-run] 校验通过: 67 行 / status 51 present + 11 missing_source + 5 substitute / 9 篇 doc_id")
    print("[dry-run] 下一步（由用户本人执行；注意必须带 --upload）:")
    print("  1) modelscope login --token <本人 Access Token>")
    print(f'  2) python scripts/upload_dataset.py --upload --dataset-file {path} --commit "init: 67 optical KB chunks"')
    return 0


def sdk_upload(api, tmp_path: Path, path_in_repo: str, dataset_id: str, commit: str) -> None:
    """调用官方 HubApi.upload_file（已核对官方文档与 SDK 源码，不编造接口）。"""
    upload_file = getattr(api, "upload_file", None)
    if not callable(upload_file):
        raise RuntimeError(
            "当前 modelscope SDK 未提供 HubApi.upload_file；请 pip install -U modelscope，"
            "或按官方文档改用 CLI：modelscope upload <repo_id> <本地文件> <仓库内路径> --repo-type dataset"
        )
    kwargs = {
        "path_or_fileobj": str(tmp_path),
        "path_in_repo": path_in_repo,
        "repo_id": dataset_id,
        "repo_type": "dataset",
        "commit_message": commit,
    }
    # 新旧 SDK 签名兼容：按实际签名过滤关键字参数；带 **kwargs 的版本保留全部。
    try:
        params = inspect.signature(upload_file).parameters
        has_var_kw = any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values())
        if not has_var_kw:
            kwargs = {k: v for k, v in kwargs.items() if k in params}
    except (TypeError, ValueError):
        pass  # 取不到签名就按官方关键字参数原样调用
    upload_file(**kwargs)


def cli_upload(tmp_path: Path, path_in_repo: str, dataset_id: str, commit: str) -> None:
    """SDK 过旧时回退到官方 CLI：modelscope upload（见官方文档「使用 CLI 工具上传」）。"""
    exe = shutil.which("modelscope")
    if not exe:
        raise RuntimeError(
            "未找到 modelscope CLI；请 pip install -U modelscope，或由用户本人"
            "在网页上传该 JSONL 文件（AI 不代登、不代传）。"
        )
    cmd = [
        exe, "upload", dataset_id, str(tmp_path), path_in_repo,
        "--repo-type", "dataset", "--commit-message", commit,
    ]
    print(f"[信息] SDK 无 upload_file，回退官方 CLI: {' '.join(cmd[:3])} ...")
    done = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if done.returncode != 0:
        tail = ((done.stderr or "") + (done.stdout or "")).strip()[-1200:]
        raise RuntimeError(f"modelscope CLI 退出码 {done.returncode}: {tail}")


def upload(rows: list[dict], path: Path, commit: str, dataset_id: str, path_in_repo: str) -> int:
    """真正上传。需要 modelscope SDK 与用户本人登录态；任何异常都清晰上报。"""
    problems = validate(rows)
    if problems:
        print(f"[错误] 上传前数据校验未通过，共 {len(problems)} 处问题，已中止上传:")
        for x in problems[:30]:
            print(f"  - {x}")
        return 2
    cols = output_columns(rows)
    if len(cols) == 8:
        print("[警告] 数据只有 8 列、缺 disclaimer；上传后云端同步仍会因 9 字段校验失败")
        print("       而回退内置数据。建议用当前 export_dataset.py 重新导出 9 列版本后再上传。")
    print_login_banner(dataset_id)
    try:
        from modelscope.hub.api import HubApi  # 延迟导入：dry-run 不需要 SDK
    except ImportError:
        print("[错误] 未安装 modelscope SDK。请先执行: pip install modelscope")
        print("       （dry-run 不需要该依赖；仅上传阶段需要）")
        return 3

    # 上传用临时 JSONL：用 tempfile 生成唯一文件名，绝不覆盖用户已有的同名文件。
    fd, tmp_name = tempfile.mkstemp(prefix="opticforge-upload-", suffix=".jsonl")
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            for row in rows:
                clean = {col: row[col] for col in cols}
                f.write(json.dumps(clean, ensure_ascii=False) + "\n")
        print(f"[信息] 已生成上传用临时文件: {tmp_path}（{len(cols)} 列，收尾自动清理）")
        api = HubApi()
        try:
            sdk_upload(api, tmp_path, path_in_repo, dataset_id, commit)
        except RuntimeError as exc:
            # 仅当 SDK 明确没有 upload_file 时才回退 CLI；其它异常交给外层统一处理
            if "upload_file" not in str(exc):
                raise
            print(f"[信息] {exc}")
            cli_upload(tmp_path, path_in_repo, dataset_id, commit)
        print(f"[OK] 上传完成: {dataset_id} / {path_in_repo} ({len(rows)} 行) — 请到 ModelScope 网页核对")
        return 0
    except Exception as exc:
        msg = str(exc)
        print(f"[错误] 上传失败: {type(exc).__name__}: {msg}")
        low = msg.lower()
        if "401" in low or "unauthor" in low or "token" in low or "login" in low:
            print("       可能原因: 未登录 / token 失效 / token 无该 Dataset 写权限。")
        elif "404" in low or "not found" in low or "不存在" in msg:
            print(f"       可能原因: Dataset {dataset_id} 尚未由用户本人在网页创建，或名称拼写不一致。")
        elif "network" in low or "connect" in low or "timeout" in low or "proxy" in low:
            print("       可能原因: 网络不通 / 代理问题；可稍后重试或检查代理设置。")
        print("       排查清单:")
        print("         1) 本人执行 modelscope login --token <本人 Access Token>（或网页登录）")
        print(f"         2) 本人已在网页创建 Dataset {dataset_id} 且当前账号有写权限")
        print("         3) pip install -U modelscope 后重试")
        print("         4) 重新运行: python scripts/upload_dataset.py --dry-run 先确认数据本身无误")
        return 3
    finally:
        # 临时产物无论成功失败都不保留，避免误把派生文件当源文件；文件名唯一，不会误删用户文件。
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except OSError:
            pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=f"上传 OpticForge KB 到 ModelScope Dataset {DATASET_ID}（默认 dry-run，不上传）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--dataset-file", default=DEFAULT_DATASET_FILE,
                        help=f"67 行 JSONL 数据文件（默认 {DEFAULT_DATASET_FILE}；由 export_dataset.py 生成）")
    parser.add_argument("--commit", default="init: OpticForge KB 67 chunks",
                        help="上传 commit message（仅上传模式使用）")
    parser.add_argument("--dataset-id", default=DATASET_ID,
                        help=f"目标 Dataset ID（默认 {DATASET_ID}；需用户本人已创建）")
    parser.add_argument("--path-in-repo", default=DEFAULT_PATH_IN_REPO,
                        help=f"仓库内文件名（默认 {DEFAULT_PATH_IN_REPO}，与 lib/kb-data.js 的 CANDIDATE_URLS 一致）")
    parser.add_argument("--dry-run", action="store_true",
                        help="只校验数据、不连接网络、不上传（AI 可安全执行；不要求登录/SDK）")
    parser.add_argument("--upload", action="store_true",
                        help="显式执行上传（必须由用户本人登录后运行；AI 不执行此模式）")
    args = parser.parse_args(argv)

    # 默认即 dry-run；只有显式 --upload 且不带 --dry-run 才真正上传。
    really_upload = args.upload and not args.dry_run
    path = resolve_dataset_file(args.dataset_file)
    try:
        rows = read_jsonl(path)
    except (FileNotFoundError, ValueError, OSError) as exc:
        print(f"[错误] 读取数据文件失败: {exc}")
        print("       请先运行: python scripts/export_dataset.py -o data/")
        return 2

    if really_upload:
        return upload(rows, path, args.commit, args.dataset_id, args.path_in_repo)
    if args.upload and args.dry_run:
        print("[信息] 同时提供了 --upload 与 --dry-run：按更安全者处理，仅执行 dry-run。")
    return dry_run(rows, path, args.dataset_id)


if __name__ == "__main__":
    sys.exit(main())
