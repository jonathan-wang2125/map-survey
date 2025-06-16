export const Common = {
    initNavbar() {
      document.getElementById('logoutBtn')?.addEventListener('click', () => {
        localStorage.clear();
        location.href = '/login.html';
      });
    },
    ensureLogin() {
      if (!localStorage.getItem('prolificID')) {
        location.href = '/login.html';
        throw 'redirect';
      }
    },
    pid: () => localStorage.getItem('prolificID'),
    ds:  () => localStorage.getItem('datasetID')
  };
  