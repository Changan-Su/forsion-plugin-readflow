/**
 * 稍后读 ReadFlow —— Forsion 桌面插件(裸 setup(ctx) 体,宿主 new Function('ctx', code) 装载)。
 *
 * 定位:贴 URL → Tangu 抓正文存成库内**普通笔记**(不是自定义扩展,文章天生该是笔记)→
 *   干净阅读视图划线沉淀(写回原文件 ## 划线 节)→ AI 摘要/问答 → 收藏消化仪式。
 *   与 Forsion Clip 是上下游:Clip 管存进来,本插件管读掉它(导入=登记原文件,不搬家不复制)。
 *
 * 两个 LCL 视图(由 spaces/readflow/space.json 组合:library 侧栏 + reader 主区):
 *   plugin:readflow:library —— 待读队列:URL 入队 / 状态分栏 / 消化仪式(最老 3 篇未读置顶)。
 *   plugin:readflow:reader  —— 阅读器:限宽 68ch 排版 / 选中划线 / AI 摘要 / 问答 / 状态流转。
 *
 * 数据契约(SPEC 钉死):文章 = <workFolder>/<YYYYMMDD>-<slug>.md,frontmatter rf_url/rf_title/
 *   rf_saved/rf_status/rf_minutes;索引 = <workFolder>/.readflow-index.json {items:[{path,url,title,
 *   status,saved,minutes}]}。所有变更先改文件 frontmatter 再刷索引;渲染只从落盘文件读;
 *   抓取一次性落定此后绝不重抓(「重新抓取」=另存新文件)。
 *
 * 双语(1.1.0 起):UI 文案全走 MSG/t(),ctx.subscribeLocale 广播 → 视图**不重挂也重绘**。
 *   翻的只有界面文案;**用户数据一律不翻** —— 工作文件夹名、`## 划线` / `## AI 摘要` 节头、
 *   rf_* 字段值、文件名 slug、笔记正文,全部保持原样(它们是磁盘契约,跟着语言变=毁档)。
 *
 * 引擎接入(照 bluebird 正典):POST /agent/runs + SSE /events;抓取用 execMode:host(只许
 *   web_fetch 一个工具、只抓这一个 URL);摘要/问答是纯文本任务,不带 agent_config。
 * 安全:一切模型/文件产出走自建 renderMarkdown(只 createElement+textContent,绝不 innerHTML
 *   拼接不可信内容;本文件所有 innerHTML 均为编译期字面量且不含人话文本)。
 */
const PLUGIN_ID = 'readflow'
const APP_ID = 'tangu'
const DEFAULT_FOLDER = '稍后读' // ← 磁盘路径,**永不随语言变**(变了等于给英文用户换了数据目录)
/** 抓到的文章连标题带域名都取不到时的兜底标题。**故意不进 MSG**:它会落进 rf_title 与
 *  文件名 slug(磁盘契约),跟 DEFAULT_FOLDER / 节头同级——随界面语言变=同一条链接在中英
 *  两个界面下存出两个文件名。触发面很窄但可达:`https:///a` 过得了 qAdd 的 ^https?://\S+$,
 *  domainOf 却匹配不到 host 返回空串。 */
const UNTITLED_TITLE = '未命名文章'
const STATUS_ORDER = ['inbox', 'reading', 'done', 'archived']

// ── 双语词表:两侧键集合必须完全相等(check.mjs 断言它) ─────────────────────────
const MSG = {
  zh: {
    brand: '稍后读',
    view_library: '稍后读',
    view_reader: '阅读',
    cmd_open: '稍后读:打开',
    cmd_add: '稍后读:添加链接',
    cmd_import: '稍后读:导入 Forsion Clip 剪藏',
    set_font_label: '阅读字号(px)',
    set_font_desc: '阅读视图正文字号,阅读器里的 A−/A＋ 改的也是它',
    set_clip_label: 'Forsion Clip 剪藏文件夹',
    set_clip_desc: '「稍后读:导入 Forsion Clip 剪藏」扫描的库内文件夹(vault 相对路径)',
    st_inbox: '收件箱',
    st_reading: '在读',
    st_done: '读完',
    st_archived: '归档',
    sb_text: '稍后读',
    sb_text_n: '稍后读 {n} 在读',
    sb_title: '打开稍后读',
    sb_title_n: '{n} 篇在读 · 点击打开稍后读',
    op_failed: '操作失败:{msg}',
    no_files_api: '当前宿主版本过旧,不支持文件读写',
    login_first: '请先登录 Forsion',
    no_engine: '未连接到 Tangu 引擎',
    err_http_start: '起 run 失败 HTTP {code}',
    err_no_runid: '引擎未返回 runId',
    err_stream: '订阅事件失败 HTTP {code}',
    err_run_failed: '任务失败',
    err_dropped: '与引擎的连接中断,未收到完成事件(可重试)',
    idx_read_failed: '稍后读索引读取失败,本次操作已中止(列表未被改写):{msg}',
    idx_backup_failed: '稍后读索引损坏且备份失败,本次操作已中止:{msg}',
    idx_corrupt: '稍后读索引文件损坏,原件已备份为 .readflow-index.json.bak,列表已重置(文章 .md 文件都还在)',
    art_read_failed: '读取文章失败(条目保留在列表,可重试):{msg}',
    art_read_failed_status: '读取文章失败,状态未改(可重试):{msg}',
    q_label: '抓取队列',
    q_clear_done: '清除已完成',
    q_pending: '排队中',
    q_fetching: '抓取正文中…',
    q_saved: '已存入',
    q_failed: '失败',
    q_retry: '重试',
    q_cancel: '取消',
    q_open: '打开',
    q_remove: '移除',
    q_interrupted: '上次抓取被中断,点击重试',
    q_canceled: '已取消',
    q_disposed: '插件已停用,重新启用后可重试',
    q_fail_toast: '抓取失败({type}):{msg}',
    q_saved_toast: '已存入稍后读:{title}',
    e_raw: '{msg}',
    e_no_block: '模型未返回 article 数据块',
    e_paywall: '登录墙 / 付费墙,取不到正文',
    e_fetch: '抓取失败:{msg}',
    e_short: '正文过短({n} 字),疑似没抓到',
    add: '加入',
    url_ph: '粘贴文章链接,回车加入…',
    w_requeued: '已重新排队 ↓',
    w_queued: '已加入抓取队列 ↓',
    w_exists: '这条链接已在列表里(阅读器里可「重新抓取」)',
    w_in_queue: '这条链接已在队列中',
    w_busy: '这条链接正在抓取',
    w_bad_url: '需要一条 http(s):// 开头的链接',
    total: '共 {n} 篇',
    ritual_label: '消化仪式 · 最老的未读',
    ritual_read: '今天读它',
    ritual_archive: '归档它',
    empty_inbox: '收件箱是空的。粘贴一条文章链接「加入」,或跑「导入 Forsion Clip 剪藏」命令。',
    empty_reading: '还没有在读的文章。去收件箱挑一篇「开始读」。',
    empty_done: '还没有读完的文章。读完一篇,它就会出现在这里。',
    empty_archived: '归档是空的。读不动的文章大方归档,列表才轻。',
    empty_other: '空',
    card_untitled: '(无标题)',
    minutes: '约 {n} 分钟',
    saved_on: '存于 {d}',
    m_start: '开始读',
    m_done: '标为读完',
    m_archive: '归档',
    m_unarchive: '取消归档',
    m_open_note: '在笔记中打开',
    m_remove: '移出列表(不删文件)',
    no_open_note: '当前宿主不支持在笔记中打开',
    hero_title: '稍后读',
    hero_body: '把「回头再看」的文章收进库里读掉:抓正文、干净排版、划线沉淀、AI 摘要与问答。',
    hero_body2: '文章就是普通笔记,划线和摘要都写回原文件。',
    hero_btn: '打开稍后读列表',
    font_smaller: '调小字号',
    font_bigger: '调大字号',
    act_start: '开始读',
    act_done: '读完',
    act_back_reading: '标回在读',
    act_unarchive: '取消归档',
    btn_archive: '归档',
    btn_refetch: '重新抓取',
    btn_refetch_tip: '重新抓取并另存为新文件,不覆盖本篇',
    btn_open_note: '在笔记中打开',
    btn_panel: '面板',
    btn_panel_tip: '收起 / 展开右侧面板',
    body_empty: '(正文为空)',
    sum_label: 'AI 摘要',
    sum_gen: '生成',
    sum_regen: '重新生成',
    sum_empty: '还没有摘要。点「生成」,结果会写进本篇笔记的摘要节。',
    sum_running: '生成中…',
    sum_saved: '摘要已写进本篇笔记的摘要节',
    sum_fail_inline: '生成失败:{msg}',
    sum_fail_toast: '摘要生成失败',
    file_gone: '原文件不见了',
    hl_label: '划线',
    hl_btn: '划线',
    hl_count: '{n} 条',
    hl_empty: '还没有划线。',
    hl_hint: '在正文里选中一段文字,点浮出的「划线」即可沉淀到本篇笔记。',
    hl_note_prompt: '批注(留空=只划线;取消=不划线)',
    hl_file_gone: '原文件不见了,划线没存上',
    hl_saved: '已划线,写进了本篇笔记',
    qa_label: '问答',
    qa_ph: '就这篇文章提问…',
    qa_send: '问',
    qa_thinking: '…',
    qa_no_answer: '(无回答)',
    qa_failed: '失败:{msg}',
    art_gone: '这篇文章的文件不见了,已从列表移除',
    done_toast: '读完啦:{title}',
    archived_toast: '已归档',
    refetch_no_url: '这篇没有源链接,无法重新抓取',
    refetch_queued: '已重新入队,抓好后会另存为新文件(不覆盖本篇)',
    refetch_failed: '入队失败',
    imp_busy: '已在导入中,请稍候…',
    imp_scanning: '正在扫描「{folder}」…',
    imp_none: '「{folder}」里没有可导入的 .md 文件',
    imp_done: '导入完成:新增 {added} 篇,跳过 {skipped} 篇(已在列表),缺失 {missing} 篇',
    imp_failed: '导入失败:{msg}',
    no_workbench: '当前宿主版本过旧,不支持工作台视图',
    add_prompt: '粘贴文章链接(https://…)',
    add_requeued: '已重新排队抓取',
    add_queued: '已加入抓取队列',
    add_exists: '这条链接已在稍后读列表里',
    dlg_ok: '确定',
    dlg_cancel: '取消',
  },
  en: {
    brand: 'Read Later',
    view_library: 'Read Later',
    view_reader: 'Reader',
    // 前缀取品牌名(与中文侧「稍后读:」同构),不用仓库名 ReadFlow;搜 readflow 仍能命中 keywords
    cmd_open: 'Read Later: Open',
    cmd_add: 'Read Later: Add Link',
    cmd_import: 'Read Later: Import Forsion Clip Saves',
    set_font_label: 'Reading font size (px)',
    set_font_desc: 'Body size in the reader — the A−/A＋ buttons change this same value',
    set_clip_label: 'Forsion Clip folder',
    set_clip_desc: 'Vault-relative folder scanned by the "Import Forsion Clip Saves" command',
    st_inbox: 'Inbox',
    st_reading: 'Reading',
    st_done: 'Done',
    st_archived: 'Archived',
    sb_text: 'Read Later',
    sb_text_n: 'Read Later · {n} reading',
    sb_title: 'Open Read Later',
    sb_title_n: '{n} in progress · click to open Read Later',
    op_failed: 'Something went wrong: {msg}',
    no_files_api: 'This host is too old — file access is unavailable',
    login_first: 'Sign in to Forsion first',
    no_engine: 'Not connected to the Tangu engine',
    err_http_start: 'Could not start the run — HTTP {code}',
    err_no_runid: 'The engine returned no runId',
    err_stream: 'Could not subscribe to the event stream — HTTP {code}',
    err_run_failed: 'The run failed',
    err_dropped: 'Lost the connection to the engine before the run finished — you can retry',
    idx_read_failed: 'Could not read the Read Later index. This action was aborted and your list is untouched: {msg}',
    idx_backup_failed: 'The Read Later index is damaged and the backup failed. This action was aborted: {msg}',
    idx_corrupt: 'The Read Later index was damaged. The original is backed up as .readflow-index.json.bak and the list has been reset — every article .md file is still there.',
    art_read_failed: 'Could not read that article. The entry stays in your list, try again: {msg}',
    art_read_failed_status: 'Could not read that article, status unchanged. Try again: {msg}',
    q_label: 'Fetch queue',
    q_clear_done: 'Clear finished',
    q_pending: 'Queued',
    q_fetching: 'Fetching article…',
    q_saved: 'Saved',
    q_failed: 'Failed',
    q_retry: 'Retry',
    q_cancel: 'Cancel',
    q_open: 'Open',
    q_remove: 'Remove',
    q_interrupted: 'The last fetch was interrupted — click to retry',
    q_canceled: 'Canceled',
    q_disposed: 'The plugin was disabled — re-enable it and retry',
    q_fail_toast: 'Fetch failed ({type}): {msg}',
    q_saved_toast: 'Saved to Read Later: {title}',
    e_raw: '{msg}',
    e_no_block: 'The model returned no article block',
    e_paywall: 'Login wall or paywall — the article body is out of reach',
    e_fetch: 'Fetch failed: {msg}',
    e_short: 'Body too short ({n} characters) — probably not the real article',
    add: 'Add',
    url_ph: 'Paste an article link, press Enter…',
    w_requeued: 'Back in the queue ↓',
    w_queued: 'Added to the fetch queue ↓',
    w_exists: 'Already in your list — use Re-fetch in the reader',
    w_in_queue: 'That link is already queued',
    w_busy: 'That link is being fetched',
    w_bad_url: 'Needs a link starting with http(s)://',
    total: '{n} saved',
    ritual_label: 'Digest · oldest unread',
    ritual_read: 'Read today',
    ritual_archive: 'Archive',
    empty_inbox: 'Your inbox is empty. Paste an article link and hit Add, or run the Import Forsion Clip Saves command.',
    empty_reading: 'Nothing in progress. Pick one from the inbox and start reading.',
    empty_done: 'Nothing finished yet. Articles land here once you mark them done.',
    empty_archived: 'Archive is empty. Archive what you will never get to — a short list is a list you read.',
    empty_other: 'Empty',
    card_untitled: '(untitled)',
    minutes: '{n} min read',
    saved_on: 'Saved {d}',
    m_start: 'Start reading',
    m_done: 'Mark as done',
    m_archive: 'Archive',
    m_unarchive: 'Unarchive',
    m_open_note: 'Open in notes',
    m_remove: 'Remove from list (keeps the file)',
    no_open_note: 'This host cannot open the note directly',
    hero_title: 'Read Later',
    hero_body: 'Turn "I will get to it later" into something you actually finish: fetched body text, clean typography, highlights, AI summary and Q&A.',
    hero_body2: 'Every article is a plain note — highlights and summaries are written back into it.',
    hero_btn: 'Open the reading list',
    font_smaller: 'Smaller text',
    font_bigger: 'Larger text',
    act_start: 'Start reading',
    act_done: 'Done',
    act_back_reading: 'Back to reading',
    act_unarchive: 'Unarchive',
    btn_archive: 'Archive',
    btn_refetch: 'Re-fetch',
    btn_refetch_tip: 'Fetch again and save as a new file — this one is left untouched',
    btn_open_note: 'Open in notes',
    btn_panel: 'Panel',
    btn_panel_tip: 'Show or hide the side panel',
    body_empty: '(empty body)',
    sum_label: 'AI Summary',
    sum_gen: 'Generate',
    sum_regen: 'Regenerate',
    sum_empty: 'No summary yet. Hit Generate — the result is written back into this note.',
    sum_running: 'Generating…',
    sum_saved: 'Summary written back into this note',
    sum_fail_inline: 'Could not generate: {msg}',
    sum_fail_toast: 'Could not generate the summary',
    file_gone: 'The source file is gone',
    hl_label: 'Highlights',
    hl_btn: 'Highlight',
    hl_count: '{n}',
    hl_empty: 'No highlights yet.',
    hl_hint: 'Select any passage in the body, then click Highlight to keep it in this note.',
    hl_note_prompt: 'Note (leave blank to just highlight; cancel to skip)',
    hl_file_gone: 'The source file is gone — that highlight was not saved',
    hl_saved: 'Highlighted, saved into this note',
    qa_label: 'Q&A',
    qa_ph: 'Ask about this article…',
    qa_send: 'Ask',
    qa_thinking: '…',
    qa_no_answer: '(no answer)',
    qa_failed: 'Failed: {msg}',
    art_gone: 'That article file is gone — removed from your list',
    done_toast: 'Finished: {title}',
    archived_toast: 'Archived',
    refetch_no_url: 'No source link on this one — nothing to re-fetch',
    refetch_queued: 'Back in the queue — the result is saved as a new file, this one stays as is',
    refetch_failed: 'Could not queue it',
    imp_busy: 'An import is already running, hold on…',
    imp_scanning: 'Scanning "{folder}"…',
    imp_none: 'No .md files to import in "{folder}"',
    imp_done: 'Import finished — {added} added, {skipped} skipped (already listed), {missing} missing',
    imp_failed: 'Import failed: {msg}',
    no_workbench: 'This host is too old — workbench views are unavailable',
    add_prompt: 'Paste an article link (https://…)',
    add_requeued: 'Back in the fetch queue',
    add_queued: 'Added to the fetch queue',
    add_exists: 'That link is already in your Read Later list',
    dlg_ok: 'OK',
    dlg_cancel: 'Cancel',
  },
}
/** 语言:旧宿主没有 getLocale → 回退中文(canonical)。同步 getter,只认 zh/en。 */
const L = () => { try { return ctx.getLocale && ctx.getLocale() === 'en' ? 'en' : 'zh' } catch { return 'zh' } }
/** 取串;缺键回落中文侧再回落键名(永不渲染 undefined)。占位符 {name},别用模板串拼。 */
const t = (k, vars) => {
  const d = MSG[L()] || MSG.zh
  let s = d[k] != null ? d[k] : (MSG.zh[k] != null ? MSG.zh[k] : k)
  if (vars) for (const [n, v] of Object.entries(vars)) s = s.split('{' + n + '}').join(String(v))
  return s
}
const isStatus = (s) => STATUS_ORDER.includes(s)
const statusLabel = (s) => (isStatus(s) ? t('st_' + s) : String(s == null ? '' : s))

