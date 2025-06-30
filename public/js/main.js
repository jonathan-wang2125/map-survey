import { login } from './pages/login.js';
import { select } from './pages/select.js';
import { annotate } from './pages/annotate.js';
import { past } from './pages/past.js';
import { instructions } from './pages/instructions.js';
import { admin } from './pages/admin.js';
import { status } from './pages/status.js';
import { adjudicate } from './pages/adjudicate.js';

const Pages = { login, select, annotate, past, instructions, admin, status, adjudicate };

document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page;
  Pages[page]?.init?.();
});