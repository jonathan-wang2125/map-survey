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
        <p><strong>User 1:</strong> ${r.pid}</p>
        ${r.otherPid ? `<p><strong>User 2:</strong> ${r.otherPid}</p>` : ''}
        <p><strong>Dataset:</strong> ${r.dataset}</p>
        <p><strong>Q:</strong> ${r.question}</p>
        ${r.mapFile ? `<details><summary>Show Map</summary><img src="/maps/${encodeURIComponent(r.mapFile)}" style="max-width:100%;margin:0.5rem 0;"></details>` : ''}        <p><strong>User 1 Answer:</strong> ${r.answer}</p>
        <p><strong>User 2 Answer:</strong> ${r.otherAnswer}</p>
        
        <textarea rows="2" placeholder="Reasoning…" style="width:100%;margin-top:.5rem;resize:vertical;"></textarea>
        <div style="margin-top:.5rem; display:flex; gap:.5rem; flex-wrap:wrap;">
          <button class="u1Btn">User 1</button>
          <button class="u2Btn">User 2</button>
          <button class="rejBtn">Reject All Answers</button>
          <button class="editBtn" style="display:none;">Edit</button>
          <button class="cancelBtn">Cancel</button>
        </div>
      `;
      const u1Btn = card.querySelector('.u1Btn');
      const u2Btn = card.querySelector('.u2Btn');
      const rejBtn = card.querySelector('.rejBtn');
      const editBtn = card.querySelector('.editBtn');
      const cancelBtn = card.querySelector('.cancelBtn');
      const reasonBox = card.querySelector('textarea');

      const lock = (on) => {
        [u1Btn,u2Btn,rejBtn,cancelBtn,reasonBox].forEach(el => el.disabled = on);
        editBtn.style.display = on ? '' : 'none';
      };

      u1Btn.addEventListener('click', async () => { await this.judge(r,'1',reasonBox.value); lock(true); });
      u2Btn.addEventListener('click', async () => { await this.judge(r,'2',reasonBox.value); lock(true); });
      rejBtn.addEventListener('click', async () => { await this.judge(r,'reject',reasonBox.value); lock(true); });
      editBtn.addEventListener('click', () => lock(false));

      cancelBtn.addEventListener('click', async () => {
        await fetch(`/cancel_adjudication?code=${encodeURIComponent(this.passcode)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pid: r.pid, dataset: r.dataset, uid: r.uid })
        });
        card.remove();
      });
      container.appendChild(card);
    }
  },

  async judge(rec, choice, reason) {
    await fetch(`/adjudicate_result?code=${encodeURIComponent(this.passcode)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pid: rec.pid, dataset: rec.dataset, uid: rec.uid, choice, reason })
    });
    
  }
};
