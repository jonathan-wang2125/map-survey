import { Common } from '../common/common.js';
import { showToast } from '../common/toast.js';

export const status = {
    async init () {
      Common.initNavbar();
  
      const topics = ['NaturalWorld','Military', 'Urban', 'Aviation', 'Test']; // extend as needed
      const statusBox = document.getElementById('status');              // lives in the **first** container
      statusBox.textContent = 'Loading…';
  
      /* small helper to build <table> w/ header row */
      const makeTable = headers => {
        const tbl = document.createElement('table');
        tbl.innerHTML = `<tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr>`;
        return tbl;
      };
  
      // 1) Kick off all fetches in parallel, each promise resolves to { topic, data } or null
    const fetchPromises = topics.map(async topic => {
      try {
        console.log(`Fetching ${topic}:`, new Date().toISOString());
        const r = await fetch(`/admin/campaign_status/${topic}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        console.log(`Fetched ${topic}:`, new Date().toISOString());
        return { topic, data };
      } catch (err) {
        console.warn(`Campaign “${topic}” not found or empty`, err);
        return null;
      }
    });

    // 2) Wait for all of them
    const results = await Promise.all(fetchPromises);

    // 3) Render each successful fetch
    results
      .filter(x => x) // drop nulls
      .forEach(({ topic, data }) => {
        const container = document.createElement('div');
        container.className = 'container';

        // header
        const h = document.createElement('h2');
        h.textContent = `${topic} Campaign`;
         container.append(h);


        // 1) Create the collapse button
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'campaign-toggle-btn';
        toggleBtn.textContent = '∨';
       

        // 2) Append it to your header
        h.appendChild(toggleBtn);
        container.append(h);

        // 3) Now wire up a single click handler
        toggleBtn.addEventListener('click', () => {
          // toggle the 'collapsed' class exactly once
          const isCollapsed = container.classList.toggle('collapsed');

          // update the button label
          toggleBtn.textContent = isCollapsed ? '∧' : '∨';

          // hide or show every table in this container
          container.querySelectorAll('table').forEach(tbl => {
            tbl.style.display = isCollapsed ? 'none' : '';
          });
        });
        // campaign metadata
        if (data.meta) {
          const p = document.createElement('p');
          p.style.marginTop = '.25rem';
          p.textContent =
            `Current index: ${data.meta.curIndex}   •   ` +
            `Max images: ${data.meta.numImages}`;
          container.append(p);
        }

        // accuracy table
        const accTbl = makeTable(['User', 'Accuracy']);
        data.users.forEach(u => {
          const tr = accTbl.insertRow();
          tr.innerHTML = `
            <td>${u.pid}</td>
            <td>${
              u.accuracy != null && Number.isFinite(+u.accuracy)
                ? (+u.accuracy * 100).toFixed(1) + '%'
                : '—'
            }</td>`;
        });
        container.append(accTbl);

        // progress table
        const progTbl = makeTable([
          'Dataset',
          'User',
          'Status',
          'Answered',
          'Last Response'
        ]);

        // group by dataset
        const byDataset = {};
        data.progress.forEach(p => {
          (byDataset[p.dataset] ||= []).push(p);
        });

        Object.entries(byDataset).forEach(([dsName, rows]) => {
          rows.sort((a, b) => a.pid.localeCompare(b.pid));
          rows.forEach((p, idx) => {
            const tr = progTbl.insertRow();
            if (idx === 0) {
              const td = tr.insertCell();
              td.rowSpan = rows.length;
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
            const last = p.lastTS
              ? new Date(p.lastTS).toLocaleString()
              : '—';

            tr.insertCell().innerHTML = badge;
            tr.insertCell().textContent = `${p.answered} / ${p.total}`;
            tr.insertCell().textContent = last;
          });
        });

        container.append(progTbl);

        // attach remove‑user handlers
        container
          .querySelectorAll('.removeUserBtn')
          .forEach(btn => {
            btn.addEventListener('click', async () => {
              const pid = btn.dataset.pid;
              const dataset = btn.dataset.dataset;
              if (!confirm(`Remove user ${pid} from dataset ${dataset}?`))
                return;

              try {
                const resp = await fetch('/admin/assign', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    prolificID: pid,
                    datasetID: dataset,
                    allow: false
                  })
                });
                if (!resp.ok) throw new Error();
                btn.closest('tr').remove();
                showToast(`Removed ${pid} from ${dataset}`);
                setTimeout(() => location.reload(), 300);
              } catch (err) {
                console.error('Caught error:', err);
                alert('Failed to remove user; please try again.');
              }
            });
          });

        // append to document
        document.body.appendChild(container);
      });
  
      statusBox.textContent = '';      // clear “Loading…”
    }
}