import { Common } from '../common/common.js';

export const select = {
    async init() {
      Common.ensureLogin();
      Common.initNavbar();
  
      const pid = Common.pid();
  
      // 1) load all datasets for this user
      const datasets = await fetch(`/user_datasets/${pid}`).then(r => r.json());
      if (!datasets.length) {
        const msg = document.createElement('p');
        msg.textContent = 'No datasets have been assigned to your account.';
        document.body.append(msg);
        return;
      }
  
      // 2) group by topic
      const byTopic = {};
      for (const ds of datasets) {
        const topic = ds.topic || 'Uncategorized';
        (byTopic[topic] ||= []).push(ds);
      }
  
      // 3) for each topic, create a standalone container
      for (const [topic, list] of Object.entries(byTopic)) {
        // a) container div under <body>
        list.reverse();
        const container = document.createElement('div');
        container.style.position = 'relative';
        container.classList.add('container');

        const cardsHolder = document.createElement('div');
        cardsHolder.classList.add('dataset-buttons');
        container.append(cardsHolder);
  
        // b) topic title
        const h2 = document.createElement('h2');
        h2.textContent = topic;
        container.append(h2);
  
        // c) inner buttons wrapper with id="datasetButtons"
        const buttonsDiv = document.createElement('div');
        buttonsDiv.id = 'datasetButtons';
        container.append(buttonsDiv);
  
        // d) for each dataset in this topic, build a .dataset-card
        for (const ds of list) {
          // fetch whether it’s been submitted
          const { submitted } = await fetch(
            `/dataset_submission/${pid}/${ds.id}`
          ).then(r => r.json());
          
  
          // card element
          const card = document.createElement('div');
          card.classList.add('dataset-card');
  
          // title
          const h3 = document.createElement('h3');
          h3.textContent = ds.label;
          card.append(h3);
  
          // annotate button
          const anno = document.createElement('button');
          anno.textContent = 'Annotate';
          anno.onclick = () => {
            localStorage.setItem('datasetID', ds.id);
            location.href = 'index.html';
          };
  
          // past answers button
          const past = document.createElement('button');
          past.textContent = 'Past answers';
          past.disabled = true;
          past.onclick = () => {
            localStorage.setItem('datasetID', ds.id);
            location.href = 'past_answers.html';
          };
  
          // status badge
          const badge = document.createElement('span');
          badge.classList.add(
            'status-badge',
            submitted ? 'complete' : 'incomplete'
          );
          badge.textContent = submitted ? 'Submitted' : 'Pending';
  
          // actions wrapper
          const actions = document.createElement('div');
          actions.classList.add('actions');
          actions.append(anno, past, badge);
          card.append(actions);
  
          // enable Past answers if any exist
          (async () => {
            const { responses } = await fetch(
              `/qresponses/${pid}?dataset=${encodeURIComponent(ds.id)}`
            ).then(r => r.json());
            if (responses.length) past.disabled = false;
          })();
  
          buttonsDiv.append(card);
        }

      // …after you’ve built buttonsDiv and all the cards…

// 1) EXPAND/COLLAPSE TOGGLE
const toggle = document.createElement('button');
toggle.classList.add('expand-toggle');
toggle.textContent = 'v';              // open state
toggle.style.position = 'absolute';
toggle.style.top      = '0.5em';
toggle.style.right    = '0.5em';

let expanded = true;
toggle.onclick = () => {
  expanded = !expanded;
  buttonsDiv.style.display = expanded ? 'grid' : 'none';
  toggle.textContent      = expanded ? 'v'    : '>';
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