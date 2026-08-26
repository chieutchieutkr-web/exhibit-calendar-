# CLAUDE.md

이 파일은 Claude Code가 이 폴더(`[앱]전시정보 캘린더`)에서 작업할 때 참고하는 안내입니다.

## 이 폴더가 뭔지

널위한문화예술 · 아츠앤트래블 유튜브 채널에서 소개하는 전시 정보를 모아 보여주는 모바일 웹앱입니다. 빌드 도구 없는 순수 정적 사이트(HTML/CSS/바닐라 JS)이고, GitHub push → Vercel 자동 재배포 구조입니다. 매주 클라우드 예약 루틴이 새 영상을 확인해 전시 데이터를 자동으로 갱신합니다(사용자 PC 전원 상태와 무관하게 클라우드에서 실행).

세부 화면 구성·데이터 흐름은 `전시정보_캘린더_작동원리.docx`와 `README.md`를 참고하세요.

## 핵심 파일

- `index.html` / `styles.css` / `app.js` — 앱 본체 (4탭: 캘린더/지도/저장/더보기)
- `data/exhibitions.json` — 실제 전시 데이터 (색상 코드·좌표·전시 상세정보 포함)
- `data/seen.json` — 이미 처리한 유튜브 영상 ID 기록 (자동화가 중복 처리 안 하도록)
- `AGENT_PROMPT.md` — 매주 자동 업데이트 루틴이 그대로 따르는 작업 지시문. **루틴 동작을 바꾸고 싶으면 이 파일을 수정**하면 되고, claude.ai 루틴 설정 자체는 안 건드려도 됨(루틴 프롬프트가 "이 파일을 읽고 따라라"로만 되어 있음)
- `예약루틴_정보.txt` — 루틴 이름/주기/관리페이지 요약
- `전시정보_캘린더_작동원리.docx` — 비개발자용 전체 작동원리 설명 문서
- `클로드 디자인/` — 디자인 handoff 원본·화면 캡처·QA 스크린샷·아이콘 재생성 스크립트(`replace_icons.py`) (git 추적 제외, `.gitignore` 참고)
- `전시정보 캘린더 앱 디자인/app_icon/` — 디자인팀이 만든 진짜 앱 아이콘 원본 세트(60~1024px, rounded/square 변형 포함). 프로젝트 루트에 있지만 git 추적 제외(`.gitignore`). `icons/`, `앱아이콘.png`, `앱아이콘.ico`는 전부 이 폴더에서 리사이즈해서 만든 것 — **아이콘을 다시 만들 필요가 있으면 이 원본 폴더가 먼저 있는지 확인하고, 있으면 절대 새로 생성하지 말고 여기서 리사이즈만 할 것**(`클로드 디자인/replace_icons.py` 참고)

## 외부 서비스 계정 (전부 서로 다른 별개 계정)

- **GitHub**: `chieutchieutkr-web` 계정, 저장소 `exhibit-calendar-` (이름 끝에 하이픈 있음, 오타 아님)
- **Vercel**: 배포 주소 `https://exhibit-calendar.vercel.app`, GitHub 저장소와 연결되어 push마다 자동 재배포
- **네이버 클라우드 플랫폼(NCP) Maps**: Application 이름 `exhibit-calendar`, Client ID는 `index.html`의 `<script src="...maps.js?ncpKeyId=...">`에 하드코딩되어 있음(공개돼도 되는 값 — 보안은 NCP의 "Web 서비스 URL" 도메인 화이트리스트가 담당). **배포 도메인이 바뀌면 NCP Application의 Web 서비스 URL에도 그 도메인을 추가해야 지도가 뜸.**
- **claude.ai 예약 루틴**: `exhibit-calendar-weekly-update` (trig_01JgjGn4bmT4rnmZGjqkWdQf), 관리: https://claude.ai/code/routines

## 이 환경에서 반드시 알아야 할 것들

