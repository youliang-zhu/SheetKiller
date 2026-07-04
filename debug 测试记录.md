# SheetKiller Debug 与测试记录

本文档用于记录产品测试阶段的缺陷调查、证据、假设、修复方案和尝试结果。它和 `测试调试流程.md` 分工不同：

- `测试调试流程.md`：给测试者看的操作流程，说明如何 build、重载扩展、导出调试包。
- 本文档：给研发/调试看的调查日志，记录每次调试包分析后定位到了什么、下一步准备怎么修、哪些方案已经尝试过。

调试原则：

1. 先记录证据，再改代码。
2. 区分“已证实问题”和“待验证假设”。
3. 每次修复后都补一条“尝试结果”，避免同一个方向反复猜。
4. 不记录 API Key、证件号、完整手机号等敏感信息。

## 2026-07-04 UI 与流程体验调整记录

### API Key 从资料编辑页拆出

用户反馈：

- API Key 是系统配置，不是个人资料。
- 扫描时提示未配置 API Key，却要去“编辑资料”里配置，概念混乱。

已完成调整：

- 新增独立 `settings.html` 页面，用于集中配置 AI 供应商、API Key、Base URL、模型和测试调试包。
- popup 底部按钮从“设置”改成“API 设置”，直接打开独立设置页。
- 资料编辑页顶部也保留“API 设置”入口，但资料页内部不再直接填写 API Key。
- AI 完善资料模式只显示“AI 配置状态”和“打开 API 设置”，资料页只负责粘贴资料文本和维护个人信息。

设计判断：

- 这是正确拆分。资料编辑页是 profile workspace，API 设置页是 system configuration。
- 对普通用户而言，配置页独立后，错误恢复路径更清晰：缺 key 就去 API 设置，不污染资料编辑逻辑。

### 扫描阶段拆分为可见进度

用户反馈：

- 点击“扫描并生成计划”后耗时较长，用户不知道系统卡住了还是在处理。

已完成调整：

- popup 中规划阶段显示 4 个子阶段：
  - 连接当前页面
  - 识别可填写区域
  - AI 核对资料
  - 生成填写计划
- 错误如果与 API 设置相关，会提供“打开 API 设置”恢复按钮。

设计判断：

- 方向正确，但这只是“前端状态反馈”的第一层。
- 如果 popup 被关闭，React 状态会丢失；这个问题需要单独做 workflow state 持久化，见下一节。

## 2026-07-04 popup 关闭后状态丢失

### 用户反馈

浏览器扩展是右上角小图标，点击后出现 popup。用户点击“扫描并生成计划”后，如果不小心点击页面其他区域，popup 会关闭；再次打开时，状态、阶段、计划都丢失。

### 当前代码证据

相关文件：

- `dynamic-fill-solution/entrypoints/popup/App.tsx`
- `dynamic-fill-solution/entrypoints/background.ts`
- `dynamic-fill-solution/entrypoints/content.ts`

当前状态：

- `popup/App.tsx` 里用 React state 保存 `state`、`planData`、`execution`、`error`、`scannedCount`、`debugRunId`、`planPhase`。
- `handleScanAndPlan()` 在 popup 内串联：
  - 获取当前 tab
  - 向 content script 发送 `SHEETKILLER_SCAN`
  - 向 background 发送 `CREATE_SHEETKILLER_PLAN`
  - 写入 debug run
  - 更新 popup state
- `handleStartFill()` 也在 popup 内向 content script 发送 `SHEETKILLER_EXECUTE_PLAN`。

### 已证实问题

popup 是短生命周期 UI。点击外部区域后，popup 页面会被浏览器销毁，React state 全部丢失。

因此，只要 workflow 状态只存在 popup 内存里，就无法做到“关掉再打开仍保持上一步状态”。

### 能不能做到

能做到，而且应该做。

建议分两阶段：

#### 方案 A：短期修复，持久化 popup workflow 快照

把当前工作流快照写入 `chrome.storage.session` 或 `chrome.storage.local`：

- `runId`
- `tabId`
- `pageUrl`
- `state`
- `planPhase`
- `scannedCount`
- `planData`
- `execution`
- `error`
- `updatedAt`

popup mount 时读取快照：

- 如果 URL/tab 匹配，恢复上次状态。
- 如果状态是 `planned`，恢复计划，用户可继续点击“开始填写”。
- 如果状态是 `done` 或 `error`，恢复结果/错误。
- 如果状态是 `planning` 且 `updatedAt` 超过阈值，比如 90 秒，标记为“上次扫描被中断”，提供“重新扫描”。

优点：

- 改动小。
- 能解决“计划已生成/填写完成后关闭 popup 再打开丢失”的问题。

限制：

- 如果 popup 在规划请求进行中被关闭，请求链可能因为发送方销毁而中断。
- 只能恢复已有快照，不能保证长任务继续跑完。

#### 方案 B：中期正确方案，把任务编排迁移到 background

新增 background 级 workflow controller：

- popup 只发送 `START_SCAN_AND_PLAN` / `START_FILL`。
- background 负责与 content script 和 LLM 交互。
- background 持续写 `workflowStateStore`。
- popup 打开后只读取 `GET_WORKFLOW_STATE`，并订阅进度事件。

建议状态机：

- `idle`
- `connecting`
- `scanning`
- `planning_ai`
- `planned`
- `filling`
- `done`
- `error`
- `interrupted`

优点：

- popup 关闭不会丢任务状态。
- 未来可以显示更准确的进度、耗时、错误节点。
- 调试记录也可以由 background 统一维护，减少 popup 生命周期带来的不确定性。

限制：

- 改动更大，需要定义消息协议、状态存储、过期策略和 tab/page 匹配规则。

### 推荐决策

先做方案 A，快速提升体验；随后在自动填写稳定性进入长周期测试时做方案 B。

原因：

- 当前 bug 主战场仍是 OPPO/Element Plus 控件适配。
- 方案 A 能显著减少用户困惑，成本较低。
- 方案 B 更适合作为下一轮架构升级，避免和执行器修复混在一起。

## 2026-07-04 OPPO 调试包分析

### 调试包信息

文件：

- `C:\Users\19004\Downloads\sheetkiller-debug-2026-07-04T15-14-09-840Z_careers.oppo.com_d06ice.json`

页面：

- domain: `careers.oppo.com`
- title: `OPPO招聘 - 加入我们 join us - 个人简历`
- url: `https://careers.oppo.com/university/oppo/center/resume`

扩展版本：

- `0.1.0`

执行摘要：

- 扫描字段：33 个
- 计划字段：33 个
- 成功验证：5 个
- 待用户补充：9 个
- 失败：19 个
- 安全跳过：0 个

扫描类型分布：

- `text`: 30
- `custom-select`: 3

计划策略分布：

- `text`: 11
- `select`: 10
- `cascader-region`: 6
- `date`: 6

执行失败按策略分布：

- `select`: 8
- `date`: 6
- `cascader-region`: 3
- `text`: 2

异常分布：

- `undefined is not iterable (cannot read property Symbol(Symbol.iterator))`: 8
- `Illegal invocation`: 3

### 结论概览

这次不是一个单点小 bug，而是 OPPO 页面使用 Element Plus 自定义控件后，我们的扫描器、规划策略和执行器之间的“控件语义”不一致。

更具体地说：

- 扫描器把大量 Element Plus 下拉框/日期框识别成普通 `text` input。
- LLM 根据 label 和 placeholder 判断这些字段应该用 `select`、`date`、`cascader-region`。
- 执行器按计划策略强制调用对应 filler。
- filler 内部把元素强制 cast 成 `HTMLSelectElement` 或 `HTMLInputElement`。
- 实际元素并不是对应原生控件，于是出现异常或静默失败。

这是“自定义组件适配层”问题，不是单纯 LLM 判断问题。

### 已证实问题 1：普通 input 被当成 select 执行

证据字段：

