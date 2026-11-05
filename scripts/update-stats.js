const fs = require('fs');
const https = require('https');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download ${url}: status code ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // Basic check that it's SVG
        if (data.includes('<svg')) {
          fs.writeFileSync(dest, data, 'utf8');
          console.log(`Updated ${dest} (${data.length} bytes)`);
          resolve(data);
        } else {
          reject(new Error(`Response for ${url} was not SVG`));
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  const username = process.env.GH_USERNAME || 'B00MMMM';
  console.log(`Updating stats for ${username}...`);

  // 1. GitHub Stats
  try {
    const statsUrl = `https://github-readme-stats.vercel.app/api?username=${username}&show_icons=true&theme=dark&hide_border=false&bg_color=050505&border_color=222226&title_color=39d353&icon_color=39d353&text_color=a1a1aa`;
    await download(statsUrl, 'github-stats.svg');
  } catch (err) {
    console.warn('Could not update github-stats.svg:', err.message);
  }

  // 2. Top Languages
  try {
    const langsUrl = `https://github-readme-stats.vercel.app/api/top-langs/?username=${username}&layout=compact&theme=dark&hide_border=false&bg_color=050505&border_color=222226&title_color=39d353&text_color=a1a1aa`;
    await download(langsUrl, 'top-langs.svg');
  } catch (err) {
    console.warn('Could not update top-langs.svg:', err.message);
  }

  // 3. Streak Stats
  try {
    const streakUrl = `https://streak-stats.demolab.com/?user=${username}&theme=dark&background=050505&border=222226&stroke=222226&ring=39d353&fire=39d353&currStreakNum=39d353&sideNums=f4f4f5&sideLabels=71717a&currStreakLabel=39d353&dates=71717a`;
    await download(streakUrl, 'streak-stats.svg');
  } catch (err) {
    console.warn('Could not update streak-stats.svg:', err.message);
  }

  // 4. Activity Graph
  try {
    const activityUrl = `https://github-readme-activity-graph.vercel.app/graph?username=${username}&theme=github-dark&bg_color=050505&color=39d353&line=39d353&point=f4f4f5&area=true&hide_border=false`;
    await download(activityUrl, 'activity-graph.svg');
  } catch (err) {
    console.warn('Could not update activity-graph.svg:', err.message);
  }

  // 5. Update space-shooter heatmap if GITHUB_TOKEN is available
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    try {
      await updateHeatmap(username, token);
    } catch (err) {
      console.warn('Could not update contrib-heatmap.svg:', err.message);
    }
  } else {
    console.log('No GITHUB_TOKEN provided; keeping existing contrib-heatmap.svg');
  }
}

async function updateHeatmap(username, token) {
  // Query GitHub GraphQL API for the contribution calendar
  const query = JSON.stringify({
    query: `query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                contributionCount
                date
                color
              }
            }
          }
        }
      }
    }`,
    variables: { login: username }
  });

  const res = await new Promise((resolve, reject) => {
    const req = https.request('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        'User-Agent': 'NodeJS',
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(query)
      }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(query);
    req.end();
  });

  const cal = res?.data?.user?.contributionsCollection?.contributionCalendar;
  if (!cal || !cal.weeks) {
    console.log('No calendar returned from GraphQL');
    return;
  }

  if (!fs.existsSync('contrib-heatmap.svg')) return;
  let svg = fs.readFileSync('contrib-heatmap.svg', 'utf8');

  // Update total count
  svg = svg.replace(/<tspan font-weight="700">\d+<\/tspan><tspan fill="#71717a"> contributions in the last year<\/tspan>/,
    `<tspan font-weight="700">${cal.totalContributions}</tspan><tspan fill="#71717a"> contributions in the last year</tspan>`);

  // Flatten days
  const allDays = [];
  cal.weeks.forEach(w => w.contributionDays.forEach(d => allDays.push(d)));

  if (allDays.length > 0) {
    const start = allDays[0].date;
    const end = allDays[allDays.length - 1].date;
    svg = svg.replace(/\d{4}-\d{2}-\d{2} &#8594; \d{4}-\d{2}-\d{2}/, `${start} &#8594; ${end}`);
  }

  // Calculate active days & longest streak
  let activeDays = 0;
  let currentStreak = 0;
  let maxStreak = 0;
  let bestDayCount = 0;
  let bestDayDate = '';

  allDays.forEach(d => {
    if (d.contributionCount > 0) {
      activeDays++;
      currentStreak++;
      if (currentStreak > maxStreak) maxStreak = currentStreak;
      if (d.contributionCount > bestDayCount) {
        bestDayCount = d.contributionCount;
        bestDayDate = d.date;
      }
    } else {
      currentStreak = 0;
    }
  });

  svg = svg.replace(/active days <tspan fill="#e4e4e7" font-weight="700">\d+ days<\/tspan>/,
    `active days <tspan fill="#e4e4e7" font-weight="700">${activeDays} days</tspan>`);
  svg = svg.replace(/longest streak <\/tspan><tspan fill="#e4e4e7" font-weight="700">\d+ days<\/tspan>/,
    `longest streak </tspan><tspan fill="#e4e4e7" font-weight="700">${maxStreak} days</tspan>`);
  if (bestDayDate) {
    svg = svg.replace(/best day <tspan fill="#39d353" font-weight="700">\d+<\/tspan> on \d{4}-\d{2}-\d{2}/,
      `best day <tspan fill="#39d353" font-weight="700">${bestDayCount}</tspan> on ${bestDayDate}`);
  }

  fs.writeFileSync('contrib-heatmap.svg', svg, 'utf8');
  console.log('Successfully refreshed contrib-heatmap.svg metrics!');
}

main();

