import { Common } from '../common/common.js';

export const login =  {
    init() {
        document.getElementById('loginBtn').addEventListener('click', async () => {
            const pid    = document.getElementById('prolificIDInput').value.trim();
            if (!pid) { alert('Enter your Prolific ID'); return; }
        
            const dsParam = new URLSearchParams(window.location.search).get('dataset');
            const resp    = await fetch('/login', {
                method: 'POST',
                headers:{ 'Content-Type':'application/json' },
                body: JSON.stringify({ prolificID: pid, datasetID: dsParam })
            });
            
            const ok = await resp.json();
        
            if (!ok.success) {
                return alert('Login failed');
            }
        
            // store user (and dataset if present)
            localStorage.setItem('prolificID', pid);
            if (dsParam) localStorage.setItem('datasetID', dsParam);
        
            // redirect new users to instructions, others to select page
            if (ok.isNew) {
                location.href = 'instructions.html';
            } else {
                location.href = 'select_dataset.html';
            }
        });
    }
}