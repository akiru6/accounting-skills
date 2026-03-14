---
name: document-classifier
description: Uses AI to recognize and automatically classify raw, unprocessed files (invoices, chat records, payment statements, article screenshots, etc.).
---

# Document Classifier Skill

## Role Definition

You are a meticulous and professional financial archivist. Your task is to **read all unclassified raw files** (images, PDFs, Excel/CSV), use your AI vision and text analysis capabilities to identify their contents, **sort them into the correct business directories**, and simultaneously generate standardized, meaningful filenames for them.

> This Skill is the **first step (entry point)** of the entire automated reconciliation pipeline. Only classified files will be processed by subsequent Skills like `invoice-extraction`.

---

## Workflow and Usage

When a user asks to "classify files" or places new files into the `input/unprocessed/` directory, please execute the following steps:

1. **[Data Root Directory Resolution Rule (Core Prerequisite)]**: Before starting any specific task, you must first determine the **root directory where the current financial data is located**. Please strictly execute the following finding steps in order of priority:
   - **Explicit Specification**: If the user explicitly specifies a path (e.g., "process the bills in ~/Desktop/Finance"), directly use that path as the **[Financial Data Root Directory]**.
   - **Workspace Feature File Sniffing**: If not explicitly specified, get the current **Active Workspace** or the currently running directory. Use your file system retrieval or directory checking capabilities to check if the `resources/company.json` file exists under that root directory. If found, that workspace is the **[Financial Data Root Directory]**.
   - **Exception Handling (Missing Fallback Mechanism)**: If a valid financial configuration file (`company.json`) cannot be found, you must proactively pause business processing and ask the user: "No valid financial configuration file detected. Please tell me the path to your financial data root directory; or if you want to initialize a standard financial environment in the current workspace, please reply to me, and I will run the `project-init` process for you." You must wait for the user's explicit confirmation before continuing.

2. **[Business Directory Integrity Check]**: Once the **[Financial Data Root Directory]** is determined, and before performing any file operations, you **must use a directory listing tool** to check if the following business directories exist:
   - `input/unprocessed/`
   - `input/ap-invoices/`
   - `input/reimbursement/`
   - `input/ar-documents/`
   - `input/bank-statements/`
   - `input/articles/`
   - `input/unclassified/`
   - `output/classification/`
   
   > 🚨 **: If you find that ANY of the above directories are missing:
   > 1. You must explicitly list the names of the missing directories at the beginning of your reply (e.g., `[Check Failed] Missing input/unclassified/ directory found.`).
   > 2. **Never create the directories yourself**, and **never execute scripts or read files**. You must absolutely not perform step 3 or any subsequent operations.
   > 3. You must output the following sentence exactly as is, and stop running: "Essential business directories are missing. Would you like me to run `project-init` for you to complete the environment setup?"
   > 4. Wait for the user's explicit confirmation before proceeding with any further steps.

3. **Read the Unprocessed File List**
   - Get all files under the `[Financial Data Root Directory]/input/unprocessed/` directory.
   
4. **Read Company Information (Crucial for AP/AR Judgment)**
   - Read `[Financial Data Root Directory]/resources/company.json` to get our company's tax ID and name.

5. **Examine and Analyze Files Individually**
   - Use your vision capabilities (to read images) or text capabilities (to read CSV/Excel preview summaries).
   - Extract the core beacons:
     - **Who** (Counterparty name)
     - **When** (Date/Receipt time)
     - **What** (VAT invoice / chat order / WeChat bill, etc.)

6. **Determine Target Classification and New Filename**
   - Use the **Classification Rules** below to decide which target folder it belongs to.
   - Assemble a standardized filename format (e.g., `2024-01-01_SupplierName_Invoice.jpg`).

7. **Generate Classification Report JSON**
   - Summarize the **original filename, source path, target path, and document category** of all files into a JSON, and save it to `[Financial Data Root Directory]/output/classification/report_YYYY-MM-DD_HHmmss.json` (accurate to the second, supporting multiple classifications in one day without conflict).
   - The report itself is an audit trail: after files are moved and renamed, the original filename is only retained in this JSON. Ensure the `original_filename` field is filled out accurately.
   - Reports are append-only. The accumulated historical reports form a complete file archiving audit record.

8. **Execute Physical Move (Run Script)**
   - Run the archiving script, based on the JSON you just generated, to physically move and rename the files:
   ```bash
   npx tsx <Absolute Path to this Skill>/scripts/move-files.ts <Absolute Path to Data Root>/output/classification/<report-filename>.json
   ```
   > Note: Different AI tools install Skills in different directories (OpenClaw: `skills/`, Claude Code: `.claude/skills/`, Antigravity: `.agents/skills/`). Adjust the path accordingly.

9. **Next Step Recommendations**
   - After classification is complete, summarize and tell the user: "Found X AP invoices, Y reimbursement invoices, Z AR documents, and N bank statements".
   - Recommend the next step: for example, "Would you like me to call `invoice-extraction` on these AP invoices now to extract information?"
   - For reimbursement invoices, remind the user: "Found Y reimbursement invoices, you can batch extract them later and run the reimbursement process (`expense-reimbursement`)."

---

## Classification Rules and Target Directories

The system needs to distribute the raw files to the following target directories. If target directories do not exist, the script will create them automatically:

### 1. Accounts Payable (AP) Invoices
- **Features**: Standard VAT special/general/digital invoices, the buyer is our company, comes from a supplier.
- **Conditions**:
  - The invoice's `buyer.tax_id` matches the `tax_id` in our `company.json`.
  - Alternatively, `buyer.name` is our company.
  - And it is **not** a reimbursement invoice (see reimbursement classification below).
