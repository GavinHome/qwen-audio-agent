# 配置

正式安装后，qwen-audio-agent 从用户配置文件读取设置：

```text
~/.config/qwaudio/config.env
```

设置 `QWAUDIO_CONFIG_DIR` 或 `XDG_CONFIG_HOME` 可以更改配置目录。开发仓库中的
`.env.local` 和 `.env` 仍然支持，并优先于用户配置文件。

配置优先级固定为：

```text
CLI 参数 > 进程环境变量 > .env.local > .env > 用户配置文件 > 内置默认值
```

运行下面的命令可以显示当前用户配置文件的准确位置：

```bash
qwenaudio config
```

## 最小配置

默认 OpenCode 后台只需要填写：

```dotenv
DASHSCOPE_API_KEY=your-key
```

本地身份密钥由程序首次启动时自动生成，保存在同一配置目录的 `state.env`，
文件权限为仅当前用户可读写。

同一目录还会自动创建 `USER.md`，用于保存稳定用户档案。程序只会改动文件内带标记
的托管区域，其他手写内容会原样保留；修改后下一轮对话即可生效。请勿在其中保存
密码、API Key、验证码或令牌。
如需把档案放在其他位置，可设置：

```dotenv
QWEN_AUDIO_AGENT_USER_PROFILE_PATH=/absolute/path/to/USER.md
```

本机 `USER.md` 只在默认的 `personal` 身份模式下注入上下文；多用户 `browser`
模式不会共享这份档案。

同一用户目录还保存：

```text
frontend-memory.json  # 用户明确要求跨会话记住的长期信息
tasks.json            # 后台任务、结果和待播报通知的恢复状态
```

这些文件和 `USER.md`、`state.env` 一样只允许当前用户读写，不会写入源码仓库。
旧版仓库 `runtime/` 目录中的对应文件会在首次启动时自动迁移。高级用户仍可通过
`QWEN_AUDIO_AGENT_FRONTEND_MEMORY_PATH` 和 `QWEN_AUDIO_AGENT_TASK_STATE_PATH`
覆盖位置。

## 选择后台

OpenCode 是默认后台，默认地址为 `http://127.0.0.1:4096`：

```dotenv
AGENT_PROTOCOL=opencode
QWEN_AUDIO_AGENT_BACKEND_MODE=managed
OPENCODE_BASE_URL=http://127.0.0.1:4096
```

OpenClaw 默认地址为 `http://127.0.0.1:18789`：

```dotenv
AGENT_PROTOCOL=openclaw
OPENCLAW_BASE_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=
```

连接用户现有的 Server 时使用兼容模式。qwen-audio-agent 不会修改或重启该
Server，而会选择已有的默认 Agent，并逐轮注入后台协议：

```dotenv
QWEN_AUDIO_AGENT_BACKEND_MODE=compatible
# 可选；省略时自动发现默认 Agent
QWEN_AUDIO_AGENT_BACKEND_AGENT=
```

```bash
qwenaudio gateway --backend openclaw \
  --backend-mode compatible \
  --backend-url http://127.0.0.1:18789
```

桌面版、CLI 和 WebUI 可以复用同一个 Gateway，但同一用户同时只有一个活跃语音
入口。CLI 默认不抢占现有桌面语音；需要明确接管时使用：

```bash
qwenaudio tui --takeover
```

同一用户只能运行一个 TUI。Gateway、桌面应用和 WebUI 可以同时驻留；桌面球会在
TUI 接管语音期间显示占用状态。

## 自动启动

Gateway 默认使用增强模式并启动带专用后台 Agent 的服务。若目标端口已被其他
进程占用，会选择空闲的本地端口，不会接管或关闭用户进程。兼容模式只连接现有
服务，地址不可用时直接报错。

TUI、WebUI 和桌面版只连接 Gateway，不直接连接、启动或停止 OpenCode /
OpenClaw。桌面设置中的核心配置会保存到用户配置文件，在下次启动 Gateway 时
生效；Gateway 地址会立即验证并切换。

OpenCode 默认获取随应用固定的 npm package 版本。高级用户可以使用：

```dotenv
OPENCODE_RUNTIME=installed
# 或 source / binary / auto
```

qwen-audio-agent 启动的 OpenCode 默认继承用户原有的全局配置（通常是
`~/.config/opencode/opencode.json`），因此已经安装的 MCP、Skill、权限、模型和
插件可以继续使用；qwen-audio-agent 自己的后台 Agent 和 Session 插件以附加
配置形式加载。

如果用户配置或第三方插件与 qwen-audio-agent 冲突，可以临时启用隔离模式排查：

```dotenv
QWEN_AUDIO_AGENT_OPENCODE_ISOLATE_USER_CONFIG=true
```

也可以通过 `QWEN_AUDIO_AGENT_OPENCODE_XDG_CONFIG_HOME` 指定另一套 OpenCode 用户
配置目录。隔离后，原全局配置中的 MCP 和插件不会自动加载。

OpenClaw 默认按以下顺序发现：

1. `OPENCLAW_BIN`
2. PATH 中的 `openclaw`
3. `OPENCLAW_SOURCE_DIR`

只有使用源码运行且默认相邻目录不存在时，才需要填写
`OPENCLAW_SOURCE_DIR`。

## 高级设置

以下设置都有稳定默认值，普通用户不需要写入配置文件：

| 设置 | 默认值 |
| --- | --- |
| `HOST` / `PORT` | `127.0.0.1` / `3101` |
| `OPENCODE_WORKSPACE` | 安装目录的 `config/opencode-workspace` |
| `OPENCODE_MODEL` | `alibaba-cn/qwen3.7-max` |
| `QWEN_AUDIO_REALTIME_MODEL` | `qwen-audio-3.0-realtime-plus` |
| `QWEN_AUDIO_REALTIME_PROVIDER` | `dashscope` |
| `QWEN_AUDIO_REALTIME_VOICE` | `longanqian` |
| `QWEN_AUDIO_AGENT_IDENTITY_MODE` | `personal` |
| `AGENT_TIMEOUT_MS` | `300000` |

任务状态、通知重试、记忆容量与保留时间等运行参数同样使用内置默认值。只有明确
进行容量规划或故障诊断时才建议覆盖。
