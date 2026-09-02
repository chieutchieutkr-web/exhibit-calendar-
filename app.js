(() => {
  const SAVE_KEY = 'exhibitionCalendar.saved.v1';
  const REMINDER_DAYS = 7;

  const state = {
    exhibitions: [],
    origin: { lat: 37.5407, lng: 127.0700, label: '건대입구' },
    generatedAt: '',
    tab: 'cal',
    sel: null,          // 선택 날짜 ISO
    focus: null,        // 지도에서 focus된 전시 id
    open: null,         // 상세 시트에 열린 전시 id
    saved: loadSaved(),
    mapQuery: '',
    mapSort: 'time',    // 'time' | 'name'
    mapBoundsFitted: false,
    myLocation: null,  // { lat, lng } — "내 위치" 버튼으로 얻은 실제 현재 위치
    locating: false,
    searchOrigin: null, // { lat, lng, label } — 지도 검색창에서 지정한 임의 기준 위치(내 위치보다 우선)
    searching: false,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ---------- 유틸 ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function toISO(y, m, d) { return `${y}-${pad(m + 1)}-${pad(d)}`; }
  function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function todayISO() { const n = new Date(); return toISO(n.getFullYear(), n.getMonth(), n.getDate()); }
  function daysBetween(aIso, bIso) {
    const a = Date.UTC(...aIso.split('-').map(Number).map((v, i) => (i === 1 ? v - 1 : v)));
    const b = Date.UTC(...bIso.split('-').map(Number).map((v, i) => (i === 1 ? v - 1 : v)));
    return Math.round((b - a) / 86400000);
  }
  function fmtDate(iso) { const d = parseISO(iso); return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`; }
  function overlapsRange(ex, startIso, endIso) { return ex.period.start <= endIso && ex.period.end >= startIso; }
  function isActiveOn(ex, iso) { return overlapsRange(ex, iso, iso); }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function nightLabel(ex) { return ex.nightOpen && ex.nightOpen.days && ex.nightOpen.time ? `${ex.nightOpen.days} ~${ex.nightOpen.time}` : null; }
  function calendarTitle(ex) {
    const parts = [ex.venue, ex.transit?.text, nightLabel(ex)].filter(Boolean);
    return `${ex.title}(${parts.join('/')})`;
  }

  function youtubeId(url) {
    if (!url) return null;
    const m = url.match(/(?:v=|youtu\.be\/|\/shorts\/)([\w-]{6,})/);
    return m ? m[1] : null;
  }
  function thumbUrl(ex) {
    if (ex.imageUrl) return ex.imageUrl;
    const id = youtubeId(ex.video?.url);
    return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
  }
  // 직선거리(km) 계산 — 실제 대중교통 경로가 아닌 대략적 추정용
  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  // 직선거리 기반 대중교통 소요시간 대략 추정(도보+환승 여유 포함) — 실측 경로가 아님, 참고용
  function estimateMinutesFromDistance(km) {
    const raw = 12 + (km / 17) * 60; // 기본 도보/환승 여유 12분 + 평균 이동속도 17km/h 가정
    return Math.max(5, Math.round(raw / 5) * 5);
  }
  function activeRef() {
    if (state.searchOrigin) return { ...state.searchOrigin, kind: state.searchOrigin.label };
    if (state.myLocation) return { ...state.myLocation, kind: '내 위치' };
    return null;
  }
  function myLocationEstimateHtml(ex, sep = '<br/>') {
    const ref = activeRef();
    if (!ref || ex.lat == null || ex.lng == null) return '';
    const km = haversineKm(ref.lat, ref.lng, ex.lat, ex.lng);
    const mins = estimateMinutesFromDistance(km);
    return `${sep}${escapeHtml(ref.kind)} 기준 약 ${mins}분(직선거리 추정)`;
  }

  function parseTransitMinutes(text) {
    if (!text) return Infinity;
    const firstPart = text.split('~')[0];
    const h = firstPart.match(/(\d+)\s*시간/);
    const m = firstPart.match(/(\d+)\s*분/);
    let mins = 0;
    if (h) mins += parseInt(h[1], 10) * 60;
    if (m) mins += parseInt(m[1], 10);
    return mins || Infinity;
  }

  function ddayInfo(ex, today) {
    const { start, end } = ex.period;
    if (today < start) return { label: `D-${daysBetween(today, start)} 개막`, color: 'var(--ink-soft)', progress: 0 };
    if (today > end) return { label: '전시 종료', color: 'var(--ink-soft2)', progress: 1 };
    const total = Math.max(daysBetween(start, end), 1);
    const elapsed = daysBetween(start, today);
    const progress = clamp(elapsed / total, 0, 1);
    const daysLeft = daysBetween(today, end);
    if (daysLeft <= 30) return { label: `종료 D-${daysLeft}`, color: ex.color, progress };
    return { label: `${daysLeft}일 남음`, color: ex.color, progress };
  }

  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY) || '[]'); } catch { return []; }
  }
  function persistSaved() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state.saved)); } catch { /* 저장 공간 없음 — 무시 */ }
  }

  async function loadData() {
    const res = await fetch('data/exhibitions.json', { cache: 'no-store' });
    const json = await res.json();
    state.exhibitions = json.exhibitions || [];
    state.generatedAt = json.generatedAt || '';
    if (json.origin?.lat != null) state.origin = { lat: json.origin.lat, lng: json.origin.lng, label: '건대입구' };
    $('#genAt2').textContent = state.generatedAt;
  }

  function exById(id) { return state.exhibitions.find((e) => e.id === id); }

  // ---------- 탭 전환 ----------
  function switchTab(tab) {
    state.tab = tab;
    $$('.tab-view').forEach((el) => { el.hidden = el.id !== `tab-${tab}`; });
    $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    if (tab === 'cal') renderCalendarTab();
    if (tab === 'map') renderMapTab();
    if (tab === 'saved') renderSavedTab();
  }

  // ---------- 썸네일 마크업 ----------
  function thumbHtml(ex, size) {
    const url = thumbUrl(ex);
    const initial = escapeHtml((ex.venue || ex.title || '?').trim().charAt(0));
    if (url) {
      return `<div class="ex-thumb" style="background:${ex.color}"><img src="${url}" alt="" loading="lazy" onerror="this.remove()" /></div>`;
    }
    return `<div class="ex-thumb" style="background:${ex.color}"><span class="initial">${initial}</span><span class="imglabel">이미지</span></div>`;
  }

  // ---------- 캘린더 탭 ----------
  function renderDateStrip() {
    const strip = $('#dateStrip');
    strip.innerHTML = '';
    const selDate = parseISO(state.sel);
    const today = todayISO();
    const dows = ['일', '월', '화', '수', '목', '금', '토'];
    for (let offset = -3; offset <= 8; offset++) {
      const d = new Date(selDate);
      d.setDate(d.getDate() + offset);
      const iso = toISO(d.getFullYear(), d.getMonth(), d.getDate());
      const cell = document.createElement('button');
      cell.className = 'date-cell' + (iso === state.sel ? ' selected' : '') + (iso === today ? ' today' : '');
      const active = state.exhibitions.filter((ex) => isActiveOn(ex, iso)).slice(0, 3);
      cell.innerHTML = `
        <span class="dow">${dows[d.getDay()]}</span>
        <span class="dnum">${d.getDate()}</span>
        <span class="ddots">${active.map((ex) => `<span style="background:${ex.color}"></span>`).join('')}</span>`;
      cell.addEventListener('click', () => { state.sel = iso; renderCalendarTab(); });
      strip.appendChild(cell);
    }
    // 선택된 셀이 보이도록 스크롤(대략 중앙 근처: -3이 시작이므로 살짝 왼쪽 여백만 확보됨)
    requestAnimationFrame(() => {
      const selEl = strip.querySelector('.date-cell.selected');
      if (selEl) selEl.scrollIntoView({ inline: 'center', block: 'nearest' });
    });
  }

  function renderCalendarTab() {
    if (!state.sel) state.sel = todayISO();
    const d = parseISO(state.sel);
    $('#calMonth').textContent = `${d.getMonth() + 1}월`;
    $('#calYear').textContent = `${d.getFullYear()}`;
    renderDateStrip();

    const dows = ['일', '월', '화', '수', '목', '금', '토'];
    $('#selDateLabel').textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 ${dows[d.getDay()]}요일`;
    const list = state.exhibitions.filter((ex) => isActiveOn(ex, state.sel));
    $('#selCountLabel').textContent = `전시 ${list.length}개`;

    const ul = $('#calCardList');
    ul.innerHTML = '';
    if (!list.length) {
      ul.innerHTML = `<li class="saved-empty">이 날짜에 열려 있는 전시가 없어요.</li>`;
      return;
    }
    list.sort((a, b) => parseTransitMinutes(a.transit?.text) - parseTransitMinutes(b.transit?.text));
    list.forEach((ex) => ul.appendChild(makeExCard(ex)));
  }

  function makeExCard(ex) {
    const li = document.createElement('li');
    const dd = ddayInfo(ex, todayISO());
    li.innerHTML = `
      <button class="ex-card" title="${escapeHtml(calendarTitle(ex))}">
        ${thumbHtml(ex)}
        <div class="ex-body">
          <div class="ex-title">${escapeHtml(ex.title)}</div>
          <div class="ex-meta">${escapeHtml(ex.venue)} · ${escapeHtml(ex.transit?.text || '-')}</div>
          <div class="ex-progress-row">
            <div class="ex-progress-track"><div class="ex-progress-fill" style="width:${Math.round(dd.progress * 100)}%;background:${ex.color}"></div></div>
            <span class="ex-dday" style="color:${dd.color}">${dd.label}</span>
          </div>
        </div>
      </button>`;
    li.querySelector('.ex-card').addEventListener('click', () => openDetail(ex.id));
    return li;
  }

  // ---------- 지도 탭 (네이버 지도 SDK) ----------
  let naverMap = null;
  let naverOriginMarker = null;
  let naverMyLocationMarker = null;
  let naverSearchMarker = null;
  let naverMarkers = []; // { id, marker }

  function recenterMap(lat, lng, zoom = 13) {
    const map = ensureNaverMap();
    if (!map) return;
    map.setCenter(new naver.maps.LatLng(lat, lng));
    map.setZoom(zoom);
  }

  // 검색창에 지역/장소를 입력하면 그 지점을 기준으로 재설정(서버의 /api/geocode 프록시 사용)
  async function searchPlace(q) {
    if (!q.trim() || state.searching) return;
    const status = $('#locateStatus');
    state.searching = true;
    status.hidden = false;
    status.textContent = `"${q}" 검색 중…`;
    try {
      const res = await fetch('/api/geocode?q=' + encodeURIComponent(q));
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '검색 실패');
      state.searchOrigin = { lat: json.lat, lng: json.lng, label: json.label };
      state.mapQuery = ''; // 검색창 글자가 이름 필터로도 쓰이던 것 때문에 결과가 안 보이던 문제 방지
      status.textContent = `"${json.label}" 기준으로 이동시간을 표시할게요 (직선거리 추정치)`;
      renderMapTab();
      recenterMap(json.lat, json.lng, 14);
    } catch (e) {
      status.textContent = e.message.includes('fetch') ? '검색 기능은 배포된 사이트에서만 동작해요 (로컬 미리보기에서는 지원 안 함)' : ('검색 실패: ' + e.message);
    } finally {
      state.searching = false;
    }
  }

  function locateMe() {
    const btn = $('#locateBtn');
    const status = $('#locateStatus');
    if (!navigator.geolocation) {
      status.textContent = '이 브라우저는 위치 확인을 지원하지 않아요';
      status.hidden = false;
      return;
    }
    state.locating = true;
    btn.classList.add('locating');
    status.textContent = '내 위치 확인 중…';
    status.hidden = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.myLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        state.locating = false;
        btn.classList.remove('locating');
        status.textContent = '내 위치 기준으로 이동시간을 함께 표시할게요 (직선거리 추정치)';
        renderMapTab();
      },
      (err) => {
        state.locating = false;
        btn.classList.remove('locating');
        const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
        if (err.code === 1 && isStandalone) {
          status.textContent = '홈 화면 앱에서는 위치 권한이 막힐 때가 있어요 — Safari에서 이 사이트를 직접 열어 사용해주세요';
        } else if (err.code === 1) {
          status.textContent = '위치 권한이 꺼져있어요 — 브라우저의 사이트 설정에서 위치를 허용해주세요';
        } else {
          status.textContent = '위치를 확인할 수 없었어요. 다시 시도해주세요';
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  function ensureNaverMap() {
    if (naverMap || typeof naver === 'undefined' || !naver.maps) return naverMap;
    naverMap = new naver.maps.Map('naverMapEl', {
      center: new naver.maps.LatLng(state.origin.lat, state.origin.lng),
      zoom: 12,
      scaleControl: false,
      logoControl: false,
      mapDataControl: false,
      zoomControl: true,
      zoomControlOptions: { position: naver.maps.Position.RIGHT_CENTER },
    });
    return naverMap;
  }

  function pinTimeText(ex) {
    const ref = activeRef();
    if (ref && ex.lat != null && ex.lng != null) {
      const km = haversineKm(ref.lat, ref.lng, ex.lat, ex.lng);
      return `약 ${estimateMinutesFromDistance(km)}분`;
    }
    return ex.transit?.text || '';
  }

  function pinIconHtml(ex, isFocused) {
    const timeText = escapeHtml(pinTimeText(ex).replace('약 ', ''));
    const label = isFocused
      ? `<span class="pin-label" style="background:${ex.color};color:#fff;">${escapeHtml(ex.venue)} · ${timeText}</span>`
      : `<span class="pin-label" style="color:${ex.color};">${timeText}</span>`;
    return `<div class="pin-content${isFocused ? ' focused' : ''}">${label}<span class="pin-stem" style="background:${ex.color}"></span></div>`;
  }

  function renderMapTab() {
    const map = ensureNaverMap();
    if (!map) return; // 네이버 지도 스크립트 로드 전(드물게) — switchTab 재호출 시 다시 시도됨
    // 탭 전환으로 컨테이너가 숨겨졌다 다시 보일 때 지도가 크기를 못 잡는 문제 방지
    naver.maps.Event.trigger(map, 'resize');

    const withCoords = state.exhibitions.filter((ex) => ex.lat != null && ex.lng != null);
    const offMap = state.exhibitions.filter((ex) => ex.lat == null || ex.lng == null);
    const chip = $('#offMapChip');
    if (offMap.length) {
      chip.hidden = false;
      const names = offMap.map((e) => e.venue.split(/[ (]/)[0]).join('·');
      chip.textContent = `${names} 전시 ${offMap.length}건은 지도 밖 ↗`;
      chip.onclick = () => { state.focus = offMap[0].id; renderMapTab(); openMapCarouselScrollTo(offMap[0].id); };
    } else {
      chip.hidden = true;
    }

    if (!naverOriginMarker) {
      naverOriginMarker = new naver.maps.Marker({
        map,
        position: new naver.maps.LatLng(state.origin.lat, state.origin.lng),
        icon: {
          content: `<div class="origin-content"><span class="origin-dot"></span><span class="origin-label">기준: ${escapeHtml(state.origin.label)}</span></div>`,
          anchor: new naver.maps.Point(7, 7),
        },
        zIndex: 50,
      });
    }

    if (state.myLocation) {
      const pos = new naver.maps.LatLng(state.myLocation.lat, state.myLocation.lng);
      if (naverMyLocationMarker) {
        naverMyLocationMarker.setPosition(pos);
      } else {
        naverMyLocationMarker = new naver.maps.Marker({
          map,
          position: pos,
          icon: {
            content: `<div class="my-location-content"><span class="my-location-pulse"></span><span class="my-location-dot"></span></div>`,
            anchor: new naver.maps.Point(9, 9),
          },
          zIndex: 60,
        });
      }
    }

    if (state.searchOrigin) {
      const pos = new naver.maps.LatLng(state.searchOrigin.lat, state.searchOrigin.lng);
      const content = `<div class="origin-content"><span class="origin-dot" style="background:var(--brand)"></span><span class="origin-label" style="background:var(--brand)">검색: ${escapeHtml(state.searchOrigin.label)}</span></div>`;
      if (naverSearchMarker) { naverSearchMarker.setPosition(pos); naverSearchMarker.setIcon({ content, anchor: new naver.maps.Point(7, 7) }); naverSearchMarker.setMap(map); }
      else naverSearchMarker = new naver.maps.Marker({ map, position: pos, icon: { content, anchor: new naver.maps.Point(7, 7) }, zIndex: 55 });
    } else if (naverSearchMarker) {
      naverSearchMarker.setMap(null);
    }

    // 기존 마커 제거 후 새로 그림(전시 수가 적어 성능상 문제 없음)
    naverMarkers.forEach((m) => m.marker.setMap(null));
    naverMarkers = [];

    const items = withCoords.filter((ex) => matchesQuery(ex, state.mapQuery));
    const bounds = new naver.maps.LatLngBounds(new naver.maps.LatLng(state.origin.lat, state.origin.lng), new naver.maps.LatLng(state.origin.lat, state.origin.lng));

    items.forEach((ex) => {
      const isFocused = state.focus === ex.id;
      const pos = new naver.maps.LatLng(ex.lat, ex.lng);
      bounds.extend(pos);
      const marker = new naver.maps.Marker({
        map,
        position: pos,
        icon: { content: pinIconHtml(ex, isFocused), anchor: new naver.maps.Point(30, isFocused ? 40 : 28) },
        zIndex: isFocused ? 20 : 5,
      });
      naver.maps.Event.addListener(marker, 'click', () => {
        state.focus = ex.id;
        renderMapTab();
        openMapCarouselScrollTo(ex.id);
        openDetail(ex.id);
      });
      naverMarkers.push({ id: ex.id, marker });
    });

    if (items.length && !state.mapBoundsFitted) {
      map.fitBounds(bounds, { top: 110, right: 30, bottom: 260, left: 30 });
      state.mapBoundsFitted = true;
    }

    renderMapCarousel();
  }

  function matchesQuery(ex, q) {
    if (!q) return true;
    const hay = `${ex.title} ${ex.venue}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  }

  function renderMapCarousel() {
    const focusLabel = $('#carouselFocusLabel');
    if (state.focus && exById(state.focus)) {
      focusLabel.hidden = false;
      focusLabel.textContent = exById(state.focus).venue;
    } else {
      focusLabel.hidden = true;
    }

    let list = state.exhibitions.filter((ex) => matchesQuery(ex, state.mapQuery));
    const ref = activeRef();
    if (state.mapSort === 'name') {
      list = list.slice().sort((a, b) => a.title.localeCompare(b.title, 'ko'));
    } else if (ref) {
      // 검색한 위치/내 위치가 있으면 그 기준 실제 거리순으로 (건대입구 고정 데이터보다 우선)
      list = list.slice().sort((a, b) => {
        const da = (a.lat != null && a.lng != null) ? haversineKm(ref.lat, ref.lng, a.lat, a.lng) : Infinity;
        const db = (b.lat != null && b.lng != null) ? haversineKm(ref.lat, ref.lng, b.lat, b.lng) : Infinity;
        return da - db;
      });
    } else {
      list = list.slice().sort((a, b) => parseTransitMinutes(a.transit?.text) - parseTransitMinutes(b.transit?.text));
    }
    $('#carouselModeLabel').textContent = ref ? `${ref.kind} 가까운 순` : '이동시간 가까운 순';

    const wrap = $('#mapCarousel');
    wrap.innerHTML = '';
    list.forEach((ex) => {
      const card = document.createElement('button');
      card.className = 'map-card' + (state.focus === ex.id ? ' focused' : '');
      card.style.setProperty('--card-color', ex.color);
      if (state.focus === ex.id) card.style.borderColor = ex.color;
      const naver = naverDirectionsUrl(ex);
      card.innerHTML = `
        ${thumbHtml(ex)}
        <div>
          <div class="mc-title">${escapeHtml(ex.title)}</div>
          <div class="mc-addr">${escapeHtml(ex.address)}</div>
          <div class="mc-time" style="color:${ex.color}">${escapeHtml(pinTimeText(ex) || '-')}</div>
          <a class="mc-route" style="background:${ex.colorSoft};color:${ex.color}" href="${naver}" target="_blank" rel="noopener">네이버지도로 길찾기</a>
        </div>`;
      card.addEventListener('click', (e) => {
        if (e.target.closest('.mc-route')) return; // 링크 클릭은 상세시트로 안 이어지게
        state.focus = ex.id;
        renderMapTab();
        openDetail(ex.id);
      });
      wrap.appendChild(card);
      card.dataset.exId = ex.id;
    });
  }

  function openMapCarouselScrollTo(id) {
    requestAnimationFrame(() => {
      const el = $(`#mapCarousel [data-ex-id="${id}"]`) || $$('.map-card').find((c) => c.dataset.exId === id);
      if (el) el.scrollIntoView({ inline: 'center', block: 'nearest' });
    });
  }

  // 네이버 지도 검색 링크로 이동(키/앱 설치 여부와 무관하게 항상 열림).
  // 추후 실제 경로 안내가 필요하면 nmap://route/public?dlat=..&dlng=..&dname=..&appname=.. 딥링크로 교체 가능(README 참고).
  function naverDirectionsUrl(ex) {
    // 장소명 + 주소를 같이 붙이면 네이버지도 검색이 못 찾는 경우가 있어 장소명만 사용
    // (전시실 번호 등 괄호 안 부가정보는 검색에 방해되므로 제거)
    const cleanVenue = ex.venue.replace(/\s*\(.*$/, '').trim();
    return `https://map.naver.com/p/search/${encodeURIComponent(cleanVenue)}`;
  }

  // ---------- 저장 탭 ----------
  function toggleSave(id) {
    const idx = state.saved.indexOf(id);
    if (idx === -1) state.saved.push(id); else state.saved.splice(idx, 1);
    persistSaved();
    if (state.tab === 'saved') renderSavedTab();
    if (state.open === id) openDetail(id); // 시트 다시 그려서 토글 상태 반영
    if (state.tab === 'cal') renderCalendarTab();
  }

  function renderSavedTab() {
    const ids = state.saved.filter((id) => exById(id));
    $('#savedSub').textContent = `저장한 전시 ${ids.length}개 · 종료 ${REMINDER_DAYS}일 전 알림`;
    const ul = $('#savedList');
    ul.innerHTML = '';

    const reminders = ids
      .map((id) => exById(id))
      .filter((ex) => { const d = daysBetween(todayISO(), ex.period.end); return d >= 0 && d <= REMINDER_DAYS; });
    if (reminders.length) {
      const banner = document.createElement('li');
      banner.className = 'toast-banner';
      banner.textContent = `🔔 ${reminders.map((e) => e.title).join(', ')} 종료가 얼마 남지 않았어요.`;
      ul.appendChild(banner);
    }

    if (!ids.length) {
      ul.innerHTML += `<li class="saved-empty">전시 카드를 탭해 상세에서 저장하면<br/>여기에 모이고 종료 임박 알림이 옵니다</li>`;
      return;
    }
    ids.forEach((id) => {
      const ex = exById(id);
      const dd = ddayInfo(ex, todayISO());
      const li = document.createElement('li');
      li.innerHTML = `
        <button class="ex-card" style="cursor:pointer">
          ${thumbHtml(ex)}
          <div class="ex-body">
            <div class="ex-title">${escapeHtml(ex.title)}</div>
            <div class="ex-meta">${fmtDate(ex.period.start)} – ${fmtDate(ex.period.end)}</div>
            <div class="saved-card-bottom">
              <span class="ex-dday" style="color:${dd.color}">${dd.label}</span>
              <span class="save-toggle-pill delete-pill" data-id="${ex.id}">🗑 삭제</span>
            </div>
          </div>
        </button>`;
      li.querySelector('.ex-card').addEventListener('click', (e) => {
        if (e.target.closest('.save-toggle-pill')) return;
        openDetail(ex.id);
      });
      li.querySelector('.save-toggle-pill').addEventListener('click', (e) => { e.stopPropagation(); toggleSave(ex.id); });
      ul.appendChild(li);
    });
  }

  // ---------- 상세 바텀시트 ----------
  function openDetail(id) {
    const ex = exById(id);
    if (!ex) return;
    state.open = id;
    const isSaved = state.saved.includes(id);
    const dd = ddayInfo(ex, todayISO());
    const thumb = thumbUrl(ex);
    const initial = escapeHtml((ex.venue || ex.title || '?').trim().charAt(0));

    $('#sheetBody').innerHTML = `
      <div class="sheet-top-row">
        <span class="chip" style="background:${ex.colorSoft};color:${ex.color}">${escapeHtml(ex.venue)}</span>
        <button class="save-toggle-pill" id="sheetSaveBtn" style="${isSaved ? `background:${ex.color};color:#fff` : `background:${ex.colorSoft};color:${ex.color}`}">${isSaved ? `저장됨 · 종료 D-${REMINDER_DAYS} 알림` : '저장하기'}</button>
      </div>
      <h3 class="sheet-title">${escapeHtml(ex.title)}</h3>
      <p class="sheet-artist">${escapeHtml(ex.artist)}</p>
      <p class="sheet-period">${fmtDate(ex.period.start)}${ex.period.startApprox ? '(추정)' : ''} – ${fmtDate(ex.period.end)}</p>
      <div class="sheet-image" style="background:${ex.color}">
        ${thumb ? `<img src="${thumb}" alt="" onerror="this.remove()"/>` : `<span class="placeholder-label">대표 이미지 자리</span>`}
      </div>
      <div class="sheet-grid">
        <div class="box"><div class="lbl">관람시간</div><div class="val">${escapeHtml(ex.hours || '-')}${ex.closedDay ? `<br/>휴관 ${escapeHtml(ex.closedDay)}` : ''}</div></div>
        <div class="box"><div class="lbl">이동시간</div><div class="val">${escapeHtml(pinTimeText(ex) || '-')}${nightLabel(ex) ? `<br/>야간 ${escapeHtml(nightLabel(ex))}` : ''}</div></div>
        ${ex.admission ? `<div class="box admission-box"><div class="lbl">입장료</div><div class="val">${escapeHtml(ex.admission)}</div></div>` : ''}
      </div>
      <p class="sheet-address">📍 ${escapeHtml(ex.address)}</p>
      ${ex.features?.length ? `<div class="sheet-section"><div class="sec-label">이 전시의 포인트</div><ul class="point-list" style="--card-color:${ex.color}">${ex.features.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul></div>` : ''}
      ${ex.artistIntro ? `<div class="sheet-section"><div class="sec-label">작가 소개</div><p class="sheet-para">${escapeHtml(ex.artistIntro)}</p></div>` : ''}
      ${ex.videoHighlights?.length ? `<div class="sheet-section"><div class="sec-label">영상에서 꼭 봐야 할 내용</div><ul class="point-list" style="--card-color:${ex.color}">${ex.videoHighlights.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul></div>` : ''}
      ${ex.video?.url ? `
      <div class="sheet-section">
        ${ex.video.title ? `<div class="sheet-video-title">${escapeHtml(ex.video.title)}</div>` : ''}
        <a class="sheet-cta" style="background:${ex.color}" href="${ex.video.url}" target="_blank" rel="noopener">▶ 소개 영상 보기</a>
      </div>` : ''}
      <a class="sheet-cta secondary" href="${naverDirectionsUrl(ex)}" target="_blank" rel="noopener">네이버지도로 길찾기</a>
    `;
    $('#sheetSaveBtn').addEventListener('click', () => toggleSave(id));
    $('#detailSheet').hidden = false;
  }
  function closeDetail() { $('#detailSheet').hidden = true; state.open = null; }

  // ---------- 이벤트 바인딩 ----------
  $$('.tab-btn').forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  $('#detailSheet').addEventListener('click', (e) => { if (e.target === $('#detailSheet')) closeDetail(); });
  $('#prevMonth').addEventListener('click', () => { shiftMonth(-1); });
  $('#nextMonth').addEventListener('click', () => { shiftMonth(1); });
  function shiftMonth(delta) {
    const d = parseISO(state.sel);
    d.setMonth(d.getMonth() + delta);
    state.sel = toISO(d.getFullYear(), d.getMonth(), d.getDate());
    renderCalendarTab();
  }
  $('#mapSearchInput').addEventListener('input', (e) => { state.mapQuery = e.target.value; renderMapTab(); });
  $('#mapSortBtn').addEventListener('click', () => {
    state.mapSort = state.mapSort === 'time' ? 'name' : 'time';
    $('#mapSortBtn').textContent = state.mapSort === 'time' ? '필터' : '이름순';
    renderMapCarousel();
  });
  $('#locateBtn').addEventListener('click', locateMe);
  $('#mapSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchPlace(e.target.value); });
  $('.map-search-box .search-dot').addEventListener('click', () => searchPlace($('#mapSearchInput').value));

  // ---------- 더보기: 링크/텍스트로 추가 ----------
  $('#submitBtn')?.addEventListener('click', async () => {
    const input = $('#submitInput');
    const status = $('#submitStatus');
    const val = input.value.trim();
    if (!val) return;
    $('#submitBtn').disabled = true;
    status.hidden = false;
    status.textContent = '분석 중이에요… (몇 초 걸릴 수 있어요)';
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: val }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '처리 실패');
      status.textContent = json.message || `${(json.added || []).length}건 추가됐어요`;
      if (json.added?.length) input.value = '';
    } catch (e) {
      status.textContent = e.message.includes('fetch') ? '이 기능은 배포된 사이트에서만 동작해요 (로컬 미리보기에서는 지원 안 함)' : ('오류: ' + e.message);
    } finally {
      $('#submitBtn').disabled = false;
    }
  });

  (async function init() {
    state.sel = todayISO();
    await loadData();
    const params = new URLSearchParams(location.search);
    switchTab(params.get('tab') || 'cal');
    if (params.get('open')) openDetail(params.get('open'));
  })();
})();
