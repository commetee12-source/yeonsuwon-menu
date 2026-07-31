#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""import_pdf.py 의 파싱 로직 시험.

PDF 에서 글자를 뽑는 부분은 실물로 검증되어 있다. 여기서 시험하는 것은
그 다음 단계 — 뽑은 글자를 날짜·인원·메뉴로 나누는 규칙이다.
표 양식이 바뀌었을 때 가장 먼저 깨지는 곳이므로, 고칠 때마다 이 시험을 돌린다.

사용:  python scripts/test_import.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from import_pdf import BadFormat, iso_week, parse_days, parse_range  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✓ {name}")
    else:
        failed += 1
        print(f"  ✗ {name}" + (f"\n      {detail}" if detail else ""))


def expect_bad(name, text, needle=""):
    """BadFormat 이 나야 하는 경우 — 조용히 통과하면 잘못된 식단이 배포된다."""
    global passed, failed
    try:
        start, end = parse_range(text)
        parse_days(text, start, end)
    except BadFormat as e:
        if needle and needle not in str(e):
            failed += 1
            print(f"  ✗ {name} — 다른 이유로 거부됨: {e}")
        else:
            passed += 1
            print(f"  ✓ {name} — 거부됨 ({e})")
        return
    except Exception as e:  # noqa: BLE001
        failed += 1
        print(f"  ✗ {name} — BadFormat 이 아닌 예외: {type(e).__name__}: {e}")
        return
    failed += 1
    print(f"  ✗ {name} — 거부되지 않고 통과했다")


def table(rng, rows):
    """실제 추출 텍스트와 같은 모양의 표를 만든다."""
    out = [f"■ 주간업무", f" <행정지원과>            【{rng}】", " 2. 주간식단 (과정별 급식인원 및 식단)",
           "급식일", "급식인원", "메뉴"]
    for day, total, breakdown, menu in rows:
        out += [day, f" {total}명", f"({breakdown})", menu]
    out.append("  ※ 기관 사정에 따라 변경될 수 있음")
    return "\n".join(out)


NORMAL = table(
    "2026. 8. 3. ∼ 2026. 8. 7.",
    [
        ("8.3(월)", 684, "직원 등 130명, 초등 281명, \n중등 246명, 교행 27명",
         "기장밥, 미역국, 돈육통마늘구이, \n오이양배추홀그레인무침, 상추쌈, 배추김치"),
        ("8.7(금)", 443, "직원등 130명, 초등 281명, \n중등 5명, 교행 27명",
         "흑미밥, 북어무국, 제육볶음"),
    ],
)

print("\n[1] 정상 표")
start, end = parse_range(NORMAL)
days = parse_days(NORMAL, start, end)
check("기간 해석", (start.isoformat(), end.isoformat()) == ("2026-08-03", "2026-08-07"),
      f"실제: {start} ~ {end}")
check("급식일 2건", len(days) == 2, f"실제: {len(days)}")
check("연도 없는 '8.3' -> 2026-08-03", days[0]["date"] == "2026-08-03", f"실제: {days[0]['date']}")
check("메뉴 6개 분리", days[0]["menu"] == ["기장밥", "미역국", "돈육통마늘구이",
                                        "오이양배추홀그레인무침", "상추쌈", "배추김치"],
      f"실제: {days[0]['menu']}")
check("줄바꿈 낀 메뉴가 붙지 않음", all("\n" not in m for m in days[0]["menu"]))
check("총원 684", days[0]["headcount"]["total"] == 684)
check("'직원 등' 과 '직원등' 을 같은 항목으로", "직원등" in days[1]["headcount"]["breakdown"],
      f"실제: {list(days[1]['headcount']['breakdown'])}")
check("ISO 주차 2026-W32", iso_week(days[0]["date"]) == "2026-W32", iso_week(days[0]["date"]))

print("\n[2] 연말 넘김 (12월 -> 1월)")
ROLLOVER = table(
    "2026. 12. 28. ∼ 2027. 1. 1.",
    [
        ("12.28(월)", 100, "직원 등 60명, 초등 40명", "떡국, 김치"),
        ("1.1(금)", 100, "직원 등 60명, 초등 40명", "잡곡밥, 미역국"),
    ],
)
s2, e2 = parse_range(ROLLOVER)
d2 = parse_days(ROLLOVER, s2, e2)
check("12.28 -> 2026-12-28", d2[0]["date"] == "2026-12-28", f"실제: {d2[0]['date']}")
check("1.1 -> 2027-01-01 (연도 넘김)", d2[1]["date"] == "2027-01-01", f"실제: {d2[1]['date']}")
check("두 날짜가 같은 ISO 주차(2026-W53)",
      iso_week(d2[0]["date"]) == iso_week(d2[1]["date"]) == "2026-W53",
      f"실제: {iso_week(d2[0]['date'])}, {iso_week(d2[1]['date'])}")

print("\n[3] 잘못된 표는 거부해야 한다")
expect_bad(
    "총원과 세부 합이 다름",
    table("2026. 8. 3. ∼ 2026. 8. 7.", [("8.3(월)", 999, "직원 등 130명, 초등 281명", "기장밥")]),
    "총원",
)
expect_bad(
    "메뉴가 비어 있음",
    table("2026. 8. 3. ∼ 2026. 8. 7.", [("8.3(월)", 411, "직원 등 130명, 초등 281명", "")]),
)
expect_bad(
    "급식일이 기간 밖",
    table("2026. 8. 3. ∼ 2026. 8. 7.", [("9.15(화)", 411, "직원 등 130명, 초등 281명", "기장밥")]),
    "기간",
)
expect_bad("기간 표기 없음", " 2. 주간식단\n급식일\n8.3(월)\n 100명\n(직원 등 100명)\n기장밥", "기간")
expect_bad(
    "세부 인원 괄호 없음",
    "【2026. 8. 3. ∼ 2026. 8. 7.】\n 2. 주간식단\n급식일\n8.3(월)\n 100명\n기장밥, 미역국",
    "괄호",
)
expect_bad(
    "급식일 줄이 하나도 없음",
    "【2026. 8. 3. ∼ 2026. 8. 7.】\n 2. 주간식단\n급식일\n급식인원\n메뉴",
    "급식일",
)

print(f"\n{'✓ 전부 통과' if failed == 0 else f'✗ 실패 {failed}건'} "
      f"(통과 {passed} / 전체 {passed + failed})")
raise SystemExit(0 if failed == 0 else 1)
