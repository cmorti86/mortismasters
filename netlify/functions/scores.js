const https = require('https');

exports.handler = async function(event, context) {
  const ESPN_URL = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard';
  
  try {
    const data = await new Promise((resolve, reject) => {
      https.get(ESPN_URL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch(e) { reject(new Error('JSON parse failed')); }
        });
      }).on('error', reject);
    });

    const competitors = data?.events?.[0]?.competitions?.[0]?.competitors || [];
    
    const players = competitors.map(c => {
      const name = c.athlete?.displayName || '';
      const statusName = (c.status?.type?.name || '').toLowerCase();
      const pos = c.status?.position?.displayValue || '';
      const isMC = statusName === 'cut' || statusName === 'wd' || statusName === 'dq' || ['CUT','WD','DQ'].includes(pos);
      const posNum = isMC ? 9999 : (parseInt(pos.replace(/[^0-9]/g, '')) || 999);
      return {
        name,
        pos: posNum,
        posDisplay: pos,
        score: c.score?.displayValue || 'E',
        thru: c.status?.thru != null ? String(c.status.thru) : '',
        isMC
      };
    }).filter(p => p.name);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60'
      },
      body: JSON.stringify({ players, updated: new Date().toISOString() })
    };

  } catch(e) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message })
    };
  }
};
