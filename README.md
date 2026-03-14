# Accounting Skills

A set of AI agent skills designed for automated financial document processing, extraction, and posting. These skills can be integrated into your AI agent environment (like OpenClaw, Claude Code, etc.) to form an end-to-end accounting pipeline.

## 🚀 The Pipeline (Workflow)

The automation consists of 5 core skills running in sequence:

### 0. 🛠 `project-init`
- **Purpose**: Helps users set up the standard directory structure and configuration templates (`company.json`, `coa.json`) in a new workspace.

### 1. 📂 `document-classifier` (New)
**Status: ✅ Active**
- **Purpose**: The entry point of the pipeline. Reads unclassified images, PDFs, and bank statements from an input folder, uses vision/language AI to determine document types, and moves them to correct business folders.
- **Outputs**: Generates an audit-ready JSON report of the classifications.

### 2. 🔍 `invoice-extraction`
**Status: ✅ Active**
- **Purpose**: Extracts structured data (seller, buyer, items, amounts, taxes) from AP/AR invoice images or PDFs.
- **Outputs**: Standardization of invoices into machine-readable JSON data formatting.

### 3. 💸 `expense-reimbursement` (New)
**Status: ✅ Active**
- **Purpose**: Processes employee reimbursement documents (taxi receipts, train tickets, hotel invoices). Summarizes out-of-pocket expenses and matches them against Chart of Accounts (COA) templates.
- **Outputs**: Ready-to-post reimbursement summary payload.

### 4. 📝 `invoice-posting`
**Status: ✅ Active**
- **Purpose**: Takes the verified and extracted invoice data or reimbursement payload, maps them against your financial system's accounts, and generates the final Journal Entries (debits/credits).

---

## 🛠 Project Structure

When properly initialized (e.g. using `project-init`), the workspace expects standard directories for separating logic from data. 

**⚠️ Note on Data Privacy**: 
The scripts and configurations in this repository do **not** contain any actual business data. 
Directories like `input/`, `output/`, and the actual `resources/company.json` are meant to be kept strictly local and are excluded from version control.

## 📥 Installation

```bash
# Clone the repository
git clone https://github.com/akiru6/accounting-skills.git

# The skills can be directly referenced or copied into your agent's skills folder:
# cp -r document-classifier ~/.agents/skills/
```

## 📄 Configuration Template

The pipeline relies on basic templates, such as:
- `company.json` (Determines AP vs AR based on tax ID)
- `coa.json` (Chart of Accounts for automated GL mapping)

*(See the respective folders and `example` configs for details.)*
