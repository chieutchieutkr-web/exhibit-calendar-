# 전시정보 캘린더

널위한문화예술 · 아츠앤트래블 유튜브 채널의 영상/쇼츠 설명란에서 전시 정보를 뽑아 보여주는 모바일 웹앱입니다.

**배포 주소**: https://exhibit-calendar.vercel.app

4탭 구조(캘린더 / 지도 / 저장 / 더보기)의 모바일 앱 디자인(`클로드 디자인/` 폴더의 handoff 문서 기준)을 그대로 구현했습니다.

## 문서 안내
- 이 README — 프로젝트 개요, 배포·연동 방법
- `CLAUDE.md` — Claude Code가 이 폴더에서 작업할 때 필요한 실무 정보(계정, 환경 이슈, 명령어)
- `메모리.md` — 왜 이렇게 만들어졌는지에 대한 결정 기록/히스토리
- `전시정보_캘린더_작동원리.docx` — 비개발자용 전체 작동 원리 설명 (Word 문서)
- `예약루틴_정보.txt` — 자동 업데이트 루틴 요약 (이름/주기/관리페이지)
- `AGENT_PROMPT.md` — 자동 업데이트 루틴이 실제로 따르는 작업 지시문

## 구조
- `index.html` / `styles.css` / `app.js` — 정적 웹앱 (빌드 과정 없음, 바닐라 JS)
- `data/exhibitions.json` — 전시 데이터 (화면에 표시되는 실제 데이터, 전시별 포인트 컬러·좌표 포함)
- `data/seen.json` — 이미 확인한 유튜브 영상 ID 기록 (중복 처리 방지용 상태 파일)
- `클로드 디자인/` — 디자인 레퍼런스(원본 handoff 문서, 화면 캡처) — git에는 포함 안 됨(`.gitignore`)

## 화면 구성
- **캘린더**: 날짜 스트립(가로 스크롤) + 선택일 전시 카드 목록(진행률 바, D-day)
- **지도**: 실제 네이버 지도(Dynamic Map) 위에 전시 위치를 건대입구 기준 이동시간과 함께 마커로 표시. 마커 탭 ↔ 하단 카드 캐러셀 연동, "네이버지도로 길찾기" 딥링크 제공. 수도권 밖 전시는 지도에 안 찍고 상단 칩으로만 안내
- **저장**: 관심 전시 북마크, 종료 D-7 임박 시 탭 진입 시 인앱 배너로 안내(실제 백그라운드 푸시 알림은 아님 — 앱을 열어야 표시됨)
- **더보기**: 기준 위치/알림/데이터 출처 안내

전시 카드를 탭하면 상세 바텀시트가 열리고 작가·주소·전시시간·전시특징·작가소개·"영상에서 꼭 봐야 할 내용"·추천 영상 링크를 확인할 수 있습니다.

## 네이버 지도(Maps) 연동 정보
- `index.html`의 `<script src="https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=...">` 에 Client ID가 들어있음(NCP Console > Maps > Application, 이름: `exhibit-calendar`)
- **Web 서비스 URL 등록 필수**: 그 NCP Application의 "Web 서비스 URL" 목록에 실제 배포 도메인(`https://exhibit-calendar.vercel.app`)이 이미 등록되어 있음. 도메인이 바뀌면(예: 커스텀 도메인 연결) 그때마다 여기도 추가해야 함
- Client ID는 공개돼도 되는 값(브라우저에 그대로 노출되는 방식) — 보안은 위 도메인 화이트리스트로 처리됨

## 로컬에서 보기
`data/exhibitions.json`을 `fetch()`로 불러오기 때문에 `file://`로 직접 열면 CORS로 실패합니다. 정적 서버를 띄워서 확인하세요:
```
npx --yes http-server -p 8080 -c-1 .
```
그 다음 `http://localhost:8080` 접속. 참고로 `?tab=cal|map|saved|more`, `?open=<전시id>` 쿼리 파라미터로 특정 탭/상세시트를 바로 열 수 있습니다.

## Vercel 배포
1. GitHub 저장소를 Vercel에 Import (Framework Preset: Other / 빌드 명령 없음, Output Directory: 루트)
2. 이후 이 저장소의 기본 브랜치에 push될 때마다 Vercel이 자동 재배포합니다.

## 자동 업데이트
매주 월요일 오전 9시(KST) 클라우드 예약 루틴(`exhibit-calendar-weekly-update`)이 두 채널의 새 영상을 확인해 `data/exhibitions.json`을 갱신하고 이 저장소에 commit/push합니다. 컴퓨터 전원 상태와 무관하게 클라우드에서 실행됩니다. 세부 로직은 `AGENT_PROMPT.md`, 루틴 관리는 https://claude.ai/code/routines/trig_01JgjGn4bmT4rnmZGjqkWdQf 참고.

수동으로 전시 정보를 추가/수정하고 싶으면 `data/exhibitions.json`을 직접 편집해서 push하면 됩니다.
