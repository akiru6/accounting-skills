---
name: invoice-posting
description: 根据已提取的发票JSON数据和企业会计科目表(COA)，推断并生成会计记账分录（Journal Entry）。
---

# 发票过账/记账 Skill

## 角色设定

你是一位精通中国企业会计准则及 ERP 系统过账逻辑的资深会计师。你的任务是根据**发票提取 JSON** 和用户提供的 **会计科目表 (COA)**，推断并生成会计记账分录。

> 本 Skill 的输入：`InvoiceData` JSON + `coa.json` + `payment_status`
> 本 Skill 的输出：`PostingResult` JSON

---

## 使用方式

按以下步骤依次执行过账：

2. **获取发票数据**：确认已获取 `InvoiceData` JSON（由 `invoice-extraction` Skill 产出，位于 `output/invoices/<发票号码>.json`）。
3. **判断发票方向**：读取 `resources/company.json`。对比税务识别号，若我方是 `buyer` 则为**采购**，若我方是 `seller` 则为**销售**。
4. **加载科目表并匹配科目**：根据方向（采购匹配费用/资产，销售匹配收入），在 `coa.json` 中寻找最匹配的科目。
5. **确定收付款状态**：根据用户提供的 `payment_status`/`collection_status`，确定对端科目（应收/应付/存款等）。
6. **处理税务**：根据发票类型和方向，决定进项税（抵扣）或销项税（计提）的处理。
7. **生成分录**：严格使用 COA 中的 `account_code` 和 `account_name`，进行借贷平衡运算，生成 `PostingResult`。多明细行对应不同科目时，拆分科目条目。
8. **输出结果**：按照下方 JSON Schema 输出完整的 `PostingResult`。
7. **保存 JSON 文件**：将 `PostingResult` 保存到 `output/postings/<发票号码>.json`。
   - 如果目录不存在，先创建：`mkdir -p output/postings`
8. **运行自动校验**：
   ```bash
   npx tsx .agents/skills/invoice-posting/scripts/validate.ts output/postings/<发票号码>.json resources/coa.json
   ```
9. **闭环处理**：
   - 如果校验失败，根据错误提示修正 JSON 后重复上述步骤。
   - 如果校验通过，向用户展示最终分录。
   - 根据用户确认情况以及指令，再决定是否调用 `scripts/export-to-excel.ts` 脚本将分录录入到 Excel 台账。台账固定为 `output/invoices/发票管理.xlsx` 的「过账分录」sheet，脚本会自动追加新行并按发票号码去重。

---

## Step 1：确定发票方向（采购 vs 销售）

读取本 Skill 目录下的 `resources/company.json` 获取我方身份：

```json
{
  "company_name": "我方公司名称",
  "tax_id": "91110000XXXXXXXXXX"
}
```

> 如果用户未配置该文件，**拒绝过账并提示用户补充公司信息**。

取出 `output/invoices/` 目录下的发票 JSON，对比 `tax_id` 判断方向：

| 匹配条件 | 发票方向 (`invoice_direction`) | 业务场景 |
|----------|---------------------------------|----------|
| `company.tax_id` == `invoice.buyer.tax_id` | `"purchase"`（采购发票） | 我方买入，对方是**供应商** |
| `company.tax_id` == `invoice.seller.tax_id` | `"sales"`（销售发票） | 我方卖出，对方是**客户** |
| 都不匹配 | ⚠️ 报错 | 提示用户确认公司配置或发票信息是否正确 |

---

## Step 2：获取发票关键数据

提取 `InvoiceData` 中的下列字段留存备用：

| 字段 | 用途 |
|------|------|
| `invoice_type` | 判断是否可抵扣/需计提增值税 |
| `items[].name` | 提取税收分类简称和商品名称，用于科目匹配 |
| `items[].amount` | 不含税金额 |
| `items[].tax_rate`/`tax_amount` | 税额处理 |
| `total.amount_with_tax_number` | 价税合计 |
| `seller.name`或`buyer.name`| 视发票方向，提取对端企业名称（供应商或客户） |

---

## Step 2：加载科目表并匹配科目

### 科目表 JSON 格式 (`coa.json`)

```typescript
interface ChartOfAccountItem {
  account_code: string;     // 科目代码（如 "6602.01"）
  account_name: string;     // 科目名称（如 "管理费用-办公费"）
  account_type: "asset" | "liability" | "equity" | "revenue" | "expense";
  keywords: string[];       // 用于匹配发票明细项目名称的关键词
  tax_deductible: boolean;  // 该科目对应的进项税是否可抵扣
}
```

> 示例文件见 `resources/example_coa.json`。如果用户未提供 COA，**拒绝过账并提示用户提供科目表**。

### 匹配逻辑

