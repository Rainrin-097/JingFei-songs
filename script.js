let songsData = [];

document.addEventListener('DOMContentLoaded', () => {
    loadSongs();
    setupLibrarySearch();
    setupMatchPanel();
    setupRouting(); // 启动路由监听
});

async function loadSongs() {
    try {
        const response = await fetch('data/songs.json');
        if (!response.ok) throw new Error('文件加载失败');
        songsData = await response.json();
        renderLibrary(songsData);
    } catch (error) {
        console.error('加载数据失败:', error);
        document.getElementById('songList').innerHTML =
            `<p class="placeholder">⚠️ 数据加载失败，请检查 data/songs.json 格式并使用 Live Server。</p>`;
    }
}

// 🔹 首页搜索
function setupLibrarySearch() {
    const input = document.getElementById('searchInput');
    const btn = document.getElementById('searchBtn');
    const doSearch = () => {
        const kw = input.value.trim().toLowerCase();
        if (!kw) { renderLibrary(songsData); return; }
        const filtered = songsData.filter(s =>
            (s.title || '').toLowerCase().includes(kw) ||
            (s.lyricist || '').toLowerCase().includes(kw) ||
            (s.composer || '').toLowerCase().includes(kw) ||
            (s.genre || '').toLowerCase().includes(kw)
        );
        renderLibrary(filtered);
    };
    btn.addEventListener('click', doSearch);
    input.addEventListener('keypress', e => e.key === 'Enter' && doSearch());
}

// 🔹 状态匹配面板
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

// 🔹 核心路由控制（Hash 路由）
function setupRouting() {
    const handleHash = () => {
        const hash = window.location.hash;
        if (hash.startsWith('#detail-')) {
            const id = parseInt(hash.replace('#detail-', ''), 10);
            const song = songsData.find(s => s.id === id);
            if (song) showDetailView(song);
            else window.location.hash = '';
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

    const tags = [...(song.emotion_tags || []), ...(song.themes || []), ...(song.applicable_scenarios || [])]
        .map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');

    const metaHtml = `
        <span>🎤 ${escapeHtml(song.artist || '未知')}</span>
        <span>🖋️ 作词：${escapeHtml(song.lyricist || '未知')}</span>
        <span>🎵 作曲：${escapeHtml(song.composer || '未知')}</span>
        <span>🎛️ 编曲：${escapeHtml(song.arranger || '未知')}</span>
        <span>📁 风格：${escapeHtml(song.genre || '未分类')}</span>
    `;

    document.getElementById('detailContent').innerHTML = `
        <div class="detail-header">
            <div class="detail-title">${escapeHtml(song.title)}</div>
            <div class="detail-meta-grid">${metaHtml}</div>
            ${tags ? `<div class="detail-tags">${tags}</div>` : ''}
        </div>
        ${song.description ? `<div class="detail-desc">${escapeHtml(song.description)}</div>` : ''}
        <div class="detail-lyrics">
            <h3>📜 歌词</h3>
            <div class="lyrics-box">${escapeHtml(song.lyrics || '暂无歌词')}</div>
        </div>
    `;
}

// 🔹 渲染与组件
function renderLibrary(songs) {
    const container = document.getElementById('songList');
    container.innerHTML = songs.length === 0
        ? `<p class="placeholder">暂无记录</p>`
        : songs.map(s => createSongCard(s)).join('');
}

function createSongCard(song) {
    const tags = [...(song.emotion_tags || []), ...(song.themes || []), ...(song.applicable_scenarios || [])]
        .map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');

    return `
        <article class="song-item" onclick="window.location.hash='#detail-${song.id}'">
            <div class="song-title">${escapeHtml(song.title)}</div>
            <div class="song-meta">
                🎤 ${escapeHtml(song.artist || '未知')} | 🖋️ ${escapeHtml(song.lyricist || '未知')} | 🎵 ${escapeHtml(song.composer || '未知')}
            </div>
            ${tags ? `<div style="margin-top:6px">${tags}</div>` : ''}
        </article>
    `;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}