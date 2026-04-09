const https = require('https');

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.masters.com/en_US/scores/index.html',
        'Origin': 'https://www.masters.com'
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
  // Masters.com wraps JSON in a callback sometimes
  const clean = str.replace(/^[^{[]*([\[{])/, '$1').replace(/[}\]]\s*[^}\]]*$/, m => m[0]);
  try { return JSON.parse(str); } catch(e) {}
  try { return JSON.parse(clean); } catch(e) {}
  return null;
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
  if (!s || s === 'E' || s === 'Even' || s === '-' || s === '--') return 0;
  const n = parseInt(String(s).replace(/[^0-9\-\+]/g, ''));
  return isNaN(n) ? 0 : n;
}

function buildPlayersFromMasters(data) {
  // Masters.com JSON structure: data.data.player array
  const players_raw = data?.data?.player || data?.player || data?.players || [];
  if (!players_raw.length) return null;

  const results = players_raw.map(p => {
    const firstName = p.first_name || p.firstName || '';
    const lastName = p.last_name || p.lastName || '';
    const rawName = p.display_name || p.displayName || p.name || `${firstName} ${lastName}`.trim();
    const name = normalizeName(rawName);
    if (!name) return null;

    const status = (p.status || p.player_status || '').toUpperCase();
    const isMC = ['CUT','WD','DQ','MDF','MC','WITHDRAWN'].some(s => status.includes(s));

    // Score to par
    const scoreRaw = p.topar || p.to_par || p.toPar || p.today || p.score || '';
    let score = String(scoreRaw).trim();
    if (score === '0' || score === '') score = 'E';
    else if (!score.startsWith('-') && !score.startsWith('+') && score !== 'E') {
      const n = parseInt(score);
      if (!isNaN(n)) score = n > 0 ? `+${n}` : n === 0 ? 'E' : String(n);
    }

    // Position
    const posRaw = p.pos || p.position || p.current_position || '';
    const posStr = String(posRaw).toUpperCase().trim();
    const posNum = isMC ? 9999 : (parseInt(posStr.replace(/[^0-9]/g, '')) || 999);
    const tiedFlag = p.tied === 'true' || p.tied === true || posStr.startsWith('T');
    const posDisplay = isMC ? 'MC' : posStr || '';

    // Thru
    const thruRaw = p.thru || p.holes_played || p.holesPlayed || '';
    let thru = String(thruRaw).trim();
    if (thru === '18' || status.includes('FINISH') || p.round_complete === 'true') thru = 'F';
    else if (!thru || thru === '0') thru = '-';

    const scoreNum = scoreToNum(score);
    const hasStarted = thru !== '-';

    return { name, isMC, score, thru, scoreNum, posNum, posDisplay, hasStarted };
  }).filter(Boolean);

  return results.map(p => ({
    name: p.name, pos: p.posNum, posDisplay: p.posDisplay,
    score: p.score, thru: p.thru, isMC: p.isMC
  }));
}

function buildPlayersFromESPN(competitors) {
  const raw = competitors.map(c => {
    const rawName = c.athlete?.displayName || c.athlete?.fullName || c.displayName || c.name || '';
    const name = normalizeName(rawName);
    if (!name) return null;

    const statusType = (c.status?.type?.name || '').toUpperCase();
    const statusState = (c.status?.type?.state || '').toLowerCase();
    const isMC = ['CUT','WD','DQ','WITHDRAWN','MDF','MC'].some(s => statusType.includes(s));
    const score = (c.score == null || c.score === '') ? 'E' : String(c.score);
    const scoreNum = scoreToNum(score);

    let thruNum = null;
    if (c.status?.thru != null) thruNum = parseInt(c.status.thru);
    else if (c.thru != null) thruNum = parseInt(c.thru);

    const linescores = c.linescores || [];
    const holesCompleted = (thruNum != null && !isNaN(thruNum)) ? thruNum : linescores.length;
    const isFinished = statusState === 'post' || statusType.includes('FINISHED') || holesCompleted >= 18;

    let thru = isMC ? 'F' : isFinished ? 'F' : holesCompleted > 0 ? String(holesCompleted) : '-';
    const hasStarted = holesCompleted > 0 || isFinished;
    return { name, isMC, score, thru, scoreNum, hasStarted, holesCompleted };
  }).filter(Boolean);

  const finished = raw.filter(p => !p.isMC && p.thru === 'F');
  const inProgress = raw.filter(p => !p.iMC && p.thru !== 'F' && p.hasStarted);
  const notStarted = raw.filter(p => !p.isMC && !p.hasStarted);
  const mc = raw.filter(p => p.isMC);

  finished.sort((a, b) => a.scoreNum - b.scoreNum);
  inProgress.sort((a, b) => a.scoreNum - b.scoreNum || b.holesCompleted - a.holesCompleted);

  const ranked = [...finished, ...inProgress];
  let pos = 1;
  for (let i = 0; i < ranked.length; i++) {
    ranked[i].posNum = (i > 0 && ranked[i].scoreNum === ranked[i-1].scoreNum) ? ranked[i-1].posNum : pos;
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
  const errors = [];

  // ATTEMPT 1: Masters.com official feed
  const mastersFeedUrls = [
    'https://www.masters.com/en_US/scores/feeds/2026/scores.json',
    'https://www.masters.com/en_US/scores/feeds/2026/scores_round1.json',
    'https://www.masters.com/en_US/scores/feeds/2026/player_scores.json',
  ];

  for (const url of mastersFeedUrls) {
    try {
      const { status, body } = await fetchURL(url);
      if (status === 200 && body.length > 100) {
        const data = tryJSON(body);
        if (data) {
          const players = buildPlayersFromMasters(data);
          if (players && players.length > 0) {
            return {
              statusCode: 200,
              headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
              body: JSON.stringify({ players, count: players.length, updated: new Date().toISOString(), source: 'masters.com' })
            };
          }
        }
        errors.push(url + ': parsed but no players. body: ' + body.slice(0, 200));
      } else {
        errors.push(url + ': status=' + status + ' len=' + body.length);
      }
    } catch(e) { errors.push(url + ': ' + e.message); }
  }

  // ATTEMPT 2: ESPN with correct tournament ID
  const espnUrls = [
    'https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?tournamentId=401811941',
    'https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=20260409&tournamentId=401811941',
  ];

  for (const url of espnUrls) {
    try {
      const { body } = await fetchURL(url);
      const data = tryJSON(body);
      const competitors = data?.events?.[0]?.competitions?.[0]?.competitors || [];
      if (competitors.length > 0) {
        const players = buildPlayersFromESPN(competitors);
        if (players.length > 0) {
          return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
            body: JSON.stringify({ players, count: players.length, updated: new Date().toISOString(), source: 'espn: ' + url })
          };
        }
      }
      errors.push(url + ': 0 players');
    } catch(e) { errors.push(url + ': ' + e.message); }
  }

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    body: JSON.stringify({ players: [], error: 'all_failed', errors, updated: new Date().toISOString() })
  };
};
