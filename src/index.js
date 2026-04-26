const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json; charset=utf-8',
        },
    });
}

function normalizeSongs(rawSongs) {
    let songs = rawSongs;
    if (typeof songs === 'string') {
        try {
            songs = JSON.parse(songs);
        } catch {
            songs = [];
        }
    }
    if (!Array.isArray(songs)) return [];

    return songs
        .map((song) => {
            const frequency = Number(song?.frequency ?? song?.semantic_analysis?.frequency ?? 0);
            return {
                id: Number(song?.id),
                title: String(song?.title || song?.meta?.title || ''),
                lyrics: String(song?.lyrics || song?.meta?.lyrics || ''),
                official_description: String(song?.official_description || song?.credits?.official_description || ''),
                keywords: Array.isArray(song?.keywords) ? song.keywords : (Array.isArray(song?.semantic_analysis?.keywords) ? song.semantic_analysis.keywords : []),
                scene_tags: Array.isArray(song?.scene_tags) ? song.scene_tags : (Array.isArray(song?.semantic_analysis?.scene_tags) ? song.semantic_analysis.scene_tags : []),
                mood_tags: Array.isArray(song?.mood_tags) ? song.mood_tags : (Array.isArray(song?.semantic_analysis?.mood_tags) ? song.semantic_analysis.mood_tags : []),
                album_description: String(song?.album_description || ''),
                frequency,
            };
        })
        .filter((song) => Number.isFinite(song.id) && song.id > 0)
        .filter((song) => song.frequency > 0)
        .sort((a, b) => b.frequency - a.frequency);
}

function parseMatchedSongId(content) {
    const raw = String(content || '').trim();
    if (!raw) return NaN;

    try {
        const parsed = JSON.parse(raw);
        const direct = Number(parsed?.id ?? parsed?.matchedSongId);
        if (Number.isFinite(direct)) return direct;
    } catch {
        // ignore and continue with regex parsing
    }

    const matched = raw.match(/-?\d+/);
    return matched ? Number(matched[0]) : NaN;
}

async function handleMatch(request, env) {
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') {
        return jsonResponse({ error: '仅支持 POST 请求' }, 405);
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: '请求体必须是合法 JSON' }, 400);
    }

    const userInput = String(body?.userInput || '').trim();
    const songs = normalizeSongs(body?.songs);
    if (!userInput) return jsonResponse({ error: '缺少 userInput 参数' }, 400);
    if (songs.length === 0) {
        return jsonResponse({ error: '可参与匹配的歌曲为空（注意 frequency=0 会被过滤）' }, 400);
    }

    const apiKey = env.DEEPSEEK_API_KEY || env.DASHSCOPE_API_KEY;
    if (!apiKey) {
        return jsonResponse({ error: '未配置 DEEPSEEK_API_KEY（或 DASHSCOPE_API_KEY）' }, 500);
    }

    const messages = [
        {
            role: 'system',
            content: `你是一个专业音乐匹配助手，为独立音乐人陈婧霏的歌曲寻找最合适的听众。

你的任务是：根据用户输入的场景描述，从歌曲列表中找到情感和意境最匹配的一首歌。

匹配时必须严格遵守以下规则（按优先级排序）：

1. 意境与情感优先于字面匹配
   - 首先判断用户描述的整体情感基调（如怀旧、孤独、热烈、释然），然后匹配情感一致的歌曲。
   - 比如“夕阳”可能代表温暖、结束或怀念，而不只是“太阳落下”。

2. 场景与画面感优先于关键词重叠
   - 关注用户描述的场景细节（时间、地点、光线、气味），与歌曲的场景标签(scene_tags)对齐。
   - 例如“深夜一个人在海边”应优先匹配标签包含“深夜”和“海边”的歌，而不是仅包含“夜晚”的歌。

3. 中英文歌曲完全平等
   - 不要因为语言不同而降低任何歌曲的匹配权重。

4. frequency 是硬指标
   - frequency 为 0 的歌曲绝不参与匹配。
   - frequency 越大的歌曲，在同等条件下越优先。

5. 权重排序（从高到低）
   - lyrics（歌词）>（official_description（官方描述）辅助）> keywords/scene_tags/mood_tags（关键词与标签）> album_description（专辑简介）

6. 输出格式
   - 只返回一个 JSON 对象：{"matchedSongId": <数字ID>}
   - 不要添加任何解释、标点或其他文字。`,
        },
        {
            role: 'user',
            content: JSON.stringify({ userInput, songs }, null, 2),
        },
    ];

    try {
        const apiResponse = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages,
                temperature: 0.1,
                max_tokens: 60,
            }),
        });

        if (!apiResponse.ok) {
            const errorText = await apiResponse.text();
            return jsonResponse({ error: `AI API 错误: ${errorText}` }, 502);
        }

        const result = await apiResponse.json();
        const content = result?.choices?.[0]?.message?.content || '';
        const matchedSongId = parseMatchedSongId(content);

        if (!Number.isFinite(matchedSongId)) {
            return jsonResponse({ error: 'AI 返回结果无法解析为歌曲 id', raw: content }, 502);
        }

        const isInCandidates = songs.some((song) => Number(song.id) === Number(matchedSongId));
        if (!isInCandidates) {
            return jsonResponse({ error: 'AI 返回的 id 不在候选歌曲中', raw: content }, 502);
        }

        return jsonResponse({ matchedSongId: Number(matchedSongId) }, 200);
    } catch (error) {
        return jsonResponse({ error: `请求失败: ${error.message}` }, 500);
    }
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const isMatchApi = url.pathname === '/api/match' || (url.pathname === '/' && request.method === 'POST');
        if (isMatchApi) {
            return handleMatch(request, env);
        }

        if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
            return env.ASSETS.fetch(request);
        }

        return new Response('静态资源服务未配置', { status: 500 });
    },
};