- `field-20` 学历
- `field-25` 受教育类型
- `field-26` 该学历是否为交流学习
- `field-27` 该学历是否为联合办学
- `field-28` 专业类别
- `field-8` 国籍
- `field-12` 意向面试地点

调试包表现：

- scan inputType 多数为 `text`
- placeholder 为 `请选择`
- optionsCount 为 0
- plan strategy 为 `select`
- execution exception 为 `undefined is not iterable`

代码证据：

- `dynamic-fill-solution/lib/engine/heuristic/fillers.ts`
  - `fillElement()` 在 `case 'select'` 中直接调用 `fillSelect(el as HTMLSelectElement, value)`。
  - `fillSelect()` 内部执行 `Array.from(el.options)`。

原因：

- 实际传入的是 Element Plus 的普通 input 或 wrapper，不是原生 `<select>`。
- 普通 input 没有 `options`，因此 `Array.from(el.options)` 触发 `undefined is not iterable`。

候选修复：

- `fillElement()` 不能只根据 plan strategy 强制 cast。
- 如果 strategy 是 `select`，但元素不是 `HTMLSelectElement`：
  - 优先走 `fillCustomSelect()`。
  - 或根据 DOM wrapper 判断 `.el-select` / `.el-cascader` / `.el-date-editor`。
  - 如果无法识别，应返回 `failed_to_fill` 并记录 “strategy-element mismatch”，不能抛底层类型异常。

### 已证实问题 2：role=combobox wrapper 被当成 date input

证据字段：

- `field-3` 出生日期 wrapper
- `field-21` 起止时间开始 wrapper
- `field-23` 起止时间结束 wrapper

调试包表现：

- scan inputType 为 `custom-select`
- HTML 里有 `role="combobox"` 和内部 `<input type="text" placeholder="请选择">`
- plan strategy 为 `date`
- execution exception 为 `Illegal invocation`

代码证据：

- `dynamic-fill-solution/lib/engine/heuristic/fillers.ts`
  - `fillElement()` 在 `case 'date'` 中直接调用 `fillDate(el as HTMLInputElement, value)`。
  - `fillDate()` 调用 `setNativeValue(el, value)`。
- `dynamic-fill-solution/lib/capture/native-set.ts`
  - `setNativeValue()` 根据 `tagName` 选择 prototype setter。
  - 当传入的是 `div` wrapper，却按 `HTMLInputElement.prototype.value` setter 调用，会触发 `Illegal invocation`。

候选修复：

- 日期策略需要支持两类元素：
  - 原生 `input[type=date|month]`
  - Element Plus date picker wrapper 或内部 input。
- 如果元素是 wrapper，应查找内部 `input` 或点击 wrapper 打开 picker。
- 不能直接把非 input 元素传给 `setNativeValue()`。

### 已证实问题 3：同一个控件被重复扫描

证据字段：

- 出生日期：
  - `field-3`: role=combobox wrapper
  - `field-4`: 内部 input
- 教育起止时间：
  - `field-21` / `field-22`: 开始日期 wrapper/input
  - `field-23` / `field-24`: 结束日期 wrapper/input

表现：

- 同一个视觉控件在 scan 阶段生成两个 field。
- LLM 对 wrapper 和内部 input 都生成了填写计划。
- 执行阶段重复尝试，造成失败数膨胀，也增加页面状态干扰。

候选修复：

- 扫描器应做 Element Plus 控件去重。
- 如果 wrapper 是 `.el-date-editor` / `[role=combobox]` 且包含内部 input，只保留一个“可执行目标”。
- `fieldId` 应对应稳定执行目标，而不是同时保留 wrapper 和 input。

### 已证实问题 4：依赖字段失败导致后续文本字段失败

证据字段：

- `field-28` 专业类别：select 失败
- `field-29` 专业：text 失败，placeholder 是 `请先选择专业类别`

判断：

- 专业字段依赖“专业类别”先选中。
- 因为专业类别没有成功选择，专业输入框仍处于未激活或无候选状态，直接 text 填写失败。

候选修复：

- 执行计划需要尊重依赖：
  - 先填专业类别，再等专业输入框状态更新。
  - 对于 placeholder 包含 `请先选择...` 的字段，若依赖字段失败，应标记为 `blocked_by_dependency`，而不是普通 `failed_to_fill`。
- 调试报告里应记录依赖链，方便判断“根因失败”和“连带失败”。

### 已证实问题 5：学校名称文本字段失败但无异常

证据字段：

- `field-15` 学校名称

调试包表现：

- strategy: `text`
- expected: `洛桑联邦理工学院`
- before/after 都为空
- exception 为空
- HTML 里出现 Element Plus wrapper，并且 form item 处于 `is-error`

初步判断：

- 可能是远程搜索/自动完成组件，不是普通自由文本。
- 直接设置内部 input value 后，Vue/Element Plus 可能清空了值，或者组件需要选择候选项才能写入真实 model。

待验证假设：

- 该字段可能需要输入关键字后从下拉候选里选择学校。
- 如果没有选候选，视觉 input 即使短暂出现文字，也会被框架回滚。

候选修复：

- 把“学校名称”这种带远程候选的 Element Plus input 归类为 `custom-select` 或 `autocomplete`。
- 执行时输入文字后等待下拉候选，优先点击完全匹配项。
- 如果无候选，再降级为普通 text。

### 已证实问题 6：仍有字段被规划为 needs_user_input

证据字段：

- `field-1` 证件类型
- `field-2` 证件号码
- `field-13` 推荐码
- `field-14` 招聘信息获取来源
- `field-17` / `field-18` / `field-19` 学校所在地
- `field-30` / `field-31` 成绩排名/GPA

说明：

- 其中推荐码、招聘来源、GPA 等确实可能是资料缺失。
- 证件类型和证件号码被跳过，是当前 planner 仍保留了“identity checks/document fields should not be filled automatically”的安全规则。

产品决策点：

- 用户之前提出“出现了什么可填写区域，能填就必须填，是否该填交给用户复核”。
- 这与当前身份字段安全策略存在冲突。
- 如果最终产品策略决定身份证类字段也要自动填，则需要修改 planner 安全规则，并在 UI 上强制“需复核”。

建议：

- 不在本次 OPPO 控件修复里混改身份安全策略。
- 先把控件适配修好，再单独决策“身份字段是否允许自动填”。

## 候选修复路线

### 第一优先级：执行器防御性修复

目标：

- 不再因为 plan strategy 和 element 类型不一致抛底层 JS 异常。

建议：

- `fillElement()` 增加类型守卫。
- `select` 策略：
  - 如果是原生 `HTMLSelectElement`，走 `fillSelect()`。
  - 否则走 `fillCustomSelect()`。
- `date` 策略：
  - 如果是原生 `HTMLInputElement`，先尝试直接填。
  - 如果不是 input，查找内部 input 或走 custom date picker。
- 失败时记录明确原因：
  - `strategy-element mismatch`
  - `custom dropdown option not found`
  - `date picker not supported`

收益：

- 立刻消除 `undefined is not iterable` 和 `Illegal invocation`。
- 调试报告会更可读。

风险：

- 只做防御还不能保证填成功，只是让失败更可控。

### 第二优先级：扫描器识别 Element Plus 控件

目标：

- 在 scan 阶段就识别出 OPPO 的 Element Plus 控件类型，减少 LLM 和执行器猜测。

建议识别规则：

- `.el-select` / `.el-select__wrapper` / placeholder `请选择` / `.el-select-dropdown__item` → `custom-select`
- `.el-date-editor` / `.el-picker-panel` / label 含日期、时间、起止时间 → `date`
- `.el-cascader` / 地区、省市、籍贯、所在地 → `cascader-region`
- `.el-autocomplete` / 学校名称、专业 → `autocomplete`，或者先复用 `custom-select`

同时做去重：

- wrapper 和内部 input 不应同时生成 field。
- 同一个 `.el-form-item` 内如果 wrapper 已作为自定义控件入库，就跳过内部 input。

