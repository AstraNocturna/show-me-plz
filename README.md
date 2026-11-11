# show-me-plz

pi agent 的会话阅读器：在独立窗口中实时、只读地展示当前会话。

- `app/` — Tauri 2 + React 阅读器（`show-me-plz.exe`）
- `extension/` — pi 插件，提供 `/viewer` 命令

插件不注册工具、不挂提示词或上下文钩子、不写会话，对模型上下文无影响。

## 开发

```bash
cd app
pnpm install
pnpm tauri build --no-bundle   # 产物: app/src-tauri/target/release/show-me-plz.exe

# 在项目里临时加载插件，然后在 pi 中输入 /viewer
pi -e <repo>/extension/index.ts
```

可通过环境变量 `SHOW_ME_PLZ_EXE` 指定阅读器程序路径。