ctx.registerSetting({ key: 'fontSize', label: t('set_font_label'), type: 'number', default: 16, min: 12, max: 28, description: t('set_font_desc') })
ctx.registerSetting({ key: 'clipFolder', label: t('set_clip_label'), type: 'text', default: 'Forsion Clip', description: t('set_clip_desc') })

// ── 小工具 ──────────────────────────────────────────────────────────────────
const getSetting = (k, d) => { try { const v = localStorage.getItem(`plugin.${PLUGIN_ID}.${k}`); return v == null || v === '' ? d : v } catch { return d } }
const setSetting = (k, v) => { try { localStorage.setItem(`plugin.${PLUGIN_ID}.${k}`, String(v)) } catch { /* ignore */ } }
const uuid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)
const say = (m, o) => (ctx.notify ? ctx.notify(m, o) : ctx.app.notify(m))
const canFiles = () => !!(ctx.app && ctx.app.readFile && ctx.app.writeFile)
/** 裸 async 点击回调统一接住 rejection:写盘失败(锁盘/权限)必须有用户反馈,不许静默没反应。 */
const guard = (fn) => (...a) => Promise.resolve().then(() => fn(...a)).catch((e) => say(t('op_failed', { msg: (e && e.message) || String(e) }), { level: 'error' }))

/** 打开一篇**普通 .md 笔记**:必须走 loadPage,不能走 openFile。
 *  ⚠️ 宿主的 openFile 对「没有插件文件类型认领的」裸 .md 会回落到 amadeus.openVaultFile()
 *     = 交给系统默认程序 —— 用户点「打开笔记」会在 TextEdit 里弹出来,而不是进 Amadeus。
 *     真源:desktop/frontend/src/amadeusNav.ts:215-217 `if (!matchFileType(path)) openVaultFile(path)`。
 *     本插件 manifest 没有 fileExtensions,产物全是裸 .md → matchFileType 一定不命中。
 *  ⚠️ 这里的路径都来自索引里**已经落过盘**的文章笔记;loadPage 对不存在的路径会凭空造出一篇空白页,
 *     所以只允许对「已确认存在 / 刚写盘成功」的路径调。
 *  旧宿主没有 loadPage 时才退回 openFile(那种宿主上没有更好的路)。 */
function openNotePath(p) {
  try {
    if (ctx.app && typeof ctx.app.loadPage === 'function') { ctx.app.loadPage(p); return 'loadPage' }
    if (ctx.app && typeof ctx.app.openFile === 'function') { ctx.app.openFile(p); return 'openFile' }
  } catch { /* 打开失败不影响已经落盘的产物 */ }
  say(t('no_open_note'), { level: 'warning' })
  return null
}

