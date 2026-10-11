import { VIEWS } from './views.js';

// The address bar mirrors the current view: one path per view, Home at the
// site root. This is the only module that reads or writes the URL.

export function pathFor(id, views = VIEWS) {
  return views.find(view => view.id === id)?.path ?? '/';
}

export function viewFromPath(pathname, views = VIEWS) {
  const path = pathname.replace(/\/+$/, '') || '/';
  return views.find(view => view.path === path)?.id ?? 'home';
}

/**
 * Normalizes the entry URL and reports Back/Forward as `onNavigate(viewId)`.
 * A fresh load always plays the opening on Home, so a /portfolio or /about
 * address (or an older ?view= link) is replaced by the root; in-document
 * history still revisits views.
 */
export function createRouter({ onNavigate, win = window, views = VIEWS }) {
  const { history, location } = win;
  const entry = new URL(location.href);
  if (entry.pathname !== '/' || entry.searchParams.has('view')) {
    entry.pathname = '/';
    entry.searchParams.delete('view');
    history.replaceState({ view: 'home' }, '', entry);
  }
  const onPopState = () => onNavigate(viewFromPath(location.pathname, views));
  win.addEventListener('popstate', onPopState);
  return {
    /** Adds a history entry for the view, unless the address already shows it. */
    record(id) {
      const url = new URL(pathFor(id, views), location.href);
      if (url.href !== location.href) history.pushState({ view: id }, '', url);
    },
    destroy() { win.removeEventListener('popstate', onPopState); },
  };
}
