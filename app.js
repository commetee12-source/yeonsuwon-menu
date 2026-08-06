/* 서울교육연수원 주간 식단 — 빌드 없는 정적 앱
 *
 * 날짜 계산 규칙: 전부 로컬 시간 기준이며, 비교는 "YYYY-MM-DD" 문자열로 한다.
 * new Date("2026-08-03") 은 UTC 로 파싱되어 시간대에 따라 하루가 밀리므로 쓰지 않는다.
 */
(function () {
  'use strict';

  var DATA_DIR = 'data';
  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  var index = null;
  var weekCache = Object.create(null);
  var current = null; // "YYYY-MM-DD"

  // 급식인원 줄 앞에 붙는 사람 아이콘. styles.css 의 stroke 규칙을 그대로 탄다.
  var PERSON_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle cx="12" cy="8" r="3.4"/>' +
    '<path d="M4.8 20c0-3.6 3.2-5.6 7.2-5.6s7.2 2 7.2 5.6" stroke-linecap="round"/>' +
    '</svg>';

  var el = {
    main: document.getElementById('main'),
    label: document.getElementById('dateLabel'),
    input: document.getElementById('dateInput'),
    prev: document.getElementById('prevBtn'),
    next: document.getElementById('nextBtn'),
    today: document.getElementById('todayBtn'),
    todayBadge: document.getElementById('todayBadge')
  };

  // ── 날짜 유틸 ──────────────────────────────────────────────
  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function toISO(y, m, d) {
    return y + '-' + pad(m) + '-' + pad(d);
  }

  function todayISO() {
    var d = new Date();
    return toISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  function parseLocal(iso) {
    var p = iso.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function addDays(iso, n) {
    var dt = parseLocal(iso);
    dt.setDate(dt.getDate() + n);
    return toISO(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  }

  function isValidISO(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = s.split('-').map(Number);
    var dt = new Date(p[0], p[1] - 1, p[2]);
    return (
      dt.getFullYear() === p[0] && dt.getMonth() === p[1] - 1 && dt.getDate() === p[2]
    );
  }

  /** ISO-8601 주차. 예) 2026-08-03 -> "2026-W32" (scripts/check-data.mjs 와 동일 로직) */
  function isoWeekOf(iso) {
    var p = iso.split('-').map(Number);
    var dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    var dow = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() + 4 - dow);
    var isoYear = dt.getUTCFullYear();
    var jan1 = Date.UTC(isoYear, 0, 1);
    var week = Math.ceil(((dt.getTime() - jan1) / 86400000 + 1) / 7);
    return isoYear + '-W' + pad(week);
  }

  function formatKorean(iso) {
    var p = iso.split('-').map(Number);
    var dow = WEEKDAYS[parseLocal(iso).getDay()];
    return p[0] + '. ' + p[1] + '. ' + p[2] + '. (' + dow + ')';
  }

  function formatShort(iso) {
    var p = iso.split('-').map(Number);
    return p[1] + '월 ' + p[2] + '일';
  }

  // ── 렌더 ───────────────────────────────────────────────────
  function clear() {
    while (el.main.firstChild) el.main.removeChild(el.main.firstChild);
  }

  /** 안내 문구와 버튼도 식단 카드와 같은 판 위에 올린다. 없으면 만들어 재사용한다. */
  function stateCard() {
    var card = el.main.querySelector('.card-state');
    if (!card) {
      card = document.createElement('section');
      card.className = 'card card-state';
      el.main.appendChild(card);
    }
    return card;
  }

  function message(html) {
    var p = document.createElement('p');
    p.className = 'state-msg';
    p.innerHTML = html;
    stateCard().appendChild(p);
  }

  function actionButton(text, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'action-btn';
    b.textContent = text;
    b.addEventListener('click', onClick);
    stateCard().appendChild(b);
  }

  function renderMeal(day) {
    var card = document.createElement('section');
    card.className = 'card';

    var label = document.createElement('span');
    label.className = 'meal-label';
    label.textContent = '중식';
    card.appendChild(label);

    var ul = document.createElement('ul');
    ul.className = 'menu';
    day.menu.forEach(function (item) {
      var li = document.createElement('li');
      li.textContent = item;
      ul.appendChild(li);
    });
    card.appendChild(ul);

    // 급식인원은 총원만 노출한다. breakdown(직원/초등/중등/교행)은 화면에 쓰지 않는다.
    var total = day.headcount && day.headcount.total;
    if (typeof total === 'number') {
      var p = document.createElement('p');
      p.className = 'headcount';
      p.innerHTML = PERSON_SVG; // 정적 아이콘 마크업
      p.appendChild(
        document.createTextNode('급식인원 ' + total.toLocaleString('ko-KR') + '명')
      );
      card.appendChild(p);
    }

    el.main.appendChild(card);
  }

  function nearestMealDay(iso) {
    if (!index || !index.days || !index.days.length) return null;
    var target = parseLocal(iso).getTime();
    var best = null;
    var bestGap = Infinity;
    index.days.forEach(function (d) {
      var gap = Math.abs(parseLocal(d).getTime() - target);
      // 거리가 같으면 나중 날짜를 고른다
      if (gap < bestGap || (gap === bestGap && best !== null && d > best)) {
        bestGap = gap;
        best = d;
      }
    });
    return best;
  }

  function renderNoMeal(iso) {
    message('이 날은 급식이 없습니다.');
    var near = nearestMealDay(iso);
    if (near) {
      actionButton(formatShort(near) + ' 식단 보기', function () {
        go(near);
      });
    }
  }

  function renderOutOfRange() {
    var cov = index && index.coverage;
    if (cov && cov.from && cov.to) {
      message(
        '아직 등록되지 않았습니다.<br>등록된 기간: <strong>' +
          formatShort(cov.from) +
          ' ~ ' +
          formatShort(cov.to) +
          '</strong>'
      );
      actionButton('등록된 최근 식단 보기', function () {
        go(cov.to);
      });
    } else {
      message('아직 등록된 식단이 없습니다.');
    }
  }

  function renderError(retryDate) {
    message('식단 정보를 불러오지 못했습니다.');
    actionButton('다시 시도', function () {
      weekCache = Object.create(null);
      index = null;
      start(retryDate);
    });
  }

  // ── 데이터 로드 ────────────────────────────────────────────
  function fetchJson(path) {
    return fetch(path, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error(path + ' → HTTP ' + res.status);
      return res.json();
    });
  }

  function loadWeek(week) {
    if (weekCache[week]) return Promise.resolve(weekCache[week]);
    return fetchJson(DATA_DIR + '/' + week + '.json').then(function (doc) {
      weekCache[week] = doc;
      return doc;
    });
  }

  // ── 화면 전환 ──────────────────────────────────────────────
  function syncChrome(iso) {
    el.label.textContent = formatKorean(iso);
    el.input.value = iso;
    el.todayBadge.hidden = iso !== todayISO();

    var url = new URL(window.location.href);
    url.searchParams.set('date', iso);
    window.history.replaceState({ date: iso }, '', url);
  }

  function go(iso) {
    current = iso;
    syncChrome(iso);
    clear();
    el.main.setAttribute('aria-busy', 'true');

    var hasMeal = index.days && index.days.indexOf(iso) !== -1;

    if (!hasMeal) {
      var week = isoWeekOf(iso);
      var weekKnown = index.weeks && index.weeks.indexOf(week) !== -1;
      // 데이터를 보유한 주차 안이면 "급식 없는 날", 아니면 "미등록 기간"
      if (weekKnown) renderNoMeal(iso);
      else renderOutOfRange();
      el.main.setAttribute('aria-busy', 'false');
      return;
    }

    loadWeek(isoWeekOf(iso))
      .then(function (doc) {
        if (current !== iso) return; // 그 사이 날짜가 또 바뀌었으면 버린다
        var day = null;
        for (var i = 0; i < doc.days.length; i++) {
          if (doc.days[i].date === iso) {
            day = doc.days[i];
            break;
          }
        }
        clear();
        if (day) renderMeal(day);
        else renderNoMeal(iso);
      })
      .catch(function (err) {
        if (current !== iso) return;
        console.error(err);
        clear();
        renderError(iso);
      })
      .then(function () {
        el.main.setAttribute('aria-busy', 'false');
      });
  }

  // ── 시작 ───────────────────────────────────────────────────
  function requestedDate() {
    var q = new URLSearchParams(window.location.search).get('date');
    return q && isValidISO(q) ? q : todayISO();
  }

  function start(initial) {
    clear();
    message('불러오는 중…');

    fetchJson(DATA_DIR + '/index.json')
      .then(function (doc) {
        index = doc;
        if (!Array.isArray(index.days)) index.days = [];
        if (!Array.isArray(index.weeks)) index.weeks = [];
        go(initial);
      })
      .catch(function (err) {
        console.error(err);
        clear();
        renderError(initial);
      });
  }

  el.prev.addEventListener('click', function () {
    go(addDays(current, -1));
  });

  el.next.addEventListener('click', function () {
    go(addDays(current, 1));
  });

  el.today.addEventListener('click', function () {
    go(todayISO());
  });

  el.input.addEventListener('change', function () {
    if (isValidISO(el.input.value)) go(el.input.value);
    else el.input.value = current;
  });

  start(requestedDate());
})();
