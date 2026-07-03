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
  -> 用户预览 / 可编辑
  -> fill
  -> verify
  -> report
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
   - 展示新增、修改、不确定字段。
   - 用户确认后合并到本地 profile。

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
3. SheetKiller scan 当前页面
4. 系统把 FieldInventory 发给 planner
5. planner 结合 profile 生成 FillPlan
6. 用户查看计划摘要
7. 用户点击 fill draft
8. executor 执行填写
9. verifier 逐项回读 expected vs actual
10. report 输出 filled / mismatch / skipped / failed
11. 用户人工复核和最终提交
```

注意：最终提交仍然必须由用户手动完成。

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
- 上一次 verifier mismatch 结果

这部分用于减少重复 token 消耗，也让同一个站点越用越准。

### 14.5 AI planner 输出

Planner 输出 `FillPlanItem[]`：

```ts
type FillPlanItem = {
  index: number
  label: string
  strategy: 'text' | 'textarea' | 'custom-select' | 'cascader-region' | 'radio' | 'checkbox' | 'date'
  value: string
  sourcePath?: string
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
- `value`：最终要填的值。
- `searchValues`：用于学校、专业、地区等远程搜索控件。
- `acceptValues`：允许 verifier 接受的页面显示值。
- `dependsOn`：用于专业依赖专业类别、城市依赖省份等场景。
- `confidence`：低置信字段不自动填，或要求人工确认。
- `reviewRequired`：对开放题、生成类内容、歧义项强制人工复核。

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

### 14.7 预览和人工确认

AI plan 生成后不要直接 fill，先展示摘要：

```text
将填写 42 项
跳过 8 项
低置信 3 项
需要人工确认 2 项
```

每个字段展示：

```text
页面字段：学校名称
计划填写：Chalmers University of Technology
资料来源：education[1].school
置信度：0.94
策略：custom-select
```

用户可以：

- 修改 value
- 修改 strategy
- 禁用某一项
- 保存修正到站点记忆
- 确认执行 fill

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
- 调用 OpenAI-compatible API 生成 profile draft。
- 展示 diff。
- 用户确认后合并到本地 profile。

这一步不碰网页 fill，只优化资料准备。

#### Phase V2-2: Scan -> AI Plan

目标：

- 用户在真实页面点击“AI 生成填写方案”。
- content script scan 当前页面。
- planner 基于 scan + profile 生成 FillPlan。
- dashboard/popup 展示 plan review。

通过标准：

- 不填网页也能生成 plan。
- plan 能导出 JSON。
- manual:probe 能读取该 JSON 并执行。

#### Phase V2-3: Plan Review -> Fill

目标：

- 用户确认 plan 后，由 executor 填写。
- verifier 生成报告。
- mismatch 可反馈给 planner 或保存为站点修正。

通过标准：

- 同一页面第二次可以复用缓存 plan。
- 用户修正过的字段下次优先采用用户修正。

#### Phase V2-4: 站点记忆和自我修正

目标：

- 记录某站点字段和 profile source 的映射。
- 记录用户对 plan 的修改。
- 记录 executor 失败原因，例如 `option not found`、`field disabled`、`readback mismatch`。
- 下次生成 plan 时把这些历史作为上下文。

### 14.10 风险和边界

主要风险：

| 风险 | 处理 |
|---|---|
| AI 错配字段 | plan review + confidence + verifier |
| 学校/专业远程搜索库候选不可见 | debug options + searchValues + acceptValues |
| 页面字段 index 漂移 | 使用 field signature 辅助匹配 |
| 依赖字段未解锁 | FillPlanItem.dependsOn + 每项执行前重新 scan |
| 开放题生成内容不可靠 | 默认 reviewRequired，不自动提交 |
| 同站点多页面表单 | 每页独立 scan/plan/cache |

### 14.11 v2 的核心判断

v2 不应该变成一个慢速“网页 agent”。它应该是：

```text
AI 负责理解和规划
本地 executor 负责确定性执行
verifier 负责纠错
用户负责最终确认
```

这个形态比纯 agent 快，比纯规则泛化能力强，也比预写 manual plan 更适合真实网申表单。
