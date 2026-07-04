# SheetKiller Implementation Plan

## 1. 当前结论

本轮调研后，SheetKiller 的最佳实施路线不是从零写 `dynamic-fill-solution`，也不是直接 fork 某一个项目整体照搬，而是采用组合方案：

```text
form-pilot 作为主底座
  + auto-filler 的 LLM 语义匹配层
  + SheetKiller 自己的 verifier / safety guard / report
```

原因：

- `form-pilot` 的强项是中文招聘表单、通用填写器、完整事件序列、custom select、radio/checkbox 实战兼容、memory/draft/UI，以及 232 个测试。
- `auto-filler` 的强项是 LLM semantic matching、OpenAI-compatible provider、丰富字段上下文提取、confidence 输出。
- 两者都缺少 SheetKiller 必须有的三个核心安全组件：
  - expected-vs-actual verifier。
  - never-submit 代码级 guard。
  - filled/skipped/uncertain/failed report。

`nanobrowser` 不作为主线，只作为未来 agent fallback 参考。`form_filler_extension` 和 `smartfill-ai` 只作为小型参考，不投入主改造。

## 2. 总体产品目标

SheetKiller 的目标体验保持不变：

```text
打开网申表单 -> 本地资料生成填表计划 -> 自动填一版草稿 -> 报告已填/跳过/不确定/失败 -> 用户人工复核并最终提交
```

关键边界：

- 自动化只负责填表草稿。
- 不绕过 CAPTCHA、短信、二维码、身份验证。
- 不自动上传文件，除非用户明确选择本地文件并确认。
- 永远不点击最终提交或确认提交按钮。
- 所有敏感资料默认只保存在 `D:\ToolProjectCode\SheetKiller` 本地。

## 3. 目录规划

`external/` 继续作为候选项目和调研材料存放区，不在其中直接开发 SheetKiller 主功能。

建议新增：

```text
D:\ToolProjectCode\SheetKiller
  dynamic-fill-solution/
    README.md
    package.json
    wxt.config.ts
    tsconfig.json
    LICENSE-NOTICES.md

    extension/
      entrypoints/
        background.ts
        content.ts
        popup/
        dashboard/
      lib/
        scanner/
        planner/
        executor/
        verifier/
        safety/
        report/
        memory/
        profile/
        providers/
        platform-adapters/
        shared/
      tests/
        unit/
        integration/
      test-pages/
        basic-form.html
        react-controlled.html
        custom-select.html
        cascader-region.html
        chinese-recruitment-form.html

    e2e/
      extension-load.spec.ts
      generic-fill.spec.ts
      verifier.spec.ts
      never-submit.spec.ts

    reports/
      .gitkeep
```

说明：

- `dynamic-fill-solution/extension` 是实际改造后的 Chrome extension 项目。
- `external/candidate-*` 保持原样，用于对照和许可证追溯。
- `reports/` 存放本地执行报告，必须 gitignore。
- `test-pages/` 放本地测试页面，避免一开始就在真实招聘网站上测试。
- 后续如果仍需要 Python/Playwright 主控，可以放在：

```text
dynamic-fill-solution/scripts/
  run_extension_probe.py
  run_e2e_local.py
```

但 MVP 优先做 extension 自身闭环。

## 4. 代码来源和复用策略

### 4.1 主体来源：form-pilot

从 `external/candidate-03-form-pilot` 迁移或保留的核心能力：

- `lib/engine/scanner.ts`
- `lib/engine/heuristic/fillers.ts`
- `lib/engine/heuristic/patterns.ts`
- `lib/engine/heuristic/signals.ts`
- `lib/engine/orchestrator.ts`
- `lib/capture/native-set.ts`
- `lib/capture/widget-proxy.ts`
- `lib/capture/sensitive.ts`
- `lib/capture/serializer.ts`
- `lib/capture/restorer.ts`
- `lib/storage/*`
- `lib/import/*`
- popup/dashboard UI 基础结构
- 现有测试体系

这些模块作为 SheetKiller 的 deterministic executor、memory、draft、profile UI 基础。

### 4.2 LLM 来源：auto-filler

从 `external/candidate-01-auto-filler` 迁移或改写的核心能力：

- `utils/matcher.ts` 的 prompt 构建思路。
- OpenAI-compatible provider 调用方式。
- confidence 输出结构。
- stream matching 思路，后续可选。
- `entrypoints/content.ts` 中更丰富的字段上下文提取：
  - nearby text。
  - context root。
  - sanitized HTML。
  - aria-owned / aria-controls options。
  - rendered size / fillMode。

必须修正：

- 所有实际填充路径补 `blur`。
- 不使用 auto-filler 的薄弱 custom dropdown 填充逻辑。
- 不让 LLM 直接成为唯一匹配来源。

### 4.3 许可证处理

- `form-pilot` 是 MIT。
- `auto-filler` 是 Apache-2.0。
- MIT 与 Apache-2.0 可兼容复用。

要求：

- 在 `dynamic-fill-solution/LICENSE-NOTICES.md` 记录代码来源、仓库 URL、commit、许可证。
- 从 auto-filler 迁移的文件或明显派生文件保留 Apache-2.0 版权声明。
- 从 form-pilot 迁移的文件保留 MIT 版权声明或在 notices 中明确归属。
- 不把 `external/` 里的 `.git`、`node_modules`、构建产物纳入主项目。

