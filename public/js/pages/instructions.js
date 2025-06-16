import { Common } from '../common/common.js';

export const instructions = {
    async init () {
      Common.ensureLogin();
      Common.initNavbar();

      /* fetch markdown */
      const md = await fetch('/instructions.md').then(r => r.text());

      /* convert → HTML with marked (GFM + line breaks) */
      const html = marked.parse(md, { gfm: true, breaks: true });

      /* inject + style */
      const box = document.getElementById('mdContent');
      box.className = 'markdown-body';   // class from github-markdown-css
      box.innerHTML = html;

      /* optional – syntax highlight for fenced code blocks */
      import('https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js')
        .then(m => {
          box.querySelectorAll('pre code').forEach(block => m.default.highlightElement(block));
        });
    }
  }