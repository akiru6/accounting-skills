# Accounting Skills | 财务自动化 AI 技能包

A set of AI agent skills designed for automated financial document processing, extraction, and posting. 
一套专为 AI Agent 设计的财务自动化技能包，支持文档处理、信息提取、自动对账与凭证生成。

---

## 🚀 The Pipeline | 自动化流程

The automation consists of 5 core skills running in sequence:
整套流水线由 5 个核心技能串联组成：

### 0. 🛠 `project-init` | 系统初始化
- **EN**: Helps users set up the standard directory structure and configuration templates (`company.json`, `coa.json`) in a new workspace.
- **CN**: 帮助用户在新工作区快速搭建标准目录结构，并生成必要的配置模板（公司信息、科目表等）。

### 1. 📂 `document-classifier` (New) | 文档智能分类
- **EN**: The entry point. Reads unprocessed images, PDFs, and bank statements, uses vision AI to determine types, and moves them to target business folders.
- **CN**: 自动化入口。识别原始文件夹中的图片、PDF和流水表，通过 AI 视觉判定单据类型并分拣至对应的业务目录。

### 2. 🔍 `invoice-extraction` | 发票信息提取
- **EN**: Extracts structured data (seller, items, amounts) from invoices. Standardizes data into machine-readable JSON.
- **CN**: 从发票中提取结构化数据（销售方、项目明细、金额等），并将结果标准化为 JSON 格式。

### 3. 💸 `expense-reimbursement` (New) | 报销自动化
- **EN**: Processes reimbursement documents (taxi receipts, hotel invoices). Summarizes out-of-pocket expenses and matches against COA templates.
- **CN**: 处理员工报销文档（滴滴、酒店、火车票）。汇总个人垫付支出，并根据会计科目表（COA）自动匹配入账科目。

### 4. 📝 `invoice-posting` | 自动对账与入账
- **EN**: Takes verified data and generates the final Journal Entries (debits/credits) mapped to your financial system.
- **CN**: 读取已验证的单据数据，自动生成符合财务系统要求的会计凭证（借贷分录）。

---

## 🛠 Project Structure | 项目结构

**⚠️ Note on Data Privacy | 数据隐私说明**: 
The scripts and configurations in this repository do **not** contain any actual business data. Directories like `input/`, `output/`, and the actual `resources/company.json` are excluded from version control via `.gitignore`.
本仓库仅包含逻辑代码与配置模板，**不包含任何真实业务数据**。`input/`（输入单据）、`output/`（结果报告）以及包含真实税号的配置文件均已通过 `.gitignore` 排除在外。

## 📥 Installation | 安装与使用

```bash
# Clone the repository
git clone https://github.com/akiru6/accounting-skills.git

# Copy skills to your agent's directory (example)
# 将技能文件夹拷贝至你的 Agent 运行目录：
cp -r document-classifier/ ~/.agents/skills/
```