## 5. 核心架构

### 5.1 分层结构

```text
Profile Layer
  - 管理 profile.json / cv.md / 简历导入。
  - 生成结构化 profile facts。
  - 保留 provenance：每个值来自哪个字段或哪段简历。

Scanner Layer
  - 基于 form-pilot scanner。
  - 加入 auto-filler 的 enriched context。
  - 输出统一 FieldInventory。

Planning Layer
  - 先走 deterministic cascade：
      platform adapter -> memory -> heuristic
  - 对未识别或低置信字段调用 LLM。
  - LLM 输出 FillPlan，不直接操作页面。

Execution Layer
  - 基于 form-pilot fillers。
  - 完整事件序列：focus -> input -> change -> blur。
  - 支持 text/select/radio/checkbox/date/contenteditable/custom-select。

Verification Layer
  - 比对 expected value 和 actual page value。
  - 不能只检查 non-empty。
  - 生成 verified/mismatch/unverifiable。

Safety Layer
  - 阻止 final submit。
  - 跳过 CAPTCHA/password/verify code/upload/identity check。
  - 限制低置信字段自动填写。

Report Layer
  - 输出 filled/skipped/uncertain/failed/mismatch。
  - 本地保存 JSON/Markdown。
```

### 5.2 统一数据结构

#### FieldInventory

```ts
interface FieldInventoryItem {
  fieldId: string;
  elementRef: Element;
  inputType:
    | 'text'
    | 'textarea'
    | 'select'
    | 'radio'
    | 'checkbox'
    | 'date'
    | 'custom-select'
    | 'contenteditable'
    | 'file'
    | 'unknown';
  label: string;
  hint: string;
  placeholder: string;
  ariaLabel: string;
  name: string;
  id: string;
  section: string;
  context: string;
  htmlSnippet: string;
  options: string[];
  currentValue: string;
  required: boolean;
  visible: boolean;
  sensitiveType?: 'id_card' | 'phone' | 'email' | 'password' | 'captcha' | 'verify_code' | 'bank_card' | 'upload';
  source: 'adapter' | 'heuristic' | 'generic-scan';
}
```

#### ProfileFact

```ts
interface ProfileFact {
  path: string;
  label: string;
  value: string;
  aliases: string[];
  sensitive: boolean;
  provenance: 'profile.json' | 'cv.md' | 'resume-import' | 'manual';
}
```

#### FillPlanItem

```ts
interface FillPlanItem {
  fieldId: string;
  profileSource: string;
  expectedValue: string;
  strategy:
    | 'text'
    | 'select'
    | 'radio'
    | 'checkbox'
    | 'date'
    | 'custom-select'
    | 'cascader-region'
    | 'contenteditable'
    | 'skip';
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  source: 'adapter' | 'memory' | 'heuristic' | 'llm' | 'generated';
  safety:
    | 'fill'
    | 'fill_requires_review'
    | 'skip_sensitive'
    | 'skip_upload'
    | 'skip_low_confidence'
    | 'skip_unknown'
    | 'skip_generated';
}
```

#### FillResult

```ts
interface FillResult {
  fieldId: string;
  label: string;
  profileSource?: string;
  expectedMasked?: string;
  actualMasked?: string;
  status:
    | 'filled_and_verified'
    | 'filled_but_mismatch'
    | 'filled_but_unverifiable'
    | 'skipped_low_confidence'
    | 'skipped_sensitive'
    | 'skipped_requires_human'
    | 'failed_to_fill';
  reason: string;
}
```

## 6. Planner 级联策略

建议顺序：

```text
1. platform adapter
2. page memory / previous answer
3. heuristic pattern
4. LLM semantic matcher
5. skip and report
```

细节：

- `adapter`：只用于确定性很强的平台，例如 Moka，后续再扩展。
- `memory`：只复用历史已验证成功的字段映射。
- `heuristic`：高置信字段直接进入 fill plan。
- `LLM`：只处理未识别或低/中置信字段，降低 API 成本。
- `skip`：低置信、敏感、上传、验证码、无法回读的字段不猜。

LLM 输入：

- FieldInventory 子集。
- ProfileFact 列表。
- options 列表。
- safety policy。

敏感信息输入规则：

- `ProfileFact.sensitive === true` 的资料不允许把真实 `value` 发给 LLM。
- 发给 LLM 的敏感 fact 只能包含 `path`、`label`、`aliases`、`provenance` 和一个布尔标记，例如 `hasValue: true`。
- 例如身份证、手机号、邮箱可以让 LLM 判断“这个网页字段应该匹配 profile.id_number”，但不能让 LLM 看到身份证号、手机号、邮箱原文。
- LLM 输出 `profileSource` 后，由本地 resolver 从真实 profile 中取值。
- 调试日志、console、report 中都不得打印敏感原值。

LLM 输出原则：

- 优先输出 `profileSource`，不是裸值。
- 需要展示值时，由本地 resolver 计算 `expectedValue`。
- 对下拉/单选必须选择 options 中已有文本。
- 无法确定则 skip。

生成类字段规则：

