/**
 * document-classifier 后续处理脚本：移动并重命名文件
 * 根据 LLM 分析生成的 JSON report 对文件实行物理位置变更。
 *
 * 用法：
 *   npx tsx scripts/move-files.ts <path-to-report.json>
 */

import { existsSync, readFileSync, copyFileSync, unlinkSync, mkdirSync } from "fs";
import { resolve, dirname, extname, basename, join } from "path";

// ============================================================
// Types
// ============================================================

interface IdentifiedInfo {
  date: string;
  counterparty: string;
  amount_hint: string;
  summary: string;
}

interface FileClassification {
  original_filename: string;
  source_path: string;
  target_path: string;
  document_category: string;
  identified_info: IdentifiedInfo;
  needs_review: boolean;
  review_reason: string;
}

interface ClassificationReport {
  classified_at: string;
  files: FileClassification[];
}

// ============================================================
// Main
// ============================================================

function moveFiles(reportPath: string): void {
  const absoluteReportPath = resolve(reportPath);

  if (!existsSync(absoluteReportPath)) {
    console.error(`❌ 未找到分类报告: ${absoluteReportPath}`);
    process.exit(1);
  }

  const reportContent = readFileSync(absoluteReportPath, "utf-8");
  let report: ClassificationReport;
  try {
    report = JSON.parse(reportContent);
  } catch {
    console.error("❌ 分类报告 JSON 格式不合法。");
    process.exit(1);
  }

  if (!report!.files || !Array.isArray(report!.files)) {
    console.warn("⚠️ 报告中未找到 `files` 数组，无需移动文件。");
    process.exit(0);
  }

  let movedCount = 0;
  let skippedCount = 0;
  const cwd = process.cwd();

  // 按类别统计
  const categoryCounts: Record<string, number> = {};

  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

  console.log(`\n📂 开始根据报告归档文件 (共 ${report!.files.length} 个):\n`);

  for (const file of report!.files) {
    const sourcePath = resolve(cwd, file.source_path);
    const targetPath = resolve(cwd, file.target_path);

    // 源文件不存在
    if (!existsSync(sourcePath)) {
      console.warn(`  [跳过] 源文件不存在: ${file.source_path}`);
      skippedCount++;
      continue;
    }

    // 需要人工确认的文件
    if (file.needs_review) {
      console.warn(
        `  [待决] 需人工确认 (${file.review_reason}): ${file.original_filename}`
      );
      // 如果类别是 unclassified，移到 unclassified 目录
      if (file.document_category === "unclassified") {
        moveFileSafely(sourcePath, targetPath);
        console.log(`        -> 已移至待确认区: ${file.target_path}`);
        movedCount++;
      } else {
        console.log(`        -> 暂留原处，请人工判断后重新分类`);
        skippedCount++;
      }
      categoryCounts[file.document_category] = (categoryCounts[file.document_category] || 0) + 1;
      continue;
    }

    // 源路径和目标路径相同，无需移动
    if (sourcePath === targetPath) {
      console.log(`  [保留] 无需移动: ${file.source_path}`);
      skippedCount++;
      categoryCounts[file.document_category] = (categoryCounts[file.document_category] || 0) + 1;
      continue;
    }

    // 正常分类移动
    try {
      moveFileSafely(sourcePath, targetPath);
      console.log(
        `  ✅ ${file.original_filename} -> ${file.target_path}  [${file.document_category}]`
      );
      movedCount++;
      categoryCounts[file.document_category] = (categoryCounts[file.document_category] || 0) + 1;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ 移动 ${file.source_path} 时出错: ${msg}`);
      skippedCount++;
    }
  }

  // 打印汇总
  const categoryLabels: Record<string, string> = {
    "ap-invoice": "采购发票 (AP)",
    "reimbursement": "报销发票",
    "ar-document": "销售单据 (AR)",
    "bank-statement": "银行流水",
    "article": "文章归档",
    "unclassified": "待确认",
  };

  console.log(`\n${"─".repeat(40)}`);
  console.log(`📊 分类统计  |  🕐 ${timestamp}`);
  console.log(`${"─".repeat(40)}`);

  for (const [key, label] of Object.entries(categoryLabels)) {
    const count = categoryCounts[key] || 0;
    if (count > 0) {
      console.log(`  ${label.padEnd(16)} ${count}`);
    }
  }

  // 打印未预定义的类别（如果有）
  for (const [key, count] of Object.entries(categoryCounts)) {
    if (!(key in categoryLabels)) {
      console.log(`  ${key.padEnd(16)} ${count}`);
    }
  }

  console.log(`${"─".repeat(40)}`);
  console.log(`  ✅ 归档成功  ${movedCount}    ⏭️ 跳过/待决  ${skippedCount}`);
  console.log(`${"─".repeat(40)}\n`);
}

// ============================================================
// Helpers
// ============================================================

/**
 * 安全移动文件（自动创建目录，防止同名覆盖）
 */
function moveFileSafely(src: string, dest: string): void {
  // 确保目标目录存在
  const destDir = dirname(dest);
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  // 防止重名覆盖：同名时自动加后缀 _1, _2 ...
  let finalDest = dest;
  let counter = 1;
  const ext = extname(dest);
  const base = basename(dest, ext);
  while (existsSync(finalDest)) {
    finalDest = join(destDir, `${base}_${counter}${ext}`);
    counter++;
  }

  // copy + unlink 比 rename 更安全（跨盘符也不会报错）
  copyFileSync(src, finalDest);
  unlinkSync(src);
}

// ============================================================
// CLI Entry
// ============================================================

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("用法: npx tsx move-files.ts <path-to-json-report>");
  process.exit(1);
}

moveFiles(args[0]);
