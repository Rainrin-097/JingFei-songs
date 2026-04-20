let songsData = [];
let isGridLayout = false; // 默认单列布局
let searchMode = 'title';

document.addEventListener('DOMContentLoaded', () => {
    loadSongs();
    setupLibrarySearch();
    setupMatchPanel();
    setupRouting();
    setupLayoutToggle();
});

async function loadSongs() {
    try {
        const response = await fetch('data/songs.json');
        if (!response.ok) throw new Error('文件加载失败');
        songsData = sortByReleaseDate(await response.json());
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
    const modeBtn = document.getElementById('searchModeBtn');
    const modeMenu = document.getElementById('searchModeMenu');

    const doSearch = () => {
        const kw = input.value.trim().toLowerCase();
        if (!kw) { renderLibrary(songsData); return; }
        const field = searchMode === 'lyricist'
            ? 'lyricist'
            : (searchMode === 'composer' ? 'composer' : 'title');
        const filtered = songsData.filter(s =>
            (s[field] || '').toLowerCase().includes(kw)
        );
        renderLibrary(filtered);
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
        hideAllViews(); panel.classList.remove('hidden'); input.focus();
    });
    closeBtn.addEventListener('click', () => {
        panel.classList.add('hidden'); showView('libraryView'); resultBox.innerHTML = '';
    });
    matchBtn.addEventListener('click', () => {
        const text = input.value.trim();
        if (!text) { resultBox.innerHTML = '<p class="placeholder">请先输入描述</p>'; return; }
        const matched = matchByState(text);
        resultBox.innerHTML = `
            <p style="margin-bottom:12px; color:var(--text-sub); font-size:0.9rem;">
              基于“${escapeHtml(text)}”匹配到 ${matched.length} 首推荐：
            </p>
            <div class="song-grid">${matched.map(s => createSongCard(s)).join('')}</div>
        `;
    });
}

function matchByState(input) {
    const keywords = input.split(/[\s,，.。!！?？、;；]+/).filter(k => k.length > 1);
    if (keywords.length === 0) return [];
    const scored = songsData.map(song => {
        let score = 0;
        const tags = [
            ...(song.emotion_tags || []),
            ...(song.themes || []),
            ...(song.applicable_scenarios || [])
        ].map(t => t.toLowerCase());
        keywords.forEach(word => {
            const w = word.toLowerCase();
            if (tags.some(t => t.includes(w))) score += 2;
            if ((song.lyrics || '').toLowerCase().includes(w)) score += 0.5;
        });
        return { song, score };
    });
    return scored.filter(item => item.score > 0).sort((a, b) => b.score - a.score).map(item => item.song);
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
    ['libraryView', 'detailView', 'matchPanel'].forEach(id =>
        document.getElementById(id).classList.add('hidden'));
}
function showView(id) {
    hideAllViews();
    document.getElementById(id).classList.remove('hidden');
}

function showDetailView(song) {
    hideAllViews();
    document.getElementById('detailView').classList.remove('hidden');

    const releaseLine = song.release_date
        ? `<div class="detail-release">${escapeHtml(formatReleaseDate(song.release_date))}</div>`
        : '';

    const originalSinger = (song.original_singer || '').trim();
    const album = (song.album || '').trim();
    const originAlbumLine = originalSinger
        ? `<div class="detail-line">原唱：${escapeHtml(originalSinger)}${album ? ` / 专辑：${escapeHtml(album)}` : ''}</div>`
        : (album ? `<div class="detail-line">专辑：${escapeHtml(album)}</div>` : '');

    const credits = [
        `作词：${escapeHtml(song.lyricist || '未知')}`,
        `作曲：${escapeHtml(song.composer || '未知')}`,
        `制作人：${escapeHtml(song.producer || '未知')}`,
        `编曲：${escapeHtml(song.arranger || '未知')}`
    ].map(text => `<span>${text}</span>`).join('');

    document.getElementById('detailContent').innerHTML = `
        <div class="detail-header">
            <div class="detail-title-row">
                <div class="detail-title">${escapeHtml(song.title)}</div>
                ${song.keysentence ? `<div class="detail-keysentence">${escapeHtml(song.keysentence)}</div>` : ''}
            </div>
            ${releaseLine}
            ${originAlbumLine}
            <div class="detail-credits">${credits}</div>
        </div>
        <div class="detail-lyrics">
            <h3>歌词</h3>
            <div class="lyrics-box">${escapeHtml(song.lyrics || '暂无歌词')}</div>
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
    const releaseText = song.release_date ? formatReleaseDate(song.release_date) : '未知日期';

    return `
        <article class="song-item" onclick="window.location.hash='#detail-${song.id}'">
            <div class="song-header">
                <div class="song-title">${escapeHtml(song.title)}</div>
                <div class="song-date">${escapeHtml(releaseText)}</div>
            </div>
            <div class="song-keysentence">${escapeHtml(song.keysentence || '')}</div>
        </article>
    `;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function sortByReleaseDate(list) {
    return [...list].sort((a, b) => parseReleaseDate(b.release_date) - parseReleaseDate(a.release_date));
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