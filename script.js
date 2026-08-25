let songsData = [];
let albumsData = [];
let isGridLayout = false; // 默认单列布局
let isSortAscending = true; // 默认时间升序
let searchMode = 'title';
let searchIndex = { vocab: new Set(), latinVocab: [] };
let detailReturnTarget = 'library';
let infoData = null;
let footprintData = null;
let footprintAnimating = false;
let currentMatchedSongId = null;
let currentDetailSongId = null;
let currentDetailLyricsRaw = '';
let currentDetailLyricsScript = 'trad';
let pendingCenterSongId = null;
let heroSlideTimer = null;
const MATCH_API_ENDPOINT = '/api/match';
const ENABLE_AI_MATCH = true;// 控制ai调用
const ELSEWHERE_GUIDE_SHOWN_KEY = 'jingfei_elsewhere_guide_shown';
let echoSession = {
    input: '',
    candidates: [],
    shownIds: [],
    currentItem: null,
    reEchoCount: 0
};

document.addEventListener('DOMContentLoaded', () => {
    setupSplash();
    setupEditorialHero();
    setupScrollState();
    loadSongs();
    loadAlbums();
    loadInfo();
    loadFootprint();
    setupNavigation();
    setupLibrarySearch();
    setupMatchPanel();
    setupMatchResultActions();
    setupRouting();
    setupSortToggle();
    setupLayoutToggle();
    setupAlbumViews();
    setupInfoView();
    setupFootprintView();
    setupBackToTopButton();
    window.addEventListener('resize', () => {
        if (!document.getElementById('detailView')?.classList.contains('hidden')) {
            syncDetailSidebarHeight();
        }
    });
});

function setupScrollState() {
    const onScroll = () => {
        document.body.classList.toggle('site-scrolled', window.scrollY > 18);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
}

function setupEditorialHero() {
    const heroImage = document.getElementById('heroImage');
    const heroImageNext = document.getElementById('heroImageNext');
    const heroTitle = document.getElementById('heroTitle');
    const heroSubtitle = document.getElementById('heroSubtitle');
    const heroAlbumName = document.getElementById('heroAlbumName');
    const heroArtistName = document.getElementById('heroArtistName');
    const heroSongCount = document.getElementById('heroSongCount');
    if (!heroImage || !heroImageNext || !heroTitle || !heroSubtitle || !heroAlbumName || !heroArtistName || !heroSongCount) return;

    // 首页轮播图片：动态从 image/封面/ 文件夹加载
    // 下方为 fallback，加载失败时使用（生产环境 Cloudflare Workers 不支持目录列表，会走此分支）
    const FALLBACK_COVERS = [
        'image/封面/1.jpg',
        'image/封面/2.jpg',
        'image/封面/3.jpg',
        'image/封面/4.jpg',
        'image/封面/5.jpg',
        'image/封面/6.jpg',
        'image/封面/7.jpg',
        'image/封面/8.jpg',
        'image/封面/9.jpg',
        'image/封面/10.jpg',
        'image/封面/11.jpg'
    ];
    let coverQueue = FALLBACK_COVERS.slice();

    // 动态加载封面图：fetch 目录列表，解析 HTML 得到图片文件名
    const loadCoverQueue = async () => {
        try {
            const dirUrl = 'image/封面/';
            const res = await fetch(dirUrl);
            if (!res.ok) throw new Error(`目录列表请求失败: ${res.status}`);
            const html = await res.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const links = Array.from(doc.querySelectorAll('a'));
            // 目录列表的 href 可能是纯文件名（1.jpg）也可能是相对/绝对路径（image/封面/1.jpg）
            // 统一只取最后一段作为文件名，再拼接 dirUrl，避免路径重复
            const files = links
                .map(a => a.getAttribute('href'))
                .filter(href => href && !href.endsWith('/') && !href.startsWith('?'))
                .filter(href => /\.(jpe?g|png|webp|gif)$/i.test(href))
                .map(href => decodeURIComponent(href.split('/').pop().split('\\').pop()))
                .filter(name => name && !name.includes('/'));
            if (files.length === 0) throw new Error('目录中未找到图片');
            // 按文件名中的数字自然排序（1.jpg, 2.jpg ... 10.jpg, 11.jpg）
            files.sort((a, b) => {
                const na = parseInt(String(a).replace(/\D/g, ''), 10) || 0;
                const nb = parseInt(String(b).replace(/\D/g, ''), 10) || 0;
                return na - nb;
            });
            return files.map(name => `image/封面/${name}`);
        } catch (err) {
            console.warn('动态加载封面失败，使用 fallback 列表:', err);
            return FALLBACK_COVERS.slice();
        }
    };

    let coverIndex = 0;
    let sliding = false;

    const setHeroCopy = () => {
        heroTitle.textContent = "JingFei's Songs";
        heroSubtitle.textContent = 'A quiet archive of songs and traces.';
        heroAlbumName.textContent = 'Archive';
        heroArtistName.textContent = '陈婧霏';
        heroSongCount.textContent = `${coverQueue.length} covers`;
    };

    const normalizeIndex = (index) => index % coverQueue.length;

    const setInitialHero = () => {
        const firstCover = coverQueue[0];
        heroImage.src = firstCover;
        heroImage.alt = 'JingFei cover slide';
        heroImage.classList.remove('is-leaving');
        heroImageNext.classList.remove('is-entering');
        heroImageNext.src = firstCover;
        setHeroCopy();
    };

    const slideToIndex = (targetIndex, direction = 'next') => {
        if (sliding) return;
        sliding = true;

        const nextCover = coverQueue[normalizeIndex(targetIndex)] || coverQueue[0];
        heroImageNext.src = nextCover;
        heroImageNext.alt = 'JingFei cover slide';

        // 根据方向选择滑动类
        const leavingClass = direction === 'prev' ? 'is-leaving-right' : 'is-leaving';
        const enteringClass = direction === 'prev' ? 'is-entering-right' : 'is-entering';

        heroImage.classList.remove('is-leaving', 'is-leaving-right');
        heroImageNext.classList.remove('is-entering', 'is-entering-right');
        // 反向切换时让下一张图从左侧进入
        heroImageNext.classList.toggle('prev-mode', direction === 'prev');
        void heroImage.offsetWidth;

        heroImage.classList.add(leavingClass);
        heroImageNext.classList.add(enteringClass);

        const completeSlide = () => {
            heroImage.src = nextCover;
            heroImage.classList.remove('is-leaving', 'is-leaving-right');
            heroImageNext.classList.remove('is-entering', 'is-entering-right');
            heroImageNext.classList.remove('prev-mode');
            setHeroCopy();
            sliding = false;
        };

        heroImageNext.addEventListener('transitionend', completeSlide, { once: true });
        window.setTimeout(() => {
            if (sliding) completeSlide();
        }, 900);
    };

    setInitialHero();
    // 异步加载真实封面列表，成功后替换并重置到第一张
    loadCoverQueue().then(covers => {
        coverQueue = covers;
        coverIndex = 0;
        setInitialHero();
    });

    // 自动轮播：鼠标悬停时暂停，移开恢复
    const startAutoSlide = () => {
        if (heroSlideTimer) window.clearInterval(heroSlideTimer);
        heroSlideTimer = window.setInterval(() => {
            coverIndex += 1;
            slideToIndex(coverIndex);
        }, 4200);
    };
    const stopAutoSlide = () => {
        if (heroSlideTimer) {
            window.clearInterval(heroSlideTimer);
            heroSlideTimer = null;
        }
    };
    startAutoSlide();

    // 手动切换：点击左右箭头
    const heroImageFrame = heroImage.parentElement;
    if (heroImageFrame) {
        heroImageFrame.addEventListener('click', (event) => {
            const zone = event.target.closest('.hero-nav-zone');
            if (!zone) return;
            const dir = zone.getAttribute('data-dir');
            if (dir === 'prev') {
                coverIndex -= 1;
            } else if (dir === 'next') {
                coverIndex += 1;
            } else {
                return;
            }
            // 处理负数索引，保证循环
            if (coverIndex < 0) coverIndex += coverQueue.length;
            slideToIndex(coverIndex, dir);
            // 手动切换后重启定时器，避免立刻又被自动切换
            stopAutoSlide();
            startAutoSlide();
        });
        // 鼠标进入图片区域暂停轮播
        heroImageFrame.addEventListener('mouseenter', stopAutoSlide);
        heroImageFrame.addEventListener('mouseleave', startAutoSlide);
    }
}

function clearSearchState() {
    const input = document.getElementById('searchInput');
    const backBtn = document.getElementById('searchBackBtn');
    const modeMenu = document.getElementById('searchModeMenu');
    if (input) input.value = '';
    if (backBtn) backBtn.classList.add('hidden');
    if (modeMenu) modeMenu.classList.add('hidden');
}

function setupNavigation() {
    const navHome = document.getElementById('navHome');
    const navAlbum = document.getElementById('navAlbum');
    const navEcho = document.getElementById('navEcho');
    const navInfo = document.getElementById('navInfo');
    const navFootprint = document.getElementById('navFootprint');

    if (navHome) {
        navHome.addEventListener('click', (event) => {
            event.preventDefault();
            clearSearchState();
            detailReturnTarget = 'library';
            window.location.hash = '';
            showView('libraryView');
        });
    }

    if (navAlbum) {
        navAlbum.addEventListener('click', (event) => {
            event.preventDefault();
            clearSearchState();
            detailReturnTarget = 'albumList';
            window.location.hash = '#album';
        });
    }

    if (navEcho) {
        navEcho.addEventListener('click', (event) => {
            event.preventDefault();
            clearSearchState();
            hideAllViews();
            document.getElementById('matchPanel').classList.remove('hidden');
            setHeaderEchoMode(true);
            document.body.classList.remove('on-home');
            document.getElementById('matchInput').focus();
        });
    }

    if (navInfo) {
        navInfo.addEventListener('click', (event) => {
            event.preventDefault();
            clearSearchState();
            window.location.hash = '#info';
        });
    }

    if (navFootprint) {
        navFootprint.addEventListener('click', (event) => {
            event.preventDefault();
            clearSearchState();
            window.location.hash = '#footprint';
        });
    }
}

function setupAlbumViews() {
    const backBtn = document.getElementById('backToAlbumBtn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            window.location.hash = '#album';
        });
    }
}

