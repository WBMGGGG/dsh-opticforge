# 安装与卸载

前置：DSH 已安装并可正常启动；插件运行在 DSH 的 Node 上（Node ≥ 20）。

本插件**没有任何运行时依赖**，不 import 任何 `@deepseek-ai` 包，所以安装只有一步：让 DSH 能解析到它。不需要从 `app.asar` 抽依赖闭包，也不需要额外装包。

---

## 方式一：插件市场（推荐）

市场收录后，在 DSH 的插件市场里搜 `OpticForge` 安装，重启生效。

市场只允许安装精选列表（`awesome-dsh-plugin`）内的来源。未收录前的安装走方式二。

---

## 方式二：本机 link 安装（开发用）

```bash
node scripts/install-local.mjs
```

脚本做三件事：

1. 在 profile 的 `package.json` 的 `dependencies` 里写 `"dsh-opticforge": "link:<本仓库绝对路径>"`（写前留 `.bak-时间戳` 备份）
2. 把 `dsh-opticforge` 追加到 `dsh.profile.bundles` 列表
3. 在 `node_modules` 下建目录链接指回本仓库

重启 DSH 生效。

```bash
node scripts/install-local.mjs --dry-run     # 只打印，不动任何文件
node scripts/install-local.mjs --uninstall   # 只移除本插件相关项
node scripts/install-local.mjs --profile "C:\Users\X\.dsh\profiles\desktop"
```

### 手工等价操作

不想跑脚本，改 profile 的 `package.json` 即可，效果一致：

```json
{
  "dependencies": {
    "dsh-opticforge": "link:D:/AI/DeepSeek Harness/opticforge"
  },
  "dsh": {
    "profile": {
      "bundles": ["...原有项...", "dsh-opticforge"]
    }
  }
}
```

再建一个目录链接 `profiles/desktop/node_modules/dsh-opticforge` → 本仓库。

---

## 验证

重启 DSH 后，让模型调用一次：

```
opticforge_docs
```

预期返回 `ok: true`、`kb_version` 与 `docs` 列表（9 个板块）。再调 `opticforge_search`（如 `query="共焦色散 测量原理"`）应命中 A01。

不放心可以先跑一遍离线验收，不依赖 DSH：

```bash
node scripts/verify-all.mjs
```

它检查发布契约、源码零宿主依赖、知识库产物一致性、25 个集成用例、打包清单和版本号，共 29 项。

---

## 升级

link 安装后，改仓库里的代码或数据，**重启 DSH 就加载最新版本**，不用重新安装。

改了知识库要重建产物，否则运行时读到的还是旧的 `data/kb-data.json`：

```bash
node scripts/build-kb.mjs --all --version <新版本号>
```

版本号同时写进 `data/kb-meta.json`，工具返回里的 `kb_version` 会回显它——这就是判断"有没有用上最新数据"的依据。

## 卸载

```bash
node scripts/install-local.mjs --uninstall
```

只删除本插件的依赖项、bundles 项和目录链接，不触碰其它插件，也不删仓库文件。

---

## 排错

**重启后工具没出现**

1. 看 `profiles/desktop/package.json`：`dependencies` 里有没有 `dsh-opticforge`，`dsh.profile.bundles` 里有没有同名项
2. 看 `profiles/desktop/node_modules/dsh-opticforge` 是否存在且指向本仓库
3. 路径含空格时 `link:` 值里的空格是合法的，但手写 JSON 时别把反斜杠写坏（用 `/` 更稳）

**工具出现了但返回旧数据**

`data/kb-data.json` 是构建产物，改 `data/kb/*.json` 不会自动生效。跑 `build-kb.mjs --all` 重建，再看返回里的 `kb_version` 是否变了。

**返回 `ok:false` 且提示模块未就绪**

`lib/` 下的数据或计算模块缺失。跑一次 `node scripts/verify-all.mjs`，它会直接指出缺哪个文件。

**检索命中空，但你认为知识库里有**

先 `opticforge_docs` 看板块清单，确认主题在不在覆盖范围内。量子光学、COMSOL、热光学等主题本库明确不覆盖，返回空是正确行为。
