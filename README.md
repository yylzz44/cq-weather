# 重庆气象预警与育肥猪测算：维护索引

本仓库托管两个用途不同、数据和业务逻辑独立的项目。气象平台面向机构，育肥猪测算工具用于个人辅助测算；页面不增加相互导航入口。

| 项目 | 页面入口 | 数据 | 程序与资源 |
| --- | --- | --- | --- |
| 气象预警 | 根目录 `index.html` | 根目录 `data.json` | `weather/` |
| 育肥猪收入赔款测算 | `pig-income-claim/index.html` | `pig-income-claim/data/` | `pig-income-claim/assets/`、`scripts/`、`tests/` |

## 公共基础设施

- `CNAME`：现有域名，不随模块整理更改。
- `.github/workflows/update.yml`：气象预警更新任务；仅提交根目录 `data.json`。
- `.github/workflows/update-pig-prices.yml`：育肥猪价格更新任务；仅提交 `pig-income-claim/data/`。
- 两任务共用 `site-data-update` 并发组，避免两个自动任务同时提交；提交前同步主分支。GitHub 同组最多保留一个运行任务和一个等待任务，更多等待任务可能被新任务替代，并非无限排队。
- 两项目仍共用 GitHub Pages 发布流程；目录隔离不代表独立部署或访问限制。

## 日常维护

气象模块见 `weather/README.md`；生猪价格维护见 `pig-income-claim/DATA_MAINTENANCE.md`。修改一个模块时，仅操作该模块文件及其对应工作流。

气象数据地址保留在根目录，以兼容既有页面和旧链接；根目录 `update_data.py` 保留为兼容运行入口。不要再在兼容入口中加入抓取逻辑。

## 验证

在仓库根目录运行：

```sh
node --test pig-income-claim/tests/calculator.test.js
python -m unittest discover -s pig-income-claim/tests -p 'test_price_scripts.py' -v
python -m py_compile update_data.py weather/scripts/update_data.py
python -m http.server 8000
```

用本地 HTTP 服务分别检查 `/` 和 `/pig-income-claim/`，核对气象更新时间、地图、区县列表及测算功能。不要为了结构验证随意运行在线抓取并覆盖现有数据。

## 2026-09-25 结构整理与回退

整理前存档分支：`backup/before-structure-20260925`。
存档提交：`b9af60d970b65b6da59f00ddbf95fd226d3eaaae`。

如需撤回本次整理，优先对本次合并提交执行 `git revert -m 1 <合并提交SHA>`，经核对后正常推送，让 Pages 重新发布。不要强制把 main 重置到存档分支，否则可能丢失此后更新的数据。此整理没有修改数据文件或生猪业务程序，撤销整理也不应覆盖随后更新的价格、气象数据。
