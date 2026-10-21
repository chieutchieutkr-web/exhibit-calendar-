// 전시 등록 공통 로직 (api/submit.js 와 api/cron-update.js 가 같이 씀)
// 흐름: 유튜브 설명란 → Claude로 전시 정보 추출 → 장소 지오코딩(좌표+건대입구 기준 대략 이동시간) → GitHub 커밋
//
// 필요한 Vercel 환경변수:
//   YOUTUBE_API_KEY, ANTHROPIC_API_KEY, NAVER_SEARCH_CLIENT_ID, NAVER_SEARCH_CLIENT_SECRET,
//   GITHUB_TOKEN (repo 쓰기 권한), GITHUB_REPO ("owner/repo", 끝에 하이픈 포함: chieutchieutkr-web/exhibit-calendar-)

export const COLOR_PALETTE = [
  ['#C9426F', '#FCE9F0'], ['#7C6BC4', '#EDE9FB'], ['#6E4E7E', '#F1E9F5'], ['#D4653A', '#FCEDE5'],
  ['#3F7F79', '#E6F2F0'], ['#A8802A', '#F7EFDD'], ['#3E6FA8', '#E8F0F9'], ['#B23A56', '#F9E1E7'],
  ['#2D6E8E', '#E1EDF2'], ['#5C8A3A', '#EAF1E2'], ['#7A6A4E', '#F0EBE0'], ['#B08968', '#F3EAE0'],
];
export const ORIGIN = { lat: 37.5407, lng: 127.0700 }; // 건국대학교병원

export function youtubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:v=|youtu\.be\/|\/shorts\/)([\w-]{6,})/);
  return m ? m[1] : null;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function estimateMinutes(km) {
  const raw = 12 + (km / 17) * 60;
  return Math.max(5, Math.round(raw / 5) * 5);
}