收益：

- 计划阶段更稳定。
- 执行阶段拿到的 field 更接近真实可操作控件。

### 第三优先级：Element Plus 自定义控件 filler

目标：

- 真正填成功 OPPO 页面上的下拉、日期、级联、搜索选择。

建议：

- custom select：
  - 点击最近的 `.el-select` / `[role=combobox]` / `.el-input` wrapper。
  - 等待 body 下出现可见 `.el-select-dropdown__item`。
  - 用 normalize 后文本匹配，例如 `硕士` 可以匹配 `硕士（Master）`。
  - 触发 `pointerdown/mousedown/mouseup/click` 组合，而不是只 dispatch click。
- date picker：
  - 优先尝试内部 input 直接写入。
  - 如果框架回滚，再实现 picker 选择。
  - 日期值要根据字段粒度转换：出生日期用 `YYYY-MM-DD`，起止时间月份可能用 `YYYY-MM`。
- cascader：
  - 依次点击国家/省/市列。
  - 每点击一列等待下一列出现。
  - 区分“所在城市”和“籍贯/出生地”的 profile source。

### 第四优先级：测试基础设施补强

建议新增测试：

- `fillElement` 类型守卫单元测试。
- Element Plus select/date/cascader 的静态 HTML fixture 扫描测试。
- 使用 OPPO 调试包里的 `htmlSnippet` 做 regression fixture：
  - 输入 field HTML
  - 期望 scanner 输出 inputType
  - 期望不会产生 wrapper/input 重复 field
- 调试包解析脚本：
  - 输出失败按 strategy、exception、inputType、label 的聚合。
  - 生成 markdown 小结，减少人工翻 JSON。

## 本次暂不修改代码的原因

用户要求本轮先分析、测试、记录，不急着修 bug。

当前建议先由用户确认两个产品/技术决策：

1. popup 状态持久化先做方案 A，还是直接做 background workflow controller。
2. OPPO 失败修复先做“执行器防御 + Element Plus select/date 适配”，还是同时处理身份字段自动填写策略。

## 2026-07-04 修复尝试 1：状态持久化与 Element Plus 基础适配

### 已实施范围

本轮按“先稳测试体验，再修控件适配”的顺序做了第一批修改。

#### 1. popup workflow 状态持久化

新增：

- `dynamic-fill-solution/lib/sheetkiller/workflow/workflow-state-store.ts`

实现：

- 使用 `chrome.storage.session` 保存 popup workflow 快照。
- 保存内容包括：
  - `runId`
  - `tabId`
  - `pageUrl`
  - `state`
  - `phase`
  - `scannedCount`
  - `planData`
  - `execution`
  - `error`
  - `updatedAt`
- popup 打开时，如果当前 tab 和 URL 匹配，恢复上次状态。
- 如果上次状态是 `planning` 或 `filling`，且超过 90 秒，则显示“上次任务在弹窗关闭后中断。请重新扫描当前页面。”

预期收益：

- 已生成计划、已完成填写、错误结果不会因为 popup 关闭而直接丢失。
- 规划中或填写中关闭 popup 后，再打开能得到明确中断提示，而不是像什么都没发生。

当前限制：

- 这仍是短期方案 A。
- 如果 popup 在 LLM 请求进行中被浏览器销毁，任务本身不会继续跑完。
- 中期仍建议把 scan/plan/fill 编排迁移到 background。

#### 2. scanner 对 Element Plus 控件增强识别

修改：

- `dynamic-fill-solution/lib/sheetkiller/scanner/enrich.ts`

实现：

- 从 `.el-form-item` / `.ant-form-item` 中补充 label 识别。
- 对 Element Plus 控件识别：
  - `.el-select` / placeholder `请选择` -> `custom-select`
  - `.el-date-editor` / 日期时间类 label -> `date`
  - `.el-cascader` / 籍贯、学校所在地等地区类 label -> `cascader-region`
  - 学校名称、专业等可能的搜索选择输入 -> `custom-select`
- 跳过 `[role="combobox"]` 内部 input，避免 wrapper 和 input 重复扫描。
- 使用项目已有 `cssEscape`，避免测试环境没有 `CSS.escape`。

预期收益：

- OPPO 页面上大量 Element Plus 下拉/日期/级联不再全部被扫描为普通 `text`。
- 出生日期、起止时间等 wrapper/input 重复 field 会减少。

#### 3. 执行器 filler 类型守卫与自定义控件降级

修改：

- `dynamic-fill-solution/lib/engine/heuristic/fillers.ts`

实现：

- `select` 策略：
  - 如果目标是原生 `<select>`，走原生 select。
  - 如果目标不是原生 select，自动走 `fillCustomSelect()`。
- `date` 策略：
  - 如果目标是原生 input，直接写入。
  - 如果目标是 wrapper，查找内部 input 并写入。
- `text` 策略：
  - 优先普通输入。
  - 如果普通输入失败且看起来像选择/自动完成控件，则降级到 custom select。
- `fillCustomSelect()` 增强：
  - 点击最近的 Element Plus/Ant/custom wrapper。
  - 如有内部 input，先输入待匹配值。
  - 等待 dropdown option。
  - 用归一化匹配选择项，例如 `硕士` 可匹配 `硕士（Master）`。

预期收益：

- 消除 OPPO 调试包中的两类底层异常：
  - `undefined is not iterable`
  - `Illegal invocation`
- 即使某些控件仍填不成功，debug 结果也应从“底层异常”变成更可读的失败原因。

### 新增/更新测试

新增：

- `dynamic-fill-solution/tests/lib/sheetkiller/scanner.test.ts`
- `dynamic-fill-solution/tests/lib/sheetkiller/workflow-state-store.test.ts`

更新：

- `dynamic-fill-solution/tests/lib/engine/fillers.test.ts`
- `dynamic-fill-solution/tests/setup.ts`

覆盖：

- Element Plus select-like input 识别为 `custom-select`。
- Element Plus date wrapper 和内部 input 去重。
- Element Plus cascader 识别为 `cascader-region`。
- select strategy 目标是普通 input 时自动降级 custom select。
- date strategy 目标是 wrapper 时写入内部 input。
- workflow snapshot 保存、恢复、超时判断、清除。

验证结果：

```powershell
npm run test -- tests/lib/engine/fillers.test.ts tests/lib/sheetkiller/scanner.test.ts tests/lib/sheetkiller/workflow-state-store.test.ts tests/lib/sheetkiller/executor.test.ts
```

结果：4 个测试文件、22 个测试全部通过。

完整验证：

```powershell
npm run test
npm run build
```

结果：

- `npm run test`：37 个测试文件、270 个测试全部通过。
- `npm run build`：WXT production build 通过，输出包含 `popup.html`、`dashboard.html`、`settings.html` 和 content/background scripts。

### 待继续验证

下一次真实 OPPO 页面测试需要重点看：

- scan fields 中 `text` 数量是否下降，`custom-select/date/cascader-region` 是否上升。
- debug package 中是否还出现：
  - `undefined is not iterable`
  - `Illegal invocation`
- 出生日期、起止时间是否不再重复扫描 wrapper 和 input。
- 学历、受教育类型、交流学习、联合办学、专业类别是否能选中。
- 学校名称是否仍需要专门的远程 autocomplete 适配。

## 2026-07-04 OPPO 调试包回归 2：第一轮修复后的新问题

### 调试包信息

文件：

- `C:\Users\19004\Downloads\sheetkiller-debug-2026-07-04T16-07-41-354Z_careers.oppo.com_6ingf1.json`

页面：

- domain: `careers.oppo.com`
- title: `OPPO招聘 - 加入我们 join us - 个人简历`

执行摘要：

- 扫描字段：41 个
- 成功验证：15 个
- 填了但校验不匹配：6 个
- 填写失败：12 个
- 待用户补充：8 个
- 安全跳过：0 个

### 与上一轮对比

