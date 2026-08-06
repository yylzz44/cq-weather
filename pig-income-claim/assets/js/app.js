import {
  AGREED_WEIGHT_KG,
  calculateAverageWeight,
  calculatePolicy,
  enumerateDates,
} from "./calculator.js";
import { findTargetPrice, loadLocalData } from "./data-loader.js";
import { printCalculation } from "./print.js";

const dom = {
  dataLoadAlert: document.querySelector("#data-load-alert"),
  insuranceStart: document.querySelector("#insurance-start"),
  insuranceEnd: document.querySelector("#insurance-end"),
  insuredCount: document.querySelector("#insured-count"),
  previousCount: document.querySelector("#previous-count"),
  targetMonth: document.querySelector("#target-month"),
  autoPanel: document.querySelector("#auto-target-panel"),
  manualPanel: document.querySelector("#manual-target-panel"),
  autoPrice: document.querySelector("#auto-target-price"),
  autoSource: document.querySelector("#auto-target-source"),
  autoDate: document.querySelector("#auto-target-date"),
  autoStatus: document.querySelector("#auto-target-status"),
  autoLink: document.querySelector("#auto-target-link"),
  manualMonth: document.querySelector("#manual-target-month"),
  manualPrice: document.querySelector("#manual-target-price"),
  manualDate: document.querySelector("#manual-target-date"),
  manualNote: document.querySelector("#manual-target-note"),
  periodList: document.querySelector("#period-list"),
  periodTemplate: document.querySelector("#period-template"),
  addPeriod: document.querySelector("#add-period"),
  calculate: document.querySelector("#calculate"),
  reset: document.querySelector("#reset-all"),
  resultSection: document.querySelector("#result-section"),
  resultStatus: document.querySelector("#result-status"),
  validationMessages: document.querySelector("#validation-messages"),
  periodResults: document.querySelector("#period-results"),
  summaryTableBody: document.querySelector("#summary-table-body"),
  summaryCards: document.querySelector("#summary-cards"),
  summaryCurrentClaims: document.querySelector("#summary-current-claims"),
  manualPrintWarning: document.querySelector("#manual-print-warning"),
  print: document.querySelector("#print-result"),
};

let localData = null;
let periodCounter = 0;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value, digits = 2, fallback = "—") {
  if (!Number.isFinite(Number(value))) return fallback;
  return Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatCount(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 0 }) : "—";
}

function displayMonth(month) {
  const match = String(month ?? "").match(/^(\d{4})-(\d{2})$/);
  return match ? `${match[1]}年${Number(match[2])}月` : "—";
}

function currentTargetMode() {
  return document.querySelector('input[name="target-mode"]:checked')?.value ?? "auto";
}

function populateTargetMonths() {
  const records = localData?.targets?.records ?? [];
  dom.targetMonth.innerHTML = records.length
    ? records.map((record) => `<option value="${escapeHtml(record.month)}">${escapeHtml(record.display_month || displayMonth(record.month))}</option>`).join("")
    : '<option value="">暂无本地目标价格</option>';
  if (records.some((record) => record.month === "2026-08")) dom.targetMonth.value = "2026-08";
  renderAutoTarget();
}

function renderAutoTarget() {
  const record = findTargetPrice(localData?.targets ?? { records: [] }, dom.targetMonth.value);
  dom.autoPrice.textContent = record ? formatNumber(record.target_price, record.display_precision ?? 2) : "—";
  dom.autoSource.textContent = record?.source_name ?? "—";
  dom.autoDate.textContent = record?.announcement_date ?? "尚未录入";
  dom.autoStatus.textContent = record?.status ?? "未找到本地数据";
  if (record?.source_url) {
    dom.autoLink.href = record.source_url;
    dom.autoLink.hidden = false;
  } else {
    dom.autoLink.removeAttribute("href");
    dom.autoLink.hidden = true;
  }
}

function toggleTargetMode() {
  const manual = currentTargetMode() === "manual";
  dom.autoPanel.hidden = manual;
  dom.manualPanel.hidden = !manual;
}

function periodField(card, name) {
  return card.querySelector(`[data-field="${name}"]`);
}

