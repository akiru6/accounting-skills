/**
 * invoice-extraction 校验脚本
 *
 * 校验 LLM 提取的 InvoiceData JSON 的：
 *   1. 必填字段完整性
 *   2. 金额格式合规性
 *   3. 发票内部算术一致性
 *
 * 用法：
 *   npx tsx scripts/validate.ts <invoice.json>
 *   echo '{ ... }' | npx tsx scripts/validate.ts
 */

// ============================================================
// Types
// ============================================================

interface BuyerSeller {
  name: string;
  tax_id: string;
  address_phone: string;
  bank_account: string;
}

interface LineItem {
  name: string;
  specification: string;
  unit: string;
  quantity: string;
  unit_price: string;
  amount: string;
  tax_rate: string;
  tax_amount: string;
}

interface InvoiceTotal {
  total_amount: string;
  total_tax: string;
  amount_with_tax_words: string;
  amount_with_tax_number: string;
}

interface InvoiceData {
  invoice_type: string;
  invoice_code: string;
  invoice_number: string;
  date: string;
  check_code: string;
  buyer: BuyerSeller;
  seller: BuyerSeller;
  items: LineItem[];
  total: InvoiceTotal;
  remarks: string;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ============================================================
// Helpers
// ============================================================

/** 解析金额字符串为数字，返回 NaN 表示无效 */
function parseAmount(value: string): number {
  if (value === "") return NaN;
  const n = Number(value);
  return n;
}

/** 检查金额格式：非空时应为保留两位小数的数字字符串 */
function isValidAmountFormat(value: string): boolean {
  if (value === "") return true; // 空值由必填检查处理
  return /^\d+\.\d{2}$/.test(value);
}

/** 解析税率字符串，返回小数（如 0.13），"免税"返回 0 */
function parseTaxRate(rate: string): number | null {
  if (rate === "免税" || rate === "0%") return 0;
  const match = rate.match(/^(\d+(?:\.\d+)?)%$/);
  if (!match) return null;
  return Number(match[1]) / 100;
}

/** 浮点比较：允许 ±0.01 的舍入误差 */
function amountsEqual(a: number, b: number, tolerance = 0.015): boolean {
  return Math.abs(a - b) <= tolerance;
}

// ============================================================
// Validators
// ============================================================

function validateRequiredFields(data: InvoiceData, result: ValidationResult): void {
  // 顶级必填字段
  if (!data.invoice_type) result.errors.push("缺少 invoice_type（发票类型）");
  if (!data.invoice_number) result.errors.push("缺少 invoice_number（发票号码）");
  if (!data.date) result.errors.push("缺少 date（开票日期）");

  // 购买方
  if (!data.buyer) {
    result.errors.push("缺少 buyer（购买方信息）");
  } else {
    if (!data.buyer.name) result.errors.push("缺少 buyer.name（购买方名称）");
    if (!data.buyer.tax_id) result.warnings.push("缺少 buyer.tax_id（购买方税号）");
  }

  // 销售方
  if (!data.seller) {
    result.errors.push("缺少 seller（销售方信息）");
  } else {
    if (!data.seller.name) result.errors.push("缺少 seller.name（销售方名称）");
    if (!data.seller.tax_id) result.warnings.push("缺少 seller.tax_id（销售方税号）");
  }

  // 明细行
  if (!data.items || data.items.length === 0) {
    result.errors.push("缺少 items（明细行），至少需要一行");
  } else {
    data.items.forEach((item, i) => {
      if (!item.name) result.errors.push(`items[${i}] 缺少 name（项目名称）`);
      if (!item.amount) result.errors.push(`items[${i}] 缺少 amount（不含税金额）`);
      if (!item.tax_rate) result.errors.push(`items[${i}] 缺少 tax_rate（税率）`);
      if (!item.tax_amount && item.tax_amount !== "0.00") {
        result.errors.push(`items[${i}] 缺少 tax_amount（税额）`);
      }
    });
  }

  // 汇总
  if (!data.total) {
    result.errors.push("缺少 total（汇总信息）");
  } else {
    if (!data.total.total_amount) result.errors.push("缺少 total.total_amount（合计金额）");
    if (!data.total.total_tax && data.total.total_tax !== "0.00") {
      result.errors.push("缺少 total.total_tax（合计税额）");
    }
    if (!data.total.amount_with_tax_number) {
      result.errors.push("缺少 total.amount_with_tax_number（价税合计）");
    }
  }
}

function validateAmountFormats(data: InvoiceData, result: ValidationResult): void {
  // 明细行金额格式
  if (data.items) {
    data.items.forEach((item, i) => {
      if (item.amount && !isValidAmountFormat(item.amount)) {
        result.errors.push(`items[${i}].amount 格式错误："${item.amount}"（应为两位小数，如 "1500.00"）`);
      }
      if (item.tax_amount && !isValidAmountFormat(item.tax_amount)) {
        result.errors.push(`items[${i}].tax_amount 格式错误："${item.tax_amount}"（应为两位小数）`);
      }
      if (item.unit_price && !isValidAmountFormat(item.unit_price)) {
        result.warnings.push(`items[${i}].unit_price 格式不标准："${item.unit_price}"`);
      }
    });
  }

  // 汇总金额格式
  if (data.total) {
    if (data.total.total_amount && !isValidAmountFormat(data.total.total_amount)) {
      result.errors.push(`total.total_amount 格式错误："${data.total.total_amount}"`);
    }
    if (data.total.total_tax && !isValidAmountFormat(data.total.total_tax)) {
      result.errors.push(`total.total_tax 格式错误："${data.total.total_tax}"`);
    }
    if (data.total.amount_with_tax_number && !isValidAmountFormat(data.total.amount_with_tax_number)) {
      result.errors.push(`total.amount_with_tax_number 格式错误："${data.total.amount_with_tax_number}"`);
    }
  }
}

function validateArithmetic(data: InvoiceData, result: ValidationResult): void {
  if (!data.items || !data.total) return;

  // ---- 明细行逐行校验 ----
  data.items.forEach((item, i) => {
    // 数量 × 单价 = 金额
    const qty = parseAmount(item.quantity);
    const price = parseAmount(item.unit_price);
    const amount = parseAmount(item.amount);
    if (!isNaN(qty) && !isNaN(price) && !isNaN(amount)) {
      const expected = qty * price;
      if (!amountsEqual(expected, amount)) {
        result.errors.push(
          `items[${i}] 数量×单价 不等于 金额：${qty} × ${price} = ${expected.toFixed(2)}，实际 ${item.amount}`
        );
      }
    }

    // 金额 × 税率 = 税额
    const taxRate = parseTaxRate(item.tax_rate);
    const taxAmount = parseAmount(item.tax_amount);
    if (!isNaN(amount) && taxRate !== null && !isNaN(taxAmount)) {
      const expectedTax = amount * taxRate;
      if (!amountsEqual(expectedTax, taxAmount)) {
        result.warnings.push(
          `items[${i}] 金额×税率 不等于 税额：${amount} × ${item.tax_rate} = ${expectedTax.toFixed(2)}，实际 ${item.tax_amount}（可能是四舍五入差异）`
        );
      }
    }
  });

  // ---- 明细合计 vs 汇总 ----
  const sumAmount = data.items.reduce((s, item) => s + (parseAmount(item.amount) || 0), 0);
  const sumTax = data.items.reduce((s, item) => s + (parseAmount(item.tax_amount) || 0), 0);
  const totalAmount = parseAmount(data.total.total_amount);
  const totalTax = parseAmount(data.total.total_tax);
  const totalWithTax = parseAmount(data.total.amount_with_tax_number);

  // sum(items.amount) == total_amount
  if (!isNaN(totalAmount) && !amountsEqual(sumAmount, totalAmount)) {
    result.errors.push(
      `明细行金额合计 ${sumAmount.toFixed(2)} ≠ total.total_amount ${data.total.total_amount}`
    );
  }

  // sum(items.tax_amount) == total_tax
  if (!isNaN(totalTax) && !amountsEqual(sumTax, totalTax)) {
    result.errors.push(
      `明细行税额合计 ${sumTax.toFixed(2)} ≠ total.total_tax ${data.total.total_tax}`
    );
  }

  // total_amount + total_tax == amount_with_tax_number
  if (!isNaN(totalAmount) && !isNaN(totalTax) && !isNaN(totalWithTax)) {
    const expectedTotal = totalAmount + totalTax;
    if (!amountsEqual(expectedTotal, totalWithTax)) {
      result.errors.push(
        `合计金额 + 合计税额 = ${expectedTotal.toFixed(2)} ≠ 价税合计 ${data.total.amount_with_tax_number}`
      );
    }
  }
}

// ============================================================
// Main
// ============================================================

export function validateInvoice(data: InvoiceData): ValidationResult {
  const result: ValidationResult = { valid: true, errors: [], warnings: [] };

  validateRequiredFields(data, result);
  validateAmountFormats(data, result);
  validateArithmetic(data, result);

  result.valid = result.errors.length === 0;
  return result;
}

/** CLI 入口 */
async function main() {
  let input: string;

  const filePath = process.argv[2];
  if (filePath) {
    const fs = await import("fs");
    input = fs.readFileSync(filePath, "utf-8");
  } else {
    // 从 stdin 读取
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    input = Buffer.concat(chunks).toString("utf-8");
  }

  let data: InvoiceData;
  try {
    data = JSON.parse(input);
  } catch {
    console.error("❌ 输入不是合法的 JSON");
    process.exit(1);
  }

  const result = validateInvoice(data);

  // 输出结果
  if (result.errors.length > 0) {
    console.log(`\n❌ 校验失败（${result.errors.length} 个错误）：`);
    result.errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
  }
  if (result.warnings.length > 0) {
    console.log(`\n⚠️  警告（${result.warnings.length} 个）：`);
    result.warnings.forEach((w, i) => console.log(`  ${i + 1}. ${w}`));
  }
  if (result.valid) {
    console.log("\n✅ 校验通过，所有字段完整、格式正确、算术一致。");
  }

  // 同时输出 JSON 结果供程序化使用
  console.log("\n" + JSON.stringify(result, null, 2));

  process.exit(result.valid ? 0 : 1);
}

main();
