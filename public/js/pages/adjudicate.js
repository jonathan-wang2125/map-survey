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
    const pastCont  = document.getElementById('past');
    const status    = document.getElementById('status');
    status.textContent = 'Loading…';
    const resp = await fetch(`/adjudications?code=${encodeURIComponent(this.passcode)}`);
    if (!resp.ok) { status.textContent = 'Invalid passcode.'; return; }
    const list = await resp.json();

    const pastResp = await fetch(`/past_adjudications?code=${encodeURIComponent(this.passcode)}`);
    const pastList = pastResp.ok ? await pastResp.json() : [];

    container.innerHTML = '';
    pastCont.innerHTML = '';
    if (!list.length) { status.textContent = 'No pending requests.'; } else { status.textContent = ''; }
    
    for (const r of list) {
      const card = document.createElement('div');
      card.className = 'answer-card';
      
      card.innerHTML = `
        <p><strong>User 1:</strong> ${r.pid}</p>
        ${r.otherPid ? `<p><strong>User 2:</strong> ${r.otherPid}</p>` : ''}
        <p><strong>Dataset:</strong> ${r.dataset}</p>
        <p><strong>Q:</strong> ${r.question}</p>
<<<<<<< Updated upstream
        ${r.mapFile ? `<details><summary>Show Map</summary><img src="/maps/${encodeURIComponent(r.mapFile)}" style="max-width:100%;margin:0.5rem 0;"></details>` : ''}
        <p><strong>User 1 Answer:</strong> ${r.answer}</p>
        <p><strong>User 1 Needs Rephrasing:</strong> ${r.badQuestion ? 'Yes' : 'No'}</p>
        ${r.badQuestion ? `<p><strong>User 1 Rephrase:</strong> ${r.badReason}</p>` : ''}
        <p><strong>User 2 Answer:</strong> ${r.otherAnswer}</p>
        ${r.otherPid ? `<p><strong>User 2 Needs Rephrasing:</strong> ${r.otherBadQuestion ? 'Yes' : 'No'}</p>${r.otherBadQuestion ? `<p><strong>User 2 Rephrase:</strong> ${r.otherBadReason}</p>` : ''}` : ''}
=======
         ${r.mapFile ? `<details><summary>Show Map</summary><img src="/maps/${encodeURIComponent(r.mapFile)}" style="max-width:100%;margin:0.5rem 0;"></details>` : ''}
        <p><strong>User 1 Answer:</strong> ${r.answer}</p>
        <p><strong>User 2 Answer:</strong> ${r.otherAnswer}</p>
        
        ${r.badReason ? `<p><strong>User 1 Rephrase:</strong> ${r.badReason}</p>` : ''}
        ${r.otherBadReason ? `<p><strong>User 2 Rephrase:</strong> ${r.otherBadReason}</p>` : ''}

>>>>>>> Stashed changes
        <label style="display:block;margin-top:.25rem;">
          Final Label:
          <input type="text" class="labelBox" value="${r.adjudicator_label ?? ''}" style="width:100%;">
        </label>

        <textarea rows="2" placeholder="Reasoning…" style="width:100%;margin-top:.5rem;resize:vertical;"></textarea>
        <div style="margin-top:.5rem; display:flex; gap:.5rem; flex-wrap:wrap;">
          <button class="u1Btn">User 1</button>
          <button class="u1NewBtn">User 1 + New Q</button>
          <button class="u2Btn">User 2</button>
          <button class="u2NewBtn">User 2 + New Q</button>
          <button class="rejBtn">Reject All Answers</button>
           <button class="rejNewBtn">Reject + New Q</button>
          <button class="editBtn" style="display:none;">Edit</button>
          <button class="cancelBtn">Cancel</button>
        </div>
      `;
      const u1Btn = card.querySelector('.u1Btn');
      const u2Btn = card.querySelector('.u2Btn');
      const rejBtn = card.querySelector('.rejBtn');
      const u1NewBtn = card.querySelector('.u1NewBtn');
      const u2NewBtn = card.querySelector('.u2NewBtn');
      const rejNewBtn = card.querySelector('.rejNewBtn');
      const editBtn = card.querySelector('.editBtn');
      const cancelBtn = card.querySelector('.cancelBtn');
      const reasonBox = card.querySelector('textarea');
      const labelBox = card.querySelector('.labelBox');

      const lock = (on) => {
         [u1Btn,u2Btn,rejBtn,u1NewBtn,u2NewBtn,rejNewBtn,cancelBtn,reasonBox,labelBox].forEach(el => el.disabled = on);
        editBtn.style.display = on ? '' : 'none';
      };

      u1Btn.addEventListener('click', async () => {
        await this.judge(r,'1',reasonBox.value,labelBox.value);
        lock(true);
        await this.load();
      });
      u2Btn.addEventListener('click', async () => {
        await this.judge(r,'2',reasonBox.value,labelBox.value);
        lock(true);
        await this.load();
      });
      rejBtn.addEventListener('click', async () => {
        await this.judge(r,'reject',reasonBox.value,labelBox.value);
        lock(true);
        await this.load();
      });
      u1NewBtn.addEventListener('click', async () => {
        await this.judge(r,'1',reasonBox.value,labelBox.value,r.badReason);
        lock(true);
        await this.load();
      });
      u2NewBtn.addEventListener('click', async () => {
        await this.judge(r,'2',reasonBox.value,labelBox.value,r.otherBadReason);
        lock(true);
        await this.load();
      });
      rejNewBtn.addEventListener('click', async () => {
        await this.judge(r,'reject',reasonBox.value,labelBox.value,r.badReason || r.otherBadReason);
        lock(true);
        await this.load();
      });
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
     // past adjudications
     for (const r of pastList) {
      const card = document.createElement('div');
      card.className = 'answer-card';

      card.innerHTML = `
<<<<<<< Updated upstream
        <p><strong>User 1:</strong> ${r.pid}</p>
        ${r.otherPid ? `<p><strong>User 2:</strong> ${r.otherPid}</p>` : ''}
        <p><strong>Dataset:</strong> ${r.dataset}</p>
        <p><strong>Q:</strong> ${r.question}</p>
        ${r.mapFile ? `<details><summary>Show Map</summary><img src="/maps/${encodeURIComponent(r.mapFile)}" style="max-width:100%;margin:0.5rem 0;"></details>` : ''}
        <p><strong>User 1 Answer:</strong> ${r.answer}</p>
        <p><strong>User 1 Needs Rephrasing:</strong> ${r.badQuestion ? 'Yes' : 'No'}</p>
        ${r.badQuestion ? `<p><strong>User 1 Rephrase:</strong> ${r.badReason}</p>` : ''}
        <p><strong>User 2 Answer:</strong> ${r.otherAnswer}</p>
        ${r.otherPid ? `<p><strong>User 2 Needs Rephrasing:</strong> ${r.otherBadQuestion ? 'Yes' : 'No'}</p>${r.otherBadQuestion ? `<p><strong>User 2 Rephrase:</strong> ${r.otherBadReason}</p>` : ''}` : ''}
        <span class="adjudication-flag">Adjudicated: ${r.adjudication}</span>

        <label style="display:block;margin-top:.25rem;">
          Final Label:
          <input type="text" class="labelBox" value="${r.adjudicator_label ?? ''}" style="width:100%;">
        </label>

        <textarea rows="2" placeholder="Reasoning…" style="width:100%;margin-top:.5rem;resize:vertical;">${r.adjudication_reason ?? ''}</textarea>
        <div style="margin-top:.5rem; display:flex; gap:.5rem; flex-wrap:wrap;">
          <button class="u1Btn">User 1</button>
          <button class="u2Btn">User 2</button>
          <button class="rejBtn">Reject All Answers</button>
          <button class="editBtn">Edit</button>
        </div>
      `;
=======
          <p><strong>User 1:</strong> ${r.pid}</p>
          ${r.otherPid ? `<p><strong>User 2:</strong> ${r.otherPid}</p>` : ''}
          <p><strong>Dataset:</strong> ${r.dataset}</p>
          <p><strong>Q:</strong> ${r.question}</p>
          ${r.mapFile ? `<details><summary>Show Map</summary><img src="/maps/${encodeURIComponent(r.mapFile)}" style="max-width:100%;margin:0.5rem 0;"></details>` : ''}
          <p><strong>User 1 Answer:</strong> ${r.answer}</p>
          <p><strong>User 2 Answer:</strong> ${r.otherAnswer}</p>
          ${r.badReason ? `<p><strong>User 1 Rephrase:</strong> ${r.badReason}</p>` : ''}
          ${r.otherBadReason ? `<p><strong>User 2 Rephrase:</strong> ${r.otherBadReason}</p>` : ''}
          <span class="adjudication-flag">Adjudicated: ${r.adjudication}</span>

          <textarea rows="2" placeholder="Reasoning…" style="width:100%;margin-top:.5rem;resize:vertical;">${r.adjudication_reason ?? ''}</textarea>
          <div style="margin-top:.5rem; display:flex; gap:.5rem; flex-wrap:wrap;">
            <button class="u1Btn">User 1</button>
            <button class="u2Btn">User 2</button>
            <button class="rejBtn">Reject All Answers</button>
            <button class="editBtn">Edit</button>
          </div>
        `;
>>>>>>> Stashed changes

      const u1Btn = card.querySelector('.u1Btn');
      const u2Btn = card.querySelector('.u2Btn');
      const rejBtn = card.querySelector('.rejBtn');
      const editBtn = card.querySelector('.editBtn');
         const reasonBox = card.querySelector('textarea');
        const labelBox = card.querySelector('.labelBox');

      const lock = (on) => {
          [u1Btn,u2Btn,rejBtn,reasonBox, ...(labelBox ? [labelBox] : [])].forEach(el => el.disabled = on);
          editBtn.style.display = on ? '' : 'none';
        };

      lock(true); // start locked

      u1Btn.addEventListener('click', async () => {
        await this.judge(r,'1',reasonBox.value,labelBox.value);
        lock(true);
        await this.load();
      });
      u2Btn.addEventListener('click', async () => {
        await this.judge(r,'2',reasonBox.value,labelBox.value);
        lock(true);
        await this.load();
      });
      rejBtn.addEventListener('click', async () => {
        await this.judge(r,'reject',reasonBox.value,labelBox.value);
        lock(true);
        await this.load();
      });
      editBtn.addEventListener('click', () => lock(false));

      pastCont.appendChild(card);
    }
  },

  async judge(rec, choice, reason, label, newQuestion) {
    await fetch(`/adjudicate_result?code=${encodeURIComponent(this.passcode)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pid: rec.pid, dataset: rec.dataset, uid: rec.uid, choice, reason, label, newQuestion })
    });
  }
};
