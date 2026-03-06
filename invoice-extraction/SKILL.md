---
name: invoice-extraction
description: 从中国增值税发票（图片、PDF或OCR文本）中提取结构化JSON数据。
---

# 发票信息提取 Skill

## 角色设定

你是一位精通中国增值税发票体系的资深财务顾问。你的任务是**精准提取**发票上的所有关键字段，输出为结构化 JSON。

> 本 Skill 只负责信息提取，不涉及会计分录推断。过账分录请使用 `invoice-posting` Skill。

---

## 使用方式

当用户提供发票（图片、PDF 扫描件、OCR 文字或输入信息）时：

1. 按照下方 **提取字段** 中定义的 JSON Schema 逐字段解析。
2. 遵循 **提取规则** 中的格式化和缺失值处理要求。
3. 对数电票等特殊票种，参照 **特殊票种规则** 进行适配。
4. 输出完整的、合法的、可直接解析的 JSON（不含注释），不要省略任何字段。
5. **保存 JSON 文件**：将生成的 JSON 内容保存到 `output/invoices/` 目录下（见下方 **输出目录约定**），文件名建议使用发票号码，如 `output/invoices/12345678.json`。
   - 如果目录不存在，先创建：`mkdir -p output/invoices`
   - **理由**：避免直接将巨大的 JSON 字符串通过命令行参数传递给脚本；同时统一管理所有发票产物。
6. **运行自动校验**：
   ```bash
   npx tsx .agents/skills/invoice-extraction/scripts/validate.ts output/invoices/<发票号码>.json
   ```
7. 如果发票信息不完整或识别困难，将无法识别的字段设为 `""`，并在 `remarks` 中注明。
8. 不要在此 Skill 中推断会计科目或生成分录。
9. **闭环处理**：
   - 如果校验失败，根据错误提示修正 JSON 后重复上述步骤。
   - 如果校验通过，向用户展示最终 JSON。
   - 根据用户确认情况以及指令，再决定是否调用 `scripts/export-to-excel.ts` 脚本将 JSON 录入到 Excel 发票台账。台账固定为 `output/invoices/发票管理.xlsx` 一个文件，脚本会自动追加新行并按发票号码去重。


### 输出目录约定

所有运行时产生的发票数据文件（JSON 和 Excel）统一存放在**项目根目录**下的 `output/invoices/` 中：

```
<项目根目录>/
└── output/
    └── invoices/
        ├── 12345678.json       ← 提取的发票 JSON（每张发票一个）
        ├── 87654321.json
        └── 发票管理.xlsx        ← 唯一的 Excel 台账（持续追加）
```

> **注意**：Skill 目录（`.agents/skills/invoice-extraction/`）只存放指令和脚本，不存放运行时数据。

### 处理脚本

提取完成后，根据用户需求调用 `scripts/` 目录下的脚本：

- **`scripts/validate.ts`** — 校验 JSON 的字段完整性、金额格式、算术一致性（明细合计=汇总、数量×单价=金额等）。提取完 JSON 后**应始终运行**此校验。无外部依赖，可直接运行。
- **`scripts/export-to-excel.ts`** — 将一个或多个 JSON 录入到 Excel 发票台账（一行一票）。如果台账文件已存在，会**自动追加**新行并按发票号码去重（重复的发票号码会以最新数据覆盖）。当用户要求导出 Excel 或需要人类可读的台账视图时运行。**首次运行前**需在 `scripts/` 目录下执行 `npm install` 安装依赖。
  - 示例：
    ```bash
    npx tsx .agents/skills/invoice-extraction/scripts/export-to-excel.ts output/invoices/发票管理.xlsx output/invoices/<新发票>.json
    ```

### 支持的发票类型

| 类型 | 说明 |
|------|------|
| 增值税专用发票 | 可抵扣进项税，需提取完整的购销方信息 |
| 增值税普通发票 | 不可抵扣，但仍需完整提取 |
| 电子发票（专票/普票） | 同上，数据通常更清晰 |
| 全面数字化的电子发票（数电票） | **无发票代码**，发票号码为20位，见特殊票种规则 |

---

## 提取字段（JSON Schema）

以下是需要从发票中提取的全部字段，按发票的物理版面分为三个区域：**票头信息**、**明细行**、**汇总信息**。

### 票头信息（Header）

发票最上方的基本信息和购销双方信息。

```typescript
// ---- 发票基本信息 ----
invoice_type: string;       // 发票类型（如"增值税专用发票"、"电子发票（增值税普通发票）"、"数电票"等）
invoice_code: string;       // 发票代码（数电票为空 ""）
invoice_number: string;     // 发票号码（传统8位 或 数电票20位）
date: string;               // 开票日期，格式："YYYY年MM月DD日"
check_code: string;         // 校验码（数电票为空 ""，传统发票取完整值）

// ---- 购买方 ----
buyer: {
  name: string;             // 名称
  tax_id: string;           // 纳税人识别号
  address_phone: string;    // 地址、电话
  bank_account: string;     // 开户行及账号
};

// ---- 销售方 ----
seller: {
  name: string;             // 名称
  tax_id: string;           // 纳税人识别号
  address_phone: string;    // 地址、电话
  bank_account: string;     // 开户行及账号
};
```

### 明细行（Line Items）

发票中部的货物或应税劳务/服务明细表格，可能有多行。

```typescript
items: Array<{
  name: string;             // 项目名称（含税收分类简称，如 "*办公用品*打印纸"）
  specification: string;    // 规格型号（无则 ""）
  unit: string;             // 单位（无则 ""）
  quantity: string;         // 数量（无则 ""）
  unit_price: string;       // 不含税单价（无则 ""）
  amount: string;           // 不含税金额
  tax_rate: string;         // 税率（如 "13%"、"6%"、"免税"）
  tax_amount: string;       // 税额
}>;
```

### 汇总信息（Footer / Summary）

发票下方的合计区域和备注。

```typescript
total: {
  total_amount: string;           // 合计金额（不含税）
  total_tax: string;              // 合计税额
  amount_with_tax_words: string;  // 价税合计（大写中文）
  amount_with_tax_number: string; // 价税合计（小写数字）← 报销核心金额
};

remarks: string;                  // 备注
```

---

## 提取规则

### 格式化规则
1. 所有金额字段输出为**字符串**，保留**两位小数**（如 `"1500.00"`），去除千分位分隔符。
2. 税率输出为百分比字符串（如 `"13%"`、`"6%"`、`"免税"`）。
3. 日期格式统一为 `"YYYY年MM月DD日"`（如 `"2023年10月24日"`）。

### 缺失值处理
1. 如果某个字段在发票上不存在或不可见，输出**空字符串** `""`，不要猜测或编造。
2. 明细行中规格型号、单位、数量、单价缺失时（常见于服务类发票），对应字段输出 `""`。
3. 如果出现"（详见销货清单）"，在 `items` 中只保留汇总行，并在 `remarks` 中注明 `"详见销货清单"`。

### 明细行处理
1. 如果发票有多行明细，`items` 数组中应包含**每一行**，按发票上从上到下的顺序排列。
2. 每行的 `amount`（不含税金额）和 `tax_amount`（税额）必须提取，即使其他字段缺失。

---

## 特殊票种规则

### 数电票（全面数字化的电子发票）
- 数电票**没有** `invoice_code`（发票代码）→ 输出 `""`。
- 数电票**没有** `check_code`（校验码）→ 输出 `""`。
- 数电票的 `invoice_number` 为 **20位数字**（传统发票为8位）。
- `invoice_type` 输出为 `"数电票"` 或发票上标注的具体类型。
