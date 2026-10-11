const $ = (selector) => document.querySelector(selector);
const token = $('#token'); const notice = $('#notice'); const lobbies = $('#lobbies');
const lobbiesPerPage = 8; let lobbyPage = 0; let leaderboardPage = 1;
token.value = localStorage.getItem('party-dashboard-token') || localStorage.getItem('ahr-dashboard-token') || '';
const headers = () => ({ Authorization: `Bearer ${token.value}`, 'Content-Type': 'application/json' });
function message(text, error = false) { notice.textContent = text; notice.className = error ? 'error' : 'success'; }
function number(value) { return value === '' ? undefined : Number(value); }
function regulationsPayload(form) {
  const data = new FormData(form); const statuses = data.get('statuses').trim();
  const regulations = { enabled: data.has('regulationsEnabled'), freeMod: data.has('freeMod'), allowConvert: data.has('allowConvert') };
  for (const [formName, key] of [['minStar', 'minStar'], ['maxStar', 'maxStar'], ['minLength', 'minLength'], ['maxLength', 'maxLength'], ['minBpm', 'minBpm'], ['maxBpm', 'maxBpm'], ['minAr', 'minAr'], ['maxAr', 'maxAr']]) { const value = number(data.get(formName)); if (value !== undefined) regulations[key] = value; }
  if (data.get('gameMode')) regulations.gameMode = data.get('gameMode');
  regulations.allowedStatuses = statuses ? statuses.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
  return regulations;
}
function payload(form) {
  const data = new FormData(form); const result = { title: data.get('title').trim(), config: { regulations: regulationsPayload(form), ranked: data.has('ranked'), autoRecreateOnInactivity: data.has('autoRecreateOnInactivity'), teamMode: number(data.get('teamMode')), scoreMode: number(data.get('scoreMode')) } };
  if (data.get('password')) result.password = data.get('password'); return result;
}
async function request(url, options = {}) { const res = await fetch(url, { ...options, headers: headers() }); if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || `Request failed (${res.status})`); } return res.status === 204 ? undefined : res.json(); }
const rangeFields = [['minStar', 'Min stars', '0', '0.0001'], ['maxStar', 'Max stars', '0', '0.0001'], ['minLength', 'Min length (sec)', '0'], ['maxLength', 'Max length (sec)', '0'], ['minBpm', 'Min BPM', '0'], ['maxBpm', 'Max BPM', '0'], ['minAr', 'Min AR', '0', '0.1'], ['maxAr', 'Max AR', '0', '0.1']];
function standingsPanel(l) {
  const s = l.standings;
  const currentRound = s?.currentRound ?? 1;
  const totalRounds = s?.totalRounds ?? 10;
  const players = s?.players ?? [];
  let tableHtml = '';
  if (!players.length) {
    tableHtml = '<p class="muted" style="padding: 10px 12px; margin: 0;">No active players in this lobby yet.</p>';
  } else {
    const rows = players.map(p => `
      <tr>
        <td><strong>#${p.position}</strong></td>
        <td>
          <div class="player-cell">
            <img src="https://a.ppy.sh/${p.id}" class="player-avatar" onerror="this.style.display='none'">
            <a href="https://osu.ppy.sh/users/${p.id}" target="_blank" rel="noreferrer" class="player-name">${escapeHtml(p.username)}</a>
          </div>
        </td>
        <td class="points-cell">${p.sessionPoints}</td>
        <td class="points-cell">${p.allTimePoints}</td>
        <td>${p.streak}</td>
        <td><span class="status-badge ${p.status.toLowerCase()}">${p.status}</span></td>
      </tr>
    `).join('');
    tableHtml = `
      <table class="leaderboard-table standings-table">
        <thead>
          <tr>
            <th>Position</th>
            <th>Player</th>
            <th>Session PartyPoints</th>
            <th>All-Time PartyPoints</th>
            <th>Win Streak</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }
  return `
    <details class="regulations standings-panel" open>
      <summary>Standings — Round ${currentRound} / ${totalRounds}</summary>
      <div class="standings-content">${tableHtml}</div>
    </details>
  `;
}
function regulationsForm(l) { const r = l.config.regulations || {}; const value = key => r[key] ?? ''; const checked = key => r[key] ? 'checked' : ''; const fields = rangeFields.map(([key, label, min, step]) => `<label>${label}<input name="${key}" type="number" min="${min}" ${step ? `step="${step}"` : ''} value="${value(key)}" placeholder="Any"></label>`).join(''); const statuses = (r.allowedStatuses || []).join(', '); const isRanked = l.config.ranked !== false ? 'checked' : ''; const autoRecreate = l.config.autoRecreateOnInactivity ? 'checked' : ''; return `<details class="regulations"><summary>Edit lobby settings</summary><form data-regulations="${l.id}"><div class="grid"><label>Lobby name<input name="lobbyTitle" required minlength="3" maxlength="80" value="${escapeHtml(l.name)}"></label><label>New password<input name="lobbyPassword" type="password" maxlength="64" placeholder="Leave blank to keep current password"></label></div><div class="checks"><label><input name="removePassword" type="checkbox"> Remove the current password</label></div><div class="grid checks"><label><input name="ranked" type="checkbox" ${isRanked}> Ranked (PartyPoints & Stats)</label><label><input name="autoRecreateOnInactivity" type="checkbox" ${autoRecreate}> Recreate if inactive lobby closes</label><label><input name="regulationsEnabled" type="checkbox" ${checked('enabled')}> Enable checker</label><label><input name="freeMod" type="checkbox" ${checked('freeMod')}> Free Mod</label><label><input name="allowConvert" type="checkbox" ${checked('allowConvert')}> Allow conversions</label><label>Mode <select name="gameMode"><option value="">Any mode</option>${['osu', 'taiko', 'fruits', 'mania'].map(mode => `<option value="${mode}" ${r.gameMode === mode ? 'selected' : ''}>${mode === 'fruits' ? 'catch' : mode === 'osu' ? 'osu!' : mode}</option>`).join('')}</select></label></div><div class="grid four">${fields}</div><label>Allowed statuses <input name="statuses" value="${escapeHtml(statuses)}" placeholder="All statuses (or: ranked, loved, qualified)"></label><button type="submit">Save lobby settings</button></form></details>`; }
function activityConsole(l) { return `<details class="activity-console"><summary>Activity console</summary><div class="activity-toolbar"><button class="secondary" type="button" data-activity-refresh="${l.id}">Refresh console</button><span class="muted">Current bot session · latest 200 entries</span></div><pre data-activity-output="${l.id}">Open and refresh to load activity.</pre></details>`; }
function render(items) { $('#count').textContent = `${items.filter(x => x.active).length} active`; if (!items.length) { lobbies.innerHTML = '<p class="muted">No lobbies yet.</p>'; return; }
  const pageCount = Math.ceil(items.length / lobbiesPerPage); lobbyPage = Math.max(0, Math.min(lobbyPage, pageCount - 1)); const pageItems = items.slice(lobbyPage * lobbiesPerPage, (lobbyPage + 1) * lobbiesPerPage);
  lobbies.innerHTML = pageItems.map(l => `<article><div><strong>${escapeHtml(l.name)}</strong><small>mp/${l.banchoId} · ${l.active ? 'Active' : 'Historical'}</small></div><div>${l.active ? `<button class="danger" data-close="${l.id}">Close</button>` : `<button class="danger" data-delete-history="${l.id}">Delete history</button>`}<a href="https://osu.ppy.sh/mp/${l.banchoId}" target="_blank" rel="noreferrer">Open</a></div>${l.active ? `${standingsPanel(l)}${regulationsForm(l)}${activityConsole(l)}` : ''}</article>`).join('') + `<nav class="pagination" aria-label="Lobby pages"><button class="secondary" data-page="previous" ${lobbyPage === 0 ? 'disabled' : ''}>Previous</button><span>Page ${lobbyPage + 1} of ${pageCount}</span><button class="secondary" data-page="next" ${lobbyPage === pageCount - 1 ? 'disabled' : ''}>Next</button></nav>`;
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', async () => { if (!confirm('Close this lobby?')) return; try { await request(`/lobbies/${button.dataset.close}`, { method: 'DELETE' }); await load(); } catch (e) { message(e.message, true); } }));
  document.querySelectorAll('[data-delete-history]').forEach(button => button.addEventListener('click', async () => { if (!confirm('Delete this lobby history and all of its recorded match scores? Player PartyPoints and stats will not be changed.')) return; try { await request(`/lobbies/${button.dataset.deleteHistory}`, { method: 'DELETE' }); message('Lobby history deleted.'); await load(); } catch (e) { message(e.message, true); } }));
  document.querySelectorAll('[data-regulations]').forEach(form => form.addEventListener('submit', async event => { event.preventDefault(); try { const data = new FormData(form); const password = data.get('lobbyPassword').trim(); await request(`/lobbies/${form.dataset.regulations}/regulations`, { method: 'PATCH', body: JSON.stringify({ regulations: regulationsPayload(form), ranked: data.has('ranked'), autoRecreateOnInactivity: data.has('autoRecreateOnInactivity'), title: data.get('lobbyTitle').trim(), removePassword: data.has('removePassword'), ...(password ? { password } : {}) }) }); message('Lobby settings updated.'); await load(); } catch (e) { message(e.message, true); } }));
  document.querySelectorAll('[data-activity-refresh]').forEach(button => button.addEventListener('click', () => void loadActivity(button.dataset.activityRefresh)));
  document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => { lobbyPage += button.dataset.page === 'next' ? 1 : -1; render(items); }));
}
function escapeHtml(value) { const el = document.createElement('span'); el.textContent = value; return el.innerHTML; }
async function loadActivity(id) {
  const output = document.querySelector(`[data-activity-output="${id}"]`); if (!output) return;
  try {
    const { entries } = await request(`/lobbies/${id}/activity`);
    output.textContent = entries.length ? entries.map(entry => `[${new Date(entry.at).toLocaleTimeString()}] ${entry.level.toUpperCase()}  ${entry.message}`).join('\n') : 'No activity recorded yet.';
    output.closest('details').open = true;
  } catch (e) { output.textContent = `ERROR  ${e.message}`; }
}
async function load() { try { render(await request('/lobbies')); } catch (e) { message(e.message, true); } }
const modeName = mode => ({ osu: 'osu!standard', taiko: 'osu!taiko', fruits: 'osu!catch', mania: 'osu!mania' })[mode] || mode;
function renderPlayerStats(player) {
  const ranked = player.rank ? `#${player.rank} of ${player.total}` : 'Complete 3 matches to rank';
  const podiums = player.podiums || { first: 0, second: 0, third: 0 };
  $('#player-stats').className = '';
  $('#player-stats').innerHTML = `
    <div class="player-card">
      <div class="player-card-header">
        <img src="https://a.ppy.sh/${player.id}" class="player-card-avatar" onerror="this.src='/logo.png'">
        <div class="player-card-meta">
          <h3>${escapeHtml(player.username)} <small>${modeName(player.mode)} · ${ranked}</small></h3>
          <div class="player-quick-stats">
            <span><strong>${player.allTimePoints ?? player.points}</strong> Lifetime PartyPoints</span> &bull;
            <span>Current Streak: <strong>${player.streak}</strong></span> &bull;
            <span>Best Streak: <strong>${player.longestStreak}</strong></span> &bull;
            <span>Favorite: <strong>${escapeHtml(player.mostPlayedMinigame || 'None')}</strong></span>
          </div>
          <div class="podium-badges">
            <span class="podium-badge gold" title="1st Place Podiums">🥇 ${podiums.first}</span>
            <span class="podium-badge silver" title="2nd Place Podiums">🥈 ${podiums.second}</span>
            <span class="podium-badge bronze" title="3rd Place Podiums">🥉 ${podiums.third}</span>
          </div>
        </div>
      </div>
      <form id="player-stats-form" class="grid four" data-player-id="${player.id}" data-mode="${player.mode}">
        <label>All-Time PartyPoints<input name="points" type="number" min="0" step="1" value="${player.points}" required></label>
        <label>Matches<input name="matches" type="number" min="0" step="1" value="${player.matches}" required></label>
        <label>Grand Prix Wins<input name="wins" type="number" min="0" step="1" value="${player.wins}" required></label>
        <label>Current streak<input name="streak" type="number" min="0" step="1" value="${player.streak}" required></label>
        <label>Best streak<input name="longestStreak" type="number" min="0" step="1" value="${player.longestStreak}" required></label>
        <button type="submit">Save stats</button>
      </form>
    </div>
  `;
  $('#player-stats-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    try {
      await request(`/players/${form.dataset.playerId}/stats`, {
        method: 'PATCH',
        body: JSON.stringify({
          mode: form.dataset.mode,
          points: Number(data.get('points')),
          matches: Number(data.get('matches')),
          wins: Number(data.get('wins')),
          streak: Number(data.get('streak')),
          longestStreak: Number(data.get('longestStreak'))
        })
      });
      message(`${player.username}'s ${modeName(player.mode)} stats were updated.`); await loadPlayer(); await loadLeaderboard();
    } catch (e) { message(e.message, true); }
  });
}
async function loadPlayer() {
  const username = $('#player-username').value.trim(); const mode = $('#player-mode').value;
  if (!username) return;
  try { renderPlayerStats(await request(`/players?username=${encodeURIComponent(username)}&mode=${mode}`)); }
  catch (e) { $('#player-stats').className = 'error'; $('#player-stats').textContent = e.message; }
}
function renderLeaderboard(data) {
  const target = $('#leaderboard');
  if (!data.players.length) { target.className = 'muted'; target.textContent = `No players have completed 3 ${modeName(data.mode)} matches yet.`; return; }
  target.className = '';
  target.innerHTML = `
    <table class="leaderboard-table">
      <thead>
        <tr>
          <th>Rank</th>
          <th>Player</th>
          <th>All-Time PartyPoints</th>
          <th>Grand Prix Wins</th>
          <th>Current Win Streak</th>
          <th>Win Rate (%)</th>
        </tr>
      </thead>
      <tbody>
        ${data.players.map(player => `
          <tr>
            <td><strong>#${player.rank}</strong></td>
            <td>
              <div class="player-cell">
                <img src="https://a.ppy.sh/${player.id}" class="player-avatar" onerror="this.style.display='none'">
                <a href="https://osu.ppy.sh/users/${player.id}" target="_blank" rel="noreferrer" class="player-name">${escapeHtml(player.username)}</a>
              </div>
            </td>
            <td class="points-cell">${player.allTimePoints ?? player.points}</td>
            <td>${player.wins}</td>
            <td>${player.streak ?? 0}</td>
            <td>${player.winRate}%</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <nav class="pagination" aria-label="Leaderboard pages">
      <button class="secondary" data-leaderboard-page="previous" ${data.page === 1 ? 'disabled' : ''}>Previous</button>
      <span>Page ${data.page} of ${data.pageCount}</span>
      <button class="secondary" data-leaderboard-page="next" ${data.page === data.pageCount ? 'disabled' : ''}>Next</button>
    </nav>
  `;
  document.querySelectorAll('[data-leaderboard-page]').forEach(button => button.addEventListener('click', () => { leaderboardPage += button.dataset.leaderboardPage === 'next' ? 1 : -1; void loadLeaderboard(); }));
}
async function loadLeaderboard() { try { renderLeaderboard(await request(`/leaderboard?mode=${$('#leaderboard-mode').value}&page=${leaderboardPage}`)); } catch (e) { $('#leaderboard').className = 'error'; $('#leaderboard').textContent = e.message; } }
$('#save-token').addEventListener('click', () => {
  localStorage.setItem('party-dashboard-token', token.value);
  localStorage.setItem('ahr-dashboard-token', token.value);
  message('Token saved locally in this browser.');
});
$('#refresh').addEventListener('click', load);
$('#player-form').addEventListener('submit', event => { event.preventDefault(); void loadPlayer(); });
$('#refresh-player').addEventListener('click', () => void loadPlayer());
$('#create-player-form').addEventListener('submit', async event => {
  event.preventDefault(); const username = $('#create-player-username').value.trim(); const mode = $('#create-player-mode').value;
  if (!username) return;
  try {
    const player = await request('/players', { method: 'POST', body: JSON.stringify({ username, mode }) });
    $('#player-username').value = player.username; $('#player-mode').value = player.mode;
    message(`${player.username}'s ${modeName(player.mode)} entry is ready.`); await loadPlayer();
  } catch (e) { message(e.message, true); }
});
$('#load-leaderboard').addEventListener('click', loadLeaderboard);
$('#leaderboard-mode').addEventListener('change', () => { leaderboardPage = 1; void loadLeaderboard(); });
$('#create-form').addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget; try { const lobby = await request('/lobbies', { method: 'POST', body: JSON.stringify(payload(form)) }); message(`Created ${lobby.name}.`); form.reset(); await load(); } catch (e) { message(e.message, true); } });