function createPeriod(values = {}) {
  periodCounter += 1;
  const fragment = dom.periodTemplate.content.cloneNode(true);
  const card = fragment.querySelector("[data-period-card]");
  card.dataset.periodId = values.id || `period-${periodCounter}`;
  for (const name of ["start", "end", "quantity", "totalWeight"]) {
    periodField(card, name).value = values[name] ?? "";
  }

  card.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => updatePeriodInline(card));
    input.addEventListener("change", () => {
      updatePeriodInline(card);
      if (input.dataset.field === "start") sortPeriodCards();
    });
  });
  card.querySelector("[data-action='copy']").addEventListener("click", () => {
    const original = readPeriodCard(card);
    createPeriod({ ...original, id: undefined });
    sortPeriodCards();
  });
  card.querySelector("[data-action='clear']").addEventListener("click", () => {
    card.querySelectorAll("input").forEach((input) => { input.value = ""; });
    card.classList.remove("has-error");
    updatePeriodInline(card);
  });
  card.querySelector("[data-action='delete']").addEventListener("click", () => {
    card.remove();
    if (!dom.periodList.children.length) createPeriod();
    updatePeriodTitles();
  });

  dom.periodList.append(card);
  updatePeriodInline(card);
  updatePeriodTitles();
  return card;
}

function readPeriodCard(card) {
  return {
    id: card.dataset.periodId,
    start: periodField(card, "start").value,
    end: periodField(card, "end").value,
    quantity: periodField(card, "quantity").value,
    totalWeight: periodField(card, "totalWeight").value,
  };
}

function updatePeriodInline(card) {
  const period = readPeriodCard(card);
  const days = enumerateDates(period.start, period.end).length;
  const average = calculateAverageWeight(Number(period.totalWeight), Number(period.quantity));
  card.querySelector("[data-days]").textContent = days ? `${days}天` : "—";
  card.querySelector("[data-average-weight]").textContent = Number.isFinite(average) ? `${formatNumber(average, 2)}公斤/头` : "—";
}

function updatePeriodTitles() {
  [...dom.periodList.children].forEach((card, index) => {
    card.querySelector("[data-period-title]").textContent = `约定销售期 ${index + 1}`;
  });
}

function sortPeriodCards() {
  const cards = [...dom.periodList.children];
  cards.sort((a, b) => {
    const aStart = periodField(a, "start").value || "9999-99-99";
    const bStart = periodField(b, "start").value || "9999-99-99";
    return aStart.localeCompare(bStart);
  });
  cards.forEach((card) => dom.periodList.append(card));
  updatePeriodTitles();
}

function readPolicy() {
  return {
    insuranceStart: dom.insuranceStart.value,
    insuranceEnd: dom.insuranceEnd.value,
    insuredCount: dom.insuredCount.value,
    previousCount: dom.previousCount.value,
  };
}

function readTarget() {
  if (currentTargetMode() === "manual") {
    return {
      month: dom.manualMonth.value,
      displayMonth: displayMonth(dom.manualMonth.value),
      price: Number(dom.manualPrice.value),
      displayPrecision: Math.max(0, (String(dom.manualPrice.value).split(".")[1] || "").length),
      sourceName: "用户手动录入",
      sourceUrl: /^https?:\/\//i.test(dom.manualNote.value.trim()) ? dom.manualNote.value.trim() : null,
      announcementDate: dom.manualDate.value || null,
      note: dom.manualNote.value.trim() || null,
      mode: "手动录入",
      status: "需根据保单特别约定及行业协会正式公告复核",
    };
  }
  const record = findTargetPrice(localData?.targets ?? { records: [] }, dom.targetMonth.value);
  return {
    month: record?.month ?? dom.targetMonth.value,
    displayMonth: record?.display_month ?? displayMonth(dom.targetMonth.value),
    price: Number(record?.target_price),
    displayPrecision: record?.display_precision ?? 2,
    sourceName: record?.source_name ?? "重庆市保险行业协会",
    sourceUrl: record?.source_url ?? null,
    announcementDate: record?.announcement_date ?? null,
    note: record?.note ?? null,
    mode: "自动读取",
    status: record?.status ?? "未找到本地数据",
  };
}

