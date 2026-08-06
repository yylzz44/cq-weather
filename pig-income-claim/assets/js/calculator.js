export const AGREED_WEIGHT_KG = 120;
export const MAX_INCOME_CLAIM_PER_PIG = 600;

const DAY_MS = 86_400_000;
const FLOATING_TOLERANCE = 1e-12;

/** 仅修正二进制浮点造成的临界值微小偏差，不改变业务精度。 */
function normalizeCriticalValue(value) {
  if (!Number.isFinite(value)) return value;
  for (const boundary of [0, 0.5, 1, 1.5, 2, 2.5]) {
    if (Math.abs(value - boundary) <= FLOATING_TOLERANCE) return boundary;
  }
  return value;
}

/** 将 yyyy-mm-dd 解析为 UTC 日期，避免不同时区造成自然日偏移。 */
export function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date
    : null;
}

export function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

/** 生成包含起始日和结束日的全部自然日。 */
export function enumerateDates(start, end) {
  const startDate = parseIsoDate(start);
  const endDate = parseIsoDate(end);
  if (!startDate || !endDate || endDate < startDate) return [];
  const dates = [];
  for (let cursor = startDate.getTime(); cursor <= endDate.getTime(); cursor += DAY_MS) {
    dates.push(toIsoDate(new Date(cursor)));
  }
  return dates;
}

export function addDays(isoDate, days) {
  const date = parseIsoDate(isoDate);
  return date ? toIsoDate(new Date(date.getTime() + days * DAY_MS)) : null;
}

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/** 检查保单层面的日期和数量。 */
export function validatePolicy(policy) {
  const errors = [];
  const start = parseIsoDate(policy.insuranceStart);
  const end = parseIsoDate(policy.insuranceEnd);
  const insured = Number(policy.insuredCount);
  const previous = Number(policy.previousCount);

  if (!start) errors.push({ code: "POLICY_START_REQUIRED", message: "请填写有效的保险起期。" });
  if (!end) errors.push({ code: "POLICY_END_REQUIRED", message: "请填写有效的保险止期。" });
  if (start && end && end < start) {
    errors.push({ code: "POLICY_DATE_ORDER", message: "保险止期不得早于保险起期。" });
  }
  if (!Number.isInteger(insured) || insured <= 0) {
    errors.push({ code: "INSURED_COUNT", message: "保单承保数量必须为正整数。" });
  }
  if (!Number.isInteger(previous) || previous < 0) {
    errors.push({ code: "PREVIOUS_COUNT", message: "此前已经纳入赔款计算数量必须为不小于0的整数。" });
  }
  if (Number.isInteger(insured) && Number.isInteger(previous) && previous > insured) {
    errors.push({ code: "PREVIOUS_EXCEEDS_INSURED", message: "此前已经纳入赔款计算数量不得超过保单承保数量。" });
  }
  return errors;
}

