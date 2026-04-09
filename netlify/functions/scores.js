const https = require('https');

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.espn.com/golf/leaderboard'
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
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('timeout')); });
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

function extractPlayers(competitors) {
  return competitors.map(c => {
    const rawName = c.athlete?.displayName || c.athlete?.fullName || c.displayName || c.name || '';
    const name = normalizeName(rawName);
    if (!name) return null;

    const posDisplay = c.status?.position?.displayValue || c.position?.displayValue || c.pos || '';
    const posStr = String(posDisplay).toUpperCase().trim();
    const statusType = (c.status?.type?.name || c.status?.type?.description || '').toUpperCase();
    const isMC = ['CUT','WD','DQ','WITHDRAWN','MDF','MC'].some(s => statusType.includes(s) || posStr === s);

    // sortOrder is the real ranking — ESPN always populates this
    const sortOrder = parseInt(c.sortOrder) || 999;
    const posFromDisplay = parseInt(posStr.replace(/[^0-9]/g, '')) || 0;
    const posNum = isMC ? 9999 : (posFromDisplay > 0 ? posFromDisplay : sortOrder);

    const score = c.status?.displayValue || c.score?.displayValue || 'E';
    const thru = c.status?.thru != null ? String(c.status.thru) : c.thru != null ? String(c.thru) : '0';
    const posDisplayFinal = posFromDisplay > 0 ? String(posDisplay) : (sortOrder < 999 ? String(sortOrder) : '');

    return { name, pos: posNum, posDisplay: posDisplayFinal, score: String(score), thru, isMC };
  }).filter(Boolean);
}

exports.handler = async function(event, context) {
  const TOURNAMENT_ID = '401580527';
  const errors = [];

  // Try 1: ESPN leaderboard API (best source for live Masters data)
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard?event=${TOURNAMENT_ID}`;
    const { status, body } = await fetchURL(url);
    const data = tryJSON(body);
    const competitors = data?.events?.[0]?.competitions?.[0]?.competitors || [];
    if (competitors.length > 0) {
      const players = extractPlayers(competitors);
      if (players.length > 0 && players.some(p => p.pos < 500)) {
        return {
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
          body: JSON.stringify({ players, count: players.length, updated: new Date().toISOString(), source: 'espn-leaderboard-api' })
        };
      }
      errors.push('leaderboard-api: ' + players.length + ' players but all pos>=500');
    } else {
      errors.push('leaderboard-api: 0 competitors, body len=' + body.length);
    }
  } catch(e) { errors.push('leaderboard-api error: ' + e.message); }

  // Try 2: ESPN scoreboard API
  try {
    const url = `https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=20260409&tournamentId=${TOURNAMENT_ID}`;
    const { status, body } = await fetchURL(url);
    const data = tryJSON(body);
    const competitors = data?.events?.[0]?.competitions?.[0]?.competitors || [];
    if (competitors.length > 0) {
      const players = extractPlayers(competitors);
      if (players.length > 0 && players.some(p => p.pos < 500)) {
        return {
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
          body: JSON.stringify({ players, count: players.length, updated: new Date().toISOString(), source: 'espn-scoreboard-api' })
        };
      }
      errors.push('scoreboard-api: ' + players.length + ' players but all pos>=500, sortOrders: ' + competitors.slice(0,3).map(c=>c.sortOrder).join(','));
    } else {
      errors.push('scoreboard-api: 0 competitors');
    }
  } catch(e) { errors.push('scoreboard-api error: ' + e.message); }

  // Try 3: ESPN v3 leaderboard
  try {
    const url = `https://api.espn.com/v1/sports/golf/leaderboards?event=${TOURNAMENT_ID}&apikey=4UsTp3K3Kac4GmNB`;
    const { status, body } = await fetchURL(url);
    const data = tryJSON(body);
    const competitions = data?.sports?.[0]?.leagues?.[0]?.events?.[0]?.competitions || [];
    const competitors = competitions?.[0]?.competitors || [];
    if (competitors.length > 0) {
      const players = extractPlayers(competitors);
      if (players.length > 0) {
        return {
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
          body: JSON.stringify({ players, count: players.length, updated: new Date().toISOString(), source: 'espn-v1-api' })
        };
      }
    }
    errors.push('v1-api: 0 usable players');
  } catch(e) { errors.push('v1-api error: ' + e.message); }

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    body: JSON.stringify({ players: [], error: 'all_failed', errors, updated: new Date().toISOString() })
  };
};
