# Contributing to qwen-audio-agent

感谢你帮助改进 qwen-audio-agent。

## 开发环境

需要 Node.js 22.22.2 或 24.15.0、npm 10+。使用 nvm 时：

```bash
nvm install
nvm use
npm ci
```

运行完整检查：

```bash
npm test
npm run build
npm run release:check
```

提交前请确保没有把 `.env`、API Key、用户档案、任务状态、日志或后台工作目录加入
版本控制。

## 变更原则

- 保持 Realtime 前台与后台 Agent 的边界，遵循 `docs/architecture.md`。
- 修复应包含覆盖失败场景的测试。
- 避免在无关变更中重排或重写大段代码。
- 新配置必须有安全默认值，并同步更新 `.env.example` 与配置文档。
- 用户可见行为变化应更新 `CHANGELOG.md`。

## Pull Request

请在 PR 中说明问题、修复方式、验证命令和兼容性影响。涉及网络、权限、持久化、
进程管理或发布流程的变更，应明确列出安全影响和回滚方式。

行为准则以友善、尊重和建设性协作为基本要求。骚扰、歧视、泄露隐私或恶意提交
不会被接受。

## 发布

版本标签必须与 `package.json` 完全一致，例如 `v0.2.0`。标签触发发布工作流：
先运行完整检查，再以 npm provenance 发布公共包，随后构建、签名、公证 macOS
DMG 并创建 GitHub Release。仓库维护者需预先配置 `NPM_TOKEN`、Apple Developer
签名证书和公证凭据。
