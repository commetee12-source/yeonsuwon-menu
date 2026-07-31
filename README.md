# 연수원 식단

서울특별시교육청교육연수원 구내식당 식단을 날짜로 조회하는 웹앱.
빌드 도구·npm 의존성 없이 HTML + CSS + 바닐라 JS로만 동작한다.

## 매주 갱신하는 법

1. 새 「주간업무」 PDF를 볼트(`D:\obsi\menu\`)에 저장한다.
2. Claude Code에 이렇게 말한다: **"이번 주 식단 JSON 만들어줘"**
   - PDF 2쪽 `<행정지원과>` 의 "2. 주간식단(과정별 급식인원 및 식단)" 표를 읽어
     `data/2026-W33.json` 형태로 새 주차 파일을 만들고
     `data/index.json` 의 `weeks` · `latest` · `coverage` · `days` · `updatedAt` 을 갱신한다.
3. 검증한다.

   ```bash
   node scripts/check-data.mjs
   ```

4. 커밋 & 푸시하면 Netlify가 자동 배포한다 (약 30초).

   ```bash
   git add data/ && git commit -m "data: 2026-W33 식단" && git push
   ```

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
