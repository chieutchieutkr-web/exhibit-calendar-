// 더보기 탭 "링크/텍스트로 추가" 처리 함수 (전시정보 캘린더용)
// 흐름: (유튜브 링크면) 설명란 가져오기 → Claude로 전시 정보 추출 → 장소 지오코딩 → GitHub의 data/exhibitions.json에 직접 커밋
// 실제 로직은 lib/exhibit-core.js (api/cron-update.js 와 공유). 필요한 환경변수도 그 파일 상단 참고.

import {
  youtubeId, fetchYoutubeMeta, extractExhibitionsWithClaude, buildEntry, githubGetFile, githubPutFile,
} from '../lib/exhibit-core.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 지원해요' }); return; }
  const input = (req.body && req.body.input || '').toString().trim();
  if (!input) { res.status(400).json({ error: '링크나 텍스트를 입력해주세요' }); return; }

  try {
    let rawText = input;
    let videoMeta = null;
    const ytId = youtubeId(input);
    if (ytId) {
      videoMeta = await fetchYoutubeMeta(ytId);
      rawText = videoMeta.description || videoMeta.title;
    }

    const items = await extractExhibitionsWithClaude(rawText);
    if (!items.length) {
      res.status(200).json({ added: [], message: '전시 기간까지 명확히 나온 정보를 못 찾았어요. 날짜가 포함된 설명/링크로 다시 시도해주세요.' });
      return;
    }

    const repo = process.env.GITHUB_REPO;
    const branch = process.env.GITHUB_BRANCH || 'main';
    if (!repo || !process.env.GITHUB_TOKEN) throw new Error('서버에 GITHUB_REPO / GITHUB_TOKEN이 설정되지 않았어요');

    const { content: data, sha } = await githubGetFile(repo, 'data/exhibitions.json', branch);

    const video = ytId ? { url: input, title: videoMeta.title, channel: videoMeta.channel } : null;
    const added = [];
    for (const it of items) {
      const entry = await buildEntry(it, video);
      data.exhibitions.push(entry);
      added.push(entry);
    }
    data.generatedAt = new Date().toISOString().slice(0, 10);

    await githubPutFile(repo, 'data/exhibitions.json', branch, data, sha, `feat: 링크 제출로 ${added.map((a) => a.title).join(', ')} 추가`);

    res.status(200).json({ added, message: `${added.length}건 추가했어요! 잠시 후 새로고침하면 반영돼요. 이동시간은 대략치라 정확한 정보는 확인해주세요.` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
