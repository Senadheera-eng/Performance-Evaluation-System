# PES documentation

Study guides for the Performance Evaluation System, updated 30 October 2026 to describe the `feature/UI` branch and the live database on that date.

The guides are Word documents (`.docx`) for reading and printing. Each one is built from the Markdown file of the same name in [`source/`](source/), which can also be read here on GitHub.

## Start here

| Guide | Read it to learn | Markdown |
|---|---|---|
| [0 — Start Here](PES_Guide_0_Start_Here.docx) | Which guide answers which question, three reading orders, and a glossary | [source](source/0_start_here.md) |
| [1 — System Overview](PES_Guide_1_System_Overview.docx) | What PES is, who uses it, its architecture, how a request travels, what has changed | [source](source/1_system_overview.md) |
| [2 — Database](PES_Guide_2_Database.docx) | Every table, the rule settings, storage, extensions, the nightly job, and every function by area | [source](source/2_database.md) |
| [3 — Login, Roles and Permissions](PES_Guide_3_Login_Roles_Permissions.docx) | Signing in, roles, route guards, and an account's life (invite, reset, deactivate) | [source](source/3_login_roles_permissions.md) |
| [4 — Security and Row Level Security](PES_Guide_4_Security_and_RLS.docx) | Who can see what, how the database and the Edge Functions refuse, past findings, testing a rule | [source](source/4_security_and_rls.md) |
| [5 — Features and Data Flows](PES_Guide_5_Features_and_Data_Flows.docx) | Each feature step by step, from click to database | [source](source/5_features_and_data_flows.md) |
| [6 — Code Structure](PES_Guide_6_Code_Structure.docx) | The React app: routes, layouts, services, the design system, conventions | [source](source/6_code_structure.md) |
| [7 — Configuration and Operations](PES_Guide_7_Configuration_and_Operations.docx) | Settings and secrets, deploying, migrations, the nightly job, scripts, the release checklist | [source](source/7_configuration_and_operations.md) |
| [The AI Assistant](PES_Guide_AI_Assistant.docx) | The assistant end to end | [source](source/ai_assistant.md) |
| [RAG and the 14 tools, explained](PES_Guide_AI_Assistant_RAG_Explained.docx) | The assistant in plain English | [source](source/ai_assistant_rag_explained.md) |

Suggested order for a developer: 0, 1, 3, 4, 2, 5, 6, 7, then the AI guides. Guide 0 gives shorter orders for other readers.

## Also here

| File | What it is |
|---|---|
| [local-llm.md](local-llm.md) | Running the assistant on the faculty's own computer with Ollama, measured on a CPU with no GPU |
| [ui-ux-audit.md](ui-ux-audit.md) | The audit of every screen and the plan behind the October 2026 redesign, with its status |
| [parse_handbook_curriculum.py](parse_handbook_curriculum.py), [handbook_curriculum_extract.tsv](handbook_curriculum_extract.tsv) | How the curriculum tables were read out of the Faculty Handbook, and the result |

## Changing a guide

Edit its Markdown in `source/`, then rebuild the Word files:

```bash
python3 docs/source/build_guides.py               # every guide
python3 docs/source/build_guides.py 2_database    # one guide
```

The build needs only Python 3. Its header comment describes the small Markdown dialect it reads (headings, lists, tables, notes, the "why" and warning boxes, code). `source/template.docx` holds the styles, numbering and footer the guides share.
