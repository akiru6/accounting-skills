---
name: invoice-extraction
description: Extracts structured JSON data from Chinese VAT invoices (images, PDFs, or OCR text).
---

# Invoice Extraction Skill

## Role Definition

You are a senior financial advisor highly proficient in the Chinese Value-Added Tax (VAT) invoice system. Your task is to **accurately extract** all key fields from invoices and output them as structured JSON.

> This Skill is strictly for information extraction and does not involve accounting entry inference. For posting entries, please use the `invoice-posting` Skill.

---

## Usage Guide

When the user provides an invoice (image, scanned PDF, OCR text, or input information):

1. **[Data Root Directory Resolution Rule (Core Prerequisite)]**: Before starting any specific task, you must first determine the **root directory where the current financial data is located**. Please strictly execute the following finding steps in order of priority:
   - **Explicit Specification**: If the user explicitly specifies a path (e.g., "process the bills in ~/Desktop/Finance"), directly use that path as the **[Financial Data Root Directory]**.
   - **Workspace Feature File Sniffing**: If not explicitly specified, get the current **Active Workspace** or the currently running directory. Use your file system retrieval or directory checking capabilities to check if the `resources/company.json` file exists under that root directory. If found, that workspace is the **[Financial Data Root Directory]**.
   - **Exception Handling (Missing Fallback Mechanism)**: If a valid financial configuration file (`company.json`) cannot be found, you must proactively pause business processing and ask the user: "No valid financial configuration file detected. Please tell me the path to your financial data root directory; or if you want to initialize a standard financial environment in the current workspace, please reply to me, and I will run the `project-init` process for you." You must wait for the user's explicit confirmation before continuing.
2. Parse field by field according to the JSON Schema defined in **Fields to Extract** below.
3. Follow the formatting and missing value handling requirements in **Extraction Rules**.
4. For special invoices like fully digital electronic invoices (e-invoices), adapt according to the **Special Invoice Rules**.
5. Output complete, valid, and directly parsable JSON (without comments), and do not omit any fields.
6. **Save the JSON file**: Save the generated JSON content to the `output/invoices/` directory under the **[Financial Data Root Directory]** (see **Output Directory Convention** below). It is recommended to use the invoice number as the filename, e.g., `<Absolute Path to Data Root>/output/invoices/12345678.json`.
   - If the directory does not exist, create it first: `mkdir -p <Absolute Path to Data Root>/output/invoices`
   - **Reason**: To avoid passing huge JSON strings via command-line arguments to scripts directly; and to manage all invoice artifacts centrally.
7. **Run automatic validation**:
   ```bash
   npx tsx <Absolute Path to this Skill>/scripts/validate.ts <Absolute Path to Data Root>/output/invoices/<Invoice Number>.json
   ```
   > Note: Different AI tools install Skills in different directories (OpenClaw: `skills/`, Claude Code: `.claude/skills/`, Antigravity: `.agents/skills/`). Adjust the path accordingly.
8. If the invoice information is incomplete or difficult to recognize, set the unrecognizable fields to `""` and specify the reason in `remarks`.
9. Do not infer accounting subjects or generate journal entries in this Skill.
10. **Closed-loop processing & Intelligent Routing**:
    - If validation fails, correct the JSON based on the error message and repeat the above steps.
    - If validation passes, display the final JSON to the user.
    - **Core Workflow Routing** (After showing the result, you MUST proactively pose ONE of the following combined questions to the user):
      - If it is a standard corporate **purchase/sales invoice**, ask: "Would you like me to log this into the **Invoice Ledger (Excel)** now, and then call the `invoice-posting` skill to generate the **journal entry**?". Upon permission, run the `scripts/export-to-excel.ts` from this skill first, then switch to `invoice-posting`.
      - ⚠️ If it is an **Electronic Flight Itinerary** or other employee reimbursement, ask: "Would you like me to archive this voucher (Excel) now, and then route this to the `expense-reimbursement` skill to generate your **reimbursement claim and entries**?". Upon permission, run this skill's Excel export, then hand over to the reimbursement flow.

