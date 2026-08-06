const DATA_PATHS = {
  targets: "./data/target-prices.json",
  daily: "./data/pig-daily-prices.json",
  weekly: "./data/pig-weekly-prices.json",
};

async function readJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`读取数据失败：${path}（${response.status}）`);
  return response.json();
}

/** 一次读取本地目标价格、周报价格和每日映射价格。 */
export async function loadLocalData() {
  const [targets, daily, weekly] = await Promise.all([
    readJson(DATA_PATHS.targets),
    readJson(DATA_PATHS.daily),
    readJson(DATA_PATHS.weekly),
  ]);
  return {
    targets,
    daily,
    weekly,
    dailyMap: new Map(daily.records.map((record) => [record.date, record])),
  };
}

export function findTargetPrice(targetData, month) {
  return targetData.records.find((record) => record.month === month) ?? null;
}