- **PowerShell + 대괄호 포함 경로**: 이 폴더 이름 자체가 `[앱]전시정보 캘린더`처럼 대괄호를 포함합니다. PowerShell의 `Get-Content`/`Test-Path`/`cd` 등은 `[`, `]`를 와일드카드로 해석해 실패합니다. 반드시 `-LiteralPath`를 쓰거나(`Set-Location -LiteralPath "..."`), Bash(Git Bash)에서 작업하세요.
- **git push 인증**: 이 폴더는 git 저장소이고 origin이 GitHub `chieutchieutkr-web/exhibit-calendar-`로 연결되어 있습니다. 로컬 Bash 도구는 `git push` 시 브라우저 로그인 창을 띄우지 못해 멈춥니다(interactive 인증) — 이 경우 **사용자가 직접 자기 터미널(VS Code 등)에서 `git push` 실행**해야 브라우저 로그인이 뜹니다. 단, Windows Credential Manager에 한 번 인증되면 이후에는 Bash 도구에서도 캐시된 자격증명으로 바로 push됩니다.
- **Vercel CLI 로그인도 동일한 이유로 자동화 불가**: `vercel login`도 대화형이라 Bash 도구에서 완료 안 됨 — Vercel은 대시보드(vercel.com/new)에서 GitHub Import 방식으로 진행하는 게 유일하게 안정적인 방법입니다.
- **로컬 QA 서버**: `npx --yes http-server -p 8080 -c-1 .` 로 띄우고 `http://localhost:8080`에서 확인. `data/exhibitions.json`을 `fetch()`로 읽으므로 `file://`로 직접 열면 CORS로 실패합니다.
- **Edge 헤드리스 스크린샷으로 QA**: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe --headless --disable-gpu --window-size=520,950 --screenshot="출력경로.png" "URL"`. 참고: 이 환경에서 헤드리스 브라우저의 실제 렌더링 viewport가 요청한 `--window-size`보다 커지는 경우가 있었음(약 496px 폭으로 고정되는 현상 확인됨) — 좁은 뷰포트를 정확히 재현하려는 목적이 아니라면 window-size를 넉넉히(500 이상) 주고 스크린샷을 찍는 게 잘림 없이 확인하기 편함.
- **app.js에 `?tab=cal|map|saved|more`, `?open=<전시id>` 쿼리 파라미터 지원 있음** — 특정 탭/상세시트를 URL로 바로 열 수 있어 QA 스크린샷 찍을 때 유용함(예: `?tab=map`, `?open=baselitz-sehwa-2026`).
- **네이버 지도 스크립트 파라미터명 주의**: 예전 문서에는 `ncpClientId`로 나오지만, 현재(2026 기준) 정식 파라미터명은 **`ncpKeyId`**임. 틀리면 "네이버 지도 Open API 인증이 실패했습니다" 에러가 뜸(도메인 미등록 에러랑 메시지가 똑같아서 헷갈리기 쉬움 — 파라미터명부터 확인할 것).
- **저장(북마크) 상태는 브라우저 localStorage 기반** — 서버에 저장되지 않고 기기/브라우저별로 따로 유지됨. 종료 D-7 알림도 실시간 푸시가 아니라 앱을 열었을 때 보이는 인앱 배너임(진짜 백그라운드 알림 아님, 정적 사이트의 한계).
- **Vercel 자동 재배포 원리**: GitHub 저장소를 Vercel에 Import하는 순간 Vercel이 그 저장소에 웹훅(webhook)을 등록함. 그래서 `git push`할 때마다 GitHub가 Vercel에 즉시 알림을 보내고, Vercel이 자동으로 최신 코드를 가져와 재배포함(사람이 버튼 누를 필요 없음). n8n 등에서 쓰는 웹훅과 원리가 동일함.
- **Windows 폴더 아이콘**: 이 프로젝트 폴더 자체의 탐색기 아이콘이 `앱아이콘.ico`로 지정되어 있음 — `desktop.ini`(Hidden+System 속성) + 폴더 자체의 System 속성 조합으로 구현됨. 아이콘을 바꾸면 같은 파일명(`앱아이콘.ico`)에 덮어쓰기만 하면 자동 반영됨(desktop.ini 재작성 불필요). `desktop.ini`/`앱아이콘.png`/`앱아이콘.ico`는 로컬 전용이라 git 추적 안 함.
- **iOS 홈 화면 앱(PWA)에서 위치 권한이 막히는 문제**: `apple-mobile-web-app-capable` 메타태그, manifest의 `scope`/`id` 필드를 다 넣어도 특정 기기에서 여전히 위치 권한 팝업 자체가 안 뜰 수 있음 — 이땐 코드 문제가 아니라 **그 아이폰의 권한 기록이 꼬여있는 것**일 수 있다. 해결법: 아이폰에서 설정 > 일반 > 전송 또는 재설정 > 재설정 > "위치 및 개인정보 보호 재설정" → 재시동 → 홈 화면 앱 재실행. 자세한 경위는 `메모리.md` 참고.

## 상위 폴더와의 관계

이 폴더는 `앱/자동화 프로그램`과는 별개 프로젝트지만, 그 폴더의 `자동화 상황판`(claude.ai 아티팩트, `자동화 상황판.url`로 열림)에 이 프로젝트의 예약 루틴도 함께 등록해 표시하고 있습니다. 루틴 상태가 바뀌면(이름 변경, 재생성 등) 그 상황판도 같이 갱신해주는 게 좋습니다.