### Output Directory Convention

All runtime generated invoice data files (JSON and Excel) are uniformly stored in `output/invoices/` under the **[Financial Data Root Directory]**:

```
<Financial Data Root Directory>/
└── output/
    └── invoices/
        ├── 12345678.json       ← Extracted Invoice JSON (one per invoice)
        ├── 87654321.json
        └── 发票管理.xlsx        ← The unique Excel Ledger (continuously appended)
```

> **Note**: The Skill directory only stores instructions and scripts, not runtime data. All generated files must be in the `output/` directory at the **[Financial Data Root Directory]**.

### Processing Scripts

Once extraction is complete, call the scripts in the `scripts/` directory based on user needs:

- **`scripts/validate.ts`** — Validates JSON field completeness, amount format, and arithmetic consistency (e.g., item total = summary, quantity × unit price = amount, etc.). This validation **should always be run** after extracting JSON. It has no external dependencies and can be run directly.
- **`scripts/export-to-excel.ts`** — Records one or more JSON files into the Excel invoice ledger (one row per invoice). If the ledger file already exists, it will **automatically append** new rows and deduplicate by invoice number (duplicate invoice numbers will be overwritten with the latest data). Run this when the user asks to export to Excel or needs a human-readable ledger view. **Before running for the first time**, you must execute `npm install` in the `scripts/` directory to install dependencies.
  - Example:
    ```bash
    npx tsx <Absolute Path to this Skill>/scripts/export-to-excel.ts <Absolute Path to Data Root>/output/invoices/发票管理.xlsx <Absolute Path to Data Root>/output/invoices/<New Invoice>.json
    ```

### Supported Invoice Types

| Type | Description |
|------|-------------|
| Special VAT Invoice | Input tax is deductible. Requires complete extraction of both buyer and seller info. |
| General VAT Invoice | Not deductible, but still requires complete extraction. |
| Electronic Invoice (Special/General) | Same as above, data is usually clearer. |
| Fully Digital E-Invoice | **No invoice code**, invoice number is 20 digits. See Special Invoice Rules. |
| Electronic Flight Itinerary | Reimbursement voucher for air travel, layout differs from standard invoices. See Special Rules. |

---

## Fields to Extract (JSON Schema)

The following are all the fields that need to be extracted from the invoice, divided into three areas according to the physical layout of the invoice: **Header**, **Line Items**, and **Summary**.

### Header Information

Basic information at the top of the invoice and buyer/seller information.

```typescript
// ---- Basic Invoice Info ----
invoice_type: string;       // Type of invoice (e.g., "增值税专用发票", "电子发票（增值税普通发票）", "数电票", etc.)
invoice_code: string;       // Invoice code (Empty "" for fully digital e-invoices)
invoice_number: string;     // Invoice number (Traditional 8 digits or 20 digits for fully digital e-invoices)
date: string;               // Issue date, format: "YYYY年MM月DD日"
check_code: string;         // Verification/Check code (Empty "" for fully digital e-invoices, full value for traditional ones)

// ---- Buyer ----
buyer: {
  name: string;             // Name
  tax_id: string;           // Taxpayer Identification Number (TIN)
  address_phone: string;    // Address and Phone
  bank_account: string;     // Bank name and account number
};

// ---- Seller ----
seller: {
  name: string;             // Name
  tax_id: string;           // Taxpayer Identification Number (TIN)
  address_phone: string;    // Address and Phone
  bank_account: string;     // Bank name and account number
};
```

### Line Items

The goods or taxable services/labor detail table in the middle of the invoice, which may have multiple rows.

```typescript
items: Array<{
  name: string;             // Item name (including tax classification abbreviation, e.g., "*办公用品*打印纸")
  specification: string;    // Specification/Model (Empty "" if none)
  unit: string;             // Unit (Empty "" if none)
  quantity: string;         // Quantity (Empty "" if none)
  unit_price: string;       // Unit price excluding tax (Empty "" if none)
  amount: string;           // Amount excluding tax
  tax_rate: string;         // Tax rate (e.g., "13%", "6%", "免税")
  tax_amount: string;       // Tax amount
}>;
```