function safeHref(u) {
  const s = String(u == null ? '' : u).trim()
  return /^(https?:\/\/|#|mailto:)/i.test(s) ? s : ''
}
const charCount = (s) => String(s == null ? '' : s).replace(/\s+/g, '').length

/** slug 规则(SPEC 钉死):标题取前 24 字符,非 [\p{L}\p{N}] 折叠成 -;空则 article。
 *  **不随语言变**:slug 进文件名,是磁盘契约。 */
function slugify(title) {
  const s0 = String(title == null ? '' : title).trim().slice(0, 24)
  const s = s0.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
  return s || 'article'
}
function domainOf(url) {
  const m = String(url == null ? '' : url).match(/^https?:\/\/([^/:?#]+)/i)
  return m ? m[1].replace(/^www\./i, '') : ''
}
/** 「现在」一律 Date.now(),本地日期由它推导(check 冻钟靠覆写它)。 */
function ymd() {
  const d = new Date(Date.now())
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}
/** 展示用日期:随语言走系统格式(别手拼「X月Y日」,英文语序不同)。 */
function fmtDay(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date(Date.now())
  const opt = d.getFullYear() === now.getFullYear() ? { month: 'long', day: 'numeric' } : { year: 'numeric', month: 'long', day: 'numeric' }
  try { return d.toLocaleDateString(L() === 'zh' ? 'zh-CN' : 'en-US', opt) } catch { return d.toISOString().slice(0, 10) }
}
/** 估读分钟 = 字数/400(SPEC 契约,本地算了才作数);正文太短没得算才用模型给的 hint 兜底。 */
function estimateMinutes(body, hint) {
  const n = Math.round(charCount(body) / 400)
  if (n >= 1) return n
  const h = Number(hint)
  return Number.isFinite(h) && h >= 1 ? Math.round(h) : 1
}

// ── frontmatter / 节(纯函数,check 全覆盖) ────────────────────────────────
function parseFrontmatter(text) {
  const s = String(text == null ? '' : text)
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(s)
  if (!m) return { fm: {}, body: s }
  const fm = {}
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) { const k = line.slice(0, i).trim(); if (k) fm[k] = line.slice(i + 1).trim() }
  }
  return { fm, body: s.slice(m[0].length) }
}
function buildArticleText(fm, body) {
  const lines = ['---']
  for (const k of Object.keys(fm)) lines.push(`${k}: ${String(fm[k] == null ? '' : fm[k]).replace(/\s*\n\s*/g, ' ')}`)
  lines.push('---')
  return lines.join('\n') + '\n\n' + String(body == null ? '' : body).replace(/^\s+/, '').replace(/\s+$/, '') + '\n'
}
/** 改一个 frontmatter 字段 = 文本级手术:只定位/替换/追加目标键那一行,其余行(YAML 列表项、
 *  `|` 多行块续行、注释)逐字节保留——绝不 parse→rebuild 全量重写,否则 Forsion Clip 原件 /
 *  用户手写的复杂 frontmatter 会在一次状态流转里被有损毁掉。
 *  没有 frontmatter 的文件(Clip 原件)就地补一个,正文原样。块判定正则与 parseFrontmatter 同一份。 */
function setFmField(text, key, value) {
  const s = String(text == null ? '' : text)
  const k = String(key)
  const vline = `${k}: ${String(value == null ? '' : value).replace(/\s*\n\s*/g, ' ')}`
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(s)
  if (!m) return `---\n${vline}\n---\n\n${s.replace(/^\s+/, '')}`
  const eol = m[0].includes('\r\n') ? '\r\n' : '\n'
  const lines = m[1] === '' ? [] : m[1].split(/\r?\n/)
  const re = new RegExp('^' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:')
  const at = lines.findIndex((l) => re.test(l))
  if (at === -1) lines.push(vline)
  else {
    // 目标键自身是块标量(如 rf_status: |)时,续行(更深缩进/空行)一并吃掉——只换键行会把
    // 续行孤立成非法 YAML。这个吃法只在键匹配 ^ 顶格锚定下才安全(续行必带缩进,顶格即下一键);
    // 若未来放宽 re 支持缩进键,这里必须一起改。
    let end = at + 1
    if (/:\s*[|>][0-9+-]*\s*(#.*)?$/.test(lines[at])) while (end < lines.length && (!lines[end].trim() || /^\s/.test(lines[end]))) end++
    lines.splice(at, end - at, vline)
  }
  return `---${eol}${lines.join(eol)}${eol}---${eol}` + s.slice(m[0].length)
}
function sectionRange(lines, heading) {
  const start = lines.findIndex((l) => l.trim() === heading)
  if (start === -1) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) if (/^##\s/.test(lines[i])) { end = i; break }
  return { start, end }
}
/** ⚠️ 节头是**磁盘契约不是 UI 文案**:英文界面下写进文件的仍是这两个中文节头。
 *  跟着语言变 = 同一篇笔记两套节头,旧划线/摘要读不回来(毁档)。永不翻译。 */
const RESERVED_HEADINGS = ['## 划线', '## AI 摘要']
const H_HIGHLIGHT = '## 划线'
const H_SUMMARY = '## AI 摘要'
/** 模型产出写进节之前:所有 H2(^##␣)整体降一级——sectionRange 按 ^##␣ 定节尾,模型摘要
 *  自带 ## 标题会把 ## AI 摘要 节拦腰截断(后半截漏进阅读区、重生成时内容重复)。 */
function demoteH2(text) {
  return String(text == null ? '' : text).split('\n').map((l) => (/^\s*##\s/.test(l) ? l.replace('##', '###') : l)).join('\n')
}
/** 抓取正文防哨兵撞名:对抗性网页可故意注入字面 ## 划线 / ## AI 摘要 行,落盘前只把与保留
 *  节头完全同名的行降一级(全量降级会毁掉真实文章里的正常 H2)。 */
function neutralizeReservedHeadings(body) {
  return String(body == null ? '' : body).split('\n').map((l) => (RESERVED_HEADINGS.includes(l.trim()) ? l.replace('##', '###') : l)).join('\n')
}
/** 划线追加:有 ## 划线 节就插到节尾(后续节之前),没有就在文末新建。引文逐行 >,批注一行 > —。 */
function appendHighlight(text, quote, note) {
  const qLines = String(quote == null ? '' : quote).split('\n').map((l) => l.trim()).filter(Boolean)
  if (!qLines.length) return String(text == null ? '' : text)
  let entry = qLines.map((l) => '> ' + l).join('\n')
  const n = String(note == null ? '' : note).trim()
  if (n) entry += '\n> — ' + n
  const s = String(text == null ? '' : text).replace(/\s+$/, '')
  const lines = s.split('\n')
  const r = sectionRange(lines, H_HIGHLIGHT)
  if (!r) return s + '\n\n' + H_HIGHLIGHT + '\n\n' + entry + '\n'
  let e = r.end
  while (e > r.start + 1 && !lines[e - 1].trim()) e--
  const before = lines.slice(0, e).join('\n').replace(/\s+$/, '')
  const after = lines.slice(r.end).join('\n').replace(/^\s+/, '')
  return before + '\n\n' + entry + (after ? '\n\n' + after : '') + '\n'
}
/** 整节替换/新建(## AI 摘要 用):节内容整体重写,其余内容原样。 */
function upsertSection(text, heading, content) {
  const s = String(text == null ? '' : text).replace(/\s+$/, '')
  const block = heading + '\n\n' + String(content == null ? '' : content).trim()
  const lines = s.split('\n')
  const r = sectionRange(lines, heading)
  if (!r) return (s ? s + '\n\n' : '') + block + '\n'
  const before = lines.slice(0, r.start).join('\n').replace(/\s+$/, '')
  const after = lines.slice(r.end).join('\n').replace(/^\s+/, '')
  return (before ? before + '\n\n' : '') + block + (after ? '\n\n' + after : '') + '\n'
}
function getSection(text, heading) {
  const lines = String(text == null ? '' : text).split('\n')
  const r = sectionRange(lines, heading)
  if (!r) return null
  return lines.slice(r.start + 1, r.end).join('\n').trim()
}
function stripSections(text, headings) {
  let lines = String(text == null ? '' : text).split('\n')
  for (const h of headings) {
    const r = sectionRange(lines, h)
    if (r) lines = lines.slice(0, r.start).concat(lines.slice(r.end))
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
/** ## 划线 节 → [{quote, note}](右侧面板展示用)。 */
function parseHighlights(sec) {
  if (!sec) return []
  const out = []
  for (const block of String(sec).split(/\n\s*\n/)) {
    const quote = [], notes = []
    for (const line of block.split('\n')) {
      const s = line.trim()
      if (/^>\s*—/.test(s)) notes.push(s.replace(/^>\s*—\s*/, ''))
      else if (/^>/.test(s)) { const q = s.replace(/^>\s?/, ''); if (q) quote.push(q) }
    }
    if (quote.length) out.push({ quote: quote.join('\n'), note: notes.join(' ') })
  }
  return out
}

// ── ```article 块解析 + 失败分类(fetch_error / paywall / too_short) ─────────
/** 从模型产出里抠 article 代码块(容忍前后废话与 fence tag 变体);首行 JSON 元数据,空行后正文。
 *  收尾取**最后一个** ``` 行:文章正文自己常含代码块,非贪婪取首个 ``` 会把正文拦腰截断。 */
function parseArticleBlock(raw) {
  const s = String(raw == null ? '' : raw)
  const open = /```[^\n]*\barticle\b[^\n]*\n/i.exec(s)
  if (!open) return null
  const rest = s.slice(open.index + open[0].length)
  const closeIdx = rest.lastIndexOf('\n```')
  const inner = (closeIdx === -1 ? rest : rest.slice(0, closeIdx + 1)).replace(/^\s*\n/, '')
  const nl = inner.indexOf('\n')
  const first = (nl === -1 ? inner : inner.slice(0, nl)).trim()
  let meta = null
  try { meta = JSON.parse(first) } catch { meta = null }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
  const body = nl === -1 ? '' : inner.slice(nl + 1).trim()
  return { meta, body }
}
/** 失败类型如实记录,不假装成功(SPEC:fetch_error / paywall / too_short)。
 *  给 **errKey + errVars**(不是定死的句子):队列行渲染时才取串,用户切语言后错误行也跟着变。
 *  `error` 是同一把钥匙在当下语言的解,留给日志/持久化读。 */
function classifyArticle(parsed) {
  const fail = (errType, errKey, errVars) => ({ errType, errKey, errVars: errVars || null, error: t(errKey, errVars) })
  if (!parsed) return fail('fetch_error', 'e_no_block')
  if (parsed.meta.error === 'paywall') return fail('paywall', 'e_paywall')
  if (parsed.meta.error) return fail('fetch_error', 'e_fetch', { msg: parsed.meta.error })
  const n = charCount(parsed.body)
  if (n < 200) return fail('too_short', 'e_short', { n })
  return { ok: true, meta: parsed.meta, body: parsed.body }
}

// ── 注入模型的指令(一律英文;死限工具与范围) ────────────────────────────────
/** 要模型用哪种语言作答,按界面语言显式写死一句(指令段本身永远英文)。 */
const replyLang = () => (L() === 'zh' ? 'Respond in Chinese.' : 'Respond in English.')
function fetchMessage(url) {
  return `Fetch one web article and return it as clean markdown.
URL: ${url}

Hard rules:
- Use ONLY the web_fetch tool, on exactly this one URL. Do not fetch any other URL, do not search, do not run any other tool, do not write any file.
- Do not add any commentary outside the fenced block.

Return EXACTLY one fenced code block tagged "article", shaped like this:
\`\`\`article
{"title":"...","author":"...","published":"...","minutes":0}

<the clean article body as markdown - main content only; no site navigation, ads, comments, related-article links, cookie banners, or your own remarks>
\`\`\`

The first line inside the fence must be one single-line JSON object; "minutes" is your integer reading-time estimate; then one blank line; then the body.
If fetching fails or the page is unreachable, return the block with first line {"error":"fetch_error"} and no body.
If the content is behind a login wall or paywall, return the block with first line {"error":"paywall"} and no body.`
}
function clipListMessage(folder) {
  return `List the markdown files in one folder of the current workspace.
Folder: "${folder}"

Hard rules:
- This is a READ-ONLY listing task. Run a single \`ls\` on that folder only. Do not read file contents, do not write or modify anything, do not touch any other path.
- Do not add any commentary outside the fenced block.

Return EXACTLY one fenced code block tagged "files" with one .md filename per line (bare filenames, no directory prefix). If the folder is missing or empty, return an empty "files" block.`
}
function summaryMessage(title, body) {
  return `Summarize the following article for a read-it-later app user.
${replyLang()} Output plain markdown only (no code fences, no preamble): first 3-6 bullet points with the key takeaways, then one short paragraph of overall assessment.

ARTICLE TITLE: ${title}
ARTICLE BODY:
${String(body == null ? '' : body).slice(0, 16000)}`
}
function qaMessage(title, body, question, seeded) {
  if (seeded) return question
  return `You are answering questions about ONE article in a read-it-later app. Base every answer strictly on the article below; if the article does not contain the answer, say so. ${replyLang()} Keep it concise markdown.

ARTICLE TITLE: ${title}
ARTICLE BODY:
${String(body == null ? '' : body).slice(0, 16000)}

QUESTION: ${question}`
}

// ── Markdown → 安全 DOM(只 createElement+textContent;图片仅放行 https) ────
function inline(text) {
  const frag = document.createDocumentFragment()
  let rest = String(text == null ? '' : text)
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*\n]+)\*|_([^_\n]+)_/
  let m
  while ((m = re.exec(rest))) {
    if (m.index > 0) frag.appendChild(document.createTextNode(rest.slice(0, m.index)))
    if (m[1] != null) { const b = document.createElement('strong'); b.textContent = m[1]; frag.appendChild(b) }
    else if (m[2] != null) { const c = document.createElement('code'); c.textContent = m[2]; frag.appendChild(c) }
    else if (m[3] != null) {
      const a = document.createElement('a'); a.textContent = m[3]
      const href = safeHref(m[4]); if (href) { a.setAttribute('href', href); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer') }
      frag.appendChild(a)
    } else if (m[5] != null) { const e = document.createElement('em'); e.textContent = m[5]; frag.appendChild(e) }
    else if (m[6] != null) { const e = document.createElement('em'); e.textContent = m[6]; frag.appendChild(e) }
    rest = rest.slice(m.index + m[0].length)
  }
  if (rest) frag.appendChild(document.createTextNode(rest))
  return frag
}
function renderMarkdown(container, md) {
  container.textContent = ''
  const lines = String(md == null ? '' : md).replace(/\r\n/g, '\n').split('\n')
  let i = 0, para = [], list = null, listTag = null
  const flushPara = () => { if (para.length) { const p = document.createElement('p'); p.appendChild(inline(para.join(' '))); container.appendChild(p); para = [] } }
  const flushList = () => { if (list) { container.appendChild(list); list = null; listTag = null } }
  while (i < lines.length) {
    const ln = lines[i].replace(/\s+$/, '').trim()
    if (/^```/.test(ln)) {
      flushPara(); flushList()
      const buf = []; i++
      while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++ }
      i++
      const pre = document.createElement('pre'); const code = document.createElement('code'); code.textContent = buf.join('\n'); pre.appendChild(code); container.appendChild(pre); continue
    }
    if (ln === '') { flushPara(); flushList(); i++; continue }
    const h = /^(#{1,6})\s+(.*)$/.exec(ln)
    if (h) { flushPara(); flushList(); const el = document.createElement('h' + Math.min(4, h[1].length)); el.appendChild(inline(h[2])); container.appendChild(el); i++; continue }
    const im = /^!\[([^\]]*)\]\((\S+)\)$/.exec(ln)
    if (im) {
      flushPara(); flushList()
      if (/^https:\/\//i.test(im[2])) { const img = document.createElement('img'); img.setAttribute('alt', im[1]); img.setAttribute('src', im[2]); img.setAttribute('loading', 'lazy'); container.appendChild(img) }
      else { const p = document.createElement('p'); p.textContent = ln; container.appendChild(p) }
      i++; continue
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(ln)) { flushPara(); flushList(); container.appendChild(document.createElement('hr')); i++; continue }
    if (/^>\s?/.test(ln)) { flushPara(); flushList(); const bq = document.createElement('blockquote'); bq.appendChild(inline(ln.replace(/^>\s?/, ''))); container.appendChild(bq); i++; continue }
    const ul = /^[-*]\s+(.*)$/.exec(ln), ol = /^\d+\.\s+(.*)$/.exec(ln)
    if (ul || ol) {
      flushPara()
      const want = ul ? 'ul' : 'ol'
      if (list && listTag !== want) flushList()
      if (!list) { list = document.createElement(want); listTag = want }
      const li = document.createElement('li'); li.appendChild(inline(ul ? ul[1] : ol[1])); list.appendChild(li); i++; continue
    }
    flushList(); para.push(ln); i++
  }
  flushPara(); flushList()
}

// ── 引擎配置 + 驱动 run(照 bluebird;抓取/扫目录才 host,纯文本任务不带 agent_config) ──
async function getCfg() {
  try {
    const c = await (globalThis.window && window.tangu && window.tangu.getConfig ? window.tangu.getConfig() : null)
    if (c && c.backendUrl) return { backendUrl: c.backendUrl, token: c.token || '', modelId: c.modelId || '', cwd: c.defaultWorkspaceDir || c.homeDir || '' }
  } catch { /* web 回退 */ }
  try { return { backendUrl: location.origin + '/api', token: localStorage.getItem('forsion_token') || '', modelId: '', cwd: '' } } catch { /* ignore */ }
  return { backendUrl: '', token: '', modelId: '', cwd: '' }
}
async function runAgent(cfg, sessionId, message, onTick, signal, opts) {
  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` }
  const payload = { session_id: sessionId, model_id: cfg.modelId || undefined, app_id: APP_ID, message, attachments: [] }
  if (opts && opts.host) payload.agent_config = { execMode: 'host', cwd: cfg.cwd || undefined }
  const start = await fetch(`${cfg.backendUrl}/agent/runs`, { method: 'POST', headers: h, signal, body: JSON.stringify(payload) })
  // ⚠️ 这几句兜底会经 e_raw/{msg} 一路流回队列失败行与 toast,是**用户看得见的人话**,必须走 t()。
  //    引擎原文(start.text() / ev.payload.error)是透传报文,两种语言下都不翻。
  if (!start.ok) throw new Error((await start.text().catch(() => '')) || t('err_http_start', { code: start.status }))
  const { runId } = await start.json()
  if (!runId) throw new Error(t('err_no_runid'))
  const res = await fetch(`${cfg.backendUrl}/agent/runs/${encodeURIComponent(runId)}/events?fromSeq=0`, { headers: h, signal })
  if (!res.ok || !res.body) throw new Error(t('err_stream', { code: res.status }))
  const reader = res.body.getReader(), dec = new TextDecoder()
  let buf = '', lastSeq = 0, content = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const parts = buf.split('\n'); buf = parts.pop() || ''
    for (const line of parts) {
      const s = line.trim()
      if (!s || s.startsWith(':') || !s.startsWith('data:')) continue
      const data = s.slice(5).replace(/^ /, ''); if (!data) continue
      let ev; try { ev = JSON.parse(data) } catch { continue }
      if (typeof ev.seq === 'number') { if (ev.seq <= lastSeq) continue; lastSeq = ev.seq }
      if (ev.type === 'token') { const d = ev.payload && ev.payload.delta; if (d) { content += d; if (onTick) onTick(content) } continue }
      if (ev.type === 'done') return (ev.payload && ev.payload.content) || content
      if (ev.type === 'error') throw new Error((ev.payload && ev.payload.error) || t('err_run_failed'))
    }
  }
  throw new Error(t('err_dropped'))
}

// ── 跨视图小总线 ─────────────────────────────────────────────────────────────
const bus = (() => { const subs = new Set(); return { on: (f) => (subs.add(f), () => subs.delete(f)), emit: (e) => subs.forEach((f) => { try { f(e) } catch { /* ignore */ } }) } })()
let pendingOpen = null // library 点行后暂存,reader mount 时消费

// ── 索引层:所有变更先改文件 frontmatter 再刷索引;渲染只从落盘文件读 ────────────
const folderRoot = () => (ctx.app.workFolder ? ctx.app.workFolder() : DEFAULT_FOLDER)
const indexPath = () => `${folderRoot()}/.readflow-index.json`
let idxCache = { items: [] }
let sbHandle = null
/** 状态栏是宿主面里**唯一**能运行时改文案的一处(handle.update),所以语言一变它就该跟上。 */
function refreshStatusItem() {
  const n = idxCache.items.filter((i) => i.status === 'reading').length
  if (sbHandle && sbHandle.update) sbHandle.update({ text: n ? t('sb_text_n', { n }) : t('sb_text'), title: n ? t('sb_title_n', { n }) : t('sb_title') })
}
/** 索引 read-modify-write 一律经此串行(promise 链):抓取落盘撞上用户点状态流转时,
 *  两个 readIndex→writeIndex 并发会后写者赢,静默丢行/状态回跳。链尾吞错,一次失败不卡死后续。 */
let idxChain = Promise.resolve()
function serialIndex(fn) {
  const run = idxChain.then(fn)
  idxChain = run.then(() => undefined, () => undefined)
  return run
}
let idxCorruptWarned = false
/** 索引读取三分法(数据保全):①文件不存在(null)=真空库;②读失败(readFile 抛)=抛错,让本次
 *  操作拒绝后续写入——瞬时 IO 错误若按空库处理,随后的 writeIndex 会把整张列表静默截断成 1 条;
 *  ③内容损坏(坏 JSON)=先把原件备份成 .bak 再重置并明示用户(.md 文章都在,丢的只是登记行);
 *  备份是唯一保全,写不进去同样抛错拒写,绝不带着损坏继续。 */
async function readIndex() {
  if (!canFiles()) return { items: [] }
  let txt = null
  try { txt = await ctx.app.readFile(indexPath()) }
  catch (e) { throw new Error(t('idx_read_failed', { msg: (e && e.message) || String(e) })) }
  if (txt == null || !String(txt).trim()) { idxCache = { items: [] }; return { items: [] } }
  let j = null
  try { j = JSON.parse(txt) } catch { j = null }
  if (!j || !Array.isArray(j.items)) {
    try { await ctx.app.writeFile(indexPath() + '.bak', txt) }
    catch (e) { throw new Error(t('idx_backup_failed', { msg: (e && e.message) || String(e) })) }
    idxCache = { items: [] }
    try { await ctx.app.writeFile(indexPath(), JSON.stringify({ items: [] }, null, 2)) } catch { /* 重置写失败不阻断 */ }
    if (!idxCorruptWarned) { idxCorruptWarned = true; say(t('idx_corrupt'), { level: 'warning' }) }
    return { items: [] }
  }
  idxCache = { items: j.items }
  return { items: idxCache.items.slice() }
}
async function writeIndex(idx) {
  if (!canFiles()) return
  idxCache = { items: idx.items.slice() }
  await ctx.app.writeFile(indexPath(), JSON.stringify({ items: idx.items }, null, 2))
  refreshStatusItem()
  bus.emit({ type: 'index' })
}
/** 眼见为实:打开视图就把工作文件夹落进库(写索引),不必等第一篇文章。幂等。 */
const ensureWorkFolder = () => serialIndex(ensureWorkFolderRaw)
async function ensureWorkFolderRaw() {
  if (!canFiles()) return
  try { if ((await ctx.app.readFile(indexPath())) == null) await writeIndex({ items: idxCache.items }) } catch { /* ignore */ }
}
/** 抓好的文章落盘:重名加序号,frontmatter 契约字段齐全,索引条目六键(SPEC 钉死)。 */
const saveArticle = (meta, body) => serialIndex(() => saveArticleRaw(meta, body))
async function saveArticleRaw(meta, body) {
  if (!canFiles()) throw new Error(t('no_files_api'))
  const wf = folderRoot()
  // 兜底标题走 UNTITLED_TITLE 常量而非 t():它同时进 rf_title 与文件名 slug,是磁盘契约
  const title = String(meta.title == null ? '' : meta.title).replace(/\s+/g, ' ').trim() || domainOf(meta.url) || UNTITLED_TITLE
  const idx = await readIndex()
  const taken = new Set(idx.items.map((i) => i.path))
  const base = `${wf}/${ymd()}-${slugify(title)}`
  let path = base + '.md'
  for (let n = 2; (taken.has(path) || (await ctx.app.readFile(path)) != null) && n < 100; n++) path = `${base}-${n}.md`
  const saved = new Date(Date.now()).toISOString()
  const minutes = estimateMinutes(body, meta.minutes)
  const fm = { rf_url: meta.url || '', rf_title: title, rf_saved: saved, rf_status: 'inbox', rf_minutes: minutes }
  if (meta.author) fm.rf_author = String(meta.author)
  if (meta.published) fm.rf_published = String(meta.published)
  await ctx.app.writeFile(path, buildArticleText(fm, neutralizeReservedHeadings(body)))
  idx.items = [{ path, url: meta.url || '', title, status: 'inbox', saved, minutes }].concat(idx.items.filter((i) => i.path !== path))
  await writeIndex(idx)
  return { path, title }
}
/** 打开前校验:文件没了 → 孤儿剔除出索引,返回 null。 */
const loadArticle = (path) => serialIndex(() => loadArticleRaw(path))
async function loadArticleRaw(path) {
  if (!canFiles()) return null
  let txt = null
  // 宿主契约(types.ts):文件不存在返回 null;抛异常=IO 层故障——绝不能当「文件没了」剔孤儿
  try { txt = await ctx.app.readFile(path) }
  catch (e) { throw new Error(t('art_read_failed', { msg: (e && e.message) || String(e) })) }
  if (txt == null) {
    const idx = await readIndex()
    const left = idx.items.filter((i) => i.path !== path)
    if (left.length !== idx.items.length) { idx.items = left; await writeIndex(idx) }
    return null
  }
  const p = parseFrontmatter(txt)
  return { text: txt, fm: p.fm, body: p.body }
}
/** 状态流转:先写文件 rf_status,再刷索引;读完记一条活动日志。 */
const updateStatus = (path, status) => serialIndex(() => updateStatusRaw(path, status))
async function updateStatusRaw(path, status) {
  if (!canFiles()) return false
  let txt = null
  // 同 loadArticleRaw:只有真 null(文件不存在)才剔条目,IO 异常一律抛给调用方
  try { txt = await ctx.app.readFile(path) }
  catch (e) { throw new Error(t('art_read_failed_status', { msg: (e && e.message) || String(e) })) }
  if (txt == null) {
    const idx = await readIndex()
    idx.items = idx.items.filter((i) => i.path !== path)
    await writeIndex(idx)
    return false
  }
  await ctx.app.writeFile(path, setFmField(txt, 'rf_status', status))
  const idx = await readIndex()
  const it = idx.items.find((i) => i.path === path)
  if (it) { it.status = status; await writeIndex(idx) }
  if (status === 'done') ctx.activity?.log('article_read', { url: (it && it.url) || '', title: (it && it.title) || '' })
  return true
}
const removeFromIndex = (path) => serialIndex(async () => {
  const idx = await readIndex()
  idx.items = idx.items.filter((i) => i.path !== path)
  await writeIndex(idx)
})

// ── 抓取队列:串行 FIFO,防重入;状态存 localStorage,重启后未完成项标「中断,点击重试」 ──
/** dispose 后队列必须真停:disposer 只 abort 得了「在飞的那一个」,qPump 的 finally 还会拉起
 *  下一个 pending 项(新建的 controller 再无人 abort,还会经已停用的 ctx 写盘弹通知)。
 *  这面旗在 qAdd/qPump/qRun/importClips 四处设卡。 */
let disposed = false
const queue = { items: [], processing: false }
const QKEY = `plugin.${PLUGIN_ID}.queue`
const qEmit = () => bus.emit({ type: 'queue' })
/** 队列行的两句人话都**存钥匙不存句子**:状态短语按 status 现算,错误按 errKey/errVars 现取。
 *  存死句子的话,用户切语言后队列里躺着的失败行会一直是旧语言(e2e 第 9 项要抓的就是这个)。 */
const qStateLabel = (it) => (it.status === 'pending' ? t('q_pending') : it.status === 'fetching' ? t('q_fetching') : it.status === 'done' ? t('q_saved') : t('q_failed'))
const qErrText = (it) => (it && it.errKey ? t(it.errKey, it.errVars || null) : (it && it.error) || '')
function persistQueue() {
  try {
    localStorage.setItem(QKEY, JSON.stringify(queue.items.map((i) => ({ id: i.id, url: i.url, title: i.title || '', status: i.status, errType: i.errType || '', errKey: i.errKey || '', errVars: i.errVars || null, error: i.error || '', path: i.path || '' }))))
  } catch { /* ignore */ }
}
/** 重启恢复(纯函数):上次没跑完的 pending/fetching 一律标失败态 interrupted,可点重试。 */
function reviveQueue(raw) {
  let arr = null
  try { arr = JSON.parse(raw == null ? '[]' : raw) } catch { arr = null }
  if (!Array.isArray(arr)) arr = []
  return arr.filter((x) => x && typeof x.url === 'string' && x.url).map((x) => {
    const cut = x.status === 'pending' || x.status === 'fetching'
    const errKey = cut ? 'q_interrupted' : (x.errKey || '')
    const errVars = cut ? null : (x.errVars || null)
    return {
      id: x.id || uuid(), url: x.url, title: x.title || '',
      status: cut ? 'failed' : (x.status === 'done' ? 'done' : 'failed'),
      errType: cut ? 'interrupted' : (x.errType || ''),
      errKey, errVars,
      error: errKey ? t(errKey, errVars) : (x.error || ''),
      path: x.path || '', controller: null,
    }
  })
}
try { queue.items = reviveQueue(localStorage.getItem(QKEY)) } catch { /* ignore */ }

/** 入队(占位行 title=域名)。防重入:同 URL 在跑必拒;已在索引默认拒(force=重新抓取通道);
 *  同 URL 的失败行复用重试,不另起新行。 */
function qAdd(url, opts) {
  if (disposed) return { ok: false, reason: 'disposed' }
  const u = String(url == null ? '' : url).trim()
  if (!/^https?:\/\/\S+$/i.test(u)) return { ok: false, reason: 'bad_url' }
  if (queue.items.some((i) => i.url === u && (i.status === 'pending' || i.status === 'fetching'))) return { ok: false, reason: 'in_queue' }
  const failed = queue.items.find((i) => i.url === u && i.status === 'failed')
  if (failed) return qRetry(failed.id)
  if (!(opts && opts.force) && idxCache.items.some((i) => i.url === u)) return { ok: false, reason: 'exists' }
  const it = { id: uuid(), url: u, title: domainOf(u) || u, status: 'pending', errType: '', errKey: '', errVars: null, error: '', path: '', controller: null }
  queue.items.push(it)
  persistQueue(); qEmit(); qPump()
  return { ok: true, item: it }
}
function qRetry(id) {
  const it = queue.items.find((i) => i.id === id)
  if (!it || it.status === 'pending' || it.status === 'fetching') return { ok: false, reason: 'busy' }
  it.status = 'pending'; it.errType = ''; it.errKey = ''; it.errVars = null; it.error = ''
  persistQueue(); qEmit(); qPump()
  return { ok: true, item: it, retried: true }
}
function qRemove(id) {
  const it = queue.items.find((i) => i.id === id)
  if (it && it.controller) it.controller.abort()
  queue.items = queue.items.filter((i) => i.id !== id)
  persistQueue(); qEmit()
}
function qCancel(id) {
  const it = queue.items.find((i) => i.id === id)
  if (!it) return
  if (it.controller) it.controller.abort()
  else if (it.status === 'pending') qFail(it, 'interrupted', 'q_canceled', null, true)
}
function qClearDone() { queue.items = queue.items.filter((i) => i.status !== 'done'); persistQueue(); qEmit() }
function qFail(it, errType, errKey, errVars, quiet) {
  it.status = 'failed'; it.errType = errType; it.errKey = errKey; it.errVars = errVars || null; it.error = t(errKey, errVars)
  persistQueue(); qEmit()
  if (!quiet) say(t('q_fail_toast', { type: errType, msg: it.error }), { level: 'error' })
}
async function qPump() {
  if (disposed || queue.processing) return
  const it = queue.items.find((i) => i.status === 'pending')
  if (!it) return
  queue.processing = true
  try { await qRun(it) } finally { queue.processing = false; qPump() }
}
async function qRun(it) {
  const cfg = await getCfg()
  // getCfg await 窗口里被 dispose:此刻还没有 controller 可被 abort,靠旗拦。必须给项落终态
  // (不能光 return 留着 pending):qPump 若再被拉起会重新捡到它,pending 项永不消化就是死循环。
  if (disposed) { qFail(it, 'interrupted', 'q_disposed', null, true); return }
  if (!cfg.backendUrl || !cfg.token) { qFail(it, 'fetch_error', cfg.backendUrl ? 'login_first' : 'no_engine', null); return }
  it.controller = new AbortController()
  it.status = 'fetching'
  persistQueue(); qEmit()
  try {
    const out = await runAgent(cfg, uuid(), fetchMessage(it.url), null, it.controller.signal, { host: true })
    if (disposed) return // 已 dispose:不落盘、不经已停用的 ctx 弹通知(重启后标中断可重试)
    const cls = classifyArticle(parseArticleBlock(out))
    if (!cls.ok) { qFail(it, cls.errType, cls.errKey, cls.errVars); return }
    const saved = await saveArticle({ url: it.url, title: cls.meta.title, author: cls.meta.author, published: cls.meta.published, minutes: cls.meta.minutes }, cls.body)
    it.status = 'done'; it.title = saved.title; it.path = saved.path
    say(t('q_saved_toast', { title: saved.title }), { level: 'success' })
  } catch (e) {
    const aborted = it.controller && it.controller.signal.aborted
    if (aborted) qFail(it, 'interrupted', 'q_canceled', null, true)
    else qFail(it, 'fetch_error', 'e_raw', { msg: (e && e.message) || String(e) })
  } finally { it.controller = null; persistQueue(); qEmit() }
}

// ── Clip 导入:agent 只读 ls 出清单,插件自己逐个 readFile 登记(不搬家不复制) ────
function parseFileListBlock(raw) {
  const m = /```[^\n]*\bfiles\b[^\n]*\n([\s\S]*?)```/i.exec(String(raw == null ? '' : raw))
  const src = m ? m[1] : String(raw == null ? '' : raw)
  const out = []
  for (const line of src.split('\n')) {
    const s = line.trim().replace(/^[-*]\s+/, '').replace(/^["'`]|["'`]$/g, '')
    if (/^[^/\\]+\.md$/i.test(s) && !s.includes('..')) out.push(s)
  }
  return Array.from(new Set(out))
}
/** 从剪藏文件里尽力抠标题/URL(frontmatter 常见键 → 首个 markdown 链接 → 裸链接 → 文件名)。 */
function extractClipMeta(text, fallbackName) {
  const p = parseFrontmatter(text)
  const linkM = /\]\((https?:\/\/[^)\s]+)\)/.exec(p.body)
  const bare = /https?:\/\/[^\s)\]>"']+/.exec(p.body)
  const url = String(p.fm.rf_url || p.fm.url || p.fm.source || p.fm.link || (linkM ? linkM[1] : '') || (bare ? bare[0] : '')).replace(/^["']|["']$/g, '').trim()
  const hM = /^#{1,6}\s+(.+)$/m.exec(p.body)
  const title = String(p.fm.rf_title || p.fm.title || (hM ? hM[1] : '') || String(fallbackName == null ? '' : fallbackName).replace(/\.md$/i, '')).replace(/^["']|["']$/g, '').trim().slice(0, 80)
  return { url, title }
}
const clipFolder = () => String(getSetting('clipFolder', 'Forsion Clip')).replace(/^\/+|\/+$/g, '').trim() || 'Forsion Clip'
/** 清单 → 索引登记(纯插件侧,可测):已在索引(按路径或 rf_url)跳过,缺失计数,path 指向 Clip 原文件。 */
const applyClipImport = (names) => serialIndex(() => applyClipImportRaw(names))
async function applyClipImportRaw(names) {
  if (!canFiles()) return { added: 0, skipped: 0, missing: (names || []).length, folder: clipFolder() }
  const folder = clipFolder()
  const idx = await readIndex()
  const byPath = new Set(idx.items.map((i) => i.path))
  const byUrl = new Set(idx.items.map((i) => i.url).filter(Boolean))
  let added = 0, skipped = 0, missing = 0
  const fresh = []
  for (const name of names || []) {
    const path = `${folder}/${name}`
    if (byPath.has(path)) { skipped++; continue }
    let text = null
    try { text = await ctx.app.readFile(path) } catch { text = null }
    if (text == null) { missing++; continue }
    const meta = extractClipMeta(text, name)
    if (meta.url && byUrl.has(meta.url)) { skipped++; continue }
    const p = parseFrontmatter(text)
    const status = isStatus(p.fm.rf_status) ? p.fm.rf_status : 'inbox'
    const saved = p.fm.rf_saved || new Date(Date.now()).toISOString()
    fresh.push({ path, url: meta.url, title: meta.title || name.replace(/\.md$/i, ''), status, saved, minutes: estimateMinutes(p.body) })
    byPath.add(path)
    if (meta.url) byUrl.add(meta.url)
    added++
  }
  if (fresh.length) { idx.items = fresh.concat(idx.items); await writeIndex(idx) }
  return { added, skipped, missing, folder }
}
let importBusy = false, importController = null
async function importClips() {
  if (disposed) return
  if (importBusy) { say(t('imp_busy'), { level: 'warning' }); return }
  if (!canFiles()) { say(t('no_files_api'), { level: 'error' }); return }
  const cfg = await getCfg()
  if (disposed) return // getCfg await 窗口里被 dispose:importController 还没建,abort 不到,靠旗拦
  if (!cfg.backendUrl || !cfg.token) { say(cfg.backendUrl ? t('login_first') : t('no_engine'), { level: 'error' }); return }
  importBusy = true
  importController = new AbortController()
  const folder = clipFolder()
  say(t('imp_scanning', { folder }))
  try {
    const out = await runAgent(cfg, uuid(), clipListMessage(folder), null, importController.signal, { host: true })
    if (disposed) return // 已 dispose:不再读写索引、不经已停用 ctx 弹通知
    const names = parseFileListBlock(out)
    if (!names.length) { say(t('imp_none', { folder }), { level: 'warning' }); return }
    const r = await applyClipImport(names)
    say(t('imp_done', { added: r.added, skipped: r.skipped, missing: r.missing }), { level: 'success' })
  } catch (e) {
    if (!(importController && importController.signal.aborted)) say(t('imp_failed', { msg: (e && e.message) || String(e) }), { level: 'error' })
  } finally { importBusy = false; importController = null }
}

// ── 浮层容器:划线按钮/菜单/弹窗挂它(不是裸 body),同步铺 --rf-* 变量 ─────────────
/** 视图未挂载时(旧宿主无 registerView/无 ctx.app.prompt,askStr 兜底直接走 layer)的保底
 *  变量:先给一套能看的深/浅色,视图一挂载 syncTheme 会覆写同名属性。 */
function seedLayerVars(l) {
  let dark = false
  try { dark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) } catch { /* ignore */ }
  const f = dark
    ? { text: '#e6e6ea', 'text-sec': 'rgba(230,230,234,.72)', 'text-subtle': 'rgba(230,230,234,.4)', bg: '#17181c', elev: '#1f2026', surf: '#22232a', input: 'rgba(230,230,234,.06)', hover: 'rgba(230,230,234,.09)', border: 'rgba(230,230,234,.18)', fill: '#cfc9ff', 'fill-hover': '#bdb5ff', 'on-fill': '#16161a', primary: '#cfc9ff', glow: 'rgba(207,201,255,.25)', tint: 'rgba(207,201,255,.14)', shadow: '0 4px 20px rgba(0,0,0,.4)' }
    : { text: '#28282c', 'text-sec': 'rgba(40,40,44,.72)', 'text-subtle': 'rgba(40,40,44,.4)', bg: '#ffffff', elev: '#ffffff', surf: '#f6f6f8', input: 'rgba(40,40,44,.05)', hover: 'rgba(40,40,44,.07)', border: 'rgba(40,40,44,.18)', fill: '#4C2585', 'fill-hover': '#5b2f9c', 'on-fill': '#ffffff', primary: '#4C2585', glow: 'rgba(76,37,133,.22)', tint: 'rgba(76,37,133,.12)', shadow: '0 2px 12px rgba(0,0,0,.08)' }
  try { for (const k of Object.keys(f)) l.style.setProperty(`--rf-${k}`, f[k]) } catch { /* ignore */ }
}
let _layer = null
function layer() {
  if (!globalThis.document || !document.body) return null
  if (_layer && _layer.isConnected) return _layer
  _layer = document.createElement('div'); _layer.className = 'rf-layer'
  // STYLE 随 layer 自带一份:旧宿主永无视图挂载,askStr/菜单若只靠视图注入的 <style> 会全裸
  const st = document.createElement('style'); st.textContent = STYLE; _layer.appendChild(st)
  seedLayerVars(_layer)
  document.body.appendChild(_layer)
  return _layer
}
/** 端级 zoom 反补偿(正典 project_desktop_zoom_overlay_coords):rect/clientX 是视口坐标,
 *  而挂在 body(网页端 zoom 1.1 / 触屏 1.15)下的 layer 内部 offset 是未缩放局部 px,须除回去。 */
function zoomFactor() {
  try {
    const l = _layer && _layer.isConnected ? _layer : (globalThis.document && document.body)
    if (!l) return 1
    const z = l.currentCSSZoom != null ? Number(l.currentCSSZoom) : Number((getComputedStyle(document.body) || {}).zoom || 1)
    return Number.isFinite(z) && z > 0 ? z : 1
  } catch { return 1 }
}
const openMenus = new Set()
function showMenu(box) {
  const l = layer()
  if (l) l.appendChild(box)
  else if (globalThis.document && document.body) document.body.appendChild(box)
  openMenus.add(box)
}
/** 关一个浮层:带 __settle 的(askStr)必须结算 promise(null=取消)——只摘节点会让
 *  await promptStr 永久挂起,旧宿主下整条命令(添加链接/批注)静默挂死。 */
function settleMenu(m) {
  openMenus.delete(m)
  try { if (m.__settle) m.__settle(); else m.remove() } catch { /* ignore */ }
}
function closeMenus() { Array.from(openMenus).forEach(settleMenu) }
/** 外点关闭。__armed=false 的浮层(askStr)要等挂载后的第一次 mousedown(onDocArm)才算数:
 *  划线按钮 mousedown → hlBtn 被摘 → askStr 挂载 → 同一手势的 click 在飞且 closest('.rf-menu')
 *  必然为 null,不吞掉的话批注弹窗刚开就被自己关掉。 */
const onDocClick = (e) => {
  if (e.target && e.target.closest && e.target.closest('.rf-menu')) return
  Array.from(openMenus).filter((m) => m.__armed !== false).forEach(settleMenu)
}
const onDocArm = () => { openMenus.forEach((m) => { m.__armed = true }) }
if (globalThis.document && document.addEventListener) {
  document.addEventListener('click', onDocClick, true)
  document.addEventListener('mousedown', onDocArm, true)
}

/** 极简输入弹窗(Electron 无 window.prompt;ctx.app.prompt 缺席时的兜底)。
 *  语义对齐 ctx.app.prompt:确定(可空)→ 字符串;取消/Esc → null。 */
function askStr(title, def) {
  return new Promise((resolve) => {
    closeMenus()
    const ov = document.createElement('div'); ov.className = 'rf-menu'
    ov.style.left = '50%'; ov.style.top = '30%'; ov.style.transform = 'translateX(-50%)'; ov.style.minWidth = '300px'; ov.style.padding = '14px'
    const cap = document.createElement('div'); cap.style.fontSize = '12px'; cap.style.marginBottom = '8px'; cap.textContent = String(title == null ? '' : title)
    const inp = document.createElement('input'); inp.className = 'rf-input'; inp.value = def || ''
    const row = document.createElement('div'); row.className = 'rf-row'; row.style.marginTop = '10px'; row.style.justifyContent = 'flex-end'
    const no = document.createElement('button'); no.className = 'rf-btn ghost sm'; no.textContent = t('dlg_cancel')
    const ok = document.createElement('button'); ok.className = 'rf-btn primary sm'; ok.textContent = t('dlg_ok')
    let settled = false
    const done = (v) => { if (settled) return; settled = true; openMenus.delete(ov); try { ov.remove() } catch { /* ignore */ } resolve(v) }
    ov.__settle = () => done(null) // 外点/closeMenus/插件 dispose 关掉弹窗=取消,promise 必结算
    ov.__armed = false // 挂载前那次 mousedown 派生的在飞 click 不算外点(见 onDocClick)
    ok.addEventListener('click', () => done(inp.value))
    no.addEventListener('click', () => done(null))
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(inp.value); if (e.key === 'Escape') done(null) })
    row.appendChild(no); row.appendChild(ok); ov.appendChild(cap); ov.appendChild(inp); ov.appendChild(row)
    showMenu(ov); inp.focus()
  })
}
const promptStr = (title, def) => (ctx.app.prompt ? ctx.app.prompt(title, def || '') : askStr(title, def))

// ── 主题:吃宿主 token,缺哪个从计算样式派生(bluebird 血泪全套,--rf-* 前缀) ──────
let _probe = null
function parseColor(css) {
  const s = (css || '').trim(); if (!s) return null
  if (!_probe) { const c = document.createElement('canvas'); c.width = c.height = 1; _probe = c.getContext('2d', { willReadFrequently: true }) }
  if (!_probe) return null
  _probe.fillStyle = '#000000'; _probe.fillStyle = s; const a = _probe.fillStyle
  _probe.fillStyle = '#ffffff'; _probe.fillStyle = s; if (a === '#000000' && _probe.fillStyle === '#ffffff') return null
  _probe.clearRect(0, 0, 1, 1); _probe.fillRect(0, 0, 1, 1); const d = _probe.getImageData(0, 0, 1, 1).data
  return [d[0], d[1], d[2], d[3] / 255]
}
function opaqueBgOf(start) {
  for (let n = start; n; n = n.parentElement) { const c = parseColor(getComputedStyle(n).backgroundColor); if (c && c[3] > 0.95) return `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})` }
  return null
}
const relL = (c) => { const g = (v) => { const x = v / 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4) }; return .2126 * g(c[0]) + .7152 * g(c[1]) + .0722 * g(c[2]) }
const contrast = (a, b) => { const x = relL(a), y = relL(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05) }
/** 强调色上的字色:白 / 近黑取对比度高的一方(宿主没给 --on-accent 时的兜底)。 */
const onColorOf = (accent) => (contrast(accent, [255, 255, 255]) >= contrast(accent, [22, 22, 26]) ? '#ffffff' : '#16161a')
/** 强调色当前景用时,与底色对比不足就朝文字色掺,掺到 3:1 为止。 */
function readableOn(fg, bg, text, min = 3) {
  let c = [fg[0], fg[1], fg[2]]
  for (let i = 0; i < 12 && contrast(c, bg) < min; i++) c = c.map((v, k) => v + (text[k] - v) * .18)
  return `rgb(${c.map((v) => Math.round(v)).join(',')})`
}
function syncTheme(root) {
  const cs = getComputedStyle(root)
  const tok = (n) => (cs.getPropertyValue(n) || '').trim()
  const rgb = parseColor(tok('--text')) || parseColor(cs.color) || [40, 40, 40, 1]
  const dark = relL(rgb) > .5
  const bgc = parseColor(tok('--bg')) || parseColor(opaqueBgOf(root.parentElement) || '') || (dark ? [23, 24, 28] : [255, 255, 255])
  const rd = (n) => Math.round(n)
  const f = (a) => `rgba(${rd(rgb[0])},${rd(rgb[1])},${rd(rgb[2])},${a})`
  const accent = tok('--accent') || tok('--am-accent') || (dark ? '#cfc9ff' : '#4C2585')
  const arc = parseColor(accent) || [76, 37, 133, 1]
  const af = (a) => `rgba(${rd(arc[0])},${rd(arc[1])},${rd(arc[2])},${a})`
  const targets = [root, layer()].filter(Boolean)
  const set = (k, v) => targets.forEach((tg) => tg.style.setProperty(`--rf-${k}`, v))
  targets.forEach((tg) => { tg.style.colorScheme = dark ? 'dark' : 'light' })
  set('text', tok('--text') || `rgb(${rd(rgb[0])},${rd(rgb[1])},${rd(rgb[2])})`)
  set('text-sec', tok('--text-light') || f(.72)); set('text-muted', tok('--text-muted') || f(.5)); set('text-subtle', tok('--text-faint') || f(.32))
  set('bg', tok('--bg') || `rgb(${rd(bgc[0])},${rd(bgc[1])},${rd(bgc[2])})`)
  set('elev', tok('--bg-card') || tok('--bg') || `rgb(${rd(bgc[0])},${rd(bgc[1])},${rd(bgc[2])})`)
  set('surf', tok('--bg-card') || f(.045)); set('surf-sub', tok('--overlay-subtle') || f(.025))
  set('sidebar', tok('--sidebar-bg') || f(.03)); set('header', tok('--overlay-subtle') || f(.02)); set('input', tok('--overlay-light') || f(.05))
  set('hover', tok('--overlay-medium') || f(.08)); set('border', tok('--border') || f(.16))
  set('border-sub', tok('--overlay-medium') || f(.09)); set('border-hover', tok('--overlay-strong') || f(.32))
  set('fill', accent); set('fill-hover', tok('--accent-hover') || accent); set('on-fill', tok('--on-accent') || onColorOf(arc))
  set('primary', readableOn(arc, bgc, rgb)); set('glow', af(.22)); set('tint', tok('--accent-light') || af(.13))
  set('user-bg', tok('--user-bg') || af(.14))
  set('danger', tok('--danger') || (dark ? '#e08a7d' : '#b03a2e'))
  set('ai-bg', tok('--tool-bg') || f(.05)); set('ai-border', tok('--border') || f(.08))
  set('shadow', tok('--card-shadow') || (dark ? '0 4px 20px rgba(0,0,0,.4)' : '0 2px 12px rgba(0,0,0,.08)'))
}
function themeObserver(root) {
  syncTheme(root)
  const ob = new MutationObserver(() => syncTheme(root))
  for (let n = root.parentElement; n; n = n.parentElement) ob.observe(n, { attributes: true, attributeFilter: ['class', 'data-mode', 'data-theme', 'style'] })
  const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)')
  const onMq = () => syncTheme(root); if (mq && mq.addEventListener) mq.addEventListener('change', onMq)
  return () => { ob.disconnect(); if (mq && mq.removeEventListener) mq.removeEventListener('change', onMq) }
}

const STYLE = `
.rf-root{height:100%;min-height:0;display:flex;flex-direction:column;color:inherit;background:var(--rf-bg);font-size:13px;line-height:1.5}
.rf-root *{box-sizing:border-box}
.rf-root ::-webkit-scrollbar{width:6px;height:6px}.rf-root ::-webkit-scrollbar-thumb{background:var(--rf-border);border-radius:3px}
.rf-panel{border-radius:var(--radius-md);background:var(--rf-surf);border:1px solid var(--rf-border-sub);box-shadow:var(--rf-shadow)}
.rf-input{width:100%;padding:8px 11px;font:inherit;color:var(--rf-text);background:var(--rf-input);border:1.5px solid var(--rf-border);border-radius:var(--radius-sm);outline:none;transition:border-color .2s,box-shadow .2s}
.rf-input::placeholder{color:var(--rf-text-subtle)}
.rf-input:focus{border-color:var(--rf-primary);box-shadow:0 0 0 3px var(--rf-glow)}
.rf-btn{padding:7px 12px;font:inherit;color:var(--rf-text-sec);border:1px solid var(--rf-border);border-radius:var(--radius-sm);background:var(--rf-surf);cursor:pointer;transition:background .2s,border-color .2s,color .2s;white-space:nowrap}
.rf-btn:hover:not(:disabled){background:var(--rf-tint);border-color:var(--rf-primary);color:var(--rf-primary)}
.rf-btn:active:not(:disabled){transform:scale(.98)}
.rf-btn:disabled{opacity:.5;cursor:default}
.rf-btn.primary{color:var(--rf-on-fill);background:var(--rf-fill);border-color:transparent;font-weight:500}
.rf-btn.primary:hover:not(:disabled){background:var(--rf-fill-hover);color:var(--rf-on-fill);border-color:transparent}
.rf-btn.ghost{background:transparent;color:var(--rf-text-sec);border-color:transparent}
.rf-btn.ghost:hover:not(:disabled){background:var(--rf-hover);color:var(--rf-text);border-color:transparent}
.rf-btn.sm{padding:4px 9px;font-size:12px;border-radius:var(--radius-sm)}
.rf-label{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--rf-text-muted)}
.rf-muted{color:var(--rf-text-muted)}
.rf-row{display:flex;gap:8px;align-items:center}
.rf-lib{display:flex;flex-direction:column;height:100%;background:var(--rf-sidebar)}
.rf-lib-hd{padding:12px;border-bottom:1px solid var(--rf-border-sub)}
.rf-lib-body{flex:1;overflow:auto;padding:10px}
.rf-warn{font-size:11px;margin-top:6px;min-height:14px}
.rf-tabs{display:flex;gap:4px;padding:4px;border-radius:var(--radius-sm);background:var(--rf-surf-sub);margin:10px 0 4px}
.rf-tab{flex:1;padding:6px 2px;text-align:center;border-radius:calc(var(--radius-sm) - 4px);cursor:pointer;font-size:12px;color:var(--rf-text-sec);white-space:nowrap}
.rf-tab.on{background:var(--rf-tint);color:var(--rf-primary);font-weight:500}
.rf-tab .n{font-size:10px;opacity:.7;margin-left:2px}
.rf-card{border-radius:var(--radius-md);background:var(--rf-surf);border:1px solid var(--rf-border-sub);cursor:pointer;padding:9px 11px;margin-top:6px;transition:border-color .2s,background .2s}
.rf-card:hover{border-color:var(--rf-primary);background:var(--rf-tint)}
.rf-card .ttl{font-size:12.5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.rf-card .sub{font-size:10.5px;color:var(--rf-text-subtle);margin-top:3px;display:flex;gap:6px;flex-wrap:wrap}
.rf-empty{padding:22px 8px;text-align:center;color:var(--rf-text-subtle);font-size:12px;line-height:1.8}
.rf-ritual{padding:10px 11px;margin-bottom:4px}
.rf-rit-row{display:flex;gap:8px;align-items:center;margin-top:8px}
.rf-rit-row .ttl{flex:1;min-width:0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
.rf-rit-row .ttl:hover{color:var(--rf-primary)}
.rf-qrow{display:flex;gap:9px;align-items:flex-start;padding:8px 10px;border-radius:var(--radius-md);border:1px solid var(--rf-border-sub);margin-top:6px;background:var(--rf-surf)}
.rf-qrow .mid{flex:1;min-width:0}
.rf-qrow .ttl{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rf-qrow .sub{font-size:10.5px;color:var(--rf-text-muted);margin-top:2px}
.rf-qrow .err{font-size:10.5px;color:var(--rf-danger);margin-top:2px}
.rf-qrow .acts{display:flex;gap:4px;flex:0 0 auto}
.rf-qic{flex:0 0 auto;width:16px;height:16px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10px;margin-top:2px}
.rf-qic.ok{background:var(--rf-tint);color:var(--rf-primary)}
.rf-qic.bad{color:var(--rf-danger);border:1px solid var(--rf-danger)}
.rf-qic.spin{border:2px solid var(--rf-border);border-top-color:var(--rf-primary);animation:rfspin 1s linear infinite}
.rf-qic.wait{border:2px dashed var(--rf-border)}
@keyframes rfspin{to{transform:rotate(360deg)}}
.rf-app{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--rf-bg)}
.rf-hdr{flex:0 0 auto;display:flex;gap:6px;align-items:center;padding:9px 14px;border-bottom:1px solid var(--rf-border-sub);background:var(--rf-header);flex-wrap:wrap}
.rf-hd-main{flex:1;min-width:160px}
.rf-hd-title{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60ch}
.rf-hd-meta{font-size:11px;margin-top:1px}
.rf-body{flex:1;min-height:0;display:flex;overflow:hidden}
.rf-read-wrap{flex:1;min-width:0;overflow:auto;padding:26px 22px 64px}
.rf-read{max-width:68ch;margin:0 auto;line-height:1.7;font-size:16px}
.rf-side{flex:0 0 320px;min-width:0;overflow:auto;border-left:1px solid var(--rf-border-sub);padding:12px;display:flex;flex-direction:column;gap:12px;background:var(--rf-sidebar)}
.rf-side.hidden{display:none}
@media(max-width:860px){.rf-side{flex-basis:260px}}
.rf-sec-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.rf-hero{max-width:520px;margin:10vh auto 0;text-align:center;padding:0 20px}
.rf-hero h1{font-size:22px;font-weight:700;margin:0 0 8px;color:var(--rf-primary)}
.rf-hero p{color:var(--rf-text-muted);margin:0 0 16px;line-height:1.9;font-size:13px}
.rf-status-pill{display:inline-block;font-size:10px;font-weight:600;padding:1px 8px;border-radius:var(--radius-pill, 999px);background:var(--rf-tint);color:var(--rf-primary)}
.rf-out h1,.rf-out h2,.rf-out h3,.rf-out h4{margin:1em 0 .45em;line-height:1.35}
.rf-out h1{font-size:1.45em}.rf-out h2{font-size:1.22em}.rf-out h3{font-size:1.06em}
.rf-out p{margin:.55em 0}
.rf-out img{max-width:100%;border-radius:var(--radius-sm)}
.rf-out pre{background:var(--rf-surf-sub);padding:10px 12px;border-radius:var(--radius-sm);overflow:auto;font-size:.88em}
.rf-out code{background:var(--rf-surf-sub);padding:1px 5px;border-radius:var(--radius-xs, 4px);font-family:ui-monospace,Menlo,monospace;font-size:.9em}
.rf-out pre code{background:transparent;padding:0}
.rf-out blockquote{margin:.6em 0;padding:2px 12px;border-left:3px solid var(--rf-primary);color:var(--rf-text-sec)}
.rf-out a{color:var(--rf-primary)}
.rf-out ul,.rf-out ol{padding-left:1.4em;margin:.55em 0}
.rf-out li{margin:.25em 0}
.rf-out hr{border:none;border-top:1px solid var(--rf-border-sub);margin:1.2em 0}
.rf-hl-quote{border-left:3px solid var(--rf-primary);padding:6px 10px;margin-top:8px;background:var(--rf-surf-sub);border-radius:0 var(--radius-sm) var(--radius-sm) 0;font-size:12px;line-height:1.6;white-space:pre-wrap}
.rf-hl-note{color:var(--rf-text-muted);margin-top:4px;font-size:11.5px}
.rf-qa-log{display:flex;flex-direction:column;gap:8px;max-height:320px;overflow:auto;padding:2px 0}
.rf-msg{max-width:92%;padding:7px 10px;font-size:12px;border-radius:var(--radius-md)}
.rf-msg.u{align-self:flex-end;color:var(--rf-text);background:var(--rf-user-bg);border-bottom-right-radius:var(--radius-xs, 4px)}
.rf-msg.a{align-self:flex-start;background:var(--rf-ai-bg);border:1px solid var(--rf-ai-border);color:var(--rf-text-sec);border-bottom-left-radius:var(--radius-xs, 4px)}
.rf-layer{position:fixed;inset:0;z-index:9999;pointer-events:none;color:var(--rf-text);font-size:13px;line-height:1.5}
.rf-menu{position:absolute;pointer-events:auto;min-width:140px;padding:4px;border-radius:var(--radius-md);background:var(--rf-elev);border:1px solid var(--rf-border);box-shadow:var(--rf-shadow)}
.rf-menu div{padding:6px 10px;border-radius:var(--radius-sm);cursor:pointer;font-size:12px}
.rf-menu div:hover{background:var(--rf-hover)}
.rf-hlbtn{position:absolute;pointer-events:auto;padding:5px 13px;border-radius:var(--radius-pill, 999px);background:var(--rf-fill);color:var(--rf-on-fill);font-size:12px;cursor:pointer;box-shadow:var(--rf-shadow);border:none;transform:translate(-50%,-100%)}
.rf-hlbtn:hover{background:var(--rf-fill-hover)}
`

// ══ 行/卡片构件(模块级:每次重绘现取文案,check.mjs 也能拿 mock DOM 直接量英文) ══
/** 队列行(占位行:入队即现,title=域名;全 DOM 拼装,textContent 杜绝注入)。 */
function buildQueueRow(it, on) {
  const h = on || {}
  const row = document.createElement('div'); row.className = 'rf-qrow'
  const ic = document.createElement('span')
  ic.className = 'rf-qic ' + (it.status === 'done' ? 'ok' : it.status === 'failed' ? 'bad' : it.status === 'pending' ? 'wait' : 'spin')
  ic.textContent = it.status === 'done' ? '✓' : it.status === 'failed' ? '✕' : ''
  const mid = document.createElement('div'); mid.className = 'mid'
  const ttl = document.createElement('div'); ttl.className = 'ttl'; ttl.textContent = it.title || it.url; ttl.title = it.url
  const sub = document.createElement('div'); sub.className = 'sub'; sub.textContent = qStateLabel(it)
  mid.appendChild(ttl); mid.appendChild(sub)
  const errText = it.status === 'failed' ? qErrText(it) : ''
  if (errText) {
    const er = document.createElement('div'); er.className = 'err'
    er.textContent = (it.errType ? `[${it.errType}] ` : '') + errText; er.title = er.textContent
    mid.appendChild(er)
  }
  const acts = document.createElement('div'); acts.className = 'acts'
  const btn = (txt, fn) => { const b = document.createElement('button'); b.className = 'rf-btn ghost sm'; b.textContent = txt; b.addEventListener('click', (e) => { e.stopPropagation(); if (fn) fn() }); acts.appendChild(b) }
  if (it.status === 'failed') btn(t('q_retry'), () => h.retry && h.retry(it))
  if (it.status === 'pending' || it.status === 'fetching') btn(t('q_cancel'), () => h.cancel && h.cancel(it))
  if (it.status === 'done' && it.path) btn(t('q_open'), () => h.open && h.open(it))
  if (it.status === 'done' || it.status === 'failed') btn(t('q_remove'), () => h.remove && h.remove(it))
  row.appendChild(ic); row.appendChild(mid); row.appendChild(acts)
  if (it.status === 'failed') row.addEventListener('click', () => h.retry && h.retry(it)) // 「中断,点击重试」
  return row
}
/** 空栏提示(每栏一句,按当前语言现取)。 */
function buildEmptyTip(tab) {
  const d = document.createElement('div'); d.className = 'rf-empty'
  d.textContent = isStatus(tab) ? t('empty_' + tab) : t('empty_other')
  return d
}
/** 列表卡片:标题 + 域名/估读/存入日(日期按语言走 toLocaleDateString)。 */
function buildArticleCard(it, on) {
  const h = on || {}
  const card = document.createElement('div'); card.className = 'rf-card'
  const ttl = document.createElement('div'); ttl.className = 'ttl'; ttl.textContent = it.title || t('card_untitled')
  const sub = document.createElement('div'); sub.className = 'sub'
  const parts = [domainOf(it.url), it.minutes ? t('minutes', { n: it.minutes }) : '', it.saved ? t('saved_on', { d: fmtDay(it.saved) }) : ''].filter(Boolean)
  for (const p of parts) { const s = document.createElement('span'); s.textContent = p; sub.appendChild(s) }
  card.appendChild(ttl); card.appendChild(sub)
  card.addEventListener('click', () => h.open && h.open(it))
  card.addEventListener('contextmenu', (e) => { e.preventDefault(); if (h.menu) h.menu(it, e.clientX, e.clientY) })
  return card
}

// ══ library 视图:队列 + 消化仪式 + 状态分栏 ═══════════════════════════════════
function mountLibrary(el) {
  el.innerHTML = ''
  const style = document.createElement('style'); style.textContent = STYLE; el.appendChild(style)
  const root = document.createElement('div'); root.className = 'rf-root'
  // 骨架里**一个人话字都没有**:全部文案由 paintChrome() 现填,漏了一条就是空白而不是漏中文
  root.innerHTML = `
<div class="rf-lib">
  <div class="rf-lib-hd">
    <div class="rf-row" style="margin-bottom:10px;justify-content:space-between">
      <b style="font-size:14px" data-brand></b>
      <span class="rf-muted" data-total style="font-size:11px"></span>
    </div>
    <div class="rf-row">
      <input class="rf-input" data-url style="flex:1"/>
      <button class="rf-btn primary" data-add></button>
    </div>
    <div class="rf-muted rf-warn" data-warn></div>
  </div>
  <div class="rf-lib-body">
    <div data-queue></div>
    <div data-ritual></div>
    <div class="rf-tabs" data-tabs></div>
    <div data-list></div>
  </div>
</div>`
  el.appendChild(root)
  const off = themeObserver(root)
  const $ = (s) => root.querySelector(s)
  const urlEl = $('[data-url]'), warnEl = $('[data-warn]')
  let items = [], tab = 'inbox', warnKey = ''

  /** 静态文案只在这里落地;语言一变重跑它,视图不重挂也变英文。 */
  function paintChrome() {
    const brand = $('[data-brand]'); if (brand) brand.textContent = t('brand')
    if (urlEl) urlEl.placeholder = t('url_ph')
    const addBtn = $('[data-add]'); if (addBtn) addBtn.textContent = t('add')
    paintWarn()
  }
  function paintWarn() { if (warnEl) warnEl.textContent = warnKey ? t(warnKey) : '' }

  function add() {
    const r = qAdd(urlEl.value)
    if (r.ok) { urlEl.value = ''; warnKey = r.retried ? 'w_requeued' : 'w_queued' }
    else warnKey = r.reason === 'exists' ? 'w_exists' : r.reason === 'in_queue' ? 'w_in_queue' : r.reason === 'busy' ? 'w_busy' : 'w_bad_url'
    paintWarn()
  }
  $('[data-add]').addEventListener('click', add)
  urlEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') add() })
  urlEl.addEventListener('input', () => { warnKey = ''; paintWarn() })

  const qHandlers = {
    retry: (it) => qRetry(it.id),
    cancel: (it) => qCancel(it.id),
    open: (it) => openArticle(it.path),
    remove: (it) => qRemove(it.id),
  }
  function renderQueue() {
    const box = $('[data-queue]'); if (!box) return
    box.textContent = ''
    if (!queue.items.length) return
    const cap = document.createElement('div'); cap.className = 'rf-row'; cap.style.justifyContent = 'space-between'; cap.style.margin = '2px 2px 0'
    const lb = document.createElement('span'); lb.className = 'rf-label'; lb.textContent = t('q_label')
    cap.appendChild(lb)
    if (queue.items.some((i) => i.status === 'done')) {
      const cd = document.createElement('button'); cd.className = 'rf-btn ghost sm'; cd.textContent = t('q_clear_done')
      cd.addEventListener('click', qClearDone); cap.appendChild(cd)
    }
    box.appendChild(cap)
    for (const it of queue.items) box.appendChild(buildQueueRow(it, qHandlers))
  }

  /** 消化仪式:最老的 3 篇未读置顶,一键「今天读它 / 归档它」。 */
  function renderRitual() {
    const box = $('[data-ritual]'); if (!box) return
    box.textContent = ''
    const oldest = items.filter((i) => i.status === 'inbox').sort((a, b) => String(a.saved).localeCompare(String(b.saved))).slice(0, 3)
    if (!oldest.length) return
    const card = document.createElement('div'); card.className = 'rf-panel rf-ritual'
    const lb = document.createElement('div'); lb.className = 'rf-label'; lb.textContent = t('ritual_label')
    card.appendChild(lb)
    for (const it of oldest) {
      const row = document.createElement('div'); row.className = 'rf-rit-row'
      const ttl = document.createElement('span'); ttl.className = 'ttl'; ttl.textContent = it.title; ttl.title = it.title
      ttl.addEventListener('click', () => openArticle(it.path))
      const read = document.createElement('button'); read.className = 'rf-btn primary sm'; read.textContent = t('ritual_read')
      read.addEventListener('click', guard(async () => { await updateStatus(it.path, 'reading'); openArticle(it.path) }))
      const arch = document.createElement('button'); arch.className = 'rf-btn ghost sm'; arch.textContent = t('ritual_archive')
      arch.addEventListener('click', guard(() => updateStatus(it.path, 'archived')))
      row.appendChild(ttl); row.appendChild(read); row.appendChild(arch)
      card.appendChild(row)
    }
    box.appendChild(card)
  }

  function renderTabs() {
    const box = $('[data-tabs]'); if (!box) return
    box.textContent = ''
    for (const s of STATUS_ORDER) {
      const n = items.filter((i) => i.status === s).length
      const d = document.createElement('div'); d.className = 'rf-tab' + (tab === s ? ' on' : '')
      const nm = document.createElement('span'); nm.textContent = statusLabel(s)
      const cnt = document.createElement('span'); cnt.className = 'n'; cnt.textContent = String(n)
      d.appendChild(nm); d.appendChild(cnt)
      d.addEventListener('click', () => { tab = s; render() })
      box.appendChild(d)
    }
  }
  const cardHandlers = { open: (it) => openArticle(it.path), menu: (it, x, y) => itemMenu(it, x, y) }
  function renderList() {
    const box = $('[data-list]'); if (!box) return
    box.textContent = ''
    const list = items.filter((i) => i.status === tab).sort((a, b) => String(b.saved).localeCompare(String(a.saved)))
    if (!list.length) { box.appendChild(buildEmptyTip(tab)); return }
    for (const it of list) box.appendChild(buildArticleCard(it, cardHandlers))
  }
  function itemMenu(it, x, y) {
    closeMenus()
    const z = zoomFactor() // clientX/Y 是视口坐标,layer 内 offset 是未缩放局部 px
    const box = document.createElement('div'); box.className = 'rf-menu'; box.style.left = Math.round(x / z) + 'px'; box.style.top = Math.round(y / z) + 'px'
    const add2 = (txt, fn) => { const d = document.createElement('div'); d.textContent = txt; d.addEventListener('click', () => { closeMenus(); guard(fn)() }); box.appendChild(d) }
    if (it.status !== 'reading') add2(t('m_start'), () => updateStatus(it.path, 'reading'))
    if (it.status !== 'done') add2(t('m_done'), () => updateStatus(it.path, 'done'))
    if (it.status !== 'archived') add2(t('m_archive'), () => updateStatus(it.path, 'archived'))
    else add2(t('m_unarchive'), () => updateStatus(it.path, 'inbox'))
    add2(t('m_open_note'), () => { openNotePath(it.path) })
    add2(t('m_remove'), () => removeFromIndex(it.path))
    showMenu(box)
  }
  function render() {
    const total = $('[data-total]')
    if (total) total.textContent = items.length ? t('total', { n: items.length }) : ''
    renderQueue(); renderRitual(); renderTabs(); renderList()
  }
  async function refresh() { try { items = (await readIndex()).items } catch { /* 瞬时读失败:保留上次列表,不清屏 */ } render() }
  const offBus = bus.on((e) => {
    if (e.type === 'index') refresh()
    else if (e.type === 'queue') renderQueue()
    else if (e.type === 'locale') { paintChrome(); render() } // 语言变:同步重绘,不重挂
  })
  paintChrome()
  ensureWorkFolder().then(refresh)
  return () => { off(); offBus(); closeMenus() }
}

function openArticle(path) {
  pendingOpen = { path }
  bus.emit({ type: 'open-article', path })
  if (ctx.openView) ctx.openView('reader')
}

// ══ reader 视图:阅读排版 + 划线 + AI 摘要 + 问答 + 状态流转 ══════════════════════
function mountReader(el) {
  el.innerHTML = ''
  const style = document.createElement('style'); style.textContent = STYLE; el.appendChild(style)
  const root = document.createElement('div'); root.className = 'rf-root'
  el.appendChild(root)
  const off = themeObserver(root)
  let cur = null // { path, fm, body, main, title, url, status, minutes, saved }
  let qaController = null, sumController = null, qaSessionId = null, qaSeeded = false
  let hlBtn = null, hlQuote = ''

  const fontSize = () => Math.min(28, Math.max(12, parseInt(getSetting('fontSize', '16'), 10) || 16))
  function applyFont() { const b = root.querySelector('[data-body]'); if (b) b.style.fontSize = fontSize() + 'px' }

  function hideHlBtn() { if (hlBtn) { try { hlBtn.remove() } catch { /* ignore */ } hlBtn = null } }
  function showHlBtn(rect, text) {
    hlQuote = text
    const l = layer(); if (!l) return
    if (!hlBtn) {
      hlBtn = document.createElement('button'); hlBtn.className = 'rf-hlbtn'
      hlBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); const q = hlQuote; hideHlBtn(); guard(doHighlight)(q) })
    }
    hlBtn.textContent = t('hl_btn') // 每次浮出都现取:语言变了按钮上的字也变
    const z = zoomFactor() // rect 是视口坐标,layer 内 offset 是未缩放局部 px
    hlBtn.style.left = Math.round((rect.left + rect.width / 2) / z) + 'px'
    hlBtn.style.top = Math.max(12, Math.round((rect.top - 8) / z)) + 'px'
    l.appendChild(hlBtn)
  }
  const onMouseUp = () => {
    setTimeout(() => {
      try {
        const sel = window.getSelection && window.getSelection()
        const bodyEl = root.querySelector('[data-body]')
        if (!sel || sel.isCollapsed || !bodyEl) { hideHlBtn(); return }
        const text = String(sel.toString()).trim()
        if (!text || !bodyEl.contains(sel.anchorNode) || !bodyEl.contains(sel.focusNode)) { hideHlBtn(); return }
        showHlBtn(sel.getRangeAt(0).getBoundingClientRect(), text)
      } catch { /* ignore */ }
    }, 0)
  }
  const onDocDown = (e) => { if (!(e.target && e.target.closest && e.target.closest('.rf-hlbtn'))) hideHlBtn() }
  root.addEventListener('mouseup', onMouseUp)
  document.addEventListener('mousedown', onDocDown, true)

  async function doHighlight(quote) {
    if (!cur) return
    // 路径快照:批注弹窗开着/读盘期间用户可能切到另一篇(cur 被 openPath 改写),读写全用
    // 快照才不会把 A 的引文写进 B、更不会拿 A 全文整体覆盖 B(P1 竞态)。划线本身仍然要写:
    // 引文是从 A 选出来的,写回 A 永远正确。
    const path = cur.path
    const note = await promptStr(t('hl_note_prompt'), '')
    if (note == null) return
    let txt = null
    try { txt = await ctx.app.readFile(path) } catch { txt = null }
    if (txt == null) { say(t('hl_file_gone'), { level: 'error' }); return }
    await ctx.app.writeFile(path, appendHighlight(txt, quote, note))
    try { if (window.getSelection) window.getSelection().removeAllRanges() } catch { /* ignore */ }
    say(t('hl_saved'), { level: 'success' })
    if (cur && cur.path === path) await refreshFile()
  }

  function makeCur(path, a) {
    const it = idxCache.items.find((i) => i.path === path)
    return {
      path, fm: a.fm, body: a.body,
      main: stripSections(a.body, [H_HIGHLIGHT, H_SUMMARY]),
      title: a.fm.rf_title || (it && it.title) || String(path).split('/').pop().replace(/\.md$/i, ''),
      url: a.fm.rf_url || (it && it.url) || '',
      status: (isStatus(a.fm.rf_status) ? a.fm.rf_status : (it && it.status)) || 'inbox',
      minutes: Number(a.fm.rf_minutes) || (it && it.minutes) || 0,
      saved: a.fm.rf_saved || (it && it.saved) || '',
    }
  }

  function renderEmpty() {
    cur = null
    root.innerHTML = `
<div class="rf-app">
  <div class="rf-read-wrap">
    <div class="rf-hero">
      <h1 data-herotitle></h1>
      <p data-herobody></p>
      <p data-herobody2></p>
      <button class="rf-btn primary" data-golist></button>
    </div>
  </div>
</div>`
    const ht = root.querySelector('[data-herotitle]'); if (ht) ht.textContent = t('hero_title')
    const hb = root.querySelector('[data-herobody]'); if (hb) hb.textContent = t('hero_body')
    const hb2 = root.querySelector('[data-herobody2]'); if (hb2) hb2.textContent = t('hero_body2')
    const b = root.querySelector('[data-golist]')
    if (b) { b.textContent = t('hero_btn'); b.addEventListener('click', () => { if (ctx.openView) ctx.openView('library') }) }
  }

  let openSeq = 0 // 快速连点两篇:只认最后一次 openPath 的结果,防先发后至的旧文章盖屏
  async function openPath(path) {
    const seq = ++openSeq
    const a = await loadArticle(path)
    if (seq !== openSeq) return
    if (!a) { say(t('art_gone'), { level: 'warning' }); renderEmpty(); return }
    cur = makeCur(path, a)
    qaSessionId = uuid(); qaSeeded = false
    if (qaController) { qaController.abort(); qaController = null }
    if (sumController) { sumController.abort(); sumController = null }
    renderArticle()
  }
  /** 落盘后回读(划线/摘要/状态之后):渲染只从文件读;问答日志保留。路径快照:读盘期间
   *  切了文章就丢弃这份过期结果,绝不拿旧文回填新篇(P1 同族)。 */
  async function refreshFile() {
    if (!cur) return
    const path = cur.path
    const a = await loadArticle(path)
    if (!cur || cur.path !== path) return
    if (!a) { say(t('art_gone'), { level: 'warning' }); renderEmpty(); return }
    cur = makeCur(path, a)
    fillMeta(); fillBody(); fillSummary(); fillHighlights()
  }

  /** 阅读器静态 chrome 的文案(按钮/面板标题/占位符);语言变时与 fill* 一起重跑。 */
  function paintChrome() {
    const set = (sel, txt, tip) => { const n = root.querySelector(sel); if (!n) return; n.textContent = txt; if (tip != null) n.title = tip }
    set('[data-fminus]', 'A−', t('font_smaller'))
    set('[data-fplus]', 'A＋', t('font_bigger'))
    set('[data-archivebtn]', t('btn_archive'))
    set('[data-refetch]', t('btn_refetch'), t('btn_refetch_tip'))
    set('[data-opennote]', t('btn_open_note'))
    set('[data-sidetoggle]', t('btn_panel'), t('btn_panel_tip'))
    set('[data-sumlabel]', t('sum_label'))
    set('[data-hllabel]', t('hl_label'))
    set('[data-hlhint]', t('hl_hint'))
    set('[data-qalabel]', t('qa_label'))
    set('[data-ask]', t('qa_send'))
    const qin = root.querySelector('[data-qin]'); if (qin) qin.placeholder = t('qa_ph')
  }

  function fillMeta() {
    const ttl = root.querySelector('[data-title]'); if (ttl) { ttl.textContent = cur.title; ttl.title = cur.url || cur.title }
    const meta = root.querySelector('[data-meta]')
    if (meta) {
      meta.textContent = ''
      const parts = [domainOf(cur.url), cur.minutes ? t('minutes', { n: cur.minutes }) : '', cur.saved ? t('saved_on', { d: fmtDay(cur.saved) }) : ''].filter(Boolean)
      const span = document.createElement('span'); span.textContent = parts.join(' · ') + (parts.length ? ' · ' : '')
      const pill = document.createElement('span'); pill.className = 'rf-status-pill'; pill.textContent = statusLabel(cur.status)
      meta.appendChild(span); meta.appendChild(pill)
    }
    const sb = root.querySelector('[data-statusbtn]')
    if (sb) {
      const act = cur.status === 'inbox' ? { label: t('act_start'), next: 'reading', primary: true }
        : cur.status === 'reading' ? { label: t('act_done'), next: 'done', primary: true }
          : cur.status === 'done' ? { label: t('act_back_reading'), next: 'reading', primary: false }
            : { label: t('act_unarchive'), next: 'inbox', primary: false }
      sb.textContent = act.label
      sb.className = 'rf-btn sm' + (act.primary ? ' primary' : '')
      sb.onclick = guard(async () => {
        if (!cur) return
        const path = cur.path, title = cur.title // 快照:updateStatus 期间切文章也只动这一篇
        if (await updateStatus(path, act.next)) {
          if (act.next === 'done') say(t('done_toast', { title }), { level: 'success' })
          if (cur && cur.path === path) await refreshFile()
        }
      })
    }
    const ab = root.querySelector('[data-archivebtn]')
    if (ab) {
      ab.style.display = cur.status === 'archived' ? 'none' : ''
      ab.onclick = guard(async () => {
        if (!cur) return
        const path = cur.path
        if (await updateStatus(path, 'archived')) { say(t('archived_toast'), { level: 'success' }); if (cur && cur.path === path) await refreshFile() }
      })
    }
  }
  function fillBody() {
    const b = root.querySelector('[data-body]'); if (!b) return
    renderMarkdown(b, cur.main || t('body_empty'))
    applyFont()
  }
  function fillSummary() {
    const box = root.querySelector('[data-sum]'), btn = root.querySelector('[data-gensum]')
    if (!box || !btn) return
    const sec = getSection(cur.body, H_SUMMARY)
    if (sec) { renderMarkdown(box, sec); btn.textContent = t('sum_regen') }
    else { box.textContent = t('sum_empty'); btn.textContent = t('sum_gen') }
  }
  function fillHighlights() {
    const box = root.querySelector('[data-hls]'), cnt = root.querySelector('[data-hlcount]')
    if (!box) return
    box.textContent = ''
    const hls = parseHighlights(getSection(cur.body, H_HIGHLIGHT))
    if (cnt) cnt.textContent = hls.length ? t('hl_count', { n: hls.length }) : ''
    if (!hls.length) { const d = document.createElement('div'); d.className = 'rf-muted'; d.style.fontSize = '12px'; d.textContent = t('hl_empty'); box.appendChild(d); return }
    for (const h of hls) {
      const q = document.createElement('div'); q.className = 'rf-hl-quote'; q.textContent = h.quote
      if (h.note) { const n = document.createElement('div'); n.className = 'rf-hl-note'; n.textContent = '— ' + h.note; q.appendChild(n) }
      box.appendChild(q)
    }
  }

  async function genSummary() {
    if (!cur) return
    // 快照三件套(P1 竞态):runAgent/readFile 两个 await 窗口里用户切文章,cur 会被 openPath
    // 改写——不快照的话最坏是把基于 A 全文构造的文本 writeFile 进 B,B 被整体覆盖。
    const path = cur.path, title = cur.title, main = cur.main
    const btn = root.querySelector('[data-gensum]'), box = root.querySelector('[data-sum]')
    const cfg = await getCfg()
    if (!cfg.backendUrl || !cfg.token) { say(cfg.backendUrl ? t('login_first') : t('no_engine'), { level: 'error' }); return }
    if (sumController) sumController.abort()
    sumController = new AbortController(); const sig = sumController.signal
    if (btn) btn.disabled = true
    if (box) box.textContent = t('sum_running')
    try {
      const out = await runAgent(cfg, uuid(), summaryMessage(title, main), (full) => { if (box) box.textContent = full }, sig)
      if (sig.aborted) return // runAgent 已 resolve 后才 abort(切文章)的窄窗:落盘作废
      let txt = null
      try { txt = await ctx.app.readFile(path) } catch { txt = null }
      if (txt == null) throw new Error(t('file_gone'))
      if (sig.aborted) return
      // 摘要里模型自带的 ## 标题先降级,否则被 sectionRange 当节尾拦腰截断
      await ctx.app.writeFile(path, upsertSection(txt, '## AI 摘要', demoteH2(String(out || '').trim())))
      say(t('sum_saved'), { level: 'success' })
      if (cur && cur.path === path) await refreshFile()
    } catch (e) {
      if (!sig.aborted) { if (box) box.textContent = t('sum_fail_inline', { msg: (e && e.message) || String(e) }); say(t('sum_fail_toast'), { level: 'error' }) }
    } finally { if (btn) btn.disabled = false }
  }

  function wireQA() {
    const log = root.querySelector('[data-qalog]'), inp = root.querySelector('[data-qin]'), ask = root.querySelector('[data-ask]')
    if (!log || !inp || !ask) return
    const send = async () => {
      const q = inp.value.trim(); if (!q || !cur) return
      // 快照(P1 同族):getCfg await 期间切文章,cur/qaSessionId 都会被 openPath 改写,
      // 不快照会把旧文章的问题种进新文章的会话
      const title = cur.title, main = cur.main, sessId = qaSessionId
      const cfg = await getCfg()
      if (!cfg.backendUrl || !cfg.token) { say(cfg.backendUrl ? t('login_first') : t('no_engine'), { level: 'error' }); return }
      inp.value = ''
      const u = document.createElement('div'); u.className = 'rf-msg u'; u.textContent = q; log.appendChild(u)
      const a = document.createElement('div'); a.className = 'rf-msg a'; a.textContent = t('qa_thinking'); log.appendChild(a); log.scrollTop = log.scrollHeight
      ask.disabled = true
      if (qaController) qaController.abort()
      qaController = new AbortController(); const sig = qaController.signal
      const msg = qaMessage(title, main, q, qaSeeded)
      try {
        const ans = await runAgent(cfg, sessId, msg, (full) => { a.textContent = full; log.scrollTop = log.scrollHeight }, sig)
        // 首问成功才算种上上下文;失败下次仍带全文重试。abort(切文章)后 qaSessionId 已换新,
        // 绝不能把新会话标成已种
        if (!sig.aborted && qaSessionId === sessId) qaSeeded = true
        renderMarkdown(a, ans || t('qa_no_answer'))
      } catch (e) { if (!sig.aborted) a.textContent = t('qa_failed', { msg: (e && e.message) || String(e) }) } finally { ask.disabled = false }
    }
    ask.addEventListener('click', send)
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } })
  }

  function renderArticle() {
    // 同 library:骨架零人话,文案全由 paintChrome()/fill* 现填
    root.innerHTML = `
<div class="rf-app">
  <div class="rf-hdr">
    <div class="rf-hd-main">
      <div class="rf-hd-title" data-title></div>
      <div class="rf-muted rf-hd-meta" data-meta></div>
    </div>
    <button class="rf-btn ghost sm" data-fminus></button>
    <button class="rf-btn ghost sm" data-fplus></button>
    <button class="rf-btn sm" data-statusbtn></button>
    <button class="rf-btn ghost sm" data-archivebtn></button>
    <button class="rf-btn ghost sm" data-refetch></button>
    <button class="rf-btn ghost sm" data-opennote></button>
    <button class="rf-btn ghost sm" data-sidetoggle></button>
  </div>
  <div class="rf-body">
    <div class="rf-read-wrap"><div class="rf-read rf-out" data-body></div></div>
    <div class="rf-side" data-side>
      <div class="rf-panel" style="padding:11px">
        <div class="rf-sec-hd"><span class="rf-label" data-sumlabel></span><button class="rf-btn sm" data-gensum></button></div>
        <div class="rf-out" data-sum style="font-size:12px;line-height:1.65"></div>
      </div>
      <div class="rf-panel" style="padding:11px">
        <div class="rf-sec-hd"><span class="rf-label" data-hllabel></span><span class="rf-muted" data-hlcount style="font-size:10px"></span></div>
        <div data-hls></div>
        <div class="rf-muted" style="font-size:11px;margin-top:8px" data-hlhint></div>
      </div>
      <div class="rf-panel" style="padding:11px;display:flex;flex-direction:column">
        <div class="rf-sec-hd" style="margin-bottom:6px"><span class="rf-label" data-qalabel></span></div>
        <div class="rf-qa-log" data-qalog></div>
        <div class="rf-row" style="margin-top:8px">
          <input class="rf-input" data-qin style="flex:1;padding:6px 9px;font-size:12px"/>
          <button class="rf-btn primary sm" data-ask></button>
        </div>
      </div>
    </div>
  </div>
</div>`
    const $ = (s) => root.querySelector(s)
    $('[data-fminus]').addEventListener('click', () => { setSetting('fontSize', Math.max(12, fontSize() - 1)); applyFont() })
    $('[data-fplus]').addEventListener('click', () => { setSetting('fontSize', Math.min(28, fontSize() + 1)); applyFont() })
    $('[data-refetch]').addEventListener('click', () => {
      if (!cur) return
      if (!cur.url) { say(t('refetch_no_url'), { level: 'warning' }); return }
      const r = qAdd(cur.url, { force: true })
      if (r.ok) say(t('refetch_queued'), { level: 'success' })
      else say(r.reason === 'in_queue' || r.reason === 'busy' ? t('w_in_queue') : t('refetch_failed'), { level: 'warning' })
    })
    $('[data-opennote]').addEventListener('click', () => { if (cur) openNotePath(cur.path); else say(t('no_open_note'), { level: 'warning' }) })
    $('[data-sidetoggle]').addEventListener('click', () => { const s = $('[data-side]'); if (s) s.classList.toggle('hidden') })
    $('[data-gensum]').addEventListener('click', guard(genSummary))
    paintChrome()
    fillMeta(); fillBody(); fillSummary(); fillHighlights(); wireQA()
  }

  /** 语言变:静态 chrome + 所有派生文案就地重画。问答记录是**内容**,原样留着不动。 */
  function repaintLocale() {
    if (!cur) { renderEmpty(); return }
    paintChrome(); fillMeta(); fillBody(); fillSummary(); fillHighlights()
  }

  const offBus = bus.on((e) => {
    if (e.type === 'open-article' && e.path) { pendingOpen = null; guard(openPath)(e.path) }
    // library 右键改状态也会刷索引:本篇头部状态胶囊/流转按钮必须跟上,否则显示旧状态、
    // 点按钮还按旧 act.next 流转。refreshFile 自带 cur.path 快照守卫,读盘期间切篇安全。
    else if (e.type === 'index' && cur) guard(refreshFile)()
    else if (e.type === 'locale') repaintLocale()
  })
  ensureWorkFolder()
  if (pendingOpen && pendingOpen.path) { const p = pendingOpen; pendingOpen = null; guard(openPath)(p.path) }
  else renderEmpty()

  return () => {
    off(); offBus()
    if (qaController) qaController.abort()
    if (sumController) sumController.abort()
    document.removeEventListener('mousedown', onDocDown, true)
    hideHlBtn(); closeMenus()
  }
}