function clearValidationMarks() {
  document.querySelectorAll('[aria-invalid="true"]').forEach((input) => input.removeAttribute("aria-invalid"));
  document.querySelectorAll(".period-card.has-error").forEach((card) => card.classList.remove("has-error"));
}

function markValidationErrors(errors) {
  const policyFieldMap = {
    POLICY_START_REQUIRED: dom.insuranceStart,
    POLICY_END_REQUIRED: dom.insuranceEnd,
    POLICY_DATE_ORDER: dom.insuranceEnd,
    INSURED_COUNT: dom.insuredCount,
    PREVIOUS_COUNT: dom.previousCount,
    PREVIOUS_EXCEEDS_INSURED: dom.previousCount,
  };
  for (const error of errors) {
    policyFieldMap[error.code]?.setAttribute("aria-invalid", "true");
    if (error.periodId) dom.periodList.querySelector(`[data-period-id="${error.periodId}"]`)?.classList.add("has-error");
  }
  if (errors.some((error) => error.code === "TARGET_PRICE")) {
    (currentTargetMode() === "manual" ? dom.manualPrice : dom.targetMonth).setAttribute("aria-invalid", "true");
  }
}

function renderStatus(calculation) {
  dom.resultStatus.className = "result-status";
  if (calculation.errors.length) {
    dom.resultStatus.classList.add("invalid");
    dom.resultStatus.innerHTML = `<span>当前录入存在${calculation.errors.length}项校验问题，不能标记为正式有效测算结果。</span><strong>需修正</strong>`;
  } else if (calculation.incompletePeriods.length) {
    dom.resultStatus.classList.add("partial");
    dom.resultStatus.innerHTML = `<span>部分销售期价格数据不完整，当前结果仅供参考，不作为最终理赔依据。</span><strong>数据待更新</strong>`;
  } else {
    dom.resultStatus.classList.add("valid");
    dom.resultStatus.innerHTML = `<span>日期、价格数据、出栏数量和责任限额校验均通过。</span><strong>测算条件完整</strong>`;
  }
}

function renderValidationMessages(errors) {
  dom.validationMessages.innerHTML = errors.length
    ? `<ul class="validation-list">${errors.map((error) => `<li>${escapeHtml(error.message)}</li>`).join("")}</ul>`
    : "";
}

function targetSourceHtml(target) {
  const source = target.sourceUrl
    ? `<a href="${escapeHtml(target.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(target.sourceName)}</a>`
    : escapeHtml(target.sourceName);
  return `${source}<br><small>${escapeHtml(target.status || "")}</small>`;
}

