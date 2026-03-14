# 微信公众号文章爬取

微信公众号文章搜索与爬取工具。通过微信公众平台 API 检索公众号和文章。

## 触发词

wechat-article-spider, wechat-spider, 微信公众号搜索, 公众号检索, 微信文章搜索, 微信文章爬取

## 安装

```bash
# 从本地目录安装
pip install ./wechat-article-spider

# 或从 Git 仓库安装
pip install git+https://github.com/qbu11/wechat-article-spider.git
```

## 前置条件

- Python >= 3.8
- Chrome 浏览器（登录时需要）
- 需要先登录微信公众平台（扫码登录，缓存有效期约4天）

## 使用流程

### 1. 检查登录状态

```bash
wechat-spider status
```

返回 JSON 格式的登录状态。如果 `success: false`，需要先登录。

### 2. 登录（需要用户扫码）

```bash
wechat-spider login
```

会弹出 Chrome 浏览器窗口，用户需要用微信扫码。登录成功后凭证自动缓存。

**重要**: 登录需要用户交互（扫码），必须提示用户操作。

### 3. 搜索公众号

```bash
wechat-spider search "公众号名称"
```

返回匹配的公众号列表，包含 `wpub_name`（名称）和 `wpub_fakid`（ID）。

### 4. 爬取单个公众号文章

```bash
wechat-spider scrape "公众号名称" --pages 5 --days 30 --content
```

参数说明:
- `--pages N`: 最大页数，每页5篇（默认5）
- `--days N`: 时间范围，最近N天（默认30）
- `--content`: 是否获取文章正文（不加则只获取标题和链接）
- `--interval N`: 请求间隔秒数（默认5，建议不低于3）
- `--output FILE`: 输出CSV文件路径

### 5. 批量爬取多个公众号

```bash
wechat-spider batch "公众号1,公众号2,公众号3" --pages 3 --days 7 --content
```

参数说明:
- 公众号名称用逗号分隔
- `--output-dir DIR`: 输出目录（默认 ~/WeChatSpider）
- 其他参数同 scrape

## 输出格式

所有命令输出 JSON，结构统一:

```json
{
  "success": true,
  "data": {
    "account": "公众号名称",
    "total": 10,
    "articles": [
      {
        "title": "文章标题",
        "publish_time": "2026-03-01 10:00:00",
        "link": "https://mp.weixin.qq.com/s/...",
        "content": "文章正文（Markdown格式，仅 --content 时）"
      }
    ]
  }
}
```

## 注意事项

1. **登录有效期**: 微信 token 约4-7天过期，过期后需重新扫码
2. **频率限制**: 请求间隔建议 >=3秒，避免被微信限制
3. **合法使用**: 仅用于学习和研究目的
4. **正文获取**: 加 `--content` 会显著增加耗时，按需使用
5. **日志输出**: 日志输出到 stderr，JSON 结果输出到 stdout

## 典型场景

### 场景A: 快速查看某公众号最近文章标题

```bash
wechat-spider scrape "人民日报" --pages 2 --days 7
```

### 场景B: 获取某公众号文章全文用于分析

```bash
wechat-spider scrape "某公众号" --pages 10 --days 90 --content --output results.csv
```

### 场景C: 对比多个公众号的内容

```bash
wechat-spider batch "公众号A,公众号B,公众号C" --pages 5 --days 30 --content
```
