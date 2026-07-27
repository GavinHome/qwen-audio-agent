# Changelog

## 0.5.0

- 终端客户端收敛到 minimal TUI：macOS 使用 CoreAudio 回声消除全双工，
  Linux 和 Windows 使用 PortAudio 半双工，并统一支持按键手动打断。
- 暂时隐藏仍在开发中的全屏 TUI 和纯文字 CLI，不纳入 npm 发布包。
- Gateway 新增 `text.message` 文字通道,与语音共用会话与任务体系;
  文字触发采用静音提交序列适配 Qwen Realtime。
- 修复播放回执缺失响应上下文时的 Gateway 崩溃;静默打断竞态中
  无害的 "no active response" 报错。
- WebUI 资源与 API 改为相对路径,支持反向代理前缀部署。
- 修复后台服务从非仓库目录启动时无法定位 WebUI 的问题，并固定 launchd/systemd
  工作目录。
- 收紧 Gateway Host/Origin 校验，阻止默认局域网暴露与 DNS rebinding；远程部署
  改为显式可信 Origin 加带认证的 HTTPS 反向代理。
- 远程图片、音频和视频改为用户确认后加载，避免 Agent 输出触发隐私泄露。
- 固定 OpenCode/OpenClaw 兜底运行时版本，补齐公开 npm/GitHub 元数据、跨平台 CI、
  安全政策、贡献说明和第三方组件声明。
- macOS 正式构建启用 hardened runtime、Developer ID 签名与公证；保留独立的
  本地未签名构建命令。
- 公开仓库迁移至 QwenAudio 组织；固定 GitHub Actions 提交并收紧工作流权限，
  补充隐私说明、Dependabot 和结构化 Issue/PR 模板。

## 0.2.0

- 将 Realtime 前台与后台 Agent 收敛为清晰的 Gateway 边界。
- 默认支持 OpenCode 持久 Coordinator Session，并保留 OpenClaw 适配入口。
- 后台任务采用非阻塞提交、持久状态和可靠结果回注。
- 优化多任务结果批处理、播报插入时机、打断恢复和对话展示顺序。
- 完善 WebUI 任务动效、macOS 全双工语音 TUI 和 Electron 小窗口。
- 增加个人记忆、身份隔离、Smart Turn 时序保护和发布验证。
- 部署入口收敛为 `npm run backend` 与 `npm start` 两个常驻命令。
