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
            content: `你是"别处回响"的歌曲匹配引擎。你的任务是根据用户输入的文字描述，从歌曲候选列表中选出情感和意境最匹配的一首歌。

## 核心原则

1. 你只能使用输入中给出的字段，不得使用外部知识。
2. 歌词判断只能基于 songs[i].lyrics 字段（该字段已经是精简版 key_lyrics），禁止脑补完整歌词。
3. 中英文歌曲完全平等，不因语言降低匹配权重。
4. frequency 为 0 的歌曲绝不参与匹配。
5. 最终只输出一个 JSON：{"matchedSongId": 数字}，不得输出任何其他文字、标点或解释。

## 歌曲字段说明

- id：歌曲唯一标识
- title：歌名
- lyrics：精简版关键歌词（已提取最核心的句子）
- official_description：歌曲的官方描述或创作背景
- album_description：所属专辑的概念说明（如有）
- energy_direction：能量指向。向内=指向自己、独处、沉思、内省；向外=指向他人、世界、行动、表达
- energy_agency：主动性。主动=想要什么、做什么、争取什么；被动=被触发、被迫接受、无可奈何、放手
- emotion_temperature：情绪温度。热=兴奋、渴望、焦躁、愤怒、激情；冷=平静、麻木、释然、忧伤、孤独；温=温柔、怀旧、惆怅、温暖
- narrative_granularity：叙事颗粒度。情绪陈述=主要在表达一种情绪或态度；场景描写=有具体画面和时空；完整故事=有叙事线和具体事件；抽象意象=碎片化、超现实、概念性
- keywords：核心意象关键词
- scene_tags：场景标签
- mood_tags：情绪标签
- frequency：优先级权重（仅微调用）

## 匹配流程（严格按此顺序执行，不可跳过或颠倒）

### 第一步：情绪基调锁定（最重要，占决策权重的 50%）

从用户输入中提取以下三个维度的情绪特征：

1. 能量方向：用户是向内（自省、独处、内心挣扎）还是向外（表达、行动、与世界对抗）？
2. 主动性：用户是主动（在做什么、想要什么、争取什么）还是被动（被触发、被迫接受、无可奈何）？
3. 情绪温度：用户是热（愤怒、兴奋、焦躁、激动）、冷（平静、麻木、释然、忧伤）、还是温（怀旧、温柔、惆怅、感伤）？

然后将用户情绪特征与每首歌的 energy_direction、energy_agency、emotion_temperature 三个字段进行比对，找出情绪基调一致的候选歌曲。

情绪匹配优先级：
- 三个维度全部一致 → 高优先级候选
- 两个维度一致 → 中优先级候选
- 仅一个维度一致 → 低优先级候选
- 零个维度一致 → 除非无其他候选，否则不考虑

常见情绪模式参考：
- 社交场合的敏感、不适、过度思考 → 向内/被动/温
- 想逃离当下、渴望远方 → 向外/主动/温
- 表面坚强、内心悲观 → 混合/主动/热
- 迷茫但不想努力、享受当下 → 向内/主动/温
- 怀念过去、时光流逝 → 向内/被动/温
- 被生活压住但还要反抗 → 向外/主动/热
- 与孤独和解、独处中找到平静 → 向内/被动/冷
- 青春冲动、想玩想体验 → 向外/主动/热
- 褪色的记忆、曾经灿烂现已暗淡 → 向内/被动/冷
- 从小事中发现微小幸福 → 向内/被动/温

### 第二步：叙事颗粒度对齐（占决策权重的 30%）

判断用户输入的结构类型：

1. 具体场景型：有时间、地点、人物、具体事件 → 优先选择 narrative_granularity 为"完整故事"或"场景描写"的歌曲
2. 抽象情绪型：主要在表达情绪、心理状态，无具体事件 → 优先选择"情绪陈述"或"抽象意象"的歌曲
3. 混合型（有场景也有情绪）：以场景颗粒度为主，情绪为辅助
4. 长篇叙事型（超过五行或200字）：优先选择"完整故事"的歌曲
5. 短句爆发型（五行以内，情绪冲击）：优先选择"情绪陈述"的歌曲
6. 碎片日常型（口语化、随感）：优先选择"场景描写"的歌曲

### 第三步：歌词意象共鸣（占决策权重的 15%）

在情绪基调一致、叙事颗粒度对齐的候选歌曲中，仔细阅读每首歌的 lyrics（精简歌词），寻找与用户描述最共鸣的句子。

判断标准：
1. 用户描述的核心意象（如夕阳、海、风、光、梦、街、夜）是否在歌词中出现或呼应？
2. 歌词的核心情感是否与用户当前心境相通？
3. 是否有某句歌词直接"就是用户想说的话"？

禁止行为：
- 禁止因为一个关键词相同就决定匹配
- 禁止脑补完整歌词
- 禁止忽略情绪基调匹配而仅凭歌词意象做决定

### 第四步：专辑语境微调（占决策权重的 5%）

如果在第三步后仍有多个候选难以区分，查阅 album_description 字段：
- 专辑概念是否与用户描述的精神内核相通？
- 专辑语境仅用于微调，不可越过前三步的结论。

## 特殊规则

### 负向情绪处理
当用户描述中包含明显的负向情绪（焦虑、低落、自责、无助、绝望、崩溃）时：
1. 优先选择带有陪伴、希望、恢复、释怀、继续向前语义的歌曲
2. 避免选择带有绝望、自我攻击、自毁、羞辱语义的歌曲
3. 在情绪基调匹配的前提下，优先选择更温和、更托底、更可恢复的候选
4. 如无明显的安慰向候选，选择"最不加重负面情绪"的中性温和候选

### frequency 使用规则
- frequency 为 0 的歌曲绝不参与匹配
- 仅在上述所有判断后仍有平局时，优先选择 frequency 更大的歌曲
- frequency 不可作为主要判断依据，不可越过前三步

## 输出格式

只返回一个 JSON 对象，不要任何额外内容：
{"matchedSongId": 数字}`,
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

        // Browser auto-requests /favicon.ico; return 204 to avoid noisy 404 logs.
        if (url.pathname === '/favicon.ico') {
            return new Response(null, { status: 204 });
        }

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