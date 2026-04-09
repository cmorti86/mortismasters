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
    .replace(/[ÅÄÂÀÁÃ]/g, 'A').replace(/[åäâàáã]/g, 'a')
    .replace(/[ØÖÔÒÓÕ]/g, 'O').replace(/[øöôòóõ]/g, 'o')
    .replace(/Æ/g, 'Ae').replace(/æ/g, 'ae')
    .replace(/[ÜÛÙÚ]/g, 'U').replace(/[üûùú]/g, 'u')
    .replace(/[ÉÈÊË]/g, 'E').replace(/[éèêë]/g, 'e')
    .replace(/[ÍÌÎ]/g, 'I').replace(/[íìî]/g, 'i')
    .replace(/Ñ/g, 'N').replace(/ñ/g, 'n')
    .replace(/Ç/g, 'C').replace(/ç/g, 'c');
}

function parseCompetitors(competitors) {
  return competitors.map(c => {
    const rawName = c.athlete?.displayName || c.athlete?.fullName ||
                    c.displayName || c.name || c.athlete?.shortName || '';
    const name = normalizeName(rawName);
    const pos = c.status?.position?.displayValue || c.sortOrder || c.pos || c.position || '';
    const posStr = String(pos).toUpperCase().trim();
    const statusName = (c.status?.type?.name || c.status?.type?.description || '').toUpperCase();
    const isMC = ['CUT','WD','DQ','WITHDRAWN','MDF','MC'].some(s =>
      statusName.includes(s) || posStr === s
    );
    const posNum = isMC ? 9999 : (parseInt(posStr.replace(/[^0-9]/g,'')) || 999);
    const score = c.score?.displayValue || c.status?.displayValue || 'E';
    const thru = c.status?.thru != null ? String(c.status.thru) :
                 c.thru != null ? String(c.thru) : '0';
    return { name, pos: posNum, posDisplay: String(pos), score: String(score), thru, isMC };
  }).filter(p => p.name && p.name.length > 1);
}

exports.handler = async function(event, context) {
  const TOURNAMENT_ID = '401580527'; // 2026 Masters
  const debug = [];

  // ATTEMPT 1: ESPN site API
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard?event=${TOURNAMENT_ID}`;
    debug.push('A1: ' + url);
    const { status, body } = await fetchURL(url);
    debug.push('A1 status=' + status + ' len=' + body.length);
    const data = tryJSON(body);
    if (data) {
      const competitors = (data.events?.[0]?.competitions?.[0]?.competitors) || [];
      debug.push('A1 competitors=' + competitors.length);
      if (competitors.length > 0) {
        const players = parseCompetitors(competitors);
        return {
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
          body: JSON.stringify({ players, count: players.length, updated: new Date().toISOString(), source: 'espn-api', debug })
        };
      }
    }
  } catch(e) { debug.push('A1 err: ' + e.message); }

  // ATTEMPT 2: ESPN web API (different subdomain)
  try {
    const url = `https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=20260409&tournamentId=${TOURNAMENT_ID}`;
    debug.push('A2: ' + url);
    const { status, body } = await fetchURL(url);
    debug.push('A2 status=' + status + ' len=' + body.length);
    const data = tryJSON(body);
    if (data) {
      const competitors = (data.events?.[0]?.competitions?.[0]?.competitors) || [];
      debug.push('A2 competitors=' + competitors.length);
      if (competitors.length > 0) {
        const players = parseCompetitors(competitors);
        return {
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
          body: JSON.stringify({ players, count: players.length, updated: new Date().toISOString(), source: 'espn-web-api', debug })
        };
      }
    }
  } catch(e) { debug.push('A2 err: ' + e.message); }

  // ATTEMPT 3: Scrape leaderboard page
  try {
    const url = `https://www.espn.com/golf/leaderboard/_/tournamentId/${TOURNAMENT_ID}`;
    debug.push('A3 scrape: ' + url);
    const { status, body } = await fetchURL(url);
    debug.push('A3 status=' + status + ' len=' + body.length);

    const re = /"competitors":(\[[\s\S]{20,8000}?\])(?:\s*,|\s*\})/;
    const match = body.match(re);
    if (match) {
      const parsed = tryJSON(match[1]);
      if (Array.isArray(parsed) && parsed.length) {
        debug.push('A3 scraped competitors=' + parsed.length);
        const players = parsed.map(c => {
          const rawName = c.name || c.displayName || c.athlete?.displayName || '';
          const name = normalizeName(rawName);
          const pos = c.pos || c.position || c.status?.position?.displayValue || '';
          const posStr = String(pos).toUpperCase();
          const statusStr = String(c.status || '').toUpperCase();
          const isMC = ['CUT','WD','DQ','MC'].some(s => posStr === s || statusStr.includes(s));
          const posNum = isMC ? 9999 : (parseInt(posStr.replace(/[^0-9]/g,'')) || 999);
          return {
            name, pos: posNum, posDisplay: String(pos),
            score: String(c.toPar || c.score?.displayValue || 'E'),
            thru: String(c.thru != null ? c.thru : '0'), isMC
          };
        }).filter(p => p.name && p.name.length > 1);

        if (players.length) {
          return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
            body: JSON.stringify({ players, count: players.length, updated: new Date().toISOString(), source: 'scrape', debug })
          };
        }
      }
    }
    debug.push('A3 no competitors match. Body snippet: ' + body.slice(0, 300));
  } catch(e) { debug.push('A3 err: ' + e.message); }

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    body: JSON.stringify({ players: [], error: 'all_failed', debug, updated: new Date().toISOString() })
  };
};
