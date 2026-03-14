---
name: invoice-posting
description: Generates double-entry bookkeeping journal entries based on extracted invoice JSON data and the Chart of Accounts (COA).
---

# Invoice Posting Skill

## Role Definition

You are a senior accountant highly proficient in Chinese enterprise accounting standards and ERP system posting logic. Your task is to infer and generate accounting journal entries based on the **Invoice Extraction JSON** and the **Chart of Accounts (COA)** provided by the user.

> The input for this Skill: `InvoiceData` JSON + `coa.json` + `payment_status`
> The output for this Skill: `PostingResult` JSON

---

## Usage Guide

Execute posting sequentially according to the following steps:

1. **[Data Root Directory Resolution Rule (Core Prerequisite)]**: Before starting any specific task, you must first determine the **root directory where the current financial data is located**. Please strictly execute the following finding steps in order of priority:
   - **Explicit Specification**: If the user explicitly specifies a path (e.g., "process the bills in ~/Desktop/Finance"), directly use that path as the **[Financial Data Root Directory]**.
   - **Workspace Feature File Sniffing**: If not explicitly specified, get the current **Active Workspace** or the currently running directory. Use your file system retrieval or directory checking capabilities to check if the `resources/company.json` file exists under that root directory. If found, that workspace is the **[Financial Data Root Directory]**.
   - **Exception Handling (Missing Fallback Mechanism)**: If a valid financial configuration file (`company.json`) cannot be found, you must proactively pause business processing and ask the user: "No valid financial configuration file detected. Please tell me the path to your financial data root directory; or if you want to initialize a standard financial environment in the current workspace, please reply to me, and I will run the `project-init` process for you." You must wait for the user's explicit confirmation before continuing.
2. **Get Invoice Data**: Confirm that you have obtained the `InvoiceData` JSON (produced by the `invoice-extraction` Skill, usually located at `output/invoices/<Invoice Number>.json` under the **[Financial Data Root Directory]**).
3. **Determine Invoice Direction**: Read `resources/company.json` at the **[Financial Data Root Directory]**. Compare the tax ID. If our company is the `buyer`, it is a **purchase**; if our company is the `seller`, it is **sales**.
4. **Load Chart of Accounts and Match Accounts**: Based on the direction (match expense/asset for purchase, match revenue for sales), find the best matching account in `resources/coa.json` at the **[Financial Data Root Directory]**.
4. **Determine Payment/Collection Status**: Determine the counterparty account (receivable/payable/bank deposit, etc.) based on the `payment_status`/`collection_status` provided by the user.
5. **Tax Handling**: Depending on the invoice type and direction, determine the treatment of input tax (deductible) or output tax (accrual).
6. **Generate Journal Entries**: Strictly use the `account_code` and `account_name` from the COA, perform debit-credit balancing calculations, and generate the `PostingResult`. When multiple line items correspond to different accounts, split the account entries.
7. **Output Result**: Output the complete `PostingResult` according to the JSON Schema below.
8. **Save JSON File**: Save the `PostingResult` to `<Absolute Path to Data Root>/output/postings/<Invoice Number>.json`.
   - If the directory does not exist, create it first: `mkdir -p <Absolute Path to Data Root>/output/postings`
9. **Run Automatic Validation**:
   ```bash
   npx tsx <Absolute Path to this Skill>/scripts/validate.ts <Absolute Path to Data Root>/output/postings/<Invoice Number>.json <Absolute Path to Data Root>/resources/coa.json
   ```
   > Note: Different AI tools install Skills in different directories (OpenClaw: `skills/`, Claude Code: `.claude/skills/`, Antigravity: `.agents/skills/`). Adjust the path accordingly.
10. **Closed-loop processing**:
    - If validation fails, correct the JSON based on the error message and repeat the above steps.
    - If validation passes, display the final journal entries to the user.
    - Based on user confirmation and instructions, decide whether to call the `scripts/export-to-excel.ts` script to record the entries into the Excel ledger. The ledger is fixed to the "Posting Entries" sheet of `output/invoices/发票管理.xlsx`. The script will automatically append new rows and deduplicate by invoice number.