- 默认策略：开放性问题和需要主观生成的字段一律 `skip_generated`，交给用户人工填写。
- 示例：`为什么选择我们公司`、`自我评价`、`职业规划`、`开放性问答`。
- 后续如果启用生成能力，必须使用 `source: 'generated'` 和 `safety: 'fill_requires_review'`，并在 UI 中单独展示“AI 生成，需人工审核”。
- 生成内容不得自动提交，也不得覆盖用户已有输入。
- 在 MVP 阶段不自动填写生成类字段。

## 7. Verifier 设计

Verifier 必须验证“对不对”，不能只验证“有值”。

比对规则：

- text/email：normalize 后 exact match。
- phone/id card：本地完整比对，报告只显示 masked。
- 日期：统一成 `YYYY-MM-DD` 后比对。
- select/radio/custom-select：读取页面显示文本，与 expected option 文本比对。
- cascader-region：读取最终显示文本或隐藏 value，并与 expected 的省/市/区 token 比对；不能只验证非空。
- checkbox：比对 checked 状态。
- 地区/籍贯：不能接受“全国”这类泛化值；至少要命中 expected 的省/市/区关键 token。
- 占位符：如果页面实际值仍包含 `x_id_number`、`x_phone`、`x_email` 等，占位符，直接 mismatch。

报告脱敏：

```text
身份证: **************1234
手机号: *******1234
邮箱: l***@example.com
```

Verifier 输出直接决定 report 状态。

## 8. Safety Guard 设计

### 8.1 DOM 级 submit guard

Content script 应阻止自动流程点击这些按钮：

```text
submit
confirm submit
提交
确认提交
最终提交
投递
确认投递
send application
apply now
```

策略：

- 自动填表流程不调用 submit/click final buttons。
- 在 executor 内，如果目标元素被识别为 final submit，直接拒绝。
- 可选增加 capture-phase click listener，只在 SheetKiller 自动运行期间拦截疑似 final submit。
- 用户手动点击不应被长期拦截；自动运行结束后解除临时 guard。

### 8.2 敏感/人工字段

默认跳过：

- password。
- CAPTCHA。
- verify code。
- SMS code。
- bank card。
- file upload。
- ID verification。
- face recognition。

这些字段进入 report 的 `skipped_requires_human` 或 `skipped_sensitive`。

### 8.3 文件上传

文件上传默认不自动执行。后续如果支持：

- 必须由用户通过 file picker 选择文件。
- 必须在 UI 二次确认。
- report 明确记录文件名，不记录完整路径。

## 9. 测试计划

### 9.1 保留并迁移 form-pilot 测试

第一阶段目标：

```text
npm test
npm run build
```

必须通过。

### 9.2 新增单元测试

新增测试：

- LLM prompt builder。
- LLM response parser。
- profileSource resolver。
- verifier exact/masked/fuzzy rules。
- never-submit button classifier。
- report serializer。

### 9.3 本地页面集成测试

使用 `test-pages/`：

- `basic-form.html`
- `react-controlled.html`
- `custom-select.html`
- `cascader-region.html`
- `chinese-recruitment-form.html`

覆盖：

- native setter + blur。
- select visible text。
- radio sibling label。
- checkbox。
- date。
- custom select click/open/click option。
- province/city/district cascader open/select/verify。
- mismatch detection。
- submit guard。

### 9.4 Playwright extension-load spike

虽然 MVP 可先手动加载扩展测试，但仍应保留自动化 spike：

目标：

- 使用 `launch_persistent_context`。
- `headless=False`。
- 加载 `.output/chrome-mv3`。
- 验证 content script 可响应 ping。
- 验证 scan/fill/report API 可被测试脚本调用。

如果不稳定，改用：

```text
用户手动安装扩展到普通 Chrome
测试脚本通过 CDP 或手动流程辅助验证
```

## 10. 实施阶段

### Phase 0: 固定基线

目标：

- 确认 `form-pilot` 原始测试/构建稳定。
- 确认 `auto-filler` 原始构建稳定。
- 记录 commit 和许可证。
- 跑 `npm audit`，评估能否无痛修复 critical 漏洞。

产物：

- `dynamic-fill-solution/LICENSE-NOTICES.md`
- `dynamic-fill-solution/README.md`
- 依赖风险记录。

### Phase 1: 创建 SheetKiller extension 骨架

目标：

- 从 form-pilot 建立 `dynamic-fill-solution`。
- 保留 scanner/fillers/storage/tests。
- 改名为 SheetKiller Dynamic Fill。
- 确认 `npm test` 和 `npm run build` 通过。

不做：

- 不接真实 LLM。
- 不跑真实网申。

### Phase 1.5: 真实表单侦察 spike

目标：

- 在继续叠加 LLM、report UI、完整 safety guard 之前，先验证 executor 地基能否碰真实目标表单。
- 用户手动打开一个真实自研中文网申表单，例如讯飞校招表单。
- 不接 LLM。
- 不写入敏感字段。
- 只运行 scanner，并手写 1-2 个非敏感字段的 fill action。
- 优先选择低风险字段，例如姓名拼音测试字段、普通文本字段、非最终状态字段；不要碰身份证、手机号、上传、验证码、最终提交。
- 观察 React/Vue 状态是否真的保存，而不是只显示在 DOM 里。

通过标准：

- scanner 能识别足够多的真实字段。
- form-pilot 迁移过来的 filler 能让至少一个真实字段通过页面自身校验。
- 如果普通文本都失败，暂停后续 Phase，优先修 executor。
- 如果级联地区控件无法处理，记录 DOM 结构并进入 Phase 2.5 实现 cascader strategy。