function renderPeriodResult(result, index) {
  const coverage = result.priceCoverage;
  const targetDigits = result.target.displayPrecision ?? 2;
  const dataStatus = coverage.complete ? "价格数据完整" : `缺少${coverage.missingDays}天价格`;
  const responsibilityMessage = !coverage.complete
    ? `<div class="result-message incomplete">本销售期共${coverage.totalDays}个自然日，已取得${coverage.coveredDays}天对应价格，尚缺${coverage.missingDays}天价格，暂不能形成最终赔款测算结果。下列金额仅为基于现有数据的临时参考。</div>`
    : result.triggered
      ? '<div class="result-message triggered">约定销售期实际价格低于目标价格，已触发育肥猪养殖收入保险责任。</div>'
      : '<div class="result-message not-triggered">约定销售期实际价格未低于目标价格，本销售期未触发育肥猪养殖收入保险责任。</div>';
  const sourceList = coverage.sources.length
    ? `<ul class="source-list">${coverage.sources.map((source) => `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a></li>`).join("")}</ul>`
    : '<p class="field-help">当前销售期没有可展示的来源链接。</p>';
  const missingDates = coverage.missingDates.length
    ? `<div class="missing-dates"><strong>缺失日期</strong><code>${escapeHtml(coverage.missingDates.join("、"))}</code></div>`
    : "";

  return `
    <details class="result-card ${coverage.complete ? "" : "incomplete"}" open>
      <summary>
        <div><h3>销售期 ${index + 1}</h3><p>${escapeHtml(result.start || "—")} 至 ${escapeHtml(result.end || "—")} · ${coverage.totalDays}个自然日</p></div>
        <div class="result-kpi"><span>实际价格</span><strong>${formatNumber(result.actualPrice, 4)}</strong></div>
        <div class="result-kpi"><span>每头最终赔款</span><strong>${formatNumber(result.finalClaim, 4)}</strong></div>
        <div class="result-kpi primary"><span>销售期总赔款</span><strong>${formatNumber(result.totalClaim, 2)}元</strong></div>
      </summary>
      <div class="result-detail">
        ${responsibilityMessage}
        <dl class="detail-grid">
          <div><dt>目标价格年月</dt><dd>${escapeHtml(result.target.displayMonth)}</dd></div>
          <div><dt>目标价格</dt><dd>${formatNumber(result.target.price, targetDigits)}元/公斤</dd></div>
          <div><dt>获取方式</dt><dd>${escapeHtml(result.target.mode)}</dd></div>
          <div><dt>目标价格来源</dt><dd>${targetSourceHtml(result.target)}</dd></div>
          <div><dt>销售期开始日期</dt><dd>${escapeHtml(result.start || "—")}</dd></div>
          <div><dt>销售期结束日期</dt><dd>${escapeHtml(result.end || "—")}</dd></div>
          <div><dt>自然日天数</dt><dd>${coverage.totalDays}天</dd></div>
          <div><dt>价格数据完整性</dt><dd>${escapeHtml(dataStatus)}（覆盖${coverage.coveredDays}天）</dd></div>
          <div><dt>销售期实际价格</dt><dd>${formatNumber(result.actualPrice, 4)}元/公斤</dd></div>
          <div><dt>价差</dt><dd>${formatNumber(result.priceDifference, 4)}元/公斤</dd></div>
          <div><dt>对应价差档次</dt><dd>${escapeHtml(result.band.label)}</dd></div>
          <div><dt>累进赔付比例 / 速算扣除数</dt><dd>${formatNumber(result.band.rate * 100, 0)}% / ${formatNumber(result.band.deduction, 3)}</dd></div>
          <div><dt>实际出栏数量</dt><dd>${formatCount(result.quantity)}头</dd></div>
          <div><dt>实际出栏总重量</dt><dd>${formatNumber(result.totalWeight, 2)}公斤</dd></div>
          <div><dt>实际平均出栏重量</dt><dd>${formatNumber(result.averageWeight, 2)}公斤/头</dd></div>
          <div><dt>赔款计算重量</dt><dd>${formatNumber(result.claimWeight, 2)}公斤/头</dd></div>
          <div><dt>每头公式赔款</dt><dd>${formatNumber(result.formulaClaim, 4)}元/头</dd></div>
          <div><dt>是否触发600元封顶</dt><dd>${result.capped ? "是" : "否"}</dd></div>
          <div><dt>每头最终赔款</dt><dd>${formatNumber(result.finalClaim, 4)}元/头</dd></div>
          <div><dt>本销售期总赔款</dt><dd>${formatNumber(result.totalClaim, 2)}元</dd></div>
          <div><dt>是否触发保险责任</dt><dd>${result.triggered && coverage.complete ? "是" : result.triggered ? "暂无法最终确认" : "否"}</dd></div>
          <div><dt>是否具备完整价格数据</dt><dd>${coverage.complete ? "是" : "否"}</dd></div>
          <div class="wide"><dt>计算式</dt><dd>（${formatNumber(result.priceDifference, 6)} × ${formatNumber(result.band.rate * 100, 0)}% − ${formatNumber(result.band.deduction, 3)}）× ${formatNumber(result.claimWeight, 6)}公斤 × ${formatCount(result.quantity)}头</dd></div>
        </dl>
        ${missingDates}
        <div><strong>农委价格来源</strong>${sourceList}</div>
      </div>
    </details>`;
}

