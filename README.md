# show-me-plz

pi agent 的会话阅读器：在独立窗口中实时、只读地展示当前会话。

- `app/` — Tauri 2 + React 阅读器（`show-me-plz.exe`）
- `extension/` — pi 插件，提供 `/viewer` 命令

插件不注册工具、不挂提示词或上下文钩子、不写会话，对模型上下文无影响。

## 使用

| 按键 | 作用 |
| --- | --- |
| `Ctrl+F` | 搜索当前分支（含折叠的思考/工具内容），支持正则、大小写、按提问/回答/过程过滤；`Enter`/`Shift+Enter` 或 `F3` 切换结果 |
| `j` / `k` | 下一个 / 上一个提问 |
| `g` / `G` | 顶部 / 底部 |
| `m` | 给当前提问加/取消书签（回答右上角 ☆ 也可加书签） |
| `]` / `[` | 下一个 / 上一个书签 |
| `'` | 打开书签面板（可写备注、点圆点换颜色） |
| `v` | 切换 对话 / 完整 模式 |
| `?` | 快捷键帮助 |

停在底部时自动跟随新消息；向上翻阅时不打扰，底部出现“有新消息”提示。

书签只保存在 `%APPDATA%\com.astranocturna.showmeplz\marks\<sessionId>.json`，不写 pi 的任何文件。

## 开发

```bash
cd app
pnpm install
pnpm tauri build --no-bundle   # 产物: app/src-tauri/target/release/show-me-plz.exe

# 在项目里临时加载插件，然后在 pi 中输入 /viewer
pi -e <repo>/extension/index.ts
```

可通过环境变量 `SHOW_ME_PLZ_EXE` 指定阅读器程序路径。
