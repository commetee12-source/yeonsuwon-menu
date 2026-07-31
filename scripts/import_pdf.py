#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""주간업무보고 PDF에서 <행정지원과> 주간식단 표를 읽어 data/{ISO주차}.json 으로 옮긴다.

사용:
    python scripts/import_pdf.py                 # 볼트(..)의 PDF 전체를 훑는다
    python scripts/import_pdf.py <pdf경로> ...    # 특정 파일만
    python scripts/import_pdf.py --vault D:/other

원칙: 조금이라도 이상하면 쓰지 않고 사람에게 넘긴다.
표 양식이 바뀌어 파싱이 어긋나면 엉뚱한 식단을 배포하는 것보다 실패하는 편이 낫다.
"""
import json
import re
import sys
from datetime import date
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit("PyMuPDF 가 필요합니다:  python -m pip install pymupdf")

SITE = Path(__file__).resolve().parent.parent
DATA = SITE / "data"

DAY_RE = re.compile(r"^(\d{1,2})\.(\d{1,2})\(([월화수목금토일])\)$")
TOTAL_RE = re.compile(r"^(\d{1,3}(?:,\d{3})*|\d+)\s*명$")
PART_RE = re.compile(r"([가-힣]+(?:\s+[가-힣]+)?)\s*(\d{1,3}(?:,\d{3})*|\d+)\s*명")
RANGE_RE = re.compile(
    r"【\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*[∼~〜-]\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*】"
)


class SkipPdf(Exception):
    """이 PDF 는 건너뛴다 (식단 표가 없는 등)."""


class BadFormat(Exception):
    """식단 표는 찾았으나 해석할 수 없다 — 사람이 봐야 한다."""


def num(s):
    return int(s.replace(",", ""))


def find_menu_page(doc):
    """'주간식단' 표가 있는 페이지의 텍스트를 반환한다."""
    for page in doc:
        text = page.get_text()
        if "주간식단" in text and "급식일" in text:
            return text
    raise SkipPdf("'주간식단' 표를 찾지 못했다")


def parse_range(text):
    m = RANGE_RE.search(text)
    if not m:
        raise BadFormat("머리말의 기간 표기 【YYYY. M. D. ∼ YYYY. M. D.】 를 찾지 못했다")
    y1, m1, d1, y2, m2, d2 = (int(g) for g in m.groups())
    return date(y1, m1, d1), date(y2, m2, d2)


def resolve_date(month, day, start, end):
    """'8.3' 처럼 연도가 없는 표기를 기간 안에서 실제 날짜로 확정한다."""
    for year in {start.year, end.year}:
        try:
            cand = date(year, month, day)
        except ValueError:
            continue
        if start <= cand <= end:
            return cand
    raise BadFormat(f"급식일 {month}.{day} 가 기간 {start}~{end} 안에 들어가지 않는다")


def parse_days(text, start, end):
    """식단 표 본문을 날짜별 레코드로 쪼갠다."""
    body = text.split("주간식단", 1)[1]
    lines = [ln.strip() for ln in body.splitlines()]

    # 급식일 줄의 위치를 먼저 찾는다
    marks = [i for i, ln in enumerate(lines) if DAY_RE.match(ln)]
    if not marks:
        raise BadFormat("급식일(예: 8.3(월)) 형식의 줄이 하나도 없다")

    # 표의 끝: 마지막 급식일 이후 처음 나오는 ※ 주석
    tail = len(lines)
    for i in range(marks[-1] + 1, len(lines)):
        if lines[i].startswith("※"):
            tail = i
            break

    bounds = marks + [tail]
    days = []

    for k, begin in enumerate(marks):
        block = [ln for ln in lines[begin + 1 : bounds[k + 1]] if ln]
        mm, dd, _dow = DAY_RE.match(lines[begin]).groups()
        when = resolve_date(int(mm), int(dd), start, end)

        if not block:
            raise BadFormat(f"{when}: 급식일 뒤에 내용이 없다")

        # 1) 총원
        mt = TOTAL_RE.match(block[0])
        if not mt:
            raise BadFormat(f"{when}: 총 급식인원을 읽지 못했다 (읽은 값: {block[0]!r})")
        total = num(mt.group(1))

        # 2) 세부 인원 — '(' 로 시작해 ')' 로 끝나는 구간
        idx = 1
        if idx >= len(block) or not block[idx].startswith("("):
            raise BadFormat(f"{when}: 세부 인원 괄호가 없다")
        chunk = []
        while idx < len(block):
            chunk.append(block[idx])
            closed = block[idx].endswith(")")
            idx += 1
            if closed:
                break
        else:
            raise BadFormat(f"{when}: 세부 인원 괄호가 닫히지 않았다")

        breakdown = {}
        for label, count in PART_RE.findall(" ".join(chunk)):
            key = label.replace(" ", "")  # '직원 등' 과 '직원등' 을 같게 본다
            breakdown[key] = num(count)
        if not breakdown:
            raise BadFormat(f"{when}: 세부 인원을 하나도 읽지 못했다")

        # 3) 나머지가 메뉴
        menu_text = " ".join(block[idx:])
        menu = [item.strip() for item in menu_text.split(",") if item.strip()]
        if not menu:
            raise BadFormat(f"{when}: 메뉴가 비어 있다")

        # 원본 PDF 에서 성립하는 불변식 — 어긋나면 표를 잘못 읽은 것이다
        if sum(breakdown.values()) != total:
            detail = " + ".join(f"{k} {v}" for k, v in breakdown.items())
            raise BadFormat(
                f"{when}: 총원 {total} 인데 세부 합은 {sum(breakdown.values())} ({detail})"
            )

        days.append(
            {
                "date": when.isoformat(),
                "menu": menu,
                "headcount": {"total": total, "breakdown": breakdown},
            }
        )

    days.sort(key=lambda d: d["date"])
    return days


def iso_week(iso_date):
    y, w, _ = date.fromisoformat(iso_date).isocalendar()
    return f"{y}-W{w:02d}"


def import_pdf(path):
    """PDF 하나를 읽어 주차 파일을 쓴다. (주차키, 갱신여부) 를 반환한다."""
    with fitz.open(path) as doc:
        text = find_menu_page(doc)

    start, end = parse_range(text)
    days = parse_days(text, start, end)

    weeks = {iso_week(d["date"]) for d in days}
    if len(weeks) != 1:
        raise BadFormat(f"한 파일에 여러 ISO 주차가 섞여 있다: {sorted(weeks)}")
    week = weeks.pop()

    doc_json = {
        "week": week,
        "range": {"start": days[0]["date"], "end": days[-1]["date"]},
        "source": Path(path).name,
        "days": days,
    }

    out = DATA / f"{week}.json"
    new = json.dumps(doc_json, ensure_ascii=False, indent=2) + "\n"
    changed = not out.exists() or out.read_text(encoding="utf-8") != new
    if changed:
        out.write_text(new, encoding="utf-8")
    return week, changed, len(days)


def rebuild_index():
    """data/ 를 훑어 index.json 을 다시 만든다."""
    weeks, all_days = [], []
    for f in sorted(DATA.glob("????-W??.json")):
        doc = json.loads(f.read_text(encoding="utf-8"))
        weeks.append(doc["week"])
        all_days += [d["date"] for d in doc["days"]]
    all_days.sort()

    index = {
        "weeks": sorted(weeks),
        "latest": sorted(weeks)[-1] if weeks else None,
        "coverage": {"from": all_days[0], "to": all_days[-1]} if all_days else None,
        "days": all_days,
        "updatedAt": date.today().isoformat(),
    }
    path = DATA / "index.json"
    new = json.dumps(index, ensure_ascii=False, indent=2) + "\n"
    changed = not path.exists() or path.read_text(encoding="utf-8") != new
    if changed:
        path.write_text(new, encoding="utf-8")
    return changed


def main(argv):
    sys.stdout.reconfigure(encoding="utf-8")

    vault = SITE.parent
    if "--vault" in argv:
        i = argv.index("--vault")
        vault = Path(argv[i + 1])
        del argv[i : i + 2]

    targets = [Path(a) for a in argv] or sorted(vault.glob("*.pdf"))
    if not targets:
        print(f"PDF 가 없다: {vault}")
        return 0

    touched, failures = [], []
    for pdf in targets:
        try:
            week, changed, n = import_pdf(pdf)
        except SkipPdf as e:
            print(f"  건너뜀  {pdf.name} — {e}")
            continue
        except (BadFormat, Exception) as e:
            failures.append((pdf.name, e))
            print(f"  실패    {pdf.name} — {e}")
            continue
        print(f"  {'갱신' if changed else '동일'}    {pdf.name} → {week} ({n}일)")
        if changed:
            touched.append(week)

    if rebuild_index():
        print("  갱신    index.json")
        touched.append("index")

    if failures:
        print(f"\n✗ {len(failures)}건 실패 — 표 양식이 바뀌었을 수 있다. 직접 확인이 필요하다.")
        return 1

    print(f"\n{'✓ 변경됨: ' + ', '.join(touched) if touched else '✓ 변경 없음'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