### Phase 2: 引入 FieldInventory enrichment

目标：

- 将 auto-filler 的 context/html/options 提取能力整合到 scanner。
- 统一 FieldInventory 类型。
- 增加 tests。

重点：

- 不替换 form-pilot filler。
- 只增强扫描上下文。

### Phase 2.5: 实现 cascader-region strategy

目标：

- 把级联地区选择器作为一等策略实现，而不是放在风险清单里等待以后处理。
- 新增 `cascader-region.html` 本地测试页。
- 覆盖至少三类常见模式：
  - Ant Design Cascader 风格：点击输入框/触发器后出现多列浮层。
  - Element UI Cascader 风格：逐级 hover/click 后出现下一级。
  - 普通省/市/区多 select 联动。
- 支持按 profile 中的 `hometown`、`current_city`、`preferred_work_location` 拆分省/市/区 token。
- 不能把“全国”或空泛选项当作成功。

执行策略：

- 先识别候选 cascader trigger。
- 点击展开。
- 等待浮层出现。
- 逐级匹配 expected tokens。
- 每级点击后等待下一列/下一级刷新。
- 最终 blur/change。
- verifier 读取显示文本或隐藏 value，确认省/市/区 token 命中。

通过标准：

- 本地 `cascader-region.html` 通过。
- 至少在一个真实自研中文表单上完成只读侦察或低风险试填。
- 对无法识别的 cascader 输出 `skipped_requires_human`，不能猜。

### Phase 3: 引入 LLM planner

目标：

- 增加 `lib/planner/llm-planner.ts`。
- 支持 OpenAI-compatible API。
- 支持 model/baseUrl/apiKey 本地配置。
- 输出 FillPlanItem。
- LLM 只处理 heuristic 低置信或未识别字段。

安全要求：

- 不要求用户在聊天里粘贴 API key。
- API key 只存在 extension local storage 或项目 `.env` 辅助导入中。

### Phase 4: 强 verifier

目标：

- 每个填充动作后回读 actual。
- 与 expectedValue 比对。
- 产生 `filled_and_verified` 或 mismatch。
- 加入脱敏输出。

这是 SheetKiller 区分于普通 autofill 插件的核心能力。

### Phase 5: Report 与人工复核 UI

目标：

- 在 popup/dashboard 展示：
  - filled_and_verified。
  - mismatch。
  - skipped。
  - uncertain。
  - failed。
- 支持导出 JSON/Markdown 到本地 reports。

注意：

- 报告默认脱敏。
- 不写入云端。

### Phase 6: Safety guard

目标：

- executor 层禁止 submit。
- 临时 click guard 防止自动流程误点最终提交。
- 上传/验证码/身份验证进入人工处理队列。

测试：

- `never-submit.spec.ts` 必须覆盖中英文提交按钮。

### Phase 7: 真实表单受监督试跑

前置条件：

- 本地测试页全部通过。
- extension-load spike 结论明确。
- `.env` 或 extension settings 已本地配置，不能在聊天暴露 key。

流程：

- 用户手动打开真实表单。
- 用户完成登录/验证。
- SheetKiller 扫描。
- 先 dry-run 生成 plan/report，不填。
- 用户确认后 fill draft。
- 停在人工复核。

## 11. 依赖和安全维护

两个主要候选项目都有 npm audit critical 漏洞。改造前需要：

```powershell
cd D:\ToolProjectCode\SheetKiller\dynamic-fill-solution
$env:npm_config_cache='D:\ToolProjectCode\SheetKiller\tmp\npm-cache'
npm audit
npm audit fix
npm test
npm run build
```

原则：

- 先尝试非破坏性 `npm audit fix`。
- 如果需要 breaking upgrade，必须先记录影响，再单独处理。
- 不为了修 audit 破坏 WXT 构建和 form filler 测试。

## 12. 风险清单

| 风险 | 影响 | 处理 |
|---|---|---|
| MV3 service worker 生命周期不稳定 | LLM/后台消息偶发失败 | content script 保留重试；必要时 popup 主动重新注入 |
| Playwright 加载扩展不稳定 | 自动 E2E 难跑 | 独立 spike；失败则采用手动安装扩展 |
| LLM 错配字段 | 填错敏感信息 | confidence threshold + verifier + report |
| 自定义级联地区控件 | generic custom-select 不够 | 单独实现 cascader strategy |
| 真实站点 React/Vue onBlur 校验 | 值显示但状态未保存 | form-pilot 完整事件序列 + verifier |
| README 与实现不一致 | 误判能力 | 以源码和测试为准 |
| 依赖漏洞 | 敏感信息风险 | audit fix + 最小权限 + 本地存储 |

## 13. 最终推荐执行路线

短期最优路线：

```text
1. 以 form-pilot 建立 dynamic-fill-solution 主工程。
2. 保留并跑通它的测试和构建。
3. 移植 auto-filler 的 LLM matcher 和字段上下文提取。
4. 新增 verifier/safety/report。
5. 先在本地测试页和一个真实自研中文表单上验证 generic executor。
6. 再考虑平台 adapter 和 memory cache 的扩展。
```

暂不做：

- 不把 nanobrowser 作为主底座。
- 不直接沿用 auto-filler 的填充器。
- 不直接沿用 form_filler_extension。
- 不在真实表单上做无人监督提交。

