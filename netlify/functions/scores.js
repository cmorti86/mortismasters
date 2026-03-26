const https = require('https');

function fetchURL(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
    };
    const req = https.get(url, { headers: { ...defaultHeaders, ...headers } }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchURL(res.headers.location, headers).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body, data: tryJSON(body) }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function tryJSON(str) {
  try { return JSON.parse(str); } catch(e) { return null; }
}

function parseESPN(data) {
  const competitors = data?.events?.[0]?.competitions?.[0]?.competitors || [];
  return competitors.map(c => {
    const name = c.athlete?.displayName || '';
    const statusName = (c.status?.type?.name || '').toLowerCase();
    const pos = c.status?.position?.displayValue || '';
    const isMC = ['cut','wd','dq'].includes(statusName) || ['CUT','WD','DQ'].includes(pos);
    const posNum = isMC ? 9999 : (parseInt(pos.replace(/[^0-9]/g, '')) || 999);
    return { name, pos: posNum, posDisplay: pos, score: c.score?.displayValue || 'E', thru: c.status?.thru != null ? String(c.status.thru) : '', isMC };
  }).filter(p => p.name);
}

exports.handler = async function(event, context) {
  const debug = [];
  let players = [];

  // Try multiple ESPN endpoints with different approaches
  const attempts = [
    { url: 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard', headers: {} },
    { url: 'https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard', headers: {} },
    { url: 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard?limit=200', headers: {} },
    { url: 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard', headers: { 'Referer': 'https://www.espn.com/golf/leaderboard', 'Origin': 'https://www.espn.com' } },
  ];

  for (const attempt of attempts) {
    try {
      const { status, body, data } = await fetchURL(attempt.url, attempt.headers);
      const eventCount = data?.events?.length || 0;
      const compCount = data?.events?.[0]?.competitions?.[0]?.competitors?.length || 0;
      debug.push(`${attempt.url.split('?')[0]}: HTTP ${status}, events=${eventCount}, competitors=${compCount}`);
      
      if (data && compCount > 0) {
        players = parseESPN(data);
        if (players.length) { debug.push(`SUCCESS: ${players.length} players`); break; }
      } else if (status === 200 && eventCount === 0) {
        // Log first 200 chars of body to understand what we're getting
        debug.push(`Body preview: ${body.slice(0, 150)}`);
      }
    } catch(e) {
      debug.push(`Error: ${e.message}`);
    }
  }

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    body: JSON.stringify({ players, updated: new Date().toISOString(), debug, count: players.length })
  };
};
