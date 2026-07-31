#!/usr/bin/env node
// 식단 데이터 검증기. 의존성 없음 — Node 내장 모듈만 사용한다.
// 사용: node scripts/check-data.mjs      (site/ 에서 실행)
// 종료코드: 0 = 정상, 1 = 문제 발견

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

const problems = [];
const fail = (where, msg) => problems.push(`${where}: ${msg}`);

/** ISO-8601 주차 문자열을 만든다. 예) 2026-08-03 -> 2026-W32 */
export function isoWeekOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay() || 7; // 월=1 … 일=7
  dt.setUTCDate(dt.getUTCDate() + 4 - dow); // 그 주의 목요일
  const isoYear = dt.getUTCFullYear();
  const jan1 = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((dt.getTime() - jan1) / 86400000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** YYYY-MM-DD 형식이며 실재하는 날짜인지 */
function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    fail(path, `읽기/파싱 실패 — ${err.message}`);
    return null;
  }
}

// ── 주차 파일 검사 ────────────────────────────────────────────────
const weekFiles = readdirSync(DATA_DIR)
  .filter((f) => /^\d{4}-W\d{2}\.json$/.test(f))
  .sort();

const allDates = [];
const weeksFound = [];

for (const file of weekFiles) {
  const week = file.replace(/\.json$/, '');
  weeksFound.push(week);
  const doc = readJson(join(DATA_DIR, file));
  if (!doc) continue;

  if (doc.week !== week) {
    fail(file, `week 필드가 "${doc.week}" 인데 파일명은 "${week}" 이다`);
  }
  if (!Array.isArray(doc.days) || doc.days.length === 0) {
    fail(file, 'days 가 비어 있거나 배열이 아니다');
    continue;
  }

  const seen = new Set();
  for (const day of doc.days) {
    const at = `${file} [${day?.date ?? '?'}]`;

    if (!isRealDate(day?.date)) {
      fail(at, 'date 가 YYYY-MM-DD 형식의 실재하는 날짜가 아니다');
      continue;
    }
    if (seen.has(day.date)) fail(at, '같은 파일 안에서 날짜가 중복된다');
    seen.add(day.date);
    allDates.push(day.date);

    const actualWeek = isoWeekOf(day.date);
    if (actualWeek !== week) {
      fail(at, `이 날짜의 ISO 주차는 ${actualWeek} 이므로 ${week}.json 에 있으면 안 된다`);
    }

    // 메뉴
    if (!Array.isArray(day.menu) || day.menu.length === 0) {
      fail(at, 'menu 가 비어 있거나 배열이 아니다');
    } else {
      day.menu.forEach((item, i) => {
        if (typeof item !== 'string' || item.trim() === '') {
          fail(at, `menu[${i}] 가 비어 있거나 문자열이 아니다`);
        }
      });
    }

    // 급식인원 — 총원 = 세부 합 (원본 PDF에서 확인된 불변식)
    const hc = day.headcount;
    if (!hc || typeof hc.total !== 'number' || !Number.isInteger(hc.total)) {
      fail(at, 'headcount.total 이 정수가 아니다');
    } else if (!hc.breakdown || typeof hc.breakdown !== 'object') {
      fail(at, 'headcount.breakdown 이 없다');
    } else {
      const parts = Object.values(hc.breakdown);
      if (parts.some((n) => !Number.isInteger(n))) {
        fail(at, 'headcount.breakdown 에 정수가 아닌 값이 있다');
      } else {
        const sum = parts.reduce((a, b) => a + b, 0);
        if (sum !== hc.total) {
          const detail = Object.entries(hc.breakdown)
            .map(([k, v]) => `${k} ${v}`)
            .join(' + ');
          fail(at, `총원 불일치 — total ${hc.total} 인데 세부 합은 ${sum} (${detail})`);
        }
      }
    }
  }

  // range 가 실제 날짜 범위와 맞는가
  const dates = doc.days.map((d) => d?.date).filter(isRealDate).sort();
  if (dates.length) {
    if (doc.range?.start !== dates[0] || doc.range?.end !== dates[dates.length - 1]) {
      fail(
        file,
        `range 가 ${doc.range?.start}~${doc.range?.end} 인데 실제 데이터는 ${dates[0]}~${dates[dates.length - 1]} 이다`
      );
    }
  }
}

// ── index.json 과의 양방향 대조 ───────────────────────────────────
const index = readJson(join(DATA_DIR, 'index.json'));

if (index) {
  const declared = Array.isArray(index.weeks) ? index.weeks : [];

  for (const w of declared) {
    if (!weeksFound.includes(w)) fail('index.json', `weeks 에 ${w} 가 있는데 ${w}.json 파일이 없다`);
  }
  for (const w of weeksFound) {
    if (!declared.includes(w)) fail('index.json', `${w}.json 파일이 있는데 weeks 에 등재되지 않았다`);
  }

  const sortedDates = [...allDates].sort();
  const declaredDays = Array.isArray(index.days) ? [...index.days].sort() : null;

  if (!declaredDays) {
    fail('index.json', 'days 배열이 없다');
  } else if (JSON.stringify(declaredDays) !== JSON.stringify(sortedDates)) {
    const missing = sortedDates.filter((d) => !declaredDays.includes(d));
    const extra = declaredDays.filter((d) => !sortedDates.includes(d));
    if (missing.length) fail('index.json', `days 에 빠진 날짜: ${missing.join(', ')}`);
    if (extra.length) fail('index.json', `days 에 실재하지 않는 날짜: ${extra.join(', ')}`);
  }

  if (sortedDates.length) {
    const from = sortedDates[0];
    const to = sortedDates[sortedDates.length - 1];
    if (index.coverage?.from !== from || index.coverage?.to !== to) {
      fail('index.json', `coverage 가 ${index.coverage?.from}~${index.coverage?.to} 인데 실제는 ${from}~${to} 이다`);
    }
  }

  const latestWeek = [...weeksFound].sort().pop();
  if (latestWeek && index.latest !== latestWeek) {
    fail('index.json', `latest 가 "${index.latest}" 인데 가장 최근 주차는 "${latestWeek}" 이다`);
  }
}

// ── ISO 주차 계산기 자체 점검 (연말연시 경계) ─────────────────────
const WEEK_CASES = [
  ['2026-08-03', '2026-W32'],
  ['2026-08-07', '2026-W32'],
  ['2026-01-01', '2026-W01'],
  ['2025-12-29', '2026-W01'], // 2026년 1주차는 2025-12-29 월요일에 시작
  ['2026-12-28', '2026-W53'],
  ['2027-01-03', '2026-W53'], // 2026-W53 은 2027-01-03 일요일에 끝난다
  ['2027-01-04', '2027-W01'],
];
for (const [date, expected] of WEEK_CASES) {
  const got = isoWeekOf(date);
  if (got !== expected) fail('isoWeekOf', `${date} → ${got} (기대: ${expected})`);
}

// ── 결과 ─────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`✗ 문제 ${problems.length}건\n`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `✓ 이상 없음 — 주차 ${weeksFound.length}개, 급식일 ${allDates.length}일` +
    (allDates.length ? ` (${[...allDates].sort()[0]} ~ ${[...allDates].sort().pop()})` : '')
);
