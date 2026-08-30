/**
 * 「稍后读」插件自检:宿主同款 new Function('ctx', src) 求值 main.js。
 * 覆盖(SPEC「check.mjs 额外必测」+ BRIEF 门禁):
 *   贡献点齐全(2 视图 / 3 命令 / 2 设置 / statusItem)· disposer 可执行 ·
 *   slug/重名序号 · frontmatter 解析往返(rf_* 不丢)· 划线追加(有/无节两况)·
 *   ```article 块解析(废话包裹 / fence 变体 / 正文含内嵌代码块)· 失败分类三态 ·
 *   队列防重入(同 URL 二次入队被拒)+ 失败态记录 + 重启中断标记 ·
 *   XSS(<script>/<img onerror> 走渲染器无元素无 attrs)· 旧宿主 ctx 下 setup 不抛。
 * 评审修复轮补钉(20260806 fix round):
 *   cur.path 快照绊线(P1 错文件写入竞态)· 节边界防越狱(demoteH2/neutralizeReservedHeadings)·
 *   索引 RMW 串行化(serialIndex 排队 + 并发落盘×状态流转不丢)· guard 接住裸 async 回调 ·
 *   space icon 必须在宿主 SPACE_ICONS 词表内 · zoomFactor 兜底。
 * 二轮评审补钉(20260807 fix round):
 *   dispose 后队列真停(P1:不再起新 run/不再写盘/拒入队)· askStr 外点关闭必 settle(P1:
 *   含在飞 click 吞除与 disposer settle)· 索引读失败/损坏绝不静默截断(.bak 备份+拒写)·
 *   setFmField 块标量续行吞除 · reader 订阅 index 事件(静态绊线)· icon 词表 includes 化。
 * 双语复核轮补钉(20260814 i18n fix round):
 *   引擎层兜底错误必须走词表(真起一趟 run 吃 500,断言中文宿主下拿到中文句)· new Error 禁字面量 ·
 *   t()/errKey/warnKey 调用点审计(键集合相等挡不住打错键)· 磁盘契约常量钉字面值 ·
 *   兜底标题不随语言变(en 宿主下落盘仍是「未命名文章」)· zh→en→zh 往返回归。
 * 跑法:node check.mjs
 */
process.env.TZ = 'Asia/Shanghai' // 日期断言自钉时区(指南纪律)
import { readFileSync } from 'node:fs'
import { strict as A } from 'node:assert'

const src = readFileSync(new URL('./main.js', import.meta.url), 'utf8')
const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'))
const space = JSON.parse(readFileSync(new URL('./spaces/readflow/space.json', import.meta.url), 'utf8'))

