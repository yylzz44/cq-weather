/** 写入打印时间并调用浏览器打印；用户可在打印窗口选择“另存为PDF”。 */
export function printCalculation() {
  const printedAt = document.querySelector("[data-printed-at]");
  if (printedAt) {
    printedAt.textContent = new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "long",
      timeStyle: "medium",
      hour12: false,
    }).format(new Date());
  }
  window.print();
}
