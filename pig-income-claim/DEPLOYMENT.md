# GitHub Pages 部署说明

本阶段不要求直接操作现有 GitHub 仓库。以下说明供后续在 Chat 区域按用户实际页面逐步部署时使用。

## 子目录部署

把整个 `pig-income-claim` 文件夹放到 `www.ciccq.cn` 对应网站的发布根目录，预期访问地址为：

```text
https://www.ciccq.cn/pig-income-claim/
```

所有网页、CSS、JavaScript 和 JSON 都使用相对路径，不依赖本地磁盘路径。

## GitHub Actions 文件位置

GitHub 只识别仓库根目录下的 `.github/workflows/`。本交付包中的工作流模板位于：

```text
pig-income-claim/.github/workflows/update-pig-prices.yml
```

正式启用时，需要把它复制或合并到仓库根目录：

```text
.github/workflows/update-pig-prices.yml
```

模板默认假定子网站仍位于仓库根目录下的 `pig-income-claim/`。如果主站实际发布目录不同，需要同步调整工作流中的 `working-directory` 和数据路径。

## 后续部署检查顺序

1. 确认主站对应的 GitHub 仓库；
2. 确认 GitHub Pages 使用的分支和发布根目录；
3. 上传完整 `pig-income-claim/` 文件夹；
4. 访问子目录地址并检查页面和 JSON 是否正常加载；
5. 把工作流模板复制到仓库根目录 `.github/workflows/`；
6. 在仓库设置中把 Actions 的 Workflow permissions 设为可写入内容；
7. 手动运行一次“更新育肥猪待宰活猪价格”；
8. 检查运行日志、两个 JSON 是否变化、自动提交是否成功；
9. 再检查手机、电脑、打印为PDF以及正式域名路径。

## 上线后必须复核

- `2026年8月12.84元/公斤`对应的行业协会正式公告日期和链接；
- 主站是否使用额外的路径前缀或缓存；
- GitHub Actions 是否能正常安装中文 OCR；
- 农委页面改版后图片识别是否仍能通过环比交叉校验；
- 浏览器打印页眉页脚是否需要由使用人员手动关闭。
