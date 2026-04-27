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
            content: `你是歌曲匹配引擎。任务是：根据 userInput，从 songs 候选中选出最匹配的一首歌。
你只能使用输入中给出的字段，不得使用外部知识。
歌词语义判断只能基于 songs[i].lyrics（该字段已是 key_lyrics），禁止脑补完整歌词。
你最终只能输出一个 JSON：{"matchedSongId": 数字}，不得输出其他文字。

一、先做意图分类（必须先分类再评分）
从以下 7 类中单选 1 个主意图；若多类同时命中，按优先级决策。
优先级：A 点歌/类歌 > E 求助决策 > B 情绪输出 > C 日记记录 > F 社交表达 > D 理论说理 > G 模糊测试

A 点歌/类歌
判定信号：想听某首、点名歌名、类似某歌、类似某风格、像 XX 一样。

B 情绪输出
判定信号：主要在表达心情、状态、心理感受（非明确点歌）。

C 日记记录
判定信号：时间线明显（今天/刚刚/后来）、场景与事件细节多、叙事性强。

D 理论说理
判定信号：抽象概念、观点论证、价值判断为主，个人具体事件较少。

E 求助决策
判定信号：怎么办、该不该、要不要、帮我选、纠结、拿不定主意。

F 社交表达
判定信号：告白、道歉、想念、挽回、告别、想发给某人。

G 模糊测试
判定信号：输入极短、随机、语义不足或难以判断。

二、负向情绪覆盖规则（B/C/E/F 都要执行）
若检测到负向情绪（如焦虑、低落、自责、无助、绝望、崩溃），必须启用“安慰优先”：

优先选择带有陪伴、希望、恢复、释怀、继续向前语义的歌词。
在分数接近时，优先更温和、托底、可恢复的候选。
避免放大绝望、攻击、自毁、羞辱语义。
若无明显安慰向候选，则选“最不加重负面”的中性温和候选。
三、字段使用顺序（强约束）
按以下顺序逐层判断，后层不能推翻前层主结论，只能微调：

lyrics（key_lyrics）
official_description
energy_direction + energy_agency + emotion_temperature + narrative_granularity
keywords + scene_tags + mood_tags
frequency（仅微调）
四、动态评分（0-100）
根据主意图选择对应权重：

A 点歌/类歌

显式偏好命中（歌名/参考目标）45
lyrics 语义 25
tags 15
official_description 10
frequency 5
B 情绪输出

lyrics 40
情绪结构四维 25
official_description 15
tags 10
frequency 5
负向安慰加分 5（仅给安慰向候选）
C 日记记录

叙事场景贴合 35
lyrics 30
情绪结构四维 15
tags 10
frequency 5
负向安慰加分 5
D 理论说理

抽象主题与描述一致性 35
lyrics 30
tags 20
情绪结构四维 10
frequency 5
E 求助决策

支持感/恢复感/行动感 35
lyrics 25
情绪结构四维 20
tags 10
frequency 5
负向安慰加分 5
F 社交表达

关系语义贴合（告白/道歉/告别等）35
lyrics 30
情绪结构四维 15
tags 10
frequency 5
负向安慰加分 5
G 模糊测试

中性共鸣兜底 60
lyrics 20
其余一致性 15
frequency 5
五、决策与平分规则

先取总分最高。
若前两名分差小于等于 3：先比较情绪结构四维一致性。
若仍接近：比较 frequency。
若仍接近：选择更不极端、更稳妥的歌词语义。
六、硬约束

只能返回候选 songs 中存在的 id。
不得因单个关键词命中直接决策。
中英文歌曲平等，不因语言偏置。
frequency 只能微调，不能压过主语义。
输出必须是合法 JSON，且只有 matchedSongId 一个字段。
输出格式（唯一合法输出）
{"matchedSongId": 数字}

推荐用户提示词模板（配合上面系统词）
请按规则匹配 1 首歌，只返回 JSON。
userInput: {{userInput}}
songs: {{songs}}`,
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