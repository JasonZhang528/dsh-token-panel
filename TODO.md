# dsh-token-panel 待办清单

> 基线：2026-10-30 · package.json 0.3.2（功能新增已按 Sir 要求全部撤销，当前仅含 bug 修复）
> 测试状态：静态 548/548 · 完整验收（含浏览器 e2e）610/610 全绿
> 注意：本目录不是 git 仓库，本轮全部修改**未提交**；TODO.md 不在 package.json 的 files 白名单内，不会随 npm 包发布。

## 高优先级（下版本必做）

- [ ] **版本发布**：package.json 0.2.7 → 0.3.0（新增导出 JSON / 粒度切换 / 焦点陷阱等），node build/assemble.cjs 重建后打包 tgz；本轮修改先经 Sir 确认再处理版本动作
- [ ] **README.en.md 修复**：「Token cost」行重复出现两次（约 53/54 行），删除一行
- [ ] **键盘可达性收尾**：日期区间 tab / 柱高指标切换器 / 自动刷新档位三处 role=tab 的 span 仍是纯 span——补 tabIndex + Enter/Space（图例项已做，这三处未做）

## 功能迭代（竞品调研结论，按 价值÷成本 排序）

- [ ] **项目维度聚合**：按 cwd 分组的项目用量榜 / 筛选（cwd 已在扫描期收集、已展示于会话行，缺的是「按项目汇总」视角；Cherry Studio「按分组拆分」思路）
- [ ] **请求明细表**：逐条请求记录（时间 / 模型 / 四件套 / 费用），定位异常消耗（Cherry Studio「请求」思路；需服务端补按请求粒度的聚合下发）
- [ ] **用量阈值提醒与限额预测**（claude-monitor 思路）：⚠ 依赖外部限额数据 → 做成**可选功能，默认关闭**
- [ ] **助手 / Agent 维度拆分**：Cherry Studio「探索」页思路，需要服务端在事件里识别 agent 来源

## 性能与架构

- [ ] **周/月聚合服务端预计算**：当前 aggregateDays 在前端对全量日桶实时聚合，「全部」区间日桶很大时可下沉到宿主 SWR 缓存
- [ ] **服务端/客户端契约收尾**：totals / grandTotal / dayCount / 顶层 currentStreak / sessions[].dayInsights 仍下发未消费——要么渲染要么删字段（dayInsights 是 schema 11 的唯一存在理由，删除可减载荷）
- [ ] 两拍强刷节流（当前固定 30s）可考虑配置化

## 低优先级清理

- [ ] Heatmap 的 mouseover/mouseout 委托 effect 无依赖数组：每次渲染重绑（行为正确，纯开销）
- [ ] HeatTrend 的 hover state 只写不读：多余重渲染
- [ ] Heatmap 的 window prop 从未使用（53 周热力图与时间范围无关），可删
- [ ] index.mjs：computeStreaks 与内联「当前连续」两套实现并存（client 只消费 summary.currentStreak）
- [ ] index.mjs 头注释仍写「插件自带 supplements.json」，实际为内联 PRICE_SUPPLEMENT（models 为空，仅一条别名）
- [ ] 余额条 moBody MutationObserver 兜底监听在 standardControls 永不出现时不断开（小资源泄漏）
- [ ] 弹窗焦点陷阱的 e2e 键盘实测（chrome-devtools-mcp 按键派发受限，当前以静态断言覆盖）

## 已完成 —— bug 修复（保留）

- ✅ BLOCKER：会话「用量」tab 两行代码被 CRLF 吞进注释（激活即崩）→ 已修复
- ✅ HIGH：会话表 / 供应商表「费用」列恒「未定价」→ sessionsIn / providersIn 接上 cost
- ✅ HIGH：扫描失败顶掉好缓存 → 失败仅追加 warnings + 同步重扫，不覆盖可用缓存
- ✅ MEDIUM：自动刷新驱动页脚闪烁、余额「本会话」币种错标、小时趋势切换器无反应、面板动画 scale 残留破坏 tooltip 包含块
- ✅ LOW：死代码（SessionUsageModal / 重复 fmtDuration / qLevel 三件套）、死 CSS 15 条、行尾符统一 LF、聚合层去重（bumpModel 收敛四处副本）、两拍 30s 节流、空窗口空态、口径注释归位
- ✅ 小时桶无价型号 cost 口径统一为 null（CACHE_SCHEMA_VERSION 11 → 12）
- ✅ 按需求移除：主面板「以下 N 个型号未收录于价格表，相关费用未计入」ust-warn 汇总条（费用图内「费用柱按 0 计」提示保留）

## 已撤销 —— 功能新增（2026-10-30 按 Sir 要求回退）

- ↩️ 导出 JSON 按钮（页脚）
- ↩️ 日/周/月 趋势粒度切换（aggregateDays / GRANULARITIES）
- ↩️ 自动刷新后台暂停与回前台补拍
- ↩️ 页脚会话数与扫描耗时（scanMs）
- ↩️ 会话项目路径（cwd）展示
- ↩️ 弹窗焦点陷阱（useFocusTrap）与图例 Enter/Space 键盘触发

```
撤销说明：以上功能代码、样式、服务端字段与对应测试断言均已移除；
如后续要恢复，可从 0.3.0 / 0.3.1 的 tarball 或本次会话记录中取回实现思路。
```
