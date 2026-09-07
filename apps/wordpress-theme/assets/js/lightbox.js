/**
 * USSALMC Theme — inline image lightbox for wiki entity pages.
 *
 * Wiki entity images (hero + gallery thumbs, rendered by the wiki plugin's
 * entity template / the theme's ussalmc-wiki/entity.php override) previously
 * either did nothing (hero) or opened the full image in a new tab (gallery
 * <a target="_blank">). This intercepts those clicks and shows the full-size
 * image in an inline overlay on the same page — no navigation, no new tab.
 *
 * Progressive enhancement: the underlying <a href> links stay valid, so if JS
 * fails the image is still reachable. Delegated listener = works for any markup
 * matching the entity image selectors, plugin default or theme override.
 */
(function () {
  'use strict';

  var overlay, imgEl, capEl, lastFocus;

  function build() {
    if (overlay) { return; }
    overlay = document.createElement('div');
    overlay.className = 'ussalmc-lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Image viewer');
    overlay.innerHTML =
      '<div class="ussalmc-lightbox__frame">' +
        '<button type="button" class="ussalmc-lightbox__close" aria-label="Close image viewer">&times;</button>' +
        '<img class="ussalmc-lightbox__img" alt="" />' +
        '<div class="ussalmc-lightbox__cap"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    imgEl = overlay.querySelector('.ussalmc-lightbox__img');
    capEl = overlay.querySelector('.ussalmc-lightbox__cap');

    // Click on the backdrop (not the frame) or the close button closes it.
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.classList.contains('ussalmc-lightbox__close')) {
        close();
      }
    });
  }

  function open(src, caption, altText) {
    build();
    imgEl.src = src;
    imgEl.alt = altText || caption || '';
    capEl.textContent = caption || '';
    lastFocus = document.activeElement;
    overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    overlay.querySelector('.ussalmc-lightbox__close').focus();
  }

  function close() {
    if (!overlay) { return; }
    overlay.classList.remove('is-open');
    imgEl.src = '';
    document.body.style.overflow = '';
    if (lastFocus && typeof lastFocus.focus === 'function') { lastFocus.focus(); }
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay && overlay.classList.contains('is-open')) {
      close();
    }
  });

  // Delegated click handling for any image inside a wiki entity card.
  document.addEventListener('click', function (e) {
    var entity = e.target.closest ? e.target.closest('.ussalmc-entity') : null;
    if (!entity) { return; }

    // Gallery thumb: an <a> wrapping the thumb, href = full-size image.
    var link = e.target.closest('a.ussalmc-thumb, .ussalmc-entity__gallery a');
    if (link && link.getAttribute('href')) {
      e.preventDefault();
      var thumbImg = link.querySelector('img');
      open(link.getAttribute('href'),
           thumbImg ? thumbImg.getAttribute('alt') : '',
           thumbImg ? thumbImg.getAttribute('alt') : '');
      return;
    }

    // Hero image (a plain <img>, not linked): open its own source.
    var hero = e.target.closest('img.ussalmc-entity__hero');
    if (hero) {
      e.preventDefault();
      var fig = hero.closest('figure');
      var cap = fig ? fig.querySelector('figcaption') : null;
      open(hero.getAttribute('src'),
           cap ? cap.textContent : (hero.getAttribute('alt') || ''),
           hero.getAttribute('alt') || '');
    }
  });
})();
