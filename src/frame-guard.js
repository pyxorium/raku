// Raku refuses to run inside another site's frame (claude/raku-plan.md decision 2).
//
// GitHub Pages can't send the frame-ancestors header, so another site could load Raku in an
// invisible frame over its own button and trick a click onto Raku's (clickjacking). Inside a frame
// Raku shows only a link to open it in its own tab: no tabs, no prompts, no buttons to trick.
// (With scripts turned off in that frame, Raku doesn't run at all, so there's nothing to click.)

export function isFramed(win = window) {
  try { return win.top !== win.self; } catch { return true; }   // a cross-origin top can't even be compared
}

export function showOpenInOwnTab(root, href) {
  root.replaceChildren();
  const box = document.createElement('div');
  box.className = 'framed';
  const p = document.createElement('p');
  p.textContent = 'Raku only runs in its own tab.';
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = 'Open Raku in its own tab';
  box.append(p, a);
  root.append(box);
}