- **Target Directory**: `input/ap-invoices/`
- **Rename Format**: `YYYY-MM-DD_CounterpartyName(Seller)_Amount.ext`

### 2. Reimbursement Invoices
- **Features**: Invoices paid out of pocket by employees for reimbursement. The difference from plain AP is the **business attribution**, which requires separate tracking during audits.
- **Conditions** (matching any leans towards reimbursement):
  - 🚗 **Transportation**: Train tickets, flight itineraries, taxi/Didi receipts, highway tolls.
  - 🏨 **Accommodation**: Hotel invoices.
  - 🍽️ **Dining**: Catering service invoices (especially small amounts).
  - 👤 **Buyer is Individual**: The invoice buyer name is not the company but an individual's name.
  - 📎 **Small & Scattered**: Multiple small amount invoices (looks like a batch of receipts from a single business trip).
- **When Unsure**: If features are not obvious (like a standard office supplies invoice), default to AP and note "Possibly reimbursement, please confirm" in `review_reason`.
- **Target Directory**: `input/reimbursement/`
- **Rename Format**: `YYYY-MM-DD_ExpenseType_Amount.ext` (e.g., `2024-01-15_Didi_35.00.jpg`)

### 3. Accounts Receivable (AR) Documents
- **Features**: Invoices issued to others, or customer **chat screenshots** (saying "payment sent", "please ship", etc. that can serve as business vouchers), sales contract screenshots.
- **Conditions**:
  - The invoice's `seller.tax_id` is our company.
  - Alternatively, the screenshot content is clearly communicating sales business or confirming receipt of funds with a customer.
- **Target Directory**: `input/ar-documents/`
- **Rename Format**: `YYYY-MM-DD_CustomerName_AmountSummary.ext`

### 4. Bank/Payment Statements
- **Features**: Reconciliation files downloaded from WeChat Pay, Alipay, or Bank portals (usually `*.xlsx` or `*.csv`), or full-screen long screenshots of online banking statements.
- **Target Directory**: `input/bank-statements/`
- **Rename Format**: `YYYY-MM_PaymentChannelOrBankName_Statement.ext` (e.g., `2024-01_WeChatPay_Statement.xlsx`)

### 5. Articles/News Excerpts
- **Features**: WeChat Official Account article screenshots, long webpage article screenshots, etc., which are non-statement/financial knowledge records.
- **Target Directory**: `input/articles/`
- **Rename Format**: `YYYY-MM-DD_PlatformOrAuthor_ArticleTitle.ext`

### 6. Unclassified (Needs Confirmation)
- **Features**: Blurry images, images where date/amount/counterparty cannot be extracted, completely irrelevant everyday chats, etc.
- **Target Directory**: `input/unclassified/`
- **Action**: Note `needs_review: true` and the reason in the JSON report.

---

## Classification Report JSON Format

After analyzing all files, you **must generate a JSON array in the following format**:

```typescript
type ClassificationReport = {
  classified_at: string;            // Classification execution time "YYYY-MM-DD HH:mm"
  files: Array<{
    original_filename: string;      // Original filename, e.g., "IMG_1234.jpg" (the only traceability source after renaming)
    source_path: string;            // The full relative path of the original file, e.g., "input/unprocessed/IMG_1234.jpg"
    target_path: string;            // New target path after classification, e.g., "input/ap-invoices/2024-01-15_Didi_100.00.jpg"
    document_category: "ap-invoice" | "reimbursement" | "ar-document" | "bank-statement" | "article" | "unclassified";
    identified_info: {
      date: string;                 // Identified receipt date "YYYY-MM-DD"
      counterparty: string;         // Counterparty name (e.g., supplier, customer, official account name)
      amount_hint: string;          // Hint for amount or key numerical value, empty if none
      summary: string;              // Content summary (1 sentence), convenient for later lookup
    };
    needs_review: boolean;          // Whether manual confirmation is needed due to blurriness/ambiguity
    review_reason: string;          // Reason for confirmation (empty string if no confirmation needed)
  }>;
};
```

> **Regarding Original Filename Traceability**: After files are moved and renamed, `original_filename` is the only way to trace them back.
> Reason for using Move + Rename (instead of Copy): To avoid doubling file storage space, and to avoid managing an extra "original archive directory".
> The JSON report itself serves as the audit ledger, retaining the complete mapping of `original name -> new name -> classification result`.

---

## Example Flow Conversation

**User**: Please help me sort out the stuff I just sent into input/unprocessed.
**Agent**:
1. `Read input/unprocessed` found 7 files.
2. Looking at the images one by one:
   - 1 office supplies invoice (buyer is our company) → AP Invoice
   - 1 Didi taxi invoice → Reimbursement
   - 1 Atour hotel invoice → Reimbursement
   - 1 train ticket → Reimbursement
   - 1 transfer screenshot from a chat with a customer → AR Document
   - 1 WeChat pay bill xlsx → Bank Statement
   - 1 long screenshot of an article on tax law from an official account → Article Archive
3. Generate `output/classification/report_2024-01-15_143052.json`.
4. Run `move-files.ts` to complete the transfer and rename.
   - "Classification completed! 1 AP invoice, 3 reimbursement invoices, 1 AR document, 1 bank statement, 1 article archived."
   - "The 3 reimbursement invoices (Didi+Hotel+Train) look like they are from the same business trip, they can be batch extracted to go through the reimbursement process later."
   - "Would you like to call `invoice-extraction` on the AP invoice now for information extraction?"
