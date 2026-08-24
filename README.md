# 전시정보 캘린더

널위한문화예술 · 아츠앤트래블 유튜브 채널의 영상/쇼츠 설명란에서 전시 정보를 뽑아 보여주는 모바일 캘린더 웹앱입니다.

## 구조
- `index.html` / `styles.css` / `app.js` — 정적 웹앱 (빌드 과정 없음)
- `data/exhibitions.json` — 전시 데이터 (화면에 표시되는 실제 데이터)
- `data/seen.json` — 이미 확인한 유튜브 영상 ID 기록 (중복 처리 방지용 상태 파일)
- `AGENT_PROMPT.md` — 매주 자동 업데이트를 수행하는 클라우드 에이전트의 작업 지시문

## 로컬에서 보기
`index.html`을 브라우저로 열거나, 저장소 루트에서 정적 서버를 띄우면 됩니다 (예: `npx serve .`).

## Vercel 배포
1. GitHub 저장소를 Vercel에 Import (Framework Preset: Other / 빌드 명령 없음, Output Directory: 루트)
2. 이후 이 저장소의 기본 브랜치에 push될 때마다 Vercel이 자동 재배포합니다.

## 자동 업데이트
매주 클라우드 예약 에이전트(Claude 루틴)가 두 채널의 새 영상을 확인해 `data/exhibitions.json`을 갱신하고 이 저장소에 commit/push합니다. 컴퓨터 전원 상태와 무관하게 클라우드에서 실행됩니다. 세부 로직은 `AGENT_PROMPT.md` 참고.

수동으로 전시 정보를 추가/수정하고 싶으면 `data/exhibitions.json`을 직접 편집해서 push하면 됩니다.
