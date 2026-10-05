# 模块接口与扩展边界

以下是 2026-10-05 源码核对结果。本次整理保留现有实现，没有新增一套抽象控制器，也没有改变 shader、动画时间、输入手感、人物或图层。

## 场景由谁协调

`components/site/site.js` 是当前协调入口：初始化 Home，按需挂载 Portrait，管理开场、Home ↔ Portfolio 的进度、输入归属、光标交接和导航。`page-passage.js` 负责 About 的挂载与进出。它们复用 `transition-motion.js`、`transition-front.js` 和 `fire-curtain.js`。

不要从新场景直接修改 Burn 或 Portrait 的内部变量、WebGL 纹理或动画循环。新场景先提供自己的挂载函数与小接口，由协调层连接。现在还不能仅“注册场景”就任意切换；未来增加场景需要在协调层接入，其余效果模块应尽量保持不变。

## 已有接口

### Home / Burn

从 `components/burn/index.js` 导出 `initBurn` 和 `BURN_SETTINGS`：

```js
const burn = initBurn({ canvas, fireSrc, iceSrc, settings, autoPointer });
// WebGL 可用时：
burn.pause();
burn.resume();
burn.reset();
burn.setPointer(x, y);      // viewport CSS pixels
burn.setPointerActive(true);
burn.getState();            // 已采样状态，不额外读取 GPU
burn.destroy();
```

`settings` 合并默认配置；`autoPointer: false` 由宿主供给指针。返回对象还暴露 `canvas / gl / settings / supported`，新模块应避免操作其中的 GL 和内部渲染资源。无 WebGL 时仅保证 `canvas / supported: false / destroy()`，调用生命周期前要判断支持情况。

### Portfolio / Portrait

`mountPortrait({ root, scene = 1, onHome })` 位于 `components/portrait/mount.js`，返回 Promise。`0` 是 Dust，`1` 是 Space。

```js
const portrait = await mountPortrait({ root, scene: 1, onHome });
portrait.scene;
await portrait.effect?.switchScene(0);
portrait.effect?.isGalleryScrollRegion(clientX, clientY);
portrait.destroy();
```

`isGalleryScrollRegion` 用于决定手势应移动画框还是切换页面。`onHome` 由宿主处理返回首页；组件不应该自行修改别的场景。WebGL 失败时 `effect` 可能为空，现有静态回退仍可切换 Space / Dust。

现有 Portrait 没有公共 `pause / resume / enter / exit` 方法。当前实现一次挂载后复用，通过宿主状态管理输入；不要写调用不存在的方法的通用适配器。`destroy()` 不是重新挂载整个宿主 DOM 的完整协议，未来如需频繁销毁/重建，应先补充相应的生命周期验证。

画作数据在 `artworks.js` 的 `DUST_ARTWORKS / SPACE_ARTWORKS`，画框数据在 `gallery-items.js`。现有交互是第一次点击选中，再点同一作品打开链接；序列有独立条目 ID。`createGallery` 的 `contentByScene` 接口已存在，但现有封面映射和链接使用 `artworks.js`；它还不是无需接线的 CMS 接口。

### About

`mountAbout({ root, content, onSubscribe, onNavigate, lighting, scrollRoot, observeScroll })` 位于 `components/about/mount.js`。

- `content` 覆盖 `content.js` 默认内容与图片配置。
- `onNavigate({ destination, href, event })` 返回 `false` 时取消浏览器默认导航，由宿主处理。
- `onSubscribe(email, { signal })` 是真实订阅服务的接入位置。当前没有连接后端，保留原来的未开放反馈；不要假装提交成功。
- 返回 `root / setProgress / setLightPosition / setActive / destroy`。`setActive(false)` 暂停组件效果；显隐与 `inert` 仍由宿主管理。
- 外部驱动滚动时传 `observeScroll: false`，用 `setProgress(0..1)`。当前主站以 About 层作为 `scrollRoot`，保留内部自然滚动。

### 共享转场

`createTransitionMotion({ travel = 620 })` 提供 `scroll / hold / drag / release / goTo / update / ownsTail`，并暴露只读 `position / input / velocity / destination`。`update(now, elapsed, reduced, visibleShare)` 中 `now` 为毫秒，`elapsed` 为秒。点击导航与手势是两种驱动方式，不能为了统一接口把拖动改成固定时长播放。

`createFireCurtain({ dprCap })` 返回 `element / ready / supported / visible / state / set / render / resize / destroy`。宿主用 `set(...)` 传入火线和开场状态，用 `render(time)` 绘制；`time` 为秒。几何与遮罩规则在 `transition-front.js`。这是共享渲染接口，还没有通用的 `transition.play({ from, to })` 场景路由 API。

`createAboutPassage({ link, prepareDestination, onOwnershipChange, canNavigate })` 提供 `active / settled / preload / open / scrollFromPortrait / dragFromPortrait / syncHomeRoute / destroy`。`prepareDestination` 决定转场下面的目标场景；`onOwnershipChange` 交接输入，不要让两个场景同时响应同一个手势。

### Cursor 和文字

`initCursor({ root, canvas })` 是当前 Home 光标入口。当前没有 `setMode()`，其 `destroy()` 只隐藏光标，尚未取消所有全局事件和动画循环。因此主站只初始化一次，不能当成可反复挂载的通用光标服务。

`initBurnTypography({ settings, selector, artwork, tinted, measureRect })` 返回 Promise，结果提供 `destroy / getState`。共享转场的 `createCursorHandoff()` 提供 `setPointer / burst / update / render / destroy`，只管理交接粒子。

## 配置位置

| 需要调整的内容 | 当前入口 |
| --- | --- |
| Home 燃烧、恢复、光标冷热切换 | `components/burn/burn.js` → `BURN_SETTINGS`；支持初始化注入 |
| Space / Dust 光标、水波、切换时长 | `components/portrait/settings.js` → `PORTRAIT_SETTINGS` |
| 人像构图坐标 | 同文件 `COMPOSITION` |
| 画框位置、材质与序列 | `gallery-items.js`、`gallery-sequence.js` |
| 画框滚动阻尼与速度 | `gallery-scroll.js` |
| 作品图和目标链接 | `artworks.js` |
| About 文案、图片、裁切 | `components/about/content.js` → `ABOUT_CONTENT`；支持覆盖 |
| Home ↔ Portfolio 开场与拉远 | `components/site/site.js` → `STAGE` |
| 手势进度与回弹 | `components/site/transition-motion.js` |
| About 点击转场时长 | `components/site/page-passage.js` 中 `duration` |
| 布局、字体、层级 | 根 `styles.css` 与各组件 CSS |

并非所有参数都能注入：Portrait 设置是导入的常量，部分氛围与光标参数仍在实现内部。此表标明实际入口，不代表已完成全面配置化。

## 现存耦合与未来规则

现有 `data-stage / data-burn-phase / data-page-passage`、CSS 类名、DOM 选择器、全局指针拦截与图层 `inert` 仍是共享协议。文字材质会观察 Burn 的阶段；Portrait 的显隐与跨场景输入交接依赖宿主设置的图层状态。改这些协议前必须检查 `site / burn / cursor / portrait` 的使用者。

以后新增模块时遵守：内部状态私有；自己创建的事件/动画/GPU 资源由自己清理；导航通过回调交给协调层；可变内容和常调参数优先传入配置；不从模块内部扫描或修改别的场景。若需要统一生命周期，先在协调层做小适配，并验证现有鼠标、滚动、触摸和回退行为，再逐步替换旧协议。不要为尚不存在的功能引入工厂、注册器或一整套插件框架。