const MINIGAMES = [
  { id: "classic-showdown", name: "Classic Showdown", category: "Standard Matchup", desc: "Highest total score wins" },
  { id: "precision-master", name: "Precision Master", category: "Standard Matchup", desc: "Pure accuracy decides the winner" },
  { id: "team-clash-score", name: "Team Clash (Score)", category: "Team Matchup", desc: "Red vs Blue total score" },
  { id: "team-sync-accuracy", name: "Team Sync (Accuracy)", category: "Team Matchup", desc: "Red vs Blue combined accuracy" },
  { id: "target-practice", name: "Target Practice", category: "Objective Gimmick", desc: "Closest to target Acc" },
  { id: "russian-roulette", name: "Russian Roulette", category: "Objective Gimmick", desc: "Lowest total miss count" },
  { id: "streak-keeper", name: "Streak Keeper", category: "Objective Gimmick", desc: "Highest peak max combo" },
  { id: "bounty-hunter", name: "Bounty Hunter", category: "Objective Gimmick", desc: "Bounty for beating room leader" },
  { id: "blindfolded", name: "Blindfolded", category: "Mod Challenge", desc: "Forced HD + FL" },
  { id: "blind-rhythm", name: "Blind Rhythm", category: "Mod Challenge", desc: "Forced HD" },
  { id: "pixel-perfect", name: "Pixel Perfect", category: "Mod Challenge", desc: "Forced HR" },
  { id: "lights-out", name: "Lights Out", category: "Mod Challenge", desc: "Forced FL" },
  { id: "speedom", name: "Speedom", category: "Mod Challenge", desc: "Forced DT" },
  { id: "relay-race", name: "Relay Race (Tag Co-op)", category: "Automated Tag", desc: "Turn-based co-op relay" },
  { id: "boss-battle", name: "Boss Battle", category: "Automated Override", desc: "Host's #1 top play" },
  { id: "hosts-addiction", name: "Host's Addiction", category: "Automated Override", desc: "Host's most played map" },
  { id: "community-choice-rewind", name: "Community Choice Rewind", category: "Automated Override", desc: "Map of the Year winner" },
  { id: "ranked-rewind", name: "Ranked Rewind (Top 3)", category: "Automated Override", desc: "Top ranked maps from random year" },
  { id: "loved-classics", name: "Loved Classics (Top 3)", category: "Automated Override", desc: "Top loved maps from random year" },
  { id: "partypoint-wager", name: "PartyPoint Wager", category: "Social / Gambling", desc: "!bet during prep; 2x payout" },
  { id: "juggernaut", name: "Juggernaut (1 vs. All)", category: "Asymmetric Battle", desc: "Leader solo vs team average" },
  { id: "sudden-death-battle-royale", name: "Sudden Death: Battle Royale", category: "Elimination", desc: "Forced Sudden Death survival" }
];