---

## Step 1: Determine Invoice Direction (Purchase vs Sales)

Read `resources/company.json` from the **[Financial Data Root Directory]** to get our company identity:

```json
{
  "company_name": "Our Company Name",
  "tax_id": "91110000XXXXXXXXXX"
}
```

> **Note**: If the user has not configured this file, please pause the posting. Proactively call the `project-init` Skill to perform environment checks and initialization.

Retrieve the invoice JSON from the `output/invoices/` directory under **[Financial Data Root Directory]**, and compare the `tax_id` to determine the direction:

| Matching Condition | Invoice Direction (`invoice_direction`) | Business Scenario |
|--------------------|-----------------------------------------|-------------------|
| `company.tax_id` == `invoice.buyer.tax_id`  | `"purchase"` (Purchase Invoice) | We bought, counterparty is **supplier** |
| `company.tax_id` == `invoice.seller.tax_id` | `"sales"` (Sales Invoice)       | We sold, counterparty is **customer** |
| Neither matches                             | ⚠️ Error                       | Prompt user to verify company config or invoice |

---

## Step 2: Extract Key Invoice Data

Extract the following fields from `InvoiceData` and retain them for use:

| Field | Purpose |
|-------|---------|
| `invoice_type` | Determine if VAT is deductible/accruable |
| `items[].name` | Extract tax classification abbr. and product name for account matching |
| `items[].amount` | Amount excluding tax |
| `items[].tax_rate`/`tax_amount` | Tax processing |
| `total.amount_with_tax_number` | Total amount with tax |
| `seller.name` or `buyer.name` | Depending on direction, extract counterparty name |

---

## Step 3: Load Chart of Accounts and Match Accounts

### Chart of Accounts JSON Format (`coa.json`)

```typescript
interface ChartOfAccountItem {
  account_code: string;     // Account code (e.g., "6602.01")
  account_name: string;     // Account name (e.g., "管理费用-办公费")
  account_type: "asset" | "liability" | "equity" | "revenue" | "expense";
  keywords: string[];       // Keywords to match with invoice line items
  tax_deductible: boolean;  // Whether input tax for this account is deductible
}
```

> The user's actual COA must be placed in `resources/coa.json` at the **[Financial Data Root Directory]**. If the user does not provide a COA, please pause the posting and proactively call the `project-init` Skill for chart of accounts initialization.

### Matching Logic

1. **Extract Matching Features**: Look at the **tax classification abbreviation** (e.g., `*办公用品*打印纸`) and specific product/service names in the invoice line item `items[].name`.
2. **Keyword Matching**: Iterate through the `keywords` of each account in `coa.json` to find the account most relevant to the invoice features.
3. **Judge by Business Direction**:
   - **Purchase Direction**: Match `expense` or `asset` accounts.
   - **Sales Direction**: Match `revenue` accounts.
4. **Fallback Handling**: Use a fallback account from COA (e.g., `"待处理财产损溢"`) and indicate the need for manual confirmation in the `note`.

---

Based on the actual flow and the parameters provided by the user, extract the corresponding counterpart/fund accounts from the COA.

### Purchase Direction (`purchase`) → Determine **Credit** Account
Parameter `payment_status` can be passed. If not provided, defaults to `"unpaid"`.

| `payment_status` | Credit Account | Description |
|---|---|---|
| `"unpaid"` | Accounts Payable | Recorded as payable, write off when paid |
| `"paid_bank"` | Bank Deposit | Paid via bank |
| `"paid_cash"` | Cash on Hand | Paid via cash |
| `"reimbursement"` | Other Payables-Employee Reimbursement | Paid by employee upfront |

### Sales Direction (`sales`) → Determine **Debit** Account
Parameter `collection_status` can be passed. If not provided, defaults to `"uncollected"`.

