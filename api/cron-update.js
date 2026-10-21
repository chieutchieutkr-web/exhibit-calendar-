// Vercel Cron이 매일 호출하는 자동 업데이트 함수 (vercel.json의 crons 참고)
// 흐름: 두 채널 최신 영상 목록(YouTube Data API) → data/seen.json에 없는 새 영상만 → 설명란 전문 조회 → Claude로 전시 추출 → 지오코딩 → GitHub 커밋
// (클라우드 루틴 샌드박스는 youtube.com이 막혀 있어서, YouTube 접속을 Vercel 서버에서 처리하도록 옮긴 것)
//
// 추가 환경변수: CRON_SECRET (아무 긴 랜덤 문자열). 설정하면 Vercel이 호출 때 Authorization: Bearer <값>을 자동으로 붙임.
// 수동 테스트: GET /api/cron-update?dry=1  (Authorization 헤더 필요, GitHub에 쓰지 않고 결과만 반환)

import {
  fetchYoutubeMetaBatch, extractExhibitionsWithClaude, buildEntry, githubGetFile, githubPutFile,
} from '../lib/exhibit-core.js';

export const config = { maxDuration: 60 };

const CHANNELS = {
  'UCZr3cu75jx6Sz-6KRQ50ySA': '널위한문화예술',
  'UCHp20VblCGxxsV9PZzRwYBw': '아츠앤트래블',
};
const RECENT_DAYS = 7; // 이보다 오래된 미처리 영상은 무시(주 1회 갱신 기준으로 최근 일주일치만)
const MAX_VIDEOS_PER_RUN = 4; // 함수 실행시간 제한 때문에 한 번에 처리할 영상 수. 나머지는 다음날 실행에서 이어서 처리됨

// 채널의 최신 업로드 영상 목록. RSS(feeds/videos.xml)는 404/500이 자주 나서 YouTube Data API의 업로드 재생목록(UU + 채널ID 뒷부분)을 씀
async function fetchFeedVideoIds(channelId) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('서버에 YOUTUBE_API_KEY가 설정되지 않았어요');
  const playlistId = 'UU' + channelId.slice(2);
  const r = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${playlistId}&maxResults=15&key=${key}`);
  if (!r.ok) throw new Error(`영상 목록 조회 실패(${channelId}): ${r.status} ${(await r.text()).slice(0, 200)}`);
  const json = await r.json();
  return (json.items || []).map((it) => ({ id: it.contentDetails.videoId, published: it.contentDetails.videoPublishedAt }));
}

const norm = (s) => (s || '').toLowerCase().replace(/[^\w가-힣]+/g, '');
function isDuplicate(existing, it) {
  const t = norm(it.title);
  const v = norm(it.venue);
  return existing.some((e) => {
    const et = norm(e.title);
    const ev = norm(e.venue);
    const sameTitle = t && et && (et.includes(t) || t.includes(et));
    const sameVenue = v && ev && (ev.includes(v) || v.includes(ev));
    return sameTitle && sameVenue;
  });
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) { res.status(401).json({ error: 'unauthorized' }); return; }
  const dry = req.query && req.query.dry === '1';

  try {
    const repo = process.env.GITHUB_REPO;
    const branch = process.env.GITHUB_BRANCH || 'main';
    if (!repo || !process.env.GITHUB_TOKEN) throw new Error('서버에 GITHUB_REPO / GITHUB_TOKEN이 설정되지 않았어요');
    const today = new Date().toISOString().slice(0, 10);

    const seenFile = await githubGetFile(repo, 'data/seen.json', branch);
    const seen = seenFile.content;

    // 1) 새 영상 후보 모으기 (채널별로 seen에 없고, 최근 7일 안에 올라온 것만)
    const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
    const candidates = [];
    for (const [channelId, name] of Object.entries(CHANNELS)) {
      const ch = (seen.channels[channelId] ||= { name, seenVideoIds: [] });
      const feed = await fetchFeedVideoIds(channelId);
      for (const v of feed) {
        if (ch.seenVideoIds.includes(v.id)) continue;
        if (new Date(v.published).getTime() < cutoff) continue;
        candidates.push({ ...v, channelId });
      }
    }
    candidates.sort((a, b) => a.published.localeCompare(b.published));
    const batch = candidates.slice(0, MAX_VIDEOS_PER_RUN);
    if (!batch.length) { res.status(200).json({ message: '신규 영상 없음', pending: 0 }); return; }

    // 2) 설명란 전문 + 전시 추출
    const metas = await fetchYoutubeMetaBatch(batch.map((v) => v.id));
    const exFile = await githubGetFile(repo, 'data/exhibitions.json', branch);
    const data = exFile.content;
    const added = [];
    const processed = [];
    const failed = [];
    for (const v of batch) {
      const meta = metas[v.id];
      if (!meta) { failed.push({ id: v.id, reason: 'YouTube API에서 영상을 못 찾음' }); continue; } // seen에 안 넣어서 다음에 재시도
      try {
        const items = await extractExhibitionsWithClaude(meta.description || meta.title, today);
        for (const it of items) {
          if (it.periodEnd < today) continue; // 이미 끝난 전시는 등록하지 않음
          if (isDuplicate(data.exhibitions, it)) continue;
          const entry = await buildEntry(it, { url: `https://www.youtube.com/watch?v=${v.id}`, title: meta.title, channel: meta.channel });
          data.exhibitions.push(entry);
          added.push({ title: entry.title, venue: entry.venue, period: entry.period, video: v.id });
        }
        processed.push(v);
      } catch (e) {
        failed.push({ id: v.id, reason: e.message }); // 추출 실패한 영상은 seen에 안 넣어 다음 실행에서 재시도
      }
    }

    const result = { added, processed: processed.map((v) => v.id), failed, pending: candidates.length - batch.length };
    if (dry) { res.status(200).json({ dry: true, ...result }); return; }

    // 3) 커밋: 전시 데이터 → seen (seen을 나중에 써서, 전시 저장이 실패하면 영상을 다시 처리하게 함)
    if (added.length) {
      data.generatedAt = today;
      await githubPutFile(repo, 'data/exhibitions.json', branch, data, exFile.sha, `chore: 전시정보 자동 업데이트 (${today}) - ${added.map((a) => a.title).join(', ')}`);
    }
    if (processed.length) {
      for (const v of processed) seen.channels[v.channelId].seenVideoIds.push(v.id);
      await githubPutFile(repo, 'data/seen.json', branch, seen, seenFile.sha, `chore: 처리한 영상 기록 (${today})`);
    }
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
