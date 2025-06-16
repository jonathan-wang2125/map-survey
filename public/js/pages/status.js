import { Common } from '../common/common.js';

export const status = {
    async init () {
      Common.initNavbar();
  
      const topics = ['Military', 'Natural World', 'Urban', 'Aviation', 'Test']; // extend as needed
      const statusBox = document.getElementById('status');              // lives in the **first** container
      statusBox.textContent = 'Loading…';
  
      /* small helper to build <table> w/ header row */
      const makeTable = headers => {
        const tbl = document.createElement('table');
        tbl.innerHTML = `<tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr>`;
        return tbl;
      };
  
      for (const topic of topics) {
        let data;
        try {
          const r = await fetch(`/admin/campaign_status/${topic}`);
          if (!r.ok) throw new Error();
          data = await r.json();
        } catch {
          console.warn(`Campaign “${topic}” not found or empty`);
          continue;                       // skip missing campaigns
        }
  
        /* ── build one independent dashboard per campaign ── */
        const container = document.createElement('div');
        container.className = 'container';
  
        /* header */
        const h = document.createElement('h2');
        h.textContent = `${topic} Campaign`;
        container.append(h);
  
        /* campaign metadata */
        if (data.meta) {
          const p = document.createElement('p');
          p.style.marginTop = '.25rem';
          p.textContent =
            `Current index: ${data.meta.curIndex}   •   `
          + `Max images: ${data.meta.numImages}`;
          container.append(p);
        }
  
        /* accuracy table (User • Accuracy) */
        const accTbl = makeTable(['User', 'Accuracy']);
        data.users.forEach(u => {
          const tr = accTbl.insertRow();
          tr.innerHTML = `
            <td>${u.pid}</td>
            <td>${
              u.accuracy != null && Number.isFinite(parseFloat(u.accuracy))
                ? (parseFloat(u.accuracy) * 100).toFixed(1) + '%'
                : '—'
            }</td>`;
        });
        container.append(accTbl);
  
        /* progress table (Dataset • User • Status • Answered • Last) */
        const progTbl = makeTable(
          ['Dataset', 'User', 'Status', 'Answered', 'Last Response']
        );
        
        /* --- group rows by dataset so we can rowspan the first cell --- */
        const byDataset = {};
        data.progress.forEach(p => {
          (byDataset[p.dataset] ||= []).push(p);
        });
        
        Object.entries(byDataset).forEach(([dsName, rows]) => {
          /* keep the order stable – alphabetical by user */
          rows.sort((a, b) => a.pid.localeCompare(b.pid));
          const span = rows.length;
        
          rows.forEach((p, idx) => {
            const tr = progTbl.insertRow();
        
            /* first row → output the dataset cell with rowspan */
            if (idx === 0) {
              const td = tr.insertCell();
              td.rowSpan = span;
              td.textContent = dsName;
            }
  
            const userTd = tr.insertCell();
            userTd.classList.add('user-cell');
            userTd.innerHTML = `
              <span class="user-name">${p.pid}</span>
              <button
                class="removeUserBtn"
                data-pid="${p.pid}"
                data-dataset="${dsName}"
                aria-label="Remove ${p.pid}"
              >✖</button>
            `;
        
            const badge = p.submitted
              ? '<span class="badge complete">Completed</span>'
              : '<span class="badge pending">Pending</span>';
            const last  = p.lastTS ? new Date(p.lastTS).toLocaleString() : '—';
        
            // tr.insertCell().textContent = p.pid;               // User
            tr.insertCell().innerHTML   = badge;               // Status
            tr.insertCell().textContent = `${p.answered} / ${p.total}`;
            tr.insertCell().textContent = last;
          });
        });
        
        container.append(progTbl);
        container.querySelectorAll('.removeUserBtn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const pid = btn.dataset.pid;
            const dataset = btn.dataset.dataset;
            if (!confirm(`Remove user ${pid} from dataset ${dataset}?`)) return;
  
            try {
              const resp = await fetch('/admin/assign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  prolificID: pid,
                  datasetID: dataset,
                  allow: false  // revoke access
                })
              });
              if (!resp.ok) throw new Error();
              // on success, remove the row from the table:
              btn.closest('tr').remove();
              showToast(`Removed ${pid} from ${dataset}`);
              setTimeout(() => location.reload(), 300);
            } catch {
              alert('Failed to remove user; please try again.');
            }
          });
        });
  
        /* add the whole block after the initial “status” container */
        document.body.appendChild(container);
      }
  
      statusBox.textContent = '';      // clear “Loading…”
    }
}