// ── 注册(id 全按 SPEC 钉死;旧宿主缺席面一律可选链) ─────────────────────────────
// ⚠️ 贡献点标题是**单字符串**,宿主不做运行时重解析:这里取的是**注册当时**的语言,
//    用户切语言后命令面板/视图 tab 标题要等重启才跟上(宿主侧已知缺口,README 有记)。
//    绝不为它做「语言变了就反注册重来」——会打断在飞的抓取队列与已打开的视图。
//    keywords 反而取中英并集,这样任一语言下都搜得到。
ctx.registerView?.({ id: 'library', title: t('view_library'), mount: mountLibrary, singleton: true, workspaceSource: 'library-list' })
ctx.registerView?.({ id: 'reader', title: t('view_reader'), mount: mountReader, singleton: true, workspaceSource: 'library-list' })
ctx.registerCommand({
  id: 'readflow-open', title: t('cmd_open'), keywords: 'readflow read later reading list inbox 稍后读 阅读 文章 收件箱',
  run: () => { if (ctx.openView) ctx.openView('library'); else say(t('no_workbench'), { level: 'warning' }) },
})
// 「添加链接」两处共用一份(命令面板 + 统一左栏顶部按钮);各写一遍必然走岔。
const addByPrompt = guard(async () => {
  const u = await promptStr(t('add_prompt'), '')
  if (!u || !String(u).trim()) return
  const r = qAdd(u)
  if (r.ok) { say(r.retried ? t('add_requeued') : t('add_queued'), { level: 'success' }); if (ctx.openView) ctx.openView('library') }
  else say(r.reason === 'exists' ? t('add_exists') : r.reason === 'in_queue' || r.reason === 'busy' ? t('w_in_queue') : t('w_bad_url'), { level: 'warning' })
})
ctx.registerCommand({
  id: 'readflow-add', title: t('cmd_add'), keywords: 'readflow add url link save 添加 链接 稍后读',
  run: addByPrompt,
})