这个计划的核心判断是：SheetKiller 的竞争力不是“能自动点网页”，而是“能把本地资料可靠、可验证、可回滚地填成一版草稿，并把最后决定权留给用户”。

## 14. SheetKiller v2: scan-first AI plan 工作流

### 14.1 背景

当前 `manual:probe` 模式已经证明了执行器路线是可行的：

```text
打开真实网页
  -> scan 页面字段
  -> 读取 manual-plan.example.json
  -> 按 index / label / strategy 填写
  -> verifier 回读结果
```

这个模式稳定、可调试、成本低，但缺点也很明显：`manual-plan.example.json` 需要提前维护。不同招聘系统的字段顺序、选项文案、学校/专业库、日期控件和级联控件都不一样，导致每个新站点都可能要手工修 plan。

v2 的核心目标是把主流程改成：

```text
scan 当前页面
  -> AI 结合 scan 结果和用户资料生成当前页面专属 fill plan
  -> 暂停，等待用户选择
     -> 开始填写
     -> 或只读预览填写方案
  -> fill
  -> 用户直接在真实网页上检查和手动修改
```

也就是说，AI 不直接操作网页。AI 只负责生成计划，执行仍由本地确定性 executor 完成。

### 14.2 产品定位

v2 以后有两种资料入口：

1. **手动上传 JSON**
   - 保留现有能力。
   - 适合调试、复现、离线使用、无 API 场景。
   - 也适合作为高级用户直接编辑 profile 的入口。

2. **AI 帮忙完善资料**
   - 用户上传 `cv.md`、PDF、docx，或粘贴简历文本。
   - AI 把简历解析成结构化 profile draft。
   - v2 主流程不做复杂 diff/review。
   - AI 完成后直接更新本地 profile，用户可以在资料页自行查看和手动修改。

资料准备完成后，v2 的填表主入口不再要求用户手写 plan，而是：

```text
当前网页 scan
  + 本地 profile
  + 当前站点历史记忆
  -> AI 生成 page-specific fill plan
```

### 14.3 v2 主流程

推荐主流程：

```text
1. 用户打开目标网申页面
2. 用户完成登录、验证码、必要的人机验证
3. 用户点击“扫描并填写”
4. SheetKiller scan 当前页面
5. planner 结合 profile 生成 FillPlan
6. UI 暂停在“填写方案已生成”
7. 用户选择：
   - “开始填写”：executor 立即执行填写
   - “检查填写方案”：打开只读预览，用户看完后再开始填写
8. 填写完成后提示用户在真实网页上检查和手动修改
9. 用户人工复核和最终提交
```

注意：最终提交仍然必须由用户手动完成。

这个流程刻意不把“复杂 plan review / report / debug”放入普通用户主流程。真实网页本身就是最终复核界面；插件只负责把草稿快速、尽量准确地填上去。

### 14.4 AI planner 输入

Planner 输入应该包含三类信息：

#### A. 当前页面 scan 结果

字段至少包括：

```ts
type FieldInventoryItem = {
  index: number
  type: 'text' | 'textarea' | 'custom-select' | 'cascader-region' | 'radio' | 'checkbox' | 'date' | 'file' | 'unknown'
  label: string
  context: string
  placeholder: string
  value: string
  options?: string[]
  disabled?: boolean
  readOnly?: boolean
  sensitive?: string
}
```

v2 需要特别增强 `options`：

- 对普通 select 直接读 option。
- 对 Element / Ant Design 下拉，点击展开后读 visible options。
- 对远程搜索学校/专业库，支持 debug/search 采样候选。
- 对依赖字段，planner 可以标记 `dependsOn`。

#### B. 本地 profile

Profile 是用户确认过的结构化资料，例如：

```ts
type Profile = {
  basic: {
    name: string
    gender: string
    idType: string
    idNumber: string
    birthDate: string
    phone: string
    email: string
    nationality: string
    hometown: string[]
  }
  education: EducationItem[]
  work: WorkItem[]
  projects: ProjectItem[]
  publications: PublicationItem[]
  skills: string[]
}
```

当前用户已经明确表示 v2 不需要优先考虑敏感值隔离，所以 planner 可以直接基于完整资料生成计划。不过仍然建议在 UI 上提示：如果使用云端模型，资料内容会发送给所选 AI provider。

#### C. 站点上下文和历史记忆

可以包括：

- 当前域名
- 页面 URL pattern
- 之前保存过的该站点 fill plan
- 用户手动修正记录
- 上一次 executor 失败原因摘要

这部分用于减少重复 token 消耗，也让同一个站点越用越准。

### 14.5 AI planner 输出

Planner 输出 `FillPlanItem[]`：

```ts
type FillPlanItem = {
  index: number
  label: string
  strategy: 'text' | 'textarea' | 'custom-select' | 'cascader-region' | 'radio' | 'checkbox' | 'date'
  value?: string
  sourcePath?: string
  expectedValue?: string
  valueKind: 'profile' | 'generated' | 'manual'
  confidence: number
  reason?: string
  searchValues?: string[]
  acceptValues?: string[]
  allowFreeText?: boolean
  dependsOn?: number[]
  reviewRequired?: boolean
}
```

重点字段：

