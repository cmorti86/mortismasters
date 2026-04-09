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

    const posDisplay = c.status?.position?.displayValue ||
                       c.status?.position?.id ||
                       c.position?.displayValue ||
                       c.pos || '';
    const posStr = String(posDisplay).toUpperCase().trim();

    const statusType = (c.status?.type?.name || c.status?.type?.description || '').toUpperCase();
    const isMC = ['CUT','WD','DQ','WITHDRAWN','MDF','MC'].some(s =>
      statusType.includes(s) || posStr === s
    );

    // Use sortOrder as fallback rank when posDisplay is empty (players not yet on course)
    const sortOrder = parseInt(c.sortOrder) || 999;
    const posNum = isMC ? 9999 : (parseInt(posStr.replace(/[^0-9]/g,'')) || sortOrder);

    const score = c.status?.displayValue ||
                  c.score?.displayValue ||
                  c.linescores?.[0]?.displayValue ||
                  'E';

    const thru = c.status?.thru != null ? String(c.status.thru) :
                 c.thru != null ? String(c.thru) : '0';

    return { name, pos: posNum, posDisplay: String(posDisplay), score: String(score), thru, isMC };
  }).filter(p => p.name && p.name.length > 1);
}

exports.handler = async function(event, context) {
  const TOURNAMENT_ID = '401580527'; // 2026 Masters

  try {
    const url = `https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=20260409&tournamentId=${TOURNAMENT_ID}`;
    const { status, body } = await fetchURL(url);
    const data = tryJSON(body);
    if (!data) throw new Error('non-JSON response, status=' + status);

    const competitors = data.events?.[0]?.competitions?.[0]?.competitors || [];
    if (!competitors.length) throw new Error('no competitors');

    const players = parseCompetitors(competitors);

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
        source: 'espn-web-api'
      })
    };

  } catch(e) {
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ players: [], error: e.message, updated: new Date().toISOString() })
    };
  }
};
