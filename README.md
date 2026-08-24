# 전시정보 캘린더

널위한문화예술 · 아츠앤트래블 유튜브 채널의 영상/쇼츠 설명란에서 전시 정보를 뽑아 보여주는 모바일 캘린더 웹앱입니다.

4탭 구조(캘린더 / 지도 / 저장 / 더보기)의 모바일 앱 디자인(`클로드 디자인/` 폴더의 handoff 문서 기준)을 그대로 구현했습니다.

## 구조
- `index.html` / `styles.css` / `app.js` — 정적 웹앱 (빌드 과정 없음, 바닐라 JS)
- `data/exhibitions.json` — 전시 데이터 (화면에 표시되는 실제 데이터, 전시별 포인트 컬러·좌표 포함)
- `data/seen.json` — 이미 확인한 유튜브 영상 ID 기록 (중복 처리 방지용 상태 파일)
- `AGENT_PROMPT.md` — 매주 자동 업데이트를 수행하는 클라우드 에이전트의 작업 지시문
- `클로드 디자인/` — 디자인 레퍼런스(원본 handoff 문서, 화면 캡처)

## 화면
- **캘린더**: 날짜 스트립(가로 스크롤) + 선택일 전시 카드 목록(진행률 바, D-day)
- **지도**: 실제 네이버 지도(Dynamic Map) 위에 전시 위치를 건대입구 기준 이동시간과 함께 마커로 표시. 마커 탭 ↔ 하단 카드 캐러셀 연동, "네이버지도로 길찾기" 딥링크 제공. 수도권 밖 전시는 지도에 안 찍고 상단 칩으로만 안내.

### 네이버 지도(Maps) 연동 정보
- `index.html`의 `<script src="https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=...">` 에 Client ID가 들어있음(NCP Console > Maps > Application, 이름: `exhibit-calendar`)
- **Web 서비스 URL 등록 필수**: 그 NCP Application의 "Web 서비스 URL" 목록에 실제 배포 도메인(예: `https://exhibit-calendar-xxxx.vercel.app`)이 등록되어 있어야 지도가 뜬다. 배포 도메인이 바뀌면(예: 커스텀 도메인 연결) 그때마다 여기도 추가해야 함
- Client ID는 공개돼도 되는 값(브라우저에 그대로 노출되는 방식) — 보안은 위 도메인 화이트리스트로 처리됨
- **저장**: 관심 전시 북마크, 종료 D-7 임박 시 탭 진입 시 인앱 배너로 안내(실제 백그라운드 푸시 알림은 아님 — 앱을 열어야 표시됨)
- **더보기**: 기준 위치/알림/데이터 출처 안내

## 로컬에서 보기
`index.html`을 브라우저로 열거나, 저장소 루트에서 정적 서버를 띄우면 됩니다 (예: `npx serve .`).

## Vercel 배포
1. GitHub 저장소를 Vercel에 Import (Framework Preset: Other / 빌드 명령 없음, Output Directory: 루트)
2. 이후 이 저장소의 기본 브랜치에 push될 때마다 Vercel이 자동 재배포합니다.

## 자동 업데이트
매주 클라우드 예약 에이전트(Claude 루틴)가 두 채널의 새 영상을 확인해 `data/exhibitions.json`을 갱신하고 이 저장소에 commit/push합니다. 컴퓨터 전원 상태와 무관하게 클라우드에서 실행됩니다. 세부 로직은 `AGENT_PROMPT.md` 참고.

수동으로 전시 정보를 추가/수정하고 싶으면 `data/exhibitions.json`을 직접 편집해서 push하면 됩니다.
