let songsData = [];
let isGridLayout = false; // 默认单列布局
let isSortAscending = true; // 默认时间升序
let searchMode = 'title';
let searchIndex = { vocab: new Set(), latinVocab: [] };

document.addEventListener('DOMContentLoaded', () => {
    loadSongs();
    setupLibrarySearch();
    setupMatchPanel();
    setupMatchResultActions();
    setupRouting();
    setupSortToggle();
    setupLayoutToggle();
});

async function loadSongs() {
    try {
        const response = await fetch('data/songs.json');
        if (!response.ok) throw new Error('文件加载失败');
        songsData = sortByReleaseDate(await response.json(), isSortAscending);
        searchIndex = buildSearchIndex(songsData);
        renderLibrary(songsData);
    } catch (error) {
        console.error('加载数据失败:', error);
        document.getElementById('songList').innerHTML =
            `<p class="placeholder">⚠ 数据加载失败，请检查 data/songs.json 格式并使用 Live Server。</p>`;
    }
}

// 首页搜索
function setupLibrarySearch() {
    const input = document.getElementById('searchInput');
    const btn = document.getElementById('searchBtn');
    const backBtn = document.getElementById('searchBackBtn');
    const modeBtn = document.getElementById('searchModeBtn');
    const modeMenu = document.getElementById('searchModeMenu');

    const doSearch = () => {
        const kw = input.value.trim().toLowerCase();
        if (!kw) {
            renderLibrary(songsData);
            backBtn.classList.add('hidden');
            return;
        }
        const field = searchMode === 'lyricist'
            ? 'lyricist'
            : (searchMode === 'composer' ? 'composer' : 'title');
        const filtered = songsData.filter(s =>
            (s[field] || '').toLowerCase().includes(kw)
        );
        renderLibrary(filtered);
        backBtn.classList.remove('hidden');
    };

    const setMode = (mode) => {
        searchMode = mode;
        const labelMap = {
            title: '歌名',
            lyricist: '作词',
            composer: '作曲'
        };
        const placeholderMap = {
            title: '输入歌名搜索',
            lyricist: '输入作词人搜索',
            composer: '输入作曲人搜索'
        };
        modeBtn.textContent = labelMap[mode] || '歌名';
        input.placeholder = placeholderMap[mode] || '输入歌名搜索';
        modeMenu.classList.add('hidden');
        if (input.value.trim()) doSearch();
    };
    btn.addEventListener('click', doSearch);
    input.addEventListener('keypress', e => e.key === 'Enter' && doSearch());
    input.addEventListener('input', () => {
        if (!input.value.trim()) {
            renderLibrary(songsData);
            backBtn.classList.add('hidden');
        }
    });
    backBtn.addEventListener('click', () => {
        input.value = '';
        renderLibrary(songsData);
        backBtn.classList.add('hidden');
    });
    input.addEventListener('focus', () => modeMenu.classList.remove('hidden'));
    modeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        modeMenu.classList.toggle('hidden');
    });
    modeMenu.addEventListener('click', (e) => {
        const btnEl = e.target.closest('button[data-mode]');
        if (!btnEl) return;
        setMode(btnEl.dataset.mode);
    });
    document.addEventListener('click', (e) => {
        if (!modeMenu.contains(e.target) && e.target !== input && e.target !== modeBtn) {
            modeMenu.classList.add('hidden');
        }
    });
}

// 状态匹配面板
function setupMatchPanel() {
    const openBtn = document.getElementById('openMatchBtn');
    const closeBtn = document.getElementById('closeMatchBtn');
    const matchBtn = document.getElementById('matchBtn');
    const panel = document.getElementById('matchPanel');
    const input = document.getElementById('matchInput');
    const resultBox = document.getElementById('matchResult');

    openBtn.addEventListener('click', () => {
        hideAllViews();
        panel.classList.remove('hidden');
        setHeaderEchoMode(true);
        input.focus();
    });
    closeBtn.addEventListener('click', () => {
        panel.classList.add('hidden');
        showView('libraryView');
        resultBox.innerHTML = '';
    });
    matchBtn.addEventListener('click', () => {
        const text = input.value.trim();
        if (!text) {
            resultBox.innerHTML = '<p class="placeholder">请先输入描述</p>';
            return;
        }
        showMatchResult(text);
    });
}

