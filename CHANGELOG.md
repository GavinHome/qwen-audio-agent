# Changelog

## Unreleased

- 终端客户端收敛到 `tui/`,提供两种风格:极简语音 TUI(`npm run tui`)
  与全屏工作台 TUI(`npm run tui:full`,Textual,跨平台降级),另附
  纯文字 CLI(`npm run tui:text`);两种风格共享 CoreAudio 回声消除助手。
- Gateway 新增 `text.message` 文字通道,与语音共用会话与任务体系;
  文字触发采用静音提交序列适配 Qwen Realtime。
- 修复播放回执缺失响应上下文时的 Gateway 崩溃;静默打断竞态中
  无害的 "no active response" 报错。
- WebUI 资源与 API 改为相对路径,支持反向代理前缀部署。

## 0.2.0

- 将 Realtime 前台与后台 Agent 收敛为清晰的 Gateway 边界。
- 默认支持 OpenCode 持久 Coordinator Session，并保留 OpenClaw 适配入口。
- 后台任务采用非阻塞提交、持久状态和可靠结果回注。
- 优化多任务结果批处理、播报插入时机、打断恢复和对话展示顺序。
- 完善 WebUI 任务动效、macOS 全双工语音 TUI 和 Electron 小窗口。
- 增加个人记忆、身份隔离、Smart Turn 时序保护和发布验证。
- 部署入口收敛为 `npm run backend` 与 `npm start` 两个常驻命令。
