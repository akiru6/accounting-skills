/**
 * invoice-posting Excel 导出脚本
 *
 * 将一个或多个 PostingResult JSON 展开为分录明细行，写入「发票管理.xlsx」的「过账分录」sheet。
 * 支持追加模式：如果 sheet 已有数据，按发票号码去重后合并写入。
 * 保留同一 Excel 文件中的其他 sheet（如「发票台账」）。
 *
 * 用法：
 *   npx tsx export-to-excel.ts <台账.xlsx> <posting1.json> [posting2.json ...]
 *   npx tsx export-to-excel.ts output/invoices/发票管理.xlsx output/postings/*.json
 */

import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

// ============================================================
// Types (与 SKILL.md 中的 PostingResult 一致)
// ============================================================

interface EntryLine {
    account_code: string;
    account_name: string;
    amount: string;
    description: string;
}

interface JournalEntry {
    step: "receipt" | "payment";
    debit_entries: EntryLine[];
    credit_entries: EntryLine[];
    supplier?: string;
    counterparty?: string;
    total_amount: string;
    note: string;
}

interface PostingResult {
    invoice_number?: string;
    invoice_direction?: "purchase" | "sales";
    payment_status?: string;
    collection_status?: string;
    journal_entries: JournalEntry[];
}

// ============================================================
// 列定义（过账分录台账格式）
// ============================================================

const SHEET_NAME = "过账分录";

/** 去重用的列头（发票号码） */
const DEDUP_HEADER = "发票号码";

interface ColumnDef {
    header: string;
    width: number;
}

const COLUMNS: ColumnDef[] = [
    { header: DEDUP_HEADER, width: 22 },
    { header: "业务方向", width: 10 },
    { header: "往来方(客户/供应商)", width: 30 },
    { header: "分录步骤", width: 10 },
    { header: "借贷", width: 6 },
    { header: "科目代码", width: 14 },
    { header: "科目名称", width: 28 },
    { header: "金额", width: 14 },
    { header: "摘要", width: 30 },
    { header: "收付款状态", width: 16 },
    { header: "备注", width: 30 },
    { header: "JSON来源文件", width: 24 },
];

// ============================================================
// 展开逻辑：PostingResult → 多行
// ============================================================

type Row = Record<string, string>;

/**
 * 将一个 PostingResult 展开为多行（每条 debit/credit entry 一行）。
 */
function postingToRows(
    posting: PostingResult,
    invoiceNumber: string,
    sourceFile: string
): Row[] {
    const rows: Row[] = [];

    const directionText = posting.invoice_direction === "sales" ? "销售" : "采购";
    const statusText = posting.collection_status || posting.payment_status || "";

    for (const je of posting.journal_entries) {
        const counterparty = je.counterparty || je.supplier || "";

        // 借方条目
        for (const entry of je.debit_entries) {
            rows.push({
                [DEDUP_HEADER]: invoiceNumber,
                "业务方向": directionText,
                "往来方(客户/供应商)": counterparty,
                "分录步骤": je.step,
                "借贷": "借",
                "科目代码": entry.account_code,
                "科目名称": entry.account_name,
                "金额": entry.amount,
                "摘要": entry.description,
                "收付款状态": statusText,
                "备注": je.note ?? "",
                "JSON来源文件": sourceFile,
            });
        }

        // 贷方条目
        for (const entry of je.credit_entries) {
            rows.push({
                [DEDUP_HEADER]: invoiceNumber,
                "业务方向": directionText,
                "往来方(客户/供应商)": counterparty,
                "分录步骤": je.step,
                "借贷": "贷",
                "科目代码": entry.account_code,
                "科目名称": entry.account_name,
                "金额": entry.amount,
                "摘要": entry.description,
                "收付款状态": statusText,
                "备注": je.note ?? "",
                "JSON来源文件": sourceFile,
            });
        }
    }

    return rows;
}

// ============================================================
// 读取已有数据 & 合并去重
// ============================================================

/**
 * 从已有的 Excel 文件中读取「过账分录」sheet 的所有行。
 */
function readExistingRows(filePath: string): Row[] {
    if (!fs.existsSync(filePath)) return [];

    try {
        const wb = XLSX.readFile(filePath);
        const ws = wb.Sheets[SHEET_NAME];
        if (!ws) return [];
        return XLSX.utils.sheet_to_json<Row>(ws, { defval: "" });
    } catch {
        console.warn(`  ⚠ 无法读取已有文件 ${filePath}，将创建新 sheet`);
        return [];
    }
}

/**
 * 按发票号码去重合并。
 * 同一发票号码的所有行（多条分录）会被视为一组，整组替换。
 */
function mergeRows(
    existingRows: Row[],
    newRows: Row[]
): { merged: Row[]; added: number; updated: number } {
    // 按发票号码分组，Map<发票号码, Row[]>
    const groupMap = new Map<string, Row[]>();

    // 先放入已有行
    for (const row of existingRows) {
        const key = row[DEDUP_HEADER] ?? "";
        const groupKey = key || `__no_key_${groupMap.size}`;
        if (!groupMap.has(groupKey)) groupMap.set(groupKey, []);
        groupMap.get(groupKey)!.push(row);
    }

    // 统计新增/更新
    const newInvoiceNumbers = new Set<string>();
    for (const row of newRows) {
        const key = row[DEDUP_HEADER] ?? "";
        if (key) newInvoiceNumbers.add(key);
    }

    let added = 0;
    let updated = 0;
    for (const invNo of newInvoiceNumbers) {
        if (groupMap.has(invNo)) {
            updated++;
        } else {
            added++;
        }
    }

    // 用新数据覆盖同发票号码的行组
    // 先按发票号码分组新行
    const newGroupMap = new Map<string, Row[]>();
    for (const row of newRows) {
        const key = row[DEDUP_HEADER] ?? "";
        const groupKey = key || `__new_no_key_${newGroupMap.size}`;
        if (!newGroupMap.has(groupKey)) newGroupMap.set(groupKey, []);
        newGroupMap.get(groupKey)!.push(row);
    }

    // 覆盖/追加
    for (const [key, rows] of newGroupMap) {
        groupMap.set(key, rows);
    }

    // 展开回扁平数组
    const merged: Row[] = [];
    for (const rows of groupMap.values()) {
        merged.push(...rows);
    }

    return { merged, added, updated };
}

// ============================================================
// 导出逻辑
// ============================================================

function exportToExcel(
    postings: { data: PostingResult; invoiceNumber: string; sourceFile: string }[],
    outputPath: string
): { total: number; added: number; updated: number } {
    // 展开所有 PostingResult 为行
    const newRows: Row[] = [];
    for (const p of postings) {
        newRows.push(...postingToRows(p.data, p.invoiceNumber, p.sourceFile));
    }

    // 读取已有数据并合并
    const existingRows = readExistingRows(outputPath);
    const { merged, added, updated } = mergeRows(existingRows, newRows);

    // 创建工作表
    const ws = XLSX.utils.json_to_sheet(merged, {
        header: COLUMNS.map((c) => c.header),
    });

    // 设置列宽
    ws["!cols"] = COLUMNS.map((col) => ({ wch: col.width }));

    // 读取或创建工作簿（保留其他 sheet，如「发票台账」）
    let wb: XLSX.WorkBook;
    if (fs.existsSync(outputPath)) {
        try {
            wb = XLSX.readFile(outputPath);
            // 删除旧的「过账分录」sheet，稍后用新数据替换
            const idx = wb.SheetNames.indexOf(SHEET_NAME);
            if (idx !== -1) {
                delete wb.Sheets[SHEET_NAME];
                wb.SheetNames.splice(idx, 1);
            }
        } catch {
            wb = XLSX.utils.book_new();
        }
    } else {
        wb = XLSX.utils.book_new();
    }

    // 追加「过账分录」sheet
    XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);

    // 写入文件
    XLSX.writeFile(wb, outputPath);

    // 统计唯一发票数
    const uniqueInvoices = new Set(merged.map((r) => r[DEDUP_HEADER]).filter(Boolean));
    return { total: uniqueInvoices.size, added, updated };
}

// ============================================================
// CLI 入口
// ============================================================

/**
 * 从 PostingResult JSON 或文件名中推断发票号码。
 * 优先使用 JSON 内的 invoice_number 字段，否则从文件名提取。
 */
function inferInvoiceNumber(data: PostingResult, filePath: string): string {
    if (data.invoice_number) return data.invoice_number;
    // 从文件名提取（如 12345678.json → 12345678）
    return path.basename(filePath, path.extname(filePath));
}

function main() {
    const args = process.argv.slice(2);

    if (args.length < 2) {
        console.log("用法: npx tsx export-to-excel.ts <output.xlsx> <posting1.json> [posting2.json ...]");
        console.log("示例: npx tsx export-to-excel.ts output/invoices/发票管理.xlsx output/postings/*.json");
        console.log("\n将过账分录写入 Excel 的「过账分录」sheet，保留「发票台账」sheet。");
        console.log("如果 sheet 已有数据，按发票号码去重后合并。");
        process.exit(1);
    }

    const outputPath = args[0];
    const inputFiles = args.slice(1);
    const isAppend = fs.existsSync(outputPath);

    const postings: { data: PostingResult; invoiceNumber: string; sourceFile: string }[] = [];

    for (const file of inputFiles) {
        try {
            const content = fs.readFileSync(file, "utf-8");
            const data: PostingResult = JSON.parse(content);
            const invoiceNumber = inferInvoiceNumber(data, file);
            postings.push({
                data,
                invoiceNumber,
                sourceFile: path.basename(file),
            });
            console.log(`  ✓ 读取: ${file} (发票号码: ${invoiceNumber})`);
        } catch (err) {
            console.error(`  ✗ 跳过 ${file}: ${err instanceof Error ? err.message : err}`);
        }
    }

    if (postings.length === 0) {
        console.error("没有成功读取任何过账结果 JSON 文件");
        process.exit(1);
    }

    if (isAppend) {
        console.log(`\n📂 检测到已有台账: ${outputPath}，将追加/更新「${SHEET_NAME}」sheet...`);
    }

    const { total, added, updated } = exportToExcel(postings, outputPath);

    console.log(`\n✅ 过账分录已保存: ${outputPath} → sheet「${SHEET_NAME}」`);
    console.log(`   📊 台账总计: ${total} 张发票的分录`);
    if (isAppend) {
        console.log(`   ➕ 新增: ${added} 张 | 🔄 更新: ${updated} 张`);
    }
}

main();