/** 检查销售期日期、保险期间、前30天限制、重叠及出栏数据。 */
export function validatePeriods(policy, periods) {
  const errors = [];
  const policyStart = parseIsoDate(policy.insuranceStart);
  const policyEnd = parseIsoDate(policy.insuranceEnd);
  const validDatePeriods = [];

  for (const [index, period] of periods.entries()) {
    const label = `销售期${index + 1}`;
    const start = parseIsoDate(period.start);
    const end = parseIsoDate(period.end);
    const quantity = Number(period.quantity);
    const totalWeight = Number(period.totalWeight);

    if (!start) errors.push({ code: "PERIOD_START", periodId: period.id, message: `${label}：请填写有效的开始日期。` });
    if (!end) errors.push({ code: "PERIOD_END", periodId: period.id, message: `${label}：请填写有效的结束日期。` });
    if (start && end && end < start) {
      errors.push({ code: "PERIOD_DATE_ORDER", periodId: period.id, message: `${label}：结束日期不得早于开始日期。` });
    }
    if (start && end && end >= start) {
      validDatePeriods.push({ period, start, end, label });
      if (policyStart && start < policyStart) {
        errors.push({ code: "PERIOD_BEFORE_POLICY", periodId: period.id, message: `${label}：开始日期早于保险起期。` });
      }
      if (policyEnd && end > policyEnd) {
        errors.push({ code: "PERIOD_AFTER_POLICY", periodId: period.id, message: `${label}：结束日期晚于保险止期。` });
      }
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      errors.push({ code: "PERIOD_QUANTITY", periodId: period.id, message: `${label}：实际出栏数量必须为正整数。` });
    }
    if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
      errors.push({ code: "PERIOD_WEIGHT", periodId: period.id, message: `${label}：实际出栏总重量必须大于0。` });
    }
  }

  validDatePeriods.sort((a, b) => a.start - b.start || a.end - b.end);
  if (policyStart && validDatePeriods.length) {
    const earliestAllowed = new Date(policyStart.getTime() + 30 * DAY_MS);
    if (validDatePeriods[0].start < earliestAllowed) {
      errors.push({
        code: "FIRST_PERIOD_30_DAYS",
        periodId: validDatePeriods[0].period.id,
        message: `最早销售期的首日不得处于保险期间开始后的前30天内；本保单最早可从${toIsoDate(earliestAllowed)}开始。`,
      });
    }
  }

  for (let index = 1; index < validDatePeriods.length; index += 1) {
    const previous = validDatePeriods[index - 1];
    const current = validDatePeriods[index];
    if (current.start <= previous.end) {
      errors.push({
        code: "PERIOD_OVERLAP",
        periodId: current.period.id,
        message: `${previous.label}与${current.label}日期存在重叠。`,
      });
    }
  }
  return errors;
}

/** 按销售期覆盖的每个自然日计算均价，并完整记录缺失日。 */
export function calculateActualPrice(start, end, dailyPriceMap) {
  const dates = enumerateDates(start, end);
  const covered = [];
  const missingDates = [];
  const sources = new Map();
  let sum = 0;

  for (const date of dates) {
    const record = dailyPriceMap.get(date);
    const price = Number(record?.price);
    if (!Number.isFinite(price) || price <= 0) {
      missingDates.push(date);
      continue;
    }
    sum += price;
    covered.push({ date, price, week: record.week ?? null, sourceUrl: record.source_url ?? null });
    if (record.source_url) sources.set(record.source_url, record.source_title || "重庆市农业农村委员会周报");
  }

  return {
    totalDays: dates.length,
    coveredDays: covered.length,
    missingDays: missingDates.length,
    missingDates,
    average: covered.length ? sum / covered.length : null,
    complete: dates.length > 0 && missingDates.length === 0,
    covered,
    sources: [...sources.entries()].map(([url, title]) => ({ url, title })),
  };
}

/** 按价差边界判断六档累进赔付参数。 */
export function determineBand(priceDifference) {
  const difference = normalizeCriticalValue(Number(priceDifference));
  if (!Number.isFinite(difference) || difference <= 0) {
    return { level: 0, label: "未触发", rate: 0, deduction: 0 };
  }
  if (difference < 0.5) return { level: 1, label: "第一档", rate: 0.25, deduction: 0 };
  if (difference < 1) return { level: 2, label: "第二档", rate: 0.4, deduction: 0.075 };
  if (difference < 1.5) return { level: 3, label: "第三档", rate: 0.55, deduction: 0.225 };
  if (difference < 2) return { level: 4, label: "第四档", rate: 0.7, deduction: 0.45 };
  if (difference < 2.5) return { level: 5, label: "第五档", rate: 0.85, deduction: 0.75 };
  return { level: 6, label: "第六档", rate: 1, deduction: 1.125 };
}

/** 根据销售期出栏总重和数量计算实际平均出栏重量。 */
export function calculateAverageWeight(totalWeight, quantity) {
  const weight = Number(totalWeight);
  const count = Number(quantity);
  return Number.isFinite(weight) && Number.isFinite(count) && count > 0 ? weight / count : null;
}

/** 赔款计算重量取实际平均出栏重量与120公斤中的较小值。 */
export function calculateClaimWeight(averageWeight) {
  return Number.isFinite(averageWeight) && averageWeight > 0 ? Math.min(averageWeight, AGREED_WEIGHT_KG) : null;
}

