document.addEventListener('DOMContentLoaded', async () => {
    // 1. load navbar fragment
    const resp = await fetch('/partials/navbar.html');
    if (!resp.ok) return console.warn('Navbar load failed');
  
    document.body.insertAdjacentHTML('afterbegin', await resp.text());
  
    // 2. wire up logout
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
      localStorage.clear();
      location.href = '/login.html';
    });
  
    // 3. display current user
    const pid = localStorage.getItem('prolificID');
    const span = document.getElementById('navUser');
    if (pid) {
      span.textContent = `Welcome, ${pid}`;
    } else {
      // if no user, hide the span altogether
      span.style.display = 'none';
    }
  });
  