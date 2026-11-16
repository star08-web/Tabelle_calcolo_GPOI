<!--
  Icon.svelte — set di icone SVG inline (nessuna dipendenza esterna).
  Le icone sono tracciate con stroke per coerenza con lo stile "ribbon".
-->
<script>
  let { name = 'dot', size = 18 } = $props();

  const ICONS = {
    new: '<path d="M14 3v5h5"/><path d="M19 8.5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h8z"/><path d="M9 13h6M9 17h4"/>',
    open: '<path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
    save: '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M8 3v5h7V3"/><path d="M8 21v-7h8v7"/>',
    download: '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>',
    upload: '<path d="M12 21V9"/><path d="m7 13 5-5 5 5"/><path d="M4 4h16"/>',
    undo: '<path d="M4 10h10a5 5 0 0 1 0 10h-3"/><path d="m4 10 4-4M4 10l4 4"/>',
    redo: '<path d="M20 10H10a5 5 0 0 0 0 10h3"/><path d="m20 10-4-4M20 10l-4 4"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/>',
    paste: '<path d="M9 4h6v3H9z"/><path d="M15 5h2a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
    bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7z"/><path d="M7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
    italic: '<path d="M15 5h-4M13 19H9M14 5l-4 14"/>',
    alignLeft: '<path d="M4 6h16M4 12h9M4 18h13"/>',
    alignCenter: '<path d="M4 6h16M7 12h10M5 18h14"/>',
    alignRight: '<path d="M4 6h16M11 12h9M7 18h13"/>',
    number: '<path d="M5 8h4M7 8v9"/><path d="M13 9h6M13 14h6"/><path d="M13 12a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>',
    currency: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.7-.8-1.7-1.2-3-1.2-1.7 0-3 1-3 2.4 0 3.2 6 1.7 6 5 0 1.5-1.3 2.4-3 2.4-1.4 0-2.5-.5-3.2-1.4M12 6.5v11"/>',
    percent: '<path d="m5 19 14-14"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
    rowInsert: '<rect x="3" y="4" width="18" height="6" rx="1"/><path d="M12 13v7M9 17l3 3 3-3"/>',
    rowDelete: '<rect x="3" y="4" width="18" height="6" rx="1"/><path d="M9 17h6"/>',
    colInsert: '<rect x="4" y="3" width="6" height="18" rx="1"/><path d="M14 12h7M17.5 8.5 21 12l-3.5 3.5"/>',
    colDelete: '<rect x="4" y="3" width="6" height="18" rx="1"/><path d="M14 12h7"/>',
    function: '<path d="M4 20c2 0 2.5-2 3-5l1.5-6C9 5 10 4 12 4h4"/><path d="M13 14l3 6M9 14h6"/>',
    recalc: '<path d="M20 11a8 8 0 1 0-1.5 6"/><path d="M20 5v6h-6"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.6 2.6 0 1 1 3.4 2.5c-.6.2-.9.8-.9 1.4v.6"/><path d="M12 17.2v.2"/>',
    ai: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="4"/><path d="m6 6 2 2M16 16l2 2M18 6l-2 2M8 16l-2 2"/>',
    theme: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor"/>',
    install: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 7v7M9 11l3 3 3-3"/>',
    grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    clear: '<path d="M5 5l14 14M19 5 5 19"/>',
  };
</script>

<svg
  viewBox="0 0 24 24"
  width={size}
  height={size}
  aria-hidden="true"
  focusable="false"
  style="stroke: currentColor; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;"
>
  {@html ICONS[name] ?? ''}
</svg>
