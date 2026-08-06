import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addDays,
  calculateActualPrice,
  calculateAverageWeight,
  calculateClaimWeight,
  calculatePerPigClaim,
  calculatePeriod,
  calculatePolicy,
  determineBand,
  enumerateDates,
  roundMoney,
  validatePeriods,
} from "../assets/js/calculator.js";
import { findTargetPrice } from "../assets/js/data-loader.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function priceMap(start, end, priceOrFunction) {
  return new Map(enumerateDates(start, end).map((date, index) => [date, {
    date,
    week: 1 + Math.floor(index / 7),
    price: typeof priceOrFunction === "function" ? priceOrFunction(date, index) : priceOrFunction,
    source_url: `https://example.test/week-${1 + Math.floor(index / 7)}`,
    source_title: "测试周报",
  }]));
}

const target = { month: "2026-08", displayMonth: "2026年8月", price: 12.84, displayPrecision: 2, mode: "自动读取", sourceName: "重庆市保险行业协会" };
const basePeriod = { id: "p1", start: "2026-07-01", end: "2026-07-31", quantity: 10, totalWeight: 1200 };
const basePolicy = { insuranceStart: "2026-01-01", insuranceEnd: "2026-12-31", insuredCount: 100, previousCount: 0 };

test("01 实际价格高于目标价格时赔款为0", () => {
  const result = calculatePeriod(basePeriod, target, priceMap(basePeriod.start, basePeriod.end, 13));
  assert.equal(result.triggered, false);
  assert.equal(result.totalClaim, 0);
});

test("02 实际价格等于目标价格时赔款为0", () => {
  const result = calculatePeriod(basePeriod, target, priceMap(basePeriod.start, basePeriod.end, 12.84));
  assert.equal(result.priceDifference, 0);
  assert.equal(result.finalClaim, 0);
});

test("03 实际价格低于目标价格时触发责任", () => {
  const result = calculatePeriod(basePeriod, target, priceMap(basePeriod.start, basePeriod.end, 12));
  assert.equal(result.triggered, true);
  assert.ok(result.finalClaim > 0);
});

test("04 价差0和0.499999边界正确", () => {
  assert.equal(determineBand(0).level, 0);
  assert.equal(determineBand(0.499999).level, 1);
});
test("05 价差0.5和0.999999进入第二档", () => {
  assert.equal(determineBand(0.5).level, 2);
  assert.equal(determineBand(0.999999).level, 2);
});
test("06 价差1和1.499999进入第三档", () => {
  assert.equal(determineBand(1).level, 3);
  assert.equal(determineBand(1.499999).level, 3);
});
test("07 价差1.5和1.999999进入第四档", () => {
  assert.equal(determineBand(1.5).level, 4);
  assert.equal(determineBand(1.999999).level, 4);
});
test("08 价差2和2.499999进入第五档", () => {
  assert.equal(determineBand(2).level, 5);
  assert.equal(determineBand(2.499999).level, 5);
});
test("09 价差2.5进入第六档", () => assert.equal(determineBand(2.5).level, 6));

test("10 实际平均重量小于120时使用实际平均重量", () => {
  assert.equal(calculateAverageWeight(1100, 10), 110);
  assert.equal(calculateClaimWeight(110), 110);
});

test("11 实际平均重量等于120时使用120", () => assert.equal(calculateClaimWeight(calculateAverageWeight(1200, 10)), 120));
test("12 实际平均重量大于120时封顶使用120", () => assert.equal(calculateClaimWeight(calculateAverageWeight(1350, 10)), 120));

test("13 每头公式赔款小于600时不触发封顶", () => {
  const claim = calculatePerPigClaim(1, determineBand(1), 120, 1);
  assert.ok(claim.formulaClaim < 600);
  assert.equal(claim.capped, false);
});

test("14 每头公式赔款正好600时不额外缩减", () => {
  const claim = calculatePerPigClaim(6.125, determineBand(6.125), 120, 1);
  assert.equal(claim.formulaClaim, 600);
  assert.equal(claim.finalClaim, 600);
});

test("15 每头公式赔款超过600时按600封顶", () => {
  const claim = calculatePerPigClaim(7, determineBand(7), 120, 1);
  assert.ok(claim.formulaClaim > 600);
  assert.equal(claim.finalClaim, 600);
  assert.equal(claim.capped, true);
});

test("16 自动目标价格模式可从本地库读取", () => {
  const payload = JSON.parse(fs.readFileSync(path.join(root, "data/target-prices.json"), "utf8"));
  const record = findTargetPrice(payload, "2026-08");
  assert.equal(record.target_price, 12.84);
  assert.equal(record.display_precision, 2);
});

test("17 手动目标价格参与当前计算", () => {
  const manual = { ...target, price: 13.2, mode: "手动录入" };
  const result = calculatePeriod(basePeriod, manual, priceMap(basePeriod.start, basePeriod.end, 12));
  assert.equal(result.target.mode, "手动录入");
  assert.ok(Math.abs(result.priceDifference - 1.2) < 1e-12);
});

test("18 销售期跨周时按每个自然日计算", () => {
  const map = priceMap("2026-07-06", "2026-07-19", (_date, index) => index < 7 ? 10 : 12);
  assert.equal(calculateActualPrice("2026-07-06", "2026-07-19", map).average, 11);
});

