# 超胜币安广场发布器

一个最小化的远程 MCP 服务，只提供一个工具：

- `publish_binance_square_post`：把最终确认的短文发布到 Binance Square。

## Railway 环境变量

部署后在 Railway 的 Variables 中配置：

- `BINANCE_SQUARE_OPENAPI_KEY`：你的币安广场发布 API Key
- `MCP_PATH_SECRET`：随机长字符串，用于保护 MCP 地址

不要把 API Key 写进 GitHub、代码、聊天内容或截图。

## 启动

Node.js 22+：

```bash
npm start
```

健康检查：

```text
https://<Railway域名>/health
```

MCP 地址：

```text
https://<Railway域名>/mcp/<MCP_PATH_SECRET>
```

## 使用

1. 让 ChatGPT 写好帖子。
2. 你明确说“发布”。
3. ChatGPT 调用 `publish_binance_square_post`。
4. 工具返回 Binance Square 帖子链接。

## 安全边界

- 只发布短文。
- 不读取币安资产。
- 不下单。
- 不提现。
- Binance API Key 只保存在 Railway 环境变量。
