# 稍后读 ReadFlow

Pocket 关停之后的「稍后读」真空,用你自己的笔记库来填:贴 URL → Tangu 抓正文存成**库内普通笔记** → 干净阅读视图划线沉淀 → AI 摘要问答 → 消化仪式逼你读掉它。与 Forsion Clip 是上下游:Clip 管存进来,本插件管读掉它。

> 本仓是 [Forsion](https://github.com/Changan-Su/Forsion)(AI 原生笔记 + 内置 Tangu Agent 的本地优先桌面工作台)的社区插件,捆绑包(bundle)形态:UI 双视图 + 随包「稍后读」Space。

## 安装

```bash
git clone https://github.com/Changan-Su/forsion-plugin-readflow.git
cd forsion-plugin-readflow
sh install.sh prod    # 安装到 ~/.forsion;开发家用 sh install.sh(默认 dev → ~/.forsion-dev)
```

重启 Forsion 桌面端后生效:命令面板「稍后读:打开」,或工作台侧栏「稍后读」Space(左列表 + 右阅读器)。也可整目录压缩为单层 zip 经 Forsion 应用市场安装。

## 功能

- **抓正文**:粘贴文章链接入队,本机 Tangu 引擎用 `web_fetch` 抓取并清洗成 Markdown(去导航/广告/评论),一次性落盘,**此后绝不重新抓取**——划线锚点因此天然稳定。「重新抓取」按钮 = 另存新文件,不覆盖旧文件。
- **文章就是笔记**:每篇存成 `<工作文件夹>/<YYYYMMDD>-<标题slug>.md`,带 `rf_url / rf_title / rf_saved / rf_status / rf_minutes` frontmatter(另有可选的 `rf_author / rf_published`)。全库搜索、双链、日历……宿主对笔记能做的一切对文章照样成立。
- **待读队列**(library 视图):收件箱 / 在读 / 读完 / 归档四栏;行 = 标题 / 域名 / 估读时长 / 保存日;**消化仪式**把最老的 3 篇未读置顶,一键「今天读它 / 归档它」二选。
- **阅读器**(reader 视图):限宽 68ch、行高 1.7 的阅读排版,字号可调(设置或 A−/A＋);**选中文字浮出「划线」按钮**,引文+可选批注追加进原文件的 `## 划线` 节;右侧面板 = AI 摘要(写进 `## AI 摘要` 节)+ 基于正文的问答;状态流转(开始读 / 读完 / 归档);「在笔记中打开」直达原文件。
- **失败如实标**:抓不到就标失败类型(`fetch_error` 网络/解析失败、`paywall` 登录墙/付费墙、`too_short` 正文过短),保留 URL 可重试,不假装成功。队列串行、防重入(同 URL 不会排两遍),重启后未完成项标「中断,点击重试」。
- **Forsion Clip 导入**:命令「稍后读:导入 Forsion Clip 剪藏」扫描剪藏文件夹(设置可改,默认 `Forsion Clip`),把其中的 `.md` **登记**进待读列表——path 指向 Clip 原文件,不搬家不复制;已在列表(按 URL 或路径)的自动跳过。
- **状态栏**:显示在读篇数,点击直达列表;读完一篇记一条 `article_read` 活动日志(可作自动化触发)。

## 用法

1. 命令面板「稍后读:打开」,或切到随包附带的「稍后读」Space(左列表 + 右阅读器)。
2. 粘贴链接「加入」,抓好会通知;点行进入阅读。
3. 选中文字 → 点「划线」→(可选)输批注;右侧「生成」出 AI 摘要;下方输入框就内容提问。
4. 读完点「读完」;读不动就「归档」——列表轻了才读得动。

命令:`稍后读:打开` / `稍后读:添加链接` / `稍后读:导入 Forsion Clip 剪藏`。

## 数据存哪

- 文章笔记:`<工作文件夹>/<YYYYMMDD>-<slug>.md`(工作文件夹是宿主给每个插件的标准设置,默认「稍后读」)。重名自动加序号。
- 列表索引:`<工作文件夹>/.readflow-index.json`(隐藏文件,六键条目 `path/url/title/status/saved/minutes`)。所有变更**先改文件 frontmatter 再刷索引**;打开时校验文件还在,不在就把孤儿条目剔除。索引若损坏(JSON 解析失败),原件自动备份为 `.readflow-index.json.bak` 并重置列表(文章 `.md` 文件不受影响,可从备份手工找回登记行);瞬时读取失败则直接中止本次操作,列表绝不会被静默清空。
- 队列状态:`localStorage plugin.readflow.*`(仅本机 UI 状态)。
- 划线与 AI 摘要写回文章文件本身的 `## 划线` / `## AI 摘要` 节——**渲染只从落盘文件读**,文件是唯一真源。

数据流向:正文抓取与 AI 摘要/问答经由你**已登录的 Forsion 引擎**(本机 Tangu);除此之外不访问任何外部服务,文章与索引全在本地笔记库。

## 范围说明(明确不做什么)

- **不实时监听剪藏文件夹**:没有文件事件通道,Clip 导入是手动命令(想常态化可配自动化定时跑命令)。
- **不做登录墙 / 付费墙内容**:抓不到就如实标 `paywall` 失败态,不代登录、不绕付费。
- **不做 RSS 订阅**(v2 候选)。
- **不做插件内全文搜索**:文章就是笔记,请直接用宿主的全库搜索。

## 旧宿主兼容

07-18 之后的宿主 API(`registerView` / `registerStatusItem` / `ctx.notify` / `ctx.activity` / `ctx.app.readFile/writeFile/workFolder/prompt` 等)全部按可选链调用:旧宿主下插件不报错,命令降级为提示(无工作台视图 / 无文件读写时功能不可用),不会让插件被吊销。

## 自检

```bash
node check.mjs
```

覆盖:贡献点契约、slug 重名序号、frontmatter 往返、划线追加(有/无节)、```article 块解析(含模型废话包裹与正文内嵌代码块)、失败三态、队列防重入与中断恢复、Clip 导入去重、XSS、旧宿主兼容;以及停用后队列真停、旧宿主输入弹窗外点关闭必结算、索引损坏/读失败的数据保全(.bak 备份)。

## 许可

[Apache-2.0](./LICENSE) © 2026 Changan-Su
