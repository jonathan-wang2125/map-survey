import { Common } from '../common/common.js';

export const select = {
  async init() {
    Common.ensureLogin();
    Common.initNavbar();

    const pid = Common.pid();

    // 1) load all assigned datasets (unchanged)
    const datasets = await fetch(`/user_datasets/${pid}`)
                             .then(r => r.json());
    if (!datasets.length) {
      document.body.append(Object.assign(
        document.createElement('p'),
        { textContent:'No datasets have been assigned to your account.' }
      ));
      return;
    }

    // 2) load submission / accuracy / hasResponses in one shot
    const { datasets: summary } = await fetch(`/user_datasets_summary/${pid}`)
                                      .then(r => r.json());
    const summaryById = Object.fromEntries(
      summary.map(d => [d.id, d])
    );

    // 3) group by topic
    const byTopic = {};
    for (const ds of datasets) {
      const topic = ds.topic || 'Uncategorized';
      (byTopic[topic] ||= []).push(ds);
    }

    const topics = ['Urban', 'NaturalWorld', 'Military', 'Aviation', 'Test']; // extend as needed


    const orderedTopics = [
      ...topics.filter(t => t in byTopic),
      ...Object.keys(byTopic)
            .filter(t => !topics.includes(t))
            .sort((a, b) => a.localeCompare(b))
    ];

    for (const topic of orderedTopics) {
    const list = byTopic[topic];
    list.reverse();   // if you still want newest-first per topi

      const container   = document.createElement('div');
      container.classList.add('container');
      container.style.position = 'relative';

      // 1) title 
      const titleEl = document.createElement('h2');
      titleEl.textContent = topic;
      container.append(titleEl);

      // cards wrapper
      const buttonsDiv = document.createElement('div');
      buttonsDiv.id = 'datasetButtons';
      buttonsDiv.classList.add('dataset-buttons');
      container.append(buttonsDiv);

      
      

      // 4) build each card using the one summaryById lookup
      for (const ds of list) {
        const { submitted, accuracy, hasResponses } = summaryById[ds.id] || {};

        const card    = document.createElement('div');
        card.classList.add('dataset-card');
        card.append(
          Object.assign(document.createElement('h3'), { textContent: ds.label })
        );

        const anno    = Object.assign(document.createElement('button'), { textContent:'Annotate' });
        anno.onclick  = () => {
          localStorage.setItem('datasetID', ds.id);
          location.href = 'index.html';
        };

        const past    = Object.assign(document.createElement('button'), {
          textContent: 'Past answers',
          disabled:    !hasResponses
        });
        past.onclick  = () => {
          localStorage.setItem('datasetID', ds.id);
          location.href = 'past_answers.html';
        };

        const badge   = Object.assign(document.createElement('span'), {
          textContent: submitted ? 'Submitted' : 'Pending'
        });
        badge.classList.add('status-badge', submitted ? 'complete' : 'incomplete');

        const actions = document.createElement('div');
        actions.classList.add('actions');
        actions.append(anno, past, badge);

        if (submitted && typeof accuracy === 'number') {
          const p = Object.assign(document.createElement('p'), {
            className: 'accuracy',
            textContent: `Accuracy: ${(accuracy*100).toFixed(1)}%`
          });
          Object.assign(p.style, {
            margin: '0.25em 0 0',
            fontSize: '0.9em',
            color: '#555'
          });
          actions.append(p);
        }

        card.append(actions);
        buttonsDiv.append(card);
      }

      // …after you’ve built buttonsDiv and all the cards…

// 1) EXPAND/COLLAPSE TOGGLE
const toggle = document.createElement('button');
toggle.classList.add('expand-toggle');
toggle.textContent = '∨';              // open state
toggle.style.position = 'absolute';
toggle.style.top      = '0.5em';
toggle.style.right    = '0.5em';

let expanded = true;
toggle.onclick = () => {
  expanded = !expanded;
  buttonsDiv.style.display = expanded ? 'grid' : 'none';
  toggle.textContent      = expanded ? '∨'    : '∧';
};

// 2) REVERSE-SORT BUTTON
const sortBtn = document.createElement('button');
sortBtn.classList.add('sort-toggle');
sortBtn.textContent = 'Oldest → Newest';
sortBtn.style.position = 'absolute';
sortBtn.style.top      = '0.5em';
sortBtn.style.right    = '2.5em';   // sits just left of the toggle


let reversed = true;
sortBtn.onclick = () => {
  const cards = Array.from(buttonsDiv.querySelectorAll('.dataset-card'));
  buttonsDiv.innerHTML = '';
  cards.reverse().forEach(c => buttonsDiv.appendChild(c));
  reversed = !reversed;
  sortBtn.textContent = reversed 
    ? 'Newest → Oldest'
    : 'Oldest → Newest';
};

// 3) APPEND ONCE
container.append(sortBtn, toggle);
        
              // e) append this topic container to the document body
              document.body.append(container);
            }
          }
      }