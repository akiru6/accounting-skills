# SkillBooks · Accounting Skills Playbook

> Open-source AI Agent Skills for Chinese accounting workflows.

开源会计财务 Agent Skills —— 让 AI Agent 具备专业的会计处理能力。

> 🧾 **当前可用 Skills**：发票信息提取 + 会计过账
>
> 🔮 **未来规划**：报销模块（差旅、航空客票行程单等）、银行对账、税务申报...

---

## 📖 什么是 Skills？

Skills 是一套标准化的指令文件（`SKILL.md`），让任何 AI Agent 都能执行特定的专业任务。你可以把它理解为 **"AI 的 SOP 手册"** — 不依赖特定的 Agent 平台，任何支持 Skills 的 Agent 都可以直接使用。

**兼容的 Agent 平台**：Claude Code、Antigravity、OpenClaw / 龙虾仔，以及任何支持 `.agents/skills/` 目录的 Agent。

**模型要求**：无特殊要求，Gemini Flash 等主流模型即可胜任。

---

## 🧩 Skills 清单

### 1. `invoice-extraction` — 发票信息提取

从中国增值税发票（图片、PDF 或 OCR 文本）中**精准提取**所有关键字段，输出结构化 JSON。

**支持的发票类型**：
| 类型 | 说明 |
|------|------|
| 增值税专用发票 | 可抵扣进项税，提取完整购销方信息 |
| 增值税普通发票 | 不可抵扣，仍需完整提取 |
| 电子发票（专票/普票） | 同上，数据通常更清晰 |
| 全面数字化的电子发票（数电票） | 无发票代码，发票号码为 20 位 |

**功能**：
- 📋 按标准 JSON Schema 逐字段提取
- ✅ 自动校验（字段完整性 + 金额格式 + 算术一致性）
- 📊 导出 Excel 台账（`发票管理.xlsx`），支持追加和去重

### 2. `invoice-posting` — 会计过账 / 记账

根据提取的发票 JSON 和企业会计科目表 (COA)，**自动推断并生成会计分录**（Journal Entry）。

**核心能力**：
- 🔍 **自动判断发票方向**：通过 `company.json` 中的税号与发票买卖方比对，自动识别采购 / 销售
- 📒 **智能科目匹配**：基于 COA 中的关键词匹配最合适的会计科目
- 💰 **税务处理**：专票进项税抵扣 / 普票全额入费用 / 销售销项税计提
- ✅ **借贷平衡校验** + **COA 合规检查**
- 📊 导出至 Excel 台账（`发票管理.xlsx` 的「过账分录」sheet）

**支持的业务场景**：

| 方向 | 分录格式 | 状态字段 |
|------|---------|---------|
| 采购 (`purchase`) | 借：费用/资产 + 进项税 → 贷：应付/银行/现金 | `payment_status` |
| 销售 (`sales`) | 借：应收/银行/现金 → 贷：收入 + 销项税 | `collection_status` |

---

## 🚀 快速开始

### 1. 安装到你的 Agent 项目

将 Skills 复制到你的项目的 `.agents/skills/` 目录下：

```bash
# 克隆本仓库
git clone https://github.com/akiru6/accounting-skills.git

# 复制到你的项目中
cp -r accounting-skills/invoice-extraction your-project/.agents/skills/
cp -r accounting-skills/invoice-posting your-project/.agents/skills/

# 安装脚本依赖
cd your-project/.agents/skills/invoice-extraction/scripts && npm install
cd your-project/.agents/skills/invoice-posting/scripts && npm install
```

### 2. 配置你的公司信息

编辑 `invoice-posting/resources/company.json`，填入你的公司名和税号：

```json
{
    "company_name": "My Company / 我的一人公司",
    "tax_id": "91XXXXXXXXXXXXXXXX"
}
```

> 系统通过税号自动判断发票方向（采购 or 销售），所以这一步**必须配置**。

### 3. 配置会计科目表 (COA)

参考 `invoice-posting/resources/example_coa.json`，根据你的实际业务创建 `coa.json`。
示例 COA 已包含常用科目（管理费用、销售费用、应付/应收账款等），你可以直接在此基础上调整。

### 4. 开始使用

对你的 Agent 说：

```
帮我提取这张发票的信息 <发票图片路径>
```

Agent 会自动调用 `invoice-extraction` Skill 完成提取、校验，并询问你是否需要录入台账或继续过账。

---

## 📁 项目结构

```
accounting-skills/
├── invoice-extraction/          # 发票信息提取 Skill
│   ├── SKILL.md                 # Skill 指令文件
│   └── scripts/
│       ├── validate.ts          # JSON 校验脚本
│       ├── export-to-excel.ts   # 导出 Excel 台账
│       └── package.json
│
├── invoice-posting/             # 会计过账 Skill
│   ├── SKILL.md                 # Skill 指令文件
│   ├── resources/
│   │   ├── company.json         # 你的公司信息（需自行配置）
│   │   └── example_coa.json     # 示例会计科目表
│   └── scripts/
│       ├── validate.ts          # 过账结果校验
│       ├── export-to-excel.ts   # 导出 Excel 台账
│       └── package.json
│
├── .gitignore
└── README.md
```

---

## 🛠️ 技术栈

- **Skills 格式**：Markdown（SKILL.md），兼容任何支持 Agent Skills 的平台
- **校验 & 导出脚本**：TypeScript（通过 `tsx` 运行）
- **Excel 处理**：`xlsx` 库
- **运行环境**：Node.js

---

## 🗺️ Roadmap

- [x] 发票信息提取（增值税专票 / 普票 / 数电票）
- [x] 会计过账（采购 + 销售方向）
- [ ] 报销模块（差旅费、航空客票行程单等）
- [ ] 提取 Schema 扩展（行程单、火车票等特殊票种）
- [ ] 银行对账
- [ ] 更多...

---

## 📄 License

MIT