// 영상 ID 여러 개의 제목/채널/설명란 전문을 한 번에 가져옴(YouTube Data API는 id를 콤마로 최대 50개)
export async function fetchYoutubeMetaBatch(videoIds) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('서버에 YOUTUBE_API_KEY가 설정되지 않았어요');
  if (!videoIds.length) return {};
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoIds.join(',')}&key=${key}`;
  const r = await fetch(url);
  const json = await r.json();
  const out = {};
  for (const item of json.items || []) {
    out[item.id] = { title: item.snippet.title, channel: item.snippet.channelTitle, description: item.snippet.description };
  }
  return out;
}

export async function fetchYoutubeMeta(videoId) {
  const meta = (await fetchYoutubeMetaBatch([videoId]))[videoId];
  if (!meta) throw new Error('유튜브에서 해당 영상을 찾을 수 없어요');
  return meta;
}

export async function extractExhibitionsWithClaude(rawText, today) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('서버에 ANTHROPIC_API_KEY가 설정되지 않았어요');

  const tool = {
    name: 'extract_exhibitions',
    description: '텍스트에서 언급된 전시 정보를 추출한다. 전시 시작/종료 날짜가 명확히 안 나와 있으면 그 전시는 통째로 제외한다(추측 금지). 언급이 없으면 빈 배열을 반환.',
    input_schema: {
      type: 'object',
      properties: {
        exhibitions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '전시 제목' },
              artist: { type: 'string', description: '작가명 (생몰년 등 포함 가능)' },
              venue: { type: 'string', description: '전시 장소(미술관/갤러리 이름)' },
              address: { type: ['string', 'null'], description: '주소, 텍스트에 명시 안 됐으면 null' },
              periodStart: { type: 'string', description: 'YYYY-MM-DD 형식 시작일. 텍스트에 없으면 이 전시 자체를 결과에서 제외할 것' },
              periodEnd: { type: 'string', description: 'YYYY-MM-DD 형식 종료일. 텍스트에 없으면 이 전시 자체를 결과에서 제외할 것' },
              hours: { type: ['string', 'null'], description: '관람시간' },
              closedDay: { type: ['string', 'null'], description: '휴관일' },
              nightOpenDays: { type: ['string', 'null'], description: '야간개장 요일(있으면)' },
              nightOpenTime: { type: ['string', 'null'], description: '야간개장 시간(있으면)' },
              admission: { type: ['string', 'null'], description: '입장료' },
              features: { type: 'array', items: { type: 'string' }, description: '전시 특징 1~3개, 문장 단위' },
              artistIntro: { type: ['string', 'null'], description: '작가 소개 한 단락' },
              videoHighlights: { type: 'array', items: { type: 'string' }, description: '영상에서 소개한 볼거리 포인트들(있으면)' },
            },
            required: ['title', 'artist', 'venue', 'periodStart', 'periodEnd'],
          },
        },
      },
      required: ['exhibitions'],
    },
  };

  const todayNote = today ? `오늘 날짜는 ${today}야. 이건 연도가 생략된 날짜를 해석할 때만 참고하고, 시작일이나 종료일이 텍스트에 없을 때 오늘 날짜로 채우면 안 돼(그 전시는 제외).\n` : '';
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2500,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'extract_exhibitions' },
      messages: [{
        role: 'user',
        content: `다음은 유튜브 영상 설명란 또는 사용자가 직접 붙여넣은 텍스트야. 여기 언급된 미술 전시 정보를 모두 뽑아줘. 대한민국 안에서 열리는 전시만 뽑고, 일본·유럽 등 해외 전시는 제외해줘. 전시 기간은 시작일과 종료일이 둘 다 텍스트에 명시된 전시만 뽑고(종료일만 있거나 "현재 전시 ~종료일"처럼 시작일이 없으면 제외), 날짜를 추측하지 마. 없으면 빈 배열로 답해.\n${todayNote}\n---\n${rawText}\n---`,
      }],
    }),
  });
  if (!r.ok) { const t = await r.text(); throw new Error('Claude 호출 실패: ' + t.slice(0, 300)); }
  const json = await r.json();
  const toolUse = (json.content || []).find((c) => c.type === 'tool_use');
  if (!toolUse) return [];
  return (toolUse.input.exhibitions || []).filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.periodStart) && /^\d{4}-\d{2}-\d{2}$/.test(e.periodEnd));
}

export async function geocodeVenue(venue, address) {
  const id = process.env.NAVER_SEARCH_CLIENT_ID;
  const secret = process.env.NAVER_SEARCH_CLIENT_SECRET;
  if (!id || !secret) return null;
  const q = address ? `${venue} ${address}` : venue;
  try {
    const url = 'https://naverapihub.apigw.ntruss.com/search/v1/local?query=' + encodeURIComponent(q) + '&display=1&format=json';
    const r = await fetch(url, { headers: { 'X-NCP-APIGW-API-KEY-ID': id, 'X-NCP-APIGW-API-KEY': secret } });
    const json = await r.json();
    const item = json.items && json.items[0];
    if (!item) return null;
    return { address: address || item.roadAddress || item.address || null, lat: Number(item.mapy) / 1e7, lng: Number(item.mapx) / 1e7 };
  } catch { return null; }
}

export async function githubGetFile(repo, path, branch) {
  const token = process.env.GITHUB_TOKEN;
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`, {
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!r.ok) throw new Error('GitHub에서 파일을 못 읽었어요: ' + r.status);
  const json = await r.json();
  return { content: JSON.parse(Buffer.from(json.content, 'base64').toString('utf8')), sha: json.sha };
}
export async function githubPutFile(repo, path, branch, dataObj, sha, message) {
  const token = process.env.GITHUB_TOKEN;
  const content = Buffer.from(JSON.stringify(dataObj, null, 2), 'utf8').toString('base64');
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' },
    body: JSON.stringify({ message, content, sha, branch }),
  });
  if (!r.ok) { const t = await r.text(); throw new Error('GitHub 저장 실패: ' + t.slice(0, 300)); }
  return r.json();
}

function slugify(title, venue) {
  const base = (title + '-' + venue).toLowerCase()
    .replace(/[^\w가-힣]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return base + '-' + Math.random().toString(36).slice(2, 6);
}

// 추출된 전시 1건 → exhibitions.json 항목 (지오코딩·이동시간 포함). video: {url,title,channel} | null
export async function buildEntry(it, video) {
  const geo = await geocodeVenue(it.venue, it.address);
  const [color, colorSoft] = COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
  let transit = null;
  if (geo?.lat != null) {
    const km = haversineKm(ORIGIN.lat, ORIGIN.lng, geo.lat, geo.lng);
    transit = { text: `약 ${estimateMinutes(km)}분`, note: '건대입구 기준 직선거리 추정치(자동 등록, 실제 대중교통 경로 아님)' };
  }
  return {
    id: slugify(it.title, it.venue),
    title: it.title,
    artist: it.artist,
    venue: it.venue,
    address: geo?.address || it.address || null,
    color, colorSoft,
    lat: geo?.lat ?? null,
    lng: geo?.lng ?? null,
    period: { start: it.periodStart, end: it.periodEnd },
    hours: it.hours || null,
    closedDay: it.closedDay || '',
    nightOpen: it.nightOpenDays ? { days: it.nightOpenDays, time: it.nightOpenTime || '' } : null,
    admission: it.admission || null,
    transit,
    features: it.features || [],
    videoHighlights: it.videoHighlights || [],
    artistIntro: it.artistIntro || null,
    video: video || null,
    submittedAt: new Date().toISOString(),
  };
}