- `index`：绑定当前 scan 字段。
- `strategy`：告诉 executor 如何填。
- `value`：最终要填的值。对 `profile` 类型字段，它可以由本地 resolver 根据 `sourcePath` 生成，而不是完全信任 AI。
- `sourcePath`：资料来源路径。对 `valueKind: 'profile'` 的字段必须存在，例如 `basic.email`、`education[1].school`。
- `expectedValue`：执行前由本地 resolver 从 profile 解析出的真值，用于 verifier。
- `valueKind`：区分资料字段、AI 生成字段、用户手动输入字段。
- `searchValues`：用于学校、专业、地区等远程搜索控件。
- `acceptValues`：只用于兼容页面选项文案差异，例如 `硕士` vs `硕士（Master）`，不能作为唯一真值来源。
- `dependsOn`：用于专业依赖专业类别、城市依赖省份等场景。
- `confidence`：用于方案预览里标记风险，不作为主流程强制拦截。
- `reviewRequired`：用于只读预览里提示用户重点看；v2 初期不做复杂审批流。

#### 独立 verifier 真值链

v2 不能让 AI 同时生成填充值和验证标准，否则 verifier 会退化为“AI 自己验证自己”。必须保留 v1 的独立真值链：

```text
AI planner 输出 sourcePath
  -> 本地 resolver 从 profile 解析 expectedValue
  -> executor 使用 expectedValue 填写
  -> verifier 用 expectedValue 和页面 actual 比对
```

规则：

- 对 profile 中已有事实的字段，`sourcePath` 必填。
- `expectedValue` 必须来自本地 profile resolver，而不是直接信任 AI。
- `acceptValues` 只能作为显示文案兼容，例如学校英文名、学历中英混排、选项附带说明。
- 如果 AI 生成了 profile 中不存在的内容，必须标记为 `valueKind: 'generated'`，并默认 `reviewRequired: true`。
- `generated` 字段可以被填写，但完成后必须在真实网页上高亮给用户检查。

### 14.6 页面专属 plan 缓存

每个站点第一次使用 AI 生成 plan，之后缓存：

```text
saved-pages/
  oppo-careers-resume.plan.json
  iflytek-zhiye-form.plan.json
```

缓存键建议由以下信息组成：

- hostname
- pathname pattern
- 表单字段 signature
- profile version

如果页面字段 signature 没变，则直接复用 plan；如果字段变了，则提示重新生成。

### 14.7 生成后暂停：开始填写或只读预览

AI plan 生成后不要立刻填写。UI 停在一个很轻的中间状态：

```text
填写方案已生成
预计填写 42 项，跳过 8 项

[开始填写] [检查填写方案]
```

#### A. 开始填写

用户点击后：

```text
正在填写...
已完成，5 项需要检查，已在页面上标出。请在网页上检查后手动提交
```

执行逻辑：

- executor 按 plan 执行。
- 每个字段执行前重新 scan，避免依赖字段状态过期。
- 失败字段不阻断全局流程。
- verifier 使用本地 profile resolver 得到的 `expectedValue` 做独立比对。
- 不进入复杂报告页，但必须在真实网页上高亮需要检查的字段。
- 完成提示给一个简短摘要，例如：

```text
已尝试填写 42 项，5 项需要检查，已在页面上标出。
```

页面高亮规则：

- 绿色细边：已填写且通过 verifier。
- 黄色边：低置信、格式兼容、或 verifier 只能通过 `acceptValues` 兼容通过。
- 红色边：填写失败、回读为空、或 `expectedValue` 与页面 actual 不一致。
- 蓝色边：AI 生成内容、开放题、或 `reviewRequired: true`。

popup 可以保留一个轻量列表，但不是报告页：

```text
需要检查 5 项
- 学校名称：候选项非完全匹配
- 专业：由 AI 推断
- 开放题：AI 生成内容
```

点击列表项时滚动到对应网页字段。这样用户不需要重新检查 42 项，只需要看页面上被标出的字段。

#### B. 检查填写方案

这是只读预览，不做可编辑 plan editor。预览内容保持轻量：

```text
学校名称 -> Chalmers University of Technology
学历 -> 硕士
专业类别 -> 计算机科学与技术
专业 -> 人工智能
```

对 `reviewRequired`、`generated`、低置信字段，在预览里加简单标记：

```text
开放题 -> AI 生成内容（需检查）
专业 -> 人工智能（低置信）
```

预览页底部只有：

```text
[返回] [开始填写]
```

后续如果真实使用中发现需要微调，再考虑增加可编辑能力。v2 初期不做复杂编辑器，以免产品复杂度膨胀。

### 14.8 和现有 manual plan 的关系

`manual-plan.example.json` 不废弃，降级为：

- 调试模式
- 无 API 模式
- 站点 plan 的导入/导出格式
- AI plan 的可编辑结果格式

也就是说，v2 生成的 plan 应该仍然能被当前 `manual:probe fill` 执行。

这样可以保证架构连续：

```text
v1 manual plan executor
  -> v2 AI generated plan
  -> 同一个 executor
```

### 14.9 实施阶段建议

#### Phase V2-0: 保留现状并冻结 executor 行为

目标：

- 当前 `manual:probe` 继续可用。
- 当前 `manual-plan.example.json` 继续可执行。
- 把报告里的 `options`、`reason`、`actual` 保持稳定。

通过标准：