test("19 销售期跨月时包含两个月日期", () => {
  const dates = enumerateDates("2026-07-30", "2026-08-02");
  assert.deepEqual(dates, ["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02"]);
});

test("20 非完整自然月销售期不被禁止", () => {
  const periods = [{ ...basePeriod, start: "2026-11-15", end: "2026-12-14" }];
  assert.equal(validatePeriods(basePolicy, periods).length, 0);
});

test("21 销售期开始日和结束日均计入", () => assert.equal(enumerateDates("2026-11-15", "2026-12-15").length, 31));

test("22 任一自然日缺失价格即标记不完整", () => {
  const map = priceMap("2026-07-01", "2026-07-03", 12);
  map.delete("2026-07-02");
  const result = calculateActualPrice("2026-07-01", "2026-07-03", map);
  assert.equal(result.complete, false);
  assert.deepEqual(result.missingDates, ["2026-07-02"]);
});

test("23 多个销售期正常汇总", () => {
  const periods = [
    { id: "a", start: "2026-07-01", end: "2026-07-03", quantity: 2, totalWeight: 240 },
    { id: "b", start: "2026-07-10", end: "2026-07-12", quantity: 3, totalWeight: 360 },
  ];
  const map = priceMap("2026-07-01", "2026-07-12", 12);
  const result = calculatePolicy(basePolicy, periods, target, map);
  assert.equal(result.summary.currentCount, 5);
  assert.equal(result.summary.currentClaims, roundMoney(result.results[0].totalClaim + result.results[1].totalClaim));
});

test("24 多个销售期日期重叠时报错", () => {
  const periods = [
    { id: "a", start: "2026-07-01", end: "2026-07-10", quantity: 2, totalWeight: 240 },
    { id: "b", start: "2026-07-10", end: "2026-07-15", quantity: 2, totalWeight: 240 },
  ];
  assert.ok(validatePeriods(basePolicy, periods).some((error) => error.code === "PERIOD_OVERLAP"));
});

test("25 销售期超出保险期间时报错", () => {
  const periods = [{ ...basePeriod, start: "2026-12-15", end: "2027-01-05" }];
  assert.ok(validatePeriods(basePolicy, periods).some((error) => error.code === "PERIOD_AFTER_POLICY"));
});

test("26 最早销售期首日处于保险起期前30天内时报错", () => {
  const periods = [{ ...basePeriod, start: "2026-01-30", end: "2026-02-05" }];
  assert.ok(validatePeriods(basePolicy, periods).some((error) => error.code === "FIRST_PERIOD_30_DAYS"));
  assert.equal(addDays(basePolicy.insuranceStart, 30), "2026-01-31");
});

test("27 累计出栏数量超过承保数量时报错", () => {
  const policy = { ...basePolicy, insuredCount: 10, previousCount: 6 };
  const periods = [{ ...basePeriod, quantity: 5 }];
  const result = calculatePolicy(policy, periods, target, priceMap(basePeriod.start, basePeriod.end, 12));
  assert.ok(result.errors.some((error) => error.code === "COUNT_LIMIT"));
});

test("28 保单累计赔款达到责任限额时不突破限额", () => {
  const policy = { ...basePolicy, insuredCount: 10 };
  const period = { ...basePeriod, quantity: 10, totalWeight: 1200 };
  const result = calculatePolicy(policy, [period], { ...target, price: 20 }, priceMap(period.start, period.end, 10));
  assert.equal(result.summary.currentClaims, 6000);
  assert.equal(result.summary.liabilityLimit, 6000);
  assert.equal(result.summary.theoreticalRemainingLiability, 0);
});

test("29 每头赔款保留完整精度后再乘数量", () => {
  const difference = 0.50321;
  const quantity = 37;
  const claim = calculatePerPigClaim(difference, determineBand(difference), 117.37, quantity);
  const wrong = roundMoney(roundMoney(claim.finalClaim) * quantity);
  const correct = roundMoney(claim.finalClaim * quantity);
  assert.equal(claim.totalClaim, correct);
  assert.notEqual(correct, wrong);
});

test("30 销售期总赔款最终保留两位小数", () => {
  const claim = calculatePerPigClaim(0.50321, determineBand(0.50321), 117.37, 37);
  assert.equal(Number(claim.totalClaim.toFixed(2)), claim.totalClaim);
});

test("31 手动录入目标价格不修改公共目标价格库", () => {
  const file = path.join(root, "data/target-prices.json");
  const before = fs.readFileSync(file, "utf8");
  calculatePeriod(basePeriod, { ...target, price: 13.1, mode: "手动录入" }, priceMap(basePeriod.start, basePeriod.end, 12));
  const after = fs.readFileSync(file, "utf8");
  assert.equal(after, before);
});

test("32 页面提供新增、复制、清空、删除、重置且不持久化业务录入", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "assets/js/app.js"), "utf8");
  for (const token of ["add-period", "data-action=\"copy\"", "data-action=\"clear\"", "data-action=\"delete\"", "reset-all"]) {
    assert.ok(html.includes(token));
  }
  assert.equal(/localStorage|sessionStorage/.test(app), false);
});
