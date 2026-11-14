# 求职雷达云端日更

此目录在现有 `MrDou01/MrDou01.github.io` 仓库中运行，不依赖本地电脑、Excel、浏览器登录或人工启动。原网站密码门不变。GitHub Pages、Sites 和备用 Worker 在密码验证后读取同一份云端数据。

- GitHub Actions 每天 UTC 00:30（北京时间 08:30）执行 `node cloud/refresh.mjs`。云端研究收件推送后也会执行。
- `cloud/data/radar-data.json` 是云端当前完整数据；保留岗位、近三年分数、原始核验日期及已有字段。不得用旧 Excel 或初始种子覆盖它。
- `cloud/data/research-context.json` 供云端研究任务读取，包括官方来源、待核线索、近期截止、岗位 ID 和被拒收件。
- `cloud/data/state.json` 保存已处理增量的 ID/摘要、页面摘要、待核线索及拒绝记录。
- `cloud/history/YYYY-MM-DD/运行ID.json` 是不可覆盖的运行审计；只保存必要 URL、哈希、状态、岗位 ID 与差分字段，绝不保存整页候选人名单、Cookie 或秘密。
- `cloud/inbox/*.json` 保存独立、不可复用 ID 的研究增量，文件名只用字母、数字、短横线和下划线。提交后不要改写已处理增量；更正用新 ID 和新文件。

## 抓取与核验边界

公开来源检查覆盖配置中的政府/公务员、央国企、银行、保险、事务所等入口，以及当前岗位具体页面。宁波银行采用官方公开校园列表分页和同 ID 详情接口。列表新增和页面摘要变化只产生待核验线索。能打开网页、存在申请按钮、系统占位日期都不能证明岗位资格或延期。

自动发现的新岗位只有在读取完整同 ID 官方详情、明确 2027 届且地点在目标区域时才可成为待核候选。专业只写会计学、财务管理或宽泛管理类，不推定包含会计专硕 125300。要求工作经验的社会招聘不作为应届可投。官网异常、空白脚本页、人机验证、超时不删除、不关闭、不重开现有岗位；只保存失败记录。岗位 `checkedAt` 表示完整资格核验，与页面抓取时间分开。

云端研究任务负责进一步检索、阅读官方原文、判断新岗位和条件变化，再提交下述增量。原网站上“已截止”的岗位只有明确官方延期/恢复通知才能重开。每天按已有精确截止时间过期；未知时点使用该日结束，不把历史记录删除。

## 研究增量格式

先读取 `cloud/data/research-context.json`，需要原有字段时读取 `cloud/data/radar-data.json`。使用已有岗位 ID；岗位代码和官方 ID 必须字符串，不能用大整数。只向现有仓库 `main` 的 `cloud/inbox/` 新建 JSON。建议每次最多 20 个岗位，更多时拆成独立批次。

```json
{
  "schemaVersion": 1,
  "id": "research-2026-11-15-001",
  "date": "2026-11-15",
  "jobs": [],
  "patches": [],
  "sources": [],
  "updates": [],
  "summary": "本次实际检查范围与限制"
}
```

`jobs` 用于新增岗位（已有 ID 按合并处理）；`patches` 只可修改存在的岗位。每条 job/patch 都必须有：

```json
{
  "id": "已有岗位ID或稳定新ID",
  "evidence": {
    "kind": "official",
    "url": "已读官方原文的完整URL",
    "observedAt": "2026-11-15",
    "excerpt": "20至5000字的直接官方原文，足以支持本条具体变化。",
    "scope": "qualification"
  }
}
```

这里的日期是例示，实际日期应为检查当日。`date` 和 `observedAt` 不得在未来；旧证据不能覆盖更新的核验记录。`scope` 可为 `qualification`、`status`、`deadline`、`announcement`。已有岗位只有显式提供 `checkedAt` 且 `scope=qualification` 才更新完整资格核验日期。仅看见“已下线”时写 `stage=expired`、`status`、`statusCheckedAt` 和状态证据，**不要写 checkedAt**。

新岗位必填 `id, employer, role, region, requirements, source, stage, priority`，并应填齐界面字段：`category, location, direction, match, status, deadline, education, audience, note, action`；未知文字填空串，未知期限填空串。`priority` 为 0–100。允许阶段为 `active, watch, upcoming, expired, reference, excluded`。未知届别不写 `year=2027`。

新岗或资格变化要进入 active，还需同时提供：

```json
"eligibility": {
  "graduationYear": 2027,
  "majorScope": "unrestricted",
  "experienceRequired": false
}
```

`majorScope` 仅接受 `unrestricted` 或 `125300`，并且证据原文必须同时明确 2027 届、专业不限或会计专硕/125300。声明本身不能替代原文，不满足则自动降为 watch/需咨询。其他英语、年龄、本科专业、党员等条件仍必须逐项说明，不代表已经通过个人资格审核。

可修改岗位字段完整清单在 `cloud/policy.mjs` 的 `MUTABLE_FIELDS` 中：包括身份、单位、岗位、区域、专业条件、阶段、期限、来源、推荐级别及核验说明。不能提交 `profile`、`scoreTrends`、人工复核、关注状态、密码或任何秘密字段。

原已截止岗位恢复，须 `evidence.change="reopened"`、正文明确延期/恢复，并有有效未来截止；期限延后（含同日精确时间延后）须 `evidence.change="deadline-extended"` 和对应原文。已知日期或精确时间不能清空。保留相互冲突的原始时间，说明需要向单位确认。

`sources` 条目格式：`{name,url,group}`，只接受批准的官方域及 `.gov.cn`。单位明确指定的招聘平台须在 `sources.json` 中有精确域名。大学转载或新闻转载不能作为岗位最终官方依据。

`updates` 条目格式：`{date,type,title,detail}`；日期与本增量 date 一致。描述实际变动，不把旧证据写成当天发布，不把未完全检查写成“全部无新增”。

## 拒收、重试与发布

每个增量先整体校验，错误不会局部写入。成功 ID 和文件摘要持久保存，重复运行不会重复新增岗位或研究更新。变动已处理 ID 会被拒绝；应提交新的更正增量。被拒文件在研究上下文、状态与工作流警告中持续显示。修正同一未成功收件后，其旧拒绝记录会标记已解决；历史审计保留。无效收件不会阻止其他有效数据发布，但不能把警告当作全部成功。

外部来源短暂失败会有限重试，每次请求限制时长和体积；允许域名之外的重定向拒绝。源码不会读取本地凭据或发送简历，不执行报名、缴费或发送招聘咨询。

首次部署从现有已核网站数据建立种子；以后只做增量合并。周一在本地处理 Excel/正式资料时，先下载云端最新数据及每日增量并保留人工状态；日常网站更新不需要开着电脑。电脑关机时本地 Excel 无法落盘，但不影响云端网站更新。

## 本地验证

```text
node --test cloud/*.test.mjs
node cloud/refresh.mjs --dry-run --skip-fetch --input app/data/radar-data.json
node cloud/refresh.mjs --dry-run
```

`--dry-run` 不保存任何抓取结果；`--skip-fetch` 只合并研究收件和检查既有截止；`--date YYYY-MM-DD` 只允许当前或过去的北京时间日期。正式命令不传日期，自动按 Asia/Shanghai 决定当天。