function renderSummary(calculation) {
  const incomplete = calculation.incompletePeriods.length > 0;
  dom.summaryCurrentClaims.textContent = formatNumber(calculation.summary.currentClaims, 2);
  dom.summaryCurrentClaims.previousElementSibling.textContent = incomplete ? "当前页面累计参考赔款" : "当前页面累计赔款";
  dom.summaryTableBody.innerHTML = calculation.results.map((result, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(result.start || "—")} 至 ${escapeHtml(result.end || "—")}</td>
      <td>${formatCount(result.quantity)}头</td>
      <td>${formatNumber(result.actualPrice, 4)}</td>
      <td>${formatNumber(result.priceDifference, 4)}</td>
      <td>${formatNumber(result.finalClaim, 4)}元</td>
      <td>${formatNumber(result.totalClaim, 2)}元</td>
      <td><span class="data-chip ${result.priceCoverage.complete ? "complete" : "incomplete"}">${result.priceCoverage.complete ? "完整" : `缺${result.priceCoverage.missingDays}天`}</span></td>
    </tr>`).join("");

  const cards = [
    ["保单承保数量", `${formatCount(calculation.summary.insuredCount)}头`],
    ["此前已纳入数量", `${formatCount(calculation.summary.previousCount)}头`],
    ["当前销售期出栏数量", `${formatCount(calculation.summary.currentCount)}头`],
    ["累计纳入数量", `${formatCount(calculation.summary.cumulativeCount)}头`],
    ["剩余可纳入数量", `${formatCount(calculation.summary.remainingCount)}头`, true],
    ["当前页面累计赔款", `${formatNumber(calculation.summary.currentClaims, 2)}元`, true],
    ["保单收入责任最高限额", `${formatNumber(calculation.summary.liabilityLimit, 2)}元`],
    ["理论剩余责任限额", `${formatNumber(calculation.summary.theoreticalRemainingLiability, 2)}元`, true],
  ];
  dom.summaryCards.innerHTML = cards.map(([label, value, highlight]) => `<div class="summary-card ${highlight ? "highlight" : ""}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
}

function runCalculation({ scroll = true } = {}) {
  if (!localData) return;
  sortPeriodCards();
  clearValidationMarks();
  const policy = readPolicy();
  const periods = [...dom.periodList.children].map(readPeriodCard);
  const target = readTarget();
  const calculation = calculatePolicy(policy, periods, target, localData.dailyMap);

  renderStatus(calculation);
  renderValidationMessages(calculation.errors);
  markValidationErrors(calculation.errors);
  dom.periodResults.innerHTML = calculation.results.map(renderPeriodResult).join("");
  renderSummary(calculation);
  dom.manualPrintWarning.hidden = target.mode !== "手动录入";
  dom.resultSection.hidden = false;
  if (scroll) dom.resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
  return calculation;
}

function resetAll() {
  dom.insuranceStart.value = "";
  dom.insuranceEnd.value = "";
  dom.insuredCount.value = "";
  dom.previousCount.value = "0";
  document.querySelector('input[name="target-mode"][value="auto"]').checked = true;
  dom.manualMonth.value = "2026-08";
  dom.manualPrice.value = "";
  dom.manualDate.value = "";
  dom.manualNote.value = "";
  if ([...dom.targetMonth.options].some((option) => option.value === "2026-08")) dom.targetMonth.value = "2026-08";
  dom.periodList.innerHTML = "";
  createPeriod();
  toggleTargetMode();
  renderAutoTarget();
  clearValidationMarks();
  dom.resultSection.hidden = true;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function initialize() {
  document.querySelectorAll('input[name="target-mode"]').forEach((radio) => radio.addEventListener("change", toggleTargetMode));
  dom.targetMonth.addEventListener("change", renderAutoTarget);
  dom.addPeriod.addEventListener("click", () => createPeriod());
  dom.calculate.addEventListener("click", () => runCalculation());
  dom.reset.addEventListener("click", resetAll);
  dom.print.addEventListener("click", () => {
    document.querySelectorAll(".result-card").forEach((details) => { details.open = true; });
    printCalculation();
  });
  createPeriod();
  toggleTargetMode();

  try {
    localData = await loadLocalData();
    populateTargetMonths();
  } catch (error) {
    dom.dataLoadAlert.textContent = `本地价格数据读取失败，暂不能计算：${error.message}。请通过本地静态服务器打开本页面，不要直接双击HTML文件。`;
    dom.dataLoadAlert.hidden = false;
    dom.calculate.disabled = true;
  }
}

initialize();
