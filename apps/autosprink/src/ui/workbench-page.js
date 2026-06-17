const DEFAULT_EMPTY_MESSAGE = 'No jobs match this filter.';

function formatMoney(value) {
  const amount = Number(value) || 0;
  if (!amount) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: amount >= 1000 ? 0 : 2,
  }).format(amount);
}

function formatDateLabel(value) {
  if (!value) return 'No date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No date';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatCalendarLabel(value) {
  if (!value) return 'TBD';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'TBD';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#39;',
  })[char]);
}

function reportConfigForRole(role) {
  const normalized = String(role || 'user').trim().toLowerCase();
  if (normalized === 'estimator') {
    return { view: 'bid-performance', label: 'Open my bid performance' };
  }
  if (normalized === 'designer') {
    return { view: 'design-queue', label: 'Open my design queue' };
  }
  return { view: 'company-dashboard', label: 'Open company dashboard' };
}

export function createWorkbenchApp(options = {}) {
  const doc = options.document || window.document;
  const win = options.window || window;
  const api = options.api || ((path, init) => win.HFAuth.api(path, init));
  const authGuard = options.authGuard || (() => win.HFAuth.guard());

  const elements = {
    title: doc.querySelector('[data-workbench-title]'),
    subtitle: doc.querySelector('[data-workbench-subtitle]'),
    reportButton: doc.querySelector('[data-workbench-report-button]'),
    searchInput: doc.querySelector('[data-workbench-search]'),
    metrics: {
      jobs: doc.querySelector('[data-workbench-metric="jobs"]'),
      flagged: doc.querySelector('[data-workbench-metric="flagged"]'),
      tasks: doc.querySelector('[data-workbench-metric="tasks"]'),
      calendar: doc.querySelector('[data-workbench-metric="calendar"]'),
    },
    jobsList: doc.querySelector('[data-workbench-jobs]'),
    jobsEmpty: doc.querySelector('[data-workbench-jobs-empty]'),
    flaggedList: doc.querySelector('[data-workbench-flagged]'),
    tasksList: doc.querySelector('[data-workbench-tasks]'),
    calendarList: doc.querySelector('[data-workbench-calendar]'),
    status: doc.querySelector('[data-workbench-status]'),
  };

  const state = {
    overview: null,
    jobsFilter: '',
    loading: false,
  };

  function setStatus(message, tone = 'muted') {
    if (!elements.status) return;
    elements.status.textContent = message;
    elements.status.dataset.tone = tone;
  }

  function filteredJobs() {
    const jobs = state.overview?.jobs || [];
    const filter = state.jobsFilter.trim().toLowerCase();
    if (!filter) return jobs;
    return jobs.filter((job) => String(job.search_text || `${job.title} ${job.subtitle}`).toLowerCase().includes(filter));
  }

  function renderMetrics() {
    if (!state.overview) return;
    for (const [key, node] of Object.entries(elements.metrics)) {
      if (!node) continue;
      node.textContent = String(state.overview.metrics?.[key] ?? 0);
    }
  }

  function renderJobs() {
    if (!elements.jobsList) return;
    const jobs = filteredJobs();
    elements.jobsList.innerHTML = jobs.map((job) => `
      <article class="wb-job" data-job-key="${escapeHtml(job.key)}">
        <div class="wb-job-copy">
          <div class="wb-job-title-row">
            <a class="wb-job-link" href="${escapeHtml(job.href || '#')}">${escapeHtml(job.title)}</a>
            <span class="wb-badge" data-tone="${escapeHtml(job.status_tone || 'active')}">${escapeHtml(job.status)}</span>
          </div>
          <p class="wb-job-meta">${escapeHtml(job.subtitle || 'Job')}</p>
        </div>
        <div class="wb-job-side">
          <span>${escapeHtml(formatDateLabel(job.date_label))}</span>
          <span>${escapeHtml(formatMoney(job.amount))}</span>
        </div>
      </article>
    `).join('');

    if (elements.jobsEmpty) {
      const empty = jobs.length === 0;
      elements.jobsEmpty.hidden = !empty;
      elements.jobsEmpty.textContent = empty ? DEFAULT_EMPTY_MESSAGE : '';
    }
  }

  function renderFlagged() {
    if (!elements.flaggedList) return;
    const items = state.overview?.flagged_items || [];
    elements.flaggedList.innerHTML = items.length ? items.map((item) => `
      <article class="wb-flag" data-entity-type="${escapeHtml(item.entity_type)}" data-entity-id="${escapeHtml(item.entity_id)}">
        <div class="wb-flag-copy">
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.summary || item.subtitle || '')}</p>
          <span class="wb-flag-audit">${item.reviewed_at ? `Reviewed ${escapeHtml(formatCalendarLabel(item.reviewed_at))}` : 'Awaiting review'}</span>
        </div>
        <button
          class="wb-button wb-button-secondary"
          data-workbench-review
          data-entity-type="${escapeHtml(item.entity_type)}"
          data-entity-id="${escapeHtml(item.entity_id)}"
          ${item.reviewed ? 'disabled' : ''}
        >${escapeHtml(item.review_label || 'Review')}</button>
      </article>
    `).join('') : '<p class="wb-empty">No flagged items.</p>';
  }

  function renderTasks() {
    if (!elements.tasksList) return;
    const tasks = state.overview?.tasks || [];
    elements.tasksList.innerHTML = tasks.length ? tasks.map((task) => `
      <li class="wb-task">
        <span class="wb-task-kind">${escapeHtml(task.kind)}</span>
        <div>
          <strong>${escapeHtml(task.title)}</strong>
          <p>${escapeHtml(task.detail)}</p>
        </div>
      </li>
    `).join('') : '<li class="wb-empty">No actions due today.</li>';
  }

  function renderCalendar() {
    if (!elements.calendarList) return;
    const items = state.overview?.calendar || [];
    elements.calendarList.innerHTML = items.length ? items.map((item) => `
      <li class="wb-calendar-item">
        <span class="wb-calendar-date">${escapeHtml(formatCalendarLabel(item.starts_at))}</span>
        <div>
          <strong>${escapeHtml(item.label)}</strong>
          <p>${escapeHtml(item.detail || item.status || '')}</p>
        </div>
      </li>
    `).join('') : '<li class="wb-empty">No scheduled dates yet.</li>';
  }

  function renderHeader() {
    const user = state.overview?.user || {};
    const report = state.overview?.report || reportConfigForRole(user.role);
    if (elements.title) {
      const firstName = String(user.name || user.username || 'there').trim().split(/\s+/)[0];
      elements.title.textContent = `Workbench for ${firstName}`;
    }
    if (elements.subtitle) {
      elements.subtitle.textContent = `${state.overview?.metrics?.jobs ?? 0} jobs in scope · ${state.overview?.metrics?.flagged ?? 0} flagged items`;
    }
    if (elements.reportButton) {
      elements.reportButton.href = report.href || `/reports.html?view=${encodeURIComponent(report.view)}`;
      elements.reportButton.textContent = report.label || 'Open reports';
      elements.reportButton.dataset.reportView = report.view || '';
    }
  }

  function render() {
    renderHeader();
    renderMetrics();
    renderJobs();
    renderFlagged();
    renderTasks();
    renderCalendar();
  }

  async function reviewFlag(entityType, entityId) {
    const result = await api('/workbench/reviews', {
      method: 'POST',
      body: {
        entity_type: entityType,
        entity_id: entityId,
        note: 'Reviewed from workbench',
      },
    });
    const review = result?.review;
    if (!review || !state.overview) return;
    state.overview.flagged_items = (state.overview.flagged_items || []).map((item) => {
      if (item.entity_type !== entityType || Number(item.entity_id) !== Number(entityId)) return item;
      return {
        ...item,
        reviewed: true,
        reviewed_at: review.reviewed_at,
        review_label: 'Reviewed',
      };
    });
    state.overview.metrics.flagged = state.overview.flagged_items.filter((item) => !item.reviewed).length;
    state.overview.tasks = (state.overview.tasks || []).filter((task) => task.key !== `task:${entityType}:${entityId}`);
    render();
    setStatus('Flag review recorded to the audit trail.', 'success');
  }

  function bindEvents() {
    if (elements.searchInput) {
      elements.searchInput.addEventListener('input', (event) => {
        state.jobsFilter = event.target.value || '';
        renderJobs();
      });
    }

    if (elements.flaggedList) {
      elements.flaggedList.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-workbench-review]');
        if (!button) return;
        const { entityType, entityId } = button.dataset;
        button.disabled = true;
        try {
          await reviewFlag(entityType, Number(entityId));
        } catch (error) {
          button.disabled = false;
          setStatus(error?.message || 'Could not record review.', 'error');
        }
      });
    }
  }

  async function load() {
    state.loading = true;
    setStatus('Loading workbench…');
    const me = await authGuard();
    const overview = await api('/workbench/overview');
    state.overview = overview?.user ? overview : { ...overview, user: me };
    state.loading = false;
    render();
    setStatus('Workbench ready.');
    return state.overview;
  }

  bindEvents();

  return {
    elements,
    state,
    load,
    render,
    reviewFlag,
  };
}

export function bootWorkbenchPage() {
  const app = createWorkbenchApp();
  app.load().catch((error) => {
    app.elements.jobsList?.replaceChildren();
    app.elements.flaggedList?.replaceChildren();
    app.elements.tasksList?.replaceChildren();
    app.elements.calendarList?.replaceChildren();
    if (app.elements.jobsEmpty) {
      app.elements.jobsEmpty.hidden = false;
      app.elements.jobsEmpty.textContent = error?.message || 'Could not load the workbench.';
    }
    if (app.elements.status) {
      app.elements.status.textContent = error?.message || 'Could not load the workbench.';
      app.elements.status.dataset.tone = 'error';
    }
  });
  return app;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.body?.dataset?.hfPage === 'workbench') {
  window.__workbenchApp = bootWorkbenchPage();
}
