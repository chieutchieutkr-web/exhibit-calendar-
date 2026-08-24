(() => {
  const state = {
    exhibitions: [],
    viewYear: null,
    viewMonth: null, // 0-indexed
    selectedDate: null, // "YYYY-MM-DD" or null
  };

  const $ = (sel) => document.querySelector(sel);
  const calGrid = $('#calGrid');
  const monthLabel = $('#monthLabel');
  const agendaList = $('#agendaList');
  const agendaTitle = $('#agendaTitle');
  const clearFilterBtn = $('#clearFilter');
  const sheetOverlay = $('#detailSheet');
  const sheetBody = $('#sheetBody');

  function pad(n) { return String(n).padStart(2, '0'); }
  function toISO(y, m, d) { return `${y}-${pad(m + 1)}-${pad(d)}`; }
  function parseISO(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  // "제목(장소/소요시간/야간요일 시간)" 형식 조합
  function calendarTitle(ex) {
    const parts = [ex.venue, ex.transit?.text].filter(Boolean);
    if (ex.nightOpen && ex.nightOpen.days && ex.nightOpen.time) {
      parts.push(`${ex.nightOpen.days} ${ex.nightOpen.time}`);
    }
    return `${ex.title}(${parts.join('/')})`;
  }

  function fmtDate(iso) {
    const d = parseISO(iso);
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
  }

  function isActiveOn(ex, iso) {
    return iso >= ex.period.start && iso <= ex.period.end;
  }

  async function loadData() {
    const res = await fetch('data/exhibitions.json', { cache: 'no-store' });
    const json = await res.json();
    state.exhibitions = json.exhibitions || [];
    $('#genAt').textContent = json.generatedAt ? `최근 업데이트: ${json.generatedAt}` : '';
  }

  function renderCalendar() {
    const { viewYear, viewMonth } = state;
    monthLabel.textContent = `${viewYear}년 ${viewMonth + 1}월`;
    calGrid.innerHTML = '';

    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const startWeekday = firstOfMonth.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const todayISO = toISO(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

    const cells = [];
    for (let i = startWeekday - 1; i >= 0; i--) {
      cells.push({ day: daysInPrevMonth - i, otherMonth: true, y: viewMonth === 0 ? viewYear - 1 : viewYear, m: viewMonth === 0 ? 11 : viewMonth - 1 });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, otherMonth: false, y: viewYear, m: viewMonth });
    }
    while (cells.length % 7 !== 0) {
      const last = cells[cells.length - 1];
      const nm = last.m === 11 ? 0 : last.m + 1;
      const ny = last.m === 11 ? last.y + 1 : last.y;
      cells.push({ day: cells.length - (startWeekday + daysInMonth) + 1, otherMonth: true, y: ny, m: nm });
    }

    cells.forEach((c) => {
      const iso = toISO(c.y, c.m, c.day);
      const btn = document.createElement('button');
      btn.className = 'cal-day' + (c.otherMonth ? ' other-month' : '') + (iso === todayISO ? ' today' : '') + (iso === state.selectedDate ? ' selected' : '');
      btn.innerHTML = `<span class="daynum">${c.day}</span>`;

      const activeExs = state.exhibitions.filter((ex) => isActiveOn(ex, iso));
      if (activeExs.length) {
        const dots = document.createElement('div');
        dots.className = 'dots';
        activeExs.slice(0, 4).forEach((ex) => {
          const dot = document.createElement('span');
          dot.className = 'dot' + (ex.nightOpen ? ' night' : '');
          dots.appendChild(dot);
        });
        btn.appendChild(dots);
      }

      btn.addEventListener('click', () => {
        state.selectedDate = state.selectedDate === iso ? null : iso;
        renderCalendar();
        renderAgenda();
      });
      calGrid.appendChild(btn);
    });
  }

  function renderAgenda() {
    agendaList.innerHTML = '';
    let list;
    if (state.selectedDate) {
      list = state.exhibitions.filter((ex) => isActiveOn(ex, state.selectedDate));
      agendaTitle.textContent = `${fmtDate(state.selectedDate)} 전시`;
      clearFilterBtn.hidden = false;
    } else {
      const todayISO = toISO(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
      list = state.exhibitions
        .filter((ex) => ex.period.end >= todayISO)
        .sort((a, b) => a.period.start.localeCompare(b.period.start));
      agendaTitle.textContent = '진행중 · 예정 전시';
      clearFilterBtn.hidden = true;
    }

    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'empty-msg';
      li.textContent = '해당 날짜에 전시 정보가 없습니다.';
      agendaList.appendChild(li);
      return;
    }

    list.forEach((ex) => {
      const li = document.createElement('li');
      li.className = 'agenda-item';
      const compound = calendarTitle(ex);
      li.innerHTML = `
        <div class="title-line">${escapeHtml(ex.title)} <span class="venue-part">(${[ex.venue, ex.transit?.text].filter(Boolean).join(' / ')}${ex.nightOpen ? ' / ' + ex.nightOpen.days + ' ' + ex.nightOpen.time : ''})</span></div>
        <div class="period-line">${fmtDate(ex.period.start)}${ex.period.startApprox ? '(추정)' : ''} ~ ${fmtDate(ex.period.end)}</div>
        <div class="badges">
          <span class="badge">${escapeHtml(ex.venue)}</span>
          ${ex.nightOpen ? `<span class="badge night">야간 ${ex.nightOpen.days} ${ex.nightOpen.time}</span>` : ''}
        </div>`;
      li.title = compound;
      li.addEventListener('click', () => openDetail(ex));
      agendaList.appendChild(li);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function openDetail(ex) {
    sheetBody.innerHTML = `
      <h3>${escapeHtml(ex.title)}</h3>
      <div class="field"><div class="label">작가</div><div class="value">${escapeHtml(ex.artist)}</div></div>
      <div class="field"><div class="label">장소 및 주소</div><div class="value">${escapeHtml(ex.venue)}<br/>${escapeHtml(ex.address)}</div></div>
      <div class="field"><div class="label">전시 기간</div><div class="value">${fmtDate(ex.period.start)}${ex.period.startApprox ? '(추정)' : ''} ~ ${fmtDate(ex.period.end)}</div></div>
      <div class="field"><div class="label">전시 시간</div><div class="value">${escapeHtml(ex.hours || '-')}${ex.closedDay ? `<br/>휴관일: ${escapeHtml(ex.closedDay)}` : ''}${ex.nightOpen ? `<br/>야간개장: ${escapeHtml(ex.nightOpen.days)} ${escapeHtml(ex.nightOpen.time)}까지` : ''}</div></div>
      <div class="field"><div class="label">건국대병원 기준 대중교통 소요시간</div><div class="value">${escapeHtml(ex.transit?.text || '-')}${ex.transit?.note ? `<br/><span style="color:var(--ink-soft);font-size:0.8rem;">${escapeHtml(ex.transit.note)}</span>` : ''}</div></div>
      ${ex.features?.length ? `<div class="field"><div class="label">전시 특징</div><ul class="feature-list">${ex.features.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul></div>` : ''}
      ${ex.artistIntro ? `<div class="field"><div class="label">작가 소개</div><div class="value">${escapeHtml(ex.artistIntro)}</div></div>` : ''}
      ${ex.video?.url ? `<a class="video-link" href="${ex.video.url}" target="_blank" rel="noopener">▶ ${escapeHtml(ex.video.channel || '')} 추천 영상 보기</a>` : ''}
    `;
    sheetOverlay.hidden = false;
  }

  function closeDetail() {
    sheetOverlay.hidden = true;
  }

  $('#closeSheet').addEventListener('click', closeDetail);
  sheetOverlay.addEventListener('click', (e) => { if (e.target === sheetOverlay) closeDetail(); });
  clearFilterBtn.addEventListener('click', () => {
    state.selectedDate = null;
    renderCalendar();
    renderAgenda();
  });
  $('#prevMonth').addEventListener('click', () => {
    state.viewMonth -= 1;
    if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear -= 1; }
    renderCalendar();
  });
  $('#nextMonth').addEventListener('click', () => {
    state.viewMonth += 1;
    if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear += 1; }
    renderCalendar();
  });

  (async function init() {
    const now = new Date();
    state.viewYear = now.getFullYear();
    state.viewMonth = now.getMonth();
    await loadData();
    renderCalendar();
    renderAgenda();
  })();
})();
