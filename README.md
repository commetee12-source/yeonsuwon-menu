# 서울교육연수원 주간 식단

서울특별시교육청교육연수원 구내식당 식단을 날짜로 조회하는 웹앱.
빌드 도구·npm 의존성 없이 HTML + CSS + 바닐라 JS로만 동작한다.

## 매주 갱신하는 법

**새 「주간업무」 PDF를 볼트(`D:\obsi\menu\`)에 저장하면 끝이다.** 나머지는 자동이다.

```
PDF 저장  →  파싱  →  검증  →  커밋·푸시  →  Netlify 재배포
                              (실패하면 여기서 멈춘다)
```

감시 스크립트를 띄워두면 저장하는 즉시 돌아간다.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\watch.ps1
```

직접 돌리고 싶을 때:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\publish.ps1
powershell -ExecutionPolicy Bypass -File scripts\publish.ps1 -DryRun   # 커밋·푸시 없이 확인만
```

여러 번 돌려도 안전하다. 바뀐 게 없으면 아무 일도 하지 않는다.

### 실패하면

파이프라인은 **의심스러우면 멈춘다.** 잘못된 식단을 배포하는 것보다 배포하지 않는 편이 낫기 때문이다.
아래 중 하나라도 걸리면 커밋·푸시를 하지 않고, 어느 날짜의 무엇이 문제인지 알려준다.

- 머리말의 기간 표기 `【YYYY. M. D. ∼ YYYY. M. D.】` 를 찾지 못함
- 급식일 줄(`8.3(월)`)이 하나도 없음
- 총 급식인원이 세부 인원의 합과 다름
- 메뉴가 비어 있음 / 세부 인원 괄호가 닫히지 않음
- 급식일이 머리말 기간 밖

표 양식이 실제로 바뀐 것이라면 `scripts/import_pdf.py` 를 고치고 `scripts/test_import.py` 를 돌린다.
급하면 `data/` 의 JSON을 직접 고쳐도 된다 — `check-data.mjs` 가 지켜 준다.

### 필요한 것

| | |
|---|---|
| Python + PyMuPDF | `python -m pip install pymupdf` (PDF 읽기) |
| Node.js | 데이터 검증 (`check-data.mjs`, 내장 모듈만 사용) |
| git | 푸시 권한이 설정되어 있어야 한다 |

사이트 자체는 이것들과 무관하다. 배포되는 것은 HTML·CSS·JS·JSON 뿐이다.

## 스크립트

| 파일 | 하는 일 |
|---|---|
| `scripts/watch.ps1` | 볼트를 감시하다 PDF가 들어오면 `publish.ps1` 실행 |
| `scripts/publish.ps1` | 파싱 → 검증 → 커밋 → 푸시 (어디서든 실패하면 중단) |
| `scripts/import_pdf.py` | PDF의 주간식단 표를 `data/{주차}.json` 으로 변환, `index.json` 재생성 |
| `scripts/check-data.mjs` | 데이터 검증 (총원=세부 합, ISO 주차 일치, index 양방향 대조) |
| `scripts/test_import.py` | 파서 시험 (연말 넘김, 양식 이상 거부 등) |

`scripts/` 는 `netlify.toml` 에서 404로 막아 두어 사이트로 서빙되지 않는다.

## 로컬에서 확인

```bash
npx --yes serve . -l 5173     # 또는  python -m http.server 5173
```

- `http://localhost:5173/` — 오늘 식단
- `http://localhost:5173/?date=2026-08-03` — 특정 날짜 (공유용 딥링크)

## 데이터 구조

`data/{ISO주차}.json` — 주차 파일. 파일명은 ISO-8601 주차이며,
2026-08-03(월)이 속한 주는 `2026-W32.json` 이다.

```json
{
  "week": "2026-W32",
  "range": { "start": "2026-08-03", "end": "2026-08-07" },
  "source": "2026년8월(1주) 주간업무8.3.~8.7.pdf",
  "days": [
    {
      "date": "2026-08-03",
      "menu": ["기장밥", "미역국", "..."],
      "headcount": {
        "total": 684,
        "breakdown": { "직원등": 130, "초등": 281, "중등": 246, "교행": 27 }
      }
    }
  ]
}
```

`data/index.json` — 보유한 주차·급식일 목록. 앱이 가장 먼저 받는 파일이다.

### 규칙

- `headcount.total` 은 `breakdown` 값들의 합과 반드시 일치한다.
  원본 PDF에서 성립하는 불변식이며, `check-data.mjs` 가 이를 검사한다.
- `breakdown`(직원등/초등/중등/교행)은 **화면에 표시하지 않는다.** 총원만 노출한다.
- `days` 에 없는 날짜는 급식이 없는 날로 취급한다.

## 배포

Netlify에 저장소를 연결하고 다음과 같이 설정한다.

| 항목 | 값 |
|---|---|
| Build command | (비움) |
| Publish directory | `.` |

`netlify.toml` 에 이미 들어 있으므로 별도 입력 없이 자동 인식된다.

> **저장소는 private 로 둘 것.** public 이면 식단과 급식인원이 그대로 열람된다.
> 원본 주간업무 PDF는 이 폴더에 두지 않으며, `.gitignore` 가 문서 확장자를 차단한다.
