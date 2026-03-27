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

    // Find competitors array
    const compMatch = body.match(/"competitors":(\[[\s\S]*?\])\s*[,}]/);
    if (!compMatch) {
      return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ players: [], error: 'no competitors', updated: new Date().toISOString() }) };
    }

    const competitors = tryJSON(compMatch[1]);
    if (!competitors || !competitors.length) {
      return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ players: [], error: 'parse failed', updated: new Date().toISOString() }) };
    }

    // Log first competitor to see full structure
    const sample = JSON.stringify(competitors[0]);

    const players = competitors.map(c => {
      const name = c.athlete?.displayName || c.displayName || c.name || '';
      const pos = c.status?.position?.displayValue || c.position?.displayValue || c.positionDisplayValue || '';
      const isMC = ['cut','wd','dq'].includes((c.status?.type?.name||'').toLowerCase()) || ['CUT','WD','DQ'].includes(pos);
      const posNum = isMC ? 9999 : (parseInt(String(pos).replace(/[^0-9]/g,'')) || 999);

      // Try every possible score field
      const score = c.totalToParDisplay || c.score?.displayValue || c.scoreToParDisplay || 
                    c.totalScore?.displayValue || c.linescores?.[0]?.displayValue ||
                    c.statistics?.[0]?.displayValue || c.scoreDisplay || 'E';

      // Try every possible thru field  
      const thru = c.status?.thru != null ? String(c.status.thru) :
                   c.thru != null ? String(c.thru) :
                   c.status?.period != null ? String(c.status.period) :
                   c.holesPlayed != null ? String(c.holesPlayed) : '0';

      return { name, pos: posNum, posDisplay: pos, score: String(score), thru, isMC };
    }).filter(p => p.name);

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
      body: JSON.stringify({ players, count: players.length, updated: new Date().toISOString(), sample: sample.slice(0, 500) })
    };

  } catch(e) {
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ players: [], error: e.message, updated: new Date().toISOString() })
    };
  }
};