// ── 统一左栏列表源(宿主 2026-08-25+;可选链,老宿主静默跳过) ─────────────────────
// 稍后读清单交给宿主的统一左栏渲染:与会话/笔记列表同一套行 UI,分组=四个状态档。
// 插件对界面**无状态**:搜索词与选中分组由宿主持有,经 items({query, group}) 回传。
if (ctx.registerListSource) {
  const listSubs = new Set()
  const fireList = () => listSubs.forEach((f) => { try { f() } catch { /* ignore */ } })
  // ⚠️必须能被重新拉起来读一次:插件是在宿主**启动期**装的,那时活动库还没恢复,
  //   ctx.app.readFile 此刻**静默给 null**(见 readIndex 的三分法),idxCache 会定格成空。
  //   宿主挂载列表面 / 切库都会重订阅 → subscribe() 就是重读的门。
  const listReload = () => readIndex().then(fireList, () => { /* 瞬时读失败:保留上次列表,不清屏 */ })
  bus.on((e) => { if (e.type === 'index' || e.type === 'locale') fireList() })
  ctx.registerListSource({
    id: 'library-list',
    title: t('view_library'),
    search: true,
    // idxCache 是 readIndex/writeIndex 维护的同步快照 —— items() 每次渲染都被调,这里绝不读盘。
    items: (f) => {
      const q = ((f && f.query) || '').trim().toLowerCase()
      const g = f && f.group
      return idxCache.items
        .filter((i) => (g == null ? true : i.status === g))
        .filter((i) => !q || String(i.title || '').toLowerCase().includes(q) || String(i.url || '').toLowerCase().includes(q))
        .map((i) => ({
          key: i.path,
          title: i.title || i.url || UNTITLED_TITLE,
          // 日期是语言中立的,不必进词表;分钟数要带单位,那会引入新键,留给 reader 面显示。
          hint: String(i.saved || '').slice(0, 10),
          icon: 'link',
        }))
    },
    // 分组 = 四个状态档(标签现取 t(),跟着宿主语言走);空档不列。
    groups: () => {
      const c = {}
      for (const i of idxCache.items) c[i.status] = (c[i.status] || 0) + 1
      return STATUS_ORDER.filter((s) => c[s]).map((s) => ({ key: s, title: statusLabel(s), count: c[s], icon: 'bookmark' }))
    },
    actions: [{ id: 'add', label: t('cmd_add'), run: () => { addByPrompt() } }],
    itemMenu: (item) => {
      const it = idxCache.items.find((i) => i.path === item.key)
      if (!it) return []
      const acts = []
      const add2 = (id, label, fn) => acts.push({ id, label, run: () => { guard(fn)() } })
      if (it.status !== 'reading') add2('start', t('m_start'), () => updateStatus(it.path, 'reading'))
      if (it.status !== 'done') add2('done', t('m_done'), () => updateStatus(it.path, 'done'))
      if (it.status !== 'archived') add2('archive', t('m_archive'), () => updateStatus(it.path, 'archived'))
      else add2('unarchive', t('m_unarchive'), () => updateStatus(it.path, 'inbox'))
      add2('open-note', t('m_open_note'), () => { openNotePath(it.path) })
      add2('remove', t('m_remove'), () => removeFromIndex(it.path))
      return acts
    },
    subscribe: (cb) => { listSubs.add(cb); void listReload(); return () => listSubs.delete(cb) },
    open: (item) => openArticle(item.key),
  })
}
ctx.registerCommand({
  id: 'readflow-import-clip', title: t('cmd_import'), keywords: 'readflow clip import saves 剪藏 导入 稍后读',
  run: () => { importClips() },
})
sbHandle = ctx.registerStatusItem?.({ id: 'open', side: 'right', text: t('sb_text'), title: t('sb_title'), onClick: () => { if (ctx.openView) ctx.openView('library') } }) || null
readIndex().then(() => refreshStatusItem()).catch(() => { /* ignore */ })

