let PLAYERS = null;
let NAMES = [];
let ALL_RECORDS = []; // {name, year, level, kind, team, stats} を選手横断でフラット化したもの

const TEAM_ORDER = [
  "読売ジャイアンツ", "阪神タイガース", "広島東洋カープ", "中日ドラゴンズ",
  "横浜DeNAベイスターズ", "東京ヤクルトスワローズ",
  "福岡ソフトバンクホークス", "北海道日本ハムファイターズ", "埼玉西武ライオンズ",
  "オリックス・バファローズ", "千葉ロッテマリーンズ", "東北楽天ゴールデンイーグルス",
];
const DEFAULT_TEAM = "広島東洋カープ";
const DEFAULT_KIND = "b";

const searchInput = document.getElementById("search-input");
const suggestionsEl = document.getElementById("suggestions");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");

const yearSelect = document.getElementById("filter-year");
const teamSelect = document.getElementById("filter-team");
const kindSelect = document.getElementById("filter-kind");
const playerSelect = document.getElementById("filter-player");

let activeIndex = -1;
let currentMatches = [];

// パスワードはこのハッシュ値との一致で判定する（平文はページに残さない）
const GATE_PASSWORD_HASH = "f411e93e0a68d1c82d34b44345273a3c2b96817643698123e12fe19fab97d4d7";
const GATE_STORAGE_KEY = "npbStatsUnlocked";

const gateEl = document.getElementById("gate");
const gateFormEl = document.getElementById("gate-form");
const gateInputEl = document.getElementById("gate-input");
const gateErrorEl = document.getElementById("gate-error");
const appEl = document.getElementById("app");

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function unlockApp() {
  gateEl.remove();
  appEl.classList.remove("app-hidden");
  init();
}

if (localStorage.getItem(GATE_STORAGE_KEY) === "1") {
  unlockApp();
} else {
  gateInputEl.focus();
  gateFormEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const hash = await sha256Hex(gateInputEl.value);
    if (hash === GATE_PASSWORD_HASH) {
      localStorage.setItem(GATE_STORAGE_KEY, "1");
      unlockApp();
    } else {
      gateErrorEl.textContent = "パスワードが違います";
      gateInputEl.value = "";
      gateInputEl.focus();
    }
  });
}

async function init() {
  statusEl.textContent = "データを読み込み中...";
  try {
    if (typeof window.__EMBEDDED_PLAYERS__ !== "undefined") {
      // オフライン単体HTML版: データがページに埋め込まれているのでfetch不要
      PLAYERS = window.__EMBEDDED_PLAYERS__;
    } else {
      const res = await fetch("data/players.json");
      if (!res.ok) throw new Error("HTTP " + res.status);
      PLAYERS = await res.json();
    }
    NAMES = Object.keys(PLAYERS);
    for (const name of NAMES) {
      for (const r of PLAYERS[name]) {
        ALL_RECORDS.push({ name, ...r });
      }
    }
    statusEl.textContent = `${NAMES.length}名の選手データを読み込みました。フィルターまたは選手名で絞り込めます。`;
    setupFilters();
  } catch (e) {
    statusEl.textContent = "データの読み込みに失敗しました（data/players.json が見つかりません）。scraper/build_players.py を実行してから、webapp フォルダをローカルサーバーで開いてください。";
    console.error(e);
  }
}

function setupFilters() {
  const years = [...new Set(ALL_RECORDS.map(r => r.year))].sort((a, b) => b - a);
  yearSelect.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join("");

  const teamsPresent = new Set(ALL_RECORDS.map(r => r.team));
  const teams = TEAM_ORDER.filter(t => teamsPresent.has(t));
  teamSelect.innerHTML = teams.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");

  yearSelect.value = String(years[0]);
  teamSelect.value = teams.includes(DEFAULT_TEAM) ? DEFAULT_TEAM : teams[0];
  kindSelect.value = DEFAULT_KIND;

  yearSelect.addEventListener("change", onFilterChange);
  teamSelect.addEventListener("change", onFilterChange);
  kindSelect.addEventListener("change", onFilterChange);
  playerSelect.addEventListener("change", () => {
    if (playerSelect.value) {
      searchInput.value = "";
      renderPlayer(playerSelect.value);
    } else {
      renderRoster();
    }
  });

  refreshPlayerOptions();
  renderRoster();
}

function onFilterChange() {
  refreshPlayerOptions();
  renderRoster();
}

function refreshPlayerOptions() {
  const names = rosterNames();
  playerSelect.innerHTML = `<option value="">（全選手を表示）</option>` +
    names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
}

function currentFilter() {
  return { year: Number(yearSelect.value), team: teamSelect.value, kind: kindSelect.value };
}

function rosterRecords() {
  const { year, team, kind } = currentFilter();
  return ALL_RECORDS.filter(r => r.year === year && r.team === team && r.kind === kind);
}

function rosterNames() {
  return [...new Set(rosterRecords().map(r => r.name))].sort((a, b) => a.localeCompare(b, "ja"));
}