上一轮 OPPO 调试包：

- scan 类型：`text=30`，`custom-select=3`
- 执行：成功 5，失败 19
- 异常：
  - `undefined is not iterable`
  - `Illegal invocation`

本轮 OPPO 调试包：

- scan 类型：
  - `text=14`
  - `custom-select=12`
  - `date=7`
  - `cascader-region=6`
  - `textarea=2`
- 计划策略和扫描类型基本对齐：
  - `text=14`
  - `custom-select=12`
  - `date=7`
  - `cascader-region=6`
  - `textarea=2`
- 底层异常为 0。
- 成功验证从 5 提升到 15。

结论：

- 第一轮 scanner 类型识别和执行器类型守卫是有效的。
- 当前问题已经从“DOM 类型错误导致崩溃”推进到“真实组件交互和校验规则不够细”的阶段。

### 当前问题 1：custom-select 已填成功，但 verifier 太严格导致误判 mismatch

证据字段：

- `field-1` 证件类型
  - expected: `居民身份证`
  - after: `中国-居民身份证`
  - status: `filled_but_mismatch`
- `field-19` 学历
  - expected: `硕士`
  - after: `硕士（Master）`
  - status: `filled_but_mismatch`
- `field-25` 专业类别
  - expected: `计算机`
  - after: `计算机科学与技术`
  - status: `filled_but_mismatch`

判断：

- 这些字段很可能已经选中了正确或可接受的选项。
- 失败原因不是填充失败，而是 verifier 当前使用近似“完全相等”的文本比较。
- 对 select/custom-select，实际选项经常包含前缀、英文、括号说明或更长分类名。

候选修复：

- `verifyFieldValue()` 对 `select/custom-select` 使用选项式模糊匹配：
  - 去空格、去括号内英文、去常见连接符。
  - 允许 `actual` 包含 `expected`。
  - 允许 `expected` 包含 `actual`。
  - 对证件类型允许 `居民身份证` 匹配 `中国-居民身份证`。
  - 对学历允许 `硕士` 匹配 `硕士（Master）`。
  - 对专业类别允许 `计算机` 匹配 `计算机科学与技术`，但标记 `reviewRequired`。

注意：

- `field-25` 虽然从自动化角度可视为匹配，但页面截图中仍被红框高亮，这是我们自己的 mismatch 高亮还是页面校验红框需要区分。下一轮 debug 应同时看页面 DOM class 和 SheetKiller report status。

### 当前问题 2：日期控件识别正确，但直接写内部 input 仍失败

证据字段：

- `field-3` 出生日期，expected `2002-11-24`
- `field-20` / `field-21` 教育起止时间，expected `2025-09` / `2026-06`
- `field-31` / `field-32` 实习起止时间，expected `2025-04` / `2025-08`
- `field-37` / `field-38` 项目起止时间，expected `2025-12` / `2026-05`

共同表现：

- scan inputType: `date`
- strategy: `date`
- element tag: `div`
- exception: 空
- before/after: 空
- status: `failed_to_fill`

判断：

- 第一轮修复已经避免了 `Illegal invocation`，说明 wrapper 不再被错误当成原生 input。
- 但 OPPO 的 Element Plus date picker 不是简单写 input 就能提交到 Vue model。
- 直接设置内部 input value 可能被组件清空，或者需要打开日期面板后点击日期/月。

候选修复：

- 增加 Element Plus date picker 专用 filler：
  - 点击 `.el-date-editor` 或 `[role=combobox]`。
  - 等待 `.el-picker-panel`。
  - 对生日类日期选择年月日。
  - 对起止时间类月份字段选择年月，或输入 `YYYY-MM` 后触发 Enter。
  - 对 date range/month range，识别同一个 `起止时间` form item 下的两个 combobox，分别填开始和结束。
- debug 需要增加：
  - date panel 是否出现。
  - 内部 input 是否 readonly。
  - 写入后 50/200/500ms 的 value 是否被回滚。

### 当前问题 3：地区/籍贯级联被拆成多个字段，但每个字段都拿了完整地区值

证据字段：

- `field-8`
- `field-9`
- `field-10`

共同表现：

- strategy: `cascader-region`
- expected: `中国 湖南省 娄底市`
- after: 空
- status: `failed_to_fill`
- context 来自籍贯/所在地一类的地区控件组。

判断：

- OPPO 页面上的籍贯不是一个单独 cascader，而是三个并排选择框：国家/省/市。
- 当前 scanner 把三个子控件分别扫描成三个 field。
- planner 又给每个子控件都分配了完整值 `中国 湖南省 娄底市`。
- 执行器对每个子控件都尝试完整级联，导致失败。

候选修复：

- scanner 层识别 `.el-form-item[role=group]` 或地区类 form item 下的多 combobox 组，生成一个 group field。
- 或 planner/executor 层按子控件 index 拆值：
  - 第 1 个控件填 `中国`
  - 第 2 个控件填 `湖南省`
  - 第 3 个控件填 `娄底市`
- 执行器填 linked custom selects 时应：
  - 先填国家，等待省份选项刷新。
  - 再填省份，等待城市选项刷新。
  - 最后填城市。

### 当前问题 4：部分 custom-select 没有选中任何值

证据字段：

- `field-7` 国籍（国家/地区）
  - expected: `中国`
  - after: 空
  - status: `filled_but_mismatch`
- `field-11` 意向面试地点
  - expected: `中国 广东省 广州市`
  - after: 空
  - status: `filled_but_mismatch`
- `field-24` 该学历是否为联合办学
  - expected: `否`
  - after: 空
  - status: `filled_but_mismatch`

判断：

- 当前 custom-select filler 对部分 Element Plus select 生效了，例如：
  - 受教育类型：`全日制` 成功。
  - 是否交流学习：`是` 成功。
- 但对国籍、地点、联合办学没有选中。
- 可能原因：
  - 下拉 options 是异步加载，等待时间不够。
  - 组件不是可搜索 select，先写 input 反而干扰了展示 options。
  - 需要 pointerdown/pointerup 或原生 `.click()`，单纯 dispatch mouse event 不稳定。
  - options 被 teleport 到 body，selector 能找但可见性/层级筛选不够。

候选修复：

- custom-select filler 改成两阶段：
  1. 先只点击打开，不输入，读取可见 options 并匹配。
  2. 如果没找到，再输入关键字过滤。
- 增加 pointer events：
  - `pointerdown`
  - `mousedown`
  - native `HTMLElement.click()`
  - `mouseup`
  - `click`
- 等待时间从 80ms 增加到分段重试，例如最多 1000ms。
- debug 记录 option 候选数量和前几个候选文本，便于判断是“没打开”还是“打开但没匹配”。

### 当前问题 5：学校名称仍然失败，需要远程 autocomplete 适配

证据字段：

- `field-14` 学校名称
  - strategy: `custom-select`
  - expected: `洛桑联邦理工学院`
  - after: 空
  - status: `failed_to_fill`
  - context: `学校名称学校名称不能为空`

判断：

- 学校名称不是普通文本输入，也不像普通 select。
- 更可能是远程搜索 autocomplete：
  - 输入学校关键词。
  - 请求远程候选。
  - 点击候选项后才写入 Vue model。
- 当前 custom-select 等待候选时间和候选 selector 可能不足。

候选修复：

- 为学校名称/专业名称增加 autocomplete filler：
  - 输入值。
  - 等待较长时间，例如 1500-3000ms。
  - 匹配 `.el-autocomplete-suggestion li`、`.el-select-dropdown__item`、`.el-scrollbar__view li`。
  - 如果没有完全匹配，尝试中英文别名或学校原文。
- 如果仍无候选，返回 `needs_user_input` 或 `failed_to_fill`，并给出“远程候选未出现”的明确 reason。

### 当前问题 6：电话区号字段被错误映射为手机号

证据字段：

- `field-4`
  - context: 联系电话
  - before/after: `***+86）`
  - expected: 脱敏手机号
  - status: `failed_to_fill`
