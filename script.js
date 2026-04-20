// 全局变量：存储歌曲数据（类似 C 语言的全局结构体数组）
let songsData = [];

// 页面加载完成后自动执行
document.addEventListener('DOMContentLoaded', () => {
    loadSongs();
    setupSearch();
});

// 1. 加载 JSON 数据
async function loadSongs() {
    try {
        // 类比 C: FILE *fp = fopen("data/songs.json", "r");
        const response = await fetch('data/songs.json');
        if (!response.ok) throw new Error('网络或文件加载失败');

        // 类比 C: fread + 手动解析 JSON -> 浏览器内置解析器直接转为 JS 对象数组
        songsData = await response.json();
        console.log(`✅ 成功加载 ${songsData.length} 首歌曲`);
    } catch (error) {
        console.error('加载数据失败:', error);
        document.getElementById('songList').innerHTML =
            `<p class="placeholder" style="color: var(--primary);">⚠️ 数据加载失败，请确保使用 Live Server 打开页面，并检查 data/songs.json 格式。</p>`;
    }
}

// 2. 绑定搜索事件
function setupSearch() {
    const searchBtn = document.getElementById('searchBtn');
    const searchInput = document.getElementById('searchInput');

    searchBtn.addEventListener('click', () => {
        performSearch(searchInput.value.trim());
    });

    // 支持回车键直接搜索
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch(searchInput.value.trim());
    });
}

// 3. 核心搜索逻辑（匹配作词人、歌词、风格）
function performSearch(keyword) {
    const resultContainer = document.getElementById('songList');

    if (!keyword) {
        resultContainer.innerHTML = '<p class="placeholder">请输入关键词后点击搜索</p>';
        return;
    }

    const lowerKeyword = keyword.toLowerCase();

    // 过滤逻辑：类似 C 的 for 循环 + strstr/strcmp
    const matchedSongs = songsData.filter(song => {
        return (
            (song.lyricist && song.lyricist.toLowerCase().includes(lowerKeyword)) ||
            (song.lyrics && song.lyrics.toLowerCase().includes(lowerKeyword)) ||
            (song.genre && song.genre.toLowerCase().includes(lowerKeyword))
        );
    });

    renderResults(matchedSongs, keyword);
}

// 4. 渲染结果到页面
function renderResults(songs, keyword) {
    const container = document.getElementById('songList');

    if (songs.length === 0) {
        container.innerHTML = `<p class="placeholder">未找到与“${keyword}”相关的歌曲，请尝试其他关键词。</p>`;
        return;
    }

    let html = '';
    songs.forEach(song => {
        // 拼接标签（为后续“情绪/场景匹配”预留）
        const tags = [
            ...(song.emotion_tags || []),
            ...(song.themes || []),
            ...(song.applicable_scenarios || [])
        ].map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');

        html += `
            <article class="song-item">
                <div class="song-title">${escapeHtml(song.title)}</div>
                <div class="song-meta">
                    演唱：${escapeHtml(song.artist || '未知')} | 作词：${escapeHtml(song.lyricist || '未知')} 
                    | 作曲：${escapeHtml(song.composer || '未知')} | 风格：${escapeHtml(song.genre || '未分类')}
                </div>
                ${tags ? `<div style="margin-bottom: 8px;">${tags}</div>` : ''}
                <div class="song-meta" style="margin-top: 6px; font-style: italic; border-left: 3px solid var(--primary); padding-left: 10px;">
                    ${escapeHtml(song.description || '暂无简介')}
                </div>
            </article>
        `;
    });

    container.innerHTML = html;
}

// 5. 防 XSS 攻击的简单转义（Web 安全基础习惯）
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}