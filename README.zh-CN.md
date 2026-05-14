# OC-Builder

面向微信和 QQ 生态的通用虚拟人格构造器。

English documentation: [README.md](README.md)

## 愿景

OC-Builder 不只是聊天机器人。长期目标是运行可信的虚拟角色：他们活跃在社交平台里，能对话、记忆、浏览朋友圈或 QQ 动态、评论点赞，并以稳定的人格持续维护关系。

## 当前范围

- 基于 Wechaty 的微信私聊与群聊。
- 通过 OpenAI SDK 兼容接口调用 DeepSeek。
- 每个联系人独立的 profile、聊天历史和任务文件。
- 行动前先进行社交决策。
- 支持搜索、命令执行、任务销项和微信联系人动作的工具循环。
- 将回复拆成更自然的微信气泡。

## 目标架构

```text
Platform Adapters
  WeChat Adapter
  QQ Adapter
  Timeline Adapter

Event Runtime
  Event Inbox
  Conversation Scheduler
  Context Builder

Character Runtime
  Social Decision
  Agent Loop
  Action Dispatcher
  Memory Writer

Character Model
  Soul
  Behavior Policy
  Relationship Policy
  Memory Write Policy

Memory and Storage
  Contact Memory
  Account Memory
  Relationship Memory
  Event History
  Task and Promise Ledger
```

平台适配层只负责把微信、QQ、朋友圈、QQ 空间等事件转换成统一的 `SocialEvent`。角色运行时只消费标准事件并产出标准动作，避免人格核心绑定某个平台 SDK。

## 运行模型

生产优先采用一个角色一个进程，后续再通过 supervisor 管理多个角色进程。

原因：

- 不同灵魂、平台登录态、记忆和工具权限隔离更清楚。
- 更容易调试和观察。
- 降低不同角色上下文串线的风险。
- 更贴近真实社交账号的运行方式。

## 记忆策略

OC-Builder 不应把关键事实依赖向量数据库。关系记忆必须通过角色、平台、账号、联系人进行确定性定位。错误记忆比缺失记忆更破坏代入感。

未来推荐存储：

- 本地开发使用 SQLite。
- 多角色长期部署使用 PostgreSQL。
- 所有记忆写入保留审计日志。
- 可选全文搜索，但不作为关键事实来源。

## 快速开始

1. 配置环境：

   复制 `.env.example` 到 `.env`，填写 `DEEPSEEK_API_KEY` 和 `SEARXNG_URL`。

2. 安装依赖：

   ```bash
   pnpm install
   ```

3. 构建：

   ```bash
   pnpm build
   ```

4. 启动：

   ```bash
   pnpm start
   ```

## 贡献者

- Ender (Project Lead)
