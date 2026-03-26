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
  const debug = [];
  let players = [];

  const now = new Date();
  const TOURNAMENT_ID = now >= new Date('2026-04-09') ? '401580527' : '401811939';

  try {
    const { status, body } = await fetchURL(
      `https://www.espn.com/golf/leaderboard/_/tournamentId/${TOURNAMENT_ID}`
    );
    debug.push(`HTTP ${status}, len=${body.length}`);

    // Find the competitors array in the HTML
    const compMatch = body.match(/"competitors":(\[[\s\S]*?\])\s*[,}]/);
    if (!compMatch) {
      debug.push('No competitors array found');
      // Log a snippet around where competitors might be
      const idx = body.indexOf('"competitors"');
      if (idx > -1) debug.push(`competitors context: ${body.slice(idx, idx+200)}`);
    } else {
      const competitors = tryJSON(compMatch[1]);
      debug.push(`competitors parsed: ${!!competitors}, type: ${typeof competitors}, isArray: ${Array.isArray(competitors)}`);
      
      if (Array.isArray(competitors) && competitors.length > 0) {
        debug.push(`First competitor keys: ${Object.keys(competitors[0]).join(',')}`);
        debug.push(`First competitor sample: ${JSON.stringify(competitors[0]).slice(0,300)}`);
        
        // Try to extract player data
        players = competitors.map(c => {
          // Try various possible field names
          const name = c.athlete?.displayName || c.displayName || c.name || c.fullName || '';
          const pos = c.status?.position?.displayValue || c.position?.displayValue || c.positionDisplayValue || c.pos || '';
          const score = c.score?.displayValue || c.scoreToParDisplay || c.totalScore || c.score || 'E';
          const thru = c.status?.thru != null ? String(c.status.thru) : (c.thru != null ? String(c.thru) : '');
          const st = (c.status?.type?.name || c.statusType || '').toLowerCase();
          const isMC = ['cut','wd','dq'].includes(st) || ['CUT','WD','DQ','MC'].includes(String(pos).toUpperCase());
          const posNum = isMC ? 9999 : (parseInt(String(pos).replace(/[^0-9]/g,'')) || 999);
          return { name, pos: posNum, posDisplay: String(pos), score: String(score), thru, isMC };
        }).filter(p => p.name);
        
        debug.push(`Extracted ${players.length} players`);
        if (players.length > 0) debug.push(`Sample: ${JSON.stringify(players[0])}`);
      }
    }
  } catch(e) {
    debug.push(`ERROR: ${e.message}`);
  }

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
    body: JSON.stringify({ players, count: players.length, updated: new Date().toISOString(), debug })
  };
};
