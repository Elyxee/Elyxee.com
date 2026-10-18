// The site's views, in one table. The coordinator (site.js) reads paths,
// titles and passages from here; nothing else hard-codes them.
//
//   stage  Home and Portfolio: two live, full-screen scenes on one scroll
//          track (position 0 and 1), joined by the burn passage
//          (stage-passage.js).
//   page   A scrollable page that opens over the stage behind the same fire
//          seam and is left again from its top (page-passage.js). It loads
//          on first use. About is one; another page view (a blog, contact…)
//          is another row here plus its own mount module.
//
// `below` names the page view that a scroll past the end of the stage opens.
// `click` is the timing a nav click uses to reach a stage view. `title` is the
// tab title: one string, or one per scene for a view that has several (keyed
// by the scene's name); without one the tab keeps the page's own title.
export const VIEWS = Object.freeze([
  Object.freeze({
    id: 'home', path: '/', passage: 'stage', position: 0, title: 'Elyxee, Undeniable',
    click: Object.freeze({ omega: 2.7 }),
  }),
  Object.freeze({
    id: 'portfolio', path: '/portfolio', passage: 'stage', position: 1, below: 'about',
    title: Object.freeze({ space: 'Elyxee, Blog & Talks', dust: 'Elyxee, Essay & Podcasts' }),
    // Home's Portfolio click adopts About's deliberate, symmetric timing.
    click: Object.freeze({ durationMs: 3200 }),
  }),
  Object.freeze({
    id: 'about', path: '/about', passage: 'page', title: 'Elyxee, Contact', label: 'About Elyxee',
    load: () => import('../about/mount.js').then(module => module.mountAbout),
  }),
]);

export const viewById = id => VIEWS.find(view => view.id === id) ?? null;

/** The stage view whose `below` opens this page view, or Home. */
export const viewAbove = id => VIEWS.find(view => view.below === id)?.id ?? 'home';

/**
 * What a navigation request should do, given the page passage that is
 * currently active ({ id, settled }, or null). `via` is 'click', 'key' or
 * 'history'; history navigation never records a new entry and lands on stage
 * views without a passage, as the browser's own Back would.
 */
export function planNavigation(to, { page = null, via = 'click' } = {}) {
  const view = viewById(to);
  if (!view) return { action: 'none' };
  const record = via !== 'history';
  if (view.passage === 'page') return { action: 'open', page: view.id, record };
  if (page) return page.settled ? { action: 'leave', page: page.id, to: view.id, record } : { action: 'none' };
  if (via === 'history') return { action: 'jump', position: view.position };
  return { action: 'goto', position: view.position, timing: via === 'click' ? view.click : undefined };
}