- `field-5`
  - 手机号主体填写成功。

判断：

- 联系电话由两个控件组成：国家区号 + 手机号主体。
- planner 把第一个区号控件也映射到了 `basic.phone`。
- 实际区号已经是中国 `+86`，不需要再用手机号填。

候选修复：

- scanner/planner 对 phone group 做拆分：
  - placeholder/上下文为国家区号、`+86`、国家选择时，source 应为 `basic.phoneCountryCode` 或从 `basic.phone` 推导 `中国 +86`。
  - 如果默认已是中国区号，直接标记 verified 或 skip_requires_review，不算失败。
- 增加 phone group verifier：
  - 区号字段只校验国家码，不和手机号主体比较。

### 当前问题 7：证件号填写成功但页面业务校验报“已在另一个账号使用”

截图现象：

- 证件号字段已填入，页面显示“此账号已在另一个账号使用”一类业务校验。

判断：

- 这不是自动填写失败，而是目标网站服务端/业务规则校验失败。
- 自动化不应尝试绕过。

建议：

- debug report 需要区分：
  - “值写入并通过本地 verifier”
  - “页面自身业务校验报错”
- 后续可扫描 `.is-error` / `.el-form-item__error` 文本，作为 `siteValidationError` 附加到 debugItems。

### 下一轮建议优先级

1. 修 verifier，对 custom-select/select 做 option-like fuzzy verification，先减少误报。
2. 增强 custom-select 两阶段打开与候选采集，并把候选文本写入 debug。
3. 单独实现 Element Plus date/month picker filler。
4. 实现 linked region group / phone group 的子字段拆分策略。
5. 实现 autocomplete filler，重点处理学校名称。
## 2026-07-04 修复记录：OPPO 第二轮 debug 后的执行器修复

本轮按“出现可填写区域就尽量填写，LLM 只负责给值，用户负责复核”的方向，修复自动填写执行层和校验层的几个基础问题。

### 已修复 1：自定义组件 wrapper 读值为空

问题：
- `field.element` 如果是 `.el-select`、`.el-date-editor` 这类外层 `div`，旧 verifier 只读 `textContent`。
- 很多组件真实值在内部 `input`，所以报告里可能显示 after 为空，导致误判失败。

修复：
- `readFieldDisplayValue()` 现在会优先读取 wrapper 内部的 `input`、`textarea`、`select`。
- 这会让 debug report 更接近用户实际看到的页面值。

### 已修复 2：下拉选项“实际已选中但被判失败”

问题：
- 页面显示值经常比计划值更完整，例如 `居民身份证 -> 中国-居民身份证`、`硕士 -> 硕士（Master）`、`计算机 -> 计算机科学与技术`。
- 旧 verifier 使用严格相等，导致这些被统计为 `filled_but_mismatch`。

修复：
- `select/custom-select` 校验改成 option-like fuzzy match。
- 会去掉空格、常见标点、括号英文、行政区后缀后再比较。
- 允许 `actual` 包含 `expected`，也允许 `expected` 包含 `actual`。

### 已修复 3：Element Plus / Ant 风格 custom-select 填写不稳

问题：
- 旧逻辑点击后立即向 input 写入搜索词，可能干扰非搜索型 select。
- 部分组件需要更真实的 pointer/mouse/click 序列。
- 选项异步加载时等待时间偏短。

修复：
- custom-select 改成两阶段：先打开下拉直接扫描可见候选；没找到再输入目标值搜索。
- 点击事件改成 `pointerdown` + `mousedown` + `mouseup` + 单次原生 `click()`，避免重复触发。
- 候选等待从短等待改成分段最多约 1.4 秒。

### 已修复 4：日期/月控件提交事件不足

问题：
- OPPO 的日期控件是 wrapper，不是原生 date input。
- 仅 set value + input/change 有时不会同步到组件内部状态。

修复：
- 日期 wrapper 填写现在会尝试 `YYYY-MM-DD`、`YYYY/MM/DD`、`YYYY年M月D日`、`YYYY-MM`、`YYYY/MM`、`YYYY年M月`。
- 写入后会触发 `input`、`Enter`、`change`、`blur`。

注意：
- 这还不是完整“点击日期面板选择年月日”的实现。
- 如果某些站点完全禁止手输，下一轮需要根据 debug report 增加真实 date picker 面板点击。

### 已修复 5：地区/籍贯多段控件的保守拆分

问题：
- OPPO 的籍贯/所在地有时不是一个 cascader，而是同一表单项里的多个并排 select。
- 旧逻辑给每个子控件都填完整值，例如每个框都尝试 `中国 湖南省 娄底市`。

修复：
- 只在同一个 `.el-form-item` / `.ant-form-item` / `fieldset` / `[role=group]` 内发现多个地区相关选择控件时拆分。
- 拆分规则按控件位置：第 1 个控件填 `中国`，第 2 个填 `湖南省`，第 3 个填 `娄底市`。
- 如果只有两个控件且值以 `中国` 开头，会保守跳过国家，按省/市填。

注意：
- 不同网申站点地区结构差异很大，这里没有把扫描层改成强制 group field。
- 下一轮真实页面如果仍有地区失败，需要结合具体 DOM 再微调。

### 已修复 6：电话区号子字段被拿完整手机号填写

问题：
- `联系电话` 常由“国家区号 + 手机号主体”组成。
- planner 可能把区号下拉也映射成 `basic.phone`，导致用完整手机号填 `+86` 控件。

修复：
- 执行层增加局部矫正：当字段策略是 `select/custom-select/cascader-region`、来源是 `basic.phone`、页面上下文或当前值包含 `+86` / 区号 / 国家码时，将该子字段 expected value 改成 `+86`。

### 测试验证

- 新增 `tests/lib/sheetkiller/verifier.test.ts`：覆盖 wrapper 内部 input 读值与 option-like fuzzy verification。
- 新增 `tests/lib/engine/fillers-extra.test.ts`：覆盖 custom-select 先读候选再输入、地区组按子控件位置拆分。
- 修复过程中全量测试曾发现 popup cascader 被双击，已改成单次 click。

验证结果：
- `npm run test`：38 个测试文件，273 个测试全部通过。
- `npm run build`：WXT production build 通过。

### 下一轮真实页面重点观察

1. 日期字段是否从红框变成绿色或页面真实有效值。
2. 学校名称远程 autocomplete 是否仍失败；如果失败，需要在 debug 中记录候选是否出现。
3. 国籍、意向面试地点、联合办学等 custom-select 是否从空值变成已选中。
4. 地区/籍贯在不同站点是否被错误拆分；如果出现误拆，优先按站点 DOM 特征收窄规则。
5. 页面业务校验错误（例如证件号已被占用）应继续和自动填写失败分开记录。
## 2026-07-04 复盘：OPPO 第三轮 debug 后重新审视方案

调试包：
- `sheetkiller-debug-2026-07-04T16-33-21-725Z_careers.oppo.com_gpzc4d.json`

截图现象：
- 用户侧仍能看到多个红框，尤其是出生日期、国籍/籍贯/意向面试地点、学校名称、起止时间、联合办学等。

执行统计：
- `filled`: 17
- `failed`: 14
- `needsInput`: 10
- `skipped`: 0

注意：这次不是“全部失败”。上一轮修复实际让一批字段变好了：
- 姓名、电话区号、手机号、邮箱成功。
- 学历 `硕士 -> 硕士（Master）` 已被正确识别为成功。
- 受教育类型、是否交流学习、专业类别、专业、导师姓名成功。
- 公司、项目、职责类文本/textarea 成功。

### 本轮失败集中在四类组件

