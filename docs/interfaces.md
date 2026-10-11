# 架构与模块接口

2026-10-11 整理后的结构。画面、动画时间、输入手感都没有改变；改的是"连接"部分：现在只有一个调度器，用一张界面表、一个统一的界面约定和一条火线来管理三个界面。

## 总览

```text
index.html                     唯一页面；import map 由脚本生成
components/site/
  site.js          调度器      开场、当前界面、谁接收输入、导航、地址栏何时更新
  views.js         界面表      每个界面的路径、标题、进出方式；导航决策 planNavigation()
  router.js        地址栏      唯一读写网址的模块
  scenes.js        界面约定    把各模块的 API 统一成 load / setVisible / setActive / destroy
  stage-passage.js 舞台转场    Home ↔ Portfolio：一个 0→1 进度、一条上升的火线
  page-passage.js  页面转场    页面界面（About）在舞台之上打开、从顶部离开
  fire-curtain.js  火线        全站一条；页面转场时升到页面图层之上
components/burn/ cursor/ portrait/ about/   各界面自己的效果，调度器从不伸手进去
```

依赖方向只有一个：`site.js` 使用其余模块；转场与界面模块彼此不知道对方，也不碰网址、标题或别的图层，只通过回调告诉调度器发生了什么。

## 界面表 `views.js`

```js
{ id: 'home',      path: '/',          passage: 'stage', position: 0, click: { omega: 2.7 } }
{ id: 'portfolio', path: '/portfolio', passage: 'stage', position: 1, below: 'about', click: { durationMs: 3200 } }
{ id: 'about',     path: '/about',     passage: 'page',  title, label, load: () => import(...) }
```

- `stage`：全屏、实时的场景，处在同一条滚动轨道上（位置 0 和 1），由舞台转场连接。
- `page`：可以往下读的页面，盖在舞台之上，第一次需要时才加载（`load()` 返回挂载函数）。
- `below`：从舞台末端继续往下滚 / 往上划时打开的页面界面。
- `click`：导航点击到达舞台界面时使用的时序。

`planNavigation(to, { page, via })` 是纯函数，决定一次导航该做什么：打开页面、离开页面、沿舞台移动，或（浏览器前进后退时）直接落到舞台界面。点击、键盘、链接、前进后退都经过它，测试见 `tests/site/views.test.mjs`。

## 界面约定 `scenes.js`

调度器管理的每个界面都提供同一组接口：

| 接口 | 含义 |
| --- | --- |
| `layer` | 界面所在的全屏图层 |
| `load()` | 首次调用时挂载（重复调用无副作用），可以显示时 resolve |
| `setVisible(on)` | 被完全盖住时传 `false`：保留自己的时钟和状态，只停止绘制 |
| `setActive(on)` | 是否接收鼠标、触摸与键盘输入（图层 `inert` / `aria-hidden`） |
| `destroy()` | 卸载 |

三个适配器只做翻译，不改效果：Home 对应 `burn.pause/resume/setPointerActive`；Portfolio 对应 `mountPortrait` 与 `effect.setVisible`，接收输入时补发一个指针事件，让人像的光标从当前位置开始；页面界面创建自己的图层（`.page-layer[data-view]`），把挂载函数的 `setActive` 当作显隐。

## 调度器的规则 `site.js`

- **当前界面**：转场停稳时更新。舞台界面在进度到达两端附近（`data-stage` 为 `burn` / `portrait`）时停稳；页面界面由页面转场通知。
- **地址栏**：每次停稳到新界面就记录一条历史（`/`、`/portfolio`、`/about`），所以点击、滚轮、触摸、键盘都会更新网址，前进后退能逐个界面退。前进后退本身不再新增记录。任何地址刷新后都回到 Home 并播放开场。
- **谁接收输入**：开场期间和舞台上，Home 与 Portfolio 在火线经过中点时交接；页面转场运行期间没有人接收，直到页面停稳。Home 的鼠标监听只在 Home 拥有输入时才能收到移动（`site.js` 最先注册的指针闸门）。
- **显隐**：被完全盖住的舞台界面停止绘制（Home 在 Portfolio 或页面之下，Portfolio 在 Home 或页面之下）。
- **输入路由**：页面转场在舞台之前注册自己的滚轮与触摸监听，运行时先拿到手势；舞台末端的空白处往下滚、往上划，交给 `below` 指定的页面。画框附近的手势留给画廊。

## 两种转场

`createStagePassage(...)` 提供 `position / input`、`goTo / jump / scroll / drag / hold / release / ownsTail`、`update(now, elapsed)` 与 `render(dt, { intro, curtainBusy, cold })`。开场期间调度器用 `setPosition()` 直接驱动进度。拉远、裁切、到达位移和光标交接颗粒都在这里。

`createPagePassage({ view, scene, above, curtain, showUnder, canNavigate, onChange, onSettle })` 提供 `active / settled / preload / open / leave / scrollFrom / dragFrom / destroy`。点击使用固定的 3.2 秒对称时间线；滚轮与触摸使用和舞台相同的弹簧、惯性、反向与可见面积判定。它只在 `onChange()`（任何阶段变化）和 `onSettle(viewId, record)`（到达页面，或回到舞台）时通知调度器，需要回到舞台时调用 `showUnder(viewId)` 让目标先在下面就位。

两者共用 `createTransitionMotion({ travel })` 与 `transition-front.js` 的火线几何。点击与手势是两种驱动方式，不能为了统一接口把拖动改成固定时长。

## 以后怎么加东西

