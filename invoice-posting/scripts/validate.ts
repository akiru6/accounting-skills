/**
 * invoice-posting 校验脚本
 *
 * 校验 PostingResult JSON 的：
 *   1. 结构完整性（必填字段）
 *   2. 借贷平衡（每笔分录 借方合计 == 贷方合计）
 *   3. 科目代码合规性（所有 account_code 必须存在于 COA 中）
 *   4. 金额格式
 *
 * 用法：
 *   npx tsx validate.ts <posting-result.json> <coa.json>
 */

// ============================================================
// Types
// ============================================================

import * as fs from "fs";


interface EntryLine {
    account_code: string;
    account_name: string;
    amount: string;
    description: string;
}

interface JournalEntry {
    step: string;
    debit_entries: EntryLine[];
    credit_entries: EntryLine[];
    supplier: string;
    total_amount: string;
    note: string;
}

interface PostingResult {
    invoice_number: string;
    invoice_direction: "purchase" | "sales";
    payment_status?: string;
    collection_status?: string;
    journal_entries: JournalEntry[];
}

interface COAItem {
    account_code: string;
    account_name: string;
    account_type: string;
    keywords: string[];
    tax_deductible: boolean;
}

interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

// ============================================================
// Helpers
// ============================================================

function parseAmount(value: string): number {
    if (value === "") return NaN;
    return Number(value);
}

function isValidAmountFormat(value: string): boolean {
    if (value === "") return true;
    return /^\d+\.\d{2}$/.test(value);
}

function amountsEqual(a: number, b: number, tolerance = 0.015): boolean {
    return Math.abs(a - b) <= tolerance;
}

// ============================================================
// Validators
// ============================================================

function validateStructure(data: PostingResult, result: ValidationResult): void {
    if (!data.invoice_number) result.errors.push("缺少 invoice_number");
    if (!data.invoice_direction || !["purchase", "sales"].includes(data.invoice_direction)) {
        result.errors.push(`invoice_direction 无效值或缺失，应为 purchase / sales`);
    }

    if (data.invoice_direction === "purchase") {
        const validStatuses = ["unpaid", "paid_bank", "paid_cash", "reimbursement"];
        if (!data.payment_status) {
            result.errors.push("purchase 方向缺少 payment_status");
        } else if (!validStatuses.includes(data.payment_status)) {
            result.errors.push(`payment_status 无效值："${data.payment_status}"，应为 ${validStatuses.join(" / ")}`);
        }
    } else if (data.invoice_direction === "sales") {
        const validStatuses = ["uncollected", "collected_bank", "collected_cash"];
        if (!data.collection_status) {
            result.errors.push("sales 方向缺少 collection_status");
        } else if (!validStatuses.includes(data.collection_status)) {
            result.errors.push(`collection_status 无效值："${data.collection_status}"，应为 ${validStatuses.join(" / ")}`);
        }
    }

    if (!data.journal_entries || data.journal_entries.length === 0) {
        result.errors.push("缺少 journal_entries，至少需要一笔分录");
        return;
    }

    data.journal_entries.forEach((entry, i) => {
        const prefix = `journal_entries[${i}]`;

        if (!entry.step) {
            result.errors.push(`${prefix} 缺少 step`);
        } else if (!["receipt", "payment"].includes(entry.step)) {
            result.errors.push(`${prefix}.step 无效值："${entry.step}"，应为 receipt / payment`);
        }

        if (!entry.debit_entries || entry.debit_entries.length === 0) {
            result.errors.push(`${prefix} 缺少 debit_entries`);
        }
        if (!entry.credit_entries || entry.credit_entries.length === 0) {
            result.errors.push(`${prefix} 缺少 credit_entries`);
        }
        if (!entry.supplier && !(entry as any).counterparty) {
            result.warnings.push(`${prefix} 建议提供 supplier 或 counterparty（对端名称）`);
        }
        if (!entry.total_amount) {
            result.errors.push(`${prefix} 缺少 total_amount`);
        }

        // 检查每个借贷条目字段
        const checkEntryLines = (lines: EntryLine[], side: string) => {
            lines?.forEach((line, j) => {
                const linePrefix = `${prefix}.${side}[${j}]`;
                if (!line.account_code) result.errors.push(`${linePrefix} 缺少 account_code`);
                if (!line.account_name) result.errors.push(`${linePrefix} 缺少 account_name`);
                if (!line.amount) result.errors.push(`${linePrefix} 缺少 amount`);
                if (line.amount && !isValidAmountFormat(line.amount)) {
                    result.errors.push(`${linePrefix}.amount 格式错误："${line.amount}"（应为两位小数）`);
                }
            });
        };

        checkEntryLines(entry.debit_entries, "debit_entries");
        checkEntryLines(entry.credit_entries, "credit_entries");
    });
}