1. 日期/月控件全部失败
   - `field-3` 出生日期，expected `2002-11-24`
   - `field-20/21` 教育起止时间，expected `2025-09 / 2026-06`
   - `field-31/32` 实习起止时间，expected `2025-04 / 2025-08`
   - `field-37/38` 项目起止时间，expected `2025-12 / 2026-05`
   - DOM 特征：`div.el-date-editor`，`role="combobox"`，不是原生 input。
   - 结论：上一轮“写内部 input + Enter/change/blur”没有进入 Element Plus date picker 的 Vue model。必须改成真实点击日期/月面板，或用 Vue/Element Plus 组件事件协议触发。

2. 普通 select / custom-select 仍有空值
   - `field-7` 国籍，expected `中国`，actual empty。
   - `field-11` 意向面试地点，expected `中国 广东省 广州市`，actual empty。
   - `field-24` 联合办学，expected `否`，actual empty。
   - 结论：上一轮“两阶段打开下拉 + 候选匹配”只适用于部分 Element Plus select。对于这些控件，可能存在：
     - 下拉是 remote/lazy options；
     - 需要点击外层 `.el-select` 而不是 input；
     - options 不是当前 DOM 里已有，而是打开后异步请求；
     - 当前 debug 没记录候选数量和候选文本，无法判断是“没打开”还是“打开但匹配失败”。

3. 地区/籍贯多段控件仍失败
   - `field-8/9/10` 籍贯三段，expected `中国 湖南省 娄底市`。
   - 截图上三个子控件仍为空。
   - 上一轮拆分策略没有奏效，核心原因是 scanner 给每个子 input 的 `field.element` 是内部 input，而不是 `.el-form-item` 下的组件根节点；执行器尝试从 input 往上找 group，但真实 DOM 结构与测试模拟不一致，导致没有稳定找到 sibling controls 或没有正确选择 lazy options。
   - 用户提醒“地区/籍贯级联不同网站不一样”是对的：这块不能硬编码 OPPO 三段，应该抽象成 `GroupedControl`，先识别一个 form-item 内的多个子控件，再在执行时按组顺序填。

4. 学校名称 autocomplete 失败
   - `field-14` 学校名称，expected `洛桑联邦理工学院`，actual empty。
   - DOM 特征：`custom-select`，input `readOnly: true`，placeholder `请输入学校名称`。
   - 结论：这不是普通文本框，也不是普通 select。很可能是远程学校库 autocomplete，必须模拟“打开搜索弹层 -> 输入关键词/可能需要点击触发 -> 等远程候选 -> 选候选”。如果 input 是 readonly，直接 set value 必然失败。

### 为什么上一轮修改不奏效

上一轮修复方向偏“通用 DOM 级别”：
- 写 input value。
- 派发 focus/input/change/blur/Enter。
- 点击 visible option。
- 尝试在同一个 form item 内拆分地区 token。

但 OPPO 页面的关键控件是 Vue + Element Plus 受控组件。它们真正生效通常依赖组件内部状态和特定事件链，而不是 DOM input value 本身。直接 setNativeValue 只能改变可见 DOM，不能保证：
- Vue model 更新；
- 表单校验状态更新；
- 下一级联选项加载；
- remote option 被选择；
- date picker 面板确认值。

所以这不是大方向错，而是执行器的抽象层级不够。我们不能只做“HTML 表单自动填写器”，必须做“组件库适配器”。

### 对方案性质的判断

大方向没有错：
- 扫描页面可填区域。
- LLM/规则只负责给每个可填区域提供候选值。
- 执行器尽量填写。
- 用户最终复核。

错的是当前执行层过于乐观：
- 把 Element Plus / Ant Design / remote autocomplete 当成普通 input/select。
- 缺少组件级操作协议。
- debug 信息还不够证明每一步到底卡在哪里。

这已经不是“一两个小 bug”，而是需要把执行器升级为分层架构：
1. DOM 原生控件填充器。
2. Element Plus 组件适配器。
3. Ant Design 组件适配器。
4. Remote autocomplete / lazy cascader 适配器。
5. 每一步记录调试遥测：打开是否成功、候选数量、候选文本、点击了哪个候选、点击后 actual value。

### 下一步修复建议

优先级 1：增强 debug，而不是继续盲改
- custom-select 填充时记录：
  - root selector/class；
  - 是否打开下拉；
  - option count；
  - 前 20 个 option 文本；
  - 匹配 token；
  - 点击后 input value；
  - 是否出现 `.el-form-item__error`。
- date 填充时记录：
  - panel 是否出现；
  - panel class；
  - 是否 month picker/date picker；
  - 可点击 year/month/day 候选。

优先级 2：实现 Element Plus 专用 adapter
- `fillElementPlusSelect`
- `fillElementPlusCascader`
- `fillElementPlusDate`
- `fillElementPlusMonth`
- `fillElementPlusAutocomplete`

优先级 3：把地区组升级为 group-level plan/execution
- scanner 识别同一个 `.el-form-item` 内的多个子控件，生成 group metadata。
- executor 不再让每个子控件独立猜 token，而是一次性填完整 group。

优先级 4：修复 debug JSON 可解析性
- 当前 PowerShell `ConvertFrom-Json` 对该包解析失败，说明导出内容可能含有某些未正确处理的字符或结构。
- 后续应在导出前用 `JSON.stringify` 严格序列化，并在测试中 round-trip parse。

## 2026-07-04 实施记录：组件交互 telemetry 与 Element Plus 保守增强

本轮没有继续盲目“猜 OPPO 的某个选择器”，而是先把执行器改成可观测。之前的问题不是产品方向错，而是执行器对 Element Plus 这类受控组件的抽象太低：只知道 `set value + input/change/blur`，不知道下拉有没有打开、候选项有没有出现、选中了哪一项、日期面板是否出现、站点自身校验有没有报错。

### 已落地 1：填充器 interactionTrace

`fillElement()` 新增可选 `trace` 参数。执行器每填一个字段都会把组件交互步骤写入 debug item：

- `text:start` / `text:verify`
- `native-select:start` / `native-select:selected`
- `custom-select:start`
- `custom-select:after-open`
- `custom-select:type-filter`
- `custom-select:after-filter`
- `custom-select:enter-fallback`
- `custom-date:start`
- `custom-date:open-panel`
- `custom-date:type-candidate`
- `region:start`
- `region:group-detected`
- `region:group-token`
- `cascader:options`
- `cascader:selected`

这些 trace 会记录安全的结构化信息：root/input 描述、readonly/disabled 状态、候选项数量、候选项样本、选中的候选项、日期面板数量与面板 class。不会额外输出 API key。

### 已落地 2：debug item 记录页面校验错误

`DynamicFillDebugItem` 新增：

- `interactionTrace`
- `siteValidationErrors`

后续如果页面显示类似“学校名称不能为空”“该账号已被使用”“请选择所在地”，debug JSON 会把这些业务校验和自动填写失败分开记录。这样我们能区分：

- 自动填写器没有成功操作控件；
- 自动填写器填了值，但页面业务规则不接受；
- verifier 误判；
- 用户资料确实缺字段。

### 已落地 3：Element Plus 自定义下拉保守增强

custom-select 现在采用两阶段：

1. 先点击组件外壳/真实触发区，打开下拉，扫描当前可见候选项。
2. 若未找到，再向内部 input 派发搜索词，等待异步候选，然后再次扫描候选项。

对 readonly input 做了保守处理：如果需要搜索，会临时取消 readonly 来派发 input 事件，然后恢复 readonly。这主要用于学校名称这类远程 autocomplete。下次 debug 可以确认候选项是否真正出现。

### 已落地 4：Element Plus 日期控件不再被 readonly 直接拦截

旧逻辑遇到 readonly date input 会直接失败。现在会：

- 点击日期组件外壳和触发区；
- 记录日期面板是否出现；
- 对候选日期格式逐个写入并触发 Enter/change/blur；
- 即使 input 是 readonly，也会临时派发输入事件再恢复。

注意：这仍不是完整的“点击年月日面板”实现。如果下次 trace 显示面板出现但输入仍未同步 Vue model，就要继续做 `fillElementPlusDate/month` 面板点击版。