function setWeight(id, val) {
  const slider = document.querySelector(`[data-minigame-slider="${id}"]`);
  const num = document.querySelector(`[data-minigame-num="${id}"]`);
  const toggle = document.querySelector(`[data-minigame-toggle="${id}"]`);
  if (slider) slider.value = val;
  if (num) num.value = val;
  if (toggle) toggle.checked = val > 0;
}

function applyPreset(name) {
  for (const m of MINIGAMES) {
    let weight = 100;
    if (name === 'default') {
      weight = 100;
    } else if (name === 'nogimmicks') {
      weight = (m.category === 'Standard Matchup' || m.category === 'Team Matchup') ? 100 : 0;
    } else if (name === 'chaos') {
      if (m.category === 'Mod Challenge' || m.category === 'Automated Override') {
        weight = 100;
      } else if (m.category === 'Standard Matchup') {
        weight = 25;
      } else {
        weight = 100;
      }
    }
    setWeight(m.id, weight);
  }
}

function renderMinigames(weights = {}) {
  const container = $('#minigame-categories');
  if (!container) return;
  const categories = [...new Set(MINIGAMES.map(m => m.category))];
  
  container.innerHTML = categories.map(cat => {
    const items = MINIGAMES.filter(m => m.category === cat);
    const rows = items.map(m => {
      const weight = weights[m.id] !== undefined ? weights[m.id] : 100;
      const checked = weight > 0 ? 'checked' : '';
      return `<div class="minigame-row">
        <label style="display:inline-flex;align-items:center;margin:0;"><input type="checkbox" data-minigame-toggle="${m.id}" ${checked} title="Enable/Disable minigame"></label>
        <div class="minigame-info">
          <strong>${escapeHtml(m.name)}</strong>
          <small>${escapeHtml(m.desc)}</small>
        </div>
        <div class="minigame-controls">
          <input type="range" min="0" max="100" value="${weight}" data-minigame-slider="${m.id}">
          <input type="number" min="0" max="100" value="${weight}" data-minigame-num="${m.id}">
        </div>
      </div>`;
    }).join('');

    return `<div class="minigame-category-group">
      <h4>${escapeHtml(cat)}</h4>
      ${rows}
    </div>`;
  }).join('');

  container.querySelectorAll('[data-minigame-slider]').forEach(slider => {
    slider.addEventListener('input', () => {
      const id = slider.dataset.minigameSlider;
      const num = container.querySelector(`[data-minigame-num="${id}"]`);
      const toggle = container.querySelector(`[data-minigame-toggle="${id}"]`);
      if (num) num.value = slider.value;
      if (toggle) toggle.checked = Number(slider.value) > 0;
    });
  });

  container.querySelectorAll('[data-minigame-num]').forEach(num => {
    num.addEventListener('input', () => {
      let val = Math.max(0, Math.min(100, Number(num.value) || 0));
      const id = num.dataset.minigameNum;
      const slider = container.querySelector(`[data-minigame-slider="${id}"]`);
      const toggle = container.querySelector(`[data-minigame-toggle="${id}"]`);
      if (slider) slider.value = val;
      if (toggle) toggle.checked = val > 0;
    });
  });

  container.querySelectorAll('[data-minigame-toggle]').forEach(toggle => {
    toggle.addEventListener('change', () => {
      const id = toggle.dataset.minigameToggle;
      setWeight(id, toggle.checked ? 100 : 0);
    });
  });
}