function setupSearchResultsView() {
    const backBtn = document.getElementById('backToSearchLibraryBtn');
    if (!backBtn) return;
    backBtn.addEventListener('click', () => {
        const input = document.getElementById('searchInput');
        const searchBackBtn = document.getElementById('searchBackBtn');
        if (input) input.value = '';
        if (searchBackBtn) searchBackBtn.classList.add('hidden');
        showView('libraryView');
    });
}

function setupSplash() {
    const splash = document.getElementById('splashScreen');
    if (!splash) return;
    document.body.classList.add('splash-active');

    const closeSplash = () => {
        splash.classList.add('exit');
        window.setTimeout(() => {
            splash.classList.add('hidden');
            document.body.classList.remove('splash-active');
            if (!window.localStorage.getItem(ELSEWHERE_GUIDE_SHOWN_KEY)) {
                try { showElsewhereGuideModal(); } catch (e) { /* ignore if not ready */ }
                window.localStorage.setItem(ELSEWHERE_GUIDE_SHOWN_KEY, '1');
            }
        }, 920);
    };

    splash.addEventListener('click', closeSplash);
    splash.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            closeSplash();
        }
    });
}

function setupBackToTopButton() {
    const button = document.getElementById('backToTopBtn');
    if (!button) return;

    const threshold = 420;
    const hideDelay = 1500;
    const hideAnimationDuration = 220;
    let hideTimer = null;
    let fadeTimer = null;

    const updateVisibility = () => {
        const shouldShow = window.scrollY > threshold;
        button.classList.remove('is-hiding');
        button.classList.toggle('hidden', !shouldShow);

        if (hideTimer) {
            window.clearTimeout(hideTimer);
            hideTimer = null;
        }

        if (fadeTimer) {
            window.clearTimeout(fadeTimer);
            fadeTimer = null;
        }

        if (shouldShow) {
            hideTimer = window.setTimeout(() => {
                button.classList.add('is-hiding');
                fadeTimer = window.setTimeout(() => {
                    button.classList.add('hidden');
                    button.classList.remove('is-hiding');
                    fadeTimer = null;
                }, hideAnimationDuration);
                hideTimer = null;
            }, hideDelay);
        }
    };

    button.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    window.addEventListener('scroll', updateVisibility, { passive: true });
    updateVisibility();
}

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

async function loadAlbums() {
    try {
        const response = await fetch('data/album.json');
        if (!response.ok) throw new Error('文件加载失败');
        albumsData = await response.json();
        renderAlbumList(albumsData);
    } catch (error) {
        console.error('加载专辑数据失败:', error);
        const container = document.getElementById('albumList');
        if (container) {
            container.innerHTML =
                `<p class="placeholder">⚠ 专辑数据加载失败，请检查 data/album.json。</p>`;
        }
    }
}

async function loadInfo() {
    try {
        const response = await fetch('data/info.json');
        if (!response.ok) throw new Error('文件加载失败');
        infoData = await response.json();
        renderInfoContent();
    } catch (error) {
        console.error('加载信息数据失败:', error);
    }
}

async function loadFootprint() {
    try {
        const response = await fetch('data/footprint.json');
        if (!response.ok) throw new Error('文件加载失败');
        footprintData = await response.json();
        renderFootprintIntro();
    } catch (error) {
        console.error('加载足迹数据失败:', error);
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
        const rawQuery = input.value.trim();
        const normalizedQuery = rawQuery.toLowerCase();
        if (!normalizedQuery) {
            renderLibrary(songsData);
            if (backBtn) backBtn.classList.add('hidden');
            return;
        }
        const ranked = songsData
            .map(song => {
                const matchLine = searchMode === 'keyword' ? findLyricLineByKeyword(song, normalizedQuery) : '';
                const score = searchMode === 'keyword'
                    ? (matchLine ? 1 : 0)
                    : scoreSearchMatch(song, normalizedQuery, searchMode);
                return { song, score, matchLine };
            })
            .filter(item => item.score > 0)
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return parseReleaseDate(a.song?.meta?.release_date) - parseReleaseDate(b.song?.meta?.release_date);
            });

        showSearchResults(ranked, rawQuery, searchMode);
        if (backBtn) backBtn.classList.remove('hidden');
    };

    const setMode = (mode) => {
        searchMode = mode;
        const labelMap = {
            title: '歌名',
            lyricist: '作词',
            composer: '作曲',
            keyword: '关键词'
        };
        const placeholderMap = {
            title: '输入歌名搜索',
            lyricist: '输入作词人搜索',
            composer: '输入作曲人搜索',
            keyword: '输入关键词匹配歌词'
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
            if (backBtn) backBtn.classList.add('hidden');
        }
    });
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            if (input) input.value = '';
            renderLibrary(songsData);
            backBtn.classList.add('hidden');
        });
    }
    input.addEventListener('focus', () => modeMenu.classList.add('hidden'));
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

function getSearchTargetText(song, mode) {
    const title = song?.meta?.title || '';
    const lyricist = song?.credits?.lyricist || '';
    const composer = song?.credits?.composer || '';

    if (mode === 'lyricist') {
        return lyricist.toLowerCase();
    }

    if (mode === 'composer') {
        return composer.toLowerCase();
    }

    return title.toLowerCase();
}

function scoreSearchMatch(song, query, mode) {
    const targetText = getSearchTargetText(song, mode);
    return targetText.includes(query) ? 1 : 0;
}

