const https = require('https');

function fetchURL(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json,text/html,*/*',
        ...headers
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchURL(res.headers.location, headers).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function tryJSON(str) {
  try { return JSON.parse(str); } catch(e) { return null; }
}

exports.handler = async function(event, context) {
  const debug = [];

  // Try ESPN with event-specific URL using the known Houston Open event ID
  const urls = [
    'https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard',
    'https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard',
    // Try the specific event endpoint  
    'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/401580527/competitions/401580527/competitors?limit=200',
    'https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard?region=us&lang=en&contentorigin=espn',
  ];

  let players = [];

  for (const url of urls) {
    try {
      const { status, body } = await fetchURL(url);
      const data = tryJSON(body);
      debug.push(`${url.slice(0, 60)}: HTTP ${status}, bodyLen=${body.length}, parsed=${!!data}`);

      if (!data) {
        debug.push(`  body preview: ${body.slice(0, 100)}`);
        continue;
      }

      // ESPN leaderboard format
      const comps = data?.events?.[0]?.competitions?.[0]?.competitors || [];
      if (comps.length > 0) {
        players = comps.map(c => {
          const name = c.athlete?.displayName || '';
          const st = (c.status?.type?.name || '').toLowerCase();
          const pos = c.status?.position?.displayValue || '';
          const isMC = ['cut','wd','dq'].includes(st) || ['CUT','WD','DQ'].includes(pos);
          const posNum = isMC ? 9999 : (parseInt(pos.replace(/[^0-9]/g,'')) || 999);
          return { name, pos: posNum, posDisplay: pos, score: c.score?.displayValue || 'E', thru: c.status?.thru != null ? String(c.status.thru) : '', isMC };
        }).filter(p => p.name);
        debug.push(`  Found ${players.length} players!`);
        break;
      }

      // ESPN competitors array format (core API)
      const items = data?.items || [];
      if (items.length > 0) {
        debug.push(`  items format: ${items.length} items`);
      }

      debug.push(`  events=${data?.events?.length||0}, keys=${Object.keys(data).slice(0,8).join(',')}`);

    } catch(e) {
      debug.push(`  ERROR: ${e.message}`);
    }
  }

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    body: JSON.stringify({ players, count: players.length, updated: new Date().toISOString(), debug })
  };
};
