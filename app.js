/* ===== NeoMarket Grid Ops Terminal v2 ===== */

'use strict';

// ===== CONFIG =====

const SYNDICATE_ORDER = ['Forge', 'Interface', 'QA Corps'];

const SYNDICATE_META = {
  'Forge':     { css: 'forge',     desc: 'Backend, DevOps, infrastructure' },
  'Interface': { css: 'interface',  desc: 'Frontend, UX, product design' },
  'QA Corps':  { css: 'qacorps',   desc: 'Testing, quality assurance' },
};

const RANKS = [
  { name: 'Freelancer',     threshold: 0,    css: 'rank-1' },
  { name: 'Contractor',     threshold: 400,  css: 'rank-2' },
  { name: 'Netrunner',      threshold: 1200, css: 'rank-3' },
  { name: 'Operative',      threshold: 2400, css: 'rank-4' },
  { name: 'Console Cowboy', threshold: 3800, css: 'rank-5' },
  { name: 'Shadow Broker',  threshold: 5500, css: 'rank-6' },
  { name: 'Architect',      threshold: 8000, css: 'rank-7' },
];

const TEAM_THRESHOLDS = [
  { name: 'Firewall',      value: 8000 },
  { name: 'Neural Watch',  value: 12000 },
];

const ACHIEVEMENT_ICONS = {
  'handshake': { label: 'First Handshake', short: 'FH', title: 'Участие в Protocol Summit S1' },
};

// ===== STATE =====

let appData = null;
let activeTab = 'leaderboard';
let expandedTeam = {};
let searchState = { query: '', selectedFio: null };
let myTeam = localStorage.getItem('neo_my_team');

// ===== DATA LOADING =====

async function loadData() {
  const nocache = '?v=' + Date.now();
  const [roster, creditsLog, repLog, sprints, achievements] = await Promise.all([
    fetch('./data/roster.json' + nocache).then(r => { if (!r.ok) throw new Error('roster.json'); return r.json(); }),
    fetch('./data/credits-log.json' + nocache).then(r => { if (!r.ok) throw new Error('credits-log.json'); return r.json(); }),
    fetch('./data/rep-log.json' + nocache).then(r => { if (!r.ok) throw new Error('rep-log.json'); return r.json(); }),
    fetch('./data/sprints.json' + nocache).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('./data/achievements.json' + nocache).then(r => r.ok ? r.json() : null).catch(() => null),
  ]);
  return buildDataModel(roster, creditsLog, repLog, sprints, achievements);
}

// ===== DATA AGGREGATION =====

