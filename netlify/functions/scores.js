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

function buildPlayers(competitors) {
  const raw = competitors.map(c => {
    const rawName = c.athlete?.displayName || c.athlete?.fullName || c.displayName || c.name || '';
    const name = normalizeName(rawName);
    if (!name) return null;

    const statusType = (c.status?.type?.name || '').toUpperCase();
    const statusState = (c.status?.type?.state || '').toLowerCase();
    const isMC = ['CUT','WD','DQ','WITHDRAWN','MDF','MC'].some(s => statusType.includes(s));

    const score = (c.score == null || c.score === '') ? 'E' : String(c.score);
    const scoreNum = scoreToNum(score);

    // Thru: check ESPN's thru field first, then linescores count
    let thruNum = null;
    if (c.status?.thru != null && c.status.thru !== 0) {
      thruNum = parseInt(c.status.thru);
    } else if (c.thru != null && c.thru !== 0) {
      thruNum = parseInt(c.thru);
    }

    const linescores = c.linescores || [];
    const holesCompleted = thruNum != null ? thruNum : linescores.length;
    const isFinished = statusState === 'post' || statusType.includes('FINISHED') || holesCompleted >= 18;

    let thru;
    if (isMC) {
      thru = 'F';
    } else if (isFinished) {
      thru = 'F';
    } else if (holesCompleted > 0) {
      thru = String(holesCompleted);
    } else {
      thru = '-';
    }

    const hasStarted = holesCompleted > 0 || isFinished;
    return { name, isMC, score, thru, scoreNum, hasStarted, holesCompleted };
  }).filter(Boolean);

  const finished = raw.filter(p => !p.isMC && p.thru === 'F');
  const inProgress = raw.filter(p => !p.isMC && p.thru !== 'F' && p.hasStarted);
  const notStarted = raw.filter(p => !p.isMC && !p.hasStarted);
  const mc = raw.filter(p => p.isMC);

  finished.sort((a, b) => a.scoreNum - b.scoreNum);
  inProgress.sort((a, b) => a.scoreNum - b.scoreNum || b.holesCompleted - a.holesCompleted);

  const ranked = [...finished, ...inProgress];
  let pos = 1;
  for (let i = 0; i < ranked.length; i++) {
    if (i > 0 && ranked[i].scoreNum === ranked[i-1].scoreNum) {
      ranked[i].posNum = ranked[i-1].posNum;
    } else {
      ranked[i].posNum = pos;
    }
    pos++;
  }
  for (let i = 0; i < ranked.length; i++) {
    const ties = ranked.filter(p => p.posNum === ranked[i].posNum).length;
    ranked[i].posDisplay = ties > 1 ? 'T' + ranked[i].posNum : String(ranked[i].posNum);
  }

  notStarted.forEach((p, i) => { p.posNum = pos + i; p.posDisplay = ''; });
  mc.forEach(p => { p.posNum = 9999; p.posDisplay = 'MC'; });

  return [...ranked, ...notStarted, ...mc].map(p => ({
    name: p.name, pos: p.posNum, posDisplay: p.posDisplay,
    score: p.score, thru: p.thru, isMC: p.isMC
  }));
}

exports.handler = async function(event, context) {
  const TOURNAMENT_ID = '401811941'; // 2026 Masters - correct ESPN ID
  const errors = [];

  const urls = [
    `https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?tournamentId=${TOURNAMENT_ID}`,
    `https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=20260409&tournamentId=${TOURNAMENT_ID}`,
    `https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard?tournamentId=${TOURNAMENT_ID}`,
  ];

  for (const url of urls) {
    try {
      const { body } = await fetchURL(url);
      const data = tryJSON(body);
      const competitors = data?.events?.[0]?.competitions?.[0]?.competitors || [];
      if (!competitors.length) { errors.push(url + ': 0 competitors'); continue; }

      const players = buildPlayers(competitors);
      if (!players.length) { errors.push(url + ': 0 players'); continue; }

      const hasData = players.some(p => p.score !== 'E' && p.pos < 500) ||
                      players.some(p => p.thru !== '-' && p.thru !== 'F' && p.pos < 999);

      if (hasData) {
        return {
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
          body: JSON.stringify({ players, count: players.length, updated: new Date().toISOString(), source: url })
        };
      }
      errors.push(url + ': no useful data');
    } catch(e) { errors.push(url + ': ' + e.message); }
  }

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    body: JSON.stringify({ players: [], error: 'all_failed', errors, updated: new Date().toISOString() })
  };
};
