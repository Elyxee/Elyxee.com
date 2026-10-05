import { ABOUT_CONTENT } from './content.js?v=2';
import { mountPortraitLight } from './lighting.js';

let instance = 0;
const clamp = value => Math.max(0, Math.min(1, value));

/**
 * Mount independently, or inside a host site section.
 * onSubscribe(email, { signal }) must resolve only after the backend accepts it.
 * onNavigate({ destination, href, event }) may return false to prevent navigation.
 * scrollRoot accepts window or an overflow scroll element; external hosts can
 * disable observeScroll and drive setProgress(0..1) themselves.
 */
export function mountAbout({ root, content = {}, onSubscribe, onNavigate,
  lighting = true, scrollRoot = window, observeScroll = true } = {}) {
  if (!(root instanceof HTMLElement)) throw new TypeError('mountAbout requires a root element');
  const data = { ...ABOUT_CONTENT, ...content };
  const id = `elyxee-about-${++instance}`;
  const controller = new AbortController();
  const { signal } = controller;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const page = document.createElement('div');
  page.className = 'about';
  page.dataset.active = 'true';
  page.innerHTML = `
    <div class="about-scene" aria-hidden="true"><img class="about-scene__texture" alt="" /><div class="about-scene__shade"></div><div class="about-scene__light"></div></div>
    <section class="about-hero" aria-labelledby="${id}-title">
      <header class="about-header">
        <a class="about-brand" data-home aria-label="Elyxee home"></a>
      </header>
      <h1 class="about-sr-only" id="${id}-title"></h1>
      <div class="about-hero__title" aria-hidden="true"><div class="about-marquee"><span></span><span></span></div></div>
      <div class="about-hero__person"><div class="about-hero__photo"><img alt="Eliyah in a black suit, holding an open book in front of his face" fetchpriority="high" draggable="false" /></div></div>
    </section>
    <section class="about-story" id="${id}-story" aria-labelledby="${id}-heading">
      <div class="about-story__inner">
        <div class="about-story__grid">
          <figure class="about-portrait"><div class="about-portrait__frame"><img alt="Black-and-white seated portrait of Eliyah" loading="lazy" /></div></figure>
          <div class="about-story__copy">
            <h2 class="about-sr-only" id="${id}-heading">About</h2>
            <div class="about-story__paragraphs"></div>
            <form class="about-newsletter" aria-labelledby="${id}-newsletter">
              <h3 class="about-sr-only" id="${id}-newsletter">Subscribe</h3>
              <label class="about-sr-only" for="${id}-email">Your email address</label>
              <div class="about-newsletter__field"><input id="${id}-email" type="email" name="email" autocomplete="email" placeholder="Your email address" required maxlength="254" aria-describedby="${id}-status" /><button type="submit">Subscribe</button></div>
              <p class="about-newsletter__status" id="${id}-status" role="status" aria-live="polite"></p>
            </form>
          </div>
        </div>
        <footer class="about-footer"><a class="about-contact"><span>Contact me</span><span class="about-contact__email"></span></a></footer>
      </div>
    </section>`;

  page.querySelectorAll('[data-copy]').forEach(node => { node.textContent = data[node.dataset.copy] ?? ''; });
  page.querySelectorAll('.about-brand').forEach(node => { node.textContent = data.brand; });
  page.querySelector('h1').textContent = data.title;
  page.querySelectorAll('.about-marquee span').forEach(node => { node.textContent = data.title; });
  page.querySelector('.about-hero__person img').src = data.heroSrc;
  const crop = content.heroSrc && !Object.hasOwn(content, 'heroCrop') ? null : data.heroCrop;
  if (crop) {
    const photo = page.querySelector('.about-hero__photo');
    const img = photo.querySelector('img');
    photo.style.aspectRatio = `${crop.width} / ${crop.height}`;
    if (crop.layoutWidth) {
      const scale = crop.width / crop.layoutWidth;
      photo.style.width = `${scale * 100}%`;
      photo.parentElement.style.setProperty('--about-photo-right', String(scale - .5));
    }
    img.style.width = `${crop.sourceWidth / crop.width * 100}%`;
    img.style.height = `${crop.sourceHeight / crop.height * 100}%`;
    img.style.left = `${-crop.x / crop.width * 100}%`;
    img.style.top = `${-crop.y / crop.height * 100}%`;
  }
  page.querySelector('.about-portrait img').src = data.portraitSrc;
  page.querySelector('.about-scene__texture').src = data.textureSrc;
  page.querySelector('.about-contact__email').textContent = data.email;
  page.querySelector('.about-contact').href = `mailto:${data.email}`;
  for (const paragraph of data.paragraphs) {
    const p = document.createElement('p');
    p.textContent = paragraph;
    page.querySelector('.about-story__paragraphs').append(p);
  }
  page.querySelectorAll('[data-home]').forEach(link => {
    link.href = data.homeHref;
    link.addEventListener('click', event => {
      if (onNavigate?.({ destination: 'home', href: link.href, event }) === false) event.preventDefault();
    }, { signal });
  });
  root.append(page);
  const light = lighting ? mountPortraitLight(page) : null;
  const hero = page.querySelector('.about-hero');
  const story = page.querySelector('.about-story');
  let active = true, destroyed = false, frame = 0, pending = false;
  let lastProgress = 0;
  function setProgress(value) {
    lastProgress = Number.isFinite(value) ? clamp(value) : 0;
    const p = reduced.matches ? 0 : lastProgress;
    page.style.setProperty('--about-travel', `${p * 110}px`);
    page.style.setProperty('--about-title-opacity', `${1 - p * 0.7}`);
  }
  function render() {
    frame = 0;
    if (!active || destroyed) return;
    const top = scrollRoot === window ? 0 : scrollRoot.getBoundingClientRect().top;
    const bounds = hero.getBoundingClientRect();
    page.style.setProperty('--about-hero-height', `${bounds.height}px`);
    setProgress((top - bounds.top) / Math.max(1, bounds.height));
  }
  function schedule() {
    if (!frame && active && !destroyed) frame = requestAnimationFrame(render);
  }
  if (observeScroll) {
    scrollRoot.addEventListener('scroll', schedule, { signal, passive: true });
    window.addEventListener('resize', schedule, { signal, passive: true });
  }
  reduced.addEventListener('change', () => setProgress(lastProgress), { signal });
  const resize = observeScroll ? new ResizeObserver(schedule) : null;
  resize?.observe(hero);
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      story.classList.add('is-revealed');
      observer.unobserve(story);
    }
  }, { root: scrollRoot === window ? null : scrollRoot, threshold: 0.12 });
  story.classList.add('about-story--reveal');
  observer.observe(story);
  const form = page.querySelector('form');
  const input = form.querySelector('input');
  const button = form.querySelector('button');
  const status = form.querySelector('[role="status"]');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || !form.reportValidity()) return;
    if (typeof onSubscribe !== 'function') {
      status.textContent = 'Subscriptions are not open yet. You can reach me by email below.';
      return;
    }
    pending = true;
    button.disabled = true;
    form.setAttribute('aria-busy', 'true');
    status.textContent = 'Sending…';
    try {
      await onSubscribe(input.value.trim(), { signal });
      if (!destroyed) {
        status.textContent = 'You’re on the list. Thank you for being here.';
        form.reset();
      }
    } catch (error) {
      if (!destroyed && error?.name !== 'AbortError') status.textContent = 'That didn’t go through. Please try again, or email me below.';
    } finally {
      pending = false;
      if (!destroyed) { button.disabled = false; form.removeAttribute('aria-busy'); }
    }
  }, { signal });
  if (observeScroll) schedule();
  return {
    root: page,
    setProgress,
    setLightPosition: position => light?.setPosition(position),
    setActive(value) {
      active = !!value;
      page.dataset.active = String(active);
      light?.setActive(active);
      if (active && observeScroll) schedule();
      else { cancelAnimationFrame(frame); frame = 0; }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      controller.abort();
      cancelAnimationFrame(frame);
      observer.disconnect();
      resize?.disconnect();
      light?.destroy();
      page.remove();
    },
  };
}