- OPPO / 讯飞等真实页面手动 plan 仍能跑。
- `npm test` 通过。

#### Phase V2-1: AI 完善资料

目标：

- 在资料编辑 UI 里新增“AI 帮忙完善资料”入口。
- 支持粘贴简历文本或上传简历文件。
- 调用 OpenAI-compatible API 生成结构化 profile。
- 直接更新本地 profile。
- 完成后提示“资料已更新，可在资料页查看和修改”。

这一步不碰网页 fill，只优化资料准备。

#### Phase V2-2: Scan -> AI Plan

目标：

- 用户在真实页面点击“扫描并填写”。
- content script scan 当前页面。
- planner 基于 scan + profile 生成 FillPlan。
- 对 profile 字段，planner 必须输出 `sourcePath`。
- 本地 resolver 根据 `sourcePath` 生成 `expectedValue`。
- popup 展示“填写方案已生成”中间状态。
- 用户可以选择“开始填写”或“检查填写方案”。

通过标准：

- 不填网页也能生成 plan 并停住。
- profile 字段都有 `sourcePath`，不能只有 AI 生成的 `value`。
- 点击“开始填写”后才执行。
- “检查填写方案”只读预览可打开。

#### Phase V2-3: Start Fill

目标：

- 用户点击“开始填写”后，由 executor 填写。
- verifier 使用本地 `expectedValue` 独立验证，不只信任 AI `acceptValues`。
- 填写完成后给轻量完成提示。
- 失败、低置信、AI 生成、验证不一致字段在真实网页上高亮。
- 用户直接在真实网页上检查和手动修改。

通过标准：

- 同一页面第二次可以复用缓存 plan。
- 不打开复杂 report 页面。
- 需要检查的字段必须能在真实网页上直接定位。
- 不自动提交。

#### Phase V2-4: 站点记忆

目标：

- 记录某站点字段和 profile source 的映射。
- 记录 executor 失败原因摘要，例如 `option not found`、`field disabled`、`readback mismatch`。
- 下次生成 plan 时把这些历史作为上下文。

不做复杂用户可见报告。debug 能力保留在开发者工具或 hidden command 中。

### 14.10 风险和边界

主要风险：

| 风险 | 处理 |
|---|---|
| AI 错配字段 | profile 字段强制 `sourcePath`，本地 resolver 生成 `expectedValue`，verifier 独立比对 |
| verifier 被 AI acceptValues 带偏 | `acceptValues` 只做文案兼容，不能替代本地真值 |
| 学校/专业远程搜索库候选不可见 | debug options + searchValues + acceptValues |
| 页面字段 index 漂移 | 使用 field signature 辅助匹配 |
| 依赖字段未解锁 | FillPlanItem.dependsOn + 每项执行前重新 scan |
| 开放题生成内容不可靠 | 默认 `valueKind: generated` + `reviewRequired`，填写后蓝色高亮 |
| 只显示“5 项需检查”导致用户全量重查 | 在真实网页上高亮具体字段，并提供轻量跳转列表 |
| 同站点多页面表单 | 每页独立 scan/plan/cache |

### 14.11 Impeccable 作为 UI 设计 skill 的使用方式

`pbakaus/impeccable` 不是 SheetKiller 的用户功能，也不是运行时依赖。它是给 coding agent 使用的设计 skill / detector / 工作流，用来帮助我们把插件 UI 做得更像一个可信的产品工具。

仓库调研结论：

- 项目地址：`https://github.com/pbakaus/impeccable`
- 本地调研目录：`D:\ToolProjectCode\SheetKiller\external\impeccable`
- 定位：AI coding agent 的设计指导 skill。
- 能力：`init`、`shape`、`audit`、`critique`、`polish`、`harden` 等命令。
- 检测器：包含一批 deterministic UI anti-pattern rules。

SheetKiller 使用它的方式：

```text
1. 用 Impeccable 初始化 PRODUCT / DESIGN 语境
2. UI 实现前用 shape 规划信息架构和组件关系
3. UI 初稿完成后用 audit 检查可访问性、状态、布局、响应式问题
4. 交互细节完成后用 harden 检查错误态、空态、loading、文本溢出
5. 最后用 polish 做视觉一致性和产品可信度整理
```

SheetKiller 应按 Impeccable 的 **product UI** 路线设计，而不是 brand/landing page 路线：

- 安静、克制、信息密度合适。
- 不做营销式 hero。
- 不用装饰性渐变、卡片套卡片、无意义大标题。
- 优先清晰状态：未扫描、扫描中、方案已生成、填写中、填写完成、需要用户检查。
- 所有交互组件必须有 default / hover / focus / active / disabled / loading / error 状态。
- 表单控件保留熟悉 affordance，不重新发明下拉框、按钮和弹窗。

建议后续 UI 设计前先让 coding agent 按以下顺序工作：

```text
/impeccable init
/impeccable shape SheetKiller extension popup and profile editor
/impeccable audit dynamic-fill-solution UI
/impeccable harden scan-and-fill flow
/impeccable polish final extension UI
```

如果不实际安装 skill，也可以把 `external/impeccable/skill/reference/product.md` 和 `interaction-design.md` 作为设计检查清单读取。

### 14.12 v2 的核心判断

v2 不应该变成一个慢速“网页 agent”，也不应该变成复杂的企业级审核系统。它应该是：