function findLyricLineByKeyword(song, query) {
    const keyword = String(query || '').trim().toLowerCase();
    if (!keyword) return '';

    const lines = String(song?.meta?.lyrics || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    const matchedLine = lines.find(line => line.toLowerCase().includes(keyword));
    return matchedLine || '';
}

function showSearchResults(resultItems, query, mode = searchMode) {
    const view = document.getElementById('searchResultsView');
    const list = document.getElementById('searchResultList');
    const summary = document.getElementById('searchResultsSummary');
    if (!view || !list || !summary) return;

    hideAllViews();
    view.classList.remove('hidden');
    setHeaderEchoMode(false);
    document.body.classList.remove('on-home');
    detailReturnTarget = 'searchResults';

    // 在搜索结果页隐藏头部和页面内的返回按钮
    const searchBackBtn = document.getElementById('searchBackBtn');
    if (searchBackBtn) searchBackBtn.classList.add('hidden');
    const backToSearchLibraryBtn = document.getElementById('backToSearchLibraryBtn');
    if (backToSearchLibraryBtn) backToSearchLibraryBtn.classList.add('hidden');

    summary.textContent = `关键词：${query} · 共找到 ${resultItems.length} 首`;
    list.innerHTML = resultItems.length === 0
        ? `<p class="placeholder">没有找到相关歌曲</p>`
        : resultItems.map(item => createSongCard(item.song, item.matchLine, mode === 'keyword' ? query : '')).join('');
    updateLayout();
}

function renderAlbumList(albums) {
    const container = document.getElementById('albumList');
    if (!container) return;
    if (!albums || albums.length === 0) {
        container.innerHTML = `<p class="placeholder">暂无专辑</p>`;
        return;
    }
    container.innerHTML = albums.map(album => {
        const cover = getAlbumCover(album);
        const dateText = album.release_date || '未知日期';
        return `
            <article class="album-card" data-album-id="${escapeHtml(String(album.id))}">
                <button class="album-cover-btn" type="button" data-album-id="${escapeHtml(String(album.id))}">
                    <img class="album-cover" src="${cover}" alt="${escapeHtml(album.title || '')}">
                </button>
                <div class="album-meta">
                    <div class="album-title">${escapeHtml(album.title || '')}</div>
                    <div class="album-date">${escapeHtml(dateText)}</div>
                </div>
            </article>
        `;
    }).join('');

    container.querySelectorAll('.album-cover-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const albumId = btn.getAttribute('data-album-id');
            if (albumId) window.location.hash = `#album-${albumId}`;
        });
    });
}

function showAlbumDetail(album) {
    hideAllViews();
    document.getElementById('albumDetailView').classList.remove('hidden');
    setHeaderEchoMode(false);
    detailReturnTarget = `album:${album.id}`;

    const cover = getAlbumCover(album);
    const intro = (album.description || '').trim();
    const relatedVideos = buildRelatedVideoSection(album);
    const tracks = (album.tracks || []).map(track => {
        const song = songsData.find(s => Number(s.id) === Number(track.song_id));
        const title = song?.meta?.title || track.title || '未知曲目';
        const clickAttr = song ? `onclick="handleSongCardClick(${escapeHtml(String(song.id))})"` : '';
        return `
            <article class="song-item album-track-item" ${clickAttr}>
                <div class="song-title">${escapeHtml(title)}</div>
            </article>
        `;
    }).join('');

    const trackListHtml = tracks || `<p class="placeholder">暂无曲目</p>`;

    document.getElementById('albumDetailContent').innerHTML = `
        <div class="album-detail-layout">
            <div class="album-detail-left">
                <div class="album-detail-title">${escapeHtml(album.title || '')}</div>
                <img class="album-cover" src="${cover}" alt="${escapeHtml(album.title || '')}">
                ${intro ? `
                    <details class="album-description-wrap">
                        <summary class="album-description-title">专辑简介</summary>
                        <div class="album-description">${escapeHtml(intro)}</div>
                    </details>
                ` : ''}
                ${relatedVideos}
            </div>
            <div class="album-track-list">
                ${trackListHtml}
            </div>
        </div>
    `;
}

function getAlbumCover(album) {
    if (album?.cover_image) return resolveImagePath(album.cover_image);
    const title = (album?.title || '').trim();
    const coverMap = {
        '陈婧霏': 'image/歌曲/陈婧霏.jpg',
        '猩红': 'image/歌曲/猩红.png'
    };
    return coverMap[title] || 'image/歌曲/陈婧霏.jpg';
}