### 已落地 5：地区组识别范围扩大

`findGroupedRegionToken()` 不再只找 `.el-select/.el-cascader/[role=combobox]`，也会把同一 form item 内的 `input[placeholder]` 纳入 sibling 控件判断。这样 OPPO 这类“看起来是三段下拉，但 DOM 暴露的是 input”的结构更容易被识别。

### 测试验证

- 新增/更新 `tests/lib/engine/fillers-extra.test.ts`
  - custom-select trace 会记录候选项样本；
  - readonly custom date 不会在交互前直接失败；
  - 地区组按子控件位置拆分仍通过。
- 验证结果：
  - `npm test -- --run tests/lib/engine/fillers-extra.test.ts` 通过，4 个测试通过。
  - `npm test` 通过，38 个测试文件、275 个测试全部通过。

### 下一次真实 OPPO 测试重点

下一次 debug JSON 需要重点看：

1. 失败的国籍/联合办学/面试地点字段是否有 `custom-select:after-open.optionCount`。
2. 如果 optionCount 为 0，是下拉没打开，还是远程候选没回来。
3. 学校名称是否出现 `custom-select:type-filter`，以及 `after-filter` 是否有学校候选。
4. 日期字段是否出现 `custom-date:open-panel.panelCount > 0`。
5. 如果日期 input 显示写入成功但页面仍红框，要做 Element Plus date picker 面板点击适配。
6. 地区/籍贯字段是否出现 `region:group-detected`，如果没有，说明 OPPO 真实 DOM 的 group 边界不是 `.el-form-item`，需要从 debug 里的 element/root 信息继续收敛。

## 2026-07-04 分析记录：OPPO 第四轮 debug，telemetry 暴露真实根因

调试包：
- `sheetkiller-debug-2026-07-04T17-01-43-091Z_careers.oppo.com_tqp9lc.json`

解析状态：
- JSON 可被 PowerShell `ConvertFrom-Json` 正常解析，debug 导出格式本轮正常。

执行统计：
- 总字段：41
- `filled_and_verified`: 24
- `needs_user_input`: 10
- `filled_but_mismatch`: 4
- `failed_to_fill`: 3
- 总失败/不匹配：7

与上一轮相比：
- 失败数从 14 降到 7。
- 所有日期/月字段已经成功，包括出生日期、教育起止时间、实习起止时间、项目起止时间。
- 文本、textarea、电话、邮箱、学历、受教育类型、交流学习、专业类别、专业、导师、实习/项目内容等大部分成功。

### 新发现的核心根因

本轮 telemetry 显示，当前自定义下拉不是“候选匹配逻辑稍微不准”，而是打开和读取了错误的候选池。

典型 trace：
- 国籍字段 `field-7` 的 root 是 `div.el-input.el-input--suffix`，不是外层 `.el-select`。
- 打开后 `optionCount=3301`，候选样本前几项是：
  - `中国-居民身份证`
  - `中国-港澳居民来往内地通行证`
  - `中国-台湾居民来往大陆通行证`
  - `护照`
  - `中国（+86）`
- 这显然不是“国籍”字段自己的候选，而是页面上全局/隐藏/旧弹层里的候选项。

成功字段也有同样现象：
- 学历、受教育类型、交流学习、专业类别等成功字段也显示 `optionCount=3301`。
- 它们不是因为策略完全正确，而是误打误撞在全局候选池中找到了匹配项。

### 为什么会发生

1. `closestInteractiveRoot()` 现在把最近的 `.el-input` 当成 root。
   - 对 Element Plus 来说，真实组件根通常是 `.el-select`、`.el-cascader`、`.el-date-editor`。
   - `input.closest('.el-select, ..., .el-input')` 会返回最近的 `.el-input`，而不是更外层 `.el-select`。
   - 结果是点击到了输入框包装层，但没有稳定打开当前字段对应的 select/cascader。

2. `waitForOptions()` 的可见性判断太弱。
   - 当前 `isVisibleElement()` 只看元素自身 `display/visibility`。
   - 如果隐藏弹层的父元素不可见，但子 option 自己没有 `display:none`，仍可能被当成可见。
   - 所以它把页面上大量隐藏/缓存/旧弹层候选都采进来，形成 `optionCount=3301`。

3. `clickMatchingOption()` 没有限定“当前刚打开的弹层”。
   - 它从整个 `document` 搜候选。
   - 多个 Element Plus 弹层/缓存 DOM 同时存在时，会点到非当前字段的候选。

### 7 个剩余问题的归因

1. `field-7` 国籍
   - 期望：中国。
   - 实际为空。
   - trace 选择了 `中国-居民身份证`，说明点击到了证件类型候选池，不是国籍候选池。

2. `field-8/9/10` 籍贯三段
   - group 被识别到了，但 controlRoots 数量是 6：`.el-select` 和内部 `.el-input` 被重复计入。
   - `field-10` 出现 `tokenIndex=4`，超出 `中国/湖南省/娄底市` 三个 token，说明 group 子控件去重逻辑不对。
   - 候选池依然是证件类型/全局候选池。

3. `field-11` 意向面试地点
   - 期望：中国 广东省 广州市。
   - trace 只选择了 `中国`，且候选池仍是全局池。
   - 这类字段可能本质是级联，不应按普通 custom-select 一次性填完整字符串。

4. `field-14` 学校名称
   - 期望：洛桑联邦理工学院。
   - input 是 readonly，placeholder 已经是学校名，但实际值为空。
   - trace 搜索后候选池仍是全局旧候选，没有学校候选。
   - 说明学校控件不是普通 input，也不是当前下拉被正确打开；需要真实 autocomplete/popup adapter。

5. `field-24` 是否联合办学
   - trace 显示点到了 `否`，但 after 仍为空。
   - 这说明点击的 `否` 很可能不是当前字段所属弹层里的 `否`，或者点击后没有触发当前 Vue model。

### 下一轮修复方向

优先级 1：修 `closestInteractiveRoot()`
- 不要让 `.el-input` 抢占 `.el-select/.el-cascader/.el-date-editor`。
- 应按组件优先级查找：
  1. `.el-select`
  2. `.el-cascader`
  3. `.el-autocomplete`
  4. `.el-date-editor`
  5. `.ant-select/.ant-picker`
  6. `[role=combobox]`
  7. 最后才是 `.el-input`

优先级 2：修候选可见性
- `isVisibleElement()` 需要检查 `getBoundingClientRect()`、offsetParent、祖先 display/visibility、aria-hidden。
- 隐藏弹层、旧弹层、尺寸为 0 的候选不能参与匹配。

优先级 3：候选池必须绑定当前弹层
- 点击某个 select 后，记录点击前/后的可见 dropdown。
- 优先只在“新打开或当前 active 的 dropdown”里找候选，而不是扫整个 document。
- Element Plus 可重点找 `.el-popper`、`.el-select-dropdown`、`.el-cascader__dropdown` 中可见且最近打开的那个。

优先级 4：地区组去重
- group 内不能同时把 `.el-select` 和其内部 `.el-input` 作为两个控件。
- 应先收集 `.el-select/.el-cascader` 作为主控件，再只把没有主控件祖先的裸 `input[placeholder]` 作为 fallback。

优先级 5：级联字段区分
- `意向面试地点`、`籍贯` 这类包含国家/省/市的值，不应按单个 custom-select 找完整字符串。
- 如果字段 label/上下文命中地点、籍贯、所在地、城市，且值包含多个 region token，应走 region/cascader adapter。

## 2026-07-04 实施记录：修复 Element Plus root、候选池与地区组去重

本轮针对 OPPO 第四轮 debug 中暴露的 `optionCount=3301` 问题做执行器修复。核心目标是避免从全局/隐藏/旧弹层里误选候选项。

### 已修复 1：组件 root 优先级

`closestInteractiveRoot()` 改为按优先级逐级查找：

