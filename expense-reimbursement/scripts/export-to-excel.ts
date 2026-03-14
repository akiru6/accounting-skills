/**
 * expense-reimbursement Excel 导出脚本
 *
 * 将一个或多个 ReimbursementResult JSON 写入「员工报销管理.xlsx」文件。
 * 该文件包含两个 Sheet：
 * 1. 「报销单台账」：一行代表一张报销单的主信息及凭证概览。
 * 2. 「报销分录」：将报销单内的会计分录展开为明细行（借/贷）。
 *
 * 支持追加模式：如果 sheet 已有数据，按报销单号(reimbursement_id)去重后合并写入。
 *
 * 用法：
 *   npx tsx export-to-excel.ts <目标台账.xlsx> <reimb1.json> [reimb2.json ...]
 */

import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

// ============================================================
// Types
// ============================================================

interface EntryLine {
    account_code: string;
    account_name: string;
    amount: string;
    description: string;
}

interface ReimbursementResult {
    reimbursement_id: string;
    employee_name: string;
    purpose: string;
    total_amount: string;
    receipts: Array<{
        invoice_number: string;
        expense_category: string;
        amount: string;
    }>;
    journal_entries: Array<{
        step?: string;
        debit_entries: EntryLine[];
        credit_entries: EntryLine[];
        note: string;
    }>;
}

// ============================================================
// 表1：「报销单台账」定义
// ============================================================
const SHEET_REGISTER = "报销单台账";
const REG_DEDUP_KEY = "报销单号";

const REG_COLUMNS = [
    { header: REG_DEDUP_KEY, width: 22 },
    { header: "报销人", width: 12 },
    { header: "报销事由", width: 30 },
    { header: "报销总额", width: 15 },
    { header: "包含凭证数", width: 12 },
    { header: "凭证流水号清单", width: 40 },
    { header: "JSON来源文件", width: 25 },
];

function buildRegisterRow(data: ReimbursementResult, sourceFile: string): Record<string, string> {
    const receiptCodes = data.receipts?.map(r => r.invoice_number).join(", ") || "";
    return {
        [REG_DEDUP_KEY]: data.reimbursement_id,
        "报销人": data.employee_name,
        "报销事由": data.purpose,
        "报销总额": data.total_amount,
        "包含凭证数": String(data.receipts?.length || 0),
        "凭证流水号清单": receiptCodes,
        "JSON来源文件": sourceFile,
    };
}

// ============================================================
// 表2：「报销分录」定义
// ============================================================
const SHEET_POSTING = "报销分录";
const POSTING_DEDUP_KEY = "报销单号";

const POSTING_COLUMNS = [
    { header: POSTING_DEDUP_KEY, width: 22 },
    { header: "报销人", width: 12 },
    { header: "借贷", width: 6 },
    { header: "科目代码", width: 15 },
    { header: "科目名称", width: 25 },
    { header: "金额", width: 15 },
    { header: "摘要", width: 35 },
    { header: "财务说明(Note)", width: 40 },
    { header: "JSON来源文件", width: 25 },
];

function buildPostingRows(data: ReimbursementResult, sourceFile: string): Record<string, string>[] {
    const rows: Record<string, string>[] = [];
    const baseInfo = {
        [POSTING_DEDUP_KEY]: data.reimbursement_id,
        "报销人": data.employee_name,
        "JSON来源文件": sourceFile,
    };

    if (!data.journal_entries || data.journal_entries.length === 0) return rows;

    for (const je of data.journal_entries) {
        // Debits
        for (const entry of je.debit_entries || []) {
            rows.push({
                ...baseInfo,
                "借贷": "借",
                "科目代码": entry.account_code,
                "科目名称": entry.account_name,
                "金额": entry.amount,
                "摘要": entry.description,
                "财务说明(Note)": je.note || "",
            });
        }
        // Credits
        for (const entry of je.credit_entries || []) {
            rows.push({
                ...baseInfo,
                "借贷": "贷",
                "科目代码": entry.account_code,
                "科目名称": entry.account_name,
                "金额": entry.amount,
                "摘要": entry.description,
                "财务说明(Note)": je.note || "",
            });
        }
    }
    return rows;
}

// ============================================================
// Core Merge Logic
// ============================================================

type Row = Record<string, string>;

function readExistingRows(filePath: string, sheetName: string): Row[] {
    if (!fs.existsSync(filePath)) return [];
    try {
        const wb = XLSX.readFile(filePath);
        const ws = wb.Sheets[sheetName];
        if (!ws) return [];
        return XLSX.utils.sheet_to_json<Row>(ws, { defval: "" });
    } catch {
        return [];
    }
}

