const https = require('https');

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.espn.com/golf/leaderboard',
        'Origin': 'https://www.espn.com'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchURL(res.headers.location).then(resolve).catch(reject);
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

function parseCompetitors(comps) {
  return comps.map(c => {
    const name = c.athlete?.displayName || '';
    const st = (c.status?.type?.name || '').toLowerCase();
    const pos = c.status?.position?.displayValue || '';
    const isMC = ['cut','wd','dq'].includes(st) || ['CUT','WD','DQ'].includes(pos);
    const posNum = isMC ? 9999 : (parseInt(pos.replace(/[^0-9]/g,'')) || 999);
    return { name, pos: posNum, posDisplay: pos, score: c.score?.displayValue || 'E', thru: c.status?.thru != null ? String(c.status.thru) : '', isMC };
  }).filter(p => p.name);
}

exports.handler = async function(event, context) {
  const debug = [];
  let players = [];

  // Use the correct tournament-specific ESPN endpoints
  const TOURNAMENT_ID = '401811939'; // 2026 Houston Open
  const MASTERS_ID = '401580527';    // 2026 Masters (use for April)

  const urls = [
    `https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard?tournamentId=${TOURNAMENT_ID}`,
    `https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard?tournamentId=${TOURNAMENT_ID}`,
    `https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard?tournamentId=${TOURNAMENT_ID}&enable=roster`,
    // Fallback: generic leaderboard
    'https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard',
  ];

  for (const url of urls) {
    try {
      const { status, body } = await fetchURL(url);
      const data = tryJSON(body);
      const comps = data?.events?.[0]?.competitions?.[0]?.competitors || [];
      debug.push(`${url.slice(0,80)}: HTTP ${status}, comps=${comps.length}`);

      if (comps.length > 0) {
        players = parseCompetitors(comps);
        debug.push(`SUCCESS: ${players.length} players loaded`);
        break;
      }

      if (!data) debug.push(`  Not JSON: ${body.slice(0,100)}`);
      else debug.push(`  events=${data?.events?.length||0}, keys=${Object.keys(data).slice(0,6).join(',')}`);

    } catch(e) {
      debug.push(`ERROR on ${url.slice(0,60)}: ${e.message}`);
    }
  }

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
    body: JSON.stringify({ players, count: players.length, updated: new Date().toISOString(), debug })
  };
};
