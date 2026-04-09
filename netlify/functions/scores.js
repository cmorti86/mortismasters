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

function scoreToNum(s) {
  if (!s || s === 'E' || s === '-' || s === '--') return 0;
  const n = parseInt(String(s));
  return isNaN(n) ? 0 : n;
}

exports.handler = async function(event, context) {
  const TOURNAMENT_ID = '401580527';

  try {
    const url = `https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=20260409&tournamentId=${TOURNAMENT_ID}`;
    const { body } = await fetchURL(url);
    const data = tryJSON(body);
    const competitors = data?.events?.[0]?.competitions?.[0]?.competitors || [];
    if (!competitors.length) throw new Error('no competitors');

    const raw = competitors.map(c => {
      const rawName = c.athlete?.displayName || c.athlete?.fullName || c.displayName || c.name || '';
      const name = normalizeName(rawName);
      if (!name) return null;

      // STATUS
      const statusType = (c.status?.type?.name || '').toUpperCase();
      const isMC = ['CUT','WD','DQ','WITHDRAWN','MDF','MC'].some(s => statusType.includes(s));

      // SCORE TO PAR — c.score is the direct field per ESPN sample data
      const scoreToPar = c.score; // e.g. "-3", "E", "+2"
      const score = (scoreToPar == null || scoreToPar === '') ? 'E' : String(scoreToPar);

      // THRU — from statistics
      const thruStat = c.statistics?.categories?.[0]?.stats?.find(s => s.displayValue && s.displayValue !== '0');
      const thru = c.status?.thru != null ? String(c.status.thru) :
                   c.thru != null ? String(c.thru) : '0';

      const scoreNum = scoreToNum(score);
      const hasStarted = score !== 'E' || thru !== '0';

      return { name, isMC, score, thru, scoreNum, hasStarted };
    }).filter(Boolean);

    // Separate players
    const started = raw.filter(p => !p.isMC && p.hasStarted);
    const notStarted = raw.filter(p => !p.isMC && !p.hasStarted);
    const mc = raw.filter(p => p.isMC);

    // Sort started players by score to par (best first)
    started.sort((a, b) => a.scoreNum - b.scoreNum);

    // Assign positions with ties
    let pos = 1;
    for (let i = 0; i < started.length; i++) {
      if (i > 0 && started[i].scoreNum === started[i-1].scoreNum) {
        started[i].posNum = started[i-1].posNum;
        started[i].posDisplay = started.filter(p => p.posNum === started[i-1].posNum).length > 1
          ? 'T' + started[i-1].posNum : String(started[i-1].posNum);
        // Fix previous if now tied
        started[i-1].posDisplay = 'T' + started[i-1].posNum;
      } else {
        started[i].posNum = pos;
        started[i].posDisplay = String(pos);
      }
      pos++;
    }

    // Not started players go after
    notStarted.forEach((p, i) => {
      p.posNum = pos + i;
      p.posDisplay = '';
    });

    mc.forEach(p => { p.posNum = 9999; p.posDisplay = 'MC'; });

    const players = [...started, ...notStarted, ...mc].map(p => ({
      name: p.name,
      pos: p.posNum,
      posDisplay: p.posDisplay,
      score: p.score,
      thru: p.thru,
      isMC: p.isMC
    }));

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
      body: JSON.stringify({ players, count: players.length, updated: new Date().toISOString(), source: 'espn-scoreboard-fixed' })
    };

  } catch(e) {
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ players: [], error: e.message, updated: new Date().toISOString() })
    };
  }
};
