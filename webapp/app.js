let PLAYERS = null;
let NAMES = [];

const searchInput = document.getElementById("search-input");
const suggestionsEl = document.getElementById("suggestions");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");

let activeIndex = -1;
let currentMatches = [];

init();

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
    statusEl.textContent = `${NAMES.length}名の選手データを読み込みました。選手名を入力してください。`;
  } catch (e) {
    statusEl.textContent = "データの読み込みに失敗しました（data/players.json が見つかりません）。scraper/build_players.py を実行してから、webapp フォルダをローカルサーバーで開いてください。";
    console.error(e);
  }
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

  const head = `
    <tr>
      <th>年度</th>
      <th>区分</th>
      <th>球団</th>
      ${statCols.map(c => `<th>${escapeHtml(c)}</th>`).join("")}
    </tr>
  `;

  const body = records.map(r => {
    const badge = r.level === 1
      ? `<span class="level-badge">1軍</span>`
      : `<span class="level-badge">2軍</span>`;
    const cells = statCols.map(c => `<td>${escapeHtml(r.stats[c] ?? "")}</td>`).join("");
    return `
      <tr class="level-${r.level}">
        <td>${r.year}</td>
        <td>${badge}</td>
        <td>${escapeHtml(r.team)}</td>
        ${cells}
      </tr>
    `;
  }).join("");

  return `<div class="table-wrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}
