# 定档与整理记录 · 2026-10-05

## 恢复点

清理前完整工作状态保存在本地 Git 提交 `3af42f9`。旧图片、原始人物照片、预览页面和测试都在历史中可恢复；当前工作目录只保留最终完整版。没有推送或部署。

恢复某个旧文件时，先确认用途，再从该提交提取所需路径；不要整体回滚覆盖当前工作。也有一份临时保险副本 `/tmp/elyxee-before-final-cleanup-2026-10-05.tar.gz`，长期恢复以 Git 历史为准。

## 本次变更范围

- Favicon 指向指定的 `Assets/Elements/Favicon #1.PNG`，原始图片字节不变。
- `index.html` 的 About 链接由 `about.html` 改成 `#about`；`site.js` 对应选择器同步修改，原点击处理函数及转场不变。更新一条关于旧预览入口的 HTML 注释。
- 删除旧入口 `about.html / portrait.html`、仅供它们使用的启动脚本、未使用的 About 自定义光标，以及调试 HTML。
- 删除没有被最终站点引用的素材；字体许可保留。运行中所有资源的名称和路径保持不变。
- 文档集中到 `docs/`，有效的行为测试集中到 `tests/`。开发文件由 `.assetsignore` 排除，不作为网页静态资源发布。
- 没有调整人物、画框、字体、布局、CSS、shader、动画参数、滚动规则或光标效果。

## 定档校验

`frozen-files.json` 记录 84 个运行文件与素材的 SHA-256。其中 82 个与清理前完全一致；仅上面列出的 `index.html` 和 `components/site/site.js` 有变化。校验器 `scripts/check-freeze.mjs` 会报告内容变化、缺失文件、新增未记录文件及额外根 HTML 入口。

这份清单冻结当前文件，不说明所有模块已统一生命周期，也不能替代浏览器交互检查。接口现状和后续边界见 [interfaces.md](interfaces.md)。

## 检查记录

- 整理前运行已有测试：47 项通过；一项旧 shader 与历史提交 `c90860d` 的文本比较已失败。该检查固定的是过时实现，故移除；没有为迎合旧检查回改当前视觉。
- 整理后保留的 47 项行为测试全部通过，涵盖手势进度与反向取消、惯性尾部、画框序列/滚动/命中、作品链接及文字余烬。
- 84 个定档文件的校验通过。
- 桌面 Chromium 1280 × 820：带旧 `view=about` 参数仍加载至 Home；Portfolio → About 滚动可推进、反向撤回和惯性完成；About 返回可撤回；Dust 标志位于右上角；点击 About 保持自动 3.2 秒转场；About 刷新返回 Home。无 JavaScript 错误，无失败资源响应。
- 移动 Chromium 390 × 844：触摸可停住、反向撤回、松手归位；About 原生内容滚动和顶部返回 Portfolio 通过。无 JavaScript 错误。
- Favicon 的编码路径返回 HTTP 200 / `image/png`；使用的图片与指定原文件校验值一致。
- 所有静态本地引用及 7 张动态命名画作均存在；运行 JS 语法检查通过。

## 移除清单

共移除 45 个文件（含 8 个 Finder 缓存文件），约 50.3 MiB；原文件保存在恢复点。非缓存文件如下：

- `about.html`
- `portrait.html`
- `components/about/index.js`
- `components/portrait/index.js`
- `components/about/cursor.js`
- `components/burn/preview.html`
- `tests/recovery-visual.test.mjs`
- `tests/burn-composite.html`
- `tests/burn-lifecycle.html`
- `tests/burn-scene.html`
- `tests/portrait-artworks.html`
- `tests/burn-icons.html`
- `tests/burn-handoff.html`
- `tests/burn-typography.html`
- `Assets/background/Fire.jpg`
- `Assets/Frame/中世纪鎏金画框.png`
- `Assets/Frame/冰相框 竖.png`
- `Assets/Frame/中世纪宝石画框.png`
- `Assets/Frame/日式相框 竖.png`
- `Assets/Frame/中世纪宝石竖.png`
- `Assets/Frame/欧式雕花装饰边框.png`
- `Assets/Frame/复古木质相框竖.png`
- `Assets/Frame/日式画框.png`
- `Assets/Frame/银框 竖屏.png`
- `Assets/Frame/中式相框竖.png`
- `Assets/Frame/中世纪鎏金竖.png`
- `Assets/Frame/火焰相框 竖.png`
- `Assets/About/reading-retouched.png`
- `Assets/About/reading-original.png`
- `Assets/About/reading.png`
- `Assets/Head/Original.png`
- `Assets/Head/冰 正面.png`
- `Assets/Head/冰 仰头.png`
- `Assets/Head/Dune.png`
- `Assets/Elements/Favicon.png`
- `Assets/Font/narri-regular.otf`
- `Assets/Font/narri-regular.woff`

## 集中归档

- `components/about/README.md` → `docs/about.md`
- `components/portrait/README.md` → `docs/portrait.md`
- `Assets/About/image-prompts.md` → `docs/image-provenance.md`
- `Assets/Transitions/README.md` → `docs/transition-material.md`
- `components/site/depth-lens.test.mjs` → `tests/site/depth-lens.test.mjs`
- `components/site/transition-motion.test.mjs` → `tests/site/transition-motion.test.mjs`
- `components/portrait/gallery-scroll.test.mjs` → `tests/portrait/gallery-scroll.test.mjs`
- `components/portrait/gallery-region.test.mjs` → `tests/portrait/gallery-region.test.mjs`
- `components/portrait/gallery-interaction.test.mjs` → `tests/portrait/gallery-interaction.test.mjs`
- `components/portrait/gallery-sequence.test.mjs` → `tests/portrait/gallery-sequence.test.mjs`
- `tests/typography-embers.test.mjs` → `tests/burn/typography-embers.test.mjs`