// ── 静态纪律检查 ──────────────────────────────────────────────────────────────
// ASI 陷阱:无分号风格下,以 ( 或 [ 开头的行会粘到上一句尾部当调用/下标
{
  const lines = src.split('\n')
  const asi = [...lines.keys()].filter((i) => {
    if (!/^\s*[([]/.test(lines[i])) return false
    let p = i - 1; while (p >= 0 && !lines[p].trim()) p--
    return p >= 0 && /[)\]'"`\w]\s*$/.test(lines[p])
  }).map((i) => i + 1)
  A.equal(asi.length, 0, `以 ( [ 开头的行会被 ASI 粘到上一句:第 ${asi.join(',')} 行`)
}
A.ok(!/\bsetInterval\s*\(/.test(src), '禁 setInterval(轮询用 setTimeout 自排程)')
A.ok(!/new Date\(\)/.test(src), '裸 new Date() 冻不住钟,一律 new Date(Date.now()) 或 new Date(iso)')
A.ok(!/color:\s*#fff/i.test(src), '强调色上的字不许写死白,一律 var(--rf-on-fill)')
A.ok(!/insertAdjacentHTML|outerHTML|document\.write/.test(src), '禁 insertAdjacentHTML/outerHTML/document.write')
// P1 竞态绊线:reader 里对文章文件的读写必须走路径快照,直用 cur.path 会跨 await 被 openPath 改写,
// 最坏把 A 全文构造的文本写进 B(B 被整体覆盖)
A.ok(!/readFile\(cur\.path\)|writeFile\(cur\.path/.test(src), '文章文件读写不许直用 cur.path(须先快照 const path = cur.path)')
A.ok(/upsertSection\(txt, '## AI 摘要', demoteH2\(/.test(src), '摘要落盘必须先 demoteH2(模型自带 ## 标题会截断节)')
// 用户看得见的错误句一律 t('key'):写死字面量 = 有一种语言的用户永远看到另一种语言的话
// (1.1.0 在引擎层踩过:五句兜底被改成硬编码英文,中文用户抓取失败时看到英文)
A.ok(!/new Error\(\s*['"`]/.test(src), "new Error 不许直接吃字符串字面量,人话一律走 t('key')")
// reader 必须订阅 index 事件:library 右键改状态后,本篇头部状态胶囊/流转按钮不许显示旧状态
A.ok(/e\.type === 'index' && cur\) guard\(refreshFile\)\(\)/.test(src), 'reader 的 bus 处理必须响应 index 事件刷新当前篇')
A.ok(/buildArticleText\(fm, neutralizeReservedHeadings\(body\)\)/.test(src), '抓取正文落盘必须先中和保留节头(对抗性注入)')
for (const m of src.matchAll(/\.innerHTML\s*=\s*(.)/g)) A.ok(m[1] === '`' || m[1] === "'" || m[1] === '"', 'innerHTML 只许字面量赋值')
for (const m of src.matchAll(/\.innerHTML\s*=\s*`([^`]*)`/gs)) A.ok(!m[1].includes('${'), 'innerHTML 模板字面量不许插值(动态内容一律 createElement+textContent)')

// ── manifest / space 契约 ─────────────────────────────────────────────────────
A.equal(manifest.id, 'readflow'); A.equal(manifest.name, '稍后读')
A.equal(manifest.version, '1.2.0'); A.equal(manifest.apiVersion, 1); A.equal(manifest.main, 'main.js')
A.ok(!manifest.fileExtensions, '文章是普通笔记,不许声明自定义扩展')
A.ok(manifest.onboarding && manifest.onboarding.settings === true, 'onboarding 应内嵌设置')
A.ok(!manifest.onboarding.recommends, 'onboarding 禁止 recommends 自家内容')
// manifest 双语字段:中文 canonical 之外必须另有一套英文(旧宿主忽略,不影响加载)
A.ok(manifest.nameEn && !/[一-鿿]/.test(manifest.nameEn), 'manifest 必须有纯英文 nameEn')
A.ok(manifest.descriptionEn && !/[一-鿿]/.test(manifest.descriptionEn), 'manifest 必须有纯英文 descriptionEn')
A.ok(manifest.onboarding.en && manifest.onboarding.en.intro && !/[一-鿿]/.test(manifest.onboarding.en.intro), 'onboarding.en.intro 必须是纯英文')
A.equal(manifest.onboarding.en.steps.length, manifest.onboarding.steps.length, 'onboarding.en.steps 必须与中文一一对应(同序同数)')
for (const s of manifest.onboarding.en.steps) A.ok(s.title && s.description && !/[一-鿿]/.test(s.title + s.description), `onboarding.en step 必须是纯英文:${s.title}`)
A.ok(space.name && space.name.zh && space.name.en, 'space 名必须双语')
A.deepEqual(space.requires.views.sort(), ['plugin:readflow:library', 'plugin:readflow:reader'], 'space 应声明两个插件视图')
// 宿主 userSpaces.tsx SPACE_ICONS 词表拷贝(icon 不在表内会静默回退 Boxes 通用图标)。
// SPEC 点名的 bookmark 不在表内,故用 book-open(有据偏离);词表若扩了 bookmark,可改回并同步此拷贝。
const SPACE_ICONS = [
  'bot', 'inbox', 'mail', 'notebook-text', 'book-open', 'briefcase', 'calendar-days', 'message-circle',
  'folder', 'folder-open', 'file-text', 'star', 'heart', 'home', 'target', 'zap', 'globe',
  'music', 'image', 'video', 'code', 'terminal', 'layout-grid', 'sparkles', 'boxes', 'list-tree',
]
A.ok(SPACE_ICONS.includes(space.icon), `space icon "${space.icon}" 必须在宿主 SPACE_ICONS 词表内`)
A.equal(space.layout.main[0].type, 'plugin:readflow:reader')
A.equal(space.layout.left[0].type, 'plugin:readflow:library')

// ── 极简 DOM 垫片 ─────────────────────────────────────────────────────────────
function mkText(t) {
  const n = { tag: '#text', children: [], attrs: {}, appendChild() {}, setAttribute() {}, addEventListener() {} }
  let v = String(t); Object.defineProperty(n, 'textContent', { get: () => v, set: (x) => { v = String(x) } }); return n
}
function mkEl(tag) {
  const n = { tag, children: [], attrs: {}, style: {}, addEventListener() {}, remove() {}, focus() {} }
  let own = ''
  n.appendChild = (c) => { if (c && c.tag === '#frag') for (const k of c.children) n.children.push(k); else n.children.push(c); return c }
  n.setAttribute = (k, val) => { n.attrs[k] = val }
  Object.defineProperty(n, 'textContent', { get: () => own + n.children.map((c) => c.textContent || '').join(''), set: (x) => { n.children.length = 0; own = String(x) } })
  return n
}
// document 级监听走真实注册表:askStr 外点关闭(click/mousedown 捕获)要能被 dispatchDoc 触发
const docListeners = new Map()
globalThis.document = {
  createElement: mkEl, createTextNode: mkText, createDocumentFragment: () => mkEl('#frag'),
  addEventListener: (t, f) => { if (!docListeners.has(t)) docListeners.set(t, new Set()); docListeners.get(t).add(f) },
  removeEventListener: (t, f) => { const s = docListeners.get(t); if (s) s.delete(f) },
}
const dispatchDoc = (t, ev) => { for (const f of Array.from(docListeners.get(t) || [])) f(ev) }
const findAll = (node, tag) => { const out = []; const walk = (n) => { for (const c of (n.children || [])) { if (c.tag === tag) out.push(c); walk(c) } }; walk(node); return out }
const anyAttr = (node, key) => { let hit = false; const walk = (n) => { if (n.attrs && key in n.attrs) hit = true; for (const c of (n.children || [])) walk(c) }; walk(node); return hit }

// ── 冻钟(必须在求值前:模块体就要恢复队列/推日期)+ 假 localStorage ─────────────
const NOW = Date.parse('2026-08-06T04:00:00Z') // 上海正午
Date.now = () => NOW
const _ls = new Map([
  // 预置一条上次没跑完的队列项:求值时应被标成「中断,点击重试」
  ['plugin.readflow.queue', JSON.stringify([{ id: 'boot1', url: 'https://old.example/a', status: 'fetching', title: 'old.example' }])],
])
globalThis.localStorage = { getItem: (k) => (_ls.has(k) ? _ls.get(k) : null), setItem: (k, v) => _ls.set(k, String(v)), removeItem: (k) => _ls.delete(k) }

// ── mock ctx + 内存 vault ─────────────────────────────────────────────────────
const V = new Map(); const writes = []
const reg = { views: [], commands: [], settings: [], status: [], listSources: [] }
const sbUpdates = []; const activityEvents = []; const opened = []; const notes = []
const navLoaded = []; const navOpened = [] // R1/R2:ctx.app.loadPage / ctx.app.openFile 的调用账本
const ctx = {
  registerView: (v) => reg.views.push(v),
  registerCommand: (c) => reg.commands.push(c),
  registerSetting: (s) => reg.settings.push(s),
  registerStatusItem: (s) => { reg.status.push(s); return { update: (p) => sbUpdates.push(p), dispose() {} } },
  registerListSource: (x) => reg.listSources.push(x), // 统一左栏数据源(宿主 2026-08-25+)
  notify: (m, o) => notes.push({ m: String(m), o }), openView: (v) => opened.push(v),
  activity: { log: (event, detail) => activityEvents.push({ event, detail }) },
  app: {
    notify() {}, openFile: (p) => navOpened.push(p), loadPage: (p) => navLoaded.push(p),
    prompt: async () => '',
    workFolder: () => '稍后读',
    readFile: async (p) => (V.has(p) ? V.get(p) : null),
    writeFile: async (p, t) => { V.set(p, String(t)); writes.push(p) },
  },
}
globalThis.__READFLOW_TEST__ = {}
const dispose = new Function('ctx', src)(ctx)
const T = globalThis.__READFLOW_TEST__

// ── 贡献点契约(id 全按 SPEC) ─────────────────────────────────────────────────
A.equal(typeof dispose, 'function', 'setup 应返回 disposer')
A.ok(reg.views.find((v) => v.id === 'library' && v.title === '稍后读' && typeof v.mount === 'function'), '应注册 library 视图')
A.ok(reg.views.find((v) => v.id === 'reader' && v.title === '阅读' && typeof v.mount === 'function'), '应注册 reader 视图')
A.deepEqual(reg.commands.map((c) => c.id).sort(), ['readflow-add', 'readflow-import-clip', 'readflow-open'], '三个命令,id 带插件前缀')
for (const c of reg.commands) A.ok(c.id.startsWith('readflow-'), `命令 id 必须带前缀:${c.id}`)
A.deepEqual(reg.settings.map((s) => s.key).sort(), ['clipFolder', 'fontSize'], '两个设置')
A.equal(reg.settings.find((s) => s.key === 'fontSize').default, 16)
A.equal(reg.settings.find((s) => s.key === 'fontSize').type, 'number')
A.equal(reg.settings.find((s) => s.key === 'clipFolder').default, 'Forsion Clip')
A.equal(reg.status.length, 1, '应注册状态栏项')

// ── 重启恢复:预置的 fetching 项应标「中断,点击重试」 ──────────────────────────
A.equal(T.queue.items.length, 1)
A.equal(T.queue.items[0].status, 'failed')
A.equal(T.queue.items[0].errType, 'interrupted')
A.ok(T.queue.items[0].error.includes('中断'), T.queue.items[0].error)
{
  const rv = T.reviveQueue(JSON.stringify([{ id: 'x', url: 'https://r.example/p', status: 'pending' }, { id: 'y', url: 'https://r.example/q', status: 'done', title: 'q' }]))
  A.equal(rv[0].status, 'failed'); A.equal(rv[0].errType, 'interrupted'); A.ok(rv[0].error.includes('点击重试'))
  A.equal(rv[1].status, 'done', 'done 项原样保留')
  A.deepEqual(T.reviveQueue('not json'), [], '坏 JSON 回空')
  A.deepEqual(T.reviveQueue(null), [], '无存档回空')
}

// ── 纯函数:slug / 域名 / 日期 / 估读 ──────────────────────────────────────────
A.equal(T.slugify('Hello, World!'), 'Hello-World')
A.equal(T.slugify('为什么稍后读永远读不完'), '为什么稍后读永远读不完')
A.ok(T.slugify('A'.repeat(60)).length <= 24, 'slug 取标题前 24 字符')
A.equal(T.slugify('!!!???'), 'article', '全符号标题兜底 article')
A.equal(T.slugify('  空格  与……标点!围绕  '), '空格-与-标点-围绕')
A.equal(T.domainOf('https://www.example.com/a/b?c=1'), 'example.com')
A.equal(T.domainOf('not a url'), '')
A.equal(T.ymd(), '20260806', '冻钟下的本地日期(上海正午)')
A.equal(T.estimateMinutes('字'.repeat(800)), 2, '估读 = 字数/400')
A.equal(T.estimateMinutes('字'.repeat(4800)), 12)
A.equal(T.estimateMinutes('', 7), 7, '正文短到没得算才用模型 hint')
A.equal(T.estimateMinutes('', 'x'), 1, 'hint 也坏就 1 分钟保底')

// ── frontmatter 解析往返:rf_* 字段不丢 ────────────────────────────────────────
const FM0 = { rf_url: 'https://example.com/post', rf_title: '文章标题:含冒号', rf_saved: '2026-08-06T12:00:00.000Z', rf_status: 'inbox', rf_minutes: 12 }
const t1 = T.buildArticleText(FM0, '正文第一段\n\n第二段')
{
  const p = T.parseFrontmatter(t1)
  A.equal(p.fm.rf_url, FM0.rf_url)
  A.equal(p.fm.rf_title, FM0.rf_title, '值里的冒号不丢(只按第一个冒号切)')
  A.equal(p.fm.rf_saved, FM0.rf_saved)
  A.equal(p.fm.rf_status, 'inbox')
  A.equal(p.fm.rf_minutes, '12')
  A.ok(p.body.includes('正文第一段') && p.body.includes('第二段'))
}
{
  const t2 = T.setFmField(t1, 'rf_status', 'reading')
  const p = T.parseFrontmatter(t2)
  A.equal(p.fm.rf_status, 'reading', '改状态生效')
  A.equal(p.fm.rf_url, FM0.rf_url, '其余字段原样')
  A.equal(p.fm.rf_saved, FM0.rf_saved)
  A.equal(p.fm.rf_minutes, '12')
  A.ok(p.body.includes('第二段'), '正文原样')
  const t3 = T.setFmField(t2, 'rf_status', 'done')
  const p3 = T.parseFrontmatter(t3)
  A.equal(p3.fm.rf_status, 'done')
  A.equal(p3.fm.rf_title, FM0.rf_title, '写→读→再写不丢字段')
}
{
  const t = T.setFmField('裸剪藏正文,原本没有 frontmatter', 'rf_status', 'reading')
  const p = T.parseFrontmatter(t)
  A.equal(p.fm.rf_status, 'reading', 'Clip 原件没有 frontmatter 时就地补一个')
  A.ok(p.body.includes('裸剪藏正文'), '原正文保留')
}
{
  // 目标键自身是块标量:续行必须一并吃掉,不许孤立成非法 YAML(P2 钉)
  const t = T.setFmField('---\nrf_status: |\n  inbox\n  second: line\ntitle: 块\n---\n\n正文', 'rf_status', 'reading')
  A.ok(!t.includes('inbox') && !t.includes('second: line'), '块标量续行不许被孤立残留')
  const p = T.parseFrontmatter(t)
  A.equal(p.fm.rf_status, 'reading')
  A.equal(p.fm.title, '块', '后续键原样')
  A.ok(p.body.includes('正文'))
  // 非块标量值绝不误吃下一行
  const t2 = T.setFmField('---\nrf_status: inbox\ntitle: 普通\n---\n\n正文', 'rf_status', 'done')
  A.equal(T.parseFrontmatter(t2).fm.title, '普通', '普通值只换自己那一行')
}

// ── 划线追加:无节新建 / 有节续尾 / 不越过后续节 ────────────────────────────────
{
  const h1 = T.appendHighlight(t1, '第一条划线引文', '')
  A.ok(h1.includes('## 划线'), '无节应新建')
  A.ok(h1.includes('> 第一条划线引文'))
  A.ok(!h1.includes('> —'), '空批注不写批注行')
  const h2 = T.appendHighlight(h1, '第二条引文', '我的批注')
  A.equal(h2.split('## 划线').length, 2, '## 划线 节只有一个')
  A.ok(h2.includes('> 第二条引文') && h2.includes('> — 我的批注'))
  A.ok(h2.indexOf('第一条划线引文') < h2.indexOf('第二条引文'), '追加在节尾')
  const withSum = T.upsertSection(h2, '## AI 摘要', '旧摘要甲')
  const h3 = T.appendHighlight(withSum, '第三条引文', '')
  A.ok(h3.indexOf('> 第三条引文') < h3.indexOf('## AI 摘要'), '划线追加不越过后续节')
  A.equal(T.parseFrontmatter(h3).fm.rf_url, FM0.rf_url, '划线不动 frontmatter')
  // 摘要整节替换
  const s2 = T.upsertSection(h3, '## AI 摘要', '新摘要乙')
  A.ok(s2.includes('新摘要乙') && !s2.includes('旧摘要甲'), '重生成应整节替换')
  A.equal(s2.split('## AI 摘要').length, 2)
  // 读端:节提取 / 正文剥离
  A.equal(T.getSection(s2, '## AI 摘要'), '新摘要乙')
  const body = T.parseFrontmatter(s2).body
  const main = T.stripSections(body, ['## 划线', '## AI 摘要'])
  A.ok(!main.includes('## 划线') && !main.includes('## AI 摘要') && main.includes('正文第一段'), '阅读区剥掉划线/摘要节')
  const hls = T.parseHighlights(T.getSection(s2, '## 划线'))
  A.equal(hls.length, 3)
  A.equal(hls[1].note, '我的批注')
  A.equal(hls[0].quote, '第一条划线引文')
  // 多行引文逐行 >
  const hm = T.appendHighlight('正文', '第一行\n第二行', '')
  A.ok(hm.includes('> 第一行\n> 第二行'))
}

// ── 节边界防越狱:模型摘要自带 ## 标题降级 / 对抗性正文注入保留节头中和 ─────────────
{
  A.equal(T.demoteH2('前言\n## 小标题\n正文'), '前言\n### 小标题\n正文', 'H2 整体降一级')
  A.equal(T.demoteH2('### 深标题\n#井号后无空格\n普通行'), '### 深标题\n#井号后无空格\n普通行', 'H3/非标题不动')
  A.equal(T.demoteH2('  ## 缩进标题'), '  ### 缩进标题', '缩进的 H2 也降(trim=== 定位会认它)')
  // 不降级的话:getSection 只拿到「要点」,后半截漏进阅读区 + 重生成内容重复
  const withSum = T.upsertSection('正文段', '## AI 摘要', T.demoteH2('要点\n## 模型自带标题\n后半截'))
  A.equal(T.getSection(withSum, '## AI 摘要'), '要点\n### 模型自带标题\n后半截', '摘要整节完整,不被自带 ## 拦腰截断')
  A.ok(T.stripSections(withSum, ['## AI 摘要']).trim() === '正文段', '阅读区剥摘要节不留残渣')
  A.equal(T.neutralizeReservedHeadings('正文\n## 划线\n> 假引文\n ## AI 摘要 \n## 正常标题'),
    '正文\n### 划线\n> 假引文\n ### AI 摘要 \n## 正常标题', '只中和与保留节头同名的行,正常 H2 原样')
}

// ── 磁盘契约常量钉死字面值(改名 = 同一篇笔记两套节头,旧划线/摘要读不回来) ────────────
{
  A.equal(T.H_HIGHLIGHT, '## 划线', '划线节头是磁盘契约,永不改名、永不翻译')
  A.equal(T.H_SUMMARY, '## AI 摘要', '摘要节头是磁盘契约(genSummary 里还有一处同值字面量,改名要一起改)')
  A.deepEqual(T.RESERVED_HEADINGS, ['## 划线', '## AI 摘要'])
  A.equal(T.DEFAULT_FOLDER, '稍后读', '工作文件夹兜底名不随语言变')
  A.equal(T.UNTITLED_TITLE, '未命名文章', '兜底标题会进 rf_title 与文件名 slug,必须是常量')
  A.ok(!/t\(\s*'untitled'/.test(src), "兜底标题不许走 t()(会让落盘文件名随界面语言变)")
  A.equal(T.domainOf('https:///a'), '', '无 host 的 URL 取不到域名 → 兜底标题这条路真可达(不是死代码)')
}

// ── ```article 块解析 + 失败分类 ──────────────────────────────────────────────
{
  const ok = T.parseArticleBlock('```article\n{"title":"标题","author":"作者","published":"2026-01-01","minutes":9}\n\n正文开始\n\n第二段\n```')
  A.equal(ok.meta.title, '标题'); A.equal(ok.meta.minutes, 9)
  A.ok(ok.body.startsWith('正文开始') && ok.body.includes('第二段'))
  // 模型废话包裹 + fence tag 变体
  const chat = 'Sure! Here is the article you asked for:\n\n```markdown article\n{"title":"包裹"}\n\nBody text here\n```\nHope this helps!'
  A.equal(T.parseArticleBlock(chat).meta.title, '包裹')
  A.equal(T.parseArticleBlock(chat).body, 'Body text here')
  // 正文里自带代码块:收尾取最后一个 fence,不许拦腰截断
  const nested = '```article\n{"title":"码"}\n\n前文\n\n```js\nconst a = 1\n```\n\n后文\n```'
  const pn = T.parseArticleBlock(nested)
  A.ok(pn.body.includes('const a = 1') && pn.body.includes('后文'), '内嵌代码块不截断正文')
  A.equal(T.parseArticleBlock('没有块'), null)
  A.equal(T.parseArticleBlock('```article\n不是 JSON\n\n正文\n```'), null)
  // 分类三态
  A.equal(T.classifyArticle(null).errType, 'fetch_error')
  A.equal(T.classifyArticle({ meta: { error: 'paywall' }, body: '' }).errType, 'paywall')
  A.equal(T.classifyArticle({ meta: { error: 'fetch_error' }, body: '' }).errType, 'fetch_error')
  A.equal(T.classifyArticle({ meta: { title: 'T' }, body: '太短' }).errType, 'too_short')
  const good = T.classifyArticle({ meta: { title: 'T' }, body: '字'.repeat(300) })
  A.equal(good.ok, true); A.equal(good.meta.title, 'T')
}

// ── 注入模型的指令必须英文,且死限工具/范围 ─────────────────────────────────────
{
  const fm = T.fetchMessage('https://x.example/a')
  A.ok(!/[一-鿿]/.test(fm), '抓取指令不许有中文')
  A.ok(fm.includes('web_fetch') && fm.includes('```article') && fm.includes('paywall') && fm.includes('fetch_error'))
  const cm = T.clipListMessage('Forsion Clip')
  A.ok(!/[一-鿿]/.test(cm), '扫目录指令不许有中文')
  A.ok(cm.includes('READ-ONLY') && cm.includes('files'))
  A.ok(!/[一-鿿]/.test(T.summaryMessage('T', 'body')), '摘要指令不许有中文')
  A.ok(!/[一-鿿]/.test(T.qaMessage('T', 'body', 'q', false)), '问答种子指令不许有中文')
  A.equal(T.qaMessage('T', 'body', 'q2', true), 'q2', '已种上下文后只发问题')
}

// ── 落盘:slug 重名序号 / 索引六键契约 / frontmatter 齐全 ───────────────────────
const r1 = await T.saveArticle({ url: 'https://example.com/1', title: '同名文章', author: '张三', minutes: 5 }, '字'.repeat(900))
A.equal(r1.path, '稍后读/20260806-同名文章.md')
const r2 = await T.saveArticle({ url: 'https://example.com/2', title: '同名文章' }, '字'.repeat(900))
A.equal(r2.path, '稍后读/20260806-同名文章-2.md', '重名加序号')
{
  const idx = JSON.parse(V.get('稍后读/.readflow-index.json'))
  A.equal(idx.items.length, 2)
  A.deepEqual(Object.keys(idx.items[0]).sort(), ['minutes', 'path', 'saved', 'status', 'title', 'url'], '索引条目六键契约')
  A.equal(idx.items[0].path, r2.path, '新的在前')
  A.equal(idx.items[0].minutes, 2, '估读本地算(900 字 / 400),模型 hint 不作数')
  const pf = T.parseFrontmatter(V.get(r1.path))
  A.equal(pf.fm.rf_url, 'https://example.com/1')
  A.equal(pf.fm.rf_title, '同名文章')
  A.equal(pf.fm.rf_saved, new Date(NOW).toISOString())
  A.equal(pf.fm.rf_status, 'inbox')
  A.equal(pf.fm.rf_minutes, '2')
  A.equal(pf.fm.rf_author, '张三')
}

// ── 状态流转:先改文件再刷索引;读完记活动日志;状态栏跟着在读数走 ─────────────────
A.equal(await T.updateStatus(r1.path, 'reading'), true)
A.equal(T.parseFrontmatter(V.get(r1.path)).fm.rf_status, 'reading', '先改文件 frontmatter')
{
  const idx = JSON.parse(V.get('稍后读/.readflow-index.json'))
  A.equal(idx.items.find((i) => i.path === r1.path).status, 'reading', '再刷索引')
}
A.ok(sbUpdates.some((u) => u.text && u.text.includes('1')), '状态栏应显示在读篇数')
A.equal(await T.updateStatus(r1.path, 'done'), true)
A.ok(activityEvents.some((e) => e.event === 'article_read'), '读完应记 article_read 活动')
{
  const pf = T.parseFrontmatter(V.get(r1.path))
  A.equal(pf.fm.rf_url, 'https://example.com/1', '两轮状态改写后 rf_url 不丢')
  A.equal(pf.fm.rf_author, '张三', 'rf_author 不丢')
  A.equal(pf.fm.rf_saved, new Date(NOW).toISOString(), 'rf_saved 不丢')
}

// ── 打开校验:孤儿剔除 ────────────────────────────────────────────────────────
{
  const idx = await T.readIndex()
  idx.items.unshift({ path: '稍后读/ghost.md', url: 'https://g.example/x', title: 'ghost', status: 'inbox', saved: '2026-08-01T00:00:00.000Z', minutes: 1 })
  await T.writeIndex(idx)
  A.equal(await T.loadArticle('稍后读/ghost.md'), null, '文件缺失应返回 null')
  const after = JSON.parse(V.get('稍后读/.readflow-index.json'))
  A.ok(!after.items.some((i) => i.path === '稍后读/ghost.md'), '孤儿应被剔除出索引')
  const la = await T.loadArticle(r1.path)
  A.equal(la.fm.rf_title, '同名文章', '正常条目可读')
}

// ── 队列:防重入 / 失败态记录 / 失败行复用重试 / force 重新抓取通道 ────────────────
{
  const a1 = T.qAdd('https://example.com/queue-a')
  A.equal(a1.ok, true); A.equal(a1.item.status, 'pending'); A.equal(a1.item.title, 'example.com', '占位行 title=域名')
  const a2 = T.qAdd('https://example.com/queue-a')
  A.equal(a2.ok, false); A.equal(a2.reason, 'in_queue', '同 URL 二次入队被拒')
  const a3 = T.qAdd('https://example.com/1')
  A.equal(a3.ok, false); A.equal(a3.reason, 'exists', '已在索引默认拒')
  const a4 = T.qAdd('https://example.com/1', { force: true })
  A.equal(a4.ok, true, 'force=重新抓取通道放行')
  A.equal(T.qAdd('不是链接').ok, false)
  A.equal(T.qAdd('').ok, false)
  await new Promise((r) => setTimeout(r, 60))
  const f1 = T.queue.items.find((i) => i.url === 'https://example.com/queue-a')
  A.equal(f1.status, 'failed', 'node 无引擎应落失败态')
  A.equal(f1.errType, 'fetch_error', '失败类型如实记录')
  A.ok(f1.error.includes('引擎'), f1.error)
  const persisted = JSON.parse(_ls.get('plugin.readflow.queue'))
  A.ok(persisted.some((x) => x.url === 'https://example.com/queue-a' && x.status === 'failed' && x.errType === 'fetch_error'), '队列状态应落 localStorage')
  // 同 URL 再入队:复用失败行重试,不另起新行
  const n0 = T.queue.items.length
  const a5 = T.qAdd('https://example.com/queue-a')
  A.equal(a5.ok, true); A.equal(a5.retried, true)
  A.equal(T.queue.items.length, n0, '失败行应被复用')
  await new Promise((r) => setTimeout(r, 60))
  A.equal(T.queue.items.find((i) => i.url === 'https://example.com/queue-a').status, 'failed')
  // 清除已完成只动 done
  T.queue.items.push({ id: 'done1', url: 'https://d.example/x', status: 'done', controller: null })
  T.qClearDone()
  A.ok(!T.queue.items.find((i) => i.id === 'done1'))
  A.ok(T.queue.items.find((i) => i.url === 'https://example.com/queue-a'), '失败项不被清除')
  T.qRemove(T.queue.items.find((i) => i.url === 'https://example.com/queue-a').id)
  A.ok(!T.queue.items.find((i) => i.url === 'https://example.com/queue-a'), '移除生效')
}

// ── Clip 导入:清单解析 / 元数据抠取 / 登记去重(按路径与 rf_url) ─────────────────
A.deepEqual(T.parseFileListBlock('```files\na.md\n- b.md\n"c d.md"\n../evil.md\nsub/c.md\nnote.txt\n```'), ['a.md', 'b.md', 'c d.md'], '只收裸 .md 文件名,拒路径穿越')
A.deepEqual(T.parseFileListBlock('闲聊两句\nx.md\n再来一句'), ['x.md'], '没有 fenced 块时退化逐行抠')
{
  const m1 = T.extractClipMeta('---\ntitle: "剪藏帖子"\nsource: https://s.example/p\n---\n\n正文', 'f.md')
  A.equal(m1.url, 'https://s.example/p'); A.equal(m1.title, '剪藏帖子')
  const m2 = T.extractClipMeta('# 大标题\n\n看 [这里](https://l.example/x) 的原文', 'f.md')
  A.equal(m2.url, 'https://l.example/x'); A.equal(m2.title, '大标题')
  const m3 = T.extractClipMeta('无链接正文', '文件名.md')
  A.equal(m3.url, ''); A.equal(m3.title, '文件名', '啥都没有就用文件名')
}
{
  V.set('Forsion Clip/剪藏一.md', '---\ntitle: 剪藏文章一\nurl: https://clip.example/one\n---\n\n' + '字'.repeat(800))
  V.set('Forsion Clip/剪藏二.md', '# 标题二\n\n[原文](https://example.com/1)\n\n正文') // URL 已在索引 → 跳过
  const ci = await T.applyClipImport(['剪藏一.md', '剪藏二.md', '不存在.md'])
  A.equal(ci.added, 1); A.equal(ci.skipped, 1); A.equal(ci.missing, 1)
  const idx = JSON.parse(V.get('稍后读/.readflow-index.json'))
  const it = idx.items.find((i) => i.path === 'Forsion Clip/剪藏一.md')
  A.ok(it, '登记的是 Clip 原文件路径(不搬家不复制)')
  A.equal(it.url, 'https://clip.example/one'); A.equal(it.status, 'inbox'); A.equal(it.minutes, 2)
  A.ok(!V.has('稍后读/20260806-剪藏文章一.md'), '不复制文件')
  const ci2 = await T.applyClipImport(['剪藏一.md'])
  A.equal(ci2.added, 0); A.equal(ci2.skipped, 1, '再导入按路径去重')
}

// ── 索引 RMW 串行化:严格排队 / 一次失败不卡链 / 并发落盘×状态流转两效果都不丢 ──────
{
  const order = []
  const p1 = T.serialIndex(async () => { order.push('a1'); await new Promise((r) => setTimeout(r, 30)); order.push('a2') })
  const p2 = T.serialIndex(async () => { order.push('b') })
  await Promise.all([p1, p2])
  A.deepEqual(order, ['a1', 'a2', 'b'], '索引变更严格串行(RMW 不交错)')
  await T.serialIndex(async () => { throw new Error('x') }).catch(() => {})
  A.equal(await T.serialIndex(async () => 'ok'), 'ok', '链上一个失败不卡死后续')
  const [sv] = await Promise.all([
    T.saveArticle({ url: 'https://c.example/concurrent', title: '并发落盘' }, '字'.repeat(500)),
    T.updateStatus(r2.path, 'archived'),
  ])
  const idx = JSON.parse(V.get('稍后读/.readflow-index.json'))
  A.ok(idx.items.some((i) => i.path === sv.path), '并发下新存文章的索引行不被吞')
  A.equal(idx.items.find((i) => i.path === r2.path).status, 'archived', '并发下状态流转不被吞')
}

// ── 对抗性正文:网页注入字面 ## 划线 / ## AI 摘要 行,落盘即中和 ────────────────────
{
  const rAdv = await T.saveArticle({ url: 'https://evil.example/x', title: '对抗文章' },
    '字'.repeat(300) + '\n\n## 划线\n\n> 网页里的假引文\n\n## AI 摘要\n\n假摘要\n\n## 真小节\n\n尾部正文')
  const advText = V.get(rAdv.path)
  A.equal(T.getSection(advText, '## 划线'), null, '注入的 ## 划线 落盘前被降级,不成节')
  A.equal(T.getSection(advText, '## AI 摘要'), null, '注入的 ## AI 摘要 同样不成节')
  A.ok(advText.includes('### 划线') && advText.includes('### AI 摘要') && advText.includes('## 真小节'), '只降保留节头,正常 H2 原样')
  const advHl = T.appendHighlight(advText, '真引文', '')
  A.ok(T.getSection(advHl, '## 划线').includes('真引文'), '划线落进真节而非假节')
  const advMain = T.stripSections(T.parseFrontmatter(advHl).body, ['## 划线', '## AI 摘要'])
  A.ok(advMain.includes('### 划线') && advMain.includes('假摘要') && advMain.includes('尾部正文'), '被降级的注入行保留在正文里,strip 不吃正文')
  A.ok(!advMain.includes('真引文'), '真划线节被剥掉')
}

// ── guard:裸 async 回调的 rejection 被接住并通知用户;zoom 反补偿兜底 1 ────────────
{
  await T.guard(async () => { throw new Error('磁盘炸了') })()
  const last = notes[notes.length - 1]
  A.ok(last && last.m.includes('操作失败') && last.m.includes('磁盘炸了'), 'guard 应接住 rejection 并给用户反馈')
  A.equal(last.o && last.o.level, 'error')
  await T.guard(() => 42)() // 同步函数也可包,不抛
  A.equal(T.zoomFactor(), 1, '无 zoom 环境兜底 1')
}

// ── XSS:恶意正文走渲染器后无元素无 attrs ───────────────────────────────────────
{
  const box = mkEl('div')
  T.renderMarkdown(box, '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[好](https://x.com) [坏](javascript:evil) **粗**')
  A.ok(box.textContent.includes('<script>alert(1)</script>'), '<script> 应作为字面文字保留')
  A.ok(box.textContent.includes('onerror'), '<img onerror> 应作为字面文字保留')
  A.equal(findAll(box, 'script').length, 0, '绝不能创建 script 元素')
  A.equal(findAll(box, 'img').length, 0, '绝不能从注入文本创建 img')
  A.equal(anyAttr(box, 'onerror'), false, '绝不能设 onerror 属性')
  const as = findAll(box, 'a')
  A.equal(as[0].attrs.href, 'https://x.com', '安全链接放行')
  A.equal(as[1].attrs.href, undefined, 'javascript: 不设 href')
  A.equal(T.safeHref('javascript:alert(1)'), '')
  A.equal(T.safeHref('https://x.com'), 'https://x.com')
  // 图片:块级 ![]() 只放行 https
  const box2 = mkEl('div')
  T.renderMarkdown(box2, '![a](https://x.com/i.png)\n\n![b](javascript:evil)')
  const imgs = findAll(box2, 'img')
  A.equal(imgs.length, 1)
  A.equal(imgs[0].attrs.src, 'https://x.com/i.png')
  A.ok(box2.textContent.includes('![b](javascript:evil)'), '危险图片地址按字面文字渲染')
  // 结构冒烟
  const box3 = mkEl('div')
  T.renderMarkdown(box3, '# H\n\n- a\n- b\n\n> 引用\n\n`code`')
  A.equal(findAll(box3, 'h1').length, 1)
  A.equal(findAll(findAll(box3, 'ul')[0], 'li').length, 2)
  A.equal(findAll(box3, 'blockquote').length, 1)
}

// ── 主题兜底可读性(吃不到宿主 token 时的强调色字色) ────────────────────────────
A.equal(T.onColorOf([248, 247, 246]), '#16161a', '纸白强调色上给深字')
A.equal(T.onColorOf([28, 28, 28]), '#ffffff', '炭黑强调色上给白字')

// ── 建夹幂等 ─────────────────────────────────────────────────────────────────
{
  const wN = writes.length
  await T.ensureWorkFolder()
  A.equal(writes.length, wN, '已有索引不重复写(幂等)')
  V.delete('稍后读/.readflow-index.json')
  await T.ensureWorkFolder()
  A.ok(V.has('稍后读/.readflow-index.json'), '索引缺失时重建')
}

// ── 索引读失败/损坏:绝不静默把列表截断成 1 条(P2 数据保全钉) ────────────────────
{
  const idxKey = '稍后读/.readflow-index.json'
  const before = V.get(idxKey)
  A.ok(JSON.parse(before).items.length >= 2, '前置:索引里应有多条')
  // ① 瞬时读失败(readFile 抛):操作必须抛错拒写,索引文件一字未动
  const realRead = ctx.app.readFile
  let boom = true
  ctx.app.readFile = async (p) => { if (boom && p === idxKey) { boom = false; throw new Error('EIO') } return realRead(p) }
  await A.rejects(T.updateStatus(r1.path, 'inbox'), /索引读取失败/, '瞬时读失败必须抛,不许当空库继续')
  ctx.app.readFile = realRead
  A.equal(V.get(idxKey), before, '读失败后索引文件必须一字未动(不被截断)')
  // ② 内容损坏(半截 JSON):原件备份成 .bak + 明示用户 + 重置,新文章照常登记
  V.set(idxKey, before.slice(0, 40))
  const nSnap = notes.length
  const rFix = await T.saveArticle({ url: 'https://fix.example/x', title: '损坏后新存' }, '字'.repeat(400))
  A.equal(V.get(idxKey + '.bak'), before.slice(0, 40), '坏索引原件必须先备份成 .bak')
  A.ok(notes.slice(nSnap).some((n) => n.m.includes('备份')), '索引损坏必须明示用户,不许静默')
  A.ok(JSON.parse(V.get(idxKey)).items.some((i) => i.path === rFix.path), '重置后新文章正常登记')
  // ③ 损坏且备份写不进去:备份是唯一保全,必须拒绝一切写入
  V.set(idxKey, '{broken')
  const realWrite = ctx.app.writeFile
  ctx.app.writeFile = async (p, txt) => { if (p.endsWith('.bak')) throw new Error('ENOSPC'); return realWrite(p, txt) }
  await A.rejects(T.updateStatus(r1.path, 'reading'), /备份失败/, '备份失败必须拒写')
  ctx.app.writeFile = realWrite
  A.equal(V.get(idxKey), '{broken', '拒写后坏索引原样保留(留给下次备份)')
  // 复原,供后续测试
  V.set(idxKey, before)
  await T.readIndex()
}

// ── 文章读失败(IO 异常)≠ 文件不存在(null):绝不当孤儿把登记行剔掉(P2 同族钉) ────
{
  const idxKey = '稍后读/.readflow-index.json'
  const realRead = ctx.app.readFile
  let boom = true
  ctx.app.readFile = async (p) => { if (boom && p === r1.path) { boom = false; throw new Error('EIO') } return realRead(p) }
  await A.rejects(T.loadArticle(r1.path), /读取文章失败/, '打开时读失败必须抛,不许当「文件没了」剔孤儿')
  A.ok(JSON.parse(V.get(idxKey)).items.some((i) => i.path === r1.path), '读失败后登记行必须还在')
  boom = true
  await A.rejects(T.updateStatus(r1.path, 'done'), /读取文章失败/, '状态流转读失败必须抛,状态不改')
  A.ok(JSON.parse(V.get(idxKey)).items.some((i) => i.path === r1.path), '状态流转读失败后登记行必须还在')
  ctx.app.readFile = realRead
  const ok = await T.loadArticle(r1.path)
  A.ok(ok && ok.fm.rf_title, '恢复后正常可读')
}

// ── 引擎层兜底错误必须走词表(1.1.1 回归钉:曾被写死英文,中文用户抓取失败看到英文句) ─────
// 这五句(起 run 失败 / 无 runId / 订阅失败 / 任务失败 / 连接中断)经 e_raw 的 {msg} 一路流回
// 队列失败行与「抓取失败(fetch_error):…」toast,是用户看得见的人话,不是内部日志。
{
  const seen = []
  globalThis.window = { tangu: { getConfig: async () => ({ backendUrl: 'http://fake.local', token: 'tok' }) } }
  globalThis.fetch = async (url) => { seen.push(String(url)); return { ok: false, status: 500, text: async () => '' } }
  const url = 'https://enginefail.example/a'
  A.equal(T.qAdd(url).ok, true)
  await new Promise((r) => setTimeout(r, 60))
  const it = T.queue.items.find((i) => i.url === url)
  A.equal(it.status, 'failed', '引擎 500 应落失败态')
  A.equal(it.errType, 'fetch_error')
  A.ok(it.error.includes('HTTP 500'), `兜底句应带上状态码:${it.error}`)
  A.ok(/[一-鿿]/.test(it.error), `默认(中文)宿主下引擎兜底错误必须是中文,不许写死英文:${it.error}`)
  A.equal(seen.length, 1, '起 run 就 500,不该再去订阅事件流')
  T.qRemove(it.id) // 收干净,别把下面 dispose 那趟的 fetches 计数带偏
  delete globalThis.fetch
  delete globalThis.window
}

// ── P1 钉:dispose 后队列真停(不再起新 run / 不再写盘 / 拒绝入队) ────────────────
{
  const fetches = []
  globalThis.window = { tangu: { getConfig: async () => ({ backendUrl: 'http://fake.local', token: 'tok' }) } }
  globalThis.fetch = (url, opts) => new Promise((resolve, reject) => {
    fetches.push(String(url))
    if (opts && opts.signal) {
      if (opts.signal.aborted) reject(new Error('aborted'))
      else opts.signal.addEventListener('abort', () => reject(new Error('aborted')))
    }
  })
  A.equal(T.qAdd('https://dispose.example/a').ok, true)
  A.equal(T.qAdd('https://dispose.example/b').ok, true)
  await new Promise((r) => setTimeout(r, 20))
  A.equal(fetches.length, 1, '第一条应已起飞(POST /agent/runs 悬着)')
  A.equal(T.queue.items.find((i) => i.url === 'https://dispose.example/b').status, 'pending')
  const wSnap = writes.length, noteSnap = notes.length
  dispose() // ← 插件停用(disposer 顺带断言可执行):在飞的被 abort,pending 的必须停在原地
  await new Promise((r) => setTimeout(r, 40))
  A.equal(fetches.length, 1, 'dispose 后不许再发新 run(第二个 pending 项必须真停)')
  A.equal(T.queue.items.find((i) => i.url === 'https://dispose.example/b').status, 'pending', 'pending 项停在原地(下次启动标「中断,点击重试」)')
  A.equal(writes.length, wSnap, 'dispose 后不许再写盘')
  A.ok(!notes.slice(noteSnap).some((n) => n.m.includes('已存入')), 'dispose 后不许经已停用 ctx 弹成功通知')
  A.equal(T.qAdd('https://dispose.example/c').ok, false, 'dispose 后拒绝入队')
  delete globalThis.fetch
  delete globalThis.window
}

// ── 旧宿主 ctx(07-18 后 API 全删):setup 不抛,命令降级可跑 ──────────────────────
{
  const oldReg = { commands: [], settings: [] }
  const oldCtx = {
    app: { notify() {}, getActivePage: () => null, getActivePageText: () => '', loadPage() {}, createPage() {}, toggleMode() {}, setTheme() {}, openSearch() {}, openSwitcher() {} },
    registerSlashItem() {}, registerCommand: (c) => oldReg.commands.push(c), registerTheme() {}, registerPanel() {},
    registerSetting: (s) => oldReg.settings.push(s),
  }
  globalThis.__READFLOW_TEST__ = {}
  const dispose2 = new Function('ctx', src)(oldCtx)
  A.equal(typeof dispose2, 'function', '旧宿主下也应返回 disposer')
  A.equal(oldReg.commands.length, 3, '旧宿主下命令照注册')
  A.equal(oldReg.settings.length, 2)
  oldReg.commands.find((c) => c.id === 'readflow-open').run() // openView 缺席 → 降级 notify,不抛
  await oldReg.commands.find((c) => c.id === 'readflow-import-clip').run() // readFile 缺席 → 降级提示,不抛

  // ── P1 钉:旧宿主(无 ctx.app.prompt)下 askStr 被「点外面」关掉必须 settle(null),不许静默挂死 ──
  const outside = { closest: () => null }
  const p1 = oldReg.commands.find((c) => c.id === 'readflow-add').run()
  let s1 = false; p1.then(() => { s1 = true })
  await new Promise((r) => setTimeout(r, 0)) // 让 promptStr 把弹窗挂上(openMenus)
  dispatchDoc('click', { target: outside }) // 划线按钮 mousedown 派生的在飞 click:不得关掉刚开的弹窗
  await new Promise((r) => setTimeout(r, 30))
  A.equal(s1, false, '挂载前手势的在飞 click 不许关掉弹窗(批注弹窗一开就没)')
  dispatchDoc('mousedown', { target: outside }) // 挂载后的真实外点手势:mousedown 先武装
  dispatchDoc('click', { target: outside })
  await new Promise((r) => setTimeout(r, 10))
  A.equal(s1, true, '外点关闭必须 settle(null),readflow-add 按「取消」收尾而非永久挂起')
  // disposer 关掉挂着的 askStr 同样必须 settle
  const p2 = oldReg.commands.find((c) => c.id === 'readflow-add').run()
  let s2 = false; p2.then(() => { s2 = true })
  await new Promise((r) => setTimeout(r, 0))
  dispose2()
  await new Promise((r) => setTimeout(r, 10))
  A.equal(s2, true, '插件 dispose 时挂着的 askStr 必须被 settle,不许留永久挂起的 await')
}

// ── 双语①:MSG 两侧键集合必须完全相等(漏翻一条就红) ─────────────────────────────
let MSG_KEYS = 0
{
  A.ok(T.MSG && T.MSG.zh && T.MSG.en, 'main.js 必须导出 MSG 词表')
  MSG_KEYS = Object.keys(T.MSG.zh).length
  const zh = Object.keys(T.MSG.zh).sort(), en = Object.keys(T.MSG.en).sort()
  A.deepEqual(en, zh, `MSG 两侧键集合必须完全相等(zh 独有 ${zh.filter((k) => !en.includes(k))} / en 独有 ${en.filter((k) => !zh.includes(k))})`)
  A.ok(zh.length >= 60, `词表太小(${zh.length} 条),UI 文案八成还有硬编码没接进来`)
  for (const k of zh) {
    A.ok(String(T.MSG.zh[k]).length > 0, `zh.${k} 不许空串`)
    A.ok(String(T.MSG.en[k]).length > 0, `en.${k} 不许空串`)
    A.ok(!/[一-鿿]/.test(String(T.MSG.en[k])), `en.${k} 里有中文:${T.MSG.en[k]}`)
    // 占位符两侧必须同套,否则英文句里会留下没替换的 {n}
    const ph = (s) => (String(s).match(/\{[a-z]+\}/g) || []).sort().join(',')
    A.equal(ph(T.MSG.en[k]), ph(T.MSG.zh[k]), `占位符两侧不一致:${k}`)
  }
  // 中文侧没被「为了过门禁」掏空:界面构件在默认(无 getLocale)宿主下仍然出中文
  A.ok(T.buildEmptyTip('inbox').textContent.includes('收件箱'), '默认宿主(无 getLocale)必须仍是中文界面')
  A.equal(T.statusLabel('reading'), '在读')
}

// ── 双语①-b:调用点审计 ───────────────────────────────────────────────────────
// 键集合相等只挡「翻漏一条」,挡不住 t('typo_key'):那种情况两侧都渲染出原始 key,
// CJK 残留检查看不见、真机 e2e 也看不见(英文界面下一个裸 key 本来就没有中文)。
{
  const defined = new Set(Object.keys(T.MSG.zh)) // 两侧键集合已断言相等,查一侧即可
  // ① 字面量调用点 t('key'(以 , 或 ) 收尾;t('st_' + s) 这类拼接被这条规则自然排除)
  const used = [...src.matchAll(/(?<![.\w])t\(\s*'([a-z0-9_]+)'\s*[,)]/g)].map((m) => m[1])
  A.ok(used.length >= 100, `t() 字面量调用点只扫到 ${used.length} 处,正则八成失灵了`)
  const miss = [...new Set(used)].filter((k) => !defined.has(k))
  A.deepEqual(miss, [], `t() 引用了词表里没有的键(打错键=两侧都渲染裸 key):${miss}`)
  // ② 「存钥匙不存句子」的动态路径:errKey / warnKey 一律是这四个前缀的字面量
  const dyn = [...new Set([...src.matchAll(/'((?:w_|q_|e_|err_)[a-z0-9_]*)'/g)].map((m) => m[1]))]
  A.ok(dyn.length >= 20, `errKey/warnKey 字面量只扫到 ${dyn.length} 个,正则八成失灵了`)
  const dynMiss = dyn.filter((k) => !defined.has(k))
  A.deepEqual(dynMiss, [], `errKey/warnKey 引用了词表里没有的键(队列行会渲染裸 key):${dynMiss}`)
  // ③ 拼接键 t('st_' + s):STATUS_ORDER 每个状态都得有对应键
  for (const s of T.STATUS_ORDER) A.ok(defined.has('st_' + s), `状态 ${s} 缺 st_ 键(statusLabel 会渲染裸 key)`)
}

// ── 双语②:mock ctx 的 getLocale 返回 'en' 时,真构件渲染出英文串 ────────────────
{
  const reg3 = { views: [], commands: [], settings: [] }
  const localeSubs = []
  let unsubbed = 0
  const enCtx = {
    registerView: (v) => reg3.views.push(v),
    registerCommand: (c) => reg3.commands.push(c),
    registerSetting: (s) => reg3.settings.push(s),
    registerStatusItem: () => ({ update() {}, dispose() {} }),
    notify() {}, openView() {},
    getLocale: () => 'en',
    subscribeLocale: (cb) => { localeSubs.push(cb); return () => { unsubbed++ } },
    app: { notify() {}, openFile() {}, workFolder: () => '稍后读', readFile: async (p) => (V.has(p) ? V.get(p) : null), writeFile: async (p, txt) => { V.set(p, String(txt)) } },
  }
  globalThis.__READFLOW_TEST__ = {}
  const disposeEn = new Function('ctx', src)(enCtx)
  const E = globalThis.__READFLOW_TEST__
  A.equal(localeSubs.length, 1, '必须订阅 ctx.subscribeLocale(不订阅=切语言时视图不会变)')

  // 注册面(单字符串,取注册当时的语言)
  A.equal(reg3.views.find((v) => v.id === 'library').title, 'Read Later', 'en 宿主下视图标题应为英文')
  A.ok(!/[一-鿿]/.test(reg3.commands.map((c) => c.title).join(' ')), 'en 宿主下命令标题应为英文')
  A.ok(!/[一-鿿]/.test(reg3.settings.map((s) => s.label + s.description).join(' ')), 'en 宿主下设置文案应为英文')

  // 渲染面(真构件走 DOM 垫片):空栏提示 / 队列失败行 / 列表卡片
  const tip = E.buildEmptyTip('inbox')
  A.ok(tip.textContent.includes('inbox') || tip.textContent.includes('Inbox'), tip.textContent)
  A.ok(!/[一-鿿]/.test(tip.textContent), `英文界面不许残留中文:${tip.textContent}`)
  const row = E.buildQueueRow({ id: 'x', url: 'https://e.example/a', title: 'e.example', status: 'failed', errType: 'interrupted', errKey: 'q_interrupted', errVars: null, error: '上次抓取被中断,点击重试' }, {})
  A.ok(row.textContent.includes('Retry'), row.textContent)
  A.ok(row.textContent.includes('interrupted'), '失败原因也要跟着语言走(存钥匙不存句子)')
  A.ok(!/[一-鿿]/.test(row.textContent), `队列行残留中文(八成是存了死句子):${row.textContent}`)
  const card = E.buildArticleCard({ path: 'p.md', title: 'A plain title', url: 'https://x.example/a', minutes: 3, saved: '2026-08-01T00:00:00.000Z', status: 'inbox' }, {})
  A.ok(card.textContent.includes('min read'), card.textContent)
  A.ok(!/[一-鿿]/.test(card.textContent), `卡片残留中文(日期没走 en-US?):${card.textContent}`)
  A.equal(E.statusLabel('archived'), 'Archived')
  A.ok(!/[一-鿿]/.test(E.buildEmptyTip('done').textContent + E.buildEmptyTip('archived').textContent + E.buildEmptyTip('reading').textContent))
  // 分类失败/中断恢复也应给英文(错误串是钥匙不是句子)
  A.ok(!/[一-鿿]/.test(E.classifyArticle(null).error))
  A.ok(!/[一-鿿]/.test(E.reviveQueue(JSON.stringify([{ id: 'z', url: 'https://r.example/p', status: 'pending' }]))[0].error))
  // 发给模型的指令仍是纯英文,但作答语言随界面语言显式指定
  A.ok(!/[一-鿿]/.test(E.summaryMessage('T', 'body')), 'en 侧摘要指令同样不许有中文')
  A.ok(E.summaryMessage('T', 'body').includes('Respond in English.'), 'en 界面应要模型用英文作答')
  A.ok(T.summaryMessage('T', 'body').includes('Respond in Chinese.'), 'zh 界面应要模型用中文作答')
  // 数据契约绝不随语言变:节头/工作文件夹/frontmatter 值仍是原样
  A.ok(E.appendHighlight('正文', 'quoted line', '').includes('## 划线'), '英文界面写回文件的节头必须仍是中文节头(磁盘契约)')
  A.equal(E.folderRoot(), '稍后读', '工作文件夹不随语言变')
  // 兜底标题(标题和域名都取不到时)同样是磁盘契约:文件名与 rf_title 不许随界面语言变
  const nd = await E.saveArticle({ url: 'https:///a', title: '' }, '字'.repeat(400))
  A.ok(nd.path.includes('未命名文章'), `en 界面下落盘文件名仍须用中文常量:${nd.path}`)
  A.equal(E.parseFrontmatter(V.get(nd.path)).fm.rf_title, '未命名文章', 'en 界面下 rf_title 仍是磁盘常量')

  disposeEn()
  A.equal(unsubbed, 1, 'disposer 必须退掉语言订阅')
}

// ── 双语③:zh → en → zh 往返回归(真机 e2e 只单向切,回不去的话中文用户没人替他看) ──────
{
  let loc = 'zh'
  const subs = [], sbUp = []
  const reg4 = { views: [], commands: [], settings: [] }
  const rtCtx = {
    registerView: (v) => reg4.views.push(v),
    registerCommand: (c) => reg4.commands.push(c),
    registerSetting: (s) => reg4.settings.push(s),
    registerStatusItem: () => ({ update: (p) => sbUp.push(p), dispose() {} }),
    notify() {}, openView() {},
    getLocale: () => loc,
    subscribeLocale: (cb) => { subs.push(cb); return () => {} },
    app: { notify() {}, openFile() {}, workFolder: () => '稍后读', readFile: async (p) => (V.has(p) ? V.get(p) : null), writeFile: async (p, txt) => { V.set(p, String(txt)) } },
  }
  globalThis.__READFLOW_TEST__ = {}
  const disposeRt = new Function('ctx', src)(rtCtx)
  const R = globalThis.__READFLOW_TEST__
  await new Promise((r) => setTimeout(r, 0)) // 让启动那趟 readIndex().then(refreshStatusItem) 落地
  A.ok(R.buildEmptyTip('inbox').textContent.includes('收件箱'), 'zh 起手应是中文')
  A.ok(sbUp.length && sbUp[sbUp.length - 1].text.includes('稍后读'), 'zh 起手状态栏应是中文')

  loc = 'en'; subs.forEach((f) => f())
  A.ok(!/[一-鿿]/.test(R.buildEmptyTip('inbox').textContent), '切到 en:构件不许残留中文')
  A.equal(R.statusLabel('reading'), 'Reading')
  const en = sbUp[sbUp.length - 1]
  A.ok(!/[一-鿿]/.test(en.text + en.title), `切到 en:状态栏不许残留中文:${JSON.stringify(en)}`)

  loc = 'zh'; subs.forEach((f) => f())
  A.ok(R.buildEmptyTip('inbox').textContent.includes('收件箱'), '切回 zh:空栏提示必须完整回归中文')
  A.equal(R.statusLabel('reading'), '在读', '切回 zh:状态标签必须回归')
  A.ok(R.buildArticleCard({ path: 'p.md', title: 'T', url: 'https://x.example/a', minutes: 3, saved: '2026-08-01T00:00:00.000Z', status: 'inbox' }, {}).textContent.includes('分钟'), '切回 zh:卡片估读时长必须回归中文')
  const zh = sbUp[sbUp.length - 1]
  A.ok(zh.text.includes('稍后读'), `切回 zh:状态栏必须回归中文:${JSON.stringify(zh)}`)
  disposeRt()
}

// ══════════════════════════════════════════════════════════════════════════
// [回归] 2026-08-21 生态级 P0-A:普通 .md 必须走 loadPage,不能走 openFile
//   真源 amadeusNav.ts:215-217 —— openFile 对 !matchFileType(path) 的裸 .md 回落到
//   amadeus.openVaultFile() = 交系统默认程序(TextEdit)。本插件 manifest 无 fileExtensions,
//   产物全是裸 .md → 一定不命中。实证探针:/tmp/fip0821-review/main-openfile/probe-openfile.cjs
// ══════════════════════════════════════════════════════════════════════════
{
  navLoaded.length = 0; navOpened.length = 0
  A.equal(T.openNotePath('稍后读/2026-08-21-某文.md'), 'loadPage', 'R1 打开笔记必须走 loadPage')
  A.deepEqual(navLoaded, ['稍后读/2026-08-21-某文.md'], 'R1 路径原样传给 loadPage')
  A.equal(navOpened.length, 0, 'R1 一次都没调 ctx.app.openFile(会被系统默认程序抢走)')

  const keep = ctx.app.loadPage
  delete ctx.app.loadPage // 旧宿主没有 loadPage
  navLoaded.length = 0; navOpened.length = 0
  A.equal(T.openNotePath('稍后读/旧宿主.md'), 'openFile', 'R2 旧宿主才退回 openFile')
  A.deepEqual(navOpened, ['稍后读/旧宿主.md'], 'R2 退回 openFile,不是干脆不打开')
  ctx.app.loadPage = keep
}

// ── 统一左栏列表源(1.2.0):注册 + 订阅即重读 + 状态分组 + 搜索 ────────────────────
// ⚠️ 「订阅即重读」是这条接缝的头号坑:插件在宿主**启动期**装载,那时活动库还没恢复,
//    ctx.app.readFile 静默给 null → idxCache 定格为空,此后无人再喊它一声(青鸟 2026-08-28 实报)。
{
  const LS = reg.listSources.find((x) => x.id === 'library-list')
  A.ok(LS, '应注册 library-list 列表源')
  for (const id of ['library', 'reader']) {
    A.equal(reg.views.find((v) => v.id === id).workspaceSource, 'library-list', `${id} 视图应声明 workspaceSource(裸源 id,宿主自己加 plugin: 前缀)`)
  }
  const idxKey = '稍后读/.readflow-index.json'
  V.set(idxKey, JSON.stringify({ items: [
    { path: '稍后读/a.md', url: 'https://a.example/x', title: '订阅后才读得到', status: 'inbox', saved: '2026-08-28T01:00:00.000Z', minutes: 5 },
    { path: '稍后读/b.md', url: 'https://b.example/y', title: '已读那篇', status: 'done', saved: '2026-08-27T01:00:00.000Z', minutes: 9 },
  ] }))
  A.ok(!LS.items({}).some((r) => r.key === '稍后读/a.md'), '前提:此刻列表源还没读过这份新索引')
  const off = LS.subscribe(() => {})
  await new Promise((r) => setTimeout(r, 10))
  const rows = LS.items({})
  A.equal(rows.length, 2, 'subscribe() 必须触发一次重读,否则启动期读空的列表永远回不来')
  A.equal(rows[0].hint, '2026-08-28', 'hint 取落库日期(语言中立,不进词表)')
  A.equal(rows[0].icon, 'link', '行首图标走宿主词表键')
  A.deepEqual(LS.items({ group: 'done' }).map((r) => r.key), ['稍后读/b.md'], '分组过滤按 status')
  A.deepEqual(LS.items({ query: '已读' }).map((r) => r.key), ['稍后读/b.md'], '搜索匹配标题')
  A.deepEqual(LS.items({ query: 'a.example' }).map((r) => r.key), ['稍后读/a.md'], '搜索也匹配 URL')
  A.deepEqual(LS.groups().map((g) => [g.key, g.count]), [['inbox', 1], ['done', 1]], '分组=非空状态档,按 STATUS_ORDER 排')
  A.equal(LS.groups()[0].title, '收件箱', '分组标签现取 t() → 跟着宿主语言走')
  A.ok(LS.itemMenu({ key: '稍后读/a.md' }).length >= 3, '右键菜单应给状态流转/打开笔记/移出')
  A.deepEqual(LS.itemMenu({ key: '不存在.md' }), [], '索引里没有的行不给菜单')
  opened.length = 0
  LS.open({ key: '稍后读/a.md' })
  A.deepEqual(opened, ['reader'], 'open() 应把条目交给 reader 视图')
  A.equal(typeof off, 'function', 'subscribe() 须返回退订函数')
  off()
}

console.log(`check ok — ${reg.views.length} views / ${reg.commands.length} cmds / ${reg.settings.length} settings / ${reg.status.length} statusItem;`
  + 'slug重名+frontmatter往返+划线两况+article块解析+失败三态+队列防重入/中断恢复+Clip导入去重+XSS+旧宿主'
  + '+路径快照绊线+节边界防越狱+索引串行化+guard接rejection+icon词表'
  + '+dispose队列真停+askStr外点settle+索引损坏保全+块标量续行+reader订阅index+统一左栏列表源'
  + `+双语(词表 ${MSG_KEYS} 键两侧相等 · en 宿主下构件渲染英文 · 调用点审计 · 引擎兜底错误走词表`
  + ' · 磁盘契约常量钉死 · zh→en→zh 往返回归) 全部断言通过')
