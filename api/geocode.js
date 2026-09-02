// 장소명/주소 → 좌표 변환 프록시. 네이버 지역검색 Client Secret을 서버(Vercel)에만 두기 위한 함수.
// 환경변수(Vercel Project Settings > Environment Variables): NAVER_SEARCH_CLIENT_ID, NAVER_SEARCH_CLIENT_SECRET
export default async function handler(req, res) {
  const q = (req.query.q || '').toString().trim();
  if (!q) {
    res.status(400).json({ error: '검색어(q)가 필요해요' });
    return;
  }
  const id = process.env.NAVER_SEARCH_CLIENT_ID;
  const secret = process.env.NAVER_SEARCH_CLIENT_SECRET;
  if (!id || !secret) {
    res.status(500).json({ error: '서버에 네이버 검색 키가 설정되지 않았어요 (Vercel 환경변수 확인 필요)' });
    return;
  }
  try {
    const url = 'https://naverapihub.apigw.ntruss.com/search/v1/local?query=' + encodeURIComponent(q) + '&display=1&format=json';
    const r = await fetch(url, {
      headers: { 'X-NCP-APIGW-API-KEY-ID': id, 'X-NCP-APIGW-API-KEY': secret },
    });
    const json = await r.json();
    const item = json.items && json.items[0];
    if (!item) {
      res.status(404).json({ error: '검색 결과가 없어요' });
      return;
    }
    res.status(200).json({
      label: item.title.replace(/<\/?b>/g, ''),
      address: item.roadAddress || item.address || null,
      lat: Number(item.mapy) / 1e7,
      lng: Number(item.mapx) / 1e7,
    });
  } catch (e) {
    res.status(500).json({ error: '검색 중 오류가 발생했어요: ' + e.message });
  }
}