function resolveImagePath(imagePath) {
    const value = String(imagePath || '').trim();
    if (!value) return '';
    if (/^(?:https?:)?\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:')) {
        return value;
    }
    // 兼容旧 image/ 前缀写法，统一归一到 image/歌曲/ 目录
    if (value.startsWith('image/')) {
        return value.replace(/^image\//, 'image/歌曲/');
    }
    return `image/歌曲/${value}`;
}
// 状态匹配面板
function setupMatchPanel() {
    const closeBtn = document.getElementById('closeMatchBtn');
    const matchBtn = document.getElementById('matchBtn');
    const panel = document.getElementById('matchPanel');
    const input = document.getElementById('matchInput');
    const resultBox = document.getElementById('matchResult');
    closeBtn.addEventListener('click', () => {
        panel.classList.add('hidden');
        showView('libraryView');
        resultBox.innerHTML = '';
    });
    matchBtn.addEventListener('click', async () => {
        const text = input.value.trim();
        if (!text) {
            resultBox.innerHTML = '<p class="placeholder">请先输入描述</p>';
            return;
        }
        await showMatchResult(text);
    });
}

function setupMatchResultActions() {
    const backToMatchBtn = document.getElementById('backToMatchBtn');
    const goToMatchedDetailBtn = document.getElementById('goToMatchedDetailBtn');
    const nextEchoBtn = document.getElementById('nextEchoBtn');
    const matchInput = document.getElementById('matchInput');
    const historyList = document.getElementById('echoHistoryList');

    backToMatchBtn.addEventListener('click', () => {
        hideAllViews();
        document.getElementById('matchPanel').classList.remove('hidden');
        setHeaderEchoMode(true);
        matchInput.focus();
    });

    goToMatchedDetailBtn.addEventListener('click', () => {
        if (!currentMatchedSongId) return;
        detailReturnTarget = 'echoResult';
        window.location.hash = `#detail-${currentMatchedSongId}`;
    });

    nextEchoBtn.addEventListener('click', async () => {
        await showMatchResult(matchInput.value.trim(), { next: true });
    });

    if (historyList) {
        historyList.addEventListener('click', (event) => {
            const card = event.target.closest('.echo-history-card[data-song-id]');
            if (!card) return;
            const songId = Number(card.getAttribute('data-song-id'));
            if (!Number.isFinite(songId) || songId <= 0) return;
            currentMatchedSongId = songId;
            detailReturnTarget = 'echoResult';
            window.location.hash = `#detail-${songId}`;
        });
    }
}

function resetEchoSession() {
    echoSession = {
        input: '',
        candidates: [],
        shownIds: [],
        currentItem: null,
        reEchoCount: 0
    };
    currentMatchedSongId = null;
    const historyList = document.getElementById('echoHistoryList');
    if (historyList) historyList.innerHTML = '';
}

async function buildEchoCandidates(input) {
    // 先进行本地高精度模糊匹配，召回 20-30 首候选
    const localMatches = matchByStateLocal(input, 30);
    if (!localMatches.length) return [];

    if (!ENABLE_AI_MATCH) {
        return localMatches;
    }

    // 如果有候选歌曲，尝试使用 AI 进行最终选择
    const aiMatch = await matchByAI(input, localMatches);
    if (!aiMatch) return localMatches;

    const aiId = Number(aiMatch.song?.id);
    const deduped = localMatches.filter(item => Number(item.song?.id) !== aiId);
    return [aiMatch, ...deduped];
}

function pickNextEchoCandidate(preferNext = false) {
    const { candidates, shownIds } = echoSession;
    if (!Array.isArray(candidates) || candidates.length === 0) return null;

    if (!preferNext) {
        return candidates[0];
    }

    const unseen = candidates.find(item => !shownIds.includes(Number(item.song?.id)));
    return unseen || null;
}

function renderEchoResultState(currentItem, exhausted = false) {
    const resultBox = document.getElementById('matchEchoResult');
    const historyList = document.getElementById('echoHistoryList');
    if (!resultBox) return;

    const currentId = Number(currentItem.song?.id);
    const previousItems = echoSession.shownIds
        .filter(id => id !== currentId)
        .map(id => echoSession.candidates.find(item => Number(item.song?.id) === id))
        .filter(Boolean)
        .reverse();

    // 将 matchLine 按 key_lyrics 格式处理：每行引号内容作为一句，居中换行显示
    const currentLyric = currentItem.matchLine || '暂时未能发现回响';
    const formattedLyric = formatKeyLyricsDisplay(currentLyric);
    const currentTitle = currentItem.song?.meta?.title || '';
    const historyHtml = previousItems.length
        ? `
            <div class="echo-history-title">已发现的回响</div>
            <div class="echo-history-list">
                ${previousItems.map((item) => {
            const itemLyric = item.matchLine || '暂时未能发现回响';
            const formattedItemLyric = formatKeyLyricsInline(itemLyric);
            return `
                    <article class="echo-history-card" data-song-id="${escapeHtml(String(item.song?.id || ''))}" role="button" tabindex="0">
                        <div class="echo-history-lyric">${formattedItemLyric}</div>
                        <div class="echo-history-song">${escapeHtml(item.song?.meta?.title || '')}</div>
                    </article>
                `;
        }).join('')}
            </div>
        `
        : '';

    const exhaustedHtml = exhausted
        ? `<div class="echo-exhausted">已经没有新的回响结果了</div>`
        : '';

    resultBox.innerHTML = `
        <div class="echo-result-stack">
            <div class="echo-lyric">${formattedLyric}</div>
            <div class="echo-title">—${escapeHtml(`《${currentTitle}》`)}</div>
            ${exhaustedHtml}
        </div>
    `;

    if (historyList) {
        historyList.innerHTML = historyHtml;
    }

    echoSession.currentItem = currentItem;
}

// 格式化 key_lyrics 显示：每个引号内的内容作为一句，保持换行，居中排列
function formatKeyLyricsDisplay(lyricText) {
    if (!lyricText) return '';
    // 将文本按引号分割，每个引号内的内容作为一句
    const lines = String(lyricText).split('"').map(l => l.trim()).filter(Boolean);
    // 每行用 div 包裹，实现居中换行显示
    return lines.map(line => `<div class="echo-lyric-line">${escapeHtml(line)}</div>`).join('');
}

// 历史结果用单行内联显示：去掉引号、用空格连接成一句
function formatKeyLyricsInline(lyricText) {
    if (!lyricText) return '';
    const lines = String(lyricText).split('"').map(l => l.trim()).filter(Boolean);
    return escapeHtml(lines.join(' '));
}

async function showMatchResult(text, options = {}) {
    const { next = false } = options;
    const resultView = document.getElementById('matchResultView');
    const resultBox = document.getElementById('matchEchoResult');
    const normalizedInput = String(text || '').trim();

    currentMatchedSongId = null;
    hideAllViews();
    resultView.classList.remove('hidden');
    setHeaderEchoMode(true);

    if (!normalizedInput) {
        resultBox.innerHTML = '<div class="echo-empty">请先输入描述</div>';
        const historyList = document.getElementById('echoHistoryList');
        if (historyList) historyList.innerHTML = '';
        return;
    }

    const needRebuildCandidates =
        echoSession.input !== normalizedInput ||
        !Array.isArray(echoSession.candidates) ||
        echoSession.candidates.length === 0;

    if (needRebuildCandidates) {
        resultBox.innerHTML = '<div class="echo-empty">正在回响中...</div>';
        const candidates = await buildEchoCandidates(normalizedInput);
        echoSession = {
            input: normalizedInput,
            candidates,
            shownIds: [],
            currentItem: null,
            reEchoCount: 0
        };
    }

    if (!echoSession.candidates.length) {
        resultBox.innerHTML = '<div class="echo-empty">暂时未能发现回响</div>';
        const historyList = document.getElementById('echoHistoryList');
        if (historyList) historyList.innerHTML = '';
        return;
    }

    if (!next && echoSession.input === normalizedInput && echoSession.currentItem) {
        currentMatchedSongId = Number(echoSession.currentItem.song?.id) || null;
        renderEchoResultState(echoSession.currentItem, echoSession.shownIds.length >= echoSession.candidates.length);
        return;
    }

    if (next) {
        echoSession.reEchoCount += 1;
    }

    const topMatch = pickNextEchoCandidate(next);
    if (!topMatch) {
        const lastItem = echoSession.currentItem || echoSession.candidates[0];
        currentMatchedSongId = Number(lastItem.song?.id) || null;
        renderEchoResultState(lastItem, true);
        return;
    }

    const selectedId = Number(topMatch.song?.id);
    if (!echoSession.shownIds.includes(selectedId)) {
        echoSession.shownIds.push(selectedId);
    }

    currentMatchedSongId = selectedId || null;
    renderEchoResultState(topMatch, false);
}

async function matchByAI(input, candidateList) {
    try {
        const albumDescriptionMap = buildAlbumDescriptionMap();
        // 如果传入了候选列表，只使用这些候选；否则使用全部歌曲
        const sourceList = candidateList || songsData;
        const candidateSongs = sourceList
            .map(item => {
                const song = item.song || item;
                return { song, payload: buildAISongPayload(song, albumDescriptionMap) };
            })
            .filter(item => item.payload.frequency > 0);

        if (candidateSongs.length === 0) return null;

        const response = await fetch(MATCH_API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userInput: input,
                songs: candidateSongs.map(item => item.payload)
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.warn('AI 匹配请求失败，将回退本地匹配:', errorText);
            return null;
        }

        const data = await response.json();
        const matchedId = Number(data?.matchedSongId);
        if (!Number.isFinite(matchedId) || matchedId <= 0) return null;

        const matchedSong = songsData.find(song => Number(song.id) === matchedId);
        if (!matchedSong) return null;

        const keywords = prepareSearchTokens(input);
        const matchLine = getBestLyricLineFromKeyLyrics(matchedSong, keywords).line;
        return { song: matchedSong, score: 1, matchLine };
    } catch (error) {
        console.warn('AI 匹配异常，将回退本地匹配:', error);
        return null;
    }
}

function normalizeAlbumKey(text) {
    return String(text || '').replace(/[《》]/g, '').trim();
}

function buildAlbumDescriptionMap() {
    const map = new Map();
    (albumsData || []).forEach(album => {
        const key = normalizeAlbumKey(album?.title);
        if (key && !map.has(key)) {
            map.set(key, String(album?.description || '').trim());
        }
    });
    return map;
}

function buildAISongPayload(song, albumDescriptionMap) {
    const albumKey = normalizeAlbumKey(song?.meta?.album);
    const semantic = song?.semantic_analysis || {};
    // 优先使用key_lyrics而不是完整的lyrics
    const keyLyrics = song?.meta?.key_lyrics || song?.semantic_analysis?.key_lyrics || '';
    return {
        id: Number(song?.id),
        title: String(song?.meta?.title || ''),
        lyrics: String(keyLyrics || ''),
        official_description: String(song?.credits?.official_description || ''),
        keywords: Array.isArray(semantic.keywords) ? semantic.keywords : [],
        scene_tags: Array.isArray(semantic.scene_tags) ? semantic.scene_tags : [],
        mood_tags: Array.isArray(semantic.mood_tags) ? semantic.mood_tags : [],
        album_description: albumDescriptionMap.get(albumKey) || '',
        frequency: Number(semantic.frequency || 0)
    };
}

function matchByStateLocal(input, limit = 0) {
    const keywords = prepareSearchTokens(input);
    if (keywords.length === 0) return [];
    const albumDescriptionMap = buildAlbumDescriptionMap();
    const scored = songsData
        .filter(song => Number(song?.semantic_analysis?.frequency || 0) > 0)
        .map(song => {
            const lyricResult = getBestLyricLineFromKeyLyrics(song, keywords);
            const description = (song.credits?.official_description || '').toLowerCase();
            const semantic = song?.semantic_analysis || {};
            const tagsText = [
                ...(Array.isArray(semantic.keywords) ? semantic.keywords : []),
                ...(Array.isArray(semantic.scene_tags) ? semantic.scene_tags : []),
                ...(Array.isArray(semantic.mood_tags) ? semantic.mood_tags : [])
            ].join(' ').toLowerCase();
            const albumDesc = (albumDescriptionMap.get(normalizeAlbumKey(song?.meta?.album)) || '').toLowerCase();
            const frequency = Number(semantic.frequency || 0);

            const officialScore = scoreTextByTokens(description, keywords);
            const tagScore = scoreTextByTokens(tagsText, keywords);
            const albumScore = scoreTextByTokens(albumDesc, keywords);
            const lyricScore = lyricResult.score;
            const frequencyBoost = Math.log1p(Math.max(0, frequency)) * 0.02;
            const score = lyricScore * 0.5
                + officialScore * 0.25
                + tagScore * 0.15
                + albumScore * 0.10
                + frequencyBoost;
            return { song, score, matchLine: lyricResult.line };
        });
    let result = scored
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score);

    // 如果指定了限制数量，返回前 N 首
    if (limit > 0) {
        result = result.slice(0, limit);
    }
    return result;
}

