import "@testing-library/jest-dom";

beforeEach(() => {
  document.body.innerHTML = `
    <main class="container">
      <header class="header">
        <div class="header-row">
          <div>
            <h1>Personal Assistant</h1>
            <p class="subtitle">Launch and monitor local apps</p>
          </div>
          <button type="button" id="btn-backup" class="btn-backup">Backup</button>
        </div>
        <p id="backup-status" class="backup-status" hidden></p>
      </header>
      <section id="apps" class="apps"></section>
    </main>
  `;
});
