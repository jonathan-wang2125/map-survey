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
    let idx = 0;
    for (const r of list) {
      const card = document.createElement('div');
      card.className = 'answer-card';
      const radioName = `choice-${idx++}`;
      card.innerHTML = `
        <p><strong>User 1:</strong> ${r.pid}</p>
        ${r.otherPid ? `<p><strong>User 2:</strong> ${r.otherPid}</p>` : ''}
        <p><strong>Dataset:</strong> ${r.dataset}</p>
        <p><strong>Q:</strong> ${r.question}</p>
        ${r.mapFile ? `<img src="/maps/${encodeURIComponent(r.mapFile)}" style="max-width:100%;margin:0.5rem 0;">` : ''}
        <p><strong>User 1 Answer:</strong> ${r.answer}</p>
        <p><strong>User 2 Answer:</strong> ${r.otherAnswer}</p>
        <div style="margin-top:.5rem;">
          <label><input type="radio" name="${radioName}" value="1" checked> User 1 Correct</label>
          <label style="margin-left:.5rem;"><input type="radio" name="${radioName}" value="2"> User 2 Correct</label>
        </div>
        <textarea rows="2" placeholder="Reasoning…" style="width:100%;margin-top:.5rem;resize:vertical;"></textarea>
        <div style="margin-top:.5rem;">
          <button class="submitBtn">Submit</button>
          <button class="cancelBtn" style="margin-left:.5rem;">Cancel</button>
        </div>
      `;
      card.querySelector('.submitBtn').addEventListener('click', async () => {
        const correct = card.querySelector(`input[name="${radioName}"]:checked`).value === '1';
        const reason  = card.querySelector('textarea').value;
        await this.judge(r, correct, reason);
      });

      card.querySelector('.cancelBtn').addEventListener('click', async () => {
        await fetch(`/cancel_adjudication?code=${encodeURIComponent(this.passcode)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pid: r.pid, dataset: r.dataset, uid: r.uid })
        });
        this.load();
      });
      container.appendChild(card);
    }
  },

  async judge(rec, correct, reason) {
    await fetch(`/adjudicate_result?code=${encodeURIComponent(this.passcode)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pid: rec.pid, dataset: rec.dataset, uid: rec.uid, correct, reason })
    });
    this.load();
  }
};