function buildDataModel(roster, creditsLog, repLog, sprints, achievements) {
  const memberBalances = new Map();

  for (const m of roster.members) {
    memberBalances.set(m.fio, {
      rep: 0, credits: 0,
      repTx: [], creditsTx: [],
      achievements: [],
      sprintRepDelta: 0,
      ...m,
    });
  }

  for (const tx of repLog.transactions) {
    const entry = memberBalances.get(tx.member);
    if (entry) {
      entry.rep += tx.total;
      entry.repTx.push(tx);
    }
  }

  for (const tx of creditsLog.transactions) {
    const entry = memberBalances.get(tx.member);
    if (entry) {
      entry.credits += tx.amount;
      entry.creditsTx.push(tx);
    }
  }

  for (const entry of memberBalances.values()) {
    entry.repTx.sort((a, b) => b.date.localeCompare(a.date));
    entry.creditsTx.sort((a, b) => b.date.localeCompare(a.date));
  }

  // Sprint data
  let sprintData = null;
  if (sprints && sprints.sprints && sprints.current_sprint) {
    const currentSprint = sprints.sprints.find(s => s.number === sprints.current_sprint);
    const previousSprint = sprints.sprints.find(s => s.number === sprints.current_sprint - 1) || null;

    if (currentSprint) {
      const sprintRepDeltas = new Map();

      for (const tx of repLog.transactions) {
        if (tx.date >= currentSprint.start_date && tx.date <= currentSprint.end_date) {
          const entry = memberBalances.get(tx.member);
          if (entry) {
            entry.sprintRepDelta += tx.total;
          }
          sprintRepDeltas.set(tx.team, (sprintRepDeltas.get(tx.team) || 0) + tx.total);
        }
      }

      sprintData = { currentSprint, previousSprint, sprintRepDeltas };
    }
  }

  // Achievement data
  let achievementData = null;
  if (achievements && achievements.definitions && achievements.awarded) {
    const definitionsMap = new Map();
    for (const def of achievements.definitions) {
      definitionsMap.set(def.id, def);
    }

    const memberAchievements = new Map();
    const teamAchievementCounts = new Map();

    for (const award of achievements.awarded) {
      const def = definitionsMap.get(award.achievement_id);
      if (!def) continue;

      if (!memberAchievements.has(award.member)) {
        memberAchievements.set(award.member, []);
      }
      memberAchievements.get(award.member).push({ definition: def, date: award.date });

      teamAchievementCounts.set(award.team, (teamAchievementCounts.get(award.team) || 0) + 1);
    }

    for (const [fio, achs] of memberAchievements) {
      const entry = memberBalances.get(fio);
      if (entry) entry.achievements = achs;
    }

    achievementData = { definitionsMap, memberAchievements, teamAchievementCounts };
  }

  // Team stats
  const teamStats = new Map();
  for (const team of roster.teams) {
    const members = [];
    for (const m of memberBalances.values()) {
      if (m.team === team.name) members.push(m);
    }
    const totalRep = members.reduce((s, m) => s + m.rep, 0);
    const totalCredits = members.reduce((s, m) => s + m.credits, 0);
    const sprintDelta = sprintData ? (sprintData.sprintRepDeltas.get(team.name) || 0) : 0;
    const achievementCount = achievementData
      ? (achievementData.teamAchievementCounts.get(team.name) || 0)
      : 0;

    teamStats.set(team.name, {
      ...team,
      members,
      totalRep,
      totalCredits,
      sprintDelta,
      achievementCount,
    });
  }

  // Syndicate data
  const syndicateData = new Map();
  for (const synName of SYNDICATE_ORDER) {
    const teams = [];
    let totalRep = 0;
    let memberCount = 0;
    let protocolCoordinator = null;

    for (const [, ts] of teamStats) {
      if (ts.syndicate === synName) {
        teams.push(ts);
        totalRep += ts.totalRep;
        memberCount += ts.members.length;
      }
    }

    for (const m of memberBalances.values()) {
      if (m.syndicate === synName && m.roles && m.roles.includes('Protocol Coordinator')) {
        protocolCoordinator = m;
        break;
      }
    }

    syndicateData.set(synName, { teams, totalRep, memberCount, protocolCoordinator });
  }

  // Global stats
  const dates = [roster.last_updated, creditsLog.last_updated, repLog.last_updated]
    .filter(Boolean).sort().reverse();

  const globalStats = {
    totalTeams: roster.teams.length,
    totalMembers: roster.members.length,
    totalRep: Array.from(memberBalances.values()).reduce((s, m) => s + m.rep, 0),
    totalCredits: Array.from(memberBalances.values()).reduce((s, m) => s + m.credits, 0),
    lastUpdated: dates[0] || '—',
  };

  // Pre-sorted teams ranking (used by hero, leaderboard, selector)
  const teamRanking = Array.from(teamStats.values())
    .sort((a, b) => b.totalRep - a.totalRep);

  return { memberBalances, teamStats, syndicateData, globalStats, roster, sprintData, achievementData, teamRanking };
}

// ===== RANKS =====

function getRank(rep) {
  let current = RANKS[0];
  for (const r of RANKS) {
    if (rep >= r.threshold) current = r;
    else break;
  }
  const idx = RANKS.indexOf(current);
  const next = RANKS[idx + 1] || null;
  const progressInRank = next
    ? (rep - current.threshold) / (next.threshold - current.threshold)
    : 1;
  return { current, next, index: idx, progress: Math.min(1, progressInRank) };
}

// ===== UTILITY =====

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function synCss(syndicate) {
  return SYNDICATE_META[syndicate]?.css || 'forge';
}

function formatDate(dateStr) {
  const parts = dateStr.split('-');
  if (parts.length === 3) return `${parts[2]}.${parts[1]}`;
  return dateStr;
}