function setupMatchResultActions() {
    const backToMatchBtn = document.getElementById('backToMatchBtn');
    const backToLibraryBtn = document.getElementById('backToLibraryBtn');
    const nextEchoBtn = document.getElementById('nextEchoBtn');
    const matchInput = document.getElementById('matchInput');

    backToMatchBtn.addEventListener('click', () => {
        hideAllViews();
        document.getElementById('matchPanel').classList.remove('hidden');
        setHeaderEchoMode(true);
        matchInput.focus();
    });

    backToLibraryBtn.addEventListener('click', () => {
        showView('libraryView');
    });

    nextEchoBtn.addEventListener('click', () => {
        showMatchResult(matchInput.value.trim());
    });
}

function showMatchResult(text) {
    const resultView = document.getElementById('matchResultView');
    const resultBox = document.getElementById('matchEchoResult');
    const matched = matchByState(text);

    hideAllViews();
    resultView.classList.remove('hidden');
    setHeaderEchoMode(true);

    if (matched.length === 0) {
        resultBox.innerHTML = '<div class="echo-empty">暂时未能发现回响</div>';
        return;
    }

    const topMatch = matched[0];
    const lyric = topMatch.matchLine || '暂时未能发现回响';
    resultBox.innerHTML = `
        <div class="echo-result-stack">
            <div class="echo-lyric">${escapeHtml(lyric)}</div>
            <div class="echo-title">${escapeHtml(topMatch.song.meta?.title || '')}</div>
        </div>
    `;
}

function matchByState(input) {
    const keywords = prepareSearchTokens(input);
    if (keywords.length === 0) return [];
    const scored = songsData.map(song => {
        const lyricResult = getBestLyricLine(song.meta?.lyrics, keywords);
        const description = (song.credits?.official_description || '').toLowerCase();
        const title = (song.meta?.title || '').toLowerCase();
        let descHits = 0;
        keywords.forEach(word => {
            const w = word.toLowerCase();
            if (description.includes(w) || title.includes(w)) descHits += 1;
        });
        const lyricScore = lyricResult.score;
        const descScore = keywords.length ? descHits / keywords.length : 0;
        const score = lyricScore * 0.7 + descScore * 0.3;
        return { song, score, matchLine: lyricResult.line };
    });
    return scored
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score);
}