function mergeRows(
    existingRows: Row[],
    newRows: Row[],
    dedupKey: string
): Row[] {
    const groupMap = new Map<string, Row[]>();

    for (const row of existingRows) {
        const key = row[dedupKey] ?? "";
        const groupKey = key || `__no_key_${groupMap.size}`;
        if (!groupMap.has(groupKey)) groupMap.set(groupKey, []);
        groupMap.get(groupKey)!.push(row);
    }

    const newGroupMap = new Map<string, Row[]>();
    for (const row of newRows) {
        const key = row[dedupKey] ?? "";
        const groupKey = key || `__new_no_key_${newGroupMap.size}`;
        if (!newGroupMap.has(groupKey)) newGroupMap.set(groupKey, []);
        newGroupMap.get(groupKey)!.push(row);
    }

    for (const [key, rows] of newGroupMap) {
        groupMap.set(key, rows);
    }

    const merged: Row[] = [];
    for (const rows of groupMap.values()) {
        merged.push(...rows);
    }
    return merged;
}

// ============================================================
// Main Execution
// ============================================================

function main() {
    const args = process.argv.slice(2);

    if (args.length < 2) {
        console.log("用法: npx tsx export-to-excel.ts <output.xlsx> <reimb1.json> [reimb2.json ...]");
        console.log("示例: npx tsx export-to-excel.ts output/postings/员工报销管理.xlsx output/postings/reimb_*.json");
        process.exit(1);
    }

    const outputPath = args[0];
    const inputFiles = args.slice(1);

    const newRegisterRows: Row[] = [];
    const newPostingRows: Row[] = [];
    let parsedCount = 0;

    for (const file of inputFiles) {
        try {
            const content = fs.readFileSync(file, "utf-8");
            const data: ReimbursementResult = JSON.parse(content);
            const fileName = path.basename(file);

            if (!data.reimbursement_id) {
                console.warn(`  ⚠ 跳过 ${file}: 找不到 reimbursement_id`);
                continue;
            }

            newRegisterRows.push(buildRegisterRow(data, fileName));
            newPostingRows.push(...buildPostingRows(data, fileName));
            parsedCount++;
            console.log(`  ✓ 读取: ${file} (单号: ${data.reimbursement_id})`);
        } catch (err) {
            console.error(`  ✗ 跳过 ${file}: ${err instanceof Error ? err.message : err}`);
        }
    }

    if (parsedCount === 0) {
        console.error("没有成功读取任何报销结果 JSON 文件");
        process.exit(1);
    }

    // Merge Registers
    const existingRegisters = readExistingRows(outputPath, SHEET_REGISTER);
    const mergedRegisters = mergeRows(existingRegisters, newRegisterRows, REG_DEDUP_KEY);

    // Merge Postings
    const existingPostings = readExistingRows(outputPath, SHEET_POSTING);
    const mergedPostings = mergeRows(existingPostings, newPostingRows, POSTING_DEDUP_KEY);

    // Save
    let wb: XLSX.WorkBook;
    if (fs.existsSync(outputPath)) {
        try {
            wb = XLSX.readFile(outputPath);
        } catch {
            wb = XLSX.utils.book_new();
        }
    } else {
        wb = XLSX.utils.book_new();
    }

    // Assign Registers
    const wsRegister = XLSX.utils.json_to_sheet(mergedRegisters, { header: REG_COLUMNS.map(c => c.header) });
    wsRegister["!cols"] = REG_COLUMNS.map(c => ({ wch: c.width }));
    if (wb.SheetNames.includes(SHEET_REGISTER)) {
        wb.Sheets[SHEET_REGISTER] = wsRegister;
    } else {
        XLSX.utils.book_append_sheet(wb, wsRegister, SHEET_REGISTER);
    }

    // Assign Postings
    const wsPosting = XLSX.utils.json_to_sheet(mergedPostings, { header: POSTING_COLUMNS.map(c => c.header) });
    wsPosting["!cols"] = POSTING_COLUMNS.map(c => ({ wch: c.width }));
    if (wb.SheetNames.includes(SHEET_POSTING)) {
        wb.Sheets[SHEET_POSTING] = wsPosting;
    } else {
        XLSX.utils.book_append_sheet(wb, wsPosting, SHEET_POSTING);
    }

    XLSX.writeFile(wb, outputPath);

    console.log(`\n✅ 报销台账已保存: ${outputPath}`);
    console.log(`   包含「${SHEET_REGISTER}」和「${SHEET_POSTING}」两个 Sheet`);
}

main();
