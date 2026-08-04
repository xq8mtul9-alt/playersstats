let PLAYERS = null;
let NAMES = [];
let ALL_RECORDS = []; // {name, year, level, kind, team, stats} を選手横断でフラット化したもの
let ROSTER = null; // { year, teams: { チーム名: { 選手名: "背番号" } } }。NPB公式に現在のロースターしか無いため対象は最新年度のみ

const TEAM_ORDER = [
  "読売ジャイアンツ", "阪神タイガース", "広島東洋カープ", "中日ドラゴンズ",
  "横浜DeNAベイスターズ", "東京ヤクルトスワローズ",
  "福岡ソフトバンクホークス", "北海道日本ハムファイターズ", "埼玉西武ライオンズ",
  "オリックス・バファローズ", "千葉ロッテマリーンズ", "東北楽天ゴールデンイーグルス",
];
const DEFAULT_TEAM = "広島東洋カープ";
const DEFAULT_KIND = "b";
// 打席が極端に少ない（5以下）選手はロースター一覧からは除外する
// （出場機会のほぼない選手を除き、実際にプレーした選手だけを表示するため）
const MIN_PLATE_APPEARANCES = 5;

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
      ROSTER = window.__EMBEDDED_ROSTER__ || null;
    } else {
      const res = await fetch("data/players.json");
      if (!res.ok) throw new Error("HTTP " + res.status);
      PLAYERS = await res.json();
      try {
        const rosterRes = await fetch("data/roster_numbers.json");
        if (rosterRes.ok) ROSTER = await rosterRes.json();
      } catch (e) {
        // 背番号データが無くても致命的ではないので読み込み失敗は無視する
      }
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
  return ALL_RECORDS.filter(r => {
    if (r.year !== year || r.team !== team || r.kind !== kind) return false;
    const pa = Number(r.stats["打席"]);
    if (Number.isFinite(pa) && pa <= MIN_PLATE_APPEARANCES) return false;
    return true;
  });
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

  // 背番号データは現在シーズンのみ存在する（NPB公式に過去年度のアーカイブが無いため）
  const numbers = (ROSTER && ROSTER.year === year) ? (ROSTER.teams[team] || {}) : null;

  if (numbers) {
    records.sort((a, b) => {
      const na = Number(numbers[a.name]);
      const nb = Number(numbers[b.name]);
      const aHas = Number.isFinite(na);
      const bHas = Number.isFinite(nb);
      if (aHas && bHas) return na - nb || a.level - b.level;
      if (aHas !== bHas) return aHas ? -1 : 1;
      return a.name.localeCompare(b.name, "ja") || a.level - b.level;
    });
  } else {
    records.sort((a, b) => a.name.localeCompare(b.name, "ja") || a.level - b.level);
  }

  const nameCount = new Set(records.map(r => r.name)).size;

  const kindLabel = kind === "p" ? "投手" : "野手";
  const note = kind === "b" ? `、打席${MIN_PLATE_APPEARANCES}以下は除く` : "";
  const sortNote = numbers ? "（背番号順）" : "";
  const html = `
    <div class="player-header">
      <h2>${year}年 ${escapeHtml(team)}</h2>
      <span class="teams">${kindLabel}成績（${nameCount}名${note}）${sortNote}</span>
    </div>
    ${renderTable(records, {
      identityHeader: "選手",
      identityFn: r => r.name,
      extraColumn: numbers ? { header: "背番号", fn: r => numbers[r.name] ?? "" } : null,
    })}
  `;

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
    html += renderTable(battingRecords, { identityHeader: "年度", identityFn: r => String(r.year) });
  }
  if (pitchingRecords.length) {
    html += `<div class="section-title">投手成績</div>`;
    html += renderTable(pitchingRecords, { identityHeader: "年度", identityFn: r => String(r.year) });
  }
  if (!battingRecords.length && !pitchingRecords.length) {
    html += `<div class="empty-hint">成績データがありません</div>`;
  }

  resultEl.innerHTML = html;
}

// records: 同じ統計項目（打撃 or 投手）のレコード配列。
// identityHeader/identityFn: 表の一番左の列（選手一覧なら「選手」、個人成績なら「年度」）
// extraColumn: 任意で識別列の直後に挟む追加列（背番号など）。{header, fn} の形。
function renderTable(records, { identityHeader, identityFn, extraColumn }) {
  const statCols = Object.keys(records[0].stats);

  const head = `
    <tr>
      <th class="col-identity">${escapeHtml(identityHeader)}</th>
      <th class="col-level">区分</th>
      ${extraColumn ? `<th class="col-number">${escapeHtml(extraColumn.header)}</th>` : ""}
      ${statCols.map(c => `<th>${escapeHtml(c)}</th>`).join("")}
    </tr>
  `;

  const body = records.map(r => {
    const badge = r.level === 1
      ? `<span class="level-badge">1軍</span>`
      : `<span class="level-badge">2軍</span>`;
    const cells = statCols.map(c => `<td>${escapeHtml(r.stats[c] ?? "")}</td>`).join("");
    const extraCell = extraColumn ? `<td class="col-number">${escapeHtml(extraColumn.fn(r))}</td>` : "";
    return `
      <tr class="level-${r.level}">
        <td class="col-identity">${escapeHtml(identityFn(r))}</td>
        <td class="col-level">${badge}</td>
        ${extraCell}
        ${cells}
      </tr>
    `;
  }).join("");

  return `<div class="stat-table-wrap"><table class="stat-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}