function getBestLyricLine(lyricsText, keywords) {
    const lines = (lyricsText || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    if (lines.length === 0) return { line: '', score: 0 };

    let bestLine = '';
    let bestScore = 0;
    lines.forEach(line => {
        const lowerLine = line.toLowerCase();
        let hits = 0;
        keywords.forEach(word => {
            const w = word.toLowerCase();
            if (lowerLine.includes(w)) hits += 1;
        });
        const lineScore = keywords.length ? hits / keywords.length : 0;
        if (lineScore > bestScore) {
            bestScore = lineScore;
            bestLine = line;
        }
    });

    return { line: bestLine || lines[0], score: bestScore };
}

function prepareSearchTokens(input) {
    const rawTokens = tokenize(input);
    if (rawTokens.length === 0) return [];
    const corrected = rawTokens.map(token => correctToken(token, searchIndex.latinVocab));
    const expanded = expandTokens(corrected);
    return Array.from(new Set(expanded));
}

function tokenize(text) {
    const tokens = [];
    const normalized = (text || '').toLowerCase();
    const latinMatches = normalized.match(/[a-z0-9]+/g) || [];
    tokens.push(...latinMatches);

    const cjkMatches = normalized.match(/[\u4e00-\u9fff]+/g) || [];
    cjkMatches.forEach(chunk => {
        const chars = Array.from(chunk);
        chars.forEach(char => tokens.push(char));
        for (let i = 0; i < chars.length - 1; i += 1) {
            tokens.push(chars[i] + chars[i + 1]);
        }
    });

    return tokens.filter(t => t.length > 0);
}

function buildSearchIndex(list) {
    const vocab = new Set();
    list.forEach(song => {
        const fields = [
            song.meta?.title,
            song.credits?.official_description,
            song.meta?.lyrics
        ]
            .filter(Boolean)
            .join(' ');
        tokenize(fields).forEach(token => vocab.add(token));
    });
    const latinVocab = Array.from(vocab).filter(token => /^[a-z0-9]+$/.test(token));
    return { vocab, latinVocab };
}

function correctToken(token, latinVocab) {
    if (!/^[a-z0-9]+$/.test(token) || token.length < 4) return token;
    let best = token;
    let bestDist = 2;
    latinVocab.forEach(candidate => {
        if (Math.abs(candidate.length - token.length) > 2) return;
        const dist = levenshtein(token, candidate, bestDist);
        if (dist <= bestDist) {
            bestDist = dist;
            best = candidate;
        }
    });
    return best;
}

function levenshtein(a, b, maxDist) {
    if (a === b) return 0;
    const aLen = a.length;
    const bLen = b.length;
    if (Math.abs(aLen - bLen) > maxDist) return maxDist + 1;
    const prev = new Array(bLen + 1).fill(0).map((_, i) => i);
    const curr = new Array(bLen + 1).fill(0);
    for (let i = 1; i <= aLen; i += 1) {
        curr[0] = i;
        let rowBest = curr[0];
        for (let j = 1; j <= bLen; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(
                prev[j] + 1,
                curr[j - 1] + 1,
                prev[j - 1] + cost
            );
            if (curr[j] < rowBest) rowBest = curr[j];
        }
        if (rowBest > maxDist) return maxDist + 1;
        for (let j = 0; j <= bLen; j += 1) prev[j] = curr[j];
    }
    return prev[bLen];
}

function expandTokens(tokens) {
    const expanded = [];
    const synonymMap = {
        难过: ['伤心', '低落', '悲伤', '心痛'],
        伤心: ['难过', '低落', '悲伤'],
        开心: ['快乐', '愉快', '高兴', '甜蜜'],
        快乐: ['开心', '愉快', '高兴'],
        失眠: ['睡不着', '睡不着觉', '睡不好'],
        平静: ['安静', '安宁', '舒缓', '治愈'],
        孤独: ['寂寞', '落寞', '孤单'],
        温暖: ['治愈', '安心', '柔软'],
        治愈: ['温暖', '安心', '平静'],
        紧张: ['焦虑', '压力', '不安'],
        sad: ['sad', 'down', 'blue'],
        happy: ['happy', 'joy', 'glad']
    };
    const emotionMap = {
        焦虑: ['紧张', '不安', '压力', '疲惫'],
        压力: ['焦虑', '紧张', '疲惫'],
        失望: ['难过', '低落', '伤心'],
        甜蜜: ['温暖', '幸福', '快乐'],
        怀念: ['思念', '回忆', '想念'],
        孤独: ['寂寞', '落寞', '空虚']
    };

    tokens.forEach(token => {
        expanded.push(token);
        (synonymMap[token] || []).forEach(w => expanded.push(w));
        (emotionMap[token] || []).forEach(w => expanded.push(w));
    });
    return expanded;
}

// 核心路由控制（Hash 路由）
function setupRouting() {
    const handleHash = () => {
        const hash = window.location.hash;
        if (hash.startsWith('#detail-')) {
            const id = parseInt(hash.replace('#detail-', ''), 10);
            const song = songsData.find(s => s.id === id);
            if (song) showDetailView(song);
            else window.location.hash = '';
        } else {
            showView('libraryView');
        }
    };
    window.addEventListener('hashchange', handleHash);
    document.getElementById('backBtn').addEventListener('click', () => {
        window.location.hash = '';
    });
    handleHash(); // 初始加载检查
}

function hideAllViews() {
    ['libraryView', 'detailView', 'matchPanel', 'matchResultView'].forEach(id =>
        document.getElementById(id).classList.add('hidden'));
}
function showView(id) {
    hideAllViews();
    document.getElementById(id).classList.remove('hidden');
    setHeaderEchoMode(id === 'matchPanel' || id === 'matchResultView');
}

function setHeaderEchoMode(isEcho) {
    document.body.classList.toggle('echo-mode', Boolean(isEcho));
}

function showDetailView(song) {
    hideAllViews();
    document.getElementById('detailView').classList.remove('hidden');

    const releaseLine = song.meta?.release_date
        ? `<div class="detail-release">${escapeHtml(formatReleaseDate(song.meta.release_date))}</div>`
        : '';

    const originalSinger = (song.credits?.original_singer || '').trim();
    const album = (song.meta?.album || '').trim();
    const originAlbumLine = originalSinger
        ? `<div class="detail-line">原唱：${escapeHtml(originalSinger)}${album ? ` / 专辑：${escapeHtml(album)}` : ''}</div>`
        : (album ? `<div class="detail-line">专辑：${escapeHtml(album)}</div>` : '');

    const credits = [
        `作词：${escapeHtml(song.credits?.lyricist || '未知')}`,
        `作曲：${escapeHtml(song.credits?.composer || '未知')}`,
        `制作人：${escapeHtml(song.credits?.producer || '未知')}`,
        `编曲：${escapeHtml(song.credits?.arranger || '未知')}`
    ].map(text => `<span>${text}</span>`).join('');

    document.getElementById('detailContent').innerHTML = `
        <div class="detail-header">
            <div class="detail-title-row">
                <div class="detail-title">${escapeHtml(song.meta?.title || '')}</div>
                ${song.meta?.highlight_sentence ? `<div class="detail-keysentence">${escapeHtml(song.meta.highlight_sentence)}</div>` : ''}
            </div>
            ${releaseLine}
            ${originAlbumLine}
            <div class="detail-credits">${credits}</div>
        </div>
        <div class="detail-lyrics">
            <h3>歌词</h3>
            <div class="lyrics-box">${escapeHtml(song.meta?.lyrics || '暂无歌词')}</div>
        </div>
    `;
}

// 渲染与组件
function renderLibrary(songs) {
    const container = document.getElementById('songList');
    container.innerHTML = songs.length === 0
        ? `<p class="placeholder">暂无记录</p>`
        : songs.map(s => createSongCard(s)).join('');
    updateLayout();
}

function createSongCard(song) {
    const releaseText = song.meta?.release_date ? formatReleaseDate(song.meta.release_date) : '未知日期';

    return `
        <article class="song-item" onclick="window.location.hash='#detail-${song.id}'">
            <div class="song-header">
                <div class="song-title">${escapeHtml(song.meta?.title || '')}</div>
                <div class="song-date">${escapeHtml(releaseText)}</div>
            </div>
            <div class="song-keysentence">${escapeHtml(song.meta?.highlight_sentence || '')}</div>
        </article>
    `;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function sortByReleaseDate(list, ascending = isSortAscending) {
    return [...list].sort((a, b) =>
        (parseReleaseDate(a.meta?.release_date) - parseReleaseDate(b.meta?.release_date))
        * (ascending ? 1 : -1));
}

function setupSortToggle() {
    const sortBtn = document.getElementById('sortToggleBtn');
    if (!sortBtn) return;
    const updateLabel = () => {
        sortBtn.textContent = isSortAscending ? '时间降序' : '时间升序';
    };
    updateLabel();
    sortBtn.addEventListener('click', () => {
        isSortAscending = !isSortAscending;
        songsData = sortByReleaseDate(songsData, isSortAscending);
        renderLibrary(songsData);
        updateLabel();
    });
}

function parseReleaseDate(dateStr) {
    const ts = Date.parse(dateStr || '');
    return Number.isNaN(ts) ? 0 : ts;
}

function formatReleaseDate(dateStr) {
    return dateStr || '未知日期';
}

// 布局切换功能
function setupLayoutToggle() {
    const toggleBtn = document.getElementById('layoutToggleBtn');
    toggleBtn.addEventListener('click', () => {
        isGridLayout = !isGridLayout;
        updateLayout();
    });
}

function updateLayout() {
    const songList = document.getElementById('songList');
    const matchResultGrid = document.querySelector('#matchResult .song-grid');
    const toggleBtn = document.getElementById('layoutToggleBtn');

    if (isGridLayout) {
        songList.classList.add('grid-layout');
        if (matchResultGrid) matchResultGrid.classList.add('grid-layout');
        toggleBtn.textContent = '列表布局';
    } else {
        songList.classList.remove('grid-layout');
        if (matchResultGrid) matchResultGrid.classList.remove('grid-layout');
        toggleBtn.textContent = '网格布局';
    }
}