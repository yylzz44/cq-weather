# 气象预警模块

- `../index.html`：保留原首页地址，仅承担页面结构及资源加载。
- `assets/css/style.css`：从原页面原样提取的样式。
- `assets/js/app.js`：从原页面原样提取的脚本，包含地图、原有内置备用数据和展示逻辑。
- `scripts/update_data.py`：官方数据抓取程序。
- `../data.json`：保留原公开数据地址；浏览器仍从首页相对路径加载它。
- `../update_data.py`：旧命令兼容入口。

仓库根目录运行 `python weather/scripts/update_data.py` 或旧命令 `python update_data.py` 均写入仓库根目录的 `data.json`。本次只调整文件组织及输出路径定位，不改变数据源、抓取规则、定时时间或加入失败重试。

样式和浏览器脚本后续修改时，应同步更新首页资源 URL 中的版本参数，避免旧缓存。