// ===== RENDER: Header =====

function renderHeader(stats) {
  const el = document.getElementById('stats-bar');
  const sprintLabel = appData.sprintData
    ? `<span class="stat-sep">|</span>
       <span class="stat-item"><span class="stat-label">Sprint</span> <span class="stat-value stat-value-sprint">${appData.sprintData.currentSprint.number}</span></span>`
    : '';

  el.innerHTML = `
    <span class="stat-item"><span class="stat-label">Teams</span> <span class="stat-value">${stats.totalTeams}</span></span>
    <span class="stat-sep">|</span>
    <span class="stat-item"><span class="stat-label">Agents</span> <span class="stat-value">${stats.totalMembers}</span></span>
    <span class="stat-sep">|</span>
    ${sprintLabel}
    <span class="stat-date">upd: ${stats.lastUpdated}</span>
  `;
}

// ===== RENDER: Hero Block =====

function renderHeroBlock() {
  const container = document.getElementById('hero-block');
  const teamData = myTeam ? appData.teamStats.get(myTeam) : null;

  if (!teamData) {
    if (myTeam) {
      localStorage.removeItem('neo_my_team');
      myTeam = null;
    }

    container.innerHTML = `
      <div class="hero-prompt">
        <span class="hero-prompt-icon">[&gt;]</span>
        <span class="hero-prompt-text">Select your team to initialize personal feed<span class="blink">_</span></span>
        <button class="hero-prompt-btn" id="hero-choose-team">Choose team</button>
      </div>
    `;
    return;
  }

  const css = synCss(teamData.syndicate);

  // Compute team rank
  const teamRank = appData.teamRanking.findIndex(t => t.name === myTeam) + 1;

  // Sprint delta
  const sprintDeltaHtml = appData.sprintData && teamData.sprintDelta > 0
    ? `<div class="hero-sprint-delta">+${teamData.sprintDelta} Rep this sprint</div>`
    : '';

  // Members list
  const sortedMembers = [...teamData.members].sort((a, b) => b.rep - a.rep);
  const memberListHtml = sortedMembers.map(m => {
    const rank = getRank(m.rep);
    const isCaptain = m.role === 'Captain';
    const activityDot = appData.sprintData
      ? `<span class="activity-dot ${m.sprintRepDelta > 0 ? 'activity-dot-active' : 'activity-dot-inactive'}" title="${m.sprintRepDelta > 0 ? 'Active this sprint' : 'No activity this sprint'}"></span>`
      : '';
    return `
      <div class="hero-member">
        ${activityDot}
        <span class="hero-member-fio">${escapeHtml(m.fio)}</span>
        ${isCaptain ? '<span class="badge badge-captain">CPT</span>' : ''}
        <span class="rank-badge ${rank.current.css}">${escapeHtml(rank.current.name)}</span>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="hero-card hero-card-${css}">
      <div class="hero-header">
        <div class="hero-team-info">
          <span class="hero-team-name">${escapeHtml(teamData.name)}</span>
          <span class="badge badge-${css}">${escapeHtml(teamData.syndicate)}</span>
          <span class="hero-team-rank">#${teamRank} <span class="hero-rank-of">of ${appData.globalStats.totalTeams}</span></span>
        </div>
        <button class="hero-change-btn" id="hero-change-team">Change →</button>
      </div>
      <div class="hero-stats">
        <div class="hero-rep-row">
          <span class="hero-rep-value" style="color:var(--${css});text-shadow:var(--${css}-glow)">${teamData.totalRep.toLocaleString('ru-RU')}</span>
          <span class="hero-rep-label">Team Rep</span>
        </div>
        ${renderTeamProgressBar(teamData.totalRep, teamData.syndicate)}
        ${sprintDeltaHtml}
      </div>
      <div class="hero-members">
        <div class="hero-members-label">Agents // ${teamData.size}</div>
        ${memberListHtml}
      </div>
    </div>
  `;
}

// ===== RENDER: Team Selector Modal =====

function renderTeamSelectorModal() {
  const modal = document.getElementById('team-selector-modal');
  const sortedAll = appData.teamRanking;

  let teamsHtml = '';
  for (const synName of SYNDICATE_ORDER) {
    const syn = appData.syndicateData.get(synName);
    const css = synCss(synName);
    const sortedTeams = [...syn.teams].sort((a, b) => b.totalRep - a.totalRep);

    teamsHtml += `<div class="selector-syn-header selector-syn-${css}">${escapeHtml(synName)}</div>`;

    for (const team of sortedTeams) {
      const rank = sortedAll.findIndex(t => t.name === team.name) + 1;
      const isSelected = team.name === myTeam;

      teamsHtml += `
        <div class="selector-team ${isSelected ? 'selector-team-selected' : ''}" data-team="${escapeHtml(team.name)}" data-syndicate="${css}">
          <span class="selector-team-name">${escapeHtml(team.name)}</span>
          <span class="selector-team-meta">${team.size} agents · #${rank}</span>
        </div>
      `;
    }
  }

  modal.innerHTML = `
    <div class="selector-backdrop"></div>
    <div class="selector-card">
      <div class="selector-title">
        <span>// Team Selection Protocol</span>
        <button class="selector-close">[×]</button>
      </div>
      <div class="selector-list">
        ${teamsHtml}
      </div>
    </div>
  `;
}

function openTeamSelector() {
  const modal = document.getElementById('team-selector-modal');
  renderTeamSelectorModal();
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeTeamSelector() {
  const modal = document.getElementById('team-selector-modal');
  modal.hidden = true;
  document.body.style.overflow = '';
}

function selectMyTeam(teamName) {
  myTeam = teamName;
  localStorage.setItem('neo_my_team', teamName);
  closeTeamSelector();
  renderHeroBlock();
  if (activeTab === 'leaderboard') renderLeaderboard();
  if (activeTab === 'syndicates') renderSyndicates();
}

// ===== RENDER: What's New Banner =====

function renderWhatsNewBanner() {
  const container = document.getElementById('whats-new-banner');
  const lastUpdated = appData.globalStats.lastUpdated;
  const lastSeen = localStorage.getItem('neo_whats_new_seen');

  // Only compare valid ISO dates (YYYY-MM-DD)
  if (!lastUpdated || !/^\d{4}-\d{2}-\d{2}$/.test(lastUpdated)) {
    container.innerHTML = '';
    return;
  }

  if (lastSeen && lastSeen >= lastUpdated) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="whats-new">
      <span class="whats-new-dot"></span>
      <span class="whats-new-text">Data updated: ${lastUpdated}</span>
      <button class="whats-new-dismiss" id="whats-new-dismiss">[×]</button>
    </div>
  `;
}

function dismissWhatsNew() {
  localStorage.setItem('neo_whats_new_seen', appData.globalStats.lastUpdated);
  const container = document.getElementById('whats-new-banner');
  const banner = container.querySelector('.whats-new');
  if (banner) {
    banner.style.opacity = '0';
    banner.style.transform = 'translateY(-8px)';
    setTimeout(() => { container.innerHTML = ''; }, 200);
  }
}

// ===== RENDER: Achievement Badges =====

function getAchievementIcon(def) {
  const mapping = ACHIEVEMENT_ICONS[def.icon];
  if (mapping) return mapping;
  return { label: def.title, short: def.title.substring(0, 2).toUpperCase(), title: def.description || def.title };
}

function renderAchievementBadgesInline(achievements) {
  if (!achievements || achievements.length === 0) return '';
  return achievements.map(a => {
    const icon = getAchievementIcon(a.definition);
    const reward = a.definition.rep_reward ? ` +${a.definition.rep_reward}` : '';
    const desc = a.definition.description || icon.title;
    return `<span class="ach-badge" title="${escapeHtml(desc)}"><span class="ach-badge-marker">▸</span> ${escapeHtml(icon.label)}${reward}</span>`;
  }).join('');
}

function renderAchievementBadgesFull(achievements) {
  if (!achievements || achievements.length === 0) return '';
  let html = '<div class="ach-section"><div class="ach-title">Achievements</div><div class="ach-list">';
  for (const a of achievements) {
    const reward = a.definition.rep_reward
      ? `<span class="ach-card-reward">+${a.definition.rep_reward} Rep</span>`
      : '';
    html += `
      <div class="ach-card">
        <div class="ach-card-left">
          <span class="ach-card-name">${escapeHtml(a.definition.title)}</span>
          <span class="ach-card-desc">${escapeHtml(a.definition.description)}</span>
        </div>
        <div class="ach-card-right">
          ${reward}
          <span class="ach-card-date">${formatDate(a.date)}</span>
        </div>
      </div>
    `;
  }
  html += '</div></div>';
  return html;
}

// ===== RENDER: Progress Bars =====

function renderTeamProgressBar(totalRep, syndicate) {
  const maxVal = TEAM_THRESHOLDS[TEAM_THRESHOLDS.length - 1].value;
  const pct = Math.min(100, (totalRep / maxVal) * 100);
  const css = synCss(syndicate);

  let markers = '';
  for (const t of TEAM_THRESHOLDS) {
    const pos = (t.value / maxVal) * 100;
    markers += `<div class="progress-marker" style="left:${pos}%"></div>`;
    markers += `<span class="progress-marker-label" style="left:${pos}%">${t.name}</span>`;
  }

  return `
    <div class="progress-bar" style="margin-top:4px">
      <div class="progress-fill progress-fill-${css}" style="width:${pct}%"></div>
      ${markers}
    </div>
  `;
}

function renderRankProgress(rep) {
  const rank = getRank(rep);
  const pct = Math.round(rank.progress * 100);

  const nextLabel = rank.next
    ? `<span class="rank-next">${rank.next.name} — ${rank.next.threshold.toLocaleString('ru-RU')} Rep</span>`
    : `<span class="rank-next rank-max">Max rank reached</span>`;

  return `
    <div class="rank-block">
      <div class="rank-header">
        <span class="rank-badge ${rank.current.css}">${escapeHtml(rank.current.name)}</span>
        ${nextLabel}
      </div>
      <div class="progress-bar" style="height:8px">
        <div class="progress-fill progress-fill-rank ${rank.current.css}" style="width:${pct}%"></div>
      </div>
    </div>
  `;
}

// ===== RENDER: Member rows (privacy-modified) =====

function renderMemberRows(members) {
  const sorted = [...members].sort((a, b) => b.rep - a.rep);
  let html = '';

  for (const m of sorted) {
    const isCaptain = m.role === 'Captain';
    const rank = getRank(m.rep);
    const activityDot = appData.sprintData
      ? `<span class="activity-dot ${m.sprintRepDelta > 0 ? 'activity-dot-active' : 'activity-dot-inactive'}" title="${m.sprintRepDelta > 0 ? 'Active this sprint' : 'No activity this sprint'}"></span>`
      : '';

    html += `
      <div class="member-row member-row-clickable" data-fio="${escapeHtml(m.fio)}">
        <div class="member-fio">
          ${activityDot}
          <span class="member-fio-text">${escapeHtml(m.fio)}</span>
          ${isCaptain ? '<span class="badge badge-captain">CPT</span>' : ''}
          <span class="rank-badge ${rank.current.css}">${escapeHtml(rank.current.name)}</span>
        </div>
      </div>
    `;
  }
  return html;
}

// ===== RENDER: Leaderboard =====

function renderLeaderboard() {
  const container = document.getElementById('tab-leaderboard');
  const teams = appData.teamRanking;

  const hasSprint = !!appData.sprintData;

  let html = `<div class="leaderboard-list ${hasSprint ? 'leaderboard-has-sprint' : ''}">`;
  teams.forEach((team, i) => {
    const rank = i + 1;
    const css = synCss(team.syndicate);
    const isExpanded = expandedTeam.leaderboard === team.name;
    const isTop3 = rank <= 3;
    const isMine = team.name === myTeam;

    // Sprint delta column
    const sprintDeltaHtml = hasSprint && team.sprintDelta > 0
      ? `<span class="sprint-delta">+${team.sprintDelta}</span>`
      : hasSprint
        ? `<span class="sprint-delta sprint-delta-zero">—</span>`
        : '';

    // Achievement count
    const achCountHtml = team.achievementCount > 0
      ? `<span class="team-ach-count" title="${team.achievementCount} achievements">[${team.achievementCount}]</span>`
      : '';

    html += `
      <div class="team-row ${isExpanded ? 'expanded' : ''} ${isMine ? 'team-row-mine' : ''}" data-team="${escapeHtml(team.name)}" data-syndicate="${css}">
        <span class="team-rank ${isTop3 ? 'team-rank-top' : ''}">${rank}</span>
        <span class="team-name">${escapeHtml(team.name)}</span>
        <div class="team-meta">
          <span class="badge badge-${css}">${escapeHtml(team.syndicate)}</span>
          <span class="team-members-count">${team.size} agents</span>
          ${achCountHtml}
        </div>
        ${sprintDeltaHtml}
        <span class="team-rep" style="color:var(--${css})" title="Суммарная репутация всех агентов команды">${team.totalRep} Rep</span>
      </div>
      <div class="team-detail ${isExpanded ? 'open' : ''}" data-detail="${escapeHtml(team.name)}">
        <div class="team-detail-inner">
          ${isExpanded ? renderTeamProgressBar(team.totalRep, team.syndicate) + renderMemberRows(team.members) : ''}
        </div>
      </div>
    `;
  });
  html += '</div>';
  container.innerHTML = html;
}

// ===== RENDER: Syndicates =====

function renderSyndicates() {
  const container = document.getElementById('tab-syndicates');
  let html = '';

  for (const synName of SYNDICATE_ORDER) {
    const syn = appData.syndicateData.get(synName);
    const meta = SYNDICATE_META[synName];
    const css = meta.css;

    html += `<div class="syndicate-section">`;

    html += `
      <div class="syndicate-header syndicate-header-${css}">
        <span class="syndicate-name syndicate-name-${css}">${escapeHtml(synName)}</span>
        <span class="syndicate-desc">${meta.desc}</span>
        <div class="syndicate-stats">
          <span>${syn.teams.length} teams</span>
          <span>${syn.memberCount} agents</span>
          <span>${syn.totalRep} total Rep</span>
        </div>
      </div>
    `;

    if (syn.protocolCoordinator) {
      const pc = syn.protocolCoordinator;
      html += `
        <div class="coordinator-block">
          <span class="coordinator-label">Protocol Summit S1 Coordinator</span>
          <span class="coordinator-name">${escapeHtml(pc.fio)}</span>
          <span class="coordinator-team">// ${escapeHtml(pc.team)}</span>
        </div>
      `;
    }

    html += '<div class="syndicate-teams">';
    const sortedTeams = [...syn.teams].sort((a, b) => b.totalRep - a.totalRep);
    for (const team of sortedTeams) {
      const isExpanded = expandedTeam.syndicates === team.name;
      const isMine = team.name === myTeam;
      html += `
        <div class="syndicate-team-row ${isMine ? 'team-row-mine' : ''}" data-team="${escapeHtml(team.name)}" data-syndicate="${css}">
          <span class="team-name">${escapeHtml(team.name)}</span>
          <span class="team-members-count" style="color:var(--text-dim)">${team.size} agents</span>
          <span style="color:var(--${css});font-weight:500;font-size:0.75rem">${team.totalRep} Rep</span>
        </div>
        <div class="team-detail ${isExpanded ? 'open' : ''}" data-detail="${escapeHtml(team.name)}">
          <div class="team-detail-inner">
            ${isExpanded ? renderMemberRows(team.members) : ''}
          </div>
        </div>
      `;
    }
    html += '</div>';
    html += '</div>';
  }

  container.innerHTML = html;
}

// ===== RENDER: Search =====

function renderSearchResults() {
  const container = document.getElementById('search-results');

  if (searchState.selectedFio) {
    const m = appData.memberBalances.get(searchState.selectedFio);
    if (m) {
      container.innerHTML = renderMemberCard(m);
      return;
    }
  }

  const query = searchState.query.trim().toLowerCase();
  if (!query) {
    container.innerHTML = '<div class="search-empty">&gt; Введите ФИО для поиска</div>';
    return;
  }

  const matches = [];
  for (const m of appData.memberBalances.values()) {
    if (m.fio.toLowerCase().includes(query)) {
      matches.push(m);
    }
  }

  if (matches.length === 0) {
    container.innerHTML = '<div class="search-empty">[x] Агент не найден в системе</div>';
    return;
  }

  let html = '';
  for (const m of matches) {
    const css = synCss(m.syndicate);
    html += `
      <div class="search-result-item" data-fio="${escapeHtml(m.fio)}">
        <span class="search-result-fio">${escapeHtml(m.fio)}</span>
        <span class="search-result-meta">
          <span class="badge badge-${css}">${escapeHtml(m.syndicate)}</span>
          <span>${escapeHtml(m.team)}</span>
        </span>
      </div>
    `;
  }
  container.innerHTML = html;
}

function renderMemberCard(m) {
  const css = synCss(m.syndicate);
  const isCaptain = m.role === 'Captain';
  const extraRoles = m.roles || [];

  let badges = '';
  if (isCaptain) badges += '<span class="badge badge-captain">Captain</span>';
  for (const r of extraRoles) {
    badges += `<span class="badge badge-role">${escapeHtml(r)}</span>`;
  }

  // Achievement badges (full)
  const achHtml = renderAchievementBadgesFull(m.achievements);

  // Transactions
  const allTx = [
    ...m.repTx.map(tx => ({ ...tx, currency: 'Rep', value: tx.total })),
    ...m.creditsTx.map(tx => ({ ...tx, currency: 'Cr', value: tx.amount })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  let txHtml = '';
  if (allTx.length > 0) {
    txHtml = `
      <div class="tx-section">
        <div class="tx-title">Transaction Log</div>
        <div class="tx-list">
          ${allTx.map(tx => {
            const isPositive = tx.value >= 0;
            const sign = isPositive ? '+' : '';
            return `
              <div class="tx-item">
                <span class="tx-date">${formatDate(tx.date)}</span>
                <span class="tx-type">${escapeHtml(tx.type)}${tx.source ? ' / ' + escapeHtml(tx.source) : ''}</span>
                <span class="${isPositive ? 'tx-amount-positive' : 'tx-amount-negative'}">${sign}${tx.value} ${tx.currency}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  return `
    <button class="back-link" id="back-to-search">&lt;— back to results</button>
    <div class="member-card">
      <div class="member-card-header">
        <div class="member-card-fio">${escapeHtml(m.fio)}</div>
        <div class="member-card-info">
          <span>Team: <strong>${escapeHtml(m.team)}</strong></span>
          <span><span class="badge badge-${css}">${escapeHtml(m.syndicate)}</span></span>
          <span>Course: ${escapeHtml(m.course)}</span>
        </div>
        ${badges ? `<div class="member-card-roles">${badges}</div>` : ''}
      </div>
      <div class="member-card-body">
        <div class="balance-section">
          <div class="balance-row">
            <span class="balance-label">Reputation</span>
            <span class="balance-value balance-value-rep">${m.rep.toLocaleString('ru-RU')}</span>
          </div>
          ${renderRankProgress(m.rep)}
        </div>
        <div class="balance-section">
          <div class="balance-row">
            <span class="balance-label">Credits</span>
            <span class="balance-value balance-value-credits">${m.credits.toLocaleString('ru-RU')}</span>
          </div>
        </div>
        ${achHtml}
        ${txHtml}
      </div>
    </div>
  `;
}

// ===== TAB SWITCHING =====

function switchTab(tab) {
  activeTab = tab;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  document.querySelectorAll('.tab-content').forEach(section => {
    section.hidden = section.id !== `tab-${tab}`;
  });

  if (tab === 'leaderboard') renderLeaderboard();
  if (tab === 'syndicates') renderSyndicates();
  if (tab === 'search') renderSearchResults();
}

// ===== EVENT HANDLERS =====

function openMemberCard(fio) {
  searchState.query = '';
  searchState.selectedFio = fio;
  const input = document.getElementById('search-input');
  if (input) input.value = '';
  switchTab('search');
}

function handleTeamClick(tabName, teamName) {
  if (expandedTeam[tabName] === teamName) {
    expandedTeam[tabName] = null;
  } else {
    expandedTeam[tabName] = teamName;
  }

  if (tabName === 'leaderboard') renderLeaderboard();
  if (tabName === 'syndicates') renderSyndicates();
}

function setupEvents() {
  // Tab navigation
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (btn) switchTab(btn.dataset.tab);
  });

  // Leaderboard: member click → card, team click → expand/collapse
  document.getElementById('tab-leaderboard').addEventListener('click', (e) => {
    const memberRow = e.target.closest('.member-row-clickable');
    if (memberRow) {
      e.stopPropagation();
      openMemberCard(memberRow.dataset.fio);
      return;
    }
    const row = e.target.closest('.team-row');
    if (row) handleTeamClick('leaderboard', row.dataset.team);
  });

  // Syndicates: member click → card, team click → expand/collapse
  document.getElementById('tab-syndicates').addEventListener('click', (e) => {
    const memberRow = e.target.closest('.member-row-clickable');
    if (memberRow) {
      e.stopPropagation();
      openMemberCard(memberRow.dataset.fio);
      return;
    }
    const row = e.target.closest('.syndicate-team-row');
    if (row) handleTeamClick('syndicates', row.dataset.team);
  });

  // Search: input with debounce
  let searchTimeout = null;
  document.getElementById('search-input').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchState.selectedFio = null;
    searchTimeout = setTimeout(() => {
      searchState.query = e.target.value;
      renderSearchResults();
    }, 200);
  });

  // Search: click on result
  document.getElementById('search-results').addEventListener('click', (e) => {
    const item = e.target.closest('.search-result-item');
    if (item) {
      searchState.selectedFio = item.dataset.fio;
      renderSearchResults();
      return;
    }

    const back = e.target.closest('#back-to-search');
    if (back) {
      searchState.selectedFio = null;
      renderSearchResults();
    }
  });

  // Hero block: choose team / change team
  document.getElementById('hero-block').addEventListener('click', (e) => {
    if (e.target.closest('#hero-choose-team') || e.target.closest('#hero-change-team')) {
      openTeamSelector();
    }
  });

  // Team selector modal
  document.getElementById('team-selector-modal').addEventListener('click', (e) => {
    // Close on backdrop click or close button
    if (e.target.closest('.selector-backdrop') || e.target.closest('.selector-close')) {
      closeTeamSelector();
      return;
    }

    // Select team
    const teamRow = e.target.closest('.selector-team');
    if (teamRow) {
      selectMyTeam(teamRow.dataset.team);
    }
  });

  // What's New banner dismiss
  document.getElementById('whats-new-banner').addEventListener('click', (e) => {
    if (e.target.closest('#whats-new-dismiss')) {
      dismissWhatsNew();
    }
  });

  // Keyboard shortcuts: S/L/? for tabs, Esc for modal/search reset
  document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('team-selector-modal');

    // Escape always works
    if (e.key === 'Escape') {
      if (!modal.hidden) { closeTeamSelector(); return; }
      if (e.target.tagName === 'INPUT') { e.target.blur(); return; }
      if (activeTab === 'search') {
        searchState.selectedFio = null;
        renderSearchResults();
        const input = document.getElementById('search-input');
        input.focus();
        input.select();
      }
      return;
    }

    // Skip shortcuts when typing or modal open
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (!modal.hidden) return;

    switch (e.key) {
      case 's': case 'S': case 'ы': case 'Ы': switchTab('syndicates'); break;
      case 'l': case 'L': case 'д': case 'Д': switchTab('leaderboard'); break;
      case '/': case '.':
        e.preventDefault();
        switchTab('search');
        document.getElementById('search-input').focus();
        break;
    }
  });
}

// ===== INIT =====

async function init() {
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const appEl = document.getElementById('app');

  try {
    appData = await loadData();
    loadingEl.hidden = true;
    appEl.hidden = false;
    renderHeader(appData.globalStats);
    renderHeroBlock();
    renderWhatsNewBanner();
    setupEvents();
    switchTab('leaderboard');
  } catch (err) {
    loadingEl.hidden = true;
    errorEl.hidden = false;
    errorEl.querySelector('.error-text').textContent =
      `Connection failed: ${err.message}. Check data files or start a local server.`;
    console.error('Grid Ops Terminal: init failed', err);
  }
}

document.addEventListener('DOMContentLoaded', init);
