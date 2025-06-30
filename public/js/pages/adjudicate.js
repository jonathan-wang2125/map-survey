import { Common } from '../common/common.js';

export const adjudicate = {
  passcode: null,
  async init() {
    Common.initNavbar();
    this.passcode = prompt('Enter adjudication passcode:');
    if (!this.passcode) {
      document.getElementById('status').textContent = 'Passcode required.';
      return;
    }
    await this.load();
  },

  async load() {
    const container = document.getElementById('requests');
    const status    = document.getElementById('status');
    status.textContent = 'Loading…';
    const resp = await fetch(`/adjudications?code=${encodeURIComponent(this.passcode)}`);
    if (!resp.ok) { status.textContent = 'Invalid passcode.'; return; }
    const list = await resp.json();
    container.innerHTML = '';
    if (!list.length) { status.textContent = 'No pending requests.'; return; }
    status.textContent = '';
    for (const r of list) {
      const card = document.createElement('div');
      card.className = 'answer-card';
      card.innerHTML = `
        <p><strong>User:</strong> ${r.pid}</p>
        <p><strong>Dataset:</strong> ${r.dataset}</p>
        <p><strong>Q:</strong> ${r.question}</p>
        <p><strong>User Answer:</strong> ${r.answer}</p>
        ${r.label ? `<p><strong>Label:</strong> ${r.label}</p>` : ''}
        <div style="margin-top:.5rem;">
          <button class="yesBtn">User Correct</button>
          <button class="noBtn">User Incorrect</button>
        </div>
      `;
      card.querySelector('.yesBtn').addEventListener('click', () => this.judge(r, true));
      card.querySelector('.noBtn').addEventListener('click', () => this.judge(r, false));
      container.appendChild(card);
    }
  },

  async judge(rec, correct) {
    await fetch(`/adjudicate_result?code=${encodeURIComponent(this.passcode)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pid: rec.pid, dataset: rec.dataset, uid: rec.uid, correct })
    });
    this.load();
  }
};
