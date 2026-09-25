# 当前部署与维护说明

本工具已部署在 `yylzz44/cq-weather` 仓库的 `pig-income-claim/` 子目录，访问路径为 `/pig-income-claim/`。与气象主页共用 GitHub Pages 发布流程，但页面、数据、测算逻辑独立。

## 文件与入口

- `index.html`：工具入口。
- `assets/`：样式、数据加载及赔款计算程序。
- `data/`：目标价格、周报价格、逐日价格。
- `scripts/`：价格采集、网络诊断、逐日价格生成。
- `tests/`：现有测算与价格脚本测试。
- `samples/`、`screenshots/`：样例与历史截图，不代表实时结果。

页面使用相对路径，保留本目录名称及结构即可继续使用现有网址。气象平台不添加通往本工具的入口；此次结构整理不改变访问权限。

## 自动任务

实际工作流位于仓库根目录 `.github/workflows/update-pig-prices.yml`，显示名称为“育肥猪测算｜更新价格数据”。不要在工具子目录再创建工作流副本。

采集与数据生成步骤的工作目录为 `pig-income-claim`，任务仅提交 `pig-income-claim/data/`。与气象任务共用提交并发组，减少自动提交冲突；数据源抓取失败仍需单独排查。

## 修改后验证

在仓库根目录执行现有测试：

```sh
node --test pig-income-claim/tests/calculator.test.js
python -m unittest discover -s pig-income-claim/tests -p 'test_price_scripts.py' -v
```

发布后检查原地址、价格加载、测算和打印功能。修改价格请参照 `DATA_MAINTENANCE.md`，不要为目录调整改变计算口径。

回退方式及整理前存档见仓库根目录 `README.md`。
