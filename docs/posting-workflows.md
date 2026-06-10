# 三种发文方式流程

cf-astro-blog 支持 **三条独立的发文路径**，分别适用于不同场景。

---

## 方式一：本地 Markdown 文件 → 同步到 D1

**适合**：深度写作、离线编辑、版本控制、团队协作

```
┌───────────────────────────────────────────────────────────────────┐
│  ① 在 content/posts/ 编写 .md 文件                                │
│     └─ 草稿阶段放 _drafts/（不进 Git，不提交）                     │
│     └─ 写完后移到 content/posts/ 并设好 status                     │
├───────────────────────────────────────────────────────────────────┤
│  ② 提交到 Git                                                     │
│     git add content/posts/                                        │
│     git commit -m "feat: 新文章"                                   │
│     git push                                                      │
│     └─ GitHub Actions 自动触发 deploy                             │
├───────────────────────────────────────────────────────────────────┤
│  ③ deploy 流程自动执行 sync:posts                                 │
│     npm run sync:posts --remote                                   │
│     └─ 读取 .md frontmatter → 写入 D1（含 status、tags、category）│
├───────────────────────────────────────────────────────────────────┤
│  ④ Astro build + wrangler deploy → 站点更新                       │
└───────────────────────────────────────────────────────────────────┘
```

**安全性**：

- `content/posts/_drafts/` 目录下的 `.md` 文件被 `.gitignore` 忽略，**不会被提交到 Git**
- 草稿写完后移到 `content/posts/` 再 `git add`，确保只有正式文章进入版本控制
- `sync:posts` 也自动跳过 `_` 开头的文件

**优点**：Git 完整版本历史、可多人 PR review、离线可写、Typora/Obsidian 等本地编辑器

**缺点**：流程长、需要等待 CI、前台 frontmatter 写错可能导致意外发布

**常用命令**：

```bash
# 手动同步到远程 D1（预览模式）
npm run sync:posts -- --dry-run

# 手动同步到远程 D1（实际执行）
npm run sync:posts

# 同步到本地 D1（开发环境）
npm run sync:posts:local
```

---

## 方式二：管理后台 Web UI

**适合**：快速发布/编辑、内容运营、非技术用户、临时修改

```
┌───────────────────────────────────────────────────────────────────┐
│  ① 浏览器打开 /admin → 登录                                      │
├───────────────────────────────────────────────────────────────────┤
│  ② 文章列表 → 新建 / 编辑文章                                    │
│     └─ 网页表单填写 title、content、status、tags、category         │
├───────────────────────────────────────────────────────────────────┤
│  ③ 点击「保存」→ 直接写入 D1                                     │
│     ├─ status = published → 立即发布                              │
│     ├─ status = draft → 存为草稿                                  │
│     └─ status = scheduled → 定时发布                              │
├───────────────────────────────────────────────────────────────────┤
│  ④ 自动触发 deploy hook → GitHub Actions → 重新部署站点          │
│     └─ 约 1-2 分钟后站点更新                                      │
└───────────────────────────────────────────────────────────────────┘
```

**优点**：零命令行操作、所见即所得、支持定时发布、支持封面图上传

**缺点**：不进 Git 版本控制、依赖网络、无法离线使用

> ⚠️ **注意**：后台发文后，本地 `.md` 文件不会自动更新。如果需要把文章纳入 Git 管理，请运行 `npm run export:posts` 将 D1 数据同步回本地文件。

---

## 方式三：MCP 服务（AI/API 发文）

**适合**：AI 辅助写作、自动化流水线、批量发文、程序化操作

```
┌───────────────────────────────────────────────────────────────────┐
│  ① 调用 MCP 端点 /api/mcp                                        │
│     ├─ 通过 AI 助手（如 Claude Desktop）调用                      │
│     └─ 通过 HTTP 客户端直接调用                                   │
├───────────────────────────────────────────────────────────────────┤
│  ② 认证：Authorization: Bearer {MCP_BEARER_TOKEN}                 │
├───────────────────────────────────────────────────────────────────┤
│  ③ 调用 create_post 工具                                         │
│     参数：title, content, authorName, status, tags, category      │
│     └─ 直接写入 D1                                               │
├───────────────────────────────────────────────────────────────────┤
│  ④ 如果是 published 状态 → 自动触发 deploy hook → 重新部署      │
└───────────────────────────────────────────────────────────────────┘
```

**MCP `create_post` 工具参数**：

```json
{
  "title": "文章标题（必填）",
  "content": "Markdown 正文（必填）",
  "authorName": "作者（默认 Admin）",
  "status": "published | draft（默认 published）",
  "slug": "自定义 slug（留空自动生成）",
  "category": "分类名（不存在则自动创建）",
  "tags": ["标签1", "标签2"],
  "metaTitle": "SEO 标题",
  "metaDescription": "SEO 描述"
}
```

**直接通过 HTTP 调用的示例**：

```bash
curl -X POST https://你的域名/api/mcp \
  -H "Authorization: Bearer 你的MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "create_post",
      "arguments": {
        "title": "MCP 测试文章",
        "content": "这是通过 MCP 发布的文章。",
        "status": "published"
      }
    }
  }'
```

**优点**：零延迟、AI 原生集成、可脚本化批量操作、不依赖 Git

**缺点**：不进 Git 版本控制、需要网络和 Token、没有 Review 机制

---

## 三种方式对比速查表

| 维度 | 本地 .md 文件 | 后台 Web UI | MCP 服务 |
|------|:--:|:--:|:--:|
| **写入目标** | 文件 → sync → D1 | 直接写 D1 | 直接写 D1 |
| **Git 版本控制** | ✅ 完整历史 | ❌ | ❌ |
| **离线可用** | ✅ Typora/Obsidian | ❌ 需网络 | ❌ 需网络 |
| **发布延迟** | ⏳ CI 3-5 分钟 | ⏳ 1-2 分钟 | ⏳ 1-2 分钟 |
| **AI 辅助** | ⚠️ 手动粘贴 | ❌ | ✅ 原生集成 |
| **定时发布** | ❌ | ✅ 支持 | ❌ |
| **封面图上传** | ❌ 手动填 key | ✅ 可视化上传 | ⚠️ 需预上传 |
| **批量操作** | ✅ 脚本灵活处理 | ⚠️ 逐个编辑 | ✅ 可编程批量 |
| **回滚** | ✅ `git revert` | ❌ 无 git | ❌ 无 git |
| **团队协作** | ✅ PR review | ❌ | ❌ |

---

## 推荐使用场景

| 场景 | 推荐方式 |
|:--|:--|
| 深度长文、系列文章 | **本地 .md 文件** → 写作+review → push |
| 快速发布、临时修改 | **后台 Web UI** |
| AI 写作、批量发文 | **MCP 服务** |
| 需要 Git 备份的 MCP 发文 | **MCP → 然后 `npm run export:posts` → git commit** |
| 开发环境测试 | `sync:posts:local` 配合本地 D1 |

---

## 配套脚本一览

| 命令 | 方向 | 说明 |
|:--|:--:|:--|
| `npm run sync:posts` | 文件 → D1 | 将仓库 .md 同步到远程 D1 |
| `npm run sync:posts:local` | 文件 → D1 | 同步到本地 D1（开发） |
| `npm run export:posts` | D1 → 文件 | 将远程 D1 文章导出为 .md |
| `npm run export:posts:local` | D1 → 文件 | 从本地 D1 导出 |
| `npm run deploy` | 全流程 | 迁移 + sync + 构建 + 部署 |