function scoreTextByTokens(text, keywords) {
    if (!text || keywords.length === 0) return 0;
    let hits = 0;
    keywords.forEach(word => {
        const token = String(word || '').toLowerCase();
        if (token && text.includes(token)) hits += 1;
    });
    return hits / keywords.length;
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

// 从 key_lyrics 中选择最佳匹配行，使用 key_lyrics 中的歌词进行匹配和显示
function getBestLyricLineFromKeyLyrics(song, keywords) {
    // 优先从 song.meta.key_lyrics 获取关键歌词片段
    let keyLyrics = song?.meta?.key_lyrics || song?.semantic_analysis?.key_lyrics || '';

    // 处理key_lyrics的不同格式
    let lines = [];
    if (Array.isArray(keyLyrics)) {
        // 如果是数组，直接使用数组元素
        lines = keyLyrics.map(line => String(line || '').trim()).filter(Boolean);
    } else {
        // 如果是字符串，按引号分割
        lines = String(keyLyrics || '')
            .split('"')
            .map(line => line.trim())
            .filter(Boolean);
    }

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

    // 即使没有匹配到，也返回key_lyrics中的第一句
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
        } else if (hash.startsWith('#album-')) {
            const id = hash.replace('#album-', '').trim();
            const album = albumsData.find(item => String(item.id) === String(id));
            if (album) showAlbumDetail(album);
            else window.location.hash = '#album';
        } else if (hash === '#album') {
            showView('albumListView');
            renderAlbumList(albumsData);
        } else if (hash.startsWith('#info')) {
            showView('infoView');
            const key = hash.replace('#info', '').replace('-', '').trim();
            renderInfoContent(key || undefined);
        } else if (hash === '#footprint') {
            showView('footprintView');
        } else {
            showView('libraryView');
            centerLibrarySongCardIfNeeded();
        }
    };
    window.addEventListener('hashchange', handleHash);
    const backBtn = document.getElementById('backBtn');
    const prevSongBtn = document.getElementById('prevSongBtn');
    const nextSongBtn = document.getElementById('nextSongBtn');

    backBtn.addEventListener('click', () => {
        if (detailReturnTarget === 'echoResult') {
            showView('matchResultView');
            return;
        }
        if (detailReturnTarget === 'searchResults') {
            showView('searchResultsView');
            return;
        }
        if (detailReturnTarget.startsWith('album:')) {
            const albumId = detailReturnTarget.split(':')[1];
            window.location.hash = `#album-${albumId}`;
            return;
        }
        if (detailReturnTarget === 'albumList') {
            window.location.hash = '#album';
            return;
        }
        pendingCenterSongId = currentDetailSongId;
        window.location.hash = '';
    });

    if (nextSongBtn) {
        nextSongBtn.addEventListener('click', () => {
            const nextSongId = getNextSongIdInHomeOrder(currentDetailSongId);
            if (!nextSongId) return;
            window.location.hash = `#detail-${nextSongId}`;
        });
    }

    if (prevSongBtn) {
        prevSongBtn.addEventListener('click', () => {
            const prevSongId = getPreviousSongIdInHomeOrder(currentDetailSongId);
            if (!prevSongId) return;
            window.location.hash = `#detail-${prevSongId}`;
        });
    }

    handleHash(); // 初始加载检查
}

function getNextSongIdInHomeOrder(currentSongId) {
    const currentId = Number(currentSongId);
    if (!Number.isFinite(currentId) || !Array.isArray(songsData) || songsData.length === 0) {
        return null;
    }

    const currentIndex = songsData.findIndex(item => Number(item?.id) === currentId);
    if (currentIndex < 0 || currentIndex >= songsData.length - 1) return null;

    const nextSong = songsData[currentIndex + 1];
    const nextId = Number(nextSong?.id);
    return Number.isFinite(nextId) ? nextId : null;
}

function getPreviousSongIdInHomeOrder(currentSongId) {
    const currentId = Number(currentSongId);
    if (!Number.isFinite(currentId) || !Array.isArray(songsData) || songsData.length === 0) {
        return null;
    }

    const currentIndex = songsData.findIndex(item => Number(item?.id) === currentId);
    if (currentIndex <= 0) return null;

    const previousSong = songsData[currentIndex - 1];
    const previousId = Number(previousSong?.id);
    return Number.isFinite(previousId) ? previousId : null;
}

function updateNextSongButton(currentSongId) {
    const nextSongBtn = document.getElementById('nextSongBtn');
    if (!nextSongBtn) return;

    const nextSongId = getNextSongIdInHomeOrder(currentSongId);
    nextSongBtn.disabled = !nextSongId;
    nextSongBtn.title = nextSongId ? '按首页顺序查看下一首' : '已经是最后一首';
}

function updatePreviousSongButton(currentSongId) {
    const prevSongBtn = document.getElementById('prevSongBtn');
    if (!prevSongBtn) return;

    const prevSongId = getPreviousSongIdInHomeOrder(currentSongId);
    prevSongBtn.disabled = !prevSongId;
    prevSongBtn.title = prevSongId ? '按首页顺序查看上一首' : '已经是第一首';
}

function hideAllViews() {
    ['libraryView', 'searchResultsView', 'detailView', 'albumListView', 'albumDetailView', 'infoView', 'footprintView', 'matchPanel', 'matchResultView'].forEach(id =>
        document.getElementById(id).classList.add('hidden'));
}
function showView(id) {
    hideAllViews();
    document.getElementById(id).classList.remove('hidden');
    setHeaderEchoMode(id === 'matchPanel' || id === 'matchResultView');
    document.body.classList.toggle('on-home', id === 'libraryView');
    if (id !== 'footprintView') {
        resetFootprintView();
    }
}

function setHeaderEchoMode(isEcho) {
    document.body.classList.toggle('echo-mode', Boolean(isEcho));
}

function setupInfoView() {
    const menu = document.querySelector('.info-menu');
    if (!menu) return;
    menu.addEventListener('click', (event) => {
        const btn = event.target.closest('button[data-section]');
        if (!btn) return;
        const key = btn.dataset.section;
        window.location.hash = `#info-${key}`;
    });
    renderInfoContent();
}

function renderInfoContent(sectionKey) {
    const content = document.getElementById('infoContent');
    const menuButtons = document.querySelectorAll('.info-menu button[data-section]');
    if (!content) return;

    const fallbackMap = {
        about: `JingFei's Songs 是一个聚合与整理陈婧霏作品的个人页面，
展示曲库、专辑与歌词内容，并提供快速检索与匹配入口。`,
        contact: `作者联系方式：
邮箱：example@email.com
如需补充信息或纠错，请发送邮件说明。`,
        thanks: `特别感谢：
提供灵感与参考的朋友们，以及所有热爱音乐的人。`
    };

    const infoMap = infoData && typeof infoData === 'object' ? infoData : fallbackMap;
    const firstKey = menuButtons[0]?.dataset.section || 'guide';
    const validKeys = Array.from(menuButtons).map(btn => btn.dataset.section);
    const key = validKeys.includes(sectionKey) ? sectionKey : firstKey;

    menuButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.section === key);
    });

    if (key === 'changelog') {
        renderChangelogList();
        return;
    }

    content.textContent = infoMap[key] || '';
}

