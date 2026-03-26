const https = require('https');

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.espn.com/'
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch(e) { reject(new Error('JSON parse failed: ' + body.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

exports.handler = async function(event, context) {
  const endpoints = [
    'https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard',
    'https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard',
    'https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard?enable=roster',
  ];

  let players = [];
  let lastError = '';
  let debugInfo = [];

  for (const url of endpoints) {
    try {
      const { status, data } = await fetchURL(url);
      debugInfo.push(`${url}: HTTP ${status}, events: ${data?.events?.length || 0}`);
      if (status !== 200) { lastError = 'HTTP ' + status; continue; }
      
      const competitors = data?.events?.[0]?.competitions?.[0]?.competitors || [];
      debugInfo.push(`competitors: ${competitors.length}`);
      
      if (!competitors.length) { lastError = 'No competitors'; continue; }

      players = competitors.map(c => {
        const name = c.athlete?.displayName || '';
        const statusName = (c.status?.type?.name || '').toLowerCase();
        const pos = c.status?.position?.displayValue || '';
        const isMC = statusName === 'cut' || statusName === 'wd' || statusName === 'dq' || ['CUT','WD','DQ'].includes(pos);
        const posNum = isMC ? 9999 : (parseInt(pos.replace(/[^0-9]/g, '')) || 999);
        return {
          name,
          pos: posNum,
          posDisplay: pos,
          score: c.score?.displayValue || 'E',
          thru: c.status?.thru != null ? String(c.status.thru) : '',
          isMC
        };
      }).filter(p => p.name);

      if (players.length) break;
    } catch(e) {
      lastError = e.message;
      debugInfo.push('Error: ' + e.message);
      continue;
    }
  }

  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60'
    },
    body: JSON.stringify({ players, updated: new Date().toISOString(), debug: debugInfo, error: lastError || null })
  };
};
