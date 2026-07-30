(() => {
  const root = document.documentElement;
  try {
    const mode = localStorage.getItem('c3-mode');
    const skin = localStorage.getItem('c3-skin');
    const effects = localStorage.getItem('c3-effects');
    root.dataset.c3Theme = mode === 'light' ? 'fresh-light' : 'cozy-dark';
    root.dataset.c3Skin = skin === 'afterglow' ? 'afterglow' : 'iris';
    if (effects === 'reduced') root.dataset.c3Effects = 'reduced';
    else delete root.dataset.c3Effects;
  } catch {
    root.dataset.c3Theme = 'cozy-dark';
    root.dataset.c3Skin = 'iris';
  }
})();