1. `.el-select`
2. `.el-cascader`
3. `.el-autocomplete`
4. `.el-date-editor`
5. `.ant-select`
6. `.ant-picker`
7. `[role="combobox"]`
8. `.el-input`

这样 input 位于 `.el-input` 内、而 `.el-input` 又位于 `.el-select` 内时，会拿 `.el-select` 作为组件根，不会被内部包装层抢走。

### 已修复 2：隐藏旧弹层过滤

`isVisibleElement()` 不再只看元素自身 `display/visibility`，现在会检查：

- 元素是否仍连接在 DOM；
- 自身及祖先是否 `hidden` / `aria-hidden=true`；
- 自身及祖先是否 `display:none` / `visibility:hidden` / `opacity:0`；
- 浏览器真实环境下如有 client rect，则排除尺寸为 0 的元素。

这可以减少隐藏候选、缓存候选、旧弹层候选被误采样。

### 已修复 3：候选池绑定当前可见弹层

custom-select 不再直接从整个 document 搜候选。现在流程是：

1. 点击组件 root/trigger；
2. 采集当前可见的 overlay roots；
3. 优先使用 `aria-controls` / `aria-owns` 指向的受控弹层；
4. 其次使用当前可见的 `.el-select-dropdown`、`.el-popper`、`.el-cascader__dropdown`、`.el-autocomplete-suggestion`、Ant dropdown 等；
5. 只在这些 scopes 内查找候选项。

trace 新增：

- `custom-select:scopes-after-open`
- `custom-select:scopes-after-filter`
- `cascader:scopes-after-open`

下一次 debug 里如果 `custom-select:after-open.optionCount` 仍然非常大，就说明 OPPO 当前字段对应的 visible scope 仍然没有被正确隔离。

### 已修复 4：候选匹配优先精确匹配

候选匹配改为先找 normalized exact match，再做 loose includes match。

例如期望 `中国` 时，会优先选择文本正好是 `中国` 的选项，而不是先命中 `中国-居民身份证`。

### 已修复 5：地区组去重

group 内控件收集改成两阶段：

1. 先收集主控件：`.el-select`、`.el-cascader`、`.ant-select`、原生 `select`、`[role=combobox]`。
2. 再把没有主控件祖先的裸 `input[placeholder]` 作为 fallback。

这避免同一个 Element Plus 控件同时被 `.el-select` 和内部 `.el-input` 计数，修复籍贯三段被误识别成 6 个控件的问题。

### 已修复 6：地点类 custom-select 自动转地区/级联策略

如果字段上下文命中：

- 籍贯
- 出生地
- 户籍
- 所在地
- 城市
- 地区
- 国家/省/市
- 地点/面试地点/工作地点

并且目标值拆出来是多段地区 token，则 `custom-select` 会改走 `fillCascaderRegion()`，不再按单个下拉去找完整字符串。

这主要针对 `意向面试地点 = 中国 广东省 广州市` 这类字段。

### 测试验证

新增/更新 `tests/lib/engine/fillers-extra.test.ts`：

- 确认 Element Plus input 内层包装不会抢走 `.el-select` root。
- 确认隐藏旧 dropdown 中的候选不会被点击。
- 保留 custom-select trace、readonly date、地区组拆分测试。

验证结果：

- `npm test -- --run tests/lib/engine/fillers-extra.test.ts` 通过，6 个测试通过。
- `npm test` 通过，38 个测试文件、277 个测试全部通过。
- `npm run build` 通过。

### 下一次 OPPO 实验重点

重点看新的 debug JSON：

1. `custom-select:start.root` 是否从 `div.el-input...` 变成 `div.el-select...`。
2. `custom-select:scopes-after-open.optionCount` 是否接近 1，而不是多个历史弹层。
3. `custom-select:after-open.optionCount` 是否不再是 3301。
4. 国籍字段是否优先选择精确 `中国`，而不是 `中国-居民身份证`。
5. 籍贯字段 `region:group-detected.optionCount` 是否从 6 变成 3。
6. 意向面试地点是否走 `region:start` / `cascader:*` trace，而不是普通 custom-select trace。
7. 学校名称如果仍失败，重点看是否有学校 autocomplete 的真实候选出现；如果没有，下一步需要专门做学校远程搜索控件适配。

## 2026-07-04 实施记录：OPPO 地区分段验证误判修复

背景：

- 最新 OPPO debug 中，籍贯三段已经实际填入：
  - 第一段：`中国`
  - 第二段：`湖南省`
  - 第三段：`娄底市`
- 但报告仍显示 `filled_but_mismatch`。
- 根因不是执行失败，而是 verifier 把每个子字段都拿来和完整值 `中国 湖南省 娄底市` 比较。

修复：

- `verifyFieldValue()` 对 `cascader-region` 增加 grouped subfield 判断。
- 如果字段位于同一个 `.el-form-item` / `.ant-form-item` / `fieldset` / `[role=group]`，且该 group 里存在多个地区相关子控件，则允许每个子控件只匹配完整地区值中的一个 token。
- 普通单控件地区字段仍然必须匹配完整地区值，避免只填 `中国` 就被误认为 `中国 湖南省 娄底市` 已完成。

新增测试：

- grouped region 三个子字段分别为 `中国`、`湖南省`、`娄底市` 时，均可通过 `中国 湖南省 娄底市` 的验证。
- 单个 region 控件只填 `中国` 时，不能通过完整地区值验证。

验证结果：

- `npm test -- --run tests/lib/sheetkiller/verifier.test.ts` 通过，6 个测试通过。
- `npm test` 通过，38 个测试文件、279 个测试全部通过。
- `npm run build` 通过。

预期影响：

- 下一轮 OPPO 中，籍贯三段不应再计入失败。
- OPPO 剩余主要问题应集中在：
  - `意向面试地点` 特殊地点选择器。
  - `学校名称` 远程学校库 autocomplete。

## 2026-07-04 实施记录：复杂远程候选控件先归类为用户处理

背景：

- 最新 OPPO debug 中，剩余失败集中在：
  - `学校名称`
  - `意向面试地点`
- `学校名称` trace 显示没有出现学校候选，只有无关候选 `下载更新删除`。
- `意向面试地点` trace 显示未打开真实地点候选，只扫到页面导航项。

判断：

- 这两个字段不是普通 input/select 问题，而是复杂远程候选控件。
- 它们代表一个通用问题类型：远程 autocomplete / 站点候选库 / 特殊地点选择器。
- 但在 adapter 架构重构前，不应继续用 OPPO 专用补丁硬修，否则会污染当前执行器。

本轮处理：

- executor 增加保守分类：
  - 学校名称 / 学校全称 / 毕业院校 / 就读学校 / 院校名称。
  - 意向面试地点 / 面试地点 / 面试城市。
- 当这些字段的计划策略是 `custom-select` / `select` / `cascader-region` 时，不再尝试自动填写。
- 报告为 `needs_user_input`，reason 标明：
  - `复杂远程候选控件：学校名称通常需要从站点学校库候选中手动选择`
  - `复杂远程候选控件：意向面试地点通常依赖站点远程地点候选或特殊地点选择器`
- 普通文本字段不受影响，例如纯 `text` 的学校名称仍会自动填写。

新增测试：

- 学校名称 custom-select 会被归类为 `needs_user_input`，不会写 DOM。
- 意向面试地点 custom-select 会被归类为 `needs_user_input`。
- 普通 text 学校名称仍然会自动填写。

验证结果：

- `npm test -- --run tests/lib/sheetkiller/executor.test.ts` 通过，6 个测试通过。
- `npm test` 通过，38 个测试文件、282 个测试全部通过。
- `npm run build` 通过。

预期影响：

- OPPO 下一轮报告中，这两个字段不应再显示为 `failed_to_fill`。
- 它们应进入待用户处理/检查列表。
- 后续 adapter 重构后，再把它们纳入通用 `AutocompleteAdapter` / `RemoteCandidateAdapter`。