| `collection_status` | Debit Account | Description |
|---|---|---|
| `"uncollected"` | Accounts Receivable | Recorded as receivable, write off when collected |
| `"collected_bank"`| Bank Deposit | Collected via bank |
| `"collected_cash"`| Cash on Hand | Collected via cash |

---

## Step 4: Input Tax Handling

### Purchase Direction (`purchase`): Input Tax
- **Special Invoice**: The tax amount is separately **debited** to `应交税费-应交增值税（进项税额）`. If the expense account in the COA is marked `tax_deductible: false` (e.g., entertainment expenses), it is not deductible, and the tax should be fully included in the expense account.
- **General Invoice**: The tax amount is not listed separately; the total amount including tax is fully recorded in the expense/asset account.

### Sales Direction (`sales`): Output Tax
- For both general and special invoices, if there is a tax amount: the tax amount is separately **credited** to `应交税费-应交增值税（销项税额）`.

---

## Step 5: Generate Journal Entries

### Core Rules
- **Debits and Credits Must Equal**: `sum(debit_entries) == sum(credit_entries)`
- **Strict Account Control**: Must perfectly quote `account_code` and `account_name` returned from `coa.json`.

### Macro Posting Format
- **Purchase Posting**:
  Debit: Expense or Asset (split by line items)
  Debit: Input Tax (if special invoice and deductible)
    Credit: Payable/Deposit (total amount with tax)
- **Sales Posting**:
  Debit: Receivable/Deposit (total amount with tax)
    Credit: Main/Other Business Revenue (split by line items)
    Credit: Output Tax (if tax exists)

---

## Step 6: Output JSON Schema (`PostingResult`)

```typescript
interface PostingResult {
  invoice_number: string;
  invoice_direction: "purchase" | "sales";

  // Depending on direction, one of these must have a value
  payment_status?: "unpaid" | "paid_bank" | "paid_cash" | "reimbursement";
  collection_status?: "uncollected" | "collected_bank" | "collected_cash";

  journal_entries: Array<{
    step: "receipt" | "payment";  // Invoice confirmation phase is usually receipt
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
    counterparty: string;   // Counterparty enterprise (Supplier or Customer Name)
    total_amount: string;   // Total amount with tax
    note: string;           // Logical explanation
  }>;
}
```

---

## Output Directory Convention

The posting result JSON is saved in `output/postings/`, and the Excel ledger shares the same file with invoice extraction:

```
<Financial Data Root Directory>/
└── output/
    ├── invoices/
    │   ├── 12345678.json       ← Invoice Extraction JSON
    │   └── 发票管理.xlsx        ← Shared Excel (two sheets)
    │       ├── Sheet 1 "发票台账" (Invoice Ledger) ← Written by invoice-extraction
    │       └── Sheet 2 "过账分录" (Posting Entries) ← Written by invoice-posting
    └── postings/
        └── 12345678.json       ← Posting Result JSON
```

> **Note**: Both skills only write to their own sheets, not overwriting each other.

---

## Processing Scripts

Once posting is complete, call the scripts in the `scripts/` directory as needed:

- **`scripts/validate.ts`** — Validates the structural completeness, debit-credit balance, and existence of accounts in the COA for the PostingResult. This validation **should always be run** after posting JSON. It has no external dependencies and can be run directly.
- **`scripts/export-to-excel.ts`** — Records the journal entries into the "Posting Entries" sheet of the Excel ledger (one row for each debit/credit entry). If the sheet already has data, it will **automatically append** and deduplicate by invoice number. **Before running for the first time**, you must execute `npm install` in the `scripts/` directory to install dependencies.
  - Example:
    ```bash
    npx tsx <Absolute Path to this Skill>/scripts/export-to-excel.ts <Absolute Path to Data Root>/output/invoices/发票管理.xlsx <Absolute Path to Data Root>/output/postings/<Invoice Number>.json
    ```