// 语言广播:只报变化,初值各处自己 t()。状态栏能改文案就顺手改,视图靠总线**就地重绘**。
const offLocale = ctx.subscribeLocale?.(() => { refreshStatusItem(); bus.emit({ type: 'locale' }) }) || null

// ── 测试钩子(check.mjs 用;宿主运行时不存在该全局,零开销) ──────────────────────
if (globalThis.__READFLOW_TEST__) {
  Object.assign(globalThis.__READFLOW_TEST__, {
    MSG, L, t, statusLabel, isStatus, buildQueueRow, buildEmptyTip, buildArticleCard, qStateLabel, qErrText,
    STATUS_ORDER, DEFAULT_FOLDER, UNTITLED_TITLE, RESERVED_HEADINGS, H_HIGHLIGHT, H_SUMMARY, // 磁盘契约常量:check 钉死字面值
    slugify, domainOf, ymd, fmtDay, charCount, estimateMinutes, safeHref,
    parseFrontmatter, buildArticleText, setFmField, appendHighlight, upsertSection, getSection, stripSections, parseHighlights,
    demoteH2, neutralizeReservedHeadings, serialIndex, guard, zoomFactor,
    parseArticleBlock, classifyArticle, parseFileListBlock, extractClipMeta,
    fetchMessage, clipListMessage, summaryMessage, qaMessage,
    inline, renderMarkdown, onColorOf, readableOn, contrast,
    queue, qAdd, qRetry, qRemove, qCancel, qClearDone, reviveQueue, persistQueue,
    readIndex, writeIndex, ensureWorkFolder, folderRoot, saveArticle, loadArticle, updateStatus, removeFromIndex, applyClipImport,
    openNotePath,
  })
}

// ── disposer:定时器/监听/在飞任务全部收干净(没人代管) ──────────────────────────
return () => {
  disposed = true // 先立旗:qPump 的 finally 拉下一个 pending 项时被它拦住,队列真停
  if (offLocale) { try { offLocale() } catch { /* ignore */ } } // 语言订阅照退(宿主也会兜底统一收)
  if (globalThis.document && document.removeEventListener) {
    document.removeEventListener('click', onDocClick, true)
    document.removeEventListener('mousedown', onDocArm, true)
  }
  if (sbHandle && sbHandle.dispose) sbHandle.dispose()
  queue.items.forEach((i) => { if (i.controller) i.controller.abort() })
  if (importController) importController.abort()
  persistQueue()
  closeMenus()
  if (_layer) { try { _layer.remove() } catch { /* ignore */ } _layer = null }
}
