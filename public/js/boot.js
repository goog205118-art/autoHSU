(() => {
  const icons = {
    add: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
    upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
    download: '<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    tune: '<path d="M4 7h5m5 0h6M4 17h10m5 0h1"/><circle cx="11" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
    edit_note: '<path d="M4 5h9M4 10h6M4 15h4m4 1 7-7 3 3-7 7-4 1z"/>',
    auto_awesome: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
    content_copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    arrow_back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
    hub: '<rect x="3" y="8" width="6" height="8" rx="2"/><rect x="15" y="8" width="6" height="8" rx="2"/><path d="M9 12h6M6 4v4m12-4v4M6 16v4m12-4v4"/>',
    palette: '<circle cx="12" cy="12" r="9"/><path d="m8 16 8-8M7 8h.01M16 16h.01"/>',
    delete: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
    refresh: '<path d="M20 10a8 8 0 1 0-2 8M20 3v7h-7"/>',
    thumb_up: '<path d="M7 10H3v11h4zm0 0 5-8c3 1 1 6 1 6h5c3 0 3 2 2 5l-2 8H7"/>',
    mode_comment: '<path d="M21 15a3 3 0 0 1-3 3H8l-5 3V5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3z"/>',
    ios_share: '<path d="M12 15V2M7 7l5-5 5 5M5 10H3v11h18V10h-2"/>',
    more_horiz: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    view_list: '<path d="M9 5h12M9 12h12M9 19h12M3 5h1m-1 7h1m-1 7h1"/>',
    open_in_new: '<path d="M14 3h7v7m0-7L11 13M10 3H3v18h18v-7"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>',
    hourglass_top: '<path d="M6 3h12v4l-6 5-6-5zm0 18h12v-4l-6-5-6 5z"/>'
  };
  icons.drive_folder_upload = icons.upload;
  icons.add_photo_alternate = icons.add;
  icons.photo_library = icons.image;
  icons.psychology = icons.auto_awesome;
  icons.autorenew = icons.refresh;
  function decorate(root) {
    if (root.nodeType !== 1) return;
    const nodes = [...(root.matches('.material-symbols-outlined') ? [root] : []), ...root.querySelectorAll('.material-symbols-outlined')];
    for (const node of nodes) {
      if (node.querySelector('svg')) continue;
      const name = node.textContent.trim();
      node.dataset.icon = name;
      node.setAttribute('aria-hidden', 'true');
      node.innerHTML = `<svg viewBox="0 0 24 24" focusable="false">${icons[name] || icons.image}</svg>`;
    }
  }
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) decorate(node);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.openSocialMediaTool();
  decorate(document.body);
})();
