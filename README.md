# qwen-audio-agent

## 让主流 Agent 开口说话

**自由对话，不被任务阻塞；无缝连接你已经在用的 Agent。**

qwen-audio-agent 是面向主流 Agent 的实时语音前台。你可以像通话一样持续说话、
随时打断，也可以直接用语音安排搜索、文件、代码和其他耗时工作。默认连接
OpenCode，也支持 OpenClaw，并为更多后台 Agent 保留统一的接入方式。

它不替代后台 Agent，而是让已有的模型、工具、MCP、Skill、权限和项目上下文，
自然进入实时语音对话。

## 对话继续，任务也在继续

```text
用户  ⇄  Realtime 语音前台
                 │
                 ├─ 自然聊天与即时回答
                 │
                 └─ 无缝交给后台 Agent
                              │
                              └─ 结果自然回到对话
```

Realtime 前台负责倾听、理解和表达。能直接回答的问题立即回答；需要外部信息、
工具或持续处理时，再把任务交给后台 Agent。

后台执行不会占住语音对话。你可以继续提出新要求、询问进度、修改方向或取消任务。
完成结果会在合适的时机回到当前上下文，由 Realtime 自然承接和播报。整个过程中，
用户面对的始终是同一个助理。

## 核心体验

- 像通话一样自由交流：全双工语音、自然打断、持续多轮对话
- 对话与任务互不阻塞：前台持续回应，后台继续执行
- 结果无缝回到上下文：可以追问、补充、修改和继续处理
- 连接现有 Agent 能力：延续工具、项目、记忆与工作习惯
- OpenCode 默认增强支持，并可切换 OpenClaw
- WebUI、终端 TUI 和 macOS 桌面悬浮球
- 本地用户档案和跨会话个人记忆

## 快速开始

需要 Node.js 22.22.2、24.15.0 或更高兼容版本、npm 10+ 和 DashScope API Key。
当前版本请从源码安装：

```bash
cd qwen-audio-agent
npm install
npm install -g .
```

创建用户配置：

```bash
qwenaudio config
```

打开命令显示的 `config.env`，填写：

```dotenv
DASHSCOPE_API_KEY=your-key
```

启动 Gateway：

```bash
qwenaudio
```

`qwenaudio`、`qwenaudio gateway` 和 `qwenaudio gateway run` 都会在前台运行。
另开一个终端启动语音界面：

```bash
qwenaudio tui
```

或者打开 WebUI：

```bash
qwenaudio webui
```

## 后台常驻

希望个人助理长期在线时，可以安装为用户后台服务：

```bash
qwenaudio gateway install
```

常用管理命令：

```bash
qwenaudio gateway status
qwenaudio gateway restart
qwenaudio gateway stop
qwenaudio gateway start
qwenaudio gateway uninstall
```

macOS 使用 `launchd`，Linux 使用 `systemd --user`。Gateway 和由它启动的后台
Agent 会被统一管理。

## 选择后台 Agent

默认使用 OpenCode 增强模式，无需额外配置。切换到 OpenClaw：

```dotenv
AGENT_PROTOCOL=openclaw
```

增强模式会为 qwen-audio-agent 启动独立的后台 Agent，同时保留用户已有的模型、
权限、Skill 和 MCP 配置。也可以使用兼容模式连接已经运行的 OpenCode 或
OpenClaw，不修改现有服务。

详细选项见 [配置说明](docs/configuration.md)。

## 用户档案与记忆

用户数据保存在 `~/.config/qwaudio/`：

- `USER.md`：称呼、所在地、偏好和常用项目
- `frontend-memory.json`：用户明确要求长期记住的信息
- `tasks.json`：任务结果和待通知状态

这些文件不会写入源码仓库。不要在 `USER.md` 中保存密码、API Key、验证码或令牌。

## 源码开发

```bash
npm install
npm run build
npm test
```

```bash
npm run dev       # Gateway 与 WebUI 热更新
npm run desktop   # macOS 桌面悬浮球
```

默认 Gateway 只监听本机地址。远程使用时应配置 HTTPS 和访问认证。

## 许可证

[Apache License 2.0](LICENSE)
