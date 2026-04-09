const https = require('https');

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.espn.com/'
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

function normalizeName(raw) {
  return (raw || '')
    .replace(/\u00c5/g,'A').replace(/\u00e5/g,'a')
    .replace(/\u00d8/g,'O').replace(/\u00f8/g,'o')
    .replace(/\u00c6/g,'Ae').replace(/\u00e6/g,'ae')
    .replace(/\u00d6/g,'O').replace(/\u00f6/g,'o')
    .replace(/\u00dc/g,'U').replace(/\u00fc/g,'u')
    .replace(/\u00c4/g,'A').replace(/\u00e4/g,'a')
    .replace(/\u00c9/g,'E').replace(/\u00e9/g,'e')
    .replace(/\u00ed/g,'i').replace(/\u00f3/g,'o')
    .replace(/\u00fa/g,'u').replace(/\u00e1/g,'a')
    .replace(/\u00f1/g,'n');
}

exports.handler = async function(event, context) {
  const TOURNAMENT_ID = '401580527'; // 2026 Masters

  // ESPN's summary API — returns JSON directly, no scraping needed
  const API_URL = `https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard?event=${TOURNAMENT_ID}`;

  try {
    const { status, body } = await fetchURL(API_URL);
    const data = tryJSON(body);

    if (!data) throw new Error('API returned non-JSON');

    // Navigate ESPN API structure
    const events = data.events || [];
    const evt = events[0];
    if (!evt) throw new Error('no event in response');

    const competitions = evt.competitions || [];
    const comp = competitions[0];
    if (!comp) throw new Error('no competition');

    const competitors = comp.competitors || [];
    if (!competitors.length) throw new Error('no competitors');

    const players = competitors.map(c => {
      const athlete = c.athlete || {};
      const rawName = athlete.displayName || athlete.fullName || c.displayName || '';
      const name = normalizeName(rawName);

      const status = c.status || {};
      const statusType = (status.type?.name || '').toUpperCase();
      const position = c.status?.position?.displayValue || c.sortOrder || '';
      const posStr = String(position).toUpperCase();

      const isMC = ['CUT','WD','DQ','WITHDRAWN','MDF'].includes(statusType) ||
                   ['CUT','WD','DQ','MC'].includes(posStr) ||
                   statusType.includes('WD') || statusType.includes('CUT');

      const posNum = isMC ? 9999 : (parseInt(String(position).replace(/[^0-9]/g,'')) || 999);

      const score = c.score?.displayValue || status.displayValue || 'E';
      const thru = c.thru != null ? String(c.thru) : (status.thru != null ? String(status.thru) : '0');

      return { name, pos: posNum, posDisplay: String(position), score: String(score), thru, isMC };
    }).filter(p => p.name);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60'
      },
      body: JSON.stringify({
        players,
        count: players.length,
        updated: new Date().toISOString(),
        source: 'espn-api'
      })
    };

  } catch(e) {
    // Fallback: try scraping the leaderboard page for embedded JSON
    try {
      const { body } = await fetchURL(
        `https://www.espn.com/golf/leaderboard/_/tournamentId/${TOURNAMENT_ID}`
      );

      // ESPN embeds window['__espnfitt__'] or similar — try multiple patterns
      const patterns = [
        /"competitors":(\[[\s\S]{10,5000}?\])\s*[,}]/,
        /window\['__espnfitt__'\]=({[\s\S]+?});<\/script>/,
        /"leaderboard":([\s\S]{10,10000}?)"scoringSystem"/
      ];

      for (const pattern of patterns) {
        const match = body.match(pattern);
        if (match) {
          const parsed = tryJSON(match[1]);
          if (parsed && Array.isArray(parsed) && parsed.length) {
            const players = parsed.map(c => {
              const rawName = c.name || c.displayName || c.athlete?.displayName || '';
              const name = normalizeName(rawName);
              const pos = c.pos || c.position || '';
              const posStr = String(pos).toUpperCase();
              const statusStr = String(c.status || '').toUpperCase();
              const isMC = ['CUT','WD','DQ','MC'].includes(posStr) || ['CUT','WD','DQ'].includes(statusStr);
              const posNum = isMC ? 9999 : (parseInt(String(pos).replace(/[^0-9]/g,'')) || 999);
              return {
                name,
                pos: posNum,
                posDisplay: String(pos),
                score: String(c.toPar || c.score?.displayValue || 'E'),
                thru: String(c.thru != null ? c.thru : '0'),
                isMC
              };
            }).filter(p => p.name);

            if (players.length) {
              return {
                statusCode: 200,
                headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
                body: JSON.stringify({ players, count: players.length, updated: new Date().toISOString(), source: 'scrape-fallback' })
              };
            }
          }
        }
      }
    } catch(e2) {
      // both failed
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ players: [], error: e.message, updated: new Date().toISOString() })
    };
  }
};
