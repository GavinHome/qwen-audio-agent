# qwen-audio-agent

qwen-audio-agent 给 OpenCode 或 OpenClaw 增加实时语音交互能力。Realtime 前台持续
与用户双工交流；需要代码、文件、工具或耗时处理时，把整理后的要求交给固定的后台
Agent Session。

## 快速开始

需要 Node.js 22.22.2、24.15.0 或更高兼容版本、npm 10+ 和 DashScope API Key。

```bash
npm install -g qwen-audio-agent
qwenaudio config
```

打开命令显示的 `config.env`，普通用户只需填写：

```dotenv
DASHSCOPE_API_KEY=your-key
```

然后启动 Gateway：

```bash
qwenaudio gateway
```

不写子命令时也等同于 `qwenaudio gateway`。命令会打印 Gateway 和 WebUI 地址，
并在前台持续运行；按 `Ctrl-C` 会停止 Gateway 以及由它管理的后台 Agent。

另开一个终端即可进入 TUI：

```bash
qwenaudio tui
```

或者打开 WebUI：

```bash
qwenaudio webui
```

常用命令：

```bash
qwenaudio status                 # 查看 Gateway 和后台 Agent 状态
qwenaudio tui --mode full        # 全屏 TUI
qwenaudio webui --no-open        # 只打印 WebUI 地址
qwenaudio tui --takeover         # 明确接管另一前端的语音控制权
```

## 进程边界

Gateway 是唯一核心服务：

```text
桌面球 ─┐
TUI ────┼── Gateway ── 固定后台 Agent Session
WebUI ──┘       └──── OpenCode / OpenClaw（增强模式下由 Gateway 管理）
```

- TUI、WebUI 和桌面版都是客户端，不启动或关闭 Gateway。
- 所有客户端连接同一个 Gateway，共享后台协调上下文。
- 同一用户同时只有一个前端拥有麦克风和播报控制权。
- UI 退出不影响 Gateway；Gateway 退出才结束它管理的后台 Agent。
- 后台同步执行、内部排队或使用 subagent 都是后台 Agent 自己的决定，前台不介入。

## 桌面版

源码开发时运行：

```bash
npm run desktop
```

桌面版只显示一个置顶悬浮球。它不会自动启动 Gateway；未连接时点击红色小球即可
打开设置，填写 Gateway 地址。设置中的 Realtime 与后台配置写入本地配置文件，
在下次启动 Gateway 时生效。

桌面版和 TUI 可以同时打开，但不会互相启动或停止服务。若另一个入口正在使用语音，
新入口默认不抢占；需要时使用 `--takeover`。

## 后台模式

默认是增强模式（`managed`）。Gateway 会启动自己的 OpenCode 或 OpenClaw，
加载 qwen-audio-agent 的专用 Agent、权限和工具配置；若默认端口已被占用，会选择
另一个空闲本地端口，不结束用户原有进程。

Gateway 优先使用用户明确指定或已经安装在 PATH 中的后台版本；找不到时才通过
无固定版本的 npm 包启动。源码目录必须显式配置，不依赖特定的本地目录结构。

```bash
qwenaudio gateway --backend opencode
qwenaudio gateway --backend openclaw
```

连接用户已经启动的服务时使用兼容模式。Gateway 只连接，不启动或停止该服务：

```bash
qwenaudio gateway \
  --backend opencode \
  --backend-mode compatible \
  --backend-url http://127.0.0.1:4096
```

OpenClaw 同理，把后台和地址换成 `openclaw`、`http://127.0.0.1:18789`。需要指定
现有 Agent 时增加 `--backend-agent ID`。

详细设置见 [配置说明](docs/configuration.md)，架构约束见
[架构说明](docs/architecture.md)。

## 记忆与本地状态

首次运行会在 `~/.config/qwaudio/` 自动创建：

- `config.env`：用户配置。
- `state.env`：自动生成的本地认证密钥，无需手写。
- `USER.md`：用户可维护的稳定档案。
- `frontend-memory.json`：明确要求跨会话记住的信息。
- `tasks.json`：后台任务、结果和待播报通知状态。

不要在 `USER.md` 中保存密码、API Key、验证码或令牌。

## 源码开发

```bash
npm install
npm link
npm run build
qwenaudio gateway
```

其他命令：

```bash
npm run dev       # Gateway 与 WebUI 热更新
npm run desktop   # 启动纯客户端桌面球
npm test          # 运行全部测试
```

默认 Gateway 只监听 `127.0.0.1:3101`。不要直接暴露到公网；远程使用应配置 HTTPS
反向代理和认证。健康检查地址为 `http://127.0.0.1:3101/api/health`。

## 许可证

[Apache License 2.0](LICENSE)