```text
AI 负责理解和规划
本地 executor 负责确定性执行
用户直接在真实网页上检查和修正
```

这个形态比纯 agent 快，比纯规则泛化能力强，也比预写 manual plan 更适合真实网申表单。主流程要保持简单：资料准备好后，用户只需要点“扫描并填写”，在方案生成后选择“开始填写”或“检查填写方案”，最后回到网页上人工复核和提交。

### 14.13 重大方向判断：以组件适配为主，视觉 AI 作为兜底

2026-07-04 多轮 OPPO 与 Keyence 真站调试后，需要修正对“通用自动填写”的预期。

SheetKiller 的难点不是“把值写进 input”，而是在大量不同网申系统中稳定完成四件事：

```text
识别字段 -> 理解字段语义 -> 按真实组件协议填写 -> 验证页面是否接受
```

不同网申网站的差异主要来自前端实现，而不是后端 API：

- 使用不同组件库，例如 Element Plus / Element UI、Ant Design / Ant Design Vue、Arco、Vant / NutUI。
- 使用自研组件库，例如 Keyence 页面中的 Phoenix input/select/date。
- 使用不同弹层机制，例如 teleport 到 body 的 dropdown、隐藏缓存弹层、虚拟列表、远程搜索候选。
- 使用不同受控状态模型，例如 Vue/React 内部状态不等于 DOM input value。
- 使用不同复杂控件，例如地区级联、日期/月选择器、学校/专业远程 autocomplete、动态新增教育/实习经历。

因此，单一 DOM 填写策略无法覆盖大部分网申页面。纯 GUI 视觉 agent 也不是银弹：它理论上更通用，但慢、贵、不稳定、难 debug，且容易误点提交、删除、保存等高风险操作。

SheetKiller 的长期路线应采用混合架构：

```text
DOM / 组件 adapter 作为主路径
AI 负责语义理解、计划生成、异常辅助判断
视觉 / GUI agent 只作为兜底或调试辅助
用户始终负责最终复核和提交
```

#### 产品定位修正

SheetKiller 不应承诺：

```text
任何网站 100% 全自动填写
```

更现实、也更有产品价值的定位是：

```text
在常见网申系统中自动填写大部分重复资料，
明确标出未填/失败/需检查字段，
让用户用更少时间完成人工复核。
```

用户的核心痛点不是“完全不想看表单”，而是：

- 不想反复复制姓名、电话、邮箱、教育经历、实习经历、项目经历。
- 不想每个平台重新组织同一批资料。
- 希望快速铺申请，但仍能自己检查最终提交内容。

因此，70%-90% 的高频字段稳定自动填写，已经具备明显价值。剩余字段由用户复核补齐，比追求不可靠的 100% 全自动更安全。

#### 架构方向

后续 executor 不应继续扩展成一个巨大 `if/else` 函数，而应拆成 adapter registry：

```text
Scanner
  -> 识别字段、label、上下文、组件特征、重复组结构

Planner
  -> 根据 profile 和页面字段生成 expectedValue / sourcePath / safety

AdapterRegistry
  -> NativeAdapter
  -> ElementPlusAdapter
  -> AntDesignAdapter
  -> PhoenixAdapter
  -> GenericPopupAdapter
  -> DatePickerAdapter
  -> CascaderAdapter
  -> AutocompleteAdapter
  -> UploadAdapter

Verifier
  -> 按字段类型和组件结构验证实际页面值
```

每个 adapter 至少承担：

- detect：判断是否支持当前控件。
- getRoot：找到真实组件根节点。
- readLabel / readValue：读取 label 和当前值。
- fill：按组件协议执行点击、输入、选择、确认。
- trace：记录弹层、候选、点击、错误信息。
- verify hints：给 verifier 提供分段值、格式兼容、候选别名等信息。

#### 不一次性穷举所有网站

不建议一次性试图写完所有招聘系统 adapter。原因：

- 没有真实 DOM 和 debug 样本时，adapter 很容易写偏。
- 同一组件库在不同网站也可能被二次封装。
- 过早穷举会污染核心逻辑，增加维护成本。

更合理的路线：

1. 先把 adapter registry 和 trace 标准搭好。
2. 用真实站点样本逐个补 adapter。
3. 每新增一个 adapter，都加入 debug JSON 回归样本。
4. 用测试矩阵防止“修 A 坏 B”。

建议优先级：

1. Native HTML。
2. Element Plus / Element UI。OPPO 作为样本。
3. Phoenix。Keyence 作为样本。
4. Ant Design / Ant Design Vue。
5. Generic popup/select/date/autocomplete fallback。
6. Workday、Moka、北森、牛客、猎聘等系统按真实样本逐步纳入。

#### Debug 驱动的产品迭代方式

后续每次真实网站失败，都应定位到具体层：

- scan 失败：字段没发现、label 为空、组件 root 错。
- plan 失败：字段语义匹配错、expectedValue 错。
- execute 失败：adapter 没打开弹层、候选没出现、点击没同步状态。
- verify 失败：实际填对但校验规则不理解，例如地区三段各自验证。
- site validation 失败：网站业务规则不接受，例如账号占用、必填依赖、远程库无候选。

这个机制比“截图 + 主观描述”更适合长期产品测试。SheetKiller 的竞争力应来自可复现、可解释、可逐步学习，而不是一次性声称可以自动理解所有网页。