### Footer / Summary

The total computation area and remarks at the bottom of the invoice.

```typescript
total: {
  total_amount: string;           // Total amount (excluding tax)
  total_tax: string;              // Total tax amount
  amount_with_tax_words: string;  // Total amount including tax (Chinese words)
  amount_with_tax_number: string; // Total amount including tax (number) ← Core amount for reimbursement
};

remarks: string;                  // Remarks
```

---

## Extraction Rules

### Formatting Rules
1. All amount fields must be output as **strings**, keeping **two decimal places** (e.g., `"1500.00"`), and removing thousands separators.
2. Tax rates must be output as percentage strings (e.g., `"13%"`, `"6%"`, `"免税"`).
3. Date format must be uniformly `"YYYY年MM月DD日"` (e.g., `"2023年10月24日"`).

### Missing Value Handling
1. If a field does not exist or is not visible on the invoice, output an **empty string** `""`. Do not guess or fabricate.
2. When specification, unit, quantity, or unit price are missing in line items (common in service invoices), output `""` for the corresponding fields.
3. If "(详见销货清单)" (See sales list for details) appears, only keep the summary row in `items` and note `"详见销货清单"` in `remarks`.

### Line Items Handling
1. If the invoice has multiple line items, the `items` array should contain **every row**, arranged in the top-to-bottom order on the invoice.
2. The `amount` (excluding tax) and `tax_amount` (tax amount) for each row must be extracted, even if other fields are missing.

---

## Special Invoice Rules

### Fully Digital E-Invoice (数电票)
- Fully digital e-invoices **do not have** an `invoice_code` (发票代码) → Output `""`.
- Fully digital e-invoices **do not have** a `check_code` (校验码) → Output `""`.
- The `invoice_number` for fully digital e-invoices is **20 digits** (traditional invoices have 8 digits).
- Output `"数电票"` or the specific type marked on the invoice for `invoice_type`.

### Electronic Flight Itinerary (Air Ticket Extraction)
Because flight itineraries have a different layout than standard invoices, proactively map their fields to the standard `InvoiceData` format:
- **`invoice_type`**: Output the large text at the top (e.g., `"航空运输电子客票行程单"` or `"电子发票（航空运输电子客票行程单）"`).
- **Buyer (`buyer`)**: Extract the "购买方名称" (Buyer Name) and "统一社会信用代码/纳税人识别号" (Tax ID).
- **Seller (`seller`)**: For `name` use the "填开单位" (Issuing Entity) at the bottom or the "承运人" (Carrier). The `tax_id` is usually invisible; output `""`.
- **Line Items (`items`)**: You must construct the items array by reading the flight details:
  - **Row 1 (Fare & Fuel Surcharge)**: Set `name` to `"机票及燃油附加费 - [Passenger Name] [Departure]至[Destination]"` (e.g., 機票及燃油附加费 - 白xx 成都双流T2至北京首都T2); Set `amount` to the **sum** of `票价` (Fare) and `燃油附加费` (Fuel Surcharge); Set `tax_rate` to the VAT rate printed (e.g., `"9%"`); Set `tax_amount` to the VAT amount printed.
  - **Row 2 (Civil Aviation Development Fund)**: If present on the ticket, set `name` to `"民航发展基金"`; Set `amount` to its value; Force `tax_rate` to `"免税"` or `"0%"`; Force `tax_amount` to `"0.00"`.
  - **Row 3 (Other Taxes/Fees)**: Append any other taxes similarly as non-taxable / `"0%"` rows if they exist.
- **Total (`total`)**: Extract the "合计" (Total) amount as the total with tax. The `total_amount` should equal the sum of all item `amount`s, and `total_tax` equal the sum of all item `tax_amount`s.
- **Remarks (`remarks`)**: Include the text "电子客票号码: [Ticket Number]" and any other necessary notes.
