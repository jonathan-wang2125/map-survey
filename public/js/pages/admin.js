import { Common } from '../common/common.js';
import { showToast } from '../common/toast.js';

export const admin = {
    users:    [],
    datasets: [],        // [{id,label,description}]
    current:  null,      // active pid
  
    async init () {
      /* fetch initial data */
      [this.users, this.datasets] = await Promise.all([
        fetch('/admin/users').then(r => r.json()),
        fetch('/admin/datasets').then(r => r.json())   // includes meta
      ]);
  
      /* build filterable user selector */
      this.sel   = document.getElementById('userSelect');
      this.input = document.getElementById('userFilter');
      this.buildOptions('');                          // initial full list
      this.input.addEventListener('input', () =>
        this.buildOptions(this.input.value.trim().toLowerCase()));
      this.sel.addEventListener('change', () =>
        this.loadForUser(this.sel.value));
  
      /* auto-select first user */
      if (this.users.length) {
        this.sel.value = this.users[0];
        this.loadForUser(this.users[0]);
      } else {
        document.getElementById('status').textContent = 'No users found.';
      }
    },
  
    buildOptions (substr) {
      this.sel.innerHTML = '';
      this.users
        .filter(pid => pid.toLowerCase().includes(substr))
        .forEach(pid => {
          const o = document.createElement('option');
          o.value = o.textContent = pid;
          this.sel.append(o);
        });
    },
  
    async loadForUser (pid) {
      this.current = pid;
      document.getElementById('status').textContent =
        `Loading datasets for ${pid}…`;
    
      const assigned = new Set(
        await fetch(`/admin/user_datasets/${pid}`).then(r => r.json())
      );
    
      const tbl = document.getElementById('dsTable');
      tbl.innerHTML = '';
      const head = tbl.insertRow();
      head.innerHTML =
        '<th>Dataset</th><th>Topic</th><th>Description</th><th>Assigned?</th>';
    
      this.datasets.forEach(ds => {
        const row = tbl.insertRow();
    
        /* ── Dataset label + actions ───────────────────────── */
        const labelTd = row.insertCell();
        labelTd.innerHTML = `
          <div class="dataset-header">
            <span class="dsLabel" data-id="${ds.id}">${ds.label}</span>
            <div class="dataset-actions">
              <button class="editLabel"  data-id="${ds.id}">✎</button>
              <button class="inviteBtn" data-id="${ds.id}">➕ Invite</button>
            </div>
          </div>`;
    
        /* ── Topic (with inline edit) ──────────────────────── */
        const topicTd = row.insertCell();
        topicTd.innerHTML = `
          <span class="dsTopic" data-id="${ds.id}">${ds.topic || ''}</span>
          <button class="editTopic" data-id="${ds.id}">✎</button>`;
    
        /* ── Description (with inline edit) ────────────────── */
        const descTd = row.insertCell();
        descTd.innerHTML = `
          <span class="dsDesc" data-id="${ds.id}">${ds.description || ''}</span>
          <button class="editDesc" data-id="${ds.id}">✎</button>`;
    
        /* ── Assignment checkbox ───────────────────────────── */
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = assigned.has(ds.id);
        cb.addEventListener('change', () =>
          this.toggleAssign(pid, ds.id, cb.checked));
        row.insertCell().append(cb);
      });
    
      /* ── Attach handlers for every edit button ───────────── */
      tbl.querySelectorAll('.editLabel')
         .forEach(btn => btn.addEventListener('click',
           () => this.editField(btn.dataset.id, 'label')));
    
      tbl.querySelectorAll('.editTopic')
         .forEach(btn => btn.addEventListener('click',
           () => this.editField(btn.dataset.id, 'topic')));
    
      tbl.querySelectorAll('.editDesc')
         .forEach(btn => btn.addEventListener('click',
           () => this.editField(btn.dataset.id, 'description')));
    
      /* invite-link code stays exactly the same */
      tbl.querySelectorAll('.inviteBtn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const dsID = btn.dataset.id;
          const link = `${window.location.origin}/login.html?dataset=${encodeURIComponent(dsID)}`;
          const ta = document.createElement('textarea');
          ta.value = link;
          ta.style.position = 'fixed';
          ta.style.opacity  = '0';
          document.body.appendChild(ta);
          ta.focus(); ta.select();
          let ok = false;
          try { ok = document.execCommand('copy'); } catch {}
          document.body.removeChild(ta);
          showToast(ok ? 'Invite link copied!' : 'Copy failed');
        });
      });
    
      document.getElementById('status').textContent =
        `Editing assignments for ${pid}`;
    },
  
    async toggleAssign (pid, dsID, allow) {
      const r = await fetch('/admin/assign', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ prolificID:pid, datasetID:dsID, allow })
      });
      if (!r.ok) { alert('DB error — change reverted'); this.loadForUser(pid); }
    },
    
    /* ----------------------------------------------------- */
    /* generic one-field editor (label / topic / description)*/
    async editField (dsID, field) {
      const ds = this.datasets.find(d => d.id === dsID);        // cache row
    
      const current = ds?.[field] ?? '';
      const promptText = {
        label:       'Dataset label:',
        topic:       'Dataset topic:',
        description: 'Dataset description:'
      }[field];
    
      const newVal = prompt(promptText, current);
      if (newVal === null) return;            // user hit Cancel
    
      /* 1) build a *complete* payload that preserves the other two columns */
      const body = {
        label:       field === 'label'       ? newVal : ds.label       ?? dsID,
        description: field === 'description' ? newVal : ds.description ?? '',
        topic:       field === 'topic'       ? newVal : ds.topic       ?? ''
      };
    
      /* 2) save to server */
      const r = await fetch(`/admin/dataset_meta/${dsID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!r.ok) { alert('Save failed'); return; }
    
      /* 3) update UI + local cache */
      ds[field] = newVal;                          // cache stays in sync
      const cellSel = {
        label: '.dsLabel',
        topic: '.dsTopic',
        description: '.dsDesc'
      }[field];
      document.querySelector(`${cellSel}[data-id="${dsID}"]`).textContent = newVal;
    }
}

window.admin = admin