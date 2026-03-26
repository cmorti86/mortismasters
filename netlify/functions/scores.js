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

  // Determine which tournament we're in
  const now = new Date();
  const mastersStart = new Date('2026-04-09');
  const TOURNAMENT_ID = now >= mastersStart ? '401580527' : '401811939';
  const tournamentName = now >= mastersStart ? 'Masters 2026' : 'Houston Open 2026';

  try {
    const { status, body } = await fetchURL(
      `https://www.espn.com/golf/leaderboard/_/tournamentId/${TOURNAMENT_ID}`
    );
    debug.push(`ESPN HTML page: HTTP ${status}, len=${body.length}`);

    if (status === 200 && body.length > 1000) {
      // ESPN embeds leaderboard data in window.__espnfitt__ 
      // Try multiple patterns to find the JSON
      const patterns = [
        /window\.__espnfitt__=(\{.*?\});/s,
        /window\.__espnfitt__ =(\{.*?\});/s,
        /"competitors":(\[.*?\])/s,
      ];

      let found = false;
      for (const pattern of patterns) {
        const match = body.match(pattern);
        if (match) {
          debug.push(`Pattern matched: ${pattern.toString().slice(0, 40)}`);
          const data = tryJSON(match[1]);
          if (data) {
            debug.push(`Parsed OK, keys: ${Object.keys(data).slice(0, 8).join(',')}`);
            // Try to find competitors in the data structure
            const jsonStr = JSON.stringify(data);
            const compMatch = jsonStr.match(/"displayName":"([^"]+)".*?"position".*?"displayValue":"([^"]+)"/g);
            if (compMatch) {
              debug.push(`Found ${compMatch.length} player pattern matches`);
            }
            found = true;
            break;
          }
        }
      }

      if (!found) {
        // Log what JSON variables exist in the page
        const vars = body.match(/window\.\w+ ?=/g) || [];
        debug.push(`Window vars: ${vars.slice(0,10).join(', ')}`);
        // Log a snippet from the middle of the page where data usually is
        const midpoint = Math.floor(body.length / 2);
        debug.push(`Page midpoint snippet: ${body.slice(midpoint, midpoint + 300)}`);
      }
    }
  } catch(e) {
    debug.push(`ERROR: ${e.message}`);
  }

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    body: JSON.stringify({ players, count: players.length, tournamentId: TOURNAMENT_ID, updated: new Date().toISOString(), debug })
  };
};
