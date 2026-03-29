const https = require('https');

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Referer': 'https://www.google.com/'
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
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function tryJSON(str) {
  try { return JSON.parse(str); } catch(e) { return null; }
}

exports.handler = async function(event, context) {
  const now = new Date();
  const TOURNAMENT_ID = now >= new Date('2026-04-09') ? '401580527' : '401811939';

  try {
    const { status, body } = await fetchURL(
      `https://www.espn.com/golf/leaderboard/_/tournamentId/${TOURNAMENT_ID}`
    );

    const compMatch = body.match(/"competitors":(\[[\s\S]*?\])\s*[,}]/);
    if (!compMatch) throw new Error('no competitors');

    const competitors = tryJSON(compMatch[1]);
    if (!competitors || !competitors.length) throw new Error('parse failed');

    const players = competitors.map(c => {
      const name = c.name || c.displayName || c.athlete?.displayName || '';
      const pos = c.pos || c.position || c.status?.position?.displayValue || '';
      const statusStr = String(c.status || '').toUpperCase();
      const posStr = String(pos).toUpperCase();
      // "-" position means ESPN hasn't assigned a position = missed cut or WD
      const isMC = ['CUT','WD','DQ','WITHDRAWN','MDF','MC'].includes(statusStr) ||
                   ['CUT','WD','DQ','MC'].includes(posStr) ||
                   statusStr.includes('WD') || statusStr.includes('WITH') ||
                   posStr === 'WD' || posStr === 'CUT' ||
                   pos === '-' || pos === '';
      const posNum = isMC ? 9999 : (parseInt(String(pos).replace(/[^0-9]/g,'')) || 999);
      const score = c.toPar || c.toParDisplay || c.today || c.score?.displayValue || 'E';
      const thru = c.thru != null ? String(c.thru) : '0';

      return { name, pos: posNum, posDisplay: String(pos), score: String(score), thru, isMC };
    }).filter(p => p.name);

    // Find Scottie specifically for debug
    const scottie = competitors.find(c => (c.name||'').toLowerCase().includes('scheffler'));
    const scottieRaw = scottie ? JSON.stringify(scottie).slice(0,400) : 'not found';

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
      body: JSON.stringify({ players, count: players.length, updated: new Date().toISOString(), scottieRaw })
    };

  } catch(e) {
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ players: [], error: e.message, updated: new Date().toISOString() })
    };
  }
};