async function loadConfig() {
  try {
    const config = await request('/api/config');
    if (config) {
      if (config.totalRounds) $('#cfg-total-rounds').value = config.totalRounds;
      if (config.ranked !== undefined) $('#cfg-ranked').checked = config.ranked;
      renderMinigames(config.minigameWeights || {});
    }
  } catch (e) {
    renderMinigames({});
  }
}

async function saveConfig(event) {
  event.preventDefault();
  const totalRounds = Number($('#cfg-total-rounds').value) || 10;
  const ranked = $('#cfg-ranked').checked;
  const minigameWeights = {};
  for (const m of MINIGAMES) {
    const numInput = document.querySelector(`[data-minigame-num="${m.id}"]`);
    minigameWeights[m.id] = numInput ? Number(numInput.value) : 100;
  }
  const statusEl = $('#save-status');
  try {
    await request('/api/config', {
      method: 'POST',
      body: JSON.stringify({ totalRounds, ranked, minigameWeights })
    });
    statusEl.textContent = 'Settings saved!';
    statusEl.className = 'success';
    $('#weights-notice').textContent = `Total Rounds: ${totalRounds} · Ranked: ${ranked ? 'Yes' : 'No'}`;
    setTimeout(() => { statusEl.textContent = ''; }, 4000);
  } catch (e) {
    statusEl.textContent = e.message;
    statusEl.className = 'error';
  }
}

