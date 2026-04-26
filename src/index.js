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

## 匹配流程（严格按顺序执行，不可跳过）

### 第一步：判断情绪基调
先确定这段描述的情绪属性：
- 能量方向：向外（指向他人、世界、行动）还是向内（指向自己、独处、沉思）？
- 主动性：主动（想要什么、做什么、争取什么）还是被动（被触发、被迫接受、无可奈何）？
- 情绪温度：热的（愤怒、兴奋、渴望、焦躁）还是冷的（平静、麻木、释然、忧伤）还是温的（温柔、怀旧、惆怅）？

请在歌曲列表中寻找 energy_direction、energy_agency、emotion_temperature 与用户描述最匹配的歌曲。

### 第二步：判断描述结构
- 具体场景型：有时间、地点、人物、事件 → 优先匹配 narrative_granularity 为"场景描写"或"完整故事"的歌
- 抽象感受型：纯情绪或想法，无具体事件 → 优先匹配 narrative_granularity 为"情绪陈述"或"抽象意象"的歌
- 混合型（场景+感受）：以场景为第一锚点，情绪为辅助

### 第三步：判断语言密度
- 长篇叙事（五行或200字以上，描述具体的经历、事件）：优先匹配有完整故事线的歌
- 短句爆发（五行以内，情绪宣泄）：优先匹配歌词节奏感强、短促有力的歌
- 松散日常（口语化、碎片化）：优先匹配生活感强的歌

### 第四步：关键词辅助（最次要，仅在前三步无法区分时使用）
- 出现"海""水""深蓝""浪""潮"→ 倾向选择水意象的歌
- 出现"夜""梦""睡""醒""暗"→ 倾向选择夜晚或梦境相关的歌
- 出现"风""光""影""日落""黄昏"→ 倾向选择画面感强的歌
- 出现"城市""街""路""人群"→ 倾向选择都市感的歌
- 关键词仅起辅助作用，绝不能因为关键词匹配而否定前三步的判断

## 匹配约束
- frequency 为 0 的歌曲绝不参与匹配
- frequency 越大的歌曲，同等条件下越优先
- 中英文歌曲完全平等，不因语言降低匹配优先级
- 权重排序：lyrics > official_description > energy_direction/energy_agency/emotion_temperature/narrative_granularity > keywords/scene_tags/mood_tags > album_description

## 输出格式
只返回一个 JSON 对象，不要添加任何解释、标点或其他文字：
{"matchedSongId": <数字ID>}`,
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