function renderRoster() {
  const { year, team, kind } = currentFilter();
  const records = rosterRecords();

  if (!records.length) {
    resultEl.innerHTML = `<div class="empty-hint">該当する成績データがありません</div>`;
    return;
  }

  const byName = new Map();
  for (const r of records) {
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name).push(r);
  }
  const names = [...byName.keys()].sort((a, b) => a.localeCompare(b, "ja"));

  const kindLabel = kind === "p" ? "投手" : "野手";
  let html = `
    <div class="player-header">
      <h2>${year}年 ${escapeHtml(team)}</h2>
      <span class="teams">${kindLabel}成績（${names.length}名）</span>
    </div>
    <div class="roster">
  `;
  for (const name of names) {
    html += `
      <div class="roster-player">
        <h3 class="roster-player-name">${escapeHtml(name)}</h3>
        ${renderTable(byName.get(name))}
      </div>
    `;
  }
  html += `</div>`;

  resultEl.innerHTML = html;
}

function normalize(s) {
  return s.replace(/[　\s]+/g, "").toLowerCase();
}

searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim();
  if (!q || !PLAYERS) {
    closeSuggestions();
    return;
  }
  const nq = normalize(q);
  currentMatches = NAMES.filter(name => normalize(name).includes(nq)).slice(0, 30);
  renderSuggestions();
});

searchInput.addEventListener("keydown", (e) => {
  if (!suggestionsEl.classList.contains("open")) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    activeIndex = Math.min(activeIndex + 1, currentMatches.length - 1);
    highlightActive();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    activeIndex = Math.max(activeIndex - 1, 0);
    highlightActive();
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (activeIndex >= 0 && currentMatches[activeIndex]) {
      selectPlayer(currentMatches[activeIndex]);
    } else if (currentMatches.length === 1) {
      selectPlayer(currentMatches[0]);
    }
  } else if (e.key === "Escape") {
    closeSuggestions();
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-box")) closeSuggestions();
});

function renderSuggestions() {
  activeIndex = -1;
  if (currentMatches.length === 0) {
    suggestionsEl.innerHTML = `<div class="suggestion-item">該当する選手が見つかりません</div>`;
    suggestionsEl.classList.add("open");
    return;
  }
  suggestionsEl.innerHTML = currentMatches.map((name, i) => {
    const teams = [...new Set(PLAYERS[name].map(r => r.team))].join(" / ");
    return `<div class="suggestion-item" data-index="${i}"><span class="name">${escapeHtml(name)}</span><span class="team">${escapeHtml(teams)}</span></div>`;
  }).join("");
  suggestionsEl.classList.add("open");

  suggestionsEl.querySelectorAll(".suggestion-item[data-index]").forEach(el => {
    el.addEventListener("click", () => {
      const idx = Number(el.dataset.index);
      selectPlayer(currentMatches[idx]);
    });
  });
}

function highlightActive() {
  suggestionsEl.querySelectorAll(".suggestion-item").forEach((el, i) => {
    el.classList.toggle("active", i === activeIndex);
  });
}

function closeSuggestions() {
  suggestionsEl.classList.remove("open");
  suggestionsEl.innerHTML = "";
}

function selectPlayer(name) {
  searchInput.value = name;
  closeSuggestions();
  playerSelect.value = "";
  renderPlayer(name);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function renderPlayer(name) {
  const records = PLAYERS[name];
  if (!records) {
    resultEl.innerHTML = `<div class="empty-hint">選手が見つかりませんでした</div>`;
    return;
  }

  const teams = [...new Set(records.map(r => r.team))].join(" / ");
  const battingRecords = records.filter(r => r.kind === "b");
  const pitchingRecords = records.filter(r => r.kind === "p");

  let html = `
    <div class="player-header">
      <h2>${escapeHtml(name)}</h2>
      <span class="teams">${escapeHtml(teams)}</span>
    </div>
  `;

  if (battingRecords.length) {
    html += `<div class="section-title">打撃成績</div>`;
    html += renderTable(battingRecords);
  }
  if (pitchingRecords.length) {
    html += `<div class="section-title">投手成績</div>`;
    html += renderTable(pitchingRecords);
  }
  if (!battingRecords.length && !pitchingRecords.length) {
    html += `<div class="empty-hint">成績データがありません</div>`;
  }

  resultEl.innerHTML = html;
}

function renderTable(records) {
  const statCols = Object.keys(records[0].stats);

  const rows = records.map(r => {
    const badge = r.level === 1
      ? `<span class="level-badge">1軍</span>`
      : `<span class="level-badge">2軍</span>`;
    const stats = statCols.map(c => `
      <div class="stat">
        <span class="stat-label">${escapeHtml(c)}</span>
        <span class="stat-value">${escapeHtml(r.stats[c] ?? "")}</span>
      </div>
    `).join("");
    return `
      <div class="stat-row level-${r.level}">
        <div class="stat-row-head">
          <span class="stat-year">${r.year}</span>
          ${badge}
          <span class="stat-team">${escapeHtml(r.team)}</span>
        </div>
        <div class="stat-grid">${stats}</div>
      </div>
    `;
  }).join("");

  return `<div class="stat-rows">${rows}</div>`;
}