$('#preset-default').addEventListener('click', () => applyPreset('default'));
$('#preset-nogimmicks').addEventListener('click', () => applyPreset('nogimmicks'));
$('#preset-chaos').addEventListener('click', () => applyPreset('chaos'));
$('#minigame-config-form').addEventListener('submit', saveConfig);

renderMinigames({});
if (token.value) {
  load();
  loadConfig();
}

// Live polling for active lobbies & standings
setInterval(() => {
  if (token.value && !document.querySelector('input:focus, select:focus')) {
    load();
  }
}, 5000);

// Confetti effect on logo hover
(function setupLogoConfetti() {
  const logo = document.querySelector('.osu-logo');
  if (!logo) return;

  let canvas = null;
  let ctx = null;
  let particles = [];
  let animId = null;
  const colors = ['#F99B3D', '#22D3EE', '#EC4899', '#FCD34D', '#A855F7', '#34D399'];

  function initCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'confetti-canvas';
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '99999';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
  }

  function resizeCanvas() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function spawnConfetti() {
    initCanvas();
    const rect = logo.getBoundingClientRect();
    const originX = rect.left + rect.width / 2;
    const originY = rect.bottom;

    // Burst of confetti sprinkles
    const count = 55;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: originX + (Math.random() - 0.5) * 80,
        y: originY + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 2.5,
        vy: -0.5 - Math.random() * 1.5, // gentle soft rise before falling
        maxVy: 0.8 + Math.random() * 0.8, // slow terminal falling speed
        w: 5 + Math.random() * 5,
        h: 4 + Math.random() * 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 3, // slow gentle tumble
        gravity: 0.03 + Math.random() * 0.02, // very light gravity
        wobble: Math.random() * Math.PI * 2,
        wobbleSpeed: 0.04 + Math.random() * 0.04,
        opacity: 1,
        life: 0,
        maxLife: 350 + Math.random() * 120
      });
    }

    if (!animId) {
      loop();
    }
  }

  function loop() {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.wobble += p.wobbleSpeed;
      p.x += p.vx + Math.sin(p.wobble) * 0.7; // gentle fluttering air drift
      p.y += p.vy;
      p.vy = Math.min(p.maxVy, p.vy + p.gravity);
      p.rotation += p.rotSpeed;
      p.life++;

      if (p.life > p.maxLife - 50) {
        p.opacity = Math.max(0, (p.maxLife - p.life) / 50);
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();

      if (p.life >= p.maxLife || p.y > canvas.height + 20) {
        particles.splice(i, 1);
      }
    }

    if (particles.length > 0) {
      animId = requestAnimationFrame(loop);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      animId = null;
    }
  }

  logo.addEventListener('mouseenter', spawnConfetti);
})();