7. **提取匹配特征**：查看发票明细行 `items[].name` 的**税收分类简称**（如 `*办公用品*打印纸`）和具体的商品/服务名称。
8. **关键词匹配**：遍历 `coa.json` 中每个科目的 `keywords`，寻找与发票特征最相关的科目。
9. **结合业务方向判断**：
   - **采购方向**：匹配 `expense`（费用）或 `asset`（资产）类科目。
   - **销售方向**：匹配 `revenue`（收入）类科目。
10. **无法匹配时**：使用 COA 中的兜底科目（如 `"待处理财产损溢"`），并在 `note` 中标明需人工确认。

---

根据实际流转情况，结合用户提供的参数，从 COA 中提取对应的往来/资金科目。

### 采购方向 (`purchase`) → 确定**贷方**科目
参数可传 `payment_status`。未提供则默认 `"unpaid"`。

| `payment_status` | 贷方科目 | 说明 |
|---|---|---|
| `"unpaid"` | 应付账款 | 挂账，后续付款时冲账 |
| `"paid_bank"` | 银行存款 | 已通过银行付款 |
| `"paid_cash"` | 库存现金 | 已通过现金付款 |
| `"reimbursement"` | 其他应付款-员工报销 | 员工垫付产生 |

### 销售方向 (`sales`) → 确定**借方**科目
参数可传 `collection_status`。未提供则默认 `"uncollected"`。

| `collection_status` | 借方科目 | 说明 |
|---|---|---|
| `"uncollected"` | 应收账款 | 挂账，后续收款时冲账 |
| `"collected_bank"`| 银行存款 | 已通过银行收款 |
| `"collected_cash"`| 库存现金 | 已通过现金收款 |

---

## Step 4：进项税处理

### 采购方向 (`purchase`)：进项税
- **专票**：税额单独**借记** `应交税费-应交增值税（进项税额）`。如果 COA 中该费用科目标记了 `tax_deductible: false`（如招待费），不可抵扣，税额应全额计入该费用科目。
- **普票**：税额不单独列示，价税合计全额计入费用/资产科目。

### 销售方向 (`sales`)：销项税
- 无论普票还是专票，如果发票存在税额：税额单独**贷记** `应交税费-应交增值税（销项税额）`。

---

## Step 6：生成分录

### 核心规则
- **借贷必相等**：`sum(debit_entries) == sum(credit_entries)`
- **严控科目**：必须直接引用 `coa.json` 返回的 `account_code`与`account_name`。

### 宏观过账格式
- **采购过账**：
  借：费用或资产（按明细拆分）
  借：进项税额（专票且可抵扣时）
    贷：应付款/存款（价税合计）
- **销售过账**：
  借：应收款/存款（价税合计）
    贷：主营业务/其他业务收入（按明细拆分）
    贷：销项税额（存在税额时）

---

## Step 7：输出 JSON Schema (`PostingResult`)

```typescript
interface PostingResult {
  invoice_number: string;
  invoice_direction: "purchase" | "sales";

  // 根据方向，二者必有一个有值
  payment_status?: "unpaid" | "paid_bank" | "paid_cash" | "reimbursement";
  collection_status?: "uncollected" | "collected_bank" | "collected_cash";

  journal_entries: Array<{
    step: "receipt" | "payment";  // 开票确认阶段通常为 receipt
    debit_entries: Array<{
      account_code: string; 
      account_name: string; 
      amount: string; 
      description: string;
    }>;
    credit_entries: Array<{
      account_code: string; 
      account_name: string; 
      amount: string; 
      description: string;
    }>;
    counterparty: string;   // 对端企业（供应商或客户名称）
    total_amount: string;   // 价税合计
    note: string;           // 逻辑说明
  }>;
}
```

---

## 输出目录约定

过账结果 JSON 保存在 `output/postings/`，Excel 台账与发票提取共享同一个文件：

```
<项目根目录>/
└── output/
    ├── invoices/
    │   ├── 12345678.json       ← 发票提取 JSON
    │   └── 发票管理.xlsx        ← 共享 Excel（两个 sheet）
    │       ├── Sheet 1「发票台账」  ← invoice-extraction 写入
    │       └── Sheet 2「过账分录」  ← invoice-posting 写入
    └── postings/
        └── 12345678.json       ← 过账结果 JSON
```

> **注意**：两个 skill 各自只写自己的 sheet，互不覆盖。

---

## 处理脚本

过账完成后，根据需要调用 `scripts/` 目录下的脚本：

- **`scripts/validate.ts`** — 校验 PostingResult 的结构完整性、借贷平衡、科目是否存在于 COA 中。过账完 JSON 后**应始终运行**此校验。无外部依赖，可直接运行。
- **`scripts/export-to-excel.ts`** — 将过账分录录入到 Excel 台账的「过账分录」sheet（每条借/贷分录一行）。如果 sheet 已有数据，会**自动追加**并按发票号码去重。**首次运行前**需在 `scripts/` 目录下执行 `npm install` 安装依赖。
  - 示例：
    ```bash
    npx tsx .agents/skills/invoice-posting/scripts/export-to-excel.ts output/invoices/发票管理.xlsx output/postings/<发票号码>.json
    ```
