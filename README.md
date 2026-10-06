# 盾构隧道掘进施工管理平台

面向盾构机台账、掘进环次、管片拼装、同步注浆、渣土外运、地表沉降监测与轴线纠偏的一体化盾构隧道施工管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 盾构机台账 | `shield` | 盾构机 | 盾构机编号、盾构机型号、开挖直径 |
| 掘进环次 | `ring` | 掘进环 | 环号、起始里程、掘进速度 |
| 管片拼装 | `segment` | 管片环 | 管片环号、管片型号、拼装点位 |
| 同步注浆 | `grouting` | 注浆记录 | 注浆编号、对应环号、浆液配比 |
| 渣土外运 | `muck` | 渣土运输单 | 运输单号、对应环号、渣土方量 |
| 地表沉降 | `settlement` | 沉降测点 | 测点编号、测点位置、初始高程 |
| 轴线偏差 | `axis` | 轴线测量 | 测量编号、对应环号、设计轴线 |
| 刀具磨损 | `cutter` | 刀具 | 刀具编号、刀盘位置、刀具类型 |
| 管片生产 | `segmentprod` | 管片 | 管片编号、管片型号、生产模具 |
| 浆液拌制 | `mortar` | 浆液批次 | 批次编号、浆液类型、水泥用量 |
| 洞内通风 | `ventilation` | 通风机组 | 机组编号、风筒长度、送风量 |
| 建筑监测 | `building` | 监测对象 | 对象编号、建筑物名称、结构类型 |
| 管线探查 | `utility` | 地下管线 | 管线编号、管线类型、埋设深度 |
| 进度节点 | `progress` | 进度节点 | 节点编号、节点名称、计划完成日 |
| 试验检测 | `testing` | 试验委托 | 委托编号、试样类型、检测项目 |
| 应急演练 | `drill` | 应急演练 | 演练编号、演练科目、演练日期 |
| 班组进场 | `crew` | 施工班组 | 班组编号、班组名称、主要工种 |
| 安全巡检 | `safety` | 巡检记录 | 巡检编号、巡检区域、巡检项目 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `shield-tunnel-construction:entries` 这一项，或调用 `resetModule(模块)`。

## 浆液批次：判据与状态流转的单一实现

浆液批次（拌制 → 检验 → 投用/废弃）不走通用动作流，统一收敛在 `frontend/src/domain/mortar/`，
拌制页、浆液检验入口、导出台账、同步注浆待用清单全部调它，不再各算一遍：

- `policy.ts`：推进判据集中成一份**版本化配置**（`MORTAR_POLICIES` + `CURRENT_MORTAR_POLICY`），
  唯一判定入口 `evaluateBatch`。两栏都有数值时稠度与水灰比都须在区间内；只有一栏可读时
  **稠度为主判栏**（只有水灰比不能定合格）；都不可读判“数据不全、不允许投用”。
- `mortar-service.ts`：登记（按批次编号幂等，反复提交只入一条）、开始拌制、提交检验、
  废弃（**仅拌制站负责人**，越权在领域层当场拒绝）、判据变更后的 `reapplyPolicy`。
  定论批次（检验合格/不合格/已废弃）保存判据版本与结论快照，判据再变也按当时结论保留，
  只追加“新判据复判”信息；未定论批次按新判据重新预检。
- `mortar-view.ts` / `mortar-export.ts`：唯一的明细拼装与台账导出，可投用口径
  （`listReadyBatches` / `isReadyForUse`）被拌制页、检验入口、同步注浆待用清单共用，
  两边看到的“可投用批次数”必然是同一个数。
- 所有写库走 `local-store.ts` 的 `commitRows`：先组装并预序列化，任一失败内存与
  localStorage 都保持原状——入库失败一律不落。
- 历史浆液数据按拌制日期在 `seed.ts` 中补登；旧版本缓存由 `local-store.ts` 自动迁移
  （数据结构版本号 `DATA_VERSION`），其余模块的本机数据保留。