/** 每头赔款保留完整精度，销售期总赔款最后统一保留两位小数。 */
export function calculatePerPigClaim(priceDifference, band, claimWeight, quantity) {
  if (!Number.isFinite(priceDifference) || priceDifference <= 0 || !Number.isFinite(claimWeight)) {
    return { formulaClaim: 0, finalClaim: 0, capped: false, totalClaim: 0 };
  }
  const rawFormulaClaim = (priceDifference * band.rate - band.deduction) * claimWeight;
  const formulaClaim = Math.max(0, rawFormulaClaim);
  const finalClaim = Math.min(MAX_INCOME_CLAIM_PER_PIG, formulaClaim);
  const count = Number(quantity);
  return {
    formulaClaim,
    finalClaim,
    capped: formulaClaim > MAX_INCOME_CLAIM_PER_PIG,
    totalClaim: Number.isFinite(count) && count > 0 ? roundMoney(finalClaim * count) : 0,
  };
}

export function calculatePeriod(period, target, dailyPriceMap) {
  const priceCoverage = calculateActualPrice(period.start, period.end, dailyPriceMap);
  const targetPrice = Number(target?.price);
  const actualPrice = priceCoverage.average;
  const difference = Number.isFinite(targetPrice) && Number.isFinite(actualPrice)
    ? normalizeCriticalValue(targetPrice - actualPrice)
    : null;
  const band = determineBand(difference);
  const averageWeight = calculateAverageWeight(period.totalWeight, period.quantity);
  const claimWeight = calculateClaimWeight(averageWeight);
  const claim = calculatePerPigClaim(difference, band, claimWeight, period.quantity);

  return {
    ...period,
    target,
    priceCoverage,
    actualPrice,
    priceDifference: difference,
    band,
    averageWeight,
    claimWeight,
    ...claim,
    triggered: Number.isFinite(difference) && difference > 0,
  };
}

/** 汇总多销售期，并校验承保数量和保单责任限额。 */
export function calculatePolicy(policy, periods, target, dailyPriceMap) {
  const sortedPeriods = [...periods].sort((a, b) => String(a.start).localeCompare(String(b.start)) || String(a.end).localeCompare(String(b.end)));
  const errors = [...validatePolicy(policy), ...validatePeriods(policy, sortedPeriods)];
  const insuredCount = Number(policy.insuredCount);
  const previousCount = Number(policy.previousCount);
  const currentCount = sortedPeriods.reduce((sum, period) => sum + (Number.isInteger(Number(period.quantity)) ? Number(period.quantity) : 0), 0);
  const cumulativeCount = previousCount + currentCount;

  if (Number.isInteger(insuredCount) && cumulativeCount > insuredCount) {
    errors.push({ code: "COUNT_LIMIT", message: "累计纳入收入责任赔款计算的育肥猪数量已超过保单承保数量。" });
  }
  if (!Number.isFinite(Number(target?.price)) || Number(target.price) <= 0) {
    errors.push({ code: "TARGET_PRICE", message: "目标价格必须大于0元/公斤。" });
  }

  const results = sortedPeriods.map((period) => calculatePeriod(period, target, dailyPriceMap));
  const incompletePeriods = results.filter((result) => !result.priceCoverage.complete);
  const currentClaims = roundMoney(results.reduce((sum, result) => sum + result.totalClaim, 0));
  const liabilityLimit = Number.isInteger(insuredCount) && insuredCount > 0 ? insuredCount * MAX_INCOME_CLAIM_PER_PIG : 0;
  const remainingCount = Number.isInteger(insuredCount) ? Math.max(0, insuredCount - cumulativeCount) : 0;
  const theoreticalRemainingLiability = remainingCount * MAX_INCOME_CLAIM_PER_PIG;

  return {
    sortedPeriods,
    results,
    errors,
    valid: errors.length === 0 && incompletePeriods.length === 0,
    incompletePeriods,
    summary: {
      insuredCount,
      previousCount,
      currentCount,
      cumulativeCount,
      remainingCount,
      currentClaims,
      liabilityLimit,
      theoreticalRemainingLiability,
    },
  };
}
