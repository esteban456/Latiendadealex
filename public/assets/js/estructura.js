// Estructura tipo tienda: barra de anuncios rotativa y marquee continuo.
(function () {
  'use strict';

  function initAnnounceBar() {
    const bar = document.querySelector('[data-announce-bar]');
    if (!bar) return;

    const slides = Array.from(bar.querySelectorAll('[data-announce-slide]'));
    const dots = Array.from(bar.querySelectorAll('[data-announce-dot]'));
    if (slides.length < 2) return;

    const INTERVAL = 4000;
    let index = 0;
    let timer = null;

    const show = (next) => {
      index = (next + slides.length) % slides.length;
      slides.forEach((slide, i) => slide.classList.toggle('is-active', i === index));
      dots.forEach((dot, i) => dot.classList.toggle('is-active', i === index));
    };

    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    const start = () => {
      stop();
      timer = setInterval(() => show(index + 1), INTERVAL);
    };

    bar.querySelectorAll('[data-announce-next]').forEach((button) => {
      button.addEventListener('click', () => { show(index + 1); start(); });
    });
    bar.querySelectorAll('[data-announce-prev]').forEach((button) => {
      button.addEventListener('click', () => { show(index - 1); start(); });
    });
    dots.forEach((dot, i) => {
      dot.addEventListener('click', () => { show(i); start(); });
    });

    bar.addEventListener('mouseenter', stop);
    bar.addEventListener('mouseleave', start);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop();
      else start();
    });

    show(0);
    start();
  }

  function initMarquee() {
    document.querySelectorAll('[data-marquee]').forEach((track) => {
      const group = track.querySelector('.marquee__group');
      if (!group) return;
      const clone = group.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      track.append(clone);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initAnnounceBar();
      initMarquee();
    });
  } else {
    initAnnounceBar();
    initMarquee();
  }
})();