function validateBalance(data: PostingResult, result: ValidationResult): void {
    if (!data.journal_entries) return;

    data.journal_entries.forEach((entry, i) => {
        const prefix = `journal_entries[${i}]`;

        const debitTotal = (entry.debit_entries ?? []).reduce(
            (sum, line) => sum + (parseAmount(line.amount) || 0), 0
        );
        const creditTotal = (entry.credit_entries ?? []).reduce(
            (sum, line) => sum + (parseAmount(line.amount) || 0), 0
        );

        console.log(`  📋 ${prefix} (${entry.step}):`);
        entry.debit_entries?.forEach((line) => {
            console.log(`     借：${line.account_code} ${line.account_name}  ¥${line.amount}`);
        });
        entry.credit_entries?.forEach((line) => {
            console.log(`         贷：${line.account_code} ${line.account_name}  ¥${line.amount}`);
        });
        console.log(`     借方合计：¥${debitTotal.toFixed(2)}  |  贷方合计：¥${creditTotal.toFixed(2)}`);

        if (!amountsEqual(debitTotal, creditTotal)) {
            result.errors.push(
                `${prefix} 借贷不平衡！借方 ¥${debitTotal.toFixed(2)} ≠ 贷方 ¥${creditTotal.toFixed(2)}`
            );
            console.log(`     ❌ 借贷不平衡！差额 ¥${Math.abs(debitTotal - creditTotal).toFixed(2)}`);
        } else {
            console.log(`     ✅ 借贷平衡`);
        }

        // total_amount 与贷方合计一致性
        const declaredTotal = parseAmount(entry.total_amount);
        if (!isNaN(declaredTotal) && !amountsEqual(declaredTotal, creditTotal)) {
            result.warnings.push(
                `${prefix}.total_amount (${entry.total_amount}) 与贷方合计 (${creditTotal.toFixed(2)}) 不一致`
            );
        }
    });
}

function validateAgainstCOA(
    data: PostingResult,
    coa: COAItem[],
    result: ValidationResult
): void {
    const coaCodes = new Map(coa.map((item) => [item.account_code, item.account_name]));

    console.log(`\n  📖 COA 科目表包含 ${coa.length} 个科目`);

    if (!data.journal_entries) return;

    const checkLine = (line: EntryLine, linePrefix: string) => {
        if (!line.account_code) return;

        const coaName = coaCodes.get(line.account_code);
        if (coaName === undefined) {
            result.errors.push(
                `${linePrefix} 科目代码 "${line.account_code}" 不存在于 COA 中`
            );
            console.log(`     ❌ ${line.account_code} "${line.account_name}" — COA 中找不到此代码`);
        } else {
            if (coaName !== line.account_name) {
                result.warnings.push(
                    `${linePrefix} 科目名称不匹配：JSON 中为 "${line.account_name}"，COA 中为 "${coaName}"`
                );
                console.log(`     ⚠️  ${line.account_code} 名称不匹配：用了 "${line.account_name}"，COA 中是 "${coaName}"`);
            } else {
                console.log(`     ✅ ${line.account_code} ${line.account_name}`);
            }
        }
    };

    data.journal_entries.forEach((entry, i) => {
        const prefix = `journal_entries[${i}]`;
        entry.debit_entries?.forEach((line, j) => checkLine(line, `${prefix}.debit_entries[${j}]`));
        entry.credit_entries?.forEach((line, j) => checkLine(line, `${prefix}.credit_entries[${j}]`));
    });
}

// ============================================================
// Main
// ============================================================

export function validatePosting(
    data: PostingResult,
    coa: COAItem[]
): ValidationResult {
    const result: ValidationResult = { valid: true, errors: [], warnings: [] };

    console.log("\n🔍 [1/3] 结构完整性检查...");
    validateStructure(data, result);

    console.log("\n🔍 [2/3] 借贷平衡检查...");
    validateBalance(data, result);

    console.log("\n🔍 [3/3] 科目代码 COA 合规检查...");
    validateAgainstCOA(data, coa, result);

    result.valid = result.errors.length === 0;
    return result;
}

async function main() {
    const postingFile = process.argv[2];
    const coaFile = process.argv[3];

    if (!postingFile || !coaFile) {
        console.log("用法: npx tsx validate.ts <posting-result.json> <coa.json>");
        process.exit(1);
    }

    let postingData: PostingResult;
    let coaData: COAItem[];

    try {
        postingData = JSON.parse(fs.readFileSync(postingFile, "utf-8"));
        console.log(`📄 过账结果: ${postingFile}`);
    } catch {
        console.error(`❌ 无法读取过账结果文件: ${postingFile}`);
        process.exit(1);
    }

    try {
        coaData = JSON.parse(fs.readFileSync(coaFile, "utf-8"));
        console.log(`📄 科目表:   ${coaFile}`);
    } catch {
        console.error(`❌ 无法读取科目表文件: ${coaFile}`);
        process.exit(1);
    }

    const result = validatePosting(postingData, coaData);

    // 汇总输出
    if (result.errors.length > 0) {
        console.log(`\n❌ 校验失败（${result.errors.length} 个错误）：`);
        result.errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
    }
    if (result.warnings.length > 0) {
        console.log(`\n⚠️  警告（${result.warnings.length} 个）：`);
        result.warnings.forEach((w, i) => console.log(`  ${i + 1}. ${w}`));
    }
    if (result.valid) {
        console.log("\n✅ 校验通过：结构完整、借贷平衡、科目代码全部存在于 COA 中。");
    }

    console.log("\n" + JSON.stringify(result, null, 2));
    process.exit(result.valid ? 0 : 1);
}

main();
