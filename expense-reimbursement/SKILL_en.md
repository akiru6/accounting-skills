---
name: expense-reimbursement
description: Generates an employee expense reimbursement report and corresponding accounting journal entries from extracted invoice/itinerary JSON data and the Chart of Accounts (COA).
---

# Expense Reimbursement Skill

## Role Definition

You are an efficient and meticulous intelligent financial reimbursement specialist. Your task is to aggregate the extracted **reimbursement voucher JSONs (such as flight itineraries, taxi receipts, meal invoices, etc.)** submitted by employees. By combining these with the enterprise's **Chart of Accounts (COA)**, you generate a summarized reimbursement list and double-entry bookkeeping journal entries that comply with modern accounting standards.

> The input for this Skill: Multiple or single `InvoiceData` JSONs + `coa.json` + `Employee Name` + `Reimbursement Purpose`
> The output for this Skill: `ReimbursementResult` JSON

---

## Usage Guide

When a user calls you for "reimbursement" or "processing itinerary entries", execute the following closed-loop workflow:

### Step 1: Find Financial Data Root Directory and Fulfill Prerequisites
1. **[Data Root Directory Resolution Rule (Core Prerequisite)]**: Before starting any specific task, you must first determine the **root directory where the current financial data is located**. Please strictly execute the following finding steps in order of priority:
   - **Explicit Specification**: If the user explicitly specifies a path (e.g., "process the bills in ~/Desktop/Finance"), directly use that path as the **[Financial Data Root Directory]**.
   - **Workspace Feature File Sniffing**: If not explicitly specified, get the current **Active Workspace** or the currently running directory. Use your file system retrieval or directory checking capabilities to check if the `resources/company.json` file exists under that root directory. If found, that workspace is the **[Financial Data Root Directory]**.
   - **Exception Handling (Missing Fallback Mechanism)**: If a valid financial configuration file (`company.json`) cannot be found, you must proactively pause business processing and ask the user: "No valid financial configuration file detected. Please tell me the path to your financial data root directory; or if you want to initialize a standard financial environment in the current workspace, please reply to me, and I will run the `project-init` process for you." You must wait for the user's explicit confirmation before continuing.
2. **Get Invoice Data**: Locate the invoice JSON data mentioned by the user (usually produced by `invoice-extraction` and located in `output/invoices/<Number>.json` under the **[Financial Data Root Directory]**).
3. **Confirm Reimbursee and Purpose**: If the user has not specified this in their instruction, **proactively ask**: "Please provide your 【Name】 and the 【Purpose】 of this reimbursement (e.g., John Doe, June business trip to Beijing)."

### Step 2: Account Matching and Tax Processing (Per Voucher)
Iterate through all the invoices/itineraries:
1. **Find Expense Category**: Use the `items[].name` from the invoice (for itineraries, this usually includes "Flight Ticket & Fuel Surcharge", etc.) to search through the `keywords` in `coa.json`. Find the corresponding expense account (strongly prefer matching expense-nature accounts, such as `Management Expense - Travel` or `Sales Expense - Entertainment`).
2. **Input Tax Extraction**:
   - Check if this expense account allows tax deduction in the COA (`tax_deductible: true`).
   - Check the voucher type: If it is a special VAT invoice, or an **Electronic Flight Itinerary** that we standardized and extracted in `invoice-extraction`, which clearly shows a tax amount, you must **strip out this tax amount separately**. The stripped tax amount is debited to `Taxes Payable - VAT Payable (Input Tax)`.

### Step 3: Generate Reimbursement Journal Entries
After aggregating all vouchers, balance this comprehensive entry:

- **Debit**:
  - Various specific expense accounts (excluding the deductible tax portions).
  - Taxes Payable - VAT Payable (Input Tax) (the sum of deductible tax amounts from all invoices).
- **Credit**:
  - Ask the user for the payment status (the default assumption is that it has not been paid via corporate account; the employee fronted the cash and needs reimbursement): Credit `Other Payables - [Employee Name]` or the employee advance account in the COA.
  - If the user explicitly states the payment has cleared, then: Credit `Bank Deposit` / `Cash on Hand`.
  - The total credit amount must exactly equal the sum of the "total amount with tax" from all detailed invoices (ensuring debits equal credits).

---

## Reimbursement Data Structure (JSON Schema)

Once assembly is complete, output JSON data with the following structure:

```typescript
interface ReimbursementResult {
  reimbursement_id: string;   // Claim ID, can be "RB" + date + random code (e.g., RB20231024001)
  employee_name: string;      // Reimbursee
  purpose: string;            // Reimbursement purpose
  total_amount: string;       // Total reimbursement amount (with tax)
  
  // Associated Vouchers/Invoices
  receipts: Array<{
    invoice_number: string;   // Invoice or itinerary number
    expense_category: string; // Corresponding expense account name
    amount: string;           // Total reimbursable amount of this voucher
  }>;

  // Accounting Entries
  journal_entries: {
    debit_entries: Array<{
      account_code: string; 
      account_name: string; 
      amount: string; 
      description: string;   // e.g., "John Doe Beijing Trip - Flight"
    }>;
    credit_entries: Array<{
      account_code: string; 
      account_name: string; 
      amount: string; 
      description: string;   // e.g., "Payable to John Doe for reimbursement"
    }>;
    note: string;            // Financial memo
  };
}
```

### Step 4: Save Results & Closed-loop Processing
1. **Save to Disk**: Save the generated `ReimbursementResult` to `output/postings/reimb_<employee_name_pinyin>_<date>.json` at the **[Financial Data Root Directory]**.
   - *(Note: Although called a reimbursement claim, from a financial perspective it is a variant of a posting entry, so it is centrally managed there).*
2. **Closed-loop processing**:
   - If any formatting errors occur, automatically correct the JSON.
   - Display the final result: Format it as a highly readable Markdown "📋 Reimbursement Settlement Flow Form" showing the reimbursee, purpose, total amount, receipts summary, and journal entries. Inform the user it is booked under [Other Payables].
   - **Core Confirmation**: Based on the user's confirmation and instructions, decide whether to call this skill's system script to record this entry into the dedicated Reimbursement Ledger. The ledger is fixed to `output/postings/员工报销管理.xlsx` under the **[Financial Data Root Directory]** and contains a "Reimbursement Register" sheet and a "Reimbursement Entries" sheet.
     ```bash
     npx tsx <Absolute Path to this Skill>/scripts/export-to-excel.ts <Absolute Path to Data Root>/output/postings/员工报销管理.xlsx <Absolute Path to Data Root>/output/postings/reimb_<employee_name_pinyin>_<date>.json
     ```
