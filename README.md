# Mailbox Pool Vercel

一个可以直接部署到 Vercel 的邮箱池项目：网页导入 TXT，一行一个邮箱；多服务器通过 API 每次领取一个邮箱；页面实时显示剩余邮箱数。

## 功能

- 上传 `.txt` 或粘贴文本导入邮箱
- 一行一个，导入时自动忽略本次输入中的重复行
- `GET/POST /api/mailboxes/next` 原子弹出并返回一个邮箱
- `GET /api/mailboxes/count` 返回当前在线邮箱数
- 前端每 1.5 秒自动刷新在线邮箱数
- 使用 Neon 免费 PostgreSQL，适合 Vercel Serverless 多实例共享库存
- 首次调用 API 会自动创建 `mailbox_pool_items` 表

## 部署

1. 在 Neon 创建免费 PostgreSQL 数据库，复制连接串。
2. 准备一个管理员密钥，例如 `ADMIN_TOKEN=your-secret-token`。
3. **部署到 Vercel**：
   - 点击下面的按钮，一键部署到 Vercel。

   [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/kiss-kedaya/mailbox-pool-vercel)

   - 在 Vercel 部署页面填写项目名称。
   - 在 Environment Variables 中填写：
     - `DATABASE_URL`：Neon 的 PostgreSQL 连接串，通常包含 `sslmode=require`
     - `ADMIN_TOKEN`：导入和领取接口密钥
   - 点击 `Deploy` 按钮。

## API

### 导入邮箱

```bash
curl -X POST https://你的域名/api/mailboxes/import \
  -H "content-type: application/json" \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -d '{"text":"a@example.com\nb@example.com"}'
```

返回：

```json
{ "ok": true, "added": 2, "ignored": 0, "count": 2 }
```

### 领取一个邮箱

```bash
curl https://你的域名/api/mailboxes/next \
  -H "authorization: Bearer $ADMIN_TOKEN"
```

返回：

```json
{ "ok": true, "mailbox": "a@example.com", "count": 1 }
```

库存为空返回 HTTP 404：

```json
{ "ok": false, "mailbox": null, "count": 0, "error": "empty" }
```

### 查看数量

```bash
curl https://你的域名/api/mailboxes/count
```

返回：

```json
{ "ok": true, "count": 123 }
```
