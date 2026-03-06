/**
 * invoice-extraction Excel 导出脚本
 *
 * 将一个或多个 InvoiceData JSON 导出为 Excel 发票台账（一行一票）。
 * 支持追加模式：如果目标 Excel 已存在，会读取已有数据，按发票号码去重后合并写入。
 *
 * 用法：
 *   npx tsx export-to-excel.ts <output.xlsx> <invoice1.json> [invoice2.json ...]
 *   npx tsx export-to-excel.ts 发票管理.xlsx /path/to/invoices/*.json
 */

import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

// ============================================================
// Types (与 SKILL.md 中的 InvoiceData 一致)
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

// ============================================================
// 列定义（发票台账格式）
// ============================================================

interface ColumnDef {
    header: string;
    key: string;
    width: number;
    extract: (inv: InvoiceData) => string;
}

/** 去重用的列头（发票号码） */
const DEDUP_HEADER = "发票号码";

const COLUMNS: ColumnDef[] = [
    {
        header: "发票类型",
        key: "invoice_type",
        width: 18,
        extract: (inv) => inv.invoice_type,
    },
    {
        header: "发票代码",
        key: "invoice_code",
        width: 14,
        extract: (inv) => inv.invoice_code,
    },
    {
        header: DEDUP_HEADER,
        key: "invoice_number",
        width: 22,
        extract: (inv) => inv.invoice_number,
    },
    {
        header: "开票日期",
        key: "date",
        width: 16,
        extract: (inv) => inv.date,
    },
    {
        header: "购方名称",
        key: "buyer_name",
        width: 24,
        extract: (inv) => inv.buyer?.name ?? "",
    },
    {
        header: "购方税号",
        key: "buyer_tax_id",
        width: 22,
        extract: (inv) => inv.buyer?.tax_id ?? "",
    },
    {
        header: "销方名称",
        key: "seller_name",
        width: 24,
        extract: (inv) => inv.seller?.name ?? "",
    },
    {
        header: "销方税号",
        key: "seller_tax_id",
        width: 22,
        extract: (inv) => inv.seller?.tax_id ?? "",
    },
    {
        header: "货物/服务名称",
        key: "item_names",
        width: 30,
        extract: (inv) =>
            inv.items?.map((item) => item.name).join("；") ?? "",
    },
    {
        header: "金额(不含税)",
        key: "total_amount",
        width: 14,
        extract: (inv) => inv.total?.total_amount ?? "",
    },
    {
        header: "税率",
        key: "tax_rate",
        width: 8,
        extract: (inv) => {
            // 如果所有明细行税率相同，显示税率；否则显示 "混合"
            const rates = [...new Set(inv.items?.map((i) => i.tax_rate) ?? [])];
            return rates.length === 1 ? rates[0] : rates.length > 1 ? "混合" : "";
        },
    },
    {
        header: "税额",
        key: "total_tax",
        width: 12,
        extract: (inv) => inv.total?.total_tax ?? "",
    },
    {
        header: "价税合计",
        key: "amount_with_tax",
        width: 14,
        extract: (inv) => inv.total?.amount_with_tax_number ?? "",
    },
    {
        header: "备注",
        key: "remarks",
        width: 20,
        extract: (inv) => inv.remarks ?? "",
    },
    {
        header: "JSON来源文件",
        key: "source_file",
        width: 30,
        extract: () => "", // 由调用者填充
    },
];

// ============================================================
// 导出逻辑
// ============================================================

type Row = Record<string, string>;

function invoiceToRow(inv: InvoiceData, sourceFile: string): Row {
    const row: Row = {};
    for (const col of COLUMNS) {
        if (col.key === "source_file") {
            row[col.header] = sourceFile;
        } else {
            row[col.header] = col.extract(inv);
        }
    }
    return row;
}

/**
 * 从已有的 Excel 文件中读取「发票台账」工作表的所有行。
 * 如果文件不存在或读取失败，返回空数组。
 */
function readExistingRows(filePath: string): Row[] {
    if (!fs.existsSync(filePath)) return [];

    try {
        const wb = XLSX.readFile(filePath);
        const ws = wb.Sheets["发票台账"];
        if (!ws) return [];
        return XLSX.utils.sheet_to_json<Row>(ws, { defval: "" });
    } catch {
        console.warn(`  ⚠ 无法读取已有文件 ${filePath}，将创建新文件`);
        return [];
    }
}

/**
 * 将新行合并到已有行中，按「发票号码」去重。
 * 如果发票号码重复，新数据会覆盖旧数据（以最新提取结果为准）。
 */