// 更新日志：版本列表（从新到旧，按数组顺序展示）
function renderChangelogList() {
    const content = document.getElementById('infoContent');
    if (!content) return;

    const changelog = infoData?.changelog;
    if (!Array.isArray(changelog) || changelog.length === 0) {
        content.innerHTML = '<p class="placeholder">暂无更新日志</p>';
        return;
    }

    // 过滤掉完全空的条目
    const items = changelog.filter(item => item && (item.version || item.date || item.content));
    if (items.length === 0) {
        content.innerHTML = '<p class="placeholder">暂无更新日志</p>';
        return;
    }

    content.innerHTML = `
        <div class="changelog-list">
            ${items.map((item) => `
                <button class="changelog-item" type="button">
                    <span class="changelog-version">${escapeHtml(item.version || '')}</span>
                    <span class="changelog-date">${escapeHtml(item.date || '')}</span>
                </button>
            `).join('')}
        </div>
    `;

    content.querySelectorAll('.changelog-item').forEach((btn, index) => {
        btn.addEventListener('click', () => {
            renderChangelogDetail(items[index]);
        });
    });
}

// 更新日志：单个版本详情（右上角返回键）
function renderChangelogDetail(item) {
    const content = document.getElementById('infoContent');
    if (!content) return;

    content.innerHTML = `
        <div class="changelog-detail">
            <button class="changelog-back-btn" type="button" aria-label="返回更新日志列表">返回</button>
            <div class="changelog-detail-header">
                <span class="changelog-version">${escapeHtml(item.version || '')}</span>
                <span class="changelog-date">${escapeHtml(item.date || '')}</span>
            </div>
            <div class="changelog-detail-body">${escapeHtml(item.content || '暂无内容')}</div>
        </div>
    `;

    const backBtn = content.querySelector('.changelog-back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', renderChangelogList);
    }
}

function showDetailView(song) {
    hideAllViews();
    document.getElementById('detailView').classList.remove('hidden');
    document.body.classList.remove('on-home');
    window.scrollTo({ top: 0, behavior: 'auto' });
    currentDetailSongId = Number(song?.id) || null;
    updatePreviousSongButton(currentDetailSongId);
    updateNextSongButton(currentDetailSongId);
    currentDetailLyricsRaw = String(song?.meta?.lyrics || '暂无歌词');
    currentDetailLyricsScript = 'trad';

    const releaseLine = song.meta?.release_date
        ? `<div class="detail-release">${escapeHtml(formatReleaseDate(song.meta.release_date))}</div>`
        : '';

    const originalSinger = (song.credits?.original_singer || '').trim();
    const singer = (song.meta?.artist || '').trim();
    const album = (song.meta?.album || '').trim();
    const originAlbumLine = [
        originalSinger ? `<div class="detail-line">原唱：${escapeHtml(originalSinger)}</div>` : '',
        singer ? `<div class="detail-line">演唱：${escapeHtml(singer)}</div>` : '',
        album ? `<div class="detail-line">专辑：${escapeHtml(album)}</div>` : ''
    ].filter(Boolean).join('');

    const credits = [
        `作词：${escapeHtml(song.credits?.lyricist || '未知')}`,
        `作曲：${escapeHtml(song.credits?.composer || '未知')}`,
        `编曲：${escapeHtml(song.credits?.arranger || '未知')}`
    ].map(text => `<span>${text}</span>`).join('');

    const coverImage = resolveImagePath(song.meta?.cover_image);
    const description = (song.credits?.official_description || '').trim();
    const sidebarDescription = description
        ? `
            <details class="detail-description">
                <summary>歌曲详情</summary>
                <div class="detail-description-body">${escapeHtml(description)}</div>
            </details>
        `
        : '';
    const relatedVideos = buildRelatedVideoSection(song);
    const hasChineseLyrics = containsChineseCharacters(currentDetailLyricsRaw);
    const scriptToggleButton = hasChineseLyrics
        ? `<button id="lyricsScriptToggleBtn" class="secondary-btn detail-script-toggle" type="button">简体</button>`
        : '';

    document.getElementById('detailContent').innerHTML = `
        <div class="detail-layout">
            <div class="detail-header detail-header-full">
                <div class="detail-title-row">
                    <div class="detail-title">${escapeHtml(song.meta?.title || '')}</div>
                    ${song.meta?.highlight_sentence ? `<div class="detail-keysentence">${escapeHtml(song.meta.highlight_sentence)}</div>` : ''}
                </div>
                ${releaseLine}
                ${originAlbumLine}
                <div class="detail-credits">${credits}</div>
            </div>
            <div class="detail-body">
                <div class="detail-lyrics">
                    <div class="detail-lyrics-head">
                        <h3>歌词</h3>
                        ${scriptToggleButton}
                    </div>
                    <div class="lyrics-box"></div>
                    ${relatedVideos}
                </div>
                <aside class="detail-sidebar">
                    <div class="detail-cover-frame">
                        ${coverImage
            ? `<img class="detail-cover" src="${escapeHtml(coverImage)}" alt="${escapeHtml(song.meta?.title || '')}">`
            : `<div class="detail-cover placeholder-cover">暂无封面</div>`}
                    </div>
                    ${sidebarDescription}
                </aside>
            </div>
        </div>
    `;

    renderDetailLyricsText();
    setupLyricsScriptToggle(hasChineseLyrics);
    requestAnimationFrame(() => syncDetailSidebarHeight());
}

function buildRelatedVideoSection(song) {
    const videoLinks = extractVideoLinks(song);
    if (videoLinks.length === 0) return '';

    const itemsHtml = videoLinks.map((item) => `
        <a class="detail-video-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
            <span class="detail-video-title">${escapeHtml(item.label)}</span>
        </a>
    `).join('');

    return `
        <details class="detail-related-video">
            <summary>相关视频</summary>
            <div class="detail-related-video-body">
                ${itemsHtml}
            </div>
        </details>
    `;
}

function setupLyricsScriptToggle(shouldShow) {
    const button = document.getElementById('lyricsScriptToggleBtn');
    if (!button) return;

    button.classList.toggle('hidden', !shouldShow);
    if (!shouldShow) return;

    button.onclick = () => {
        currentDetailLyricsScript = currentDetailLyricsScript === 'simp' ? 'trad' : 'simp';
        renderDetailLyricsText();
        updateLyricsScriptToggleLabel();
    };

    updateLyricsScriptToggleLabel();
}

function updateLyricsScriptToggleLabel() {
    const button = document.getElementById('lyricsScriptToggleBtn');
    if (!button) return;
    button.textContent = currentDetailLyricsScript === 'trad' ? '简体' : '繁体';
}

function renderDetailLyricsText() {
    const lyricsBox = document.querySelector('#detailView .lyrics-box');
    if (!lyricsBox) return;

    const rawLyrics = currentDetailLyricsRaw || '暂无歌词';
    if (rawLyrics === '暂无歌词') {
        lyricsBox.textContent = rawLyrics;
        return;
    }

    lyricsBox.textContent = currentDetailLyricsScript === 'trad'
        ? convertLyricsToTraditional(rawLyrics)
        : rawLyrics;
}

function containsChineseCharacters(text) {
    return /[\u4e00-\u9fff]/.test(String(text || ''));
}

function convertLyricsToTraditional(text) {
    const converter = getSimplifiedToTraditionalConverter();
    if (!converter) return text;
    return converter(String(text || ''));
}

function getSimplifiedToTraditionalConverter() {
    if (!window.OpenCC || typeof window.OpenCC.Converter !== 'function') return null;
    if (!window.__lyricsCnToTwConverter) {
        window.__lyricsCnToTwConverter = window.OpenCC.Converter({ from: 'cn', to: 'tw' });
    }
    return window.__lyricsCnToTwConverter;
}