**加一个页面界面（例如 Blog、Contact）**

1. 写它自己的挂载模块，例如 `components/blog/mount.js`，导出 `mountBlog({ root, scrollRoot, onNavigate })`，返回 `{ ready, setActive, destroy }`。`ready` 在字体和图片可以绘制时 resolve；`onNavigate({ destination, event })` 返回 `false` 表示由站点处理导航。
2. 在 `views.js` 加一行：`{ id: 'blog', path: '/blog', passage: 'page', title, label, load: () => import('../blog/mount.js').then(m => m.mountBlog) }`。
3. 在导航里加一个 `<a href="/blog">`。点击、悬停预加载、火线转场、网址、前进后退、输入归属都会自动生效。
4. 如果它的样式需要单独的文件，在 `index.html` 加 `<link>`，然后运行 `node scripts/stamp-versions.mjs`。

**在某个界面里加效果**：只改那个模块，并让它在 `setVisible(false)` 时不绘制。**加作品或视频**：改 `components/portrait/artworks.js` 的数据。

当前限制：舞台只有两格（Home、Portfolio），它的转场是为这两个场景专门设计的；页面界面之间还不能直接滚动切换。需要时在调度器和 `views.js` 里扩展，而不是复制一套新系统。

## 各模块已有接口

### Home / Burn

```js
const burn = initBurn({ canvas, fireSrc, iceSrc, settings, autoPointer });
await burn.ready;          // 图片已解码、上传，且完整首帧已绘制；失败会 reject
burn.pause(); burn.resume(); burn.reset();
burn.setPointer(x, y);     // viewport CSS pixels
burn.setPointerActive(true);
burn.getState();           // 已采样状态，不额外读取 GPU
burn.destroy();
```

无 WebGL 时只保证 `canvas / ready / supported: false / destroy()`。`initBurnTypography({ settings, selector, artwork, tinted, measureRect })` 返回 Promise，结果提供 `destroy / getState`。`initCursor()` 的 `destroy()` 只隐藏光标，主站只初始化一次。

### Portfolio / Portrait

```js
const portrait = await mountPortrait({ root, scene: 1, onHome });
portrait.effect?.switchScene(0);                       // 0 Dust，1 Space
portrait.effect?.isGalleryScrollRegion(clientX, clientY);
portrait.effect?.setVisible(false);                   // 被盖住时只推进状态，不绘制
portrait.destroy();
```

WebGL 失败时 `effect` 为空，静态回退仍可切换 Space / Dust。画作数据在 `artworks.js`，画框在 `gallery-items.js`。

### About

`mountAbout({ root, content, onSubscribe, onNavigate, lighting, scrollRoot, observeScroll })` 返回 `root / ready / setProgress / setLightPosition / setActive / destroy`。`onSubscribe(email, { signal })` 是真实订阅服务的接入位置，目前未连接后端。

### 火线

`createFireCurtain({ dprCap })` 返回 `element / ready / supported / visible / state / set / render / resize / destroy`。全站只有一个实例：舞台转场每帧驱动它；页面转场运行时舞台不再绘制它，CSS（`html[data-page-passage] #stage-fire`）把它升到页面图层之上。

## 配置位置

| 需要调整的内容 | 入口 |
| --- | --- |
| 界面的路径、标题、点击时序、下方页面 | `components/site/views.js` → `VIEWS` |
| 开场时长 | `components/site/site.js` → `OPENING` |
| Home ↔ Portfolio 拉远与滚动距离 | `components/site/stage-passage.js` → `STAGE` |
| 手势进度与回弹 | `components/site/transition-motion.js` |
| 页面点击转场时长 | `components/site/page-passage.js` 中 `duration` |
| Home 燃烧、恢复、光标冷热切换 | `components/burn/burn.js` → `BURN_SETTINGS` |
| Space / Dust 光标、水波、切换时长 | `components/portrait/settings.js` → `PORTRAIT_SETTINGS` |
| 画框、序列、滚动 | `gallery-items.js`、`gallery-sequence.js`、`gallery-scroll.js` |
| 作品图和目标链接 | `components/portrait/artworks.js` |
| About 文案、图片、裁切 | `components/about/content.js` → `ABOUT_CONTENT` |

## 版本号与检查

- 模块的 import 语句保持干净（`./burn.js`），不写 `?v=`。`index.html` 里的 import map 给每个模块按内容生成版本号，样式表链接和入口脚本也一样。改完任何模块或样式后运行 `node scripts/stamp-versions.mjs`；忘记运行时 `tests/site/versions.test.mjs` 会失败。
- `node --test tests/burn/*.test.mjs tests/portrait/*.test.mjs tests/site/*.test.mjs`：单元测试，包括地址栏、界面表、导航决策、素材引用和版本号。
- `node scripts/check-site.mjs`（需要 Chrome，可加 `--headed` 观看、`--shots 目录` 截图）：在真实浏览器里走一遍所有进出方式，逐步核对网址、界面和报错。

## 仍然存在的共享协议

- CSS 依赖 `html[data-stage]`（`intro / burn / transit / portrait / about`）、`html[data-burn-phase]`、`html[data-page-passage]`；文字材质观察 `data-burn-phase`。改动前检查 `site / burn / cursor / portrait` 的 CSS。
- Home 图层沿用浏览器默认的触摸行为：在 Home 上竖向滑动会被浏览器当作页面手势取消，触摸设备在 Home 用导航进入 Portfolio。Portfolio 与页面图层自己处理触摸。
- Burn 与光标没有完整的卸载协议（只初始化一次）。