function mergeRows(existingRows: Row[], newRows: Row[]): { merged: Row[]; added: number; updated: number } {
    // 用 Map 保持插入顺序，key = 发票号码
    const rowMap = new Map<string, Row>();

    // 先放入已有行
    for (const row of existingRows) {
        const key = row[DEDUP_HEADER] ?? "";
        if (key) rowMap.set(key, row);
        else rowMap.set(`__no_key_${rowMap.size}`, row); // 无发票号码的行也保留
    }

    let added = 0;
    let updated = 0;

    // 再放入新行（覆盖同号发票）
    for (const row of newRows) {
        const key = row[DEDUP_HEADER] ?? "";
        if (key && rowMap.has(key)) {
            updated++;
        } else {
            added++;
        }
        if (key) rowMap.set(key, row);
        else rowMap.set(`__no_key_${rowMap.size}`, row);
    }

    return { merged: [...rowMap.values()], added, updated };
}

function exportToExcel(
    invoices: { data: InvoiceData; sourceFile: string }[],
    outputPath: string
): { total: number; added: number; updated: number } {
    // 构建新行数据
    const newRows = invoices.map((inv) => invoiceToRow(inv.data, inv.sourceFile));

    // 读取已有数据并合并
    const existingRows = readExistingRows(outputPath);
    const { merged, added, updated } = mergeRows(existingRows, newRows);

    // 创建工作表
    const ws = XLSX.utils.json_to_sheet(merged, {
        header: COLUMNS.map((c) => c.header),
    });

    // 设置列宽
    ws["!cols"] = COLUMNS.map((col) => ({ wch: col.width }));

    // 读取或创建工作簿（保留其他 sheet，如「过账分录」）
    let wb: XLSX.WorkBook;
    if (fs.existsSync(outputPath)) {
        try {
            wb = XLSX.readFile(outputPath);
            // 删除旧的「发票台账」sheet，稍后用新数据替换
            const idx = wb.SheetNames.indexOf("发票台账");
            if (idx !== -1) {
                delete wb.Sheets["发票台账"];
                wb.SheetNames.splice(idx, 1);
            }
        } catch {
            wb = XLSX.utils.book_new();
        }
    } else {
        wb = XLSX.utils.book_new();
    }

    // 将「发票台账」插入为第一个 sheet
    XLSX.utils.book_append_sheet(wb, ws, "发票台账");
    // 确保「发票台账」始终在第一个位置
    const names = wb.SheetNames;
    const thisIdx = names.indexOf("发票台账");
    if (thisIdx > 0) {
        names.splice(thisIdx, 1);
        names.unshift("发票台账");
    }

    // 写入文件
    XLSX.writeFile(wb, outputPath);

    return { total: merged.length, added, updated };
}

// ============================================================
// CLI 入口
// ============================================================

function main() {
    const args = process.argv.slice(2);

    if (args.length < 2) {
        console.log("用法: npx tsx export-to-excel.ts <output.xlsx> <invoice1.json> [invoice2.json ...]");
        console.log("示例: npx tsx export-to-excel.ts 发票管理.xlsx ./invoices/*.json");
        console.log("\n如果目标 Excel 已存在，会自动追加（按发票号码去重）。");
        process.exit(1);
    }

    const outputPath = args[0];
    const inputFiles = args.slice(1);
    const isAppend = fs.existsSync(outputPath);

    const invoices: { data: InvoiceData; sourceFile: string }[] = [];

    for (const file of inputFiles) {
        try {
            const content = fs.readFileSync(file, "utf-8");
            const data: InvoiceData = JSON.parse(content);
            invoices.push({ data, sourceFile: path.basename(file) });
            console.log(`  ✓ 读取: ${file}`);
        } catch (err) {
            console.error(`  ✗ 跳过 ${file}: ${err instanceof Error ? err.message : err}`);
        }
    }

    if (invoices.length === 0) {
        console.error("没有成功读取任何发票 JSON 文件");
        process.exit(1);
    }

    if (isAppend) {
        console.log(`\n📂 检测到已有台账: ${outputPath}，将追加/更新...`);
    }

    const { total, added, updated } = exportToExcel(invoices, outputPath);

    console.log(`\n✅ 台账已保存: ${outputPath}`);
    console.log(`   📊 台账总计: ${total} 张发票`);
    if (isAppend) {
        console.log(`   ➕ 新增: ${added} 张 | 🔄 更新: ${updated} 张`);
    }
}

main();