function extractVideoLinks(song) {
    const raw = song?.media?.video_link ?? song?.video_link ?? '';
    const entries = Array.isArray(raw) ? raw : [raw];
    const links = [];

    entries.forEach((entry) => {
        if (entry == null) return;
        if (typeof entry === 'object') {
            const url = String(entry.url || entry.link || entry.href || '').trim();
            if (!url) return;
            const label = String(entry.title || entry.name || entry.label || url).trim() || url;
            links.push({ url, label });
            return;
        }

        String(entry)
            .split(/\r?\n|\s*,\s*|\s*;\s*/)
            .map(text => text.trim())
            .filter(Boolean)
            .forEach((url) => {
                links.push({ url, label: url });
            });
    });

    const seen = new Set();
    return links.filter((item) => {
        if (!item.url || seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
    });
}

// 渲染与组件
function renderLibrary(songs) {
    const container = document.getElementById('songList');
    container.innerHTML = songs.length === 0
        ? `<p class="placeholder">暂无记录</p>`
        : songs.map(s => createSongCard(s)).join('');
    updateLayout();
}

function createSongCard(song, overrideKeySentence = '', highlightKeyword = '') {
    const releaseText = song.meta?.release_date ? formatReleaseDate(song.meta.release_date) : '未知日期';
    const keySentence = overrideKeySentence || song.meta?.highlight_sentence || '';
    const keySentenceHtml = highlightKeyword
        ? highlightKeywordInText(keySentence, highlightKeyword)
        : escapeHtml(keySentence);

    return `
        <article class="song-item" data-song-id="${escapeHtml(String(song.id))}" onclick="handleSongCardClick(${escapeHtml(String(song.id))})">
            <div class="song-header">
                <div class="song-title">${escapeHtml(song.meta?.title || '')}</div>
                <div class="song-date">${escapeHtml(releaseText)}</div>
            </div>
            <div class="song-keysentence">${keySentenceHtml}</div>
        </article>
    `;
}

// 点击歌曲卡片的统一处理：根据当前所在视图设置返回目标，然后跳转到详情
function handleSongCardClick(songId) {
    try {
        const searchView = document.getElementById('searchResultsView');
        const albumDetailView = document.getElementById('albumDetailView');
        const matchResultView = document.getElementById('matchResultView');

        if (searchView && !searchView.classList.contains('hidden')) {
            detailReturnTarget = 'searchResults';
        } else if (albumDetailView && !albumDetailView.classList.contains('hidden')) {
            // 来自专辑详情，返回到该专辑列表
            // 保持之前的 detailReturnTarget 以便返回专辑
        } else if (matchResultView && !matchResultView.classList.contains('hidden')) {
            detailReturnTarget = 'echoResult';
        } else {
            detailReturnTarget = 'library';
        }
    } catch (e) {
        detailReturnTarget = 'library';
    }
    window.location.hash = `#detail-${songId}`;
}

function centerLibrarySongCardIfNeeded() {
    const songId = Number(pendingCenterSongId);
    pendingCenterSongId = null;
    if (!Number.isFinite(songId) || songId <= 0) return;

    const card = document.querySelector(`#songList .song-item[data-song-id="${songId}"]`);
    if (!card) return;

    requestAnimationFrame(() => {
        card.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
    });
}

function escapeRegExp(text) {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightKeywordInText(text, keyword) {
    const sourceText = String(text || '');
    const target = String(keyword || '').trim();
    if (!sourceText) return '';
    if (!target) return escapeHtml(sourceText);

    const pattern = new RegExp(`(${escapeRegExp(target)})`, 'ig');
    return sourceText
        .split(pattern)
        .map(part => {
            if (!part) return '';
            if (part.toLowerCase() === target.toLowerCase()) {
                return `<span class="search-keyword-hit">${escapeHtml(part)}</span>`;
            }
            return escapeHtml(part);
        })
        .join('');
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

function syncDetailSidebarHeight() {
    const lyricsBox = document.querySelector('#detailView .lyrics-box');
    const sidebar = document.querySelector('#detailView .detail-sidebar');
    if (!lyricsBox || !sidebar) return;

    const lyricsBoxTop = lyricsBox.getBoundingClientRect().top;
    const sidebarTop = sidebar.getBoundingClientRect().top;
    const offset = Math.max(0, Math.round(lyricsBoxTop - sidebarTop));

    sidebar.style.marginTop = `${offset}px`;
    sidebar.style.height = '';
    sidebar.style.maxHeight = '';
    sidebar.style.overflowY = '';
    sidebar.style.overscrollBehavior = '';
}

// Elsewhere Guide modal handling
function showElsewhereGuideModal() {
    const modal = document.getElementById('elsewhereGuideModal');
    const body = document.getElementById('elsewhereGuideBody');
    const closeBtn = document.getElementById('elsewhereGuideClose');
    if (!modal || !body) return;

    const text = (infoData && typeof infoData === 'object') ? String(infoData.guide || '') : '';
    body.textContent = text || '（别处指南内容为空，稍后请在 data/info.json 的 "guide" 键中填写。）';

    modal.classList.remove('hidden');

    const onClose = () => {
        modal.classList.add('hidden');
        closeBtn.removeEventListener('click', onClose);
    };

    if (closeBtn) closeBtn.addEventListener('click', onClose);
}

function closeElsewhereGuideModal() {
    const modal = document.getElementById('elsewhereGuideModal');
    if (!modal) return;
    modal.classList.add('hidden');
}

// ==================== 足迹：巡演时间轴 ====================

function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function setupFootprintView() {
    const backBtn = document.getElementById('footprintBackBtn');
    if (backBtn) {
        backBtn.addEventListener('click', handleFootprintReturn);
    }
}

// 场景一：两颗红点
function renderFootprintIntro() {
    const canvas = document.querySelector('[data-footprint-canvas]');
    if (!canvas) return;
    canvas.innerHTML = '';
    canvas.classList.remove('focused', 'collapsed');
    if (!Array.isArray(footprintData) || footprintData.length === 0) return;

    footprintData.forEach((tour) => {
        const btn = document.createElement('button');
        btn.className = 'footprint-dot-btn';
        btn.type = 'button';
        btn.dataset.tourId = tour.id;
        btn.setAttribute('aria-label', `查看巡演足迹：${tour.name}`);
        btn.innerHTML = `
            <span class="footprint-dot" aria-hidden="true"></span>
            <span class="footprint-dot-label">${escapeHtml(tour.name)}</span>
        `;
        btn.addEventListener('click', () => handleDotClick(tour.id));
        canvas.appendChild(btn);
    });
}

// 场景二：点击聚焦
function handleDotClick(tourId) {
    if (footprintAnimating) return;
    footprintAnimating = true;

    const canvas = document.querySelector('[data-footprint-canvas]');
    const dots = canvas ? canvas.querySelectorAll('.footprint-dot-btn') : [];
    const clickedDot = Array.from(dots).find(d => d.dataset.tourId === tourId);
    const otherDot = Array.from(dots).find(d => d.dataset.tourId !== tourId);
    if (!clickedDot) {
        footprintAnimating = false;
        return;
    }

    const backBtn = document.getElementById('footprintBackBtn');
    const headerEl = document.querySelector('header');
    const headerHeight = headerEl ? headerEl.offsetHeight : 0;
    if (backBtn) {
        backBtn.style.top = (headerHeight + 14) + 'px';
        backBtn.classList.remove('hidden');
    }

    // 涟漪
    clickedDot.classList.add('rippling');

    // 另一颗红点淡出
    if (otherDot) {
        otherDot.style.transition = 'opacity 0.45s ease';
        otherDot.style.opacity = '0';
        otherDot.style.pointerEvents = 'none';
    }

    const reduce = prefersReducedMotion();
    const timelineContainer = document.querySelector('[data-footprint-timeline]');

    // 记录红点初始屏幕位置
    const firstRect = clickedDot.getBoundingClientRect();

    // 目标位置：导航栏下方、水平居中（fixed 坐标系）
    const targetTop = headerHeight + 28;
    const targetLeft = window.innerWidth / 2;

    // 把红点移到 timeline（避免被 canvas 折叠隐藏），用 fixed 定位脱离文档流
    timelineContainer.appendChild(clickedDot);
    clickedDot.style.position = 'fixed';
    clickedDot.style.top = firstRect.top + 'px';
    clickedDot.style.left = firstRect.left + 'px';
    clickedDot.style.margin = '0';
    clickedDot.style.zIndex = '20';
    clickedDot.style.transition = 'none';
    clickedDot.style.transform = 'translate(0, 0)';

    // 显示 timeline（此时在 canvas 下方，随后 canvas 折叠后会上移到顶部）
    timelineContainer.classList.remove('hidden');
    timelineContainer.setAttribute('aria-hidden', 'false');

    // 延迟折叠 canvas，等另一颗红点淡出完成（0.45s），红点已 fixed 不受影响
    if (canvas) {
        if (reduce) {
            canvas.classList.add('collapsed');
        } else {
            window.setTimeout(() => canvas.classList.add('collapsed'), 450);
        }
    }

    const arrive = () => {
        // 统一坐标系：红点即 axis 原点。
        // 1. 生成 axis（含主轴、分支），返回 axis 元素
        const axis = renderFootprintTimeline(tourId);
        if (!axis) {
            footprintAnimating = false;
            return;
        }
        // 2. 把红点 append 到 axis 内部，absolute top:0/left:50%（由 .anchored 类控制）
        axis.appendChild(clickedDot);
        // 3. 清除滑动期间的 inline 样式，让 .anchored 的 CSS 生效
        clickedDot.style.transition = '';
        clickedDot.style.position = '';
        clickedDot.style.top = '';
        clickedDot.style.left = '';
        clickedDot.style.margin = '';
        clickedDot.style.zIndex = '';
        clickedDot.style.transform = '';
        clickedDot.classList.add('anchored');
        // 4. 动态设置 axis 的 margin-top，使其顶部视口位置 = targetTop（红点滑动终点）
        //    先重置 margin-top 测量基准位置，再补偿到 targetTop
        axis.style.marginTop = '0px';
        const baseTop = axis.getBoundingClientRect().top;
        axis.style.marginTop = (targetTop - baseTop) + 'px';
        footprintAnimating = false;
    };

    if (reduce) {
        arrive();
    } else {
        // 滑动到目标位置（仅用 transform）
        const dx = targetLeft - (firstRect.left + firstRect.width / 2);
        const dy = targetTop - firstRect.top;
        void clickedDot.offsetWidth;
        clickedDot.style.transition = 'transform 1.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        clickedDot.style.transform = `translate(${dx}px, ${dy}px)`;
        // 用 setTimeout 精确等待动画完成（略大于 1.5s），避免 transitionend 事件冒泡干扰
        window.setTimeout(() => {
            if (footprintAnimating) arrive();
        }, 1550);
    }
}

// 场景三：时间轴生长。返回 axis 元素供 arrive() 锚定红点。
function renderFootprintTimeline(tourId) {
    const tour = footprintData.find(t => t.id === tourId);
    const container = document.querySelector('[data-footprint-timeline]');
    if (!tour || !container) return null;
    // 清除旧的 axis（红点在 arrive 中 append 到新 axis）
    container.querySelectorAll('.footprint-axis').forEach(el => el.remove());

    const axis = document.createElement('div');
    axis.className = 'footprint-axis';

    const line = document.createElement('div');
    line.className = 'footprint-line';
    axis.appendChild(line);

    const reduce = prefersReducedMotion();
    let branchIndex = 0;
    let delay = reduce ? 0 : 1; // 等主轴生长完成
    const branchStep = reduce ? 0 : 0.2;

    tour.legs.forEach((leg) => {
        if (leg.label) {
            // 间断标记：主轴上的断点，文字即 label
            const breakEl = document.createElement('div');
            breakEl.className = 'footprint-break';
            breakEl.style.setProperty('--fp-delay', delay + 's');
            breakEl.innerHTML = `
                <span class="footprint-break-label">${escapeHtml(leg.label)}</span>
            `;
            axis.appendChild(breakEl);
            delay += branchStep + (reduce ? 0 : 0.15);
        }
        (leg.stops || []).forEach((stop) => {
            const side = branchIndex % 2 === 0 ? 'left' : 'right';
            const branch = document.createElement('div');
            branch.className = `footprint-branch ${side}`;
            branch.style.setProperty('--fp-delay', delay + 's');
            const dateText = formatFootprintDate(stop.date);
            branch.innerHTML = `
                <div class="footprint-branch-content">
                    <span class="footprint-branch-city">${escapeHtml(stop.city || '')}</span>
                    <span class="footprint-branch-venue">${escapeHtml(stop.venue || '')}</span>
                </div>
                <span class="footprint-branch-date">${escapeHtml(dateText)}</span>
                <span class="footprint-branch-stem" aria-hidden="true"></span>
                <span class="footprint-branch-node" aria-hidden="true"></span>
            `;
            axis.appendChild(branch);
            branchIndex++;
            delay += branchStep;
        });
    });

    container.appendChild(axis);
    return axis;
}

function formatFootprintDate(dateStr) {
    if (!dateStr) return '';
    const parts = String(dateStr).split('-');
    if (parts.length === 3) return `${parts[0]}.${parts[1]}.${parts[2]}`;
    return dateStr;
}

// 场景四：返回
function handleFootprintReturn() {
    if (footprintAnimating) return;
    const canvas = document.querySelector('[data-footprint-canvas]');
    const timeline = document.querySelector('[data-footprint-timeline]');
    const backBtn = document.getElementById('footprintBackBtn');
    const reduce = prefersReducedMotion();

    const fadeOut = (el) => {
        if (!el) return;
        el.style.transition = reduce ? 'none' : 'opacity 0.4s ease';
        el.style.opacity = '0';
    };

    if (timeline) fadeOut(timeline);
    const anchoredDot = timeline ? timeline.querySelector('.footprint-dot-btn.anchored') : null;
    if (anchoredDot) fadeOut(anchoredDot);
    if (backBtn) fadeOut(backBtn);

    const restore = () => {
        if (backBtn) {
            backBtn.classList.add('hidden');
            backBtn.style.opacity = '';
            backBtn.style.transition = '';
        }
        if (timeline) {
            timeline.classList.add('hidden');
            timeline.innerHTML = '';
            timeline.style.opacity = '';
            timeline.style.transition = '';
            timeline.style.paddingTop = '';
            timeline.style.paddingBottom = '';
            timeline.setAttribute('aria-hidden', 'true');
        }
        // 重新渲染 intro，清除所有内联样式
        renderFootprintIntro();
        // 清除红点的 anchored 状态和内联样式
        if (canvas) {
            const anchoredDot = canvas.querySelector('.footprint-dot-btn.anchored');
            if (anchoredDot) {
                anchoredDot.classList.remove('anchored');
                anchoredDot.style.position = '';
                anchoredDot.style.top = '';
                anchoredDot.style.left = '';
                anchoredDot.style.transform = '';
                anchoredDot.style.opacity = '';
            }
        }
    };

    if (reduce) {
        restore();
    } else {
        window.setTimeout(restore, 420);
    }
}

function resetFootprintView() {
    footprintAnimating = false;
    const canvas = document.querySelector('[data-footprint-canvas]');
    const timeline = document.querySelector('[data-footprint-timeline]');
    const backBtn = document.getElementById('footprintBackBtn');
    if (backBtn) backBtn.classList.add('hidden');
    if (timeline) {
        timeline.classList.add('hidden');
        timeline.innerHTML = '';
        timeline.style.opacity = '';
        timeline.style.transition = '';
        timeline.style.paddingTop = '';
        timeline.style.paddingBottom = '';
        timeline.setAttribute('aria-hidden', 'true');
    }
    // 清除红点的 anchored 状态和内联样式
    if (canvas) {
        const anchoredDot = canvas.querySelector('.footprint-dot-btn.anchored');
        if (anchoredDot) {
            anchoredDot.classList.remove('anchored');
            anchoredDot.style.position = '';
            anchoredDot.style.top = '';
            anchoredDot.style.left = '';
            anchoredDot.style.transform = '';
            anchoredDot.style.opacity = '';
        }
        canvas.classList.remove('focused', 'collapsed');
    }
    renderFootprintIntro();